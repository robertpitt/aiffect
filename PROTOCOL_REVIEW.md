# Protocol Review

Critical analysis of the aiffect-ts protocol for improvements, simplification, consistency alignment, and complexity reduction. References [PROTOCOL.md](./PROTOCOL.md) for the baseline design.

---

## Executive Summary

| Area                            | Severity | Summary                                                                                         |
| ------------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| Pipeline fragmentation          | Medium   | Three pipelines with duplicated logic; SandwichBargeIn reimplements barge-in instead of reusing |
| Barge-in duality                | Medium   | Two unrelated barge-in mechanisms (event-driven vs energy-based) with no shared abstraction     |
| SessionConfig vs SessionOptions | Low      | SessionConfig is defined but unused; Session.run uses a different options shape                 |
| Agent resolution duality        | Low      | Two ways to supply agent (agent vs agentId+agents) add API surface                              |
| Provider adapter optionality    | Low      | Many optional RealtimeAdapter fields lead to provider-specific branching                        |
| Observability asymmetry         | Low      | Instrumentation only on Realtime pipeline; Sandwich pipelines lack parity                       |
| Magic numbers                   | Low      | Barge-in thresholds hardcoded in SandwichBargeIn                                                |
| Tool follow-up pattern          | Low      | pendingToolOutputRef + requestResponse is provider-specific; Gemini has no-op                   |

---

## 1. Pipeline Fragmentation & Duplication

### Current State

Three pipelines exist with overlapping responsibilities:

| Pipeline        | Fibers                        | Barge-In                      | Tool Handling          | Event Model    |
| --------------- | ----------------------------- | ----------------------------- | ---------------------- | -------------- |
| Realtime        | 3 (inbound, outbound, events) | Event-driven (BargeIn module) | Inline in events fiber | Provider emits |
| Sandwich        | 1 (sequential)                | None                          | Via Chat.generateText  | Pipeline emits |
| SandwichBargeIn | 2 (inbound monitor, turns)    | Energy-based (inline)         | Via Chat.streamText    | Pipeline emits |

### Issues

1. **Sandwich vs SandwichBargeIn duplication** — `processTranscript` logic is nearly identical; SandwichBargeIn adds sentence chunking and streaming but otherwise mirrors Sandwich. Both have their own `emit`, `agentContext`, `chat` setup, and `DefaultSessionContext`.

2. **Barge-in is not shared** — Realtime uses `BargeIn.ts` (event-driven, provider signals `SpeechStarted`). SandwichBargeIn implements energy-based barge-in inline with `pcm16Rms`, `speechFrameCount`, `assistantSpeaking`, etc. No shared abstraction.

3. **Different concurrency models** — Realtime races 3 fibers; Sandwich is single-threaded; SandwichBargeIn races 2 fibers. Mental model shifts between pipelines.

### Recommendations

| Recommendation                                                                                                                                                                                                                                        | Effort | Impact                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------- |
| **Extract shared Sandwich core** — Factor `processTranscript`, `emit`, and turn orchestration into a shared module. Sandwich and SandwichBargeIn become thin wrappers that differ only in: (a) streaming vs non-streaming LLM, (b) barge-in presence. | Medium | High — reduces duplication, single place to fix bugs                |
| **Unify barge-in behind an interface** — Define `BargeInDetector { onFrame?, onEvent?, shouldInterrupt }` or similar. Realtime’s BargeIn uses `onEvent`; SandwichBargeIn uses `onFrame` (energy). Both could satisfy the same contract.               | Medium | Medium — clearer abstraction, easier to add new barge-in strategies |
| **Consider SandwichBargeIn as Sandwich + BargeInLayer** — If energy-based barge-in could be expressed as a layer that wraps the outbound path (similar to Realtime’s BargeIn), SandwichBargeIn might collapse to Sandwich + config.                   | High   | High — fewer pipelines to maintain                                  |

---

## 2. Barge-In Protocol Inconsistency

### Current State

**Realtime barge-in (event-driven):**

- Provider emits `SpeechStarted` when user speaks (server-side VAD).
- `BargeIn.onEvent` reacts: if `assistantSpeaking`, calls `realtime.interrupt(playedAudioMs)` and `transport.clear`.
- State: `isInterrupted`, `assistantSpeaking`, `playedAudioMs`.

**SandwichBargeIn barge-in (energy-based):**

- No provider events; pipeline computes `pcm16Rms` per frame.
- If `energy > 0.02` for 3+ consecutive frames and `assistantSpeaking`, triggers barge-in.
- Actions: `Fiber.interrupt(currentTurnFiber)`, `transport.clear`, emit `Interrupted`.

### Issues

1. **Different trigger sources** — Realtime: provider events. SandwichBargeIn: raw audio energy. Same concept (user speaks over assistant), different mechanisms.

