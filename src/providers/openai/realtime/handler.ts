/**
 * OpenAI Realtime — pure message handler: server message + state → actions + next state.
 */

import { AudioFrame } from "@/core/AudioFrame.js";
import {
  TranscriptDelta,
  SpeechStarted,
  SpeechEnded,
  ToolCallStarted,
  ResponseStarted,
  ResponseCompleted,
  AudioOutputStarted,
  AudioOutputDone,
} from "@/core/Events.js";
import type { RealtimeAction } from "@/core/RealtimeTypes.js";
import type { OpenAIHandlerState, OpenAIServerMessage } from "@/providers/openai/realtime/schema.js";

const SAMPLE_RATE = 24000;
const CHANNELS = 1;

export function handleOpenAIMessage(
  msg: OpenAIServerMessage,
  state: OpenAIHandlerState,
): { actions: RealtimeAction[]; nextState: OpenAIHandlerState } {
  const timestamp = Date.now();

  /**
   * Response Audio Delta Event
   */
  if (msg.type === "response.audio.delta") {
    const delta = msg.delta;
    const pcm = typeof delta === "string" ? Buffer.from(delta, "base64") : new Uint8Array(0);
    const frame = new AudioFrame({
      samples: pcm,
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      timestamp,
    });
    const isFirst = state.responseAudioFrames === 0;
    const nextState: OpenAIHandlerState = {
      ...state,
      responseAudioFrames: state.responseAudioFrames + 1,
    };
    const actions: RealtimeAction[] = [
      ...(isFirst && state.currentResponseId
        ? [
            {
              _tag: "Event" as const,
              event: new AudioOutputStarted({
                responseId: state.currentResponseId,
                timestamp,
              }),
            },
          ]
        : []),
      { _tag: "AudioFrame" as const, frame },
    ];
    return { actions, nextState };
  }

  /**
   * Response Audio Transcript Delta Event
   */
  if (msg.type === "response.audio_transcript.delta") {
    const text = msg.delta ?? "";
    return {
      actions: [
        { _tag: "Event", event: new TranscriptDelta({ role: "assistant", text, isFinal: false }) },
      ],
      nextState: state,
    };
  }

  /**
   * Response Created Event
   */
  if (msg.type === "response.created") {
    const responseId = msg.response?.id;
    return {
      actions: responseId
        ? [{ _tag: "Event", event: new ResponseStarted({ responseId, timestamp }) }]
        : [{ _tag: "Ignored" }],
      nextState: {
        ...state,
        currentResponseId: responseId ?? state.currentResponseId,
        responseAudioFrames: 0,
      },
    };
  }

  /**
   * Response Done Event
   */
  if (msg.type === "response.done") {
    const rid = msg.response?.id ?? state.currentResponseId;
    const usage = msg.response?.usage;
    const event = rid
      ? new ResponseCompleted({
          responseId: rid,
          timestamp,
          status: msg.response?.status ?? "completed",
          inputTokens: usage?.input_tokens ?? 0,
          outputTokens: usage?.output_tokens ?? 0,
          audioFrames: state.responseAudioFrames,
        })
      : undefined;

    return {
      actions: event ? [{ _tag: "Event", event }] : [{ _tag: "Ignored" }],
      nextState: { ...state, currentResponseId: null },
    };
  }

  /**
   * Response Audio Done Event
   */
  if (msg.type === "response.audio.done") {
    const responseId = state.currentResponseId;
    const frames = state.responseAudioFrames;
    return {
      actions: responseId
        ? [{ _tag: "Event", event: new AudioOutputDone({ responseId, timestamp, frames }) }]
        : [{ _tag: "Ignored" }],
      nextState: state,
    };
  }

  /**
   * Speech Started/Stopped Event
   */
  if (msg.type === "input_audio_buffer.speech_started") {
    return {
      actions: [{ _tag: "Event", event: new SpeechStarted({ timestamp }) }],
      nextState: state,
    };
  }

  if (msg.type === "input_audio_buffer.speech_stopped") {
    return {
      actions: [{ _tag: "Event", event: new SpeechEnded({ timestamp }) }],
      nextState: state,
    };
  }

  /**
   * Response Audio Transcript Done Event
   */
  if (msg.type === "response.audio_transcript.done") {
    const text = msg.transcript ?? "";
    return {
      actions: [
        { _tag: "Event", event: new TranscriptDelta({ role: "assistant", text, isFinal: true }) },
      ],
      nextState: state,
    };
  }

  /**
   * Conversation Item Input Audio Transcription Completed Event
   */
  if (msg.type === "conversation.item.input_audio_transcription.completed") {
    const text = msg.transcript ?? "";
    return {
      actions: [
        { _tag: "Event", event: new TranscriptDelta({ role: "user", text, isFinal: true }) },
      ],
      nextState: state,
    };
  }

  /**
   * Response Function Call Arguments Done Event
   */
  if (msg.type === "response.function_call_arguments.done") {
    const callId = msg.call_id ?? "";
    const name = msg.name ?? "";
    const args = msg.arguments ?? "{}";
    return {
      actions: [{ _tag: "Event", event: new ToolCallStarted({ callId, name, arguments: args }) }],
      nextState: state,
    };
  }

  /**
   * Response Output Item Added Event
   */
  if (msg.type === "response.output_item.added") {
    const item = msg.item;
    return {
      actions: [{ _tag: "Ignored" }],
      nextState:
        item?.type === "message" && item?.role === "assistant"
          ? { ...state, currentItemId: item.id ?? state.currentItemId, currentContentIndex: 0 }
          : state,
    };
  }

  /**
   * Session Created Event
   */
  if (msg.type === "session.created") {
    return { actions: [{ _tag: "SessionReady" }], nextState: state };
  }

  /**
   * Session Updated Event
   */
  if (msg.type === "session.updated") {
    return { actions: [{ _tag: "Ignored" }], nextState: state };
  }

  // Ignore everything else
  return { actions: [{ _tag: "Ignored" }], nextState: state };
}
