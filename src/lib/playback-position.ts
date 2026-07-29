export interface PlaybackObservation {
  positionMilliseconds: number;
  observedAtMilliseconds: number;
}

/**
 * Estimates the current playback position between server polls. The server reports the
 * authoritative position; this advances it by wall-clock time while the line is playing.
 */
export function interpolatePlaybackPosition(input: {
  observation: PlaybackObservation | null;
  playing: boolean;
  nowMilliseconds: number;
  durationMilliseconds: number;
  repeat: boolean;
}): number {
  const { observation, playing, nowMilliseconds, durationMilliseconds, repeat } = input;
  if (!observation) return 0;
  const elapsed = playing ? Math.max(0, nowMilliseconds - observation.observedAtMilliseconds) : 0;
  const position = Math.max(0, observation.positionMilliseconds + elapsed);
  if (durationMilliseconds <= 0) return position;
  return repeat ? position % durationMilliseconds : Math.min(durationMilliseconds, position);
}
