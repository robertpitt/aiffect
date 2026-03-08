import { Effect } from "effect";
import type { PipelineEvent } from "../schemas/Events.js";

/**
 * Returns an Effect that logs a pipeline event with structured attributes.
 *
 * Transcript deltas are filtered to only emit final transcripts — per-token
 * deltas are suppressed to keep the trace clean. All events carry an `event`
 * annotation matching the schema tag so the trace exporter can key off it.
 */
export const logEvent = (event: PipelineEvent): Effect.Effect<void> => {
  switch (event._tag) {
    case "TranscriptDelta":
      if (!event.isFinal) return Effect.void;
      return Effect.log(`transcript.${event.role}: ${event.text}`).pipe(
        Effect.annotateLogs("event", event._tag),
        Effect.annotateLogs("role", event.role),
        Effect.annotateLogs("isFinal", "true"),
      );
    case "SpeechStarted":
      return Effect.log("speech.started").pipe(
        Effect.annotateLogs("event", event._tag),
        Effect.annotateLogs("timestamp", event.timestamp),
      );
    case "SpeechEnded":
      return Effect.log("speech.ended").pipe(
        Effect.annotateLogs("event", event._tag),
        Effect.annotateLogs("timestamp", event.timestamp),
      );
    case "Interrupted":
      return Effect.log("barge-in.interrupted").pipe(
        Effect.annotateLogs("event", event._tag),
        Effect.annotateLogs("timestamp", event.timestamp),
      );
    case "ToolCallStarted":
      return Effect.log(`tool.started: ${event.name}`).pipe(
        Effect.annotateLogs("event", event._tag),
        Effect.annotateLogs("tool.name", event.name),
        Effect.annotateLogs("tool.callId", event.callId),
      );
    case "ToolCallCompleted": {
      const msg =
        event.status === "success" ? `tool.completed: ${event.name}` : `tool.failed: ${event.name}`;
      const base = Effect.log(msg).pipe(
        Effect.annotateLogs("event", event._tag),
        Effect.annotateLogs("tool.name", event.name),
        Effect.annotateLogs("tool.callId", event.callId),
        Effect.annotateLogs("tool.status", event.status),
      );
      if (event.status === "success" && event.result !== undefined) {
        return base.pipe(Effect.annotateLogs("tool.result", String(event.result)));
      }
      if (event.status === "failure" && event.error) {
        return base.pipe(Effect.annotateLogs("tool.error", event.error.reason));
      }
      return base;
    }
    case "ResponseStarted":
      return Effect.log(`response.started`).pipe(
        Effect.annotateLogs("event", event._tag),
        Effect.annotateLogs("response.id", event.responseId),
        Effect.annotateLogs("timestamp", event.timestamp),
      );
    case "ResponseCompleted":
      return Effect.log(`response.completed`).pipe(
        Effect.annotateLogs("event", event._tag),
        Effect.annotateLogs("response.id", event.responseId),
        Effect.annotateLogs("response.status", event.status),
        Effect.annotateLogs("response.outputTokens", event.outputTokens),
        Effect.annotateLogs("response.audioFrames", event.audioFrames),
        Effect.annotateLogs("timestamp", event.timestamp),
      );
    case "AudioOutputStarted":
      return Effect.log(`audio.started`).pipe(
        Effect.annotateLogs("event", event._tag),
        Effect.annotateLogs("response.id", event.responseId),
        Effect.annotateLogs("timestamp", event.timestamp),
      );
    case "AudioOutputDone":
      return Effect.log(`audio.done`).pipe(
        Effect.annotateLogs("event", event._tag),
        Effect.annotateLogs("response.id", event.responseId),
        Effect.annotateLogs("audio.frames", event.frames),
        Effect.annotateLogs("timestamp", event.timestamp),
      );
  }
};
