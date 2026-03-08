# aiffect-ts

**Provider-agnostic realtime voice pipeline toolkit built on [Effect](https://effect.website/).**

*(Name: “aiffect” = AI + Effect)*

Build full-duplex voice agents that work with **OpenAI Realtime**, **Gemini Live**, or composed **STT → LLM → TTS** pipelines. Define agents once with prompts and tools; swap providers or pipelines via composition. All orchestration is typed, composable, and runs on Effect’s runtime.

---

## Core Concepts

aiffect-ts models a voice session as four layers that you compose:

```
┌──────────┐        ┌────────────┐        ┌────────────┐        ┌──────────┐
│  Client  │◄─ws──►│  Transport │◄─────►│  Pipeline  │◄─────►│ Provider │◄──► AI API
│ (browser)│  pcm16 │ (WebSocket)│        │ (orchestr.)│        │ (OpenAI/  │
└──────────┘        └────────────┘        └─────┬──────┘        │  Gemini)  │
                                              │                └──────────┘
                                        ┌─────▼──────┐
                                        │   Agent    │
                                        │ (prompt +  │
                                        │  toolkit)  │
                                        └────────────┘
```

### Transport

Moves raw PCM16 audio between the client and the server.

- **inbound** — Stream of `AudioFrame` from the client (microphone)
- **send** — Push audio frames to the client (speakers)
- **clear** — Optional. Signal the client to flush its playback buffer (used for barge-in)

The built-in `WebSocketTransport` expects binary PCM16 frames and sends a JSON `{ type: "clear" }` for barge-in. See [docs/CLIENT.md](docs/CLIENT.md) for the client contract.

### Provider

Talks to an AI API. Two modes:

- **Realtime** — Full-duplex: send audio in, receive audio and events out. Used by `RealtimePipeline`. Implementations: `OpenAI.realtime()`, `Gemini.realtime()`.
- **Composable** — STT, TTS, and LanguageModel as separate services. Used by `SandwichPipeline` and `SandwichBargeInPipeline`. You provide layers for each (e.g. OpenAI Whisper + GPT + TTS).

### Pipeline

Orchestrates the voice loop: routes audio between Transport and Provider, handles events (transcripts, tool calls), and manages barge-in.


| Pipeline            | Mode                              | Use when                                           |
| ------------------- | --------------------------------- | -------------------------------------------------- |
| **Realtime**        | Full-duplex, native barge-in      | You have a realtime API (OpenAI, Gemini)           |
| **Sandwich**        | STT → LLM → TTS, turn-based       | You want a specific STT/LLM/TTS combo, no barge-in |
| **SandwichBargeIn** | Sandwich + energy-based interrupt | Same as Sandwich but with user interrupt           |


### Agent

A portable definition: **prompt** + **toolkit**. The same agent runs on any provider or pipeline.

- **buildPrompt(agentContext, sessionContext)** — Returns the system prompt. `agentContext` has per-spawn config; `sessionContext` has `sessionId` (observability anchor).
- **toolkit** — `@effect/ai` Toolkit (tools the model can call).
- **toolkitLayer** — Effect Layer that provides the tool implementations.

Use `defineAgent()` to create an agent; it derives `handleToolCall` from the toolkit.

### Session

The entry point. `Session.run(options)` composes Transport, Provider, Pipeline, and Agent into a single layer, builds it, and runs the pipeline until the connection ends.

```ts
Session.run({
  agent: myAgent,
  provider: OpenAI.realtime({ voice: "alloy" }),
  transport: WebSocketTransport(ws),
});
```

---

## Data Flow

1. **Client** sends PCM16 audio over WebSocket.
2. **Transport** yields `AudioFrame`s on `inbound`.
3. **Pipeline** forwards frames to the **Provider** (or to STT in Sandwich mode).
4. **Provider** sends to the AI API; receives audio and events back.
5. **Pipeline** routes audio to `Transport.send`, processes events (tool dispatch, barge-in).
6. **Transport** sends audio to the client.

When the model requests a tool call, the pipeline invokes `agent.handleToolCall`, serializes the result, and submits it via the provider. The model continues with the tool output.

---

## Quick Start

1. **Define an agent** (using `@effect/ai`):

```ts
import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "@effect/ai";
import { defineAgent } from "aiffect-ts";

const GetTime = Tool.make("GetTime", {
  description: "Get the current time",
  success: Schema.String,
});

const DemoToolkit = Toolkit.make(GetTime);
const DemoToolkitLive = DemoToolkit.toLayer({
  GetTime: () => Effect.succeed(new Date().toISOString()),
});

const agent = defineAgent({
  name: "Demo Agent",
  buildPrompt: () =>
    "You are a helpful voice assistant. Keep responses concise.",
  toolkit: DemoToolkit,
  toolkitLayer: DemoToolkitLive,
});
```

1. **Run a session** on each WebSocket connection:

```ts
import { Effect } from "effect";
import { Session, OpenAI, WebSocketTransport } from "aiffect-ts";

wss.on("connection", (ws) => {
  const session = Session.run({
    agent,
    provider: OpenAI.realtime({ voice: "alloy" }),
    transport: WebSocketTransport(ws),
  }).pipe(
    Effect.catchAllCause((cause) => Effect.log(`session ended: ${cause}`)),
  );

  Effect.runFork(session);
});
```

1. **Run the example**:

```bash
OPENAI_API_KEY=sk-... npx tsx examples/voice-concierge.ts
# Or with Gemini:
REALTIME_PROVIDER=gemini GEMINI_API_KEY=... npx tsx examples/voice-concierge.ts
```

---

## Session Options


| Option                   | Description                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **agent**                | Agent to use directly. Mutually exclusive with `agentId` + `agents`.                                           |
| **agentId** + **agents** | Resolve agent by id from a record. Use for multi-agent routing.                                                |
| **provider**             | Layer for the AI provider (e.g. `OpenAI.realtime()`, `Gemini.realtime()`). Options act as defaults; override per-session via `session.providerOptions`. |
| **transport**            | Layer for audio transport (e.g. `WebSocketTransport(ws)`).                                                     |
| **pipeline**             | Optional. Defaults to `RealtimePipeline`. Use `SandwichPipeline` or `SandwichBargeInPipeline` for STT→LLM→TTS. |
| **session**              | Optional. `{ sessionId?, connectionId?, metadata?, providerOptions? }`. `providerOptions` overrides provider base options per-session. |


---

## Pipelines in Detail

### Realtime

Full-duplex audio with three concurrent fibers: inbound (client → provider), outbound (provider → client with barge-in gating), and events (tool dispatch, state). Barge-in is event-driven: the provider emits `SpeechStarted` when the user speaks; the pipeline interrupts and clears the client buffer.

### Sandwich

Turn-based: STT transcribes audio → LLM generates text → TTS synthesizes. No barge-in. Use when you need a specific STT/LLM/TTS combo and don’t have a realtime API.

### SandwichBargeIn

Same as Sandwich but with energy-based barge-in: the pipeline monitors inbound audio energy; when it exceeds a threshold for N consecutive frames while the assistant is speaking, it interrupts the turn. Configurable via `SandwichBargeInPipeline({ energyThreshold, frameThreshold })`.

---

## Extensibility


| Extension        | Entry point                                      | Docs                                                 |
| ---------------- | ------------------------------------------------ | ---------------------------------------------------- |
| Custom provider  | `makeRealtimeLayer`, `RealtimeAdapter`           | [docs/CUSTOM_PROVIDER.md](docs/CUSTOM_PROVIDER.md)   |
| Custom transport | `TransportShape`, `Layer.scoped(Transport, ...)` | [docs/CUSTOM_TRANSPORT.md](docs/CUSTOM_TRANSPORT.md) |
| Custom pipeline  | `createPipeline`, `PipelineShape`                | [docs/API.md](docs/API.md), [src/core/README.md](src/core/README.md) |


---

## Observability

- **Pipeline events** — All pipelines emit a unified `PipelineEvent` stream: `TranscriptDelta`, `SpeechStarted`/`SpeechEnded`, `Interrupted`, `ToolCallStarted`/`ToolCallCompleted`, `ResponseStarted`/`ResponseCompleted`, etc. Subscribe via `Session.runWithEvents(options, ({ fiber, events }) => ...)`.
- **Token metrics** — `inputTokensCounter`, `outputTokensCounter` from `observability/UsageMetrics`. Incremented from `ResponseCompleted` events.
- **OpenTelemetry** — Sessions and pipelines emit spans when tracing is configured.

---

## Project Structure

| Path | Description |
|------|-------------|
| **src/index.ts** | Public API exports |
| **src/Session.ts** | Session runner (`Session.run`, `Session.runWithEvents`) |
| **src/core/** | Transport, Provider, Pipeline, Agent, Events, Errors, context — [README](src/core/README.md) |
| **src/pipelines/** | Realtime, Sandwich, SandwichBargeIn — [README](src/pipelines/README.md) |
| **src/providers/** | OpenAI, Gemini (realtime, STT, TTS) — [README](src/providers/README.md) |
| **src/transports/** | WebSocket transport — [README](src/transports/README.md) |
| **src/observability/** | Event logging, usage metrics — [README](src/observability/README.md) |
| **src/internal/** | Internal helpers (audio, toolkit compat, MessageSocket) — [README](src/internal/README.md) |
| **src/test/** | Test doubles (TestTransport, TestProvider) |
| **docs/** | API tiers, client contract, custom provider/transport guides — [README](docs/README.md) |
| **examples/** | Production-grade voice concierge (agent + tools), trace exporter — [README](examples/README.md) |
| **sample/** | Sample agents and toolkits — [README](sample/README.md) |
| **tests/** | Pipeline contract tests — [README](tests/README.md) |

See [PROTOCOL.md](PROTOCOL.md) for detailed data flow and wire formats. Design notes and improvement ideas: [PROTOCOL_REVIEW.md](PROTOCOL_REVIEW.md).

---

## Scripts

```bash
npm run check   # tsc --noEmit
npm run format  # oxfmt
npm run lint    # oxlint src/
npm run example # tsx examples/voice-concierge.ts
npm test        # vitest run
```

---

## License

See repository license.