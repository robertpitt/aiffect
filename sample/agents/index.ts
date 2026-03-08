/**
 * Sample: multiple agents, multiple toolkits, agents using a mix of toolkits.
 *
 * Toolkits:
 * - CustomerTools: getResturant
 * - ReservationTools: createReservation, listReservations
 * - MenuTools: getMenu, getMenuItem
 *
 * Agents (each uses a different mix of toolkits):
 * - restaurant: Customer + Menu
 * - reservations: Customer + Reservation
 * - concierge: Customer + Reservation + Menu
 *
 * Tools get ServerContext (repositories, services) and SessionContext (session scope)
 * from the session app layer; provide SampleServerContextLive when running sessions.
 */

import { agents } from "../../src/framework/AgentRegistry.js";
import { restaurantAgent } from "./restaurant.js";
import { reservationsAgent } from "./reservations.js";
import { conciergeAgent } from "./concierge.js";

export { restaurantAgent, reservationsAgent, conciergeAgent };
export { customerToolkit, customerToolkitLayer } from "./toolkits/CustomerTools.js";
export { reservationToolkit, reservationToolkitLayer } from "./toolkits/ReservationTools.js";
export { menuToolkit, menuToolkitLayer } from "./toolkits/MenuTools.js";
export {
  SampleServerContextLive,
  type SampleServerContextShape,
  type RestaurantRepository,
  type MenuRepository,
  type ReservationService,
} from "./ServerContext.js";

export const SampleAgentRegistry = agents({
  restaurant: restaurantAgent,
  reservations: reservationsAgent,
  concierge: conciergeAgent,
});
