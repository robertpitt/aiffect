import { Effect, ServiceMap, Stream } from "effect";
import type { AudioFrame } from "@/core/AudioFrame.js";
import type { TransportError } from "@/core/Errors.js";

export interface TransportShape {
  readonly inbound: Stream.Stream<AudioFrame, TransportError>;
  readonly send: (frame: AudioFrame) => Effect.Effect<void, TransportError>;
  readonly clear?: Effect.Effect<void, TransportError>;
}

export class Transport extends ServiceMap.Service<Transport, TransportShape>()(
  "@aiffect/Transport",
) {}