2. **Different interrupt targets** — Realtime: `Realtime.interrupt()` (provider-specific: cancel response, truncate). SandwichBargeIn: `Fiber.interrupt(turnFiber)` (kill local LLM/TTS pipeline).

3. **Magic numbers** — `BARGE_IN_ENERGY_THRESHOLD = 0.02`, `SPEECH_FRAME_THRESHOLD = 3` are hardcoded. Not configurable.

4. **No shared vocabulary** — "Barge-in" means different things in each pipeline. Documentation must explain both.

### Recommendations

| Recommendation                                                                                                                                                                                                | Effort | Impact                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------ |
| **Extract BargeInConfig** — `{ energyThreshold?, frameThreshold?, enabled }` (or similar) for SandwichBargeIn. Pass via pipeline options.                                                                     | Low    | Low — improves configurability |
| **Document barge-in modes** — In PROTOCOL.md, clearly distinguish "provider barge-in" (Realtime) vs "client-side energy barge-in" (SandwichBargeIn).                                                          | Low    | Medium — reduces confusion     |
| **Consider energy-based barge-in for Realtime** — If a future provider lacks server-side VAD, could add optional energy-based fallback in the Realtime pipeline. Would require a unified BargeIn abstraction. | High   | Medium — future-proofing       |

---

## 3. SessionConfig vs SessionOptions

### Current State

- **SessionConfig** (`core/SessionConfig.ts`) — Rich type: `agent`, `pipeline`, `provider`, `inputAudioFormat`, `outputAudioFormat`, `sampleRate`, `channels`, `turnDetection`, `transcriptionModel`, etc. Documented as "input when starting a session."
- **SessionOptions** (`Session.ts`) — Simpler: `agent` | (`agentId` + `agents`), `provider`, `transport`, `pipeline?`. Used by `Session.run`.

SessionConfig is never consumed by Session.run. SessionContext carries only `sessionId` (and optionally `connectionId`, `metadata`). AgentContext gets `sessionId` and `metadata` from SessionContext, but not the full Session.

### Issues

1. **Dead or future-facing?** — SessionConfig looks designed for a session-routing or multi-tenant flow (e.g. resolve agent from registry by `agentId`, select provider by `provider`, set audio format from config). That flow is not implemented.

2. **AgentContext.session** — `AgentContext` has an optional `session?: Readonly<Session>`. If SessionConfig/Session were threaded through, tools could read full session config. Currently it's unused.

3. **Naming confusion** — "SessionConfig" vs "SessionOptions" — which is the source of truth for session setup?

### Recommendations

| Recommendation                                                                                                                                                                                                                           | Effort | Impact                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------- |
| **Align or remove** — Either: (a) adopt SessionConfig as the input to Session.run and map it to layers, or (b) remove/deprecate SessionConfig and document SessionOptions as the canonical API. Avoid maintaining two parallel concepts. | Medium | Medium — clearer API surface      |
| **Thread Session into SessionContext** — If SessionConfig is kept, build a full Session (with sessionId, connectionId) and provide it via SessionContext. Tools and agents could then read `getSession()` for full config.               | Medium | Low — enables richer tool context |

---

## 4. Agent Resolution Duality

### Current State

```typescript
// Option A: direct agent
Session.run({ agent: myAgent, provider, transport });

// Option B: registry lookup
Session.run({ agentId: "concierge", agents: { concierge, reservations }, provider, transport });
```

`resolveAgent` handles both. Mutually exclusive.

### Issues

1. **Two code paths** — `resolveAgent` branches on `agent` vs `agentId + agents`. Slight complexity.

2. **AgentRegistry unused in Session** — `AgentRegistry` exists in core but Session.run doesn't use it. It uses a plain `Record<string, AgentSpec>`. AgentRegistry provides `getAgent(id) => Effect<Option<AgentSpec>>` — more flexible (async, Option) but not wired in.

### Recommendations

| Recommendation                                                                                                                                                                           | Effort | Impact                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------ |
| **Unify on agents + agentId** — Always require `agents` and `agentId`. For single-agent, `agents: { default: myAgent }`, `agentId: "default"`. Simplifies resolveAgent to a single path. | Low    | Low — minor API simplification |
| **Or keep both** — If the ergonomics of `agent: myAgent` for single-agent are valued, document the two patterns clearly and leave as-is.                                                 | —      | —                              |

---

## 5. RealtimeAdapter Optionality

### Current State

RealtimeAdapter has several optional fields:

- `onSessionReady?` — OpenAI can omit; Gemini uses it for greeting.
- `encodeRequestResponse?` — OpenAI returns `{ type: "response.create" }`; Gemini returns `null` (no-op).
- `bufferSendUntilReady?` — OpenAI can buffer input until session ready; Gemini doesn't use it.

