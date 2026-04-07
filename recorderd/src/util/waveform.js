const MAX_I24 = 8388607;

export function clamp24Bit(value) {
  return Math.max(-8388608, Math.min(MAX_I24, value | 0));
}

export function linearToDbfs(linear) {
  return Number((20 * Math.log10(Math.max(linear, 0.000001))).toFixed(1));
}

export function computePeakLinearFromI32(samples) {
  let peak = 0;

  for (let index = 0; index < samples.length; index += 1) {
    peak = Math.max(peak, Math.abs(samples[index]) / MAX_I24);
  }

  return peak;
}

export function computePeakDbfsFromI32(samples) {
  return linearToDbfs(computePeakLinearFromI32(samples));
}

export function buildWaveformBinsFromI32(samples, targetBins) {
  if (!samples?.length || !targetBins || targetBins < 1) {
    return [];
  }

  const binSize = Math.max(1, Math.ceil(samples.length / targetBins));
  const bins = [];

  for (let start = 0; start < samples.length; start += binSize) {
    let peak = 0;
    const end = Math.min(samples.length, start + binSize);

    for (let index = start; index < end; index += 1) {
      peak = Math.max(peak, Math.abs(samples[index]) / MAX_I24);
    }

    bins.push(Number(peak.toFixed(4)));
  }

  return bins;
}

export function downsampleWaveformBins(bins, targetBins) {
  if (!Array.isArray(bins) || !bins.length || !targetBins || targetBins < 1) {
    return [];
  }

  if (bins.length <= targetBins) {
    return bins.map(function (value) {
      return Number(Math.max(0, Math.min(1, value)).toFixed(4));
    });
  }

  const nextBins = [];

  for (let bucket = 0; bucket < targetBins; bucket += 1) {
    const start = Math.floor((bucket / targetBins) * bins.length);
    const end = Math.max(start + 1, Math.floor(((bucket + 1) / targetBins) * bins.length));
    let peak = 0;

    for (let index = start; index < end; index += 1) {
      peak = Math.max(peak, Number(bins[index]) || 0);
    }

    nextBins.push(Number(Math.max(0, Math.min(1, peak)).toFixed(4)));
  }

  return nextBins;
}

export function appendWaveformBins(existingBins, nextBins, maxBins) {
  const merged = [
    ...(Array.isArray(existingBins) ? existingBins : []),
    ...(Array.isArray(nextBins) ? nextBins : [])
  ];

  if (!maxBins || merged.length <= maxBins) {
    return merged;
  }

  return merged.slice(merged.length - maxBins);
}
