/**
 * Example: How to set up a voice pipeline with OpenAI Realtime.
 *
 * This file demonstrates the full pipeline composition:
 *   1. Provider — OpenAI.realtime() for full-duplex voice
 *   2. Transport — WebSocketTransport for PCM16 audio + JSON events
 *   3. Agent — Concierge (restaurant, menu, reservations tools)
 *   4. ServerContext — Repositories/services for tool handlers
 *
 * The pipeline is composed in Session.run(), which wires provider, transport,
 * agent, and serverContext into the default RealtimePipeline.
 *
 * Run: OPENAI_API_KEY=sk-... npx tsx examples/concierge.openai.ts
 */
import { createServer } from "node:http";
import { Effect } from "effect";
import { WebSocketServer } from "ws";
import { Session, OpenAI, WebSocketTransport } from "@/index.js";
import { conciergeAgent } from "../sample/agents/index.js";
import { getIndexHtml, SampleServerContextLive, DEFAULT_PORT } from "./utils.js";

// ─── 1. Provider: OpenAI Realtime (full-duplex voice API) ────────────────────

const provider = OpenAI.realtime({ voice: "alloy" });

// ─── 2. HTTP + WebSocket server ─────────────────────────────────────────────

const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(getIndexHtml("openai"));
});

const wss = new WebSocketServer({ server });

// ─── 3. Pipeline: On each WebSocket connection, run a voice session ──────────

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const voice = url.searchParams.get("voice") ?? undefined;
  const session = Session.run({
    agent: conciergeAgent,
    provider,
    transport: WebSocketTransport(ws),
    serverContext: SampleServerContextLive,
    session: voice ? { providerOptions: { voice } } : undefined,
  }).pipe(Effect.catchCause((cause) => Effect.log(`session ended: ${cause}`)));

  Effect.runFork(session);
});

// ─── 4. Start server ────────────────────────────────────────────────────────

server.listen(DEFAULT_PORT, () => {
  console.log("\n  aiffect-ts — OpenAI Realtime pipeline example");
  console.log("  ─────────────────────────────────────────────");
  console.log("  Provider: OpenAI");
  console.log("  URL:     http://localhost:" + DEFAULT_PORT);
  console.log("  WS:      ws://localhost:" + DEFAULT_PORT + "\n");
});
