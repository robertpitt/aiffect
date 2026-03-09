import { Layer } from "effect";
import { Toolkit } from "effect/unstable/ai";
import { endCallToolkit, endCallToolkitLayer } from "@/tools/endCall.js";
import { transferCallToolkit, transferCallToolkitLayer } from "@/tools/transferCall.js";

export * from "@/tools/endCall.js";
export * from "@/tools/transferCall.js";

/** Combined toolkit with end_call and transfer_call. Requires CallControl in session. */
export const callControlToolkit = Toolkit.merge(endCallToolkit, transferCallToolkit);
export const callControlToolkitLayer = Layer.mergeAll(endCallToolkitLayer, transferCallToolkitLayer);
