/**
 * Shared Sandwich pipeline core: STT -> LLM -> TTS.
 * Configurable for streaming vs non-streaming and optional energy-based barge-in.
 */

import { Chat } from "effect/unstable/ai";
import { Effect, Fiber, Layer, Queue, Ref, Stream } from "effect";
import type { PipelineEvent } from "@/core/Events.js";
import {
  TranscriptDelta,
  SpeechStarted,
  SpeechEnded,
  Interrupted,
  ResponseCompleted,
} from "@/core/Events.js";
import { Pipeline } from "@/core/Pipeline.js";
import { Transport } from "@/core/Transport.js";
import { STT, TTS } from "@/core/Provider.js";
import { toPipelineError } from "@/core/Errors.js";
import { Agent, type AgentSpec } from "@/core/Agent.js";
import { AgentContext, makeAgentContext } from "@/core/AgentContext.js";
import { SessionContext, makeSessionContext } from "@/core/SessionContext.js";
import { logEvent } from "@/observability/EventLogger.js";
import { make as makeEventBroadcast } from "@/pipelines/EventBroadcast.js";
import type { AudioFrame } from "@/core/AudioFrame.js";
import { toolkitAsEffect } from "@/internal/toolkitCompat.js";
import { createInboundMonitor } from "@/pipelines/BargeInEnergy.js";
import type { BargeInConfig } from "@/pipelines/BargeInConfig.js";
import { trackTokenUsage } from "@/observability/UsageMetrics.js";

const SENTENCE_SPLIT = /(?<=[.!?])\s+/;
const DefaultSessionContext = makeSessionContext({ sessionId: crypto.randomUUID() });
const DefaultAgentContext = makeAgentContext({});

export interface SandwichCoreConfig {
  /** When present, enables streaming LLM + sentence-chunked TTS and energy-based barge-in. */
  readonly bargeIn?: BargeInConfig;
}

function makeProcessTranscriptNonStreaming(
  emit: (e: PipelineEvent) => Effect.Effect<void>,
  chat: {
    generateText: (opts: object) => Effect.Effect<{
      text?: string;
      usage?: { inputTokens?: number; outputTokens?: number };
    }>;
  },
  agent: AgentSpec,
  transport: Transport["Service"],
  tts: import("@/core/Provider.js").TTS["Service"],
) {
  return (transcript: string) =>
    Effect.gen(function* () {
      yield* Effect.annotateCurrentSpan("user.text", transcript);
      yield* emit(
        new TranscriptDelta({ role: "user", text: transcript, isFinal: true }),
      );

      const response = yield* chat.generateText({
        prompt: transcript,
        toolkit: toolkitAsEffect(agent.toolkit),
      });
      const assistantText = response.text ?? "";
      yield* Effect.annotateCurrentSpan("assistant.text", assistantText);
      yield* emit(
        new TranscriptDelta({
          role: "assistant",
          text: assistantText,
          isFinal: true,
        }),
      );
      yield* emit(new SpeechStarted({ timestamp: Date.now() }));
      let audioFrameCount = 0;
      yield* tts.synthesize(assistantText).pipe(
        Stream.mapEffect((frame) => {
          audioFrameCount++;
          return transport.send(frame);
        }),
        Stream.runDrain,
      );
      yield* emit(new SpeechEnded({ timestamp: Date.now() }));

      const responseId = crypto.randomUUID();
      const timestamp = Date.now();
      const usage = response.usage as
        | { inputTokens?: { total?: number } | number; outputTokens?: { total?: number } | number }
        | undefined;
      const inputTokens =
        typeof usage?.inputTokens === "object"
          ? (usage.inputTokens?.total ?? 0)
          : (usage?.inputTokens ?? 0);
      const outputTokens =
        typeof usage?.outputTokens === "object"
          ? (usage.outputTokens?.total ?? 0)
          : (usage?.outputTokens ?? 0);
      const completed = new ResponseCompleted({
        responseId,
        timestamp,
        status: "completed",
        inputTokens,
        outputTokens,
        audioFrames: audioFrameCount,
      });
      yield* emit(completed);
      yield* trackTokenUsage(completed);
    }).pipe(
      Effect.withSpan("sandwich.turn"),
      Effect.provide(agent.toolkitLayer as unknown as Layer.Layer<never, never, never>),
    );
}

