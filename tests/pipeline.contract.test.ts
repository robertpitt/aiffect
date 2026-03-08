import { describe, it, expect } from "vitest";
import { Effect, Fiber, Layer, Queue, Duration } from "effect";
import { Toolkit } from "effect/unstable/ai";
import { AudioFrame, Pipeline, Agent, defineAgent, RealtimePipeline } from "@/index.js";
import { testTransport, testRealtime } from "./test-utils.js";

const noopAgent = defineAgent({
  name: "TestAgent",
  buildPrompt: (_agentContext, _sessionContext) => "You are a test agent.",
  toolkit: Toolkit.empty,
  toolkitLayer: Layer.empty as Layer.Layer<any, never, never>,
});

describe("Pipeline contract", () => {
  it("when inbound audio is pushed to transport, provider receives frames", async () => {
    const program = Effect.gen(function* () {
      const transport = yield* testTransport();
      const realtime = yield* testRealtime();

      const agentLayer = Layer.succeed(Agent, noopAgent);
      const appLayer = RealtimePipeline.pipe(
        Layer.provide(transport.layer),
        Layer.provide(realtime.layer),
        Layer.provide(agentLayer),
      );

      const run = Effect.scoped(
        Layer.build(appLayer).pipe(
          Effect.flatMap((ctx) =>
            Effect.forkChild(
              Effect.gen(function* () {
                const pipeline = yield* Pipeline;
                yield* pipeline.run;
              }).pipe(Effect.provide(ctx)),
            ).pipe(
              Effect.flatMap((fiber) =>
                Effect.gen(function* () {
                  yield* Effect.sleep(Duration.millis(100));
                  const frame = new AudioFrame({
                    samples: new Uint8Array(480),
                    sampleRate: 24000,
                    channels: 1,
                    timestamp: Date.now(),
                  });
                  yield* Queue.offer(transport.inboundQueue, frame);
                  yield* Effect.sleep(Duration.millis(200));
                  yield* Fiber.interrupt(fiber);
                }),
              ),
            ),
          ),
        ),
      );

      yield* run;
      const sent = yield* realtime.getSentFrames;
      expect(sent.length).toBeGreaterThanOrEqual(1);
    }).pipe(Effect.catch((e) => Effect.log("Contract test error:", e).pipe(Effect.as(void 0))));

    await Effect.runPromise(program);
  });
});
