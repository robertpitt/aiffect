import { Option } from "effect";

/**
 * Convert an Effect Option to a plain undefined when None.
 * Use when bridging Option to code that expects A | undefined.
 */
export const opt = <A>(o: Option.Option<A>): A | undefined => Option.getOrElse(o, () => undefined);

/**
 * Return the value or a new random UUID if undefined.
 * Use for optional ids (e.g. sessionId, connectionId) that should be set when missing.
 */
export const orRandomUuid = (value: string | undefined): string => value ?? crypto.randomUUID();
