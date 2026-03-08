/**
 * Wraps a raw Realtime service with automatic observability:
 * - Event logging via logEvent() on the events stream
 * - Token usage metrics from ResponseCompleted events
 * - Span wrapping on interrupt and submitToolOutput
 *
 * Applied at the pipeline level so providers stay thin and unaware of tracing.
 */

import { Effect, Stream } from "effect";
import type { RealtimeShape } from "@/core/Provider.js";
import type { PipelineEvent } from "@/core/Events.js";
import { logEvent } from "@/observability/EventLogger.js";
import { trackTokenUsage } from "@/observability/UsageMetrics.js";

function trackUsageFromEvent(event: PipelineEvent): Effect.Effect<void> {
  if (event._tag !== "ResponseCompleted") return Effect.void;
  return trackTokenUsage(event);
}

export function instrumentRealtime(raw: RealtimeShape): RealtimeShape {
  return {
    send: raw.send,
    receive: raw.receive,

    events: raw.events.pipe(
      Stream.tap(logEvent),
      Stream.tap(trackUsageFromEvent),
    ),

    interrupt: (playedAudioMs) =>
      raw.interrupt(playedAudioMs).pipe(
        Effect.withSpan("realtime.interrupt"),
      ),

    submitToolOutput: (callId, name, output) =>
      raw.submitToolOutput(callId, name, output).pipe(
        Effect.withSpan("realtime.submitToolOutput", {
          attributes: { "tool.callId": callId, "tool.name": name },
        }),
      ),

    requestResponse: () => raw.requestResponse(),
    requiresExplicitRequestResponse: raw.requiresExplicitRequestResponse,
  };
}
