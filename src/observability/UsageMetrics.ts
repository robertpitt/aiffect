/**
 * Effect Metrics for realtime usage (tokens, optional latency).
 * Use Metric.counter with incremental: true; tag by provider/session via Effect.tagMetrics or Effect.tagMetricsScoped.
 */

import { Duration, Metric } from "effect";

export const inputTokensCounter: Metric.Metric.Counter<number> = Metric.counter(
  "realtime_input_tokens",
  {
    description: "Input token count",
    incremental: true,
  },
).pipe(Metric.tagged("component", "realtime"));

export const outputTokensCounter: Metric.Metric.Counter<number> = Metric.counter(
  "realtime_output_tokens",
  {
    description: "Output token count",
    incremental: true,
  },
).pipe(Metric.tagged("component", "realtime"));

export const responseDurationTimer: Metric.Metric.Histogram<Duration.Duration> =
  Metric.timerWithBoundaries(
    "realtime_response_duration_ms",
    [10, 50, 100, 500, 1000],
    "Response duration in milliseconds",
  );
