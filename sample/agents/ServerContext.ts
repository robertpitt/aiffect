/**
 * Sample server context: repositories and services used by agent tools.
 * Provide this layer when running sessions so tools can perform DB lookups
 * and session-scoped operations. Tools can use getSession() for scope (e.g. tenant, sessionId).
 */
import { Effect, Layer } from "effect";
import { ServerContext, type ServerContextShape } from "../../src/core/ServerContext.js";

/** In real apps these would be DB/API clients; here we use in-memory mocks. */
export interface RestaurantRepository {
  findByName(
    name: string,
  ): Effect.Effect<{ name: string; address: string; phone: string; website: string }>;
}

export interface MenuRepository {
  getMenu(restaurantName: string): Effect.Effect<{
    restaurantName: string;
    sections: Array<{ name: string; items: string[] }>;
  }>;
  getItem(
    restaurantName: string,
    itemName: string,
  ): Effect.Effect<{
    restaurantName: string;
    name: string;
    description: string;
    price: string;
    dietary: string[];
  }>;
}

export interface ReservationService {
  create(params: {
    restaurantName: string;
    date: string;
    time: string;
    partySize: number;
    guestName: string;
  }): Effect.Effect<{
    id: string;
    restaurantName: string;
    date: string;
    time: string;
    partySize: number;
    guestName: string;
    status: string;
  }>;
  list(params: { guestName?: string; restaurantName?: string }): Effect.Effect<{
    reservations: Array<{
      id: string;
      restaurantName: string;
      date: string;
      time: string;
      partySize: number;
      guestName: string;
      status: string;
    }>;
  }>;
}

/** Shape of server context provided to tools. Extend with your own repos/services. */
export interface SampleServerContextShape {
  restaurantRepository: RestaurantRepository;
  menuRepository: MenuRepository;
  reservationService: ReservationService;
}

const mockRestaurantRepository: RestaurantRepository = {
  findByName: (name: string) =>
    Effect.succeed({
      name: name || "The Restaurant",
      address: "123 Main St, Anytown, USA",
      phone: "555-1234",
      website: "https://www.therestaurant.com",
    }),
};

const mockMenuRepository: MenuRepository = {
  getMenu: (restaurantName: string) =>
    Effect.succeed({
      restaurantName,
      sections: [
        { name: "Starters", items: ["Soup of the day", "Caesar salad", "Bruschetta"] },
        { name: "Mains", items: ["Grilled salmon", "Ribeye steak", "Vegetable risotto"] },
        { name: "Desserts", items: ["Chocolate cake", "Ice cream", "Cheese board"] },
      ],
    }),
  getItem: (restaurantName: string, itemName: string) =>
    Effect.succeed({
      restaurantName,
      name: itemName,
      description: `Delicious ${itemName.toLowerCase()}`,
      price: "14.99",
      dietary: ["gluten-free"],
    }),
};

const mockReservationService: ReservationService = {
  create: ({ restaurantName, date, time, partySize, guestName }) =>
    Effect.succeed({
      id: `res-${Date.now()}`,
      restaurantName,
      date,
      time,
      partySize,
      guestName,
      status: "confirmed",
    }),
  list: ({ guestName, restaurantName }) =>
    Effect.succeed({
      reservations: [
        {
          id: "res-1",
          restaurantName: restaurantName ?? "The Restaurant",
          date: "2025-03-15",
          time: "19:00",
          partySize: 2,
          guestName: guestName ?? "Guest",
          status: "confirmed",
        },
      ],
    }),
};

/** Layer that provides ServerContext with sample repositories and services. */
export const SampleServerContextLive = Layer.succeed(ServerContext, {
  restaurantRepository: mockRestaurantRepository,
  menuRepository: mockMenuRepository,
  reservationService: mockReservationService,
} as ServerContextShape);
