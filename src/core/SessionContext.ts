import { Layer, ServiceMap } from "effect";

/**
 * Per-call metadata: the observability anchor for this session.
 * Transcripts, traces, usage, and logs are all associated with sessionId.
 */
export interface SessionContextShape {
  readonly sessionId: string;
  readonly connectionId?: string;
  readonly metadata?: Record<string, unknown>;
  /** Per-session overrides for provider options. Merged over base options from provider layer. */
  readonly providerOptions?: Record<string, unknown>;
}

export class SessionContext extends ServiceMap.Service<SessionContext, SessionContextShape>()(
  "@aiffect/SessionContext",
) {}

export const makeSessionContext = (ctx: SessionContextShape): Layer.Layer<SessionContext> =>
  Layer.succeed(SessionContext, ctx);

/** Read the current session context (e.g. in tool handlers). */
export const getSession = SessionContext.useSync((ctx) => ctx);
