import { Toolkit } from "@effect/ai";
import { Layer } from "effect";
import type { AgentSpec } from "../../src/framework/Agent.js";
import { customerToolkit, customerToolkitLayer } from "./toolkits/CustomerTools.js";
import { reservationToolkit, reservationToolkitLayer } from "./toolkits/ReservationTools.js";
import { menuToolkit, menuToolkitLayer } from "./toolkits/MenuTools.js";

/** Concierge agent: all capabilities (customer + reservation + menu toolkits). */
const conciergeToolkit = Toolkit.merge(customerToolkit, reservationToolkit, menuToolkit);
const conciergeToolkitLayer = Layer.merge(
  Layer.merge(customerToolkitLayer, reservationToolkitLayer),
  menuToolkitLayer,
) as Layer.Layer<unknown, unknown, unknown>;

export const conciergeAgent: AgentSpec = {
  name: "Concierge Agent",
  buildPrompt: (ctx) =>
    `You are a concierge agent. You can help with finding restaurants, viewing menus, and making or managing reservations. Use the right tool for each request.`,
  toolkit: conciergeToolkit,
  toolkitLayer: conciergeToolkitLayer,
};
