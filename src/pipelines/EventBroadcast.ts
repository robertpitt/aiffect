import { Effect, PubSub, Stream } from "effect";
import type { Scope } from "effect";
import type { PipelineEvent } from "../core/Events.js";
import { PipelineError } from "../core/Errors.js";

export interface EventBroadcast {
  readonly publish: (event: PipelineEvent) => Effect.Effect<void>;
  readonly subscribe: Stream.Stream<PipelineEvent, PipelineError>;
}

/**
 * Creates a PubSub-based event broadcast. One subscription is created and exposed
 * as the `subscribe` stream. Requires Scope so the subscription is cleaned up when
 * the scope closes.
 */
export const make: Effect.Effect<EventBroadcast, never, Scope.Scope> = Effect.gen(function* () {
  const pubsub = yield* PubSub.unbounded<PipelineEvent>();
  const subscription = yield* PubSub.subscribe(pubsub);

  const publish = (event: PipelineEvent) => Effect.asVoid(PubSub.publish(pubsub, event));

  const subscribe = Stream.fromQueue(subscription).pipe(
    Stream.catchAll(() => Stream.fail(new PipelineError({ reason: "Event broadcast closed" }))),
  );

  return { publish, subscribe };
});
