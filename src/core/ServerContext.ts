import { ServiceMap } from "effect";

/**
 * App-level dependencies (repositories, services) available to agents and tools.
 * Provide via Layer.succeed(ServerContext, { ... }) when building the session layer.
 */
export interface ServerContextShape {
  readonly [key: string]: unknown;
}

export class ServerContext extends ServiceMap.Service<ServerContext, ServerContextShape>()(
  "@aiffect/ServerContext",
) {}
