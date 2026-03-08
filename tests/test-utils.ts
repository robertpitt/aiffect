/**
 * Test utilities for pipeline tests. Simple, inline-friendly APIs.
 * Import from here and use directly in test files.
 */

import { Effect, Layer, Queue, Stream } from "effect";
import {
  TTS,
  STT,
  Realtime,
  Transport,
  TransportError,
  ProviderError,
  AudioFrame,
  TranscriptDelta,
  type PipelineEvent,
} from "@/index.js";
import { LanguageModel, Response } from "effect/unstable/ai";

const SAMPLE_RATE = 24000;
const FRAME_DURATION_MS = 20;
const FRAME_SIZE_BYTES = SAMPLE_RATE * (FRAME_DURATION_MS / 1000) * 2;

/** Create a dummy audio frame for tests. */
export const testFrame = (): AudioFrame =>
  new AudioFrame({
    samples: new Uint8Array(FRAME_SIZE_BYTES),
    sampleRate: SAMPLE_RATE,
    channels: 1,
    timestamp: Date.now(),
  });

/** Mock STT: emits transcript on first audio frame. */
export const testSTT = (transcript = "Hello"): Layer.Layer<STT> =>
  Layer.succeed(STT, {
    transcribe: <E>(audio: Stream.Stream<AudioFrame, E>) =>
      audio.pipe(
        Stream.take(1),
        Stream.map(
          () =>
            new TranscriptDelta({
              role: "user",
              text: transcript,
              isFinal: true,
            }),
        ),
      ),
  });

/** Mock TTS: returns dummy PCM16 frames. */
export const testTTS = (frames = 5): Layer.Layer<TTS> =>
  Layer.succeed(TTS, {
    synthesize: (text: string) =>
      Stream.fromIterable(Array.from({ length: frames }, (_, i) => i)).pipe(
        Stream.map(
          (i) =>
            new AudioFrame({
              samples: new Uint8Array(FRAME_SIZE_BYTES),
              sampleRate: SAMPLE_RATE,
              channels: 1,
              timestamp: Date.now() + i * FRAME_DURATION_MS,
            }),
        ),
      ),
  });

/** Mock LanguageModel: returns fixed text. */
export const testLanguageModel = (
  responseText = "Hello! How can I help you today?",
): Layer.Layer<LanguageModel.LanguageModel> => {
  const content = [
    Response.makePart("text", { text: responseText }),
    Response.makePart("finish", {
      reason: "stop" as const,
      usage: new Response.Usage({
        inputTokens: {
          uncached: undefined,
          total: 10,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 8, text: undefined, reasoning: undefined },
      }),
      response: undefined,
    }),
  ];
  const mockResponse = new LanguageModel.GenerateTextResponse(content as any);
  return Layer.succeed(LanguageModel.LanguageModel, {
    generateText: () => Effect.succeed(mockResponse as any),
    generateObject: () => Effect.die("testLanguageModel.generateObject not implemented"),
    streamText: () =>
      Stream.succeed(Response.makePart("text", { text: responseText }) as any).pipe(
        Stream.concat(
          Stream.succeed(
            Response.makePart("finish", {
              reason: "stop" as const,
              usage: new Response.Usage({
                inputTokens: {
                  uncached: undefined,
                  total: 10,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: { total: 8, text: undefined, reasoning: undefined },
              }),
              response: undefined,
            }) as any,
          ),
        ),
      ),
  } as LanguageModel.Service);
};

export interface TestTransport {
  readonly layer: Layer.Layer<Transport>;
  readonly inboundQueue: Queue.Queue<AudioFrame>;
  readonly outboundQueue: Queue.Queue<AudioFrame>;
  readonly clearCountRef: { current: number };
}

/** In-memory transport: push to inboundQueue, read from outboundQueue. */
export const testTransport = (): Effect.Effect<TestTransport> =>
  Effect.gen(function* () {
    const inboundQueue = yield* Queue.unbounded<AudioFrame>();
    const outboundQueue = yield* Queue.unbounded<AudioFrame>();
    const clearCountRef = { current: 0 };
    const layer = Layer.effect(
      Transport,
      Effect.acquireRelease(
        Effect.sync(() => ({
          inbound: Stream.fromQueue(inboundQueue).pipe(
            Stream.catch(() => Stream.fail(new TransportError({ reason: "TestTransport closed" }))),
          ),
          send: (frame: AudioFrame) => Queue.offer(outboundQueue, frame),
          clear: Effect.sync(() => {
            clearCountRef.current += 1;
          }),
        })),
        () =>
          Effect.gen(function* () {
            yield* Queue.shutdown(inboundQueue);
            yield* Queue.shutdown(outboundQueue);
          }),
      ),
    );
    return { layer, inboundQueue, outboundQueue, clearCountRef };
  });

export interface TestRealtime {
  readonly layer: Layer.Layer<Realtime>;
  readonly pushReceiveFrame: (frame: AudioFrame) => Effect.Effect<void>;
  readonly pushEvent: (event: PipelineEvent) => Effect.Effect<void>;
  readonly getSentFrames: Effect.Effect<readonly AudioFrame[]>;
  readonly shutdown: Effect.Effect<void>;
}

/** In-memory Realtime provider: control receive/events, capture sent frames. */
export const testRealtime = (): Effect.Effect<TestRealtime> =>
  Effect.gen(function* () {
    const sentFramesRef = { current: [] as AudioFrame[] };
    const receiveQueue = yield* Queue.unbounded<AudioFrame>();
    const eventsQueue = yield* Queue.unbounded<PipelineEvent>();
    const layer = Layer.effect(
      Realtime,
      Effect.acquireRelease(
        Effect.sync(() => ({
          send: (frame: AudioFrame) =>
            Effect.sync(() => {
              sentFramesRef.current = [...sentFramesRef.current, frame];
            }),
          receive: Stream.fromQueue(receiveQueue).pipe(
            Stream.catch(() =>
              Stream.fail(
                new ProviderError({ provider: "TestRealtime", reason: "receive closed" }),
              ),
            ),
          ),
          events: Stream.fromQueue(eventsQueue).pipe(
            Stream.catch(() =>
              Stream.fail(new ProviderError({ provider: "TestRealtime", reason: "events closed" })),
            ),
          ),
          interrupt: () => Effect.void,
          submitToolOutput: () => Effect.void,
          requestResponse: () => Effect.void,
        })),
        () =>
          Effect.gen(function* () {
            yield* Queue.shutdown(receiveQueue);
            yield* Queue.shutdown(eventsQueue);
          }),
      ),
    );
    return {
      layer,
      pushReceiveFrame: (frame: AudioFrame) => Queue.offer(receiveQueue, frame),
      pushEvent: (event: PipelineEvent) => Queue.offer(eventsQueue, event),
      getSentFrames: Effect.sync(() => sentFramesRef.current),
      shutdown: Queue.shutdown(receiveQueue).pipe(
        Effect.flatMap(() => Queue.shutdown(eventsQueue)),
      ),
    };
  });
