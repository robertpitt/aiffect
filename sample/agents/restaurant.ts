import { Toolkit } from "@effect/ai";
import { Layer } from "effect";
import type { AgentSpec } from "../../src/framework/Agent.js";
import { customerToolkit, customerToolkitLayer } from "./toolkits/CustomerTools.js";
import { menuToolkit, menuToolkitLayer } from "./toolkits/MenuTools.js";

/** Restaurant agent: find restaurants + show menus (customer + menu toolkits). */
const restaurantToolkit = Toolkit.merge(customerToolkit, menuToolkit);
const restaurantToolkitLayer = Layer.merge(customerToolkitLayer, menuToolkitLayer) as Layer.Layer<
  unknown,
  unknown,
  unknown
>;

export const restaurantAgent: AgentSpec = {
  name: "Restaurant Agent",
  buildPrompt: (ctx) =>
    `You are a restaurant agent. Help the user find a restaurant and explore menus. You can look up restaurants and get their full menu or details for specific items.`,
  toolkit: restaurantToolkit,
  toolkitLayer: restaurantToolkitLayer,
};
