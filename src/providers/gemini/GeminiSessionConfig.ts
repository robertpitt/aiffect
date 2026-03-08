import type { AgentSpec, AgentContext } from "../../framework/Agent.js";
import type { GeminiSetup } from "./realtime/session.js";

const GEMINI_AUDIO_MIME = "audio/pcm;rate=24000";

export interface GeminiFunctionDeclaration {
  readonly name: string;
  readonly description: string;
  readonly parameters?: Record<string, unknown>;
}

export interface GeminiSpeechConfig {
  readonly voiceConfig?: { prebuiltVoiceConfig?: { voiceName?: string } };
}
const DEFAULT_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

export interface GeminiSessionConfigOptions {
  readonly model?: string;
  readonly voice?: string;
}

/** Strip JSON Schema fields Gemini doesn't accept (e.g. strict, additionalProperties). */
function sanitizeParametersForGemini(params: Record<string, unknown>): Record<string, unknown> {
  const omit = new Set(["strict", "additionalProperties"]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (omit.has(k)) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (k === "properties" && v !== null && typeof v === "object") {
        const sanitized: Record<string, unknown> = {};
        for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
          if (pv && typeof pv === "object" && !Array.isArray(pv)) {
            sanitized[pk] = sanitizeParametersForGemini(pv as Record<string, unknown>);
          } else {
            sanitized[pk] = pv;
          }
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

function mapToolsToGemini(agent: AgentSpec): GeminiFunctionDeclaration[] {
  return Object.values(agent.toolkit.tools).map((tool) => {
    const t = tool as {
      name?: string;
      description?: string;
      parameters?: Record<string, unknown>;
      parametersJsonSchema?: Record<string, unknown>;
    };
    const params = t.parametersJsonSchema ?? t.parameters ?? {};
    return {
      name: t.name ?? "unknown",
      description: t.description ?? "",
      parameters: sanitizeParametersForGemini(
        typeof params === "object" && params !== null ? params : {},
      ) as GeminiFunctionDeclaration["parameters"],
    };
  });
}

/**
 * Build the setup payload for the Gemini Live API.
 * System instruction is sent as Content (role + parts) per API requirements.
 */
export function buildGeminiSetup(
  agent: AgentSpec,
  context: AgentContext,
  options?: GeminiSessionConfigOptions,
): GeminiSetup {
  const systemPrompt = agent.buildPrompt(context);
  const model = options?.model ?? DEFAULT_MODEL;
  const voice = options?.voice ?? "Puck";
  const modelName = model.startsWith("models/") ? model : `models/${model}`;
  const tools = mapToolsToGemini(agent);

  const speechConfig: GeminiSpeechConfig | undefined = voice
    ? { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
    : undefined;

  return {
    model: modelName,
    generationConfig: { responseModalities: ["AUDIO"], speechConfig },
    systemInstruction: {
      role: "user",
      parts: [{ text: systemPrompt }],
    },
    tools: tools.length > 0 ? [{ functionDeclarations: tools }] : undefined,
    realtimeInputConfig: {},
    outputAudioTranscription: {},
  };
}

export { GEMINI_AUDIO_MIME };
