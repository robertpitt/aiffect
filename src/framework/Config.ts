import { Context, Layer } from "effect";

/**
 * @name ProviderConfigOptions
 * @description The options that will be used to configure the provider.
 */
export interface ProviderConfigOptions {
  readonly realtimeModel?: string;
  readonly sttModel?: string;
  readonly ttsModel?: string;
  readonly voice?: string;
}

/**
 * @name AudioConfigOptions
 * @description The options that will be used to configure the audio.
 */
export interface AudioConfigOptions {
  readonly sampleRate: 8000 | 16000 | 24000 | 48000;
  readonly channels: 1 | 2;
  readonly frameMs: number;
}

/**
 * @name RuntimeConfigOptions
 * @description The options that will be used to configure the runtime.
 */
export interface RuntimeConfigOptions {
  readonly queueMode: "bounded" | "unbounded";
  readonly maxQueueSize?: number;
  readonly toolTimeoutMs: number;
}

/**
 * @name TelemetryConfigOptions
 * @description The options that will be used to configure the telemetry.
 */
export interface TelemetryConfigOptions {
  readonly serviceName: string;
  readonly includeEventPayloads: boolean;
}

/**
 * Centralised runtime configuration consumed by Transport, Provider, Pipeline, and Telemetry.
 * Validated once at session/startup boundary. See FRAMEWORK_SPEC Section 7.
 *
 * This framework does not read environment variables. Pass config explicitly or use
 * defaultAppConfig() / makeAppConfigLayer(). Configuration from env (if desired) is
 * the application's responsibility.
 */
export interface AppConfig {
  readonly provider: ProviderConfigOptions;
  readonly audio: AudioConfigOptions;
  readonly runtime: RuntimeConfigOptions;
  readonly telemetry: TelemetryConfigOptions;
}

export const AppConfig = Context.GenericTag<AppConfig>("@aiffect/AppConfig");

/**
 * Default config with sensible defaults. Overrides are shallow-merged per top-level key
 * (provider, audio, runtime, telemetry). Use when env is not used or when building config
 * in application code before passing into the framework.
 */
export function defaultAppConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
    provider: overrides?.provider ?? {},
    audio: overrides?.audio ?? {
      sampleRate: 24000,
      channels: 1,
      frameMs: 20,
    },
    runtime: overrides?.runtime ?? {
      queueMode: "unbounded",
      toolTimeoutMs: 30_000,
    },
    telemetry: overrides?.telemetry ?? {
      serviceName: "aiffect-ts",
      includeEventPayloads: false,
    },
  };
}

/**
 * Layer that provides AppConfig with default values. Compose with other layers at session build.
 * For custom config, use makeAppConfigLayer(config) or Layer.succeed(AppConfig, yourConfig).
 */
export const AppConfigLive: Layer.Layer<AppConfig> = Layer.succeed(AppConfig, defaultAppConfig());

/**
 * Build an AppConfig layer with optional overrides. Overrides are shallow-merged over defaults
 * per top-level key. Use when you want to pass config from your application (e.g. from your own
 * env loading or feature flags) without reading env inside the framework.
 */
export function makeAppConfigLayer(overrides?: Partial<AppConfig>): Layer.Layer<AppConfig> {
  return Layer.succeed(AppConfig, defaultAppConfig(overrides));
}
