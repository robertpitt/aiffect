import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import { ServerContext } from "@/core/ServerContext.js";
import { SessionContext } from "@/core/SessionContext.js";
import type { SampleServerContextShape } from "../ServerContext.js";

const reservationSuccess = Schema.Struct({
  id: Schema.String,
  restaurantName: Schema.String,
  date: Schema.String,
  time: Schema.String,
  partySize: Schema.Number,
  guestName: Schema.String,
  status: Schema.String,
});

const createReservation = Tool.make("createReservation", {
  description: "Create a table reservation at a restaurant",
  parameters: Schema.Struct({
    restaurantName: Schema.String,
    date: Schema.String,
    time: Schema.String,
    partySize: Schema.Number,
    guestName: Schema.String,
  }),
  success: reservationSuccess,
  dependencies: [ServerContext, SessionContext],
});

const listReservations = Tool.make("listReservations", {
  description: "List reservations for a guest or restaurant",
  parameters: Schema.Struct({
    guestName: Schema.optional(Schema.String),
    restaurantName: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({
    reservations: Schema.Array(reservationSuccess),
  }),
  dependencies: [ServerContext, SessionContext],
});

export const reservationToolkit = Toolkit.make(createReservation, listReservations);
export const reservationToolkitLayer = reservationToolkit.toLayer({
  createReservation: ({
    restaurantName,
    date,
    time,
    partySize,
    guestName,
  }: {
    restaurantName: string;
    date: string;
    time: string;
    partySize: number;
    guestName: string;
  }) =>
    Effect.gen(function* () {
      const server = (yield* ServerContext) as unknown as SampleServerContextShape;
      const session = yield* SessionContext;
      yield* Effect.log(`createReservation scoped to session ${session.sessionId}`);
      return yield* server.reservationService.create({
        restaurantName,
        date,
        time,
        partySize,
        guestName,
      });
    }),
  listReservations: ({
    guestName,
    restaurantName,
  }: {
    guestName?: string;
    restaurantName?: string;
  }) =>
    Effect.gen(function* () {
      const server = (yield* ServerContext) as unknown as SampleServerContextShape;
      const session = yield* SessionContext;
      yield* Effect.log(`listReservations scoped to session ${session.sessionId}`);
      return yield* server.reservationService.list({ guestName, restaurantName });
    }),
});
