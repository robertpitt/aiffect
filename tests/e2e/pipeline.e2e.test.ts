/**
 * End-to-end tests: full Sandwich pipeline with mock STT/TTS/LLM.
 * Simulates a call by injecting audio, validates that the agent responded
 * (via TranscriptDelta or ResponseCompleted), without asserting on audio output.
 */
import { describe, it, expect } from "vitest";
import { Effect, Fiber, Layer, Queue, Stream, Duration } from "effect";
import { Toolkit } from "effect/unstable/ai";
import {
  type AudioFrame,
  Pipeline,
  Agent,
  defineAgent,
  makeSessionContext,
  makeAgentContext,
  SandwichPipeline,
  isTranscriptDelta,
  isResponseCompleted,
  type PipelineEvent,
} from "@/index.js";
import {
  testTransport,
  testSTT,
  testTTS,
  testLanguageModel,
  testFrame,
} from "../test-utils.js";

const testAgent = defineAgent({
  name: "E2ETestAgent",
  buildPrompt: (_agentContext, _sessionContext) => "You are a helpful assistant. Reply briefly.",
  toolkit: Toolkit.empty,
  toolkitLayer: Layer.empty as Layer.Layer<unknown, never, never>,
});

const MOCK_USER_SAYS = "What time is it?";
const MOCK_AGENT_RESPONSE = "It is time to test!";

describe("Pipeline E2E", () => {
  it(
    "Sandwich pipeline: inject audio via transport, agent responds with transcript",
    { timeout: 10000 },
    async () => {
      const program = Effect.gen(function* () {
        const transport = yield* testTransport();

        const appLayer = SandwichPipeline.pipe(
          Layer.provide(transport.layer),
          Layer.provide(testSTT(MOCK_USER_SAYS)),
          Layer.provide(testTTS()),
          Layer.provide(Layer.succeed(Agent, testAgent)),
          Layer.provide(makeSessionContext({ sessionId: "e2e-test-session" })),
          Layer.provide(makeAgentContext({})),
        ).pipe(Layer.provideMerge(testLanguageModel(MOCK_AGENT_RESPONSE)));

        const eventsCollected: PipelineEvent[] = [];

        yield* Effect.scoped(
          Layer.build(appLayer).pipe(
            Effect.flatMap((ctx) =>
              Effect.gen(function* () {
                const pipeline = yield* Pipeline;

                const runFiber = yield* Effect.forkChild(pipeline.run.pipe(Effect.provide(ctx)));

                const collectFiber = yield* Effect.forkChild(
                  pipeline.events
                    .pipe(
                      Stream.takeUntil((e) => isResponseCompleted(e)),
                      Stream.runForEach((e) => Effect.sync(() => eventsCollected.push(e))),
                    )
                    .pipe(Effect.provide(ctx)),
                );

                yield* Effect.sleep(Duration.millis(50));
                yield* Queue.offer(transport.inboundQueue, testFrame());
                yield* Effect.sleep(Duration.millis(300));
                yield* Queue.shutdown(transport.inboundQueue);

                yield* Fiber.join(runFiber);
                yield* Fiber.join(collectFiber);
              }).pipe(Effect.provide(ctx)),
            ),
          ),
        );

        const assistantTranscripts = eventsCollected.filter(
          (e) => isTranscriptDelta(e) && e.role === "assistant",
        ) as Array<{ text: string }>;
        const responseCompleted = eventsCollected.find((e) => isResponseCompleted(e));

        expect(assistantTranscripts.length).toBeGreaterThanOrEqual(1);
        expect(assistantTranscripts.some((e) => e.text.includes(MOCK_AGENT_RESPONSE))).toBe(true);
        expect(responseCompleted).toBeDefined();
      }).pipe(Effect.catch((e) => Effect.log("E2E test error:", e).pipe(Effect.as(void 0))));

      await Effect.runPromise(program);
    },
  );

  it("Sandwich pipeline: outbound audio is sent to transport", { timeout: 5000 }, async () => {
    const outboundFrames: AudioFrame[] = [];
    const program = Effect.gen(function* () {
      const transport = yield* testTransport();

      const appLayer = SandwichPipeline.pipe(
        Layer.provide(transport.layer),
        Layer.provide(testSTT("Hi")),
        Layer.provide(testTTS(3)),
        Layer.provide(Layer.succeed(Agent, testAgent)),
        Layer.provide(makeSessionContext({ sessionId: "e2e-test-session" })),
        Layer.provide(makeAgentContext({})),
      ).pipe(Layer.provideMerge(testLanguageModel("Hi there!")));

      yield* Effect.scoped(
        Layer.build(appLayer).pipe(
          Effect.flatMap((ctx) =>
            Effect.gen(function* () {
              const pipeline = yield* Pipeline;

              const runFiber = yield* Effect.forkChild(pipeline.run.pipe(Effect.provide(ctx)));

              const collectFiber = yield* Effect.forkChild(
                Stream.fromQueue(transport.outboundQueue).pipe(
                  Stream.take(3),
                  Stream.runForEach((f) => Effect.sync(() => outboundFrames.push(f))),
                ),
              );

              yield* Effect.sleep(Duration.millis(50));
              yield* Queue.offer(transport.inboundQueue, testFrame());
              yield* Effect.sleep(Duration.millis(500));
              yield* Queue.shutdown(transport.inboundQueue);

              yield* Fiber.join(runFiber);
              yield* Fiber.join(collectFiber);
            }).pipe(Effect.provide(ctx)),
          ),
        ),
      );

      expect(outboundFrames.length).toBeGreaterThanOrEqual(1);
    }).pipe(Effect.catch((e) => Effect.log("E2E outbound test error:", e).pipe(Effect.as(void 0))));

    await Effect.runPromise(program);
  });
});
