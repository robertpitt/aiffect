/**
 * Configuration for energy-based barge-in (SandwichBargeIn pipeline).
 * When the user speaks over the assistant, audio energy above the threshold
 * for a sufficient number of consecutive frames triggers interruption.
 */
export interface BargeInConfig {
  /** RMS energy threshold (0–1). Frames above this count toward barge-in. Default: 0.02 */
  readonly energyThreshold?: number;
  /** Consecutive frames above threshold required to trigger barge-in. Default: 3 */
  readonly frameThreshold?: number;
}

export const DEFAULT_ENERGY_THRESHOLD = 0.02;
export const DEFAULT_FRAME_THRESHOLD = 3;
