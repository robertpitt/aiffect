import { Context, Effect, Layer, Scope } from "effect";
import { Agent } from "./Agent.js";
import { Realtime } from "./Provider.js";
import { ConfigError, type ProviderError } from "./Errors.js";
import type { ProviderType } from "./SessionConfig.js";
import { make as OpenAIRealtimeProvider } from "../providers/openai/realtime/flow.js";
import { make as GeminiRealtimeProvider } from "../providers/gemini/realtime/flow.js";

/**
 * @name ProviderRegistryOptions
 * @description The options that will be used to configure the provider registry.
 */
export interface ProviderRegistryOptions {
  readonly voice: string;
}

/**
 * @name ProviderRegistryShape
 * @description The provider registry shape that will be used to resolve a provider layer by provider id.
 */
export interface ProviderRegistryShape {
  /**
   * @name getProvider
   * @description The function that will be used to resolve a provider layer by provider id.
   */
  readonly getProvider: (
    providerId: ProviderType,
    options: ProviderRegistryOptions,
  ) => Effect.Effect<Layer.Layer<Realtime, ProviderError, Agent | Scope.Scope>, ConfigError>;
}

/**
 * @name ProviderRegistry
 * @description The provider registry context that will be used to resolve a provider layer by provider id.
 */
export class ProviderRegistry extends Context.Tag("@aiffect/ProviderRegistry")<
  ProviderRegistry,
  ProviderRegistryShape
>() {}

/**
 * @name ProviderRegistryLive
 * @description The provider registry layer that will be used to resolve a provider layer by provider id.
 */
export const ProviderRegistryLive: Layer.Layer<ProviderRegistry> = Layer.succeed(ProviderRegistry, {
  getProvider: (providerId, options) => {
    if (providerId === "openai") {
      return Effect.succeed(OpenAIRealtimeProvider({ voice: options.voice }));
    }
    if (providerId === "gemini") {
      return Effect.succeed(GeminiRealtimeProvider({ voice: options.voice }));
    }
    return Effect.fail(
      new ConfigError({
        reason:
          providerId === "composable"
            ? "composable provider not yet supported"
            : `unknown provider: ${providerId}`,
      }),
    );
  },
});
