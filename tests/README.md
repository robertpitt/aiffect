# Tests

Automated tests for pipeline contracts and behavior.

---

## Test suite

| File | Description |
|------|-------------|
| **pipeline.contract.test.ts** | Contract tests for the Realtime pipeline: inbound audio reaches the provider; tool calls trigger dispatch and `submitToolOutput`; interrupt clears the transport. Uses `TestTransport` and `TestProvider` from `src/test/` to drive the pipeline without a real WebSocket or AI API. |

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

Test doubles live under **src/test/**:

- **TestTransport.ts** — In-memory transport (queues for inbound/outbound) for driving pipeline tests.
- **TestProvider.ts** — Fake Realtime provider that can be fed events and inspected for sent frames and tool outputs.

These allow testing the pipeline’s orchestration (routing, barge-in, tool dispatch) in isolation.
