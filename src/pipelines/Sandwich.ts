import { LanguageModel, Chat, Toolkit, type Tool } from "@effect/ai";
import { Effect, Layer, Stream } from "effect";
import type { PipelineEvent } from "../schemas/Events.js";
import { TranscriptDelta, SpeechStarted, SpeechEnded } from "../schemas/Events.js";
import { Pipeline } from "../framework/Pipeline.js";
import { Transport } from "../framework/Transport.js";
import { STT, TTS } from "../framework/Provider.js";
import { PipelineError } from "../framework/Errors.js";
import { Agent, type AgentContext } from "../framework/Agent.js";
import { logEvent } from "../internal/EventLogger.js";
import { make as makeEventBroadcast } from "../internal/EventBroadcast.js";

/**
 * Sandwich pipeline: STT -> LLM (Chat + LanguageModel) -> TTS.
 * Uses the same EventBus (EventBroadcast) as Realtime for consistent event emission and subscription.
 *
 * Each turn is wrapped in a `sandwich.turn` span with annotations for
 * the user transcript and assistant response.
 */
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

    const agentContext: AgentContext = {
      sessionId: crypto.randomUUID(),
      metadata: {},
    };
    const systemPrompt = agent.buildPrompt(agentContext);

    const chat = yield* Chat.fromPrompt([{ role: "system", content: systemPrompt }]);

    const emit = (event: PipelineEvent) =>
      logEvent(event).pipe(Effect.flatMap(() => eventBroadcast.publish(event)));

    const processTranscript = (transcript: string) =>
      Effect.gen(function* () {
        yield* Effect.annotateCurrentSpan("user.text", transcript);

        yield* emit(
          new TranscriptDelta({
            role: "user",
            text: transcript,
            isFinal: true,
          }),
        );

        const response = yield* chat.generateText({
          prompt: transcript,
          toolkit: agent.toolkit as unknown as Toolkit.WithHandler<Record<string, Tool.Any>>,
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

        yield* tts.synthesize(assistantText).pipe(
          Stream.mapEffect((frame) => transport.send(frame)),
          Stream.runDrain,
        );

        yield* emit(new SpeechEnded({ timestamp: Date.now() }));
      }).pipe(Effect.withSpan("sandwich.turn"), Effect.provide(agent.toolkitLayer));

    const run: Pipeline["Type"]["run"] = stt.transcribe(transport.inbound).pipe(
      Stream.filter((t) => t.isFinal && t.text.trim().length > 0),
      Stream.mapEffect((t) =>
        processTranscript(t.text).pipe(
          Effect.catchAll((cause) =>
            Effect.logError("sandwich turn error").pipe(
              Effect.annotateLogs("error", String(cause)),
            ),
          ),
        ),
      ),
      Stream.runDrain,
      Effect.mapError(
        (cause) =>
          new PipelineError({
            reason: "Sandwich pipeline failed",
            cause,
          }),
      ),
      Effect.withSpan("pipeline.run"),
    );

    return { run, events: eventBroadcast.subscribe };
  }),
);
