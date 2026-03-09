import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import { CallControl } from "@/core/CallControl.js";

const transferCallSuccess = Schema.Struct({
  success: Schema.Boolean,
  message: Schema.String,
});

const transferCall = Tool.make("transfer_call", {
  description:
    "Transfer the call to another number (e.g. a human staff member). Use when the customer requests to speak to a person.",
  parameters: Schema.Struct({
    to: Schema.String,
  }),
  success: transferCallSuccess,
  dependencies: [CallControl],
});

export const transferCallToolkit = Toolkit.make(transferCall);
export const transferCallToolkitLayer = transferCallToolkit.toLayer({
  transfer_call: ({ to }: { to: string }) =>
    Effect.gen(function* () {
      const callControl = yield* CallControl;
      yield* callControl.requestTransfer(to);
      return { success: true, message: `Call transfer initiated to ${to}` };
    }),
});
