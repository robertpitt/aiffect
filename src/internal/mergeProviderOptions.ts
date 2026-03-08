/**
 * Shallow merge of base provider options with per-session overrides.
 * Session overrides take precedence. Used by realtime providers to combine
 * base options from OpenAI.realtime(...) / Gemini.realtime(...) with
 * sessionContext.providerOptions from Session.run({ session: { providerOptions } }).
 */
export function mergeProviderOptions<T extends Record<string, unknown>>(
  base: T,
  overrides?: Record<string, unknown>,
): T {
  if (!overrides || Object.keys(overrides).length === 0) return base;
  return { ...base, ...overrides } as T;
}
