# Documentation

Guides and references for using and extending aiffect-ts.

---

## Documents

| Document                | Description                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API.md**              | API tiers: primary (Session.run), composed (pipeline/provider/transport swap, runWithEvents), and custom (custom provider, transport, pipeline).  |
| **CLIENT.md**           | WebSocket client contract: binary PCM16 audio, JSON control message `{ "type": "clear" }`, sample rate/channels, and implementation checklist.    |
| **CUSTOM_PROVIDER.md**  | How to build a custom realtime provider: `RealtimeAdapter`, `makeRealtimeLayer`, connect/handler/encode, optional session and interrupt behavior. |
| **CUSTOM_TRANSPORT.md** | How to implement a custom transport: `TransportShape`, `AudioFrame`, minimal in-memory example, and providing the layer.                          |

---

## Related

- **Root [README.md](../README.md)** — Quick start, core concepts, session options, pipelines overview, observability, scripts.
- **[PROTOCOL.md](../PROTOCOL.md)** — End-to-end architecture: layer dependency graph, session lifecycle, transport/provider/pipeline flows, tool dispatch, barge-in, event system, wire formats.
- **[PROTOCOL_REVIEW.md](../PROTOCOL_REVIEW.md)** — Design review and improvement notes (pipeline fragmentation, barge-in duality, etc.); useful for contributors and future refactors.

Folder READMEs under `src/` describe technical flows for each section:

- [src/core/README.md](../src/core/README.md) — Core types and layer dependencies
- [src/pipelines/README.md](../src/pipelines/README.md) — Pipeline types and data flows
- [src/transports/README.md](../src/transports/README.md) — Transport contract and WebSocket
- [src/observability/README.md](../src/observability/README.md) — Event logging and metrics
- [src/providers/README.md](../src/providers/README.md) — Realtime provider layout and adding new providers
