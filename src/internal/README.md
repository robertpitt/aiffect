# Internal

Implementation details and shared utilities used by pipelines and providers. **Not part of the public API**; the public surface is defined in `src/index.ts`.

| Module | Purpose |
|--------|---------|
| **audio.ts** | Audio helpers (e.g. PCM16 RMS for energy-based barge-in). |
| **toolkitCompat.ts** | Bridges `@effect/ai` Toolkit to pipeline use (e.g. `toolkitAsEffect` for Sandwich). |
| **MessageSocket.ts** | Abstract socket interface for provider message loops (send/receive). |
| **serializeToolOutput.ts** | Serialization of tool results for provider wire format. |

Do not depend on these modules from application code; use the exported API from `aiffect-ts` instead.
