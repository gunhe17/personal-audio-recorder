export function nowIso() {
  return new Date().toISOString();
}

export function durationFramesToSeconds(durationFrames, sampleRate) {
  if (!sampleRate) {
    return 0;
  }

  return Math.max(0, Math.floor(durationFrames / sampleRate));
}

export function hoursBetween(olderIso, newerDate = new Date()) {
  const olderDate = new Date(olderIso);

  if (Number.isNaN(olderDate.getTime())) {
    return 0;
  }

  return (newerDate.getTime() - olderDate.getTime()) / (1000 * 60 * 60);
}

export function isPastRetention(startIso, retentionHours, newerDate = new Date()) {
  return hoursBetween(startIso, newerDate) >= retentionHours;
}
