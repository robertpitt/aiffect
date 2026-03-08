import { LanguageModel } from "@effect/ai";
import { Layer } from "effect";
import { Pipeline } from "../core/Pipeline.js";
import { Transport } from "../core/Transport.js";
import { STT, TTS } from "../core/Provider.js";
import { Agent } from "../core/Agent.js";
import { makeSandwichCore } from "./SandwichCore.js";
import type { BargeInConfig } from "./BargeInConfig.js";

/**
 * Sandwich pipeline with barge-in: STT -> streaming LLM -> sentence-chunked
 * TTS with concurrent energy-based interruption.
 */
export const make = (
  config?: BargeInConfig,
): Layer.Layer<
  Pipeline,
  never,
  Transport | STT | TTS | LanguageModel.LanguageModel | Agent | import("effect").Scope.Scope
> =>
  makeSandwichCore({ bargeIn: config }) as Layer.Layer<
    Pipeline,
    never,
    Transport | STT | TTS | LanguageModel.LanguageModel | Agent | import("effect").Scope.Scope
  >;
