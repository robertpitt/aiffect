import { Context, Effect, Stream } from "effect";
import type { AudioFrame } from "../schemas/AudioFrame.js";
import type { TransportError } from "./Errors.js";

export interface TransportShape {
  readonly inbound: Stream.Stream<AudioFrame, TransportError>;
  readonly send: (frame: AudioFrame) => Effect.Effect<void, TransportError>;
  readonly clear?: Effect.Effect<void, TransportError>;
}

export class Transport extends Context.Tag("@aiffect/Transport")<Transport, TransportShape>() {}
