export type BpmDetectionResult = {
  bpm: number;
  confidence: number; // 0-1
  candidates: { bpm: number; strength: number }[];
};

type BpmDetectionOptions = {
  minBpm?: number;
  maxBpm?: number;
  sampleDuration?: number; // seconds of audio to analyze
};

const DEFAULT_OPTIONS: Required<BpmDetectionOptions> = {
  minBpm: 60,
  maxBpm: 180,
  sampleDuration: 30,
};

/**
 * Detect BPM from an AudioBuffer using energy-based autocorrelation.
 */
export function detectBpm(
  audioBuffer: AudioBuffer,
  options?: BpmDetectionOptions
): BpmDetectionResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const sampleRate = audioBuffer.sampleRate;
  const totalSamples = audioBuffer.length;
  const totalDuration = totalSamples / sampleRate;

  // Short audio → low confidence, default BPM
  if (totalDuration < 5) {
    return { bpm: 90, confidence: 0, candidates: [] };
  }

  // 1. Extract mono channel, take ~sampleDuration from middle
  const mono = extractMono(audioBuffer);
  const { start, end } = getSampleWindow(
    mono.length,
    sampleRate,
    opts.sampleDuration
  );
  const segment = mono.subarray(start, end);

  // 2. Compute RMS energy in ~1024-sample windows
  const windowSize = 1024;
  const energyCurve = computeEnergyCurve(segment, windowSize);

  // 3. Smooth energy (3-point moving average)
  smoothInPlace(energyCurve, 3);

  // 4. Onset detection: first-order difference, half-wave rectify
  const onsets = computeOnsets(energyCurve);

  // 5. Autocorrelation over BPM lag range
  const windowsPerSecond = sampleRate / windowSize;
  const minLag = Math.floor((60 / opts.maxBpm) * windowsPerSecond);
  const maxLag = Math.ceil((60 / opts.minBpm) * windowsPerSecond);

  const correlation = autocorrelate(onsets, minLag, maxLag);

  // 6. Peak picking
  const peaks = pickPeaks(correlation, minLag, windowsPerSecond);

  if (peaks.length === 0) {
    return { bpm: 90, confidence: 0, candidates: [] };
  }

  // 7. Octave correction — bias toward WCS sweet spot (80-130 BPM)
  const corrected = octaveCorrect(peaks);

  const best = corrected[0];
  const meanCorrelation =
    correlation.reduce((a, b) => a + b, 0) / correlation.length;
  const confidence = Math.min(
    1,
    meanCorrelation > 0 ? best.strength / (meanCorrelation * 4) : 0
  );

  return {
    bpm: Math.round(best.bpm),
    confidence: Math.round(confidence * 100) / 100,
    candidates: corrected.slice(0, 3).map((c) => ({
      bpm: Math.round(c.bpm),
      strength: Math.round(c.strength * 1000) / 1000,
    })),
  };
}

function extractMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) {
    return buffer.getChannelData(0);
  }
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const mono = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) {
    mono[i] = (left[i] + right[i]) * 0.5;
  }
  return mono;
}

function getSampleWindow(
  totalSamples: number,
  sampleRate: number,
  durationSec: number
): { start: number; end: number } {
  const desiredSamples = Math.floor(durationSec * sampleRate);
  if (totalSamples <= desiredSamples) {
    return { start: 0, end: totalSamples };
  }
  // Take from middle, skip intro/outro
  const center = Math.floor(totalSamples / 2);
  const half = Math.floor(desiredSamples / 2);
  return { start: center - half, end: center + half };
}

function computeEnergyCurve(
  samples: Float32Array,
  windowSize: number
): Float32Array {
  const numWindows = Math.floor(samples.length / windowSize);
  const energy = new Float32Array(numWindows);
  for (let i = 0; i < numWindows; i++) {
    let sum = 0;
    const offset = i * windowSize;
    for (let j = 0; j < windowSize; j++) {
      const s = samples[offset + j];
      sum += s * s;
    }
    energy[i] = Math.sqrt(sum / windowSize);
  }
  return energy;
}

function smoothInPlace(arr: Float32Array, kernelSize: number): void {
  const half = Math.floor(kernelSize / 2);
  const copy = new Float32Array(arr);
  for (let i = half; i < arr.length - half; i++) {
    let sum = 0;
    for (let j = -half; j <= half; j++) {
      sum += copy[i + j];
    }
    arr[i] = sum / kernelSize;
  }
}

function computeOnsets(energy: Float32Array): Float32Array {
  const onsets = new Float32Array(energy.length);
  for (let i = 1; i < energy.length; i++) {
    const diff = energy[i] - energy[i - 1];
    onsets[i] = diff > 0 ? diff : 0; // half-wave rectify
  }
  return onsets;
}

function autocorrelate(
  signal: Float32Array,
  minLag: number,
  maxLag: number
): Float32Array {
  const clampedMax = Math.min(maxLag, signal.length - 1);
  const result = new Float32Array(clampedMax - minLag + 1);
  for (let lag = minLag; lag <= clampedMax; lag++) {
    let sum = 0;
    const limit = signal.length - lag;
    for (let i = 0; i < limit; i++) {
      sum += signal[i] * signal[i + lag];
    }
    result[lag - minLag] = sum / limit;
  }
  return result;
}

type Peak = { bpm: number; strength: number; lag: number };

function pickPeaks(
  correlation: Float32Array,
  minLag: number,
  windowsPerSecond: number
): Peak[] {
  const peaks: Peak[] = [];

  for (let i = 1; i < correlation.length - 1; i++) {
    if (
      correlation[i] > correlation[i - 1] &&
      correlation[i] > correlation[i + 1]
    ) {
      const lag = i + minLag;
      const bpm = (60 * windowsPerSecond) / lag;
      peaks.push({ bpm, strength: correlation[i], lag });
    }
  }

  // Sort by strength descending
  peaks.sort((a, b) => b.strength - a.strength);
  return peaks.slice(0, 10);
}

function octaveCorrect(peaks: Peak[]): Peak[] {
  // WCS sweet spot: 80-130 BPM
  const WCS_LOW = 80;
  const WCS_HIGH = 130;

  return peaks
    .map((p) => {
      let bpm = p.bpm;
      // If too fast, halve until in range
      while (bpm > WCS_HIGH && bpm / 2 >= 60) {
        bpm = bpm / 2;
      }
      // If too slow, double until in range
      while (bpm < WCS_LOW && bpm * 2 <= 180) {
        bpm = bpm * 2;
      }
      return { ...p, bpm };
    })
    .sort((a, b) => {
      // Prefer values in the sweet spot
      const aInRange = a.bpm >= WCS_LOW && a.bpm <= WCS_HIGH ? 1 : 0;
      const bInRange = b.bpm >= WCS_LOW && b.bpm <= WCS_HIGH ? 1 : 0;
      if (aInRange !== bInRange) return bInRange - aInRange;
      return b.strength - a.strength;
    });
}
