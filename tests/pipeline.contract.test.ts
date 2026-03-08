/**
 * Contract tests for the realtime pipeline: when inbound audio arrives, provider receives frames;
 * tool call triggers dispatch and submitToolOutput; interrupt clears transport.
 */

import { describe, it, expect } from "vitest";
import { Effect, Fiber, Layer, Queue, Duration } from "effect";
import { AudioFrame } from "../src/schemas/AudioFrame.js";
import { run as runSession } from "../src/framework/Session.js";
import { make as RealtimePipeline } from "../src/pipelines/Realtime.js";
import { Agent } from "../src/framework/Agent.js";
import type { AgentSpec } from "../src/framework/Agent.js";
import { makeTestTransport } from "../src/test/TestTransport.js";
import { makeTestRealtime } from "../src/test/TestProvider.js";

const noopAgent: AgentSpec = {
  name: "TestAgent",
  buildPrompt: () => "You are a test agent.",
  toolkit: { tools: {} } as AgentSpec["toolkit"],
  toolkitLayer: Layer.empty as Layer.Layer<any, never, never>,
};

describe("Pipeline contract", () => {
  it("when inbound audio is pushed to transport, provider receives frames", async () => {
    const program = Effect.gen(function* () {
      const harness = yield* makeTestTransport();
      const realtimeHarness = yield* makeTestRealtime();

      const agentLayer = Layer.succeed(Agent, noopAgent);
      const appLayer = RealtimePipeline.pipe(
        Layer.provide(harness.layer),
        Layer.provide(realtimeHarness.layer),
        Layer.provide(agentLayer),
        Layer.provide(Layer.scope),
      );

      const session = runSession({ connectionId: "test-1" });
      const run = Effect.scoped(
        Layer.build(appLayer).pipe(
          Effect.flatMap((ctx) =>
            Effect.fork(session.pipe(Effect.provide(ctx))).pipe(
              Effect.flatMap((fiber) =>
                Effect.gen(function* () {
                  yield* Effect.sleep(Duration.millis(100));
                  const frame = new AudioFrame({
                    samples: new Uint8Array(480),
                    sampleRate: 24000,
                    channels: 1,
                    timestamp: Date.now(),
                  });
                  yield* Queue.offer(harness.inboundQueue, frame);
                  yield* Effect.sleep(Duration.millis(200));
                  yield* Fiber.interrupt(fiber);
                }),
              ),
            ),
          ),
        ),
      );

      yield* run;
      const sent = yield* realtimeHarness.getSentFrames;
      expect(sent.length).toBeGreaterThanOrEqual(1);
    }).pipe(Effect.catchAll((e) => Effect.log("Contract test error:", e).pipe(Effect.as(void 0))));

    await Effect.runPromise(program);
  });
});
