# Examples

Runnable examples that demonstrate session setup, multi-agent routing, and observability.

---

## Example scripts

| Script | Description | How to run |
|--------|-------------|------------|
| **multi-agent-toolkits.ts** | HTTP server + WebSocket server; multiple agents (restaurant, reservations, concierge) with merged toolkits. Agent selected via `?agent=…`. Uses sample agents from `sample/agents`. | `OPENAI_API_KEY=sk-... npx tsx examples/multi-agent-toolkits.ts` or `REALTIME_PROVIDER=gemini GEMINI_API_KEY=... npx tsx examples/multi-agent-toolkits.ts` |
| **FileTraceExporter.ts** | Custom OpenTelemetry `SpanExporter` that writes spans to a JSON file in Chrome Trace Event format when the SDK shuts down. Post-processes span events into a readable waterfall (user speech, response lifecycle, audio playback, tool calls, barge-in, transcripts). For use with `chrome://tracing` or [Perfetto](https://ui.perfetto.dev). | Not run directly; integrate into your app’s tracing setup and open the generated JSON in a trace viewer. |

---

## Technical flow (multi-agent-toolkits)

1. **HTTP server** serves a static HTML page from `examples/public/index.html` (client UI).
2. **WebSocket server** accepts connections; for each connection, reads `agent` from the request URL and resolves the agent from the `agents` record.
3. **Session.run** is called with `agentId`, `agents`, `provider` (OpenAI or Gemini realtime, with `SampleServerContextLive`), and `WebSocketTransport(ws)`.
4. The pipeline runs until the WebSocket closes; errors are logged with `Effect.catchAllCause`.

The **sample agents** (restaurant, reservations, concierge) and their toolkits are defined in `sample/agents`. See [sample/README.md](../sample/README.md) for toolkit and agent details.

---

## Running the main example

From the project root:

```bash
npm run example
# or explicitly:
OPENAI_API_KEY=sk-... npx tsx examples/multi-agent-toolkits.ts
```

Then open:

- `http://localhost:8081?agent=restaurant` — restaurant + menu
- `http://localhost:8081?agent=reservations` — restaurant + reservations
- `http://localhost:8081?agent=concierge` — all tools (default)

Client-side code (e.g. in `public/index.html`) should follow the WebSocket contract in [docs/CLIENT.md](../docs/CLIENT.md).
