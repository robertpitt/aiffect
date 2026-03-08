import { Effect, Schema } from "effect";
import { ServerContext } from "@/core/ServerContext.js";
import { Tool, Toolkit } from "effect/unstable/ai";
import type { SampleServerContextShape } from "../ServerContext.js";

const getMenu = Tool.make("getMenu", {
  description: "Get the full menu for a restaurant",
  parameters: Schema.Struct({ restaurantName: Schema.String }),
  success: Schema.Struct({
    restaurantName: Schema.String,
    sections: Schema.Array(
      Schema.Struct({ name: Schema.String, items: Schema.Array(Schema.String) }),
    ),
  }),
  dependencies: [ServerContext],
});

const getMenuItem = Tool.make("getMenuItem", {
  description: "Get details for a specific menu item",
  parameters: Schema.Struct({
    restaurantName: Schema.String,
    itemName: Schema.String,
  }),
  success: Schema.Struct({
    restaurantName: Schema.String,
    name: Schema.String,
    description: Schema.String,
    price: Schema.String,
    dietary: Schema.Array(Schema.String),
  }),
  dependencies: [ServerContext],
});

export const menuToolkit = Toolkit.make(getMenu, getMenuItem);
export const menuToolkitLayer = menuToolkit.toLayer({
  getMenu: ({ restaurantName }: { restaurantName: string }) =>
    Effect.gen(function* () {
      const server = (yield* ServerContext) as unknown as SampleServerContextShape;
      return yield* server.menuRepository.getMenu(restaurantName);
    }),
  getMenuItem: ({ restaurantName, itemName }: { restaurantName: string; itemName: string }) =>
    Effect.gen(function* () {
      const server = (yield* ServerContext) as unknown as SampleServerContextShape;
      return yield* server.menuRepository.getItem(restaurantName, itemName);
    }),
});
