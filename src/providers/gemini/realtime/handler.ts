/**
 * Gemini Live Realtime — pure message handler: server message + state → actions + next state.
 */

import { AudioFrame } from "../../../schemas/AudioFrame.js";
import {
  TranscriptDelta,
  SpeechStarted,
  ToolCallStarted,
  ResponseStarted,
  ResponseCompleted,
  AudioOutputStarted,
  AudioOutputDone,
} from "../../../schemas/Events.js";
import type { RealtimeAction } from "../../../framework/RealtimeTypes.js";
import {
  CHANNELS,
  DEFAULT_SAMPLE_RATE,
  type GeminiServerMessage,
  type GeminiHandlerState,
} from "./types.js";

export type { GeminiHandlerState } from "./types.js";
export { initialGeminiHandlerState } from "./types.js";

function parsePcmSampleRate(mimeType: string | undefined): number {
  if (!mimeType) return DEFAULT_SAMPLE_RATE;
  const match = /;\s*rate=(\d+)/i.exec(mimeType);
  return match ? Number(match[1]) : DEFAULT_SAMPLE_RATE;
}

function getTextFromTranscription(obj: { readonly text?: string } | undefined): string | undefined {
  if (!obj) return undefined;
  const t = obj.text;
  return typeof t === "string" ? t.trim().replace(/\n/g, "") : undefined;
}

export function handleGeminiMessage(
  msg: GeminiServerMessage,
  state: GeminiHandlerState,
): { actions: RealtimeAction[]; nextState: GeminiHandlerState } {
  const actions: RealtimeAction[] = [];
  const ts = Date.now();
  let nextState = { ...state };

  if (msg.setupComplete !== undefined) {
    actions.push({ _tag: "SessionReady" });
  }

  if (msg.serverContent) {
    const content = msg.serverContent;

    if (content.interrupted === true) {
      actions.push({ _tag: "Event", event: new SpeechStarted({ timestamp: ts }) });
      if (nextState.responseActive && nextState.responseId) {
        actions.push({
          _tag: "Event",
          event: new AudioOutputDone({
            responseId: nextState.responseId,
            timestamp: ts,
            frames: nextState.audioFrameCount,
          }),
        });
        actions.push({
          _tag: "Event",
          event: new ResponseCompleted({
            responseId: nextState.responseId,
            timestamp: ts,
            status: "cancelled",
            outputTokens: 0,
            audioFrames: nextState.audioFrameCount,
          }),
        });
      }
      nextState = { ...nextState, responseActive: false, responseId: null, audioFrameCount: 0 };
    }

    const inputText = getTextFromTranscription(content.inputTranscription);
    if (inputText) {
      actions.push({
        _tag: "Event",
        event: new TranscriptDelta({ role: "user", text: inputText, isFinal: true }),
      });
    }
    const outputText = getTextFromTranscription(content.outputTranscription);
    if (outputText) {
      actions.push({
        _tag: "Event",
        event: new TranscriptDelta({ role: "assistant", text: outputText, isFinal: true }),
      });
    }

    if (!content.interrupted && content.modelTurn?.parts) {
      const parts = content.modelTurn.parts;
      for (const part of parts) {
        const inlineData = part.inlineData;
        if (
          !inlineData?.data ||
          typeof inlineData.data !== "string" ||
          !inlineData.mimeType?.startsWith("audio/pcm")
        )
          continue;
        try {
          const buf = Buffer.from(inlineData.data, "base64");
          const sampleRate = parsePcmSampleRate(inlineData.mimeType);

          if (!nextState.responseActive) {
            const rid = `gemini-resp-${nextState.responseIndex + 1}`;
            nextState = {
              ...nextState,
              responseActive: true,
              responseId: rid,
              audioFrameCount: 0,
              responseIndex: nextState.responseIndex + 1,
            };
            actions.push({
              _tag: "Event",
              event: new ResponseStarted({ responseId: rid, timestamp: ts }),
            });
            actions.push({
              _tag: "Event",
              event: new AudioOutputStarted({ responseId: rid, timestamp: ts }),
            });
          }
          // Buffer extends Uint8Array; use directly to avoid extra copy
          actions.push({
            _tag: "AudioFrame",
            frame: new AudioFrame({
              samples: buf,
              sampleRate,
              channels: CHANNELS,
              timestamp: ts,
            }),
          });
          nextState = { ...nextState, audioFrameCount: nextState.audioFrameCount + 1 };
        } catch {
          // skip invalid audio
        }
      }
    }

    if (content.turnComplete && nextState.responseActive && nextState.responseId) {
      actions.push({
        _tag: "Event",
        event: new AudioOutputDone({
          responseId: nextState.responseId,
          timestamp: ts,
          frames: nextState.audioFrameCount,
        }),
      });
      actions.push({
        _tag: "Event",
        event: new ResponseCompleted({
          responseId: nextState.responseId,
          timestamp: ts,
          status: "completed",
          outputTokens: 0,
          audioFrames: nextState.audioFrameCount,
        }),
      });
      nextState = { ...nextState, responseActive: false, responseId: null, audioFrameCount: 0 };
    }
  }

  if (msg.toolCall?.functionCalls?.length) {
    for (const fc of msg.toolCall.functionCalls) {
      if (fc.id && fc.name) {
        actions.push({
          _tag: "Event",
          event: new ToolCallStarted({
            callId: fc.id,
            name: fc.name,
            arguments:
              typeof fc.args === "object" && fc.args !== null ? JSON.stringify(fc.args) : "{}",
          }),
        });
      }
    }
  }

  if (actions.length === 0) actions.push({ _tag: "Ignored" });
  return { actions, nextState };
}
