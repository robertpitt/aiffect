import { Toolkit } from "@effect/ai";
import { Context, Layer } from "effect";
import type { Session } from "./SessionConfig.js";

/**
 * @name AgentContext
 * @description AgentContext is an object that is available to the agent during the buildPrompt function
 * and tools, it contains the sessionId, metadata and session.
 */
export interface AgentContext {
  /**
   * @name sessionId
   * @description The id of the session.
   */
  readonly sessionId: string;

  /**
   * @name metadata
   * @description The metadata of the agent.
   */
  readonly metadata: Record<string, unknown>;

  /**
   * @name session
   * @description The Session for the current execution. Set when the session is started; may be undefined in buildPrompt during early setup.
   */
  readonly session?: Readonly<Session>;
}

/**
 * @name AgentSpec
 * @description AgentSpec is an object that defines an Agent and it's capabilities.
 */
export interface AgentSpec {
  /**
   * @name name
   * @description The name of the agent.
   */
  readonly name: string;

  /**
   * @name buildPrompt
   * @description The function that builds the prompt for the agent.
   */
  readonly buildPrompt: (context: AgentContext) => string;

  /**
   * @name toolkit
   * @description The toolkit of the agent.
   */
  readonly toolkit: Toolkit.Any;

  /**
   * @name toolkitLayer
   * @description The layer that provides the tool handlers required by the toolkit.
   */
  readonly toolkitLayer: Layer.Layer<unknown, unknown, unknown>;
}

/** Tag for the resolved agent for this session (prompt + toolkit). "Current" is implied by scoping. */
export class Agent extends Context.Tag("@aiffect/Agent")<Agent, AgentSpec>() {}
