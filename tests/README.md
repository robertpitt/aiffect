# Tests

Automated tests for pipeline contracts and behavior.

---

## Test suite

| File | Description |
|------|-------------|
| **pipeline.contract.test.ts** | Contract tests for the Realtime pipeline: inbound audio reaches the provider; tool calls trigger dispatch and `submitToolOutput`; interrupt clears the transport. Uses `testTransport` and `testRealtime` from `test-utils.ts` to drive the pipeline without a real WebSocket or AI API. |

---

## Running tests

From the project root:

```bash
npm test
# or
vitest run
```

---

## Test utilities

Test doubles live in **tests/test-utils.ts**. Simple, inline-friendly APIs:

- **testFrame()** — Dummy audio frame for injection.
- **testSTT(transcript?)** — Mock STT that emits transcript on first audio frame.
- **testTTS(frames?)** — Mock TTS that returns dummy PCM16 frames.
- **testLanguageModel(responseText?)** — Mock LLM with fixed text response.
- **testTransport()** — In-memory transport (inbound/outbound queues).
- **testRealtime()** — Fake Realtime provider (push events, inspect sent frames).

Use directly in test files: `Layer.provide(testSTT("Hello")), Layer.provide(testTTS()),` etc.
