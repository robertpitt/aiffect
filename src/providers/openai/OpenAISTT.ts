import { Config, Effect, Layer, Redacted, Stream } from "effect";
import { STT } from "../../framework/Provider.js";
import { ProviderError } from "../../framework/Errors.js";
import { TranscriptDelta } from "../../schemas/Events.js";
import type { AudioFrame } from "../../schemas/AudioFrame.js";

const OPENAI_TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";

export interface OpenAISTTOptions {
  readonly model?: string;
  readonly language?: string;
  /** Milliseconds of silence after speech to trigger transcription. */
  readonly silenceMs?: number;
  /** Minimum speech duration in ms before a segment is considered valid. */
  readonly minSpeechMs?: number;
  /** Normalised RMS energy threshold for speech detection (0–1). */
  readonly energyThreshold?: number;
}

function pcm16Rms(samples: Uint8Array): number {
  const view = new DataView(samples.buffer, samples.byteOffset, samples.byteLength);
  const count = samples.byteLength / 2;
  if (count === 0) return 0;
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const s = view.getInt16(i * 2, true);
    sum += s * s;
  }
  return Math.sqrt(sum / count) / 32768;
}

function writeStr(view: DataView, offset: number, s: string) {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}

function pcm16ToWav(frames: readonly AudioFrame[]): Uint8Array {
  if (frames.length === 0) return new Uint8Array(0);
  const first = frames[0]!;
  const sampleRate = first.sampleRate;
  const channels = first.channels;
  let totalBytes = 0;
  for (const f of frames) totalBytes += f.samples.byteLength;

  const wav = new Uint8Array(44 + totalBytes);
  const v = new DataView(wav.buffer);
  writeStr(v, 0, "RIFF");
  v.setUint32(4, 36 + totalBytes, true);
  writeStr(v, 8, "WAVE");
  writeStr(v, 12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  writeStr(v, 36, "data");
  v.setUint32(40, totalBytes, true);

  let off = 44;
  for (const f of frames) {
    wav.set(f.samples, off);
    off += f.samples.byteLength;
  }
  return wav;
}

interface VadState {
  readonly phase: "idle" | "speech" | "trailing";
  readonly buffer: readonly AudioFrame[];
  readonly speechStartTs: number;
  readonly silenceStartTs: number;
}

const INITIAL_VAD: VadState = {
  phase: "idle",
  buffer: [],
  speechStartTs: 0,
  silenceStartTs: 0,
};

export const make = (options?: OpenAISTTOptions) =>
  Layer.effect(
    STT,
    Effect.gen(function* () {
      const apiKey = yield* Config.redacted("OPENAI_API_KEY");
      const model = options?.model ?? "whisper-1";
      const language = options?.language ?? "en";
      const silenceMs = options?.silenceMs ?? 300;
      const minSpeechMs = options?.minSpeechMs ?? 200;
      const energyThreshold = options?.energyThreshold ?? 0.01;

      const transcribe: STT["Type"]["transcribe"] = (audio) =>
        audio.pipe(
          Stream.mapAccum<VadState, AudioFrame, readonly AudioFrame[] | null>(
            INITIAL_VAD,
            (state, frame) => {
              const energy = pcm16Rms(frame.samples);
              const ts = frame.timestamp;
              const loud = energy > energyThreshold;

              switch (state.phase) {
                case "idle":
                  if (loud) {
                    return [
                      { phase: "speech", buffer: [frame], speechStartTs: ts, silenceStartTs: 0 },
                      null,
                    ];
                  }
                  return [state, null];

                case "speech":
                  if (loud) {
                    return [{ ...state, buffer: [...state.buffer, frame] }, null];
                  }
                  return [
                    {
                      ...state,
                      phase: "trailing",
                      buffer: [...state.buffer, frame],
                      silenceStartTs: ts,
                    },
                    null,
                  ];

                case "trailing": {
                  if (loud) {
                    return [
                      {
                        ...state,
                        phase: "speech",
                        buffer: [...state.buffer, frame],
                        silenceStartTs: 0,
                      },
                      null,
                    ];
                  }
                  const silenceDur = ts - state.silenceStartTs;
                  const speechDur = state.silenceStartTs - state.speechStartTs;
                  if (silenceDur >= silenceMs && speechDur >= minSpeechMs) {
                    return [INITIAL_VAD, state.buffer];
                  }
                  return [{ ...state, buffer: [...state.buffer, frame] }, null];
                }
              }
            },
          ),
          Stream.filter(
            (segment): segment is readonly AudioFrame[] => segment != null && segment.length > 0,
          ),
          Stream.mapEffect((segment) =>
            Effect.gen(function* () {
              const wav = pcm16ToWav(segment);
              if (wav.byteLength <= 44) return null;

              const formData = new FormData();
              formData.append("file", new Blob([wav], { type: "audio/wav" }), "audio.wav");
              formData.append("model", model);
              formData.append("language", language);
              formData.append("response_format", "text");

              const response = yield* Effect.tryPromise({
                try: () =>
                  fetch(OPENAI_TRANSCRIPTION_URL, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${Redacted.value(apiKey)}` },
                    body: formData,
                  }),
                catch: (err) =>
                  new ProviderError({
                    provider: "OpenAI",
                    reason: `STT request failed: ${err}`,
                    cause: err,
                  }),
              });

              if (!response.ok) {
                const body = yield* Effect.tryPromise({
                  try: () => response.text(),
                  catch: () =>
                    new ProviderError({
                      provider: "OpenAI",
                      reason: "Failed to read STT error body",
                    }),
                });
                return yield* Effect.fail(
                  new ProviderError({
                    provider: "OpenAI",
                    reason: `STT ${response.status}: ${body}`,
                  }),
                );
              }

              const text = yield* Effect.tryPromise({
                try: () => response.text(),
                catch: (err) =>
                  new ProviderError({
                    provider: "OpenAI",
                    reason: `STT response read failed: ${err}`,
                    cause: err,
                  }),
              });

              return text.trim();
            }).pipe(Effect.withSpan("openai.stt.transcribe")),
          ),
          Stream.filter((t): t is string => t != null && t.length > 0),
          Stream.map(
            (text) =>
              new TranscriptDelta({
                role: "user",
                text,
                isFinal: true,
              }),
          ),
        );

      return { transcribe };
    }),
  );
