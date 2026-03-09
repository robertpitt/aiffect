/**
 * Audio conversion for Twilio transport: μ-law (G.711 PCMU) at 8 kHz
 * to/from pipeline format: PCM16 at 24 kHz.
 */

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

/** Decode μ-law (G.711 PCMU) to 16-bit little-endian PCM. */
export function mulawToPcm16(ulaw: Uint8Array): Uint8Array {
  const len = ulaw.length;
  const pcm = new Uint8Array(len * 2);
  const view = new DataView(pcm.buffer);
  for (let i = 0; i < len; i++) {
    const ulawByte = ~(ulaw[i] ?? 0) & 0xff;
    const sign = ulawByte & 0x80;
    const exponent = (ulawByte & 0x70) >> 4;
    const mantissa = ulawByte & 0x0f;
    let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
    sample -= MULAW_BIAS;
    if (sign) sample = -sample;
    sample = Math.max(-32768, Math.min(32767, sample));
    view.setInt16(i * 2, sample, true);
  }
  return pcm;
}

/** Encode 16-bit little-endian PCM to μ-law (G.711 PCMU). */
export function pcm16ToMulaw(pcm: Uint8Array): Uint8Array {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const numSamples = pcm.byteLength >>> 1;
  const ulaw = new Uint8Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    let sample = view.getInt16(i * 2, true);
    const sign = sample < 0 ? 0x80 : 0x00;
    if (sign !== 0) sample = -sample;
    if (sample > MULAW_CLIP) sample = MULAW_CLIP;
    sample += MULAW_BIAS;
    let exponent = 7;
    for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; expMask >>= 1) {
      exponent--;
    }
    const mantissa = (sample >> (exponent + 3)) & 0x0f;
    ulaw[i] = ~(sign | (exponent << 4) | mantissa) & 0xff;
  }
  return ulaw;
}

/** Resample PCM16 (little-endian) from one sample rate to another. */
export function resamplePcm16(
  pcm: Uint8Array,
  fromRate: number,
  toRate: number,
): Uint8Array {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const numSamplesIn = pcm.byteLength >>> 1;
  if (fromRate === toRate) return pcm.slice(0);

  if (fromRate > toRate && fromRate % toRate === 0) {
    const factor = fromRate / toRate;
    const numSamplesOut = Math.floor(numSamplesIn / factor);
    const out = new Uint8Array(numSamplesOut * 2);
    const outView = new DataView(out.buffer);
    for (let i = 0; i < numSamplesOut; i++) {
      let acc = 0;
      const base = i * factor;
      for (let j = 0; j < factor; j++) {
        acc += view.getInt16((base + j) * 2, true);
      }
      const sample = Math.round(acc / factor);
      outView.setInt16(i * 2, Math.max(-32768, Math.min(32767, sample)), true);
    }
    return out;
  }

  const numSamplesOut = Math.floor((numSamplesIn * toRate) / fromRate);
  const out = new Uint8Array(numSamplesOut * 2);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < numSamplesOut; i++) {
    const srcIdx = (i * fromRate) / toRate;
    const idx0 = Math.min(Math.floor(srcIdx), numSamplesIn - 1);
    const idx1 = Math.min(idx0 + 1, numSamplesIn - 1);
    const frac = srcIdx - idx0;
    const s0 = view.getInt16(idx0 * 2, true);
    const s1 = view.getInt16(idx1 * 2, true);
    const sample = Math.round(s0 + frac * (s1 - s0));
    outView.setInt16(i * 2, Math.max(-32768, Math.min(32767, sample)), true);
  }
  return out;
}

const TWILIO_SAMPLE_RATE = 8000;
const PIPELINE_SAMPLE_RATE = 24000;

/** Convert Twilio inbound (μ-law 8 kHz) to pipeline format (PCM16 24 kHz). */
export function twilioInboundToPipeline(ulaw8k: Uint8Array): Uint8Array {
  const pcm8k = mulawToPcm16(ulaw8k);
  return resamplePcm16(pcm8k, TWILIO_SAMPLE_RATE, PIPELINE_SAMPLE_RATE);
}

/** Convert pipeline output (PCM16 24 kHz) to Twilio outbound (μ-law 8 kHz). */
export function pipelineToTwilioOutbound(
  pcm: Uint8Array,
  sourceSampleRate = PIPELINE_SAMPLE_RATE,
): Uint8Array {
  const pcm8k = resamplePcm16(pcm, sourceSampleRate, TWILIO_SAMPLE_RATE);
  return pcm16ToMulaw(pcm8k);
}
