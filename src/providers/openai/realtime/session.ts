/**
 * OpenAI Realtime — build session.update payload from agent and context.
 */

import type { AgentContext, AgentSpec } from "../../../framework/Agent.js";
import type { OpenAIRealtimeOptions } from "./schema.js";

export function buildSessionUpdate(
  agent: AgentSpec,
  context: AgentContext,
  options?: OpenAIRealtimeOptions,
): Record<string, unknown> {
  const systemPrompt = agent.buildPrompt(context);
  const voice = options?.voice ?? "alloy";
  const tools = Object.values(agent.toolkit.tools).map((tool) => {
    const t = tool as {
      name?: string;
      description?: string;
      parametersJsonSchema?: Record<string, unknown>;
    };
    return {
      type: "function" as const,
      name: t.name ?? "unknown",
      description: t.description ?? "",
      parameters: t.parametersJsonSchema ?? {},
    };
  });

  const inputAudioFormat = options?.inputAudioFormat ?? "pcm16";
  const outputAudioFormat = options?.outputAudioFormat ?? "pcm16";
  const transcriptionModel = options?.transcriptionModel ?? "whisper-1";
  const transcription: Record<string, unknown> = { model: transcriptionModel };
  if (options?.transcriptionLanguage != null) {
    transcription.language = options.transcriptionLanguage;
  }

  const session: Record<string, unknown> = {
    modalities: ["text", "audio"],
    instructions: systemPrompt,
    voice,
    input_audio_format: inputAudioFormat,
    output_audio_format: outputAudioFormat,
    tools,
    input_audio_transcription: transcription,
  };

  if (options?.turnDetection != null) {
    const td = options.turnDetection;
    session.turn_detection = {
      ...(td.threshold != null && { threshold: td.threshold }),
      ...(td.prefixPaddingMs != null && { prefix_padding_ms: td.prefixPaddingMs }),
      ...(td.silenceDurationMs != null && { silence_duration_ms: td.silenceDurationMs }),
      ...(td.createResponse != null && { create_response: td.createResponse }),
      ...(td.interruptResponse != null && { interrupt_response: td.interruptResponse }),
    };
  }

  if (options?.noiseReduction === true) {
    session.input_audio_noise_reduction = true;
  }

  if (options?.speed != null) {
    session.voice_speed = options.speed;
  }

  return { type: "session.update", session };
}
