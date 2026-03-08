/**
 * Session context service: holds the single Session type for the current connection.
 * Available to tool handlers and pipeline; set once when the session starts.
 */

import { Context, Effect, Layer } from "effect";
import type { Session } from "./SessionConfig.js";

export interface SessionContextShape {
  readonly value: Session;
}

export class SessionContext extends Context.Tag("@aiffect/SessionContext")<
  SessionContext,
  SessionContextShape
>() {}

/** Build SessionContext layer from a Session (e.g. from config + sessionId/connectionId at start). */
export const makeSessionContext = (session: Session): Layer.Layer<SessionContext> =>
  Layer.succeed(SessionContext, { value: session });

/** Read the current session (e.g. in tool handlers). */
export const getSessionContext = () =>
  Effect.flatMap(SessionContext, (ctx) => Effect.succeed(ctx.value));

/** Alias for getSessionContext — returns the current session from context. */
export const getSession = getSessionContext;
