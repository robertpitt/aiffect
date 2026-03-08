import { Toolkit } from "@effect/ai";
import { Layer } from "effect";
import type { AgentSpec } from "../../src/framework/Agent.js";
import { customerToolkit, customerToolkitLayer } from "./toolkits/CustomerTools.js";
import { reservationToolkit, reservationToolkitLayer } from "./toolkits/ReservationTools.js";

/** Reservations agent: find restaurants + create/list reservations (customer + reservation toolkits). */
const reservationsToolkit = Toolkit.merge(customerToolkit, reservationToolkit);
const reservationsToolkitLayer = Layer.merge(
  customerToolkitLayer,
  reservationToolkitLayer,
) as Layer.Layer<unknown, unknown, unknown>;

export const reservationsAgent: AgentSpec = {
  name: "Reservations Agent",
  buildPrompt: (ctx) =>
    `You are a reservations agent. Help the user find a restaurant and make or manage table reservations. You can look up restaurants, create new reservations, and list existing ones.`,
  toolkit: reservationsToolkit,
  toolkitLayer: reservationsToolkitLayer,
};
