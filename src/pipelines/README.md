# Pipelines

Pipeline implementations that orchestrate the voice loop: route audio between Transport and Provider, handle events (transcripts, tool calls), and manage barge-in where supported.

---

## Pipeline Types


| Pipeline            | Module               | Mode                       | Barge-in                                | Use case                              |
| ------------------- | -------------------- | -------------------------- | --------------------------------------- | ------------------------------------- |
| **Realtime**        | `Realtime.ts`        | Full-duplex                | Event-driven (provider `SpeechStarted`) | OpenAI Realtime, Gemini Live          |
| **Sandwich**        | `Sandwich.ts`        | Turn-based STT → LLM → TTS | None                                    | Composed STT/LLM/TTS, no realtime API |
| **SandwichBargeIn** | `SandwichBargeIn.ts` | Turn-based + interrupt     | Energy-based (inbound audio threshold)  | Same as Sandwich with user interrupt  |


---

## Technical Flows

### Realtime Pipeline (`Realtime.ts`)

Three concurrent fibers:

1. **Inbound** — `Transport.inbound` → `RealtimeAudioConfig.inputTransform` → `Realtime.send`
2. **Outbound** — `Realtime.receive` → `RealtimeAudioConfig.outputTransform` → (barge-in gating) → `Transport.send`; each frame updates playback position via `BargeIn.trackPlayback`
3. **Events** — `Realtime.events` → `BargeIn.onEvent` → `EventBroadcast.publish` → tool dispatch (`ToolDispatch`) → `Realtime.submitToolOutput` (+ `requestResponse` when required)

Barge-in is driven by provider events: when the user speaks, the provider emits `SpeechStarted`; `BargeIn.onEvent` calls `Realtime.interrupt` and `Transport.clear`, and gates outbound until the next turn.

**Composition:** Uses `BargeIn`, `EventBroadcast`, `ToolDispatch`; wraps `Realtime` with `instrumentRealtime` for logging and token metrics.

### Sandwich Pipeline (`Sandwich.ts`)

Single logical flow (no barge-in):

1. **Inbound** — `Transport.inbound` → `STT.transcribe` → final transcript
2. **Turn** — On final transcript: emit `TranscriptDelta` (user) → `LanguageModel.generateText` (with toolkit) → emit assistant transcript → `TTS.synthesize` → `Transport.send` → emit `SpeechStarted` / `SpeechEnded`
3. **Events** — Emitted by the pipeline (same `PipelineEvent` types as Realtime)

Implemented via shared **SandwichCore** with `bargeIn: undefined`.

### SandwichBargeIn Pipeline (`SandwichBargeIn.ts`)

Same STT → LLM → TTS flow as Sandwich, but:

- Uses **streaming** LLM (`streamText`) and sentence-chunked TTS.
- Runs an **inbound energy monitor** (see `BargeInEnergy.ts`): when inbound audio energy exceeds `energyThreshold` for `frameThreshold` consecutive frames while the assistant is speaking, the pipeline interrupts (stops TTS, clears transport, resets state).

Configure via `SandwichBargeInPipeline({ energyThreshold?, frameThreshold? })`; defaults in `BargeInConfig.ts`.

Implemented via **SandwichCore** with `bargeIn: config`.

---

## Supporting Modules


| Module                | Role                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **SandwichCore.ts**   | Shared STT → LLM → TTS orchestration; supports non-streaming (Sandwich) and streaming + barge-in (SandwichBargeIn).                      |
| **BargeIn.ts**        | Event-driven barge-in for Realtime: `onEvent`, `isGated`, `trackPlayback`; calls `Realtime.interrupt` and `Transport.clear`.             |
| **BargeInEnergy.ts**  | Energy-based barge-in for SandwichBargeIn: `createInboundMonitor` yields an effect that watches inbound frames and triggers interrupt.   |
| **BargeInConfig.ts**  | `BargeInConfig` type and defaults (`DEFAULT_ENERGY_THRESHOLD`, `DEFAULT_FRAME_THRESHOLD`).                                               |
| **EventBroadcast.ts** | Pub/sub for `PipelineEvent`; pipelines publish, subscribers run via `Session.runWithEvents` or custom logic.                             |
| **ToolDispatch.ts**   | Given `ToolCallStarted` and `Agent`, runs `agent.handleToolCall`, returns `ToolCallCompleted` (or error); used by Realtime events fiber. |


---

## Data Flow Summary

```
Realtime:
  Client ──► Transport.inbound ──► [transform] ──► Realtime.send ──► AI API
  AI API  ──► Realtime.receive ──► [transform] ──► [BargeIn gate] ──► Transport.send ──► Client
  Realtime.events ──► BargeIn + EventBroadcast + ToolDispatch (submitToolOutput / requestResponse)

Sandwich / SandwichBargeIn:
  Client ──► Transport.inbound ──► STT.transcribe ──► transcript
  transcript ──► LLM (generateText / streamText) ──► text ──► TTS.synthesize ──► Transport.send ──► Client
  (SandwichBargeIn: inbound monitor can interrupt TTS and clear transport)
```

See [PROTOCOL.md](../../PROTOCOL.md) for full session lifecycle, layer graph, and wire formats.