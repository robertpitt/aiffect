import { Deferred, Effect, Layer, ServiceMap } from "effect";

/**
 * Call control abstraction: tools can request "end call" or "transfer call"
 * without knowing the transport. The pipeline reacts and terminates or hands off.
 */
export interface CallControlShape {
  readonly requestEnd: (message?: string) => Effect.Effect<void>;
  readonly requestTransfer: (to: string) => Effect.Effect<void>;
  /** Effect that completes when requestEnd or requestTransfer is invoked. Pipeline races against this. */
  readonly awaitEndRequested: Effect.Effect<void>;
}

export class CallControl extends ServiceMap.Service<CallControl, CallControlShape>()(
  "@aiffect/CallControl",
) {}

export interface CallControlLiveOptions {
  readonly onEnd?: (message?: string) => Effect.Effect<void>;
  readonly onTransfer?: (to: string) => Effect.Effect<void>;
  /** Deferred that is resolved when requestEnd/requestTransfer is called. Pipeline awaits this. */
  readonly endRequested: Deferred.Deferred<void>;
}

/**
 * Create a CallControl layer with callbacks. The pipeline races against
 * endRequested.await; when requestEnd or requestTransfer is called, the deferred
 * is resolved and the pipeline can complete.
 */
export const makeCallControlLayer = (
  options: CallControlLiveOptions,
): Layer.Layer<CallControl> =>
  Layer.succeed(CallControl, {
    requestEnd: (message?: string) =>
      Effect.gen(function* () {
        yield* options.onEnd?.(message) ?? Effect.void;
        yield* Deferred.succeed(options.endRequested, undefined);
      }),
    requestTransfer: (to: string) =>
      Effect.gen(function* () {
        yield* options.onTransfer?.(to) ?? Effect.void;
        yield* Deferred.succeed(options.endRequested, undefined);
      }),
    awaitEndRequested: Deferred.await(options.endRequested),
  });

/**
 * No-op CallControl: requestEnd and requestTransfer do nothing; awaitEndRequested never completes.
 * Use when call control is not needed (e.g. web-only sessions).
 */
export const CallControlNoop = Layer.succeed(CallControl, {
  requestEnd: () => Effect.void,
  requestTransfer: () => Effect.void,
  awaitEndRequested: Effect.never,
});

/**
 * Create a CallControl layer that signals via a Deferred.
 * Returns the layer and the deferred. The pipeline should race against deferred.await.
 */
export const makeCallControlWithDeferred = (
  options?: { onEnd?: (message?: string) => Effect.Effect<void>; onTransfer?: (to: string) => Effect.Effect<void> },
): Effect.Effect<{ layer: Layer.Layer<CallControl>; endRequested: Deferred.Deferred<void> }> =>
  Effect.gen(function* () {
    const endRequested = yield* Deferred.make<void>();
    const layer = makeCallControlLayer({
      onEnd: options?.onEnd,
      onTransfer: options?.onTransfer,
      endRequested,
    });
    return { layer, endRequested };
  });
