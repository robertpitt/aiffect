import { Effect, Layer, Ref, ServiceMap } from "effect";

/**
 * Session-scoped mutable key-value store. Tools can read/write state that
 * persists across turns within a session. Cleared when the session ends.
 */
export interface SessionMemoryShape {
  readonly get: <T>(key: string) => Effect.Effect<T | undefined>;
  readonly set: (key: string, value: unknown) => Effect.Effect<void>;
  readonly has: (key: string) => Effect.Effect<boolean>;
  readonly delete: (key: string) => Effect.Effect<boolean>;
  readonly clear: () => Effect.Effect<void>;
}

export class SessionMemory extends ServiceMap.Service<SessionMemory, SessionMemoryShape>()(
  "@aiffect/SessionMemory",
) {}

const createSessionMemory = Effect.gen(function* () {
  const ref = yield* Ref.make<Record<string, unknown>>({});

  const get = <T>(key: string) =>
    Ref.get(ref).pipe(Effect.map((store) => store[key] as T | undefined));

  const set = (key: string, value: unknown) =>
    Ref.update(ref, (store) => ({ ...store, [key]: value }));

  const has = (key: string) => Ref.get(ref).pipe(Effect.map((store) => key in store));

  const deleteKey = (key: string) =>
    Ref.modify(ref, (store) => {
      const hasKey = key in store;
      const next = { ...store };
      delete next[key];
      return [hasKey, next] as const;
    });

  const clear = () => Ref.set(ref, {});

  return {
    get,
    set,
    has,
    delete: deleteKey,
    clear,
  };
});

export const SessionMemoryLive = Layer.effect(SessionMemory)(createSessionMemory);
