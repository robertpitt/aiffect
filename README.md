# aiffect-ts

**Provider-agnostic realtime voice pipeline toolkit built on [Effect](https://effect.website/).**

_(Name: “aiffect” = AI + Effect; not “affect.”)_

Build full-duplex voice agents that work with **OpenAI Realtime**, **Gemini Live**, or composed **STT → LLM → TTS** (“sandwich”) pipelines. Define agents once with prompts and tools; swap providers or pipelines via config. All orchestration is typed, composable, and runs on Effect’s runtime with built-in observability.

---

## Features

- **Provider-agnostic** — Same agent and session model for OpenAI Realtime, Gemini Realtime, or composed (Whisper + GPT + TTS) pipelines.
- **Composable contracts** — Clear interfaces for **Transport** (audio in/out), **Provider** (realtime or STT/TTS), and **Pipeline** (orchestration). Wire them once per connection via **Session**.
- **Portable agents** — Agents are **prompt + toolkits**; resolved by id from a registry and injected into the pipeline. No provider-specific glue in agent code.
- **Multiple pipelines** — **Realtime** (full-duplex with native barge-in), **Sandwich** (STT → LLM → TTS), **SandwichBargeIn** (sandwich with energy-based interrupt).
- **Session-driven config** — Per-connection settings (agent, provider, pipeline, voice, audio format) live in **SessionConfig**; one source of truth per call.
- **Effect-native** — Layers, services, streams, and typed errors throughout. Optional OpenTelemetry tracing and usage metrics.
- **Flexible audio** — Support for PCM16 and optional transforms (e.g. mulaw/alaw for telephony); pass-through when provider accepts the transport format.

---

## How it works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Session (per connection)                                                    │
│  • Validate, load config (agentId, provider, pipeline, voice, audio)        │
│  • Resolve Agent from registry → build Pipeline + Transport + Provider       │
└─────────────────────────────────────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
┌──────────────────┐  ┌───────────────────────────────────────────────────────┐
│  Transport       │  │  Provider                                             │
│  • WebSocket     │──│  • OpenAI Realtime  • Gemini Realtime                  │
│  • (Twilio etc.) │  │  • Composable (STT + LLM + TTS)                        │
└──────────────────┘  └───────────────────────────────────────────────────────┘
         │                    │
         └────────┬───────────┘
                  ▼
         ┌──────────────────┐
         │  Pipeline         │  ← Receives Agent (prompt + toolkits) from Session
         │  • Realtime       │
         │  • Sandwich       │
         │  • SandwichBargeIn│
         └──────────────────┘
```

- **Transport** is the input layer: it exposes an **inbound** stream of `AudioFrame` and a **send** effect to push audio back to the client (and optional **clear** for barge-in).
- **Provider** implements the realtime or composable contract: **send** audio in, **receive** audio out, **events** stream for lifecycle and tool calls, **interrupt**, **submitToolOutput**, **requestResponse**.
- **Pipeline** orchestrates: it connects Transport ↔ Provider, runs the main loop (inbound → provider, provider receive → transport with optional barge-in gating), subscribes to events for tool dispatch and logging.
- **Session** creates the pipeline for each connection: it loads **SessionConfig**, resolves the **Agent** by id, builds the chosen Provider and Pipeline, and runs the session in a scope.

Agents are **provider-agnostic**: they define `buildPrompt` and **toolkits** (using `@effect/ai`). The same agent runs on OpenAI, Gemini, or a sandwich pipeline; only the Session config (and which Provider/Pipeline you wire) changes.

---

## Required environment

| API                                       | Required context                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **runSession**                            | `Pipeline` (and thus Transport, Realtime, Agent, Scope). Build a full connection layer and provide it before calling.                                                                                                                                                                                                              |
| **SessionRunner.run** / **runWithConfig** | `AgentRegistry`, `ProviderRegistry`, `PipelineRegistry`. Provide `ProviderRegistryLive` and `PipelineRegistryLive` (or custom registries). Optionally pass a prebuilt **runtime** from `makeRuntime(ServerLive)` (e.g. `Layer.mergeAll(AgentRegistryLive, ProviderRegistryLive, PipelineRegistryLive)`) so each call needs no env. |

See `SessionEnv`, `SessionRunEnv`, `runSessionRequired`, `runWithConfigRequired` in the public API and [docs/concepts.md](docs/concepts.md).

---

## Key components

| Component         | Role                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Transport**     | Single input layer: `inbound: Stream<AudioFrame>`, `send(frame)`, optional `clear`. Implementations: WebSocket (PCM), Twilio (future).            |
| **Provider**      | Realtime: `send`, `receive`, `events`, `interrupt`, `submitToolOutput`, `requestResponse`. Composable: STT + TTS services for Sandwich pipelines. |
| **Pipeline**      | Runs the session: wires Transport ↔ Provider, handles barge-in, tool dispatch, event broadcast. Realtime / Sandwich / SandwichBargeIn.            |
| **Agent**         | Portable definition: `name`, `buildPrompt(ctx)`, `toolkit`, `toolkitLayer`. Resolved by id from **AgentRegistry** and injected by Session.        |
| **Session**       | Per connection: validate → load SessionConfig → resolve Agent → build Pipeline + Transport + Provider → run.                                      |
| **SessionConfig** | `agent` (agentId, voice, speed), `pipeline`, `provider`, `inputAudioFormat`, `sampleRate`, `channels`, turn detection, etc.                       |

---

## Installation

```bash
yarn add effect @effect/ai @effect/ai-openai  # and peer deps from package.json
# or
npm install effect @effect/ai @effect/ai-openai
```

Requires **Node** 18+ and **TypeScript** 5.x. The project is ESM-only (`"type": "module"`).

---

## Quick start

1. **Define tools and agent** (using `@effect/ai`):

```ts
import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "@effect/ai";
import type { AgentDefinition } from "aiffect-ts";

const GetTime = Tool.make("GetTime", {
  description: "Get the current time",
  success: Schema.String,
});

const DemoToolkit = Toolkit.make(GetTime);
const DemoToolkitLive = DemoToolkit.toLayer({
  GetTime: () => Effect.succeed(new Date().toISOString()),
});

const demoAgent: AgentDefinition = {
  name: "Demo Agent",
  buildPrompt: () =>
    "You are a helpful voice assistant. Keep responses concise and conversational.",
  toolkit: DemoToolkit,
  toolkitLayer: DemoToolkitLive,
};
```

2. **Run a session** — recommended: one call with transport + config (`SessionRunner.run`):

```ts
import { Effect } from "effect";
import {
  WebSocketTransport,
  Session,
  agents,
  ProviderRegistryLive,
  PipelineRegistryLive,
  type SessionConfig,
} from "aiffect-ts";

const AgentRegistryLive = agents({ default: demoAgent });

const sessionConfig: SessionConfig = {
  agent: { agentId: "default", voice: "alloy" },
  pipeline: "realtime",
  provider: "openai",
  inputAudioFormat: "pcm16",
  sampleRate: 24000,
  channels: 1,
  connectionId: crypto.randomUUID(),
};

// On each WebSocket connection — one call (provide all three registries):
const session = SessionRunner.run({
  transport: WebSocketTransport(ws),
  config: sessionConfig,
}).pipe(
  Effect.provide(AgentRegistryLive),
  Effect.provide(ProviderRegistryLive),
  Effect.provide(PipelineRegistryLive),
  Effect.catchAllCause((cause) => Effect.log(`session ended: ${cause}`)),
);

Effect.runFork(session);
```

**Optional: one runtime, per-connection layers** — build the process runtime once, then run each connection with only the connection layer (no `AgentRegistry` needed per call):

```ts
import { Effect } from "effect";
import { Effect, Layer } from "effect";
import {
  makeRuntime,
  Session,
  agents,
  ProviderRegistryLive,
  PipelineRegistryLive,
  type SessionConfig,
} from "aiffect-ts";

const AgentRegistryLive = agents({ default: demoAgent });
const ServerLive = Layer.mergeAll(AgentRegistryLive, ProviderRegistryLive, PipelineRegistryLive);

Effect.runFork(
  Effect.scoped(
    Effect.gen(function* () {
      const runtime = yield* makeRuntime(ServerLive);
      // For each WebSocket connection — SessionRunner.run with runtime needs no env:
      yield* SessionRunner.run({
        transport: WebSocketTransport(ws),
        config: sessionConfig,
        runtime,
      });
    }),
  ),
);
```

3. **Run the example** (serves a test client at http://localhost:8080 and accepts WebSocket voice):

```bash
# OpenAI Realtime
OPENAI_API_KEY=sk-... npx tsx examples/basic.ts

# Gemini Realtime
REALTIME_PROVIDER=gemini GEMINI_API_KEY=... npx tsx examples/basic.ts
```

---

## Example usage

### Basic (manual wiring)

- **examples/basic.ts** — WebSocket transport + Realtime pipeline with OpenAI or Gemini. You provide Transport, Provider, and Agent layers and call `runSession`. Good for one-off servers or when you want full control over layers.

### Session-driven config (recommended)

- **examples/session-config.ts** — Uses **SessionRunner.run** (or **runWithConfig**): pass **SessionConfig** and a Transport layer. The framework resolves the agent from **AgentRegistry**, picks the provider and pipeline from config, and runs the session. Ideal when agents and pipeline type are chosen per connection (e.g. by tenant or feature flags). **SessionRunner.run** is the canonical one-call API; **runWithConfig** is the same behavior; **runSession** is the low-level API when you already have a Pipeline in context.

```ts
import { Effect } from "effect";
import { Session, runWithConfig, agents, type SessionConfig } from "aiffect-ts";

const sessionConfig: SessionConfig = { ... };

// One call — provide AgentRegistry (or use SessionRunner.run with a prebuilt runtime):
const session = SessionRunner.run({ transport: WebSocketTransport(ws), config: sessionConfig }).pipe(
  Effect.provide(AgentRegistryLive),
  Effect.provide(TracingLive),
);
Effect.runFork(session);
```

### Sandwich (STT → LLM → TTS)

- **examples/sandwich.ts** — **SandwichBargeIn** pipeline: OpenAI Whisper (STT) → GPT-4o (LLM) → TTS-1 (TTS) with energy-based barge-in. No realtime API; you provide STT, TTS, and LanguageModel layers.

### Gemini “sandwich” (native realtime)

- **examples/gemini-sandwich.ts** — Same UX as a sandwich (conversational voice with barge-in) but using **Gemini Realtime** (single API, native audio in/out). Uses **RealtimePipeline** + **GeminiRealtimeProvider**.

---

## Use cases

| Use case                        | Pipeline                   | Provider                    | Notes                                                                                                              |
| ------------------------------- | -------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Low-latency voice assistant** | Realtime                   | OpenAI or Gemini            | Full-duplex, native barge-in, single WebSocket.                                                                    |
| **Voice with tools**            | Realtime                   | OpenAI or Gemini            | Same agent + toolkits; tools run in Effect, results sent via `submitToolOutput`.                                   |
| **Multi-tenant / multi-agent**  | Any                        | Any                         | Use **runWithConfig** + **AgentRegistry**; SessionConfig selects `agentId`, `provider`, `pipeline` per connection. |
| **Composed STT/LLM/TTS**        | Sandwich / SandwichBargeIn | OpenAISTT + OpenAITTS + LLM | No realtime API; good when you need a specific STT/TTS/LLM combo.                                                  |
| **Telephony (future)**          | Any                        | Any                         | Add a **TwilioTransport** (or similar); SessionConfig sets `inputAudioFormat: "mulaw"` and optional transform.     |

---

## Configuration

### SessionConfig (per connection)

- **agent** — `agentId` (resolved from registry), `voice`, optional `speed`, `language`, `metadata`.
- **pipeline** — `"realtime"` \| `"sandwich"` \| `"sandwichBargeIn"`.
- **provider** — `"openai"` \| `"gemini"` \| `"composable"`.
- **inputAudioFormat** — `"pcm16"` \| `"mulaw"` \| `"alaw"` (e.g. for Twilio).
- **sampleRate**, **channels** — Audio format.
- **turnDetection** — Optional (threshold, prefix padding, silence, create/interrupt response).
- **connectionId** — Optional; used for tracing and logging.

### Agent definition

- **name** — Display name.
- **buildPrompt(ctx)** — Returns system prompt; `ctx` includes `sessionId`, `metadata`, and `session` (full Session with config + connectionId).
- **toolkit** — `@effect/ai` Toolkit.
- **toolkitLayer** — Layer that provides the tool implementations (handlers).

---

## Observability

- **OpenTelemetry** — Sessions and pipelines emit spans; pipeline events can be logged with a custom tracer (see examples: `FileTraceExporter` for Chrome Trace Event format in `traces/`).
- **Usage metrics** — Optional counters/timers: `inputTokensCounter`, `outputTokensCounter`, `responseDurationTimer` from `observability/UsageMetrics.js`.
- **Pipeline events** — All pipelines emit a unified **PipelineEvent** stream: `TranscriptDelta`, `SpeechStarted`/`SpeechEnded`, `Interrupted`, `ToolCallStarted`/`ToolCallCompleted`/`ToolCallError`, `ResponseStarted`/`ResponseCompleted`, `AudioOutputStarted`/`AudioOutputDone`. Use for logging, analytics, or conversation persistence.

---

## Packaging

Subpath exports (for tree-shaking and clear boundaries):

- **`aiffect-ts`** (default) — Full API: core, WebSocket transport, OpenAI/Gemini providers, pipelines.
- **`aiffect-ts/core`** — Same as default for now; reserved for a future core-only surface.
- **`aiffect-ts/node`** — Same as default; reserved for explicit Node/WebSocket entry.

See [docs/stability.md](docs/stability.md) for what’s stable vs experimental.

---

## Project structure

```
src/
├── index.ts                 # Public API
├── core.ts, node.ts         # Subpath entries
├── framework/               # Transport, Provider, Pipeline, Session, Agent, Config, Errors, Registries
├── pipelines/               # Realtime, Sandwich, SandwichBargeIn
├── providers/               # openai/realtime, gemini/realtime, openai/OpenAISTT, OpenAITTS
├── transports/              # WebSocket
├── schemas/                 # AudioFrame, PipelineEvent (Effect Schema)
├── internal/                # BargeIn, EventBroadcast, ToolDispatch, MessageSocket, etc.
├── test/                    # TestTransport, TestProvider (for contract tests)
├── observability/           # Usage metrics
docs/
├── concepts.md              # Tags, Layers, scope, required env
├── cookbook.md              # Add tool, persist transcript, custom barge-in/audio
├── stability.md             # Stability policy
├── PRODUCTION_ARCHITECTURE.md
examples/
├── basic.ts, session-config.ts, sandwich.ts, gemini-sandwich.ts
tests/
├── pipeline.contract.test.ts
```

---

## Production architecture

For scale (e.g. EC2 with many concurrent calls), see **docs/PRODUCTION_ARCHITECTURE.md**. It covers:

- **ServerContext** — Process-scoped config, pools, feature flags.
- **Stream-binding contract** — Port interfaces for Transport, RealtimeProvider, Pipeline and how Session wires them.
- **Provider utils** — MessageSocket, message loop, queues, interrupt, optional audio transform to keep provider code minimal.
- **Session-driven config** — Single source of truth per connection; agents and pipeline type loaded from Session.
- **Audio** — Pass-through vs transform (e.g. mulaw → PCM) based on Session + provider capabilities.

---

## Performance notes

- **Frame size / sample rate**: Typical PCM16 at 24 kHz uses ~20 ms frames (480 samples). Configurable via SessionConfig and transport options.
- **Queues**: WebSocket transport uses an unbounded inbound queue by default. For production, set `queueCapacity` (e.g. 1024) and optionally `queueDropStrategy` (`"drop-oldest"` or `"drop-newest"`) in `WebSocketTransportOptions` to avoid unbounded buffering.
- **Defaults**: We buffer inbound audio in a queue; with `queueCapacity` the queue is bounded and drops frames when full (documented in transport options).

---

## Scripts

```bash
yarn check    # tsc --noEmit
yarn format   # oxfmt
yarn lint     # oxlint src/
yarn example  # tsx examples/basic.ts
```

---

## License

See repository license.
