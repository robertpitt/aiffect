import { LanguageModel } from "@effect/ai";
import { Layer } from "effect";
import { Pipeline } from "../core/Pipeline.js";
import { Transport } from "../core/Transport.js";
import { STT, TTS } from "../core/Provider.js";
import { Agent } from "../core/Agent.js";
import { makeSandwichCore } from "./SandwichCore.js";

/**
 * Sandwich pipeline: STT -> LLM (Chat + LanguageModel) -> TTS.
 * Uses the same EventBus (EventBroadcast) as Realtime for consistent event emission and subscription.
 */
export const make: Layer.Layer<
  Pipeline,
  never,
  Transport | STT | TTS | LanguageModel.LanguageModel | Agent | import("effect").Scope.Scope
> = makeSandwichCore({}) as Layer.Layer<
  Pipeline,
  never,
  Transport | STT | TTS | LanguageModel.LanguageModel | Agent | import("effect").Scope.Scope
>;
