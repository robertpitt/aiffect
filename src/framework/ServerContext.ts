import { Context } from "effect";

/**
 * @name ServerContextShape
 * @description App-level dependencies (repositories, services) available to agents and tools.
 * Use this for database access, external APIs, and session-scoped lookups. Provide a layer
 * at server startup; tools and agents receive it when running inside a session.
 */
export interface ServerContextShape {
  readonly [key: string]: unknown;
}

/**
 * @name ServerContext
 * @description Context tag for server-wide dependencies (repositories, services). Tools and
 * agents can require this to perform database lookups and use services. Provide via
 * Layer.succeed(ServerContext, { restaurantRepository, reservationService, ... }) when
 * building the server layer passed to runWithConfig.
 */
export class ServerContext extends Context.Tag("@aiffect/ServerContext")<
  ServerContext,
  ServerContextShape
>() {}