function makeProcessTranscriptStreaming(
  emit: (e: PipelineEvent) => Effect.Effect<void>,
  chat: { streamText: (opts: object) => Stream.Stream<{ type: string; delta?: string }> },
  agent: AgentSpec,
  transport: Transport["Service"],
  tts: import("@/core/Provider.js").TTS["Service"],
  assistantSpeaking: Ref.Ref<boolean>,
) {
  return (transcript: string) =>
    Effect.gen(function* () {
      yield* Effect.annotateCurrentSpan("user.text", transcript);
      yield* emit(
        new TranscriptDelta({ role: "user", text: transcript, isFinal: true }),
      );

      const sentenceQueue = yield* Queue.unbounded<string>();
      let fullText = "";

      const producer = Effect.gen(function* () {
        let buffer = "";
        const stream = chat.streamText({
          prompt: transcript,
          toolkit: toolkitAsEffect(agent.toolkit),
        }) as Stream.Stream<{ type: string; delta?: string }>;
        yield* stream.pipe(
          Stream.runForEach((part) =>
            Effect.gen(function* () {
              if (part.type !== "text-delta") return;
              buffer += part.delta ?? "";
              fullText += part.delta ?? "";
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

      let audioFrameCount = 0;
      const consumer = Effect.gen(function* () {
        yield* Ref.set(assistantSpeaking, true);
        yield* emit(new SpeechStarted({ timestamp: Date.now() }));
        yield* Stream.fromQueue(sentenceQueue).pipe(
          Stream.catch(() => Stream.empty),
          Stream.mapEffect((sentence) =>
            tts.synthesize(sentence).pipe(
              Stream.mapEffect((frame) => {
                audioFrameCount++;
                return transport.send(frame);
              }),
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
      yield* emit(
        new TranscriptDelta({
          role: "assistant",
          text: fullText,
          isFinal: true,
        }),
      );

      const responseId = crypto.randomUUID();
      const timestamp = Date.now();
      const completed = new ResponseCompleted({
        responseId,
        timestamp,
        status: "completed",
        inputTokens: 0,
        outputTokens: 0,
        audioFrames: audioFrameCount,
      });
      yield* emit(completed);
      yield* trackTokenUsage(completed);
    }).pipe(
      Effect.withSpan("sandwich.turn"),
      Effect.provide(agent.toolkitLayer as unknown as Layer.Layer<never, never, never>),
    );
}

export function makeSandwichCore(config: SandwichCoreConfig = {}) {
  const bargeInConfig = config.bargeIn;

  return Layer.effect(
    Pipeline,
    Effect.gen(function* () {
      const transport = yield* Transport;
      const stt = yield* STT;
      const tts = yield* TTS;
      const agent = yield* Agent;
      const eventBroadcast = yield* makeEventBroadcast;

      const agentContext = yield* AgentContext;
      const sessionContext = yield* SessionContext;
      const systemPrompt = agent.buildPrompt(agentContext, sessionContext);
      const chat = yield* Chat.fromPrompt([
        { role: "system", content: systemPrompt },
      ]);

      const emit = (event: PipelineEvent) =>
        logEvent(event).pipe(Effect.flatMap(() => eventBroadcast.publish(event)));

      if (bargeInConfig !== undefined) {
        // SandwichBargeIn: two fibers, energy-based barge-in
        const audioQueue = yield* Queue.unbounded<AudioFrame>();
        const assistantSpeaking = yield* Ref.make(false);
        const currentTurnFiber = yield* Ref.make<Fiber.Fiber<
          void,
          unknown
        > | null>(null);
        const speechFrameCount = yield* Ref.make(0);

        const handleBargeIn = Effect.gen(function* () {
          const fiber = yield* Ref.getAndSet(currentTurnFiber, null);
          if (fiber) yield* Fiber.interrupt(fiber);
          yield* Ref.set(assistantSpeaking, false);
          yield* Ref.set(speechFrameCount, 0);
          if (transport.clear) yield* transport.clear;
          yield* emit(new Interrupted({ timestamp: Date.now() }));
        }).pipe(
          Effect.withSpan("sandwich.bargeIn"),
          Effect.catch((cause) =>
            Effect.logError("barge-in failed").pipe(
              Effect.annotateLogs("error", String(cause)),
            ),
          ),
        );

        const processTranscript = makeProcessTranscriptStreaming(
          emit,
          chat as unknown as { streamText: (opts: object) => Stream.Stream<{ type: string; delta?: string }> },
          agent,
          transport,
          tts,
          assistantSpeaking,
        );

        const inboundFiber = createInboundMonitor(
          bargeInConfig,
          {
            transport,
            audioQueue,
            assistantSpeaking,
            speechFrameCount,
            currentTurnFiber,
            onInterrupt: handleBargeIn,
          },
        );

        const sttInbound = Stream.fromQueue(audioQueue).pipe(
          Stream.catch(() => Stream.empty),
        );

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
              const fiber = yield* Effect.forkChild(
                processTranscript(t.text).pipe(
                  Effect.catch((cause) =>
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

        const run = Effect.log("starting sandwich (barge-in) loop").pipe(
          Effect.flatMap(() =>
            Effect.raceAll([inboundFiber, turnFiber]).pipe(
              Effect.ensuring(
                Ref.get(currentTurnFiber).pipe(
                  Effect.flatMap((f) =>
                    f ? Fiber.interrupt(f) : Effect.void,
                  ),
                ),
              ),
            ),
          ),
          Effect.tap(() => Effect.log("sandwich loop ended")),
          Effect.catch((cause) =>
            Effect.fail(
              toPipelineError(cause, "Sandwich barge-in pipeline failed"),
            ),
          ),
          Effect.withSpan("pipeline.run"),
        );

        return {
          run: run as Pipeline["Service"]["run"],
          events: eventBroadcast.subscribe,
        };
      }

      // Sandwich: single fiber, no barge-in, non-streaming
      const processTranscript = makeProcessTranscriptNonStreaming(
        emit,
        chat as unknown as { generateText: (opts: object) => Effect.Effect<{ text?: string }> },
        agent,
        transport,
        tts,
      );

      const run = stt.transcribe(transport.inbound).pipe(
        Stream.filter((t) => t.isFinal && t.text.trim().length > 0),
        Stream.mapEffect((t) =>
          processTranscript(t.text).pipe(
            Effect.catch((cause) =>
              Effect.logError("sandwich turn error").pipe(
                Effect.annotateLogs("error", String(cause)),
              ),
            ),
          ),
        ),
        Stream.runDrain,
        Effect.mapError((cause) =>
          toPipelineError(cause, "Sandwich pipeline failed"),
        ),
        Effect.withSpan("pipeline.run"),
      );

      return {
        run: run as Pipeline["Service"]["run"],
        events: eventBroadcast.subscribe,
      };
    }),
  ).pipe(
    Layer.provideMerge(DefaultSessionContext),
    Layer.provideMerge(DefaultAgentContext),
  );
}
