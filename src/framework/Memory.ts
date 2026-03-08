import { Context, Effect, HashMap, Layer, Option, Ref } from "effect";

export interface MemoryShape {
  readonly get: <A>(key: string) => Effect.Effect<Option.Option<A>>;
  readonly set: (key: string, value: unknown) => Effect.Effect<void>;
  readonly has: (key: string) => Effect.Effect<boolean>;
  readonly entries: Effect.Effect<ReadonlyArray<readonly [string, unknown]>>;
  readonly clear: Effect.Effect<void>;
}

export class Memory extends Context.Tag("@aiffect/Memory")<Memory, MemoryShape>() {}

export const MemoryLive: Layer.Layer<Memory> = Layer.effect(
  Memory,
  Effect.gen(function* () {
    const ref = yield* Ref.make(HashMap.empty<string, unknown>());
    return {
      get: <A>(key: string) =>
        Ref.get(ref).pipe(Effect.map((m) => HashMap.get(m, key) as Option.Option<A>)),
      set: (key: string, value: unknown) => Ref.update(ref, HashMap.set(key, value)),
      has: (key: string) => Ref.get(ref).pipe(Effect.map((m) => HashMap.has(m, key))),
      entries: Ref.get(ref).pipe(Effect.map((m) => Array.from(HashMap.toEntries(m)))),
      clear: Ref.set(ref, HashMap.empty<string, unknown>()),
    };
  }),
);
