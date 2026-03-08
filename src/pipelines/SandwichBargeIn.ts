import { LanguageModel, Chat, Toolkit, type Tool } from "@effect/ai";
import { Effect, Fiber, Layer, Queue, Ref, Stream } from "effect";
import type { PipelineEvent } from "../schemas/Events.js";
import { TranscriptDelta, SpeechStarted, SpeechEnded, Interrupted } from "../schemas/Events.js";
import { Pipeline } from "../framework/Pipeline.js";
import { Transport } from "../framework/Transport.js";
import { STT, TTS } from "../framework/Provider.js";
import { PipelineError } from "../framework/Errors.js";
import { Agent, type AgentContext } from "../framework/Agent.js";
import { logEvent } from "../internal/EventLogger.js";
import { make as makeEventBroadcast } from "../internal/EventBroadcast.js";
import type { AudioFrame } from "../schemas/AudioFrame.js";

/**
 * Sandwich pipeline with barge-in: STT -> streaming LLM -> sentence-chunked
 * TTS with concurrent energy-based interruption.
 * Uses the same EventBus (EventBroadcast) as Realtime/Sandwich; barge-in is
 * a local energy-based InterruptPolicy (interrupt turn, clear transport, emit Interrupted).
 *
 * Key latency optimisation: instead of waiting for the full LLM response
 * before starting TTS, we stream tokens from the LLM, buffer them into
 * sentence-sized chunks, and start TTS synthesis as soon as the first
 * sentence is complete. This means audio playback overlaps with LLM
 * generation of subsequent sentences.
 *
 * Two concurrent fibers run for the session lifetime:
 *   1. **inbound**  — feeds audio to the STT queue and monitors frame energy
 *      for instant barge-in while the assistant is speaking.
 *   2. **turns**    — consumes STT transcripts, forking each turn as
 *      streaming LLM → sentence queue → TTS → transport.
 */

const BARGE_IN_ENERGY_THRESHOLD = 0.02;
const SPEECH_FRAME_THRESHOLD = 3;

/** Splits on whitespace that follows sentence-ending punctuation. */
const SENTENCE_SPLIT = /(?<=[.!?])\s+/;

function pcm16Rms(samples: Uint8Array): number {
  const view = new DataView(samples.buffer, samples.byteOffset, samples.byteLength);
  const count = samples.byteLength / 2;
  if (count === 0) return 0;
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const s = view.getInt16(i * 2, true);
    sum += s * s;
  }
  return Math.sqrt(sum / count) / 32768;
}

export const make: Layer.Layer<
  Pipeline,
  never,
  Transport | STT | TTS | LanguageModel.LanguageModel | Agent | import("effect").Scope.Scope
