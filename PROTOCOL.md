# aiffect-ts Protocol

End-to-end data flow and architecture reference for the `src/` codebase.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Layer Dependency Graph](#layer-dependency-graph)
3. [Session Lifecycle](#session-lifecycle)
4. [Transport Layer — Client ↔ Server](#transport-layer)
5. [Provider Layer — Server ↔ AI](#provider-layer)
6. [RealtimeKernel — Shared Provider Machinery](#realtimekernel)
7. [Pipeline Orchestration](#pipeline-orchestration)
8. [Realtime Pipeline — Full-Duplex Data Flow](#realtime-pipeline)
9. [Sandwich Pipeline — STT → LLM → TTS](#sandwich-pipeline)
10. [SandwichBargeIn Pipeline — With Interruption](#sandwichbargein-pipeline)
11. [Tool Dispatch Flow](#tool-dispatch-flow)
12. [Barge-In Protocol](#barge-in-protocol)
13. [Event System](#event-system)
14. [Observability](#observability)
15. [Error Hierarchy](#error-hierarchy)
16. [Wire Formats by Provider](#wire-formats-by-provider)

---

## Architecture Overview

```
┌──────────┐        ┌────────────┐        ┌────────────┐        ┌──────────┐
│  Client  │◄─ws──►│  Transport │◄─────►│  Pipeline  │◄─────►│ Provider │◄──ws──► AI API
│ (browser)│  pcm16 │ (WebSocket)│ AudioFrame│ (Realtime/ │ AudioFrame│ (OpenAI/ │  JSON
└──────────┘        └────────────┘        │  Sandwich) │        │  Gemini) │
                                          └─────┬──────┘        └──────────┘
                                                │
                                          ┌─────▼──────┐
                                          │   Agent    │
                                          │ (prompt +  │
                                          │  toolkit)  │
                                          └────────────┘
```

The system is a provider-agnostic realtime voice pipeline built on [Effect](https://effect.website). It separates concerns into four layers:

| Layer         | Responsibility                                                       | Context Tag              |
| ------------- | -------------------------------------------------------------------- | ------------------------ |
| **Transport** | Moves raw audio between client and server                            | `Transport`              |
| **Provider**  | Communicates with an AI API (OpenAI, Gemini)                         | `Realtime`, `STT`, `TTS` |
| **Pipeline**  | Orchestrates the voice loop (audio routing, events, tools, barge-in) | `Pipeline`               |
| **Agent**     | Supplies the system prompt and tool definitions                      | `Agent`                  |

Each layer is an Effect `Context.Tag` with an interface (`*Shape`) and one or more implementations composed via `Layer`.

---

## Layer Dependency Graph

```
Session.run(options)
    │
    ▼
┌─────────────────────────────────────────────────────┐
│  Pipeline (e.g. RealtimePipeline)                   │
│    requires: Transport, Realtime, Agent, Scope       │
│    provides: Pipeline { run, events }                │
├─────────────────────────────────────────────────────┤
│  Transport (e.g. WebSocketTransport)                │
│    requires: (nothing)                               │
│    provides: Transport { inbound, send, clear }      │
├─────────────────────────────────────────────────────┤
│  Provider (e.g. OpenAI.realtime())                  │
│    requires: Agent, Scope                            │
│    provides: Realtime { send, receive, events, ... } │
├─────────────────────────────────────────────────────┤
│  Agent (user-supplied)                               │
│    requires: (nothing)                               │
│    provides: Agent { name, buildPrompt, toolkit }    │
├─────────────────────────────────────────────────────┤
│  SessionContext (auto-created)                       │
│    provides: SessionContext { sessionId }             │
└─────────────────────────────────────────────────────┘
```

`Session.run` composes these into a single layer, builds it within a scope, and runs `Pipeline.run` to completion.

---

## Session Lifecycle

```
Session.run(options)
  │
  ├─ 1. resolveAgent(options)           → AgentSpec
  ├─ 2. Layer.succeed(Agent, agent)     → Agent layer
  ├─ 3. makeSessionContext(...)         → SessionContext layer
  ├─ 4. Compose layers:
  │      pipeline ← transport ← provider ← agent ← sessionContext ← scope
  │
  ├─ 5. Effect.scoped(Layer.build(appLayer))
  │      ├─ Provider connects to AI API (WebSocket)
  │      ├─ Transport binds to client WebSocket
  │      └─ Pipeline initialises internal state
  │
  ├─ 6. pipeline.run                    → starts the voice loop
  │      ├─ Concurrent fibers begin (inbound, outbound, events)
  │      └─ Runs until transport closes or an error occurs
  │
  └─ 7. Scope finalisation
         ├─ Queues shut down
         ├─ Provider WebSocket closed
         └─ Transport WebSocket closed
```

---

## Transport Layer

The transport moves raw PCM16 audio between the client (e.g. browser) and the pipeline.

### WebSocket Transport (`transports/WebSocket.ts`)

```
Client (browser)                              Server
─────────────────                             ──────
ws.send(pcm16Buffer) ──── binary ────────►  Transport.inbound (Stream<AudioFrame>)
                                                │
                                                ▼ (Pipeline processes)
                                                │
ws.onmessage(buffer)  ◄─── binary ──────── Transport.send(AudioFrame)
ws.onmessage(json)    ◄─── {"type":"clear"} Transport.clear
```

**Inbound path:**

1. Client sends raw PCM16 binary frames over WebSocket
2. `ws.on("message")` wraps each `Buffer` into an `AudioFrame` (samples, sampleRate, channels, timestamp)
3. Frames are offered to a `Queue<AudioFrame>` (unbounded or bounded with drop strategy)
4. `Transport.inbound` exposes the queue as a `Stream<AudioFrame>`

**Outbound path:**

1. Pipeline calls `Transport.send(frame)` with an `AudioFrame`
2. The raw `frame.samples` bytes are sent over WebSocket as binary
3. `Transport.clear` sends a JSON `{ type: "clear" }` message to signal the client to flush its audio buffer

**AudioFrame structure:**

```
{ samples: Uint8Array, sampleRate: number, channels: number, timestamp: number }
```

---

## Provider Layer

Providers translate between the pipeline's `AudioFrame`/`PipelineEvent` model and a specific AI API's wire protocol.

### Provider Interfaces

| Service    | Interface                                                                       | Used By            |
| ---------- | ------------------------------------------------------------------------------- | ------------------ |
| `Realtime` | `send`, `receive`, `events`, `interrupt`, `submitToolOutput`, `requestResponse` | Realtime pipeline  |
| `STT`      | `transcribe(audio) → Stream<TranscriptDelta>`                                   | Sandwich pipelines |
| `TTS`      | `synthesize(text) → Stream<AudioFrame>`                                         | Sandwich pipelines |

### Realtime Shape

```typescript
interface RealtimeShape {
  send(frame: AudioFrame): Effect<void>; // Pipeline → Provider (audio in)
  receive: Stream<AudioFrame>; // Provider → Pipeline (audio out)
  events: Stream<PipelineEvent>; // Provider → Pipeline (lifecycle events)
  interrupt(playedAudioMs?: number): Effect<void>; // Pipeline → Provider (barge-in)
  submitToolOutput(callId, name, output): Effect<void>;
  requestResponse(): Effect<void>; // Trigger a new response after tool output
}
```

---

## RealtimeKernel

Both OpenAI and Gemini providers share a common kernel (`providers/RealtimeKernel.ts`) that handles queue management, message loop, dispatch, and `Realtime` shape construction.

### RealtimeAdapter Interface

Each provider implements a `RealtimeAdapter<Msg, State>`:

```
┌──────────────────────────────────────────────────┐
│  RealtimeAdapter                                 │
│                                                  │
│  connect(agent, ctx) → MessageSocket             │
│  handler(msg, state) → { actions, nextState }    │  ◄── Pure function
│  onSessionReady?(socket) → Effect                │
│  onInterrupt(ctx) → Effect                       │
│  encodeSend(frame) → JSON                        │
│  encodeToolOutput(callId, name, output) → JSON   │
│  encodeRequestResponse?() → JSON | null          │
│  schema: Schema<Msg>                             │
│  initialState: State                             │
└──────────────────────────────────────────────────┘
```

### Kernel Message Loop

```
Provider API (WebSocket)
        │
        ▼ raw JSON
   MessageSocket.inbound (Stream<unknown>)
        │
        ▼ Schema.decodeUnknown (boundary decode)
   Typed Msg (e.g. OpenAIServerMessage)
        │
        ▼ adapter.handler(msg, state)
   { actions: RealtimeAction[], nextState }
        │
        ▼ dispatch each action
   ┌────┴────────────────────────────────────┐
   │ AudioFrame  → Queue.offer(audioQueue)   │  → Realtime.receive stream
   │ Event       → Queue.offer(eventQueue)   │  → Realtime.events stream
   │ SessionReady → onSessionReady + flush   │
   │ ClearAudioQueue → Queue.takeAll(audio)  │
   │ Ignored     → (no-op)                   │
   └─────────────────────────────────────────┘
```

### Kernel Send Path

```
Pipeline calls Realtime.send(frame)
        │
        ▼
   adapter.encodeSend(frame) → JSON message
        │
        ▼
   MessageSocket.send(json) → ws.send(JSON.stringify(msg))
        │
        ▼
   Provider API WebSocket
```

If `bufferSendUntilReady` is set, frames are buffered in a queue until `SessionReady` is dispatched, then drained.

---

## Pipeline Orchestration

Pipelines compose Transport, Provider, and Agent into a runnable voice loop. All pipelines produce:

```typescript
interface PipelineShape {
  run: Effect<void, PipelineError>; // The main loop (blocks until session ends)
  events: Stream<PipelineEvent>; // Subscribe to lifecycle events
}
```

Three pipeline implementations are available:

| Pipeline                  | Mode                             | Providers Used                  |
| ------------------------- | -------------------------------- | ------------------------------- |
| `RealtimePipeline`        | Full-duplex bidirectional        | `Realtime`                      |
| `SandwichPipeline`        | STT → LLM → TTS (turn-based)     | `STT` + `TTS` + `LanguageModel` |
| `SandwichBargeInPipeline` | Sandwich + energy-based barge-in | `STT` + `TTS` + `LanguageModel` |

---

## Realtime Pipeline

Full-duplex audio with three concurrent fibers:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Realtime Pipeline                                                      │
│                                                                         │
│  ┌─── Fiber 1: INBOUND ──────────────────────────────────────────────┐  │
│  │                                                                    │  │
│  │  Transport.inbound                                                 │  │
│  │       │                                                            │  │
│  │       ▼ inputTransform (optional resampling/filtering)             │  │
│  │       │                                                            │  │
│  │       ▼ Realtime.send(frame)  ──► Provider API                    │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─── Fiber 2: OUTBOUND ─────────────────────────────────────────────┐  │
│  │                                                                    │  │
│  │  Realtime.receive  ◄── Provider API                               │  │
│  │       │                                                            │  │
│  │       ▼ outputTransform (optional resampling/filtering)            │  │
│  │       │                                                            │  │
│  │       ▼ bargeIn.isGated? ──yes──► (drop frame)                    │  │
│  │       │no                                                          │  │
│  │       ▼ bargeIn.trackPlayback(durationMs)                         │  │
│  │       │                                                            │  │
│  │       ▼ Transport.send(frame) ──► Client                          │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─── Fiber 3: EVENTS ───────────────────────────────────────────────┐  │
│  │                                                                    │  │
│  │  Realtime.events  ◄── Provider API                                │  │
│  │       │                                                            │  │
│  │       ├─► bargeIn.onEvent(event)         (state machine update)   │  │
│  │       ├─► eventBroadcast.publish(event)  (fan-out to subscribers) │  │
│  │       │                                                            │  │
│  │       ├─ if ToolCallStarted:                                      │  │
│  │       │    ├─► dispatchToolCall(event, agent) → ToolCallCompleted │  │
│  │       │    ├─► Realtime.submitToolOutput(callId, name, output)    │  │
│  │       │    └─► pendingToolOutput = true                           │  │
│  │       │                                                            │  │
│  │       └─ if ResponseCompleted && pendingToolOutput:               │  │
│  │            └─► Realtime.requestResponse()  (trigger follow-up)    │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  All three fibers race: first to complete (or error) ends the session.  │
└─────────────────────────────────────────────────────────────────────────┘
```

### End-to-End Realtime Data Flow (Single Turn)

```
 1. User speaks into microphone
 2. Client captures PCM16 → sends binary frame over WebSocket
 3. Transport.inbound yields AudioFrame
 4. [Fiber 1] inputTransform → Realtime.send(frame)
 5. Provider encodes to wire format (e.g. base64 in input_audio_buffer.append)
 6. Provider API WebSocket sends to AI model
 7. AI model detects speech end (server VAD / turn detection)
 8. AI generates response — streams audio + events back over WebSocket
 9. Provider handler decodes messages → RealtimeAction[]
10. AudioFrame actions → audioQueue → Realtime.receive stream
11. Event actions → eventQueue → Realtime.events stream
12. [Fiber 2] Receives audio frames, checks barge-in gate, sends to Transport
13. Transport.send() → binary frame over WebSocket → client plays audio
14. [Fiber 3] Processes events (barge-in state, event broadcast, tool dispatch)
15. If tool call: dispatch → submit output → request follow-up response
16. Session ends when transport closes (client disconnects)
```

---

## Sandwich Pipeline

Turn-based STT → LLM → TTS (no direct AI realtime API):

```
┌──────────────────────────────────────────────────────────────────────┐
│  Sandwich Pipeline                                                    │
│                                                                       │
│  Transport.inbound                                                    │
│       │                                                               │
│       ▼ STT.transcribe(audioStream)                                  │
│       │                                                               │
│       ▼ Stream<TranscriptDelta> (filter: isFinal + non-empty)        │
│       │                                                               │
│       ▼ For each final transcript:                                   │
│       │                                                               │
│       │  ┌─── processTranscript(text) ──────────────────────────┐    │
│       │  │                                                       │    │
│       │  │  1. Emit TranscriptDelta(user, text)                 │    │
│       │  │  2. chat.generateText(prompt, toolkit)               │    │
│       │  │     └─► @effect/ai Chat with LanguageModel           │    │
│       │  │  3. Emit TranscriptDelta(assistant, response)        │    │
│       │  │  4. Emit SpeechStarted                               │    │
│       │  │  5. TTS.synthesize(response) → Stream<AudioFrame>    │    │
│       │  │     └─► Transport.send(frame) for each frame         │    │
│       │  │  6. Emit SpeechEnded                                 │    │
│       │  │                                                       │    │
│       │  └───────────────────────────────────────────────────────┘    │
│       │                                                               │
│       ▼ (repeat for next transcript)                                 │
└──────────────────────────────────────────────────────────────────────┘
```

---

## SandwichBargeIn Pipeline

Extends the Sandwich pattern with energy-based barge-in and streaming LLM with sentence chunking:

```
┌──────────────────────────────────────────────────────────────────────────┐
│  SandwichBargeIn Pipeline                                                │
│                                                                          │
│  ┌─── Fiber 1: INBOUND MONITOR ─────────────────────────────────────┐   │
│  │                                                                    │   │
│  │  Transport.inbound                                                 │   │
│  │       │                                                            │   │
│  │       ├─► Queue.offer(audioQueue, frame)  (feed STT)              │   │
│  │       │                                                            │   │
│  │       └─► pcm16Rms(frame.samples)  (compute energy)              │   │
│  │            │                                                       │   │
│  │            ├─ energy > threshold?                                  │   │
│  │            │   ├─ yes: increment speechFrameCount                 │   │
│  │            │   │   └─ count >= 3 && assistantSpeaking?            │   │
│  │            │   │       └─ yes: BARGE-IN                           │   │
│  │            │   │            ├─ Fiber.interrupt(currentTurn)       │   │
│  │            │   │            ├─ Transport.clear                    │   │
│  │            │   │            └─ Emit Interrupted                   │   │
│  │            │   └─ no: reset speechFrameCount                      │   │
│  │            └─                                                      │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌─── Fiber 2: TURN PROCESSING ──────────────────────────────────────┐   │
│  │                                                                    │   │
│  │  STT.transcribe(audioQueue stream)                                │   │
│  │       │                                                            │   │
│  │       ▼ For each final transcript:                                │   │
│  │       │                                                            │   │
│  │       ├─ Interrupt previous turn fiber (if any)                   │   │
│  │       │                                                            │   │
│  │       └─ Fork processTranscript(text):                            │   │
│  │                                                                    │   │
│  │           ┌─ Producer (concurrent) ────────────────────────────┐  │   │
│  │           │  chat.streamText(prompt) → token stream            │  │   │
│  │           │  buffer tokens → split on sentence boundaries      │  │   │
│  │           │  Queue.offer(sentenceQueue, sentence)              │  │   │
│  │           └────────────────────────────────────────────────────┘  │   │
│  │                        │                                          │   │
│  │                   sentenceQueue                                   │   │
│  │                        │                                          │   │
│  │           ┌─ Consumer (concurrent) ────────────────────────────┐  │   │
│  │           │  For each sentence:                                │  │   │
│  │           │    TTS.synthesize(sentence)                        │  │   │
│  │           │    → Transport.send(frame) for each audio frame   │  │   │
│  │           └────────────────────────────────────────────────────┘  │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  Both fibers race: first to complete ends the session.                   │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Tool Dispatch Flow

When the AI model requests a tool call, the pipeline handles it end-to-end:

```
Provider API sends ToolCallStarted event
       │
       ▼
[Fiber 3 - Events] receives ToolCallStarted { callId, name, arguments }
       │
       ▼
dispatchToolCall(event, agent)
       │
       ├─ Parse arguments (JSON.parse)
       ├─ agent.handleToolCall(name, args)
       │    └─ Resolves tool from toolkit, executes handler
       │    └─ Wrapped in span: tool.execute/{name}
       │
       ├─ Success → ToolCallCompleted { status: "success", result }
       └─ Failure → ToolCallCompleted { status: "failure", error: { reason } }
              │
              ▼
       logEvent(completed) + eventBroadcast.publish(completed)
              │
              ▼
       Realtime.submitToolOutput(callId, name, output)
              │
              ▼
       Provider encodes → wire message → Provider API
              │
              ▼
       pendingToolOutput = true
              │
              ▼
       When ResponseCompleted arrives && pendingToolOutput:
              └─ Realtime.requestResponse() → triggers follow-up AI response
```

### Tool Output Serialisation

`serializeToolOutput` prepares tool results for transmission:

- Strips metadata keys (`callId`, `call_id`, `name`, `status`, `__meta`, `_callId`)
- Handles `BigInt` (converts to string)
- Handles circular references (replaces with `"[Circular]"`)
- Falls back to `{ error: "unserializable_output" }` on failure

### Tool Failure Semantics

When a tool handler fails:

1. The failure is caught and converted to `ToolCallCompleted { status: "failure", error: { reason } }`
2. The AI receives the error via `submitToolOutput` (the model can retry or adjust)
3. **The pipeline continues** — tool failure is a normal case, not a session-ending error
4. `AgentError` is not propagated; it is swallowed and surfaced to the model as structured output

---

## Barge-In Protocol

Barge-in interrupts the AI's audio response when the user starts speaking.

### Barge-In Modes

| Mode                      | Pipeline        | Trigger                                          | Mechanism                                                                              |
| ------------------------- | --------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| **Provider barge-in**     | Realtime        | Provider emits `SpeechStarted` (server-side VAD) | Event-driven state machine; calls `Realtime.interrupt(playedAudioMs)`                  |
| **Energy-based barge-in** | SandwichBargeIn | Client-side RMS energy per frame                 | `pcm16Rms(samples) > threshold` for N consecutive frames; `Fiber.interrupt(turnFiber)` |

Realtime uses provider events (the AI API signals when the user speaks). SandwichBargeIn uses raw audio energy because there is no realtime API — the pipeline must detect speech locally.

### Realtime Pipeline Barge-In (State Machine)

```
State: { isInterrupted, assistantSpeaking, playedAudioMs }

Events → State Transitions:
─────────────────────────────────────────────────────
AudioOutputStarted  → assistantSpeaking=true, isInterrupted=false, playedAudioMs=0
AudioOutputDone     → assistantSpeaking=false
ResponseCompleted   → assistantSpeaking=false
Interrupted         → isInterrupted=true, assistantSpeaking=false, playedAudioMs=0
SpeechStarted       → if assistantSpeaking: trigger barge-in
                       ├─ Realtime.interrupt(playedAudioMs)
                       ├─ Transport.clear (flush client buffer)
                       └─ Reset state

Outbound gating:
  bargeIn.isGated == true → drop outbound audio frames
  bargeIn.isGated == false → forward frames + trackPlayback(durationMs)
```

### SandwichBargeIn Barge-In (Energy-Based)

```
For each inbound audio frame:
  1. Compute RMS energy: pcm16Rms(samples)
  2. If energy > 0.02: increment speechFrameCount
     else: reset speechFrameCount to 0
  3. If speechFrameCount >= 3 AND assistantSpeaking:
     → Fiber.interrupt(currentTurnFiber)
     → Transport.clear
     → Emit Interrupted event
```

### Provider-Specific Interrupt Handling

**OpenAI:**

1. Send `response.cancel` (if response active)
2. Send `conversation.item.truncate` with `audio_end_ms` (if item active)
3. Clear audio queue
4. Reset handler state
5. Emit `Interrupted` event

**Gemini:**

1. Clear audio queue
2. Emit `Interrupted` event

---

## Event System

### Pipeline Events

All events are Effect `Schema.TaggedClass` instances flowing through `PubSub`-based broadcast:

| Event                | Fields                                                                | When                               |
| -------------------- | --------------------------------------------------------------------- | ---------------------------------- |
| `TranscriptDelta`    | role, text, isFinal                                                   | User or assistant transcript chunk |
| `SpeechStarted`      | timestamp                                                             | Assistant begins speaking          |
| `SpeechEnded`        | timestamp                                                             | Assistant finishes speaking        |
| `Interrupted`        | timestamp                                                             | Barge-in triggered                 |
| `ToolCallStarted`    | callId, name, arguments                                               | AI requests a tool call            |
| `ToolCallCompleted`  | callId, name, status, result?, error?                                 | Tool execution finished            |
| `ResponseStarted`    | responseId, timestamp                                                 | AI response begins                 |
| `ResponseCompleted`  | responseId, timestamp, status, inputTokens, outputTokens, audioFrames | AI response ends                   |
| `AudioOutputStarted` | responseId, timestamp                                                 | Audio generation begins            |
| `AudioOutputDone`    | responseId, timestamp, frames                                         | Audio generation ends              |

### EventBroadcast

```
Provider events ──► eventBroadcast.publish(event)
                          │
                          ▼
                    PubSub<PipelineEvent>
                          │
                          ▼
              eventBroadcast.subscribe (Stream<PipelineEvent>)
                          │
                          ▼
              Pipeline.events (exposed to session runner)
```

---

## Observability

### Observability Matrix

| Pipeline        | Event logging                  | Spans                                                                          | Token metrics                                                                      |
| --------------- | ------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Realtime        | Yes (via `instrumentRealtime`) | Yes (`tool.execute/{name}`, `realtime.interrupt`, `realtime.submitToolOutput`) | Yes (`ResponseCompleted` → `inputTokensCounter`, `outputTokensCounter`)            |
| Sandwich        | Yes (via `logEvent`)           | Yes (`sandwich.turn`)                                                          | Yes (synthetic `ResponseCompleted` after TTS; token counts from Chat if available) |
| SandwichBargeIn | Yes (via `logEvent`)           | Yes (`sandwich.turn`, `sandwich.bargeIn`)                                      | Yes (synthetic `ResponseCompleted`; streaming mode uses 0 tokens)                  |

### Event Logging (`EventLogger.ts`)

Every event is logged with structured annotations:

- Non-final `TranscriptDelta` events are suppressed (only finals logged)
- Each log carries an `event` annotation matching the schema tag
- Tool calls include `tool.name`, `tool.callId`, `tool.status`
- Responses include `response.id`, token counts, audio frame counts

### Usage Metrics (`UsageMetrics.ts`)

Two Effect `Metric.Counter` instances:

- `realtime_input_tokens` — incremented from `ResponseCompleted.inputTokens`
- `realtime_output_tokens` — incremented from `ResponseCompleted.outputTokens`

### Instrumented Realtime (`InstrumentedRealtime.ts`)

Wraps the raw `Realtime` service with:

- `events` stream: taps each event → `logEvent()` + token metric tracking
- `interrupt`: wrapped in `realtime.interrupt` span
- `submitToolOutput`: wrapped in `realtime.submitToolOutput` span with callId/name attributes

Applied at the pipeline level — providers stay unaware of tracing.

---

## Error Hierarchy

```
                    Data.TaggedError
                          │
          ┌───────────────┼───────────────┐──────────────┐
          ▼               ▼               ▼              ▼
   TransportError   ProviderError   PipelineError   ConfigError
   (WebSocket I/O)  (AI API comm)  (pipeline run)  (bad config)
                                                         │
                                                         ▼
                                                    AgentError
                                                   (tool handler)
```

| Error            | When                                            | Key Fields                |
| ---------------- | ----------------------------------------------- | ------------------------- |
| `TransportError` | WebSocket send/receive failure                  | reason, cause?            |
| `ProviderError`  | AI API connection, message decode, send failure | provider, reason, cause?  |
| `PipelineError`  | Pipeline-level orchestration failure            | reason, cause?            |
| `ConfigError`    | Missing agent, invalid config                   | reason                    |
| `AgentError`     | Tool handler failure                            | reason, toolName?, cause? |

---

## Wire Formats by Provider

### OpenAI Realtime

**Outbound (server → OpenAI):**

| Action             | Wire Message                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| Send audio         | `{ type: "input_audio_buffer.append", audio: "<base64>" }`                                      |
| Session setup      | `{ type: "session.update", session: { modalities, instructions, voice, tools, ... } }`          |
| Submit tool output | `{ type: "conversation.item.create", item: { type: "function_call_output", call_id, output } }` |
| Request response   | `{ type: "response.create" }`                                                                   |
| Cancel response    | `{ type: "response.cancel" }`                                                                   |
| Truncate audio     | `{ type: "conversation.item.truncate", item_id, content_index, audio_end_ms }`                  |

**Inbound (OpenAI → server) — 22 message types parsed via Schema.Union:**

| Message                                                 | Maps To                                         |
| ------------------------------------------------------- | ----------------------------------------------- |
| `response.audio.delta`                                  | `AudioFrame` action                             |
| `response.audio_transcript.delta`                       | `TranscriptDelta` event (assistant, non-final)  |
| `response.audio_transcript.done`                        | `TranscriptDelta` event (assistant, final)      |
| `input_audio_buffer.speech_started`                     | `SpeechStarted` event                           |
| `input_audio_buffer.speech_stopped`                     | `SpeechEnded` event                             |
| `response.created`                                      | `ResponseStarted` event                         |
| `response.done`                                         | `ResponseCompleted` event (with token usage)    |
| `response.audio.done`                                   | `AudioOutputDone` event                         |
| `response.function_call_arguments.done`                 | `ToolCallStarted` event                         |
| `response.output_item.added`                            | `AudioOutputStarted` event (when audio content) |
| `conversation.item.input_audio_transcription.completed` | `TranscriptDelta` event (user, final)           |
| `session.created` / `session.updated`                   | `SessionReady` action                           |

**Handler state:**

```
{ currentResponseId, currentItemId, currentContentIndex, responseAudioFrames }
```

### Gemini Live

**Outbound (server → Gemini):**

| Action             | Wire Message                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| Send audio         | `{ realtimeInput: { audio: { mimeType: "audio/pcm;rate=24000", data: "<base64>" } } }`                        |
| Session setup      | `{ setup: { model, generationConfig, systemInstruction, tools, ... } }`                                       |
| Submit tool output | `{ toolResponse: { functionResponses: [{ id, name, response: { result } }] } }`                               |
| Greeting trigger   | `{ clientContent: { turns: { role: "user", parts: [{ text: "Say your greeting." }] }, turnComplete: true } }` |

**Inbound (Gemini → server) — single struct with optional fields:**

| Field                                        | Maps To                             |
| -------------------------------------------- | ----------------------------------- |
| `setupComplete`                              | `SessionReady` action               |
| `serverContent.modelTurn.parts[].inlineData` | `AudioFrame` action (base64 PCM)    |
| `serverContent.outputTranscription`          | `TranscriptDelta` event (assistant) |
| `serverContent.inputTranscription`           | `TranscriptDelta` event (user)      |
| `serverContent.interrupted`                  | `ClearAudioQueue` action            |
| `serverContent.turnComplete`                 | `ResponseCompleted` event           |
| `toolCall.functionCalls`                     | `ToolCallStarted` event(s)          |
| `usageMetadata`                              | Token counts on `ResponseCompleted` |

**Handler state:**

```
{ responseActive, responseId, audioFrameCount, responseIndex }
```

---

## Complete Request-Response Trace

A single voice turn through the Realtime pipeline, end to end:

```
 ┌──────┐        ┌───────────┐      ┌──────────┐      ┌──────────┐      ┌────────┐
 │Client│        │ Transport │      │ Pipeline │      │ Provider │      │AI API  │
 └──┬───┘        └─────┬─────┘      └────┬─────┘      └────┬─────┘      └───┬────┘
    │                   │                 │                  │                │
    │ ws.send(pcm16)    │                 │                  │                │
    │──────────────────►│                 │                  │                │
    │                   │ AudioFrame      │                  │                │
    │                   │────────────────►│                  │                │
    │                   │                 │ inputTransform   │                │
    │                   │                 │ Realtime.send()  │                │
    │                   │                 │─────────────────►│                │
    │                   │                 │                  │ encodeSend()   │
    │                   │                 │                  │ ws.send(json)  │
    │                   │                 │                  │───────────────►│
    │                   │                 │                  │                │
    │                   │                 │                  │  ◄─ AI thinks ─│
    │                   │                 │                  │                │
    │                   │                 │                  │ ws.message     │
    │                   │                 │                  │◄───────────────│
    │                   │                 │                  │ decode+handle  │
    │                   │                 │   AudioFrame     │                │
    │                   │                 │◄─────────────────│                │
    │                   │                 │ outputTransform  │                │
    │                   │                 │ bargeIn check    │                │
    │                   │  AudioFrame     │                  │                │
    │                   │◄────────────────│                  │                │
    │ ws.send(pcm16)    │                 │                  │                │
    │◄──────────────────│                 │                  │                │
    │                   │                 │                  │                │
    │                   │                 │  PipelineEvent   │                │
    │                   │                 │◄─────────────────│                │
    │                   │                 │ bargeIn.onEvent  │                │
    │                   │                 │ broadcast+log    │                │
    │                   │                 │                  │                │
```
