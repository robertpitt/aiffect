/**
 * Custom OTel SpanExporter that writes spans to disk in Chrome Trace Event
 * format when the SDK shuts down (i.e. when the session scope closes).
 *
 * Post-processes span events to synthesize rich, human-readable duration
 * spans that give a clear waterfall view in the trace viewer:
 *
 *   - User speech durations         (SpeechStarted → SpeechEnded)
 *   - Response lifecycle             (ResponseStarted → ResponseCompleted)
 *   - Audio delivery windows         (AudioOutputStarted → AudioOutputDone)
 *   - Conversation turns             (SpeechEnded → next ResponseCompleted)
 *   - Tool call durations            (ToolCallStarted → ToolCallCompleted)
 *   - Barge-in markers               (Interrupted events)
 *   - Latency metrics                (TTFA, turn latency)
 *   - Final transcripts              (user & assistant, aggregated)
 *
 * Open the resulting JSON file in:
 *   - chrome://tracing
 *   - https://ui.perfetto.dev
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { ExportResultCode } from "@opentelemetry/core";

interface TraceEvent {
  name: string;
  cat: string;
  ph: "X" | "B" | "E" | "i" | "C";
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  s?: "g" | "p" | "t";
  args?: Record<string, unknown>;
}

const hrToMicros = (hr: [number, number]): number => hr[0] * 1_000_000 + Math.round(hr[1] / 1000);

// ─── Thread / Track Layout ───────────────────────────────────────────
// Organized for a clear top-to-bottom reading of a voice conversation.

const TID = {
  SESSION: 1,
  TURNS: 2,
  USER_SPEECH: 3,
  RESPONSES: 4,
  AUDIO_PLAYBACK: 5,
  TOOLS: 6,
  BARGE_IN: 7,
  TRANSCRIPTS: 8,
  PIPELINE: 9,
  PROVIDER: 10,
  TRANSPORT: 11,
} as const;

const TID_LABELS: Record<number, string> = {
  [TID.SESSION]: "Session",
  [TID.TURNS]: "Conversation Turns",
  [TID.USER_SPEECH]: "User Speech",
  [TID.RESPONSES]: "Response Lifecycle",
  [TID.AUDIO_PLAYBACK]: "Audio Playback",
  [TID.TOOLS]: "Tool Calls",
  [TID.BARGE_IN]: "Barge-In",
  [TID.TRANSCRIPTS]: "Transcripts",
  [TID.PIPELINE]: "Pipeline Fibers",
  [TID.PROVIDER]: "Provider",
  [TID.TRANSPORT]: "Transport",
};

const tidForSpan = (name: string): number => {
  if (name.startsWith("pipeline.inbound")) return TID.PIPELINE;
  if (name.startsWith("pipeline.outbound")) return TID.PIPELINE;
  if (name.startsWith("pipeline.events")) return TID.PIPELINE;
  if (name.startsWith("pipeline.bargeIn")) return TID.BARGE_IN;
  if (name.startsWith("pipeline.")) return TID.PIPELINE;
  if (name.startsWith("tool.")) return TID.TOOLS;
  if (name.startsWith("openai.") || name.startsWith("gemini.")) return TID.PROVIDER;
  if (name.startsWith("transport.")) return TID.TRANSPORT;
  if (name.startsWith("sandwich.")) return TID.PIPELINE;
  return TID.SESSION;
};

// ─── Collected lifecycle windows ─────────────────────────────────────

interface SpeechWindow {
  startTs: number;
  endTs?: number;
}

interface ResponseWindow {
  responseId: string;
  startTs: number;
  endTs?: number;
  status?: string;
  outputTokens?: number;
  audioFrames?: number;
  audioStartTs?: number;
  audioEndTs?: number;
  audioFrameCount?: number;
}

interface ToolWindow {
  callId: string;
  name: string;
  startTs: number;
  endTs?: number;
  result?: string;
}

interface TurnWindow {
  turnId: number;
  userSpeechEndTs: number;
  responseCompletedTs?: number;
  responseId?: string;
  userTranscript?: string;
  assistantTranscript?: string;
}

interface BargeInMarker {
  ts: number;
}

interface TranscriptEntry {
  ts: number;
  role: string;
  text: string;
}

export class FileTraceExporter implements SpanExporter {
  private spans: ReadableSpan[] = [];
  private outDir: string;

  constructor(outDir = "traces") {
    this.outDir = outDir;
    mkdirSync(this.outDir, { recursive: true });
  }

  export(spans: ReadableSpan[], resultCallback: (result: { code: number }) => void): void {
    this.spans.push(...spans);
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  async shutdown(): Promise<void> {
    if (this.spans.length === 0) return;

    const events: TraceEvent[] = [];

    // Thread metadata
    for (const [tid, label] of Object.entries(TID_LABELS)) {
      events.push({
        name: "thread_name",
        cat: "__metadata",
        ph: "i",
        ts: 0,
        pid: 1,
        tid: Number(tid),
        args: { name: label },
      });
    }

    events.push({
      name: "process_name",
      cat: "__metadata",
      ph: "i",
      ts: 0,
      pid: 1,
      tid: 0,
      args: { name: "aiffect session" },
    });

    // Collectors for lifecycle synthesis
    const speechWindows: SpeechWindow[] = [];
    const responseWindows = new Map<string, ResponseWindow>();
    const toolWindows = new Map<string, ToolWindow>();
    const bargeInMarkers: BargeInMarker[] = [];
    const transcripts: TranscriptEntry[] = [];

    // ─── Pass 1: Emit real spans & collect lifecycle events ────────

    for (const span of this.spans) {
      const startMicros = hrToMicros(span.startTime as [number, number]);
      const endMicros = hrToMicros(span.endTime as [number, number]);

      const args: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(span.attributes)) {
        args[k] = v;
      }
      if (span.status.message) {
        args["status.message"] = span.status.message;
      }
      args["spanId"] = span.spanContext().spanId;
      if (span.parentSpanContext?.spanId) {
        args["parentSpanId"] = span.parentSpanContext.spanId;
      }

      events.push({
        name: span.name,
        cat: span.name.split(".")[0] ?? "default",
        ph: "X",
        ts: startMicros,
        dur: Math.max(1, endMicros - startMicros),
        pid: 1,
        tid: tidForSpan(span.name),
        args,
      });

      // Process span events (log entries attached to spans)
      for (const ev of span.events) {
        const evTs = hrToMicros(ev.time as [number, number]);
        const evArgs: Record<string, unknown> = {};
        if (ev.attributes) {
          for (const [k, v] of Object.entries(ev.attributes)) {
            evArgs[k] = v;
          }
        }

        const eventTag = evArgs["event"] as string | undefined;
        this.collectLifecycleEvent(
          eventTag,
          evArgs,
          evTs,
          speechWindows,
          responseWindows,
          toolWindows,
          bargeInMarkers,
          transcripts,
        );

        // Emit instant event on the appropriate track
        const evTid = this.tidForLogEvent(eventTag, span.name);
        events.push({
          name: ev.name,
          cat: "log",
          ph: "i",
          ts: evTs,
          pid: 1,
          tid: evTid,
          s: "t",
          args: evArgs,
        });
      }
    }

    // ─── Pass 2: Synthesize duration spans ─────────────────────────

    this.synthesizeSpeechSpans(events, speechWindows);
    this.synthesizeResponseSpans(events, responseWindows);
    this.synthesizeToolSpans(events, toolWindows);
    this.synthesizeTurnSpans(events, speechWindows, responseWindows, transcripts);
    this.synthesizeBargeInSpans(events, bargeInMarkers);
    this.synthesizeTranscriptMarkers(events, transcripts);

    // ─── Write file ────────────────────────────────────────────────

    const traceId = this.spans[0]?.spanContext().traceId.slice(0, 8) ?? "unknown";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `trace-${timestamp}-${traceId}.json`;
    const filepath = join(this.outDir, filename);

    writeFileSync(filepath, JSON.stringify(events, null, 2));
    console.log(`\n  Trace written → ${filepath}`);
    console.log(`  Open in: chrome://tracing or https://ui.perfetto.dev\n`);

    this.spans = [];
  }

  /**
   * Route log events to the appropriate visualization track.
   */
  private tidForLogEvent(eventTag: string | undefined, spanName: string): number {
    switch (eventTag) {
      case "SpeechStarted":
      case "SpeechEnded":
        return TID.USER_SPEECH;
      case "ResponseStarted":
      case "ResponseCompleted":
        return TID.RESPONSES;
      case "AudioOutputStarted":
      case "AudioOutputDone":
        return TID.AUDIO_PLAYBACK;
      case "ToolCallStarted":
      case "ToolCallCompleted":
        return TID.TOOLS;
      case "Interrupted":
        return TID.BARGE_IN;
      case "TranscriptDelta":
        return TID.TRANSCRIPTS;
      default:
        return tidForSpan(spanName);
    }
  }

  /**
   * Collect lifecycle timestamps from log events so we can synthesize
   * duration spans for each activity.
   */
  private collectLifecycleEvent(
    eventTag: string | undefined,
    args: Record<string, unknown>,
    tsMicros: number,
    speechWindows: SpeechWindow[],
    responseWindows: Map<string, ResponseWindow>,
    toolWindows: Map<string, ToolWindow>,
    bargeInMarkers: BargeInMarker[],
    transcriptEntries: TranscriptEntry[],
  ): void {
    if (!eventTag) return;

    switch (eventTag) {
      case "SpeechStarted":
        speechWindows.push({ startTs: tsMicros });
        break;

      case "SpeechEnded": {
        const last = speechWindows[speechWindows.length - 1];
        if (last && !last.endTs) {
          last.endTs = tsMicros;
        }
        break;
      }

      case "ResponseStarted": {
        const rid = args["response.id"] as string | undefined;
        if (rid) {
          responseWindows.set(rid, {
            responseId: rid,
            startTs: tsMicros,
          });
        }
        break;
      }

      case "ResponseCompleted": {
        const rid = args["response.id"] as string | undefined;
        if (rid) {
          const w = responseWindows.get(rid);
          if (w) {
            w.endTs = tsMicros;
            w.status = args["response.status"] as string | undefined;
            w.outputTokens = Number(args["response.outputTokens"] ?? 0);
            w.audioFrames = Number(args["response.audioFrames"] ?? 0);
          }
        }
        break;
      }

      case "AudioOutputStarted": {
        const rid = args["response.id"] as string | undefined;
        if (rid) {
          const w = responseWindows.get(rid);
          if (w) w.audioStartTs = tsMicros;
        }
        break;
      }

      case "AudioOutputDone": {
        const rid = args["response.id"] as string | undefined;
        if (rid) {
          const w = responseWindows.get(rid);
          if (w) {
            w.audioEndTs = tsMicros;
            w.audioFrameCount = Number(args["audio.frames"] ?? 0);
          }
        }
        break;
      }

      case "ToolCallStarted": {
        const callId = args["tool.callId"] as string | undefined;
        const name = args["tool.name"] as string | undefined;
        if (callId && name) {
          toolWindows.set(callId, { callId, name, startTs: tsMicros });
        }
        break;
      }

      case "ToolCallCompleted": {
        const callId = args["tool.callId"] as string | undefined;
        if (callId) {
          const w = toolWindows.get(callId);
          if (w) {
            w.endTs = tsMicros;
            w.result = args["tool.result"] as string | undefined;
          }
        }
        break;
      }

      case "Interrupted":
        bargeInMarkers.push({ ts: tsMicros });
        break;

      case "TranscriptDelta": {
        const isFinal = args["isFinal"] === "true" || args["isFinal"] === true;
        if (isFinal) {
          transcriptEntries.push({
            ts: tsMicros,
            role: args["role"] as string,
            text: (args["effect.message"] as string) ?? "",
          });
        }
        break;
      }
    }
  }

  // ─── Synthesis methods ─────────────────────────────────────────────

  /**
   * Duration bars for each user speech segment.
   */
  private synthesizeSpeechSpans(events: TraceEvent[], windows: SpeechWindow[]): void {
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i]!;
      if (!w.endTs) continue;
      const dur = w.endTs - w.startTs;
      events.push({
        name: `User Speaking`,
        cat: "speech",
        ph: "X",
        ts: w.startTs,
        dur: Math.max(1, dur),
        pid: 1,
        tid: TID.USER_SPEECH,
        args: {
          "speech.index": i,
          "speech.duration_ms": Math.round(dur / 1000),
        },
      });
    }
  }

  /**
   * Duration bars for each response lifecycle, plus nested audio delivery
   * and TTFA (time-to-first-audio) sub-spans.
   */
  private synthesizeResponseSpans(
    events: TraceEvent[],
    windows: Map<string, ResponseWindow>,
  ): void {
    for (const [id, w] of windows) {
      const label = id.slice(0, 12);

      if (w.endTs) {
        const dur = w.endTs - w.startTs;
        events.push({
          name: `Response ${label}`,
          cat: "response",
          ph: "X",
          ts: w.startTs,
          dur: Math.max(1, dur),
          pid: 1,
          tid: TID.RESPONSES,
          args: {
            "response.id": id,
            "response.status": w.status ?? "unknown",
            "response.outputTokens": w.outputTokens ?? 0,
            "response.audioFrames": w.audioFrames ?? 0,
            "response.duration_ms": Math.round(dur / 1000),
          },
        });
      }

      // Audio delivery sub-span
      if (w.audioStartTs && w.audioEndTs) {
        const dur = w.audioEndTs - w.audioStartTs;
        events.push({
          name: `Audio Delivery ${label}`,
          cat: "audio",
          ph: "X",
          ts: w.audioStartTs,
          dur: Math.max(1, dur),
          pid: 1,
          tid: TID.AUDIO_PLAYBACK,
          args: {
            "response.id": id,
            "audio.frames": w.audioFrameCount ?? 0,
            "audio.duration_ms": Math.round(dur / 1000),
          },
        });
      }

      // TTFA: time from response start to first audio frame
      if (w.audioStartTs) {
        const ttfa = w.audioStartTs - w.startTs;
        events.push({
          name: `TTFA ${label}`,
          cat: "latency",
          ph: "X",
          ts: w.startTs,
          dur: Math.max(1, ttfa),
          pid: 1,
          tid: TID.AUDIO_PLAYBACK,
          args: {
            "response.id": id,
            ttfa_ms: Math.round(ttfa / 1000),
          },
        });
      }
    }
  }

  /**
   * Duration bars for each tool call execution.
   */
  private synthesizeToolSpans(events: TraceEvent[], windows: Map<string, ToolWindow>): void {
    for (const [, w] of windows) {
      if (!w.endTs) continue;
      const dur = w.endTs - w.startTs;
      events.push({
        name: `Tool: ${w.name}`,
        cat: "tool",
        ph: "X",
        ts: w.startTs,
        dur: Math.max(1, dur),
        pid: 1,
        tid: TID.TOOLS,
        args: {
          "tool.callId": w.callId,
          "tool.name": w.name,
          "tool.result": w.result ?? "",
          "tool.duration_ms": Math.round(dur / 1000),
        },
      });
    }
  }

  /**
   * Conversation turn spans: each turn starts when user speech ends and
   * completes when the next assistant response completes. Annotated with
   * turn latency and any transcripts.
   */
  private synthesizeTurnSpans(
    events: TraceEvent[],
    speechWindows: SpeechWindow[],
    responseWindows: Map<string, ResponseWindow>,
    transcriptEntries: TranscriptEntry[],
  ): void {
    const completedResponses = Array.from(responseWindows.values())
      .filter((r) => r.endTs)
      .sort((a, b) => a.startTs - b.startTs);

    let responseIdx = 0;
    let turnId = 0;

    for (const speech of speechWindows) {
      if (!speech.endTs) continue;

      // Find the next response that started after this speech ended
      while (
        responseIdx < completedResponses.length &&
        completedResponses[responseIdx]!.startTs < speech.startTs
      ) {
        responseIdx++;
      }

      const response = completedResponses[responseIdx];
      if (!response?.endTs) continue;

      turnId++;
      const turnStart = speech.startTs;
      const turnEnd = response.endTs;
      const turnDur = turnEnd - turnStart;

      // Turn latency: time from user speech end to response start
      const turnLatency = response.startTs - speech.endTs;
      // TTFA from user's perspective: speech end to first audio
      const userTtfa = response.audioStartTs ? response.audioStartTs - speech.endTs : undefined;

      // Find transcripts in this turn's time window
      const userText = transcriptEntries
        .filter((t) => t.role === "user" && t.ts >= speech.startTs && t.ts <= turnEnd)
        .map((t) => t.text)
        .join(" ");
      const assistantText = transcriptEntries
        .filter(
          (t) => t.role === "assistant" && t.ts >= speech.startTs && t.ts <= turnEnd + 500_000, // 500ms grace for late transcripts
        )
        .map((t) => t.text)
        .join(" ");

      const args: Record<string, unknown> = {
        "turn.id": turnId,
        "turn.duration_ms": Math.round(turnDur / 1000),
        "turn.latency_ms": Math.round(turnLatency / 1000),
        "response.id": response.responseId,
      };
      if (userTtfa !== undefined) {
        args["turn.ttfa_ms"] = Math.round(userTtfa / 1000);
      }
      if (userText) args["user.transcript"] = userText;
      if (assistantText) args["assistant.transcript"] = assistantText;

      events.push({
        name: `Turn ${turnId}`,
        cat: "turn",
        ph: "X",
        ts: turnStart,
        dur: Math.max(1, turnDur),
        pid: 1,
        tid: TID.TURNS,
        args,
      });

      responseIdx++;
    }
  }

  /**
   * Barge-in instant markers on a dedicated track.
   */
  private synthesizeBargeInSpans(events: TraceEvent[], markers: BargeInMarker[]): void {
    for (let i = 0; i < markers.length; i++) {
      events.push({
        name: `Barge-In #${i + 1}`,
        cat: "bargein",
        ph: "i",
        ts: markers[i]!.ts,
        pid: 1,
        tid: TID.BARGE_IN,
        s: "g",
        args: { "bargein.index": i + 1 },
      });
    }
  }

  /**
   * Final transcript entries as instant events on the transcript track.
   */
  private synthesizeTranscriptMarkers(
    events: TraceEvent[],
    transcriptEntries: TranscriptEntry[],
  ): void {
    for (const t of transcriptEntries) {
      const label = t.role === "user" ? "User" : "Assistant";
      const text = t.text.length > 80 ? t.text.slice(0, 77) + "..." : t.text;
      events.push({
        name: `${label}: ${text}`,
        cat: "transcript",
        ph: "i",
        ts: t.ts,
        pid: 1,
        tid: TID.TRANSCRIPTS,
        s: "t",
        args: {
          role: t.role,
          transcript: t.text,
        },
      });
    }
  }

  async forceFlush(): Promise<void> {}
}
