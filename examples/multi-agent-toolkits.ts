/**
 * Example: Multiple agents, multiple toolkits, agents using a mix of toolkits.
 *
 * Uses sample agents from sample/agents:
 * - restaurant: CustomerTools + MenuTools (find restaurant, show menu)
 * - reservations: CustomerTools + ReservationTools (find restaurant, book/list reservations)
 * - concierge: all three toolkits (full capability)
 *
 * Choose agent via query: ?agent=restaurant | reservations | concierge (default: concierge)
 *
 * Run: OPENAI_API_KEY=sk-... npx tsx examples/multi-agent-toolkits.ts
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Layer } from "effect";
import { WebSocketServer } from "ws";
import { Session, OpenAI, Gemini, WebSocketTransport, ServerContext } from "../src/index.js";
import {
  restaurantAgent,
  reservationsAgent,
  conciergeAgent,
  SampleServerContextLive,
} from "../sample/agents/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const agents = { restaurant: restaurantAgent, reservations: reservationsAgent, concierge: conciergeAgent };
type AgentId = keyof typeof agents;

const VALID_AGENTS = Object.keys(agents) as AgentId[];

function agentFromUrl(url: string): AgentId {
  const u = new URL(url, "http://localhost");
  const a = u.searchParams.get("agent") ?? "concierge";
  return VALID_AGENTS.includes(a as AgentId) ? (a as AgentId) : "concierge";
}

const useGemini = process.env["REALTIME_PROVIDER"] === "gemini";
const provider = useGemini ? Gemini.realtime({ voice: "Aoede" }) : OpenAI.realtime({ voice: "alloy" });

const indexHtml = readFileSync(join(__dirname, "public", "index.html"), "utf-8");
const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(indexHtml);
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const agentId = agentFromUrl(req.url ?? "");

  const session = Session.run({
    agentId,
    agents,
    provider: Layer.provide(provider, SampleServerContextLive),
    transport: WebSocketTransport(ws),
  }).pipe(
    Effect.catchAllCause((cause) => Effect.log(`session ended: ${cause}`)),
  );

  Effect.runFork(session);
});

const PORT = Number(process.env["PORT"] ?? 8081);
server.listen(PORT, () => {
  console.log("\n  aiffect-ts multi-agent + multi-toolkit example");
  console.log("  ─────────────────────────────────────────────");
  console.log("  Agents: restaurant | reservations | concierge");
  console.log("  URL:    http://localhost:" + PORT + "?agent=concierge");
  console.log("  WS:     ws://localhost:" + PORT + "?agent=concierge\n");
});
