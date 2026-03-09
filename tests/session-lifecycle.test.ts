import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { SessionLifecycle, SessionLifecycleLive } from "@/index.js";

describe("SessionLifecycle", () => {
  it("transitions status", async () => {
    const program = Effect.scoped(
      Effect.gen(function* () {
        const ctx = yield* Layer.build(SessionLifecycleLive);
        yield* Effect.gen(function* () {
          const lifecycle = yield* SessionLifecycle;
          const status1 = yield* lifecycle.getStatus;
          expect(status1).toBe("running");

          yield* lifecycle.transitionTo("completed");
          const status2 = yield* lifecycle.getStatus;
          expect(status2).toBe("completed");

          yield* lifecycle.transitionTo("error", { message: "test" });
          const status3 = yield* lifecycle.getStatus;
          expect(status3).toBe("error");
        }).pipe(Effect.provide(ctx));
      }),
    );

    await Effect.runPromise(program);
  });

  it("accumulates usage", async () => {
    const program = Effect.scoped(
      Effect.gen(function* () {
        const ctx = yield* Layer.build(SessionLifecycleLive);
        yield* Effect.gen(function* () {
          const lifecycle = yield* SessionLifecycle;
          yield* lifecycle.accumulateUsage({
            inputTokens: 100,
            outputTokens: 50,
            audioFrames: 10,
          });

          yield* lifecycle.accumulateUsage({
            inputTokens: 200,
            outputTokens: 80,
          });

          const usage = yield* lifecycle.getUsage;
          expect(usage.inputTokens).toBe(300);
          expect(usage.outputTokens).toBe(130);
          expect(usage.totalTokens).toBe(430);
          expect(usage.audioFrames).toBe(10);
        }).pipe(Effect.provide(ctx));
      }),
    );

    await Effect.runPromise(program);
  });
});
