import { Effect, Layer, PubSub, Ref, ServiceMap, Stream } from "effect";

/** Session status for lifecycle tracking. */
export type SessionStatus = "running" | "completed" | "transferred" | "error";

export interface StatusChange {
  readonly status: SessionStatus;
  readonly details?: Record<string, unknown>;
}

/** Usage snapshot for a session. */
export interface UsageSnapshot {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly audioFrames: number;
}

/** Session lifecycle: status transitions and usage aggregation. */
export interface SessionLifecycleShape {
  readonly getStatus: Effect.Effect<SessionStatus>;
  readonly transitionTo: (
    status: SessionStatus,
    details?: Record<string, unknown>,
  ) => Effect.Effect<void>;
  readonly statusChanges: Stream.Stream<StatusChange>;
  readonly accumulateUsage: (update: UsageUpdate) => Effect.Effect<void>;
  readonly getUsage: Effect.Effect<UsageSnapshot>;
}

export interface UsageUpdate {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly audioFrames?: number;
}

export class SessionLifecycle extends ServiceMap.Service<
  SessionLifecycle,
  SessionLifecycleShape
>()("@aiffect/SessionLifecycle") {}

const createSessionLifecycle = Effect.gen(function* () {
  const statusRef = yield* Ref.make<SessionStatus>("running");
  const usageRef = yield* Ref.make<UsageSnapshot>({
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    audioFrames: 0,
  });
  const pubsub = yield* PubSub.unbounded<StatusChange>();

  const transitionTo = (
    status: SessionStatus,
    details?: Record<string, unknown>,
  ) =>
    Effect.gen(function* () {
      yield* Ref.set(statusRef, status);
      yield* PubSub.publish(pubsub, { status, details });
    });

  const statusChanges = Stream.fromPubSub(pubsub);

  const accumulateUsage = (update: UsageUpdate) =>
    Effect.gen(function* () {
      const current = yield* Ref.get(usageRef);
      const next: UsageSnapshot = {
        inputTokens: current.inputTokens + (update.inputTokens ?? 0),
        outputTokens: current.outputTokens + (update.outputTokens ?? 0),
        totalTokens:
          current.totalTokens +
          (update.inputTokens ?? 0) +
          (update.outputTokens ?? 0),
        audioFrames: current.audioFrames + (update.audioFrames ?? 0),
      };
      yield* Ref.set(usageRef, next);
    });

  return {
    getStatus: Ref.get(statusRef),
    transitionTo,
    statusChanges,
    accumulateUsage,
    getUsage: Ref.get(usageRef),
  };
});

export const SessionLifecycleLive = Layer.effect(SessionLifecycle)(createSessionLifecycle);
