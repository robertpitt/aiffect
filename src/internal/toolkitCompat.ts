import type { Toolkit, Tool } from "@effect/ai";
import type { Effect } from "effect";

/**
 * Cast a Toolkit.Any to the Effect form accepted by Chat.generateText / streamText.
 *
 * At runtime every Toolkit instance extends Effect.Effect<Toolkit.WithHandler<...>>,
 * but the Toolkit.Any structural interface omits the Effect super-type.
 * This utility centralises the single unavoidable cast so call-sites stay clean.
 */
export function toolkitAsEffect(
  toolkit: Toolkit.Any,
): Effect.Effect<Toolkit.WithHandler<Record<string, Tool.Any>>, never, unknown> {
  return toolkit as unknown as Effect.Effect<
    Toolkit.WithHandler<Record<string, Tool.Any>>,
    never,
    unknown
  >;
}
