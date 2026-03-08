/**
 * Gemini Live Realtime — thin adapter over the shared RealtimeKernel.
 */

import { Config, Effect, Queue, Redacted } from "effect";
import WS from "ws";
import type { AgentContextShape } from "@/core/AgentContext.js";
import type { SessionContextShape } from "@/core/SessionContext.js";
import type { AgentSpec } from "@/core/Agent.js";
import { ProviderError } from "@/core/Errors.js";
import { Interrupted } from "@/core/Events.js";
import { mergeProviderOptions } from "@/internal/mergeProviderOptions.js";
import { serializeToolOutput } from "@/internal/serializeToolOutput.js";
import { make as makeMessageSocket } from "@/internal/MessageSocket.js";
import {
  makeRealtimeLayer,
  type RealtimeAdapter,
} from "@/providers/RealtimeKernel.js";
import { handleGeminiMessage } from "@/providers/gemini/realtime/handler.js";
import {
  GeminiServerMessageSchema,
  initialGeminiHandlerState,
  type GeminiRealtimeOptions,
  type GeminiServerMessage,
  type GeminiHandlerState,
} from "@/providers/gemini/realtime/schema.js";

const GEMINI_LIVE_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const GEMINI_AUDIO_MIME = "audio/pcm;rate=24000";
const DEFAULT_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

function sanitizeParametersForGemini(
  params: Record<string, unknown>,
): Record<string, unknown> {
  const omit = new Set(["strict", "additionalProperties"]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (omit.has(k)) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (k === "properties" && v !== null && typeof v === "object") {
        const sanitized: Record<string, unknown> = {};
        for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
          sanitized[pk] =
            pv && typeof pv === "object" && !Array.isArray(pv)
              ? sanitizeParametersForGemini(pv as Record<string, unknown>)
              : pv;
        }
        out[k] = sanitized;
      } else if (k === "items" && v !== null && typeof v === "object") {
        out[k] = sanitizeParametersForGemini(v as Record<string, unknown>);
      } else {
        out[k] = v;
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}

function buildSessionSetup(
  agent: AgentSpec,
  agentContext: AgentContextShape,
  sessionContext: SessionContextShape,
  options?: GeminiRealtimeOptions,
) {
  const systemPrompt = agent.buildPrompt(agentContext, sessionContext);
  const model = options?.model ?? DEFAULT_MODEL;
  const voice = options?.voice ?? "Puck";
  const modelName = model.startsWith("models/") ? model : `models/${model}`;
  const tools = Object.values(agent.toolkit.tools).map((tool) => {
    const t = tool as {
      name?: string;
      description?: string;
      parametersJsonSchema?: Record<string, unknown>;
    };
    const params = t.parametersJsonSchema ?? {};
    return {
      name: t.name ?? "unknown",
      description: t.description ?? "",
      parameters: sanitizeParametersForGemini(
        typeof params === "object" && params !== null ? params : {},
      ),
    };
  });
  return {
    model: modelName,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: voice
        ? { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
        : undefined,
    },
    systemInstruction: { role: "user", parts: [{ text: systemPrompt }] },
    tools:
      tools.length > 0 ? [{ functionDeclarations: tools }] : undefined,
    realtimeInputConfig: {},
    outputAudioTranscription: {},
  };
}

function geminiAdapter(
  options?: GeminiRealtimeOptions,
): RealtimeAdapter<GeminiServerMessage, GeminiHandlerState> {
  return {
    name: "Gemini",
    initialState: initialGeminiHandlerState,
    schema: GeminiServerMessageSchema,

    connect: (agent, agentContext, sessionContext) =>
      Effect.gen(function* () {
        const effectiveOptions = mergeProviderOptions(
          (options ?? {}) as Record<string, unknown>,
          sessionContext.providerOptions,
        ) as GeminiRealtimeOptions;
        const apiKey = yield* Effect.gen(function* () {
          return yield* Config.redacted("GEMINI_API_KEY");
        }).pipe(
          Effect.catch(() => Effect.gen(function* () {
            return yield* Config.redacted("GOOGLE_API_KEY");
          })),
          Effect.mapError(
            (e) =>
              new ProviderError({
                provider: "Gemini",
                reason:
                  "Missing or invalid GEMINI_API_KEY / GOOGLE_API_KEY",
                cause: e,
              }),
          ),
        );
        const url = `${GEMINI_LIVE_WS_URL}?key=${encodeURIComponent(Redacted.value(apiKey))}`;
        const ws = yield* Effect.callback<InstanceType<typeof WS>, ProviderError>(
          (resume, _signal) => {
            const socket = new WS(url);
            socket.on("open", () => resume(Effect.succeed(socket)));
            socket.on("error", (err) =>
              resume(
                Effect.fail(
                  new ProviderError({
                    provider: "Gemini",
                    reason: `WebSocket connection failed: ${err.message}`,
                    cause: err,
                  }),
                ),
              ),
            );
          },
        );
        ws.send(
          JSON.stringify({
            setup: buildSessionSetup(agent, agentContext, sessionContext, effectiveOptions),
          }),
        );
        return yield* makeMessageSocket(ws as any, { provider: "Gemini" });
      }),

    handler: handleGeminiMessage,

    onSessionReady: (socket) =>
      socket.send({
        clientContent: {
          turns: {
            role: "user",
            parts: [{ text: "Say your greeting." }],
          },
          turnComplete: true,
        },
      }),

    onInterrupt: (ctx) =>
      Effect.gen(function* () {
        yield* Queue.takeAll(ctx.audioQueue);
        yield* Queue.offer(
          ctx.eventQueue,
          new Interrupted({ timestamp: Date.now() }),
        );
      }),

    encodeSend: (frame) => ({
      realtimeInput: {
        audio: {
          mimeType: GEMINI_AUDIO_MIME,
          data:
            frame.samples instanceof Buffer
              ? frame.samples.toString("base64")
              : Buffer.from(frame.samples).toString("base64"),
        },
      },
    }),

    encodeToolOutput: (callId, name, output) => ({
      toolResponse: {
        functionResponses: [
          {
            id: callId,
            name,
            response: { result: serializeToolOutput(output) },
          },
        ],
      },
    }),
  };
}

export function make(options?: GeminiRealtimeOptions) {
  return makeRealtimeLayer(geminiAdapter(options));
}
