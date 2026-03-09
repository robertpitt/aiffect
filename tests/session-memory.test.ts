import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { SessionMemory, SessionMemoryLive } from "@/index.js";

describe("SessionMemory", () => {
  it("get/set/has/delete/clear work correctly", async () => {
    const program = Effect.scoped(
      Effect.gen(function* () {
        const ctx = yield* Layer.build(SessionMemoryLive);
        yield* Effect.gen(function* () {
          const memory = yield* SessionMemory;
          yield* memory.set("key1", "value1");
          const v1 = yield* memory.get<string>("key1");
          expect(v1).toBe("value1");

          const has1 = yield* memory.has("key1");
          expect(has1).toBe(true);

          yield* memory.set("key2", { foo: 42 });
          const v2 = yield* memory.get<{ foo: number }>("key2");
          expect(v2).toEqual({ foo: 42 });

          const deleted = yield* memory.delete("key1");
          expect(deleted).toBe(true);
          const v1After = yield* memory.get<string>("key1");
          expect(v1After).toBeUndefined();

          yield* memory.clear();
          const v2After = yield* memory.get("key2");
          expect(v2After).toBeUndefined();
        }).pipe(Effect.provide(ctx));
      }),
    );

    await Effect.runPromise(program);
  });
});