The kernel branches on these: `if (adapter.onSessionReady)`, `if (adapter.encodeRequestResponse)`, `if (sendBuffer)`.

### Issues

1. **Provider-specific behaviour** — Each provider implements a different subset. New providers must decide which to implement.

2. **requestResponse no-op for Gemini** — Gemini doesn't support explicit "create response" after tool output. The `pendingToolOutputRef` + `requestResponse()` pattern in the Realtime pipeline still runs for Gemini, but `requestResponse` does nothing. Dead code path for that provider.

### Recommendations

| Recommendation                                                                                                                                                                                          | Effort | Impact |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ |
| **Default implementations** — Provide adapter helpers: `defaultOnSessionReady = () => Effect.void`, `defaultEncodeRequestResponse = () => null`. Adapters override only when needed. Reduces branching. | Low    | Low    |
| **Document provider capabilities** — In provider README or PROTOCOL.md, list which adapter hooks each provider uses. Clarifies expectations for new providers.                                          | Low    | Medium |
| **Consider removing requestResponse from RealtimeShape for providers that don't support it** — Would require a capability flag or subtyping. Higher complexity. Probably not worth it.                  | High   | Low    |

---

## 6. Observability Asymmetry

### Current State

- **Realtime pipeline** — Uses `instrumentRealtime(rawRealtime)` which adds: event logging, token metrics, spans on `interrupt` and `submitToolOutput`.
- **Sandwich pipelines** — Use `logEvent` directly in the pipeline but do not use `instrumentRealtime`. No token metrics (ResponseCompleted doesn't exist in Sandwich flow). No span wrapping on tool execution (tool execution is inside Chat.generateText/streamText).

### Issues

1. **Token metrics only for Realtime** — `inputTokensCounter` and `outputTokensCounter` are incremented from `ResponseCompleted`. Sandwich pipelines don't emit that event; they use Chat which may have its own metrics. Inconsistent observability story.

2. **Tool spans** — Realtime pipeline has `tool.execute/{name}` span from ToolDispatch. Sandwich tool calls go through @effect/ai Chat — may or may not have equivalent spans. Unclear.

3. **Event logging** — Sandwich does call `logEvent` for TranscriptDelta, SpeechStarted, SpeechEnded. So event logging is consistent. But instrumentation (spans, metrics) is not.

### Recommendations

| Recommendation                                                                                                                                                                                                | Effort | Impact |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ |
| **Emit ResponseCompleted from Sandwich** — After TTS completes, emit a synthetic `ResponseCompleted` with token counts from the Chat response (if available). Would allow token metrics to work for Sandwich. | Medium | Medium |
| **Document observability matrix** — Table: which pipeline gets which observability (events, spans, metrics). Sets expectations.                                                                               | Low    | Low    |
| **Unify instrumentation layer** — If Sandwich used a "ChatInstrumentation" or similar that wrapped the LLM call with spans and metrics, could align with Realtime's approach.                                 | Medium | Medium |

---

## 7. Tool Follow-Up Pattern

### Current State

Realtime pipeline:

1. On `ToolCallStarted` → dispatch tool → `submitToolOutput` → `pendingToolOutputRef = true`.
2. On `ResponseCompleted` → if `pendingToolOutput`, call `requestResponse()`.

Purpose: After submitting tool output, the model needs to be prompted to continue (e.g. OpenAI `response.create`). Gemini may auto-continue; `requestResponse` is a no-op.

### Issues

1. **Provider-specific** — The pattern assumes the provider needs an explicit "continue" signal. Gemini doesn't.

2. **pendingToolOutputRef** — A Ref to track "we just submitted tool output, wait for ResponseCompleted before requesting next response." Slightly subtle state.

### Recommendations

| Recommendation                                                                                                                                                                   | Effort | Impact |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ |
| **Leave as-is** — The pattern is correct for OpenAI. Gemini's no-op is acceptable. Document that `requestResponse` is optional.                                                  | —      | —      |
| **Consider provider capability** — `adapter.requiresExplicitRequestResponse: boolean`. Pipeline could skip the `requestResponse` call when false. Removes dead no-op for Gemini. | Low    | Low    |

---

## 8. Transport Protocol

### Current State

- **Inbound:** Client sends binary PCM16 frames.
- **Outbound:** Server sends binary PCM16 frames.
- **Control:** Server sends `{ type: "clear" }` as JSON to flush client buffer.

Client must handle both binary and JSON messages.

### Issues

1. **Mixed protocol** — Binary for audio, JSON for control. Common pattern but adds client complexity (message type discrimination).

2. **No standard for client→server control** — Only server→client has a control message (clear). If client needed to send metadata or control, there's no defined pattern.

### Recommendations

| Recommendation                                                                                                                                                              | Effort | Impact |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ |
| **Document client contract** — In PROTOCOL.md or a CLIENT.md: expected message types, frame format, clear handling. Reduces integration errors.                             | Low    | Medium |
| **Consider JSON envelope for all** — e.g. `{ type: "audio", data: "<base64>" }` for audio. Would unify protocol but add overhead. Probably not worth it for realtime audio. | High   | Low    |

---

## 9. Error Handling Consistency

### Current State

- Realtime pipeline wraps `ProviderError` in `PipelineError` via `wrapProviderError`.
- Sandwich pipelines use `Effect.mapError` to wrap in `PipelineError`.
- Tool dispatch catches `AgentError` and converts to `ToolCallCompleted` with status "failure" (doesn't propagate).

### Issues

1. **Error transformation** — ProviderError → PipelineError happens at pipeline boundary. Good. But the transformation is ad-hoc (each pipeline does it slightly differently).

2. **AgentError swallowed** — Tool failures become successful `ToolCallCompleted` events. The AI receives the error. But the pipeline doesn't fail. Is that desired? Probably yes — tool failure is a normal case. But worth documenting.

### Recommendations

| Recommendation                                                                                                                                          | Effort | Impact |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ |
| **Centralise error mapping** — A small `toPipelineError(e: unknown): PipelineError` used by all pipelines. Ensures consistent wrapping.                 | Low    | Low    |
| **Document tool failure semantics** — Tool failure → ToolCallCompleted(failure) → AI gets error. Pipeline continues. Make this explicit in PROTOCOL.md. | Low    | Low    |

---

## 10. Complexity Reduction Summary

### Quick Wins (Low Effort)

| Action                                                                               | Benefit                              |
| ------------------------------------------------------------------------------------ | ------------------------------------ |
| Extract `BargeInConfig` for SandwichBargeIn (thresholds, frame count)                | Configurability, fewer magic numbers |
| Add `adapter.requiresExplicitRequestResponse` and skip no-op for Gemini              | Removes dead code path               |
| Document observability matrix (which pipeline gets what)                             | Clarity                              |
| Document tool failure semantics                                                      | Clarity                              |
| Unify agent resolution to always use `agents` + `agentId` (or document both clearly) | API clarity                          |

### Medium Effort

| Action                                                                     | Benefit                            |
| -------------------------------------------------------------------------- | ---------------------------------- |
| Extract shared Sandwich core (processTranscript, emit, turn orchestration) | Less duplication, single fix point |
| Align SessionConfig with Session.run or remove SessionConfig               | Clearer session API                |
| Emit synthetic ResponseCompleted from Sandwich for token metrics           | Observability parity               |

### Larger Refactors

| Action                                             | Benefit                                      |
| -------------------------------------------------- | -------------------------------------------- |
| Unify barge-in behind `BargeInDetector` interface  | Single abstraction, easier to add strategies |
| Express SandwichBargeIn as Sandwich + BargeInLayer | Fewer pipelines, more composition            |

---

## 11. Consistency Alignment Checklist

| Dimension       | Realtime                                 | Sandwich                                | SandwichBargeIn                         | Aligned?                      |
| --------------- | ---------------------------------------- | --------------------------------------- | --------------------------------------- | ----------------------------- |
| Event emission  | Provider → EventBroadcast                | Pipeline → EventBroadcast               | Pipeline → EventBroadcast               | ✓                             |
| Tool handling   | Pipeline dispatches, submits to provider | Chat internal                           | Chat internal                           | ✗ (different model)           |
| Barge-in        | Event-driven, BargeIn module             | None                                    | Energy-based, inline                    | ✗                             |
| SessionContext  | From RealtimeKernel                      | Pipeline provides DefaultSessionContext | Pipeline provides DefaultSessionContext | △ (Realtime gets from kernel) |
| Instrumentation | instrumentRealtime                       | logEvent only                           | logEvent only                           | ✗                             |
| Concurrency     | 3 fibers                                 | 1 fiber                                 | 2 fibers                                | ✗ (by design)                 |

---

## 12. Recommended Priorities

1. **Documentation** — Update PROTOCOL.md with barge-in modes, observability matrix, tool failure semantics. Low effort, high clarity.
2. **Extract Sandwich core** — Reduce duplication between Sandwich and SandwichBargeIn. Medium effort, high maintainability.
3. **Barge-in configurability** — Extract magic numbers to config. Low effort.
4. **SessionConfig alignment** — Decide whether to use or remove. Medium effort.
5. **Unified BargeIn abstraction** — If adding more barge-in strategies or providers, invest in this. Otherwise defer.
