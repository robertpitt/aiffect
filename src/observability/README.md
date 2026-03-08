# Observability

Event logging, token metrics, and OpenTelemetry-style instrumentation for the voice pipeline. Applied at the pipeline level so providers stay thin and unaware of tracing.

---

## Modules

| Module | Purpose |
|--------|---------|
| **EventLogger.ts** | `logEvent(event)` — logs pipeline events with structured attributes. Filters transcript deltas to final only to keep traces readable. |
| **UsageMetrics.ts** | Effect metrics for token usage: `inputTokensCounter`, `outputTokensCounter`, `trackTokenUsage(event)`. Incremented from `ResponseCompleted` events. |
| **InstrumentedRealtime.ts** | `instrumentRealtime(raw)` — wraps a `RealtimeShape` with: event logging and token tracking on the events stream; span wrapping on `interrupt` and `submitToolOutput`. |

---

## Technical flow

1. **Realtime pipeline** (see `pipelines/Realtime.ts`) calls `instrumentRealtime(rawRealtime)` before using the provider. All events from the provider pass through the instrumented service.
2. **Events stream** — The wrapper composes `raw.events` with `Stream.tap(logEvent)` and `Stream.tap(trackUsageFromEvent)`. So every event is logged (with `logEvent`), and every `ResponseCompleted` updates token counters (with `trackTokenUsage`).
3. **Spans** — `interrupt(playedAudioMs)` and `submitToolOutput(callId, name, output)` are wrapped with `Effect.withSpan(...)` so they appear as child spans when OpenTelemetry (or Effect tracing) is configured.

Sandwich and SandwichBargeIn pipelines emit the same `PipelineEvent` types and use `logEvent` / `trackTokenUsage` where they emit events (e.g. in SandwichCore); they do not use a single wrapped Realtime service because they use STT + LLM + TTS instead.

---

## Usage (application code)

- **Subscribe to events** — Use `Session.runWithEvents(options, ({ fiber, events }) => ...)` and consume the `events` stream (e.g. `Stream.runForEach(events, (e) => Effect.log(e._tag))`).
- **Token metrics** — If you use the default Realtime pipeline, token usage is already fed into `inputTokensCounter` and `outputTokensCounter`. You can read or expose these via Effect’s metric APIs.
- **Tracing** — Configure Effect’s OpenTelemetry integration; session and pipeline spans will appear when tracing is enabled.

See the root [README.md](../../README.md) (Observability section) and [PROTOCOL.md](../../PROTOCOL.md) (Observability) for more detail.
