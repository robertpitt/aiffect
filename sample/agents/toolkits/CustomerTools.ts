import { Tool, Toolkit } from "@effect/ai";
import { Effect, Schema } from "effect";
import { ServerContext } from "../../../src/core/ServerContext.js";
import type { SampleServerContextShape } from "../ServerContext.js";

const getResturant = Tool.make("getResturant", {
  description: "Get a restaurant by name",
  parameters: { name: Schema.String },
  success: Schema.Struct({
    name: Schema.String,
    address: Schema.String,
    phone: Schema.String,
    website: Schema.String,
  }),
  dependencies: [ServerContext],
});

export const customerToolkit = Toolkit.make(getResturant);
export const customerToolkitLayer = customerToolkit.toLayer({
  getResturant: ({ name }: { name: string }) =>
    Effect.gen(function* () {
      const server = (yield* ServerContext) as unknown as SampleServerContextShape;
      return yield* server.restaurantRepository.findByName(name);
    }),
});
