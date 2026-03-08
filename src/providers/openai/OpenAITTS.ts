import { Config, Effect, Layer, Redacted, Stream } from "effect";
import { TTS } from "@/core/Provider.js";
import { ProviderError } from "@/core/Errors.js";
import { AudioFrame } from "@/core/AudioFrame.js";

const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";
const OUTPUT_SAMPLE_RATE = 24000;
const FRAME_DURATION_MS = 20;
const FRAME_SIZE_BYTES = OUTPUT_SAMPLE_RATE * (FRAME_DURATION_MS / 1000) * 2; // 960

export interface OpenAITTSOptions {
  readonly model?: string;
  readonly voice?: string;
  readonly speed?: number;
}

async function* readPcmFrames(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<AudioFrame> {
  let leftover = new Uint8Array(0);

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      if (leftover.byteLength > 0) {
        const padded = new Uint8Array(FRAME_SIZE_BYTES);
        padded.set(leftover);
        yield new AudioFrame({
          samples: padded,
          sampleRate: OUTPUT_SAMPLE_RATE,
          channels: 1,
          timestamp: Date.now(),
        });
      }
      return;
    }

    const combined = new Uint8Array(leftover.byteLength + value.byteLength);
    combined.set(leftover, 0);
    combined.set(value, leftover.byteLength);

    let offset = 0;
    while (offset + FRAME_SIZE_BYTES <= combined.byteLength) {
      yield new AudioFrame({
        samples: combined.slice(offset, offset + FRAME_SIZE_BYTES),
        sampleRate: OUTPUT_SAMPLE_RATE,
        channels: 1,
        timestamp: Date.now(),
      });
      offset += FRAME_SIZE_BYTES;
    }
    leftover = combined.slice(offset);
  }
}

export const make = (options?: OpenAITTSOptions) =>
  Layer.effect(
    TTS,
    Effect.gen(function* () {
      const apiKey = yield* Config.redacted("OPENAI_API_KEY");
      const model = options?.model ?? "tts-1";
      const voice = options?.voice ?? "alloy";
      const speed = options?.speed ?? 1.0;

      const synthesize: TTS["Service"]["synthesize"] = (text) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const response = yield* Effect.tryPromise({
              try: () =>
                fetch(OPENAI_TTS_URL, {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${Redacted.value(apiKey)}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    model,
                    input: text,
                    voice,
                    speed,
                    response_format: "pcm",
                  }),
                }),
              catch: (err) =>
                new ProviderError({
                  provider: "OpenAI",
                  reason: `TTS request failed: ${err}`,
                  cause: err,
                }),
            });

            if (!response.ok || !response.body) {
              const body = yield* Effect.tryPromise({
                try: () => response.text(),
                catch: () =>
                  new ProviderError({
                    provider: "OpenAI",
                    reason: "Failed to read TTS error body",
                  }),
              });
              return Stream.fail(
                new ProviderError({
                  provider: "OpenAI",
                  reason: `TTS ${response.status}: ${body}`,
                }),
              );
            }

            return Stream.fromAsyncIterable(
              readPcmFrames(response.body.getReader()),
              (err) =>
                new ProviderError({
                  provider: "OpenAI",
                  reason: `TTS stream error: ${err}`,
                  cause: err,
                }),
            );
          }).pipe(Effect.withSpan("openai.tts.synthesize")),
        );

      return { synthesize };
    }),
  );
