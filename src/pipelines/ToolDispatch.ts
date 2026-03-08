import { Effect } from "effect";
import type { ToolCallStarted, ToolCallCompleted } from "@/core/Events.js";
import {
  ToolCallCompleted as ToolCallCompletedCtor,
  ToolCallError as ToolCallErrorCtor,
} from "@/core/Events.js";
import type { AgentSpec } from "@/core/Agent.js";
import type { AgentError } from "@/core/Errors.js";

/**
 * Execute a single tool call via the agent's handleToolCall with span instrumentation.
 */
export const dispatch = (
  event: ToolCallStarted,
  agent: AgentSpec,
): Effect.Effect<ToolCallCompleted, AgentError> =>
  Effect.gen(function* () {
    yield* Effect.annotateCurrentSpan("tool.name", event.name);
    yield* Effect.annotateCurrentSpan("tool.callId", event.callId);
    yield* Effect.annotateCurrentSpan("tool.arguments", event.arguments);

    const startMs = Date.now();
    const args = JSON.parse(event.arguments) as unknown;
    const result = yield* agent.handleToolCall(event.name, args);
    const durationMs = Date.now() - startMs;

    const resultStr = typeof result === "string" ? result : JSON.stringify(result);
    yield* Effect.annotateCurrentSpan("tool.result", resultStr);
    yield* Effect.annotateCurrentSpan("tool.duration_ms", durationMs);
    yield* Effect.annotateCurrentSpan("tool.status", "success");

    return new ToolCallCompletedCtor({
      callId: event.callId,
      name: event.name,
      status: "success",
      result,
    });
  }).pipe(
    Effect.withSpan(`tool.execute/${event.name}`, {
      attributes: { "tool.name": event.name, "tool.callId": event.callId },
    }),
    Effect.catch((err: AgentError) =>
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
