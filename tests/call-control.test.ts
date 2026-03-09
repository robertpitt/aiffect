import { describe, it, expect } from "vitest";
import { Effect, Deferred, Layer } from "effect";
import { CallControl, makeCallControlLayer, CallControlNoop } from "@/index.js";

describe("CallControl", () => {
  it("requestEnd resolves deferred and triggers pipeline end", async () => {
    const program = Effect.scoped(
      Effect.gen(function* () {
        const deferred = yield* Deferred.make<void>();
        const layer = makeCallControlLayer({
          endRequested: deferred,
          onEnd: (msg) => Effect.sync(() => expect(msg).toBe("goodbye")),
        });

        const ctx = yield* Layer.build(layer);

        yield* Effect.gen(function* () {
          const callControl = yield* CallControl;
          yield* Effect.forkChild(callControl.requestEnd("goodbye"));
          yield* Deferred.await(deferred);
        }).pipe(Effect.provide(ctx));
      }),
    );

    await Effect.runPromise(program);
  });

  it("CallControlNoop requestEnd does nothing", async () => {
    const program = Effect.scoped(
      Effect.gen(function* () {
        const ctx = yield* Layer.build(CallControlNoop);
        yield* Effect.gen(function* () {
          const callControl = yield* CallControl;
          yield* callControl.requestEnd();
        }).pipe(Effect.provide(ctx));
      }),
    );

    await Effect.runPromise(program);
  });
});
