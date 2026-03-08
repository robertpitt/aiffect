/**
 * Gemini Live Realtime — build setup payload from agent and context.
 */

import type { AgentContext, AgentSpec } from "../../../framework/Agent.js";
import { DEFAULT_MODEL, type GeminiRealtimeOptions } from "./types.js";

export interface GeminiSetup {
  readonly model: string;
  readonly generationConfig?: unknown;
  readonly systemInstruction?: unknown;
  readonly tools?: unknown[];
  readonly realtimeInputConfig?: unknown;
  readonly outputAudioTranscription?: unknown;
}

function sanitizeParametersForGemini(params: Record<string, unknown>): Record<string, unknown> {
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

export function buildSessionSetup(
  agent: AgentSpec,
  context: AgentContext,
  options?: GeminiRealtimeOptions,
): GeminiSetup {
  const systemPrompt = agent.buildPrompt(context);
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
    tools: tools.length > 0 ? [{ functionDeclarations: tools }] : undefined,
    realtimeInputConfig: {},
    outputAudioTranscription: {},
  };
}
