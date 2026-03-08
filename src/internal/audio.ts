/** Compute normalised RMS energy from PCM16 little-endian samples (range 0..1). */
export function pcm16Rms(samples: Uint8Array): number {
  const view = new DataView(samples.buffer, samples.byteOffset, samples.byteLength);
  const count = samples.byteLength / 2;
  if (count === 0) return 0;
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const s = view.getInt16(i * 2, true);
    sum += s * s;
  }
  return Math.sqrt(sum / count) / 32768;
}
