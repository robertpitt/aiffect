import { Toolkit } from "effect/unstable/ai";
import { Layer } from "effect";
import { defineAgent } from "@/core/Agent.js";
import { customerToolkit, customerToolkitLayer } from "./toolkits/CustomerTools.js";
import { reservationToolkit, reservationToolkitLayer } from "./toolkits/ReservationTools.js";

const reservationsToolkit = Toolkit.merge(customerToolkit, reservationToolkit);
const reservationsToolkitLayer = Layer.merge(
  customerToolkitLayer,
  reservationToolkitLayer,
) as Layer.Layer<unknown, unknown, unknown>;

export const reservationsAgent = defineAgent({
  name: "Reservations Agent",
  buildPrompt: (_agentContext, _sessionContext) =>
    `You are a reservations agent. Help the user find a restaurant and make or manage table reservations. You can look up restaurants, create new reservations, and list existing ones.`,
  toolkit: reservationsToolkit,
  toolkitLayer: reservationsToolkitLayer,
});
