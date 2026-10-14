export function mouthFromSamples(samples: Float32Array, previous = 0) {
  if (!samples.length) return 0;
  let sum = 0;
  for (const value of samples) sum += value * value;
  const rms = Math.sqrt(sum / samples.length);
  const target = rms < 0.008 ? 0 : Math.min(1, rms * 8);
  const value =
    previous + (target - previous) * (target > previous ? 0.65 : 0.35);
  return value < 0.005 ? 0 : value;
}
