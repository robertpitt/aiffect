/**
 * Safe, provider-ready serialization of tool output for sending to realtime providers.
 * Produces minified JSON; strips metadata keys; handles BigInt and circular refs with fallback.
 */

const METADATA_KEYS = new Set(["callId", "call_id", "name", "status", "__meta", "_callId"]);

const FALLBACK_OUTPUT = JSON.stringify({ error: "unserializable_output" });

function stripMetadata(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stripMetadata);
  const record = obj as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (METADATA_KEYS.has(k)) continue;
    out[k] = stripMetadata(v);
  }
  return out;
}

function safeStringify(value: unknown): string {
  const cleaned = stripMetadata(value);
  const seen = new WeakSet();
  const replacer = (_key: string, val: unknown): unknown => {
    if (typeof val === "bigint") return val.toString();
    if (val !== null && typeof val === "object") {
      if (seen.has(val)) return "[Circular]";
      seen.add(val);
    }
    return val;
  };
  try {
    return JSON.stringify(cleaned, replacer);
  } catch {
    return FALLBACK_OUTPUT;
  }
}

/**
 * Serialize tool output to a JSON string suitable for sending to a realtime provider.
 * Strips metadata keys, handles BigInt (as string) and circular refs (as "[Circular]").
 * On any serialization failure returns minified JSON for { error: "unserializable_output" }.
 */
export function serializeToolOutput(value: unknown): string {
  try {
    return safeStringify(value);
  } catch {
    return FALLBACK_OUTPUT;
  }
}
