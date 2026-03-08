import { Context, Effect, Layer } from "effect";

export interface SessionContextShape {
  readonly sessionId: string;
  readonly connectionId?: string;
  readonly metadata?: Record<string, unknown>;
}

export class SessionContext extends Context.Tag("@aiffect/SessionContext")<
  SessionContext,
  SessionContextShape
>() {}

export const makeSessionContext = (
  ctx: SessionContextShape,
): Layer.Layer<SessionContext> => Layer.succeed(SessionContext, ctx);

/** Read the current session context (e.g. in tool handlers). */
export const getSession = Effect.map(SessionContext, (ctx) => ctx);
