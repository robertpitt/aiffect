import { Effect, Metric } from "effect";
import type { ResponseCompleted } from "../core/Events.js";

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

/** Increment token metrics from a ResponseCompleted event. No-op if both are 0. */
export const trackTokenUsage = (event: ResponseCompleted): Effect.Effect<void> => {
  if (event.inputTokens === 0 && event.outputTokens === 0) return Effect.void;
  return Effect.all([
    inputTokensCounter(Effect.succeed(event.inputTokens)),
    outputTokensCounter(Effect.succeed(event.outputTokens)),
  ]).pipe(Effect.asVoid);
};
