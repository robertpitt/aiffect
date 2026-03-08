# Transports

Transports move raw PCM16 audio between the client (e.g. browser) and the server. They implement the **Transport** context tag and satisfy `TransportShape`.

---

## Transport contract (`TransportShape`)

Defined in `core/Transport.ts`:

| Member | Type | Description |
|--------|------|-------------|
| **inbound** | `Stream<AudioFrame, TransportError>` | Stream of audio frames from the client (microphone). |
| **send** | `(frame: AudioFrame) => Effect<void, TransportError>` | Push one audio frame to the client (playback). |
| **clear** | `Effect<void, TransportError>` (optional) | Signal the client to flush its playback buffer. Used for barge-in so the user hears silence immediately after interrupt. |

---

## Built-in: WebSocket (`WebSocket.ts`)

**Entry point:** `fromWebSocket(ws, options?)` → `Layer<Transport>`.

- Expects **binary** WebSocket messages as PCM16 audio from the client.
- Sends **binary** messages to the client for playback.
- Sends a **JSON** message `{ "type": "clear" }` when `clear` is called (barge-in).

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `sampleRate` | `24000` | Sample rate for inbound frames (outbound uses same). |
| `channels` | `1` | Channel count. |
| `pingIntervalMs` | — | Optional interval (ms) to send a JSON ping to keep the connection alive. |
| `queueCapacity` | — | If set, uses a bounded queue for inbound frames; recommended in production (e.g. 1024). |
| `queueDropStrategy` | `"drop-oldest"` | When queue is full: `"drop-oldest"` (sliding) or `"drop-newest"` (dropping). |

The WebSocket is closed when the enclosing Effect scope is finalized (e.g. when the session ends).

**Client contract:** See [docs/CLIENT.md](../../docs/CLIENT.md) for the expected client-side protocol (binary PCM16, clear message format).

---

## Custom transports

Implement `TransportShape` and provide it with `Layer.scoped(Transport, effect)`. See [docs/CUSTOM_TRANSPORT.md](../../docs/CUSTOM_TRANSPORT.md) for the full guide.

---

## Flow in the stack

1. Client sends PCM16 over the wire (e.g. WebSocket binary).
2. Transport turns that into a stream of `AudioFrame` on `inbound`.
3. Pipeline consumes `inbound` and feeds the Provider (or STT in Sandwich).
4. Pipeline sends frames via `Transport.send`; optionally calls `Transport.clear` on barge-in.
5. Transport sends frames (and clear signal) back to the client.

See [PROTOCOL.md](../../PROTOCOL.md) (Transport Layer) for more detail.
