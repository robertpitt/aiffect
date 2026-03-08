/**
 * OpenAI Realtime — thin adapter over the shared RealtimeKernel.
 */

import { Config, Effect, Queue, Redacted, Ref } from "effect";
import WS from "ws";
import type { AgentContext, AgentSpec } from "../../../core/Agent.js";
import { ProviderError } from "../../../core/Errors.js";
import { Interrupted } from "../../../core/Events.js";
import { serializeToolOutput } from "../../../internal/serializeToolOutput.js";
import { make as makeMessageSocket } from "../../../internal/MessageSocket.js";
import {
  makeRealtimeLayer,
  type RealtimeAdapter,
} from "../../RealtimeKernel.js";
import { handleOpenAIMessage } from "./handler.js";
import {
  OpenAIServerMessageSchema,
  initialOpenAIHandlerState,
  type OpenAIRealtimeOptions,
  type OpenAIServerMessage,
  type OpenAIHandlerState,
} from "./schema.js";

const OPENAI_REALTIME_URL = "https://api.openai.com/v1/realtime";

function buildSessionUpdate(
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
      ...(td.prefixPaddingMs != null && {
        prefix_padding_ms: td.prefixPaddingMs,
      }),
      ...(td.silenceDurationMs != null && {
        silence_duration_ms: td.silenceDurationMs,
      }),
      ...(td.createResponse != null && {
        create_response: td.createResponse,
      }),
      ...(td.interruptResponse != null && {
        interrupt_response: td.interruptResponse,
      }),
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

function openAIAdapter(
  options?: OpenAIRealtimeOptions,
): RealtimeAdapter<OpenAIServerMessage, OpenAIHandlerState> {
  return {
    name: "OpenAI",
    initialState: initialOpenAIHandlerState,
    schema: OpenAIServerMessageSchema,
    bufferSendUntilReady: options?.bufferInputUntilReady === true,

    connect: (agent, ctx) =>
      Effect.gen(function* () {
        const apiKey = yield* Config.redacted("OPENAI_API_KEY").pipe(
          Effect.mapError(
            (e) =>
              new ProviderError({
                provider: "OpenAI",
                reason: "Missing or invalid OPENAI_API_KEY",
                cause: e,
              }),
          ),
        );
        const model = options?.model ?? "gpt-4o-realtime-preview";
        const ws = yield* Effect.async<InstanceType<typeof WS>, ProviderError>((resume) => {
          const socket = new WS(`${OPENAI_REALTIME_URL}?model=${model}`, {
            headers: {
              Authorization: `Bearer ${Redacted.value(apiKey)}`,
              "OpenAI-Beta": "realtime=v1",
            },
          });
          socket.on("open", () => resume(Effect.succeed(socket)));
          socket.on("error", (err) =>
            resume(
              Effect.fail(
                new ProviderError({
                  provider: "OpenAI",
                  reason: `WebSocket connection failed: ${err.message}`,
                  cause: err,
                }),
              ),
            ),
          );
        });
        ws.send(JSON.stringify(buildSessionUpdate(agent, ctx, options)));
        return yield* makeMessageSocket(ws as any, { provider: "OpenAI" });
      }),

    handler: handleOpenAIMessage,

    onSessionReady: options?.startWithResponseCreate
      ? (socket) => socket.send({ type: "response.create" })
      : undefined,

    onInterrupt: (ctx) =>
      Effect.gen(function* () {
        const state = yield* Ref.get(ctx.stateRef);
        if (state.currentResponseId != null) {
          yield* ctx.socket.send({ type: "response.cancel" });
        }
        if (state.currentItemId != null && ctx.playedAudioMs !== undefined) {
          yield* ctx.socket.send({
            type: "conversation.item.truncate",
            item_id: state.currentItemId,
            content_index: state.currentContentIndex,
            audio_end_ms: Math.round(ctx.playedAudioMs),
          });
        }
        yield* Queue.takeAll(ctx.audioQueue);
        yield* Ref.set(ctx.stateRef, {
          ...initialOpenAIHandlerState,
          currentResponseId: null,
          currentItemId: null,
          responseAudioFrames: 0,
        });
        yield* Queue.offer(
          ctx.eventQueue,
          new Interrupted({ timestamp: Date.now() }),
        );
      }),

    encodeSend: (frame) => ({
      type: "input_audio_buffer.append",
      audio:
        frame.samples instanceof Buffer
          ? frame.samples.toString("base64")
          : Buffer.from(frame.samples).toString("base64"),
    }),

    encodeToolOutput: (callId, _name, output) => ({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: serializeToolOutput(output),
      },
    }),

    encodeRequestResponse: () => ({ type: "response.create" }),
  };
}

export function make(options?: OpenAIRealtimeOptions) {
  return makeRealtimeLayer(openAIAdapter(options));
}
