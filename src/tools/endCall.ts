import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import { CallControl } from "@/core/CallControl.js";

const endCallSuccess = Schema.Struct({
  success: Schema.Boolean,
  message: Schema.String,
});

const endCall = Tool.make("end_call", {
  description:
    "End the current call. Use when the customer wants to hang up or when the conversation is complete.",
  parameters: Schema.Struct({
    message: Schema.optional(Schema.String),
  }),
  success: endCallSuccess,
  dependencies: [CallControl],
});

export const endCallToolkit = Toolkit.make(endCall);
export const endCallToolkitLayer = endCallToolkit.toLayer({
  end_call: ({ message }: { message?: string }) =>
    Effect.gen(function* () {
      const callControl = yield* CallControl;
      yield* callControl.requestEnd(message);
      return { success: true, message: "Call ended successfully" };
    }),
});
