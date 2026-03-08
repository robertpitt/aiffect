import { Effect } from "effect";
import type { ToolCallStarted, ToolCallCompleted } from "../schemas/Events.js";
import {
  ToolCallCompleted as ToolCallCompletedCtor,
  ToolCallError as ToolCallErrorCtor,
} from "../schemas/Events.js";
import type { AgentSpec } from "../framework/Agent.js";
import { AgentError } from "../framework/Errors.js";

interface WithHandler {
  readonly handle: (name: string, params: unknown) => Effect.Effect<unknown>;
}

/**
 * Execute a single tool call from the agent's toolkit with span instrumentation.
 * Requires the agent's toolkitLayer to be provided (e.g. via Effect.provide(agent.toolkitLayer)).
 */
export const dispatch = (
  event: ToolCallStarted,
  agent: AgentSpec,
): Effect.Effect<ToolCallCompleted, AgentError, unknown> =>
  Effect.gen(function* () {
    yield* Effect.annotateCurrentSpan("tool.name", event.name);
    yield* Effect.annotateCurrentSpan("tool.callId", event.callId);
    yield* Effect.annotateCurrentSpan("tool.arguments", event.arguments);

    const startMs = Date.now();
    const handler = yield* agent.toolkit as unknown as Effect.Effect<WithHandler>;
    const args = JSON.parse(event.arguments) as unknown;
    const result = yield* handler
      .handle(event.name, args)
      .pipe(
        Effect.mapError(
          (cause) => new AgentError({ reason: String(cause), toolName: event.name, cause }),
        ),
      );
    const durationMs = Date.now() - startMs;

    const resultStr = typeof result === "string" ? result : JSON.stringify(result);
    yield* Effect.annotateCurrentSpan("tool.result", resultStr);
    yield* Effect.annotateCurrentSpan("tool.duration_ms", durationMs);
    yield* Effect.annotateCurrentSpan("tool.status", "success");

    return new ToolCallCompletedCtor({
      callId: event.callId,
      name: event.name,
      status: "success",
      result: typeof result === "string" ? result : result,
    });
  }).pipe(
    Effect.withSpan(`tool.execute/${event.name}`, {
      attributes: { "tool.name": event.name, "tool.callId": event.callId },
    }),
    Effect.catchAll((err: AgentError) =>
      Effect.succeed(
        new ToolCallCompletedCtor({
          callId: event.callId,
          name: event.name,
          status: "failure",
          error: new ToolCallErrorCtor({ reason: err.reason }),
        }),
      ).pipe(
        Effect.tap(() =>
          Effect.logError("tool call failed").pipe(
            Effect.annotateLogs("tool.name", event.name),
            Effect.annotateLogs("error", err.reason),
          ),
        ),
      ),
    ),
  );
