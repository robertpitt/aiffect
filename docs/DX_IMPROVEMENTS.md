# Developer Experience & Public Contract Improvements

Recommendations and status for improving how users interact with the library. See also [PROTOCOL_REVIEW.md](../PROTOCOL_REVIEW.md) for design-level improvements.

---

## Summary of Changes Made

| Change | Purpose |
|--------|---------|
| **Exported `DefineAgentParams`** | Users and IDEs get a clear input type for `defineAgent()` instead of inferring from usage. |
| **JSDoc `@example` on `defineAgent`** | In-editor example for the most common agent definition flow. |
| **ConfigError lists available agents** | When `agentId` is not found, message is e.g. `Agent not found: "foo". Available: restaurant, reservations, concierge`. |
| **Clearer ConfigError for missing option** | Message is now "Either agent or (agentId + agents) must be provided". |
| **Event type guards** | `isTranscriptDelta`, `isResponseCompleted`, etc. for narrowing `PipelineEvent` without manual `_tag` checks. |
| **docs/API.md populated** | Single place for API tiers: primary, composed, custom. |
| **package.json `types` in exports** | Conditional `types` entry so TypeScript and tooling resolve types correctly when the package is linked or published. |

---

## Public Contracts

### 1. **Stable, documented entry types**

- **Session.run / runWithEvents** — `SessionOptions` is the single contract; it’s documented in code and in [docs/API.md](./API.md). No parallel “SessionConfig” in the public API (see PROTOCOL_REVIEW: align or remove SessionConfig).
- **defineAgent** — Input is `DefineAgentParams` (exported); output is `AgentSpec`. No need to touch `handleToolCall` in normal use.

### 2. **Errors as part of the contract**

- **ConfigError** — Invalid session setup. Messages are actionable (e.g. list available agent IDs).
- **ProviderError** — Provider failure; includes `provider` and `reason`.
- **PipelineError** — Pipeline/transport failure; often wraps another error. Use `toPipelineError` in custom pipelines.

Consider documenting in API.md or README that session effects fail with `PipelineError | ConfigError | ProviderError` and that users should handle them (e.g. `Effect.catchAllCause` for logging).

### 3. **Events**

- **PipelineEvent** — Discriminated union; use `_tag` or the exported **isX** type guards.
- All event classes are exported so users can construct or match on them.

### 4. **Provider options**

- **OpenAI**: `OpenAIRealtimeOptions` is the type for `OpenAI.realtime(options)`. Export it from the main package if you want one-stop imports (e.g. `import { OpenAI, type OpenAIRealtimeOptions } from "aiffect-ts"`). Currently it’s under `OpenAI` namespace.
- **Gemini**: Same idea for Gemini options if you want parity.

---

## Further DX Ideas

| Idea | Effort | Impact |
|------|--------|--------|
| **Export provider option types from main index** | Low | Users can import `OpenAIRealtimeOptions` from `aiffect-ts` without reaching into `OpenAI`. |
| **JSDoc @example on Session.run and runWithEvents** | Low | In-editor examples for session start and event subscription. |
| **README “Common mistakes”** | Low | e.g. “Use `agent` or `agentId`+`agents`, not both”; “Sandwich pipelines need STT + TTS + LanguageModel layers”. |
| **Typed agent IDs** | Medium | e.g. `agents: Record<AgentId, AgentSpec>` with `AgentId = "restaurant" \| "reservations" \| "concierge"` in samples; or a generic helper for type-safe agent maps. |
| **SessionOptions validation** | Medium | Optional runtime check (e.g. Effect-based) that exactly one of (agent) or (agentId+agents) is set, with a clear error before running. |
| **Convenience: Session.runFork(options)** | Low | Wraps `Session.run(options).pipe(Effect.catchAllCause(log), Effect.runFork)` for the common “run and forget” case. |
| **Remove or align SessionConfig** | Medium | See PROTOCOL_REVIEW; reduces confusion between SessionConfig and SessionOptions. |

---

## Internal vs Public

- **Public**: Everything exported from `src/index.ts`. No breaking changes without a major or clear deprecation.
- **Internal**: `src/internal/`, and any module not re-exported from `src/index.ts`. Can change freely.
- **Docs**: `docs/` describe how to use and extend the library; `src/*/README.md` describe internal flows for contributors.

Keeping the public surface small and stable (Session, defineAgent, providers, transport, pipelines, events, errors, observability) helps long-term DX.
