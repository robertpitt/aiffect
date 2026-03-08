# Realtime providers

Each realtime provider (OpenAI, Gemini) is split into small modules under a `realtime/` folder for clarity and single responsibility.

## Per-provider layout

```
provider/
  realtime/
    types.ts   # Wire message types, options, handler state, constants
    schema.ts  # Schema for decoding server messages at the boundary
    handler.ts # Pure message handler: (msg, state) → { actions, nextState }
    session.ts # Build session/setup payload from agent + context
    flow.ts    # Connection, interrupt, message loop, and Layer (make)
  Provider.ts # Re-exports make + public types (entry point)
```

## Responsibilities

- **types** — API-specific message shapes, options, and handler state. No Effect or Schema.
- **schema** — Effect Schema for parsing raw JSON into typed messages. Used only at the boundary.
- **handler** — Pure function: given a decoded message and current state, returns actions to dispatch and next state. Easy to unit test.
- **session** — Builds the initial session/setup payload (e.g. `session.update`, `setup`) from the current agent and context.
- **flow** — Effectful wiring: connect to WebSocket, create socket/queues/state, send session message, run the message loop (decode → handler → dispatch), and expose the Realtime service (send, receive, events, interrupt). Each provider has its own inbuilt flow; no shared kernel.

## Adding a new provider

1. Add `providers/<name>/realtime/{types,schema,handler,session,flow}.ts`.
2. Implement the same contracts: decode with schema, handle with pure handler, build session in session.ts, run the flow in flow.ts and export `make(options)` returning `Layer<Realtime, ProviderError, Scope | CurrentAgent>`.
3. Add `providers/<name>/<Name>.ts` that re-exports `make` and public types.