> = Layer.effect(
  Pipeline,
  Effect.gen(function* () {
    const transport = yield* Transport;
    const stt = yield* STT;
    const tts = yield* TTS;
    const agent = yield* Agent;
    const eventBroadcast = yield* makeEventBroadcast;

    const audioQueue = yield* Queue.unbounded<AudioFrame>();
    const assistantSpeaking = yield* Ref.make(false);
    const currentTurnFiber = yield* Ref.make<Fiber.RuntimeFiber<void, unknown> | null>(null);
    const speechFrameCount = yield* Ref.make(0);

    const agentContext: AgentContext = {
      sessionId: crypto.randomUUID(),
      metadata: {},
    };
    const systemPrompt = agent.buildPrompt(agentContext);
    const chat = yield* Chat.fromPrompt([{ role: "system", content: systemPrompt }]);

    const emit = (event: PipelineEvent) =>
      logEvent(event).pipe(Effect.flatMap(() => eventBroadcast.publish(event)));

    // ------------------------------------------------------------------
    // Barge-in handler — interrupts the active turn and clears audio
    // ------------------------------------------------------------------
    const handleBargeIn = Effect.gen(function* () {
      const fiber = yield* Ref.getAndSet(currentTurnFiber, null);
      if (fiber) yield* Fiber.interrupt(fiber);
      yield* Ref.set(assistantSpeaking, false);
      yield* Ref.set(speechFrameCount, 0);
      if (transport.clear) yield* transport.clear;
      yield* emit(new Interrupted({ timestamp: Date.now() }));
    }).pipe(
      Effect.withSpan("sandwich.bargeIn"),
      Effect.catchAll((cause) =>
        Effect.logError("barge-in failed").pipe(Effect.annotateLogs("error", String(cause))),
      ),
    );

    // ------------------------------------------------------------------
    // Turn processing — streaming LLM → sentence chunking → TTS pipeline
    //
    // A producer/consumer pair connected by a sentence queue:
    //   producer: streams tokens from the LLM, splits into sentences
    //   consumer: synthesises and sends each sentence to the transport
    // ------------------------------------------------------------------
    const processTranscript = (transcript: string) =>
      Effect.gen(function* () {
        yield* Effect.annotateCurrentSpan("user.text", transcript);
        yield* emit(new TranscriptDelta({ role: "user", text: transcript, isFinal: true }));

        const sentenceQueue = yield* Queue.unbounded<string>();
        let fullText = "";

        // --- Producer: stream LLM tokens, chunk into sentences ----------
        const producer = Effect.gen(function* () {
          let buffer = "";

          yield* chat
            .streamText({
              prompt: transcript,
              toolkit: agent.toolkit as unknown as Toolkit.WithHandler<Record<string, Tool.Any>>,
            })
            .pipe(
              Stream.runForEach((part) =>
                Effect.gen(function* () {
                  if (part.type !== "text-delta") return;
                  buffer += part.delta;
                  fullText += part.delta;

                  const parts = buffer.split(SENTENCE_SPLIT);
                  if (parts.length > 1) {
                    for (let i = 0; i < parts.length - 1; i++) {
                      const sentence = parts[i]!.trim();
                      if (sentence) yield* Queue.offer(sentenceQueue, sentence);
                    }
                    buffer = parts[parts.length - 1] ?? "";
                  }
                }),
              ),
            );

          const remaining = buffer.trim();
          if (remaining) yield* Queue.offer(sentenceQueue, remaining);
        }).pipe(Effect.ensuring(Queue.shutdown(sentenceQueue)));

        // --- Consumer: synthesise + send each sentence as it arrives -----
        const consumer = Effect.gen(function* () {
          yield* Ref.set(assistantSpeaking, true);
          yield* emit(new SpeechStarted({ timestamp: Date.now() }));

          yield* Stream.fromQueue(sentenceQueue).pipe(
            Stream.catchAll(() => Stream.empty),
            Stream.mapEffect((sentence) =>
              tts.synthesize(sentence).pipe(
                Stream.mapEffect((frame) => transport.send(frame)),
                Stream.runDrain,
              ),
            ),
            Stream.runDrain,
          );

          yield* Ref.set(assistantSpeaking, false);
          yield* emit(new SpeechEnded({ timestamp: Date.now() }));
        });

        yield* Effect.all([producer, consumer], { concurrency: 2, discard: true });

        yield* Effect.annotateCurrentSpan("assistant.text", fullText);
        yield* emit(new TranscriptDelta({ role: "assistant", text: fullText, isFinal: true }));
      }).pipe(Effect.withSpan("sandwich.turn"), Effect.provide(agent.toolkitLayer));

    // ------------------------------------------------------------------
    // Fiber 1: inbound monitor — queue audio + energy-based barge-in
    // ------------------------------------------------------------------
    const inboundFiber = transport.inbound.pipe(
      Stream.mapEffect((frame) =>
        Effect.gen(function* () {
          yield* Queue.offer(audioQueue, frame);

          const energy = pcm16Rms(frame.samples);
          if (energy > BARGE_IN_ENERGY_THRESHOLD) {
            const count = yield* Ref.updateAndGet(speechFrameCount, (n) => n + 1);
            const speaking = yield* Ref.get(assistantSpeaking);
            if (speaking && count >= SPEECH_FRAME_THRESHOLD) {
              yield* handleBargeIn;
            }
          } else {
            yield* Ref.set(speechFrameCount, 0);
          }
        }),
      ),
      Stream.runDrain,
      Effect.ensuring(Queue.shutdown(audioQueue)),
      Effect.withSpan("sandwich.inbound"),
    );

    // ------------------------------------------------------------------
    // Fiber 2: transcript processing — drive turns from STT output
    // ------------------------------------------------------------------
    const sttInbound = Stream.fromQueue(audioQueue).pipe(Stream.catchAll(() => Stream.empty));

    const turnFiber = stt.transcribe(sttInbound).pipe(
      Stream.filter((t) => t.isFinal && t.text.trim().length > 0),
      Stream.mapEffect((t) =>
        Effect.gen(function* () {
          const existing = yield* Ref.getAndSet(currentTurnFiber, null);
          if (existing) {
            yield* Fiber.interrupt(existing);
            yield* Ref.set(assistantSpeaking, false);
            if (transport.clear) yield* transport.clear;
          }

          const fiber = yield* Effect.fork(
            processTranscript(t.text).pipe(
              Effect.catchAll((cause) =>
                Effect.logError("sandwich turn error").pipe(
                  Effect.annotateLogs("error", String(cause)),
                ),
              ),
              Effect.ensuring(Ref.set(assistantSpeaking, false)),
            ),
          );
          yield* Ref.set(currentTurnFiber, fiber);
        }),
      ),
      Stream.runDrain,
      Effect.withSpan("sandwich.turns"),
    );

    // ------------------------------------------------------------------
    // Pipeline run — race inbound + turns, clean up on exit
    // ------------------------------------------------------------------
    const run: Pipeline["Type"]["run"] = Effect.log("starting sandwich (barge-in) loop").pipe(
      Effect.flatMap(() =>
        Effect.raceAll([inboundFiber, turnFiber]).pipe(
          Effect.ensuring(
            Ref.get(currentTurnFiber).pipe(
              Effect.flatMap((f) => (f ? Fiber.interrupt(f) : Effect.void)),
            ),
          ),
        ),
      ),
      Effect.tap(() => Effect.log("sandwich loop ended")),
      Effect.catchAll((cause) =>
        Effect.fail(
          cause instanceof PipelineError
            ? cause
            : new PipelineError({ reason: "Sandwich barge-in pipeline failed", cause }),
        ),
      ),
      Effect.withSpan("pipeline.run"),
    );

    return { run, events: eventBroadcast.subscribe };
  }),
);
