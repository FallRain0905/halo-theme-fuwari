import { icons } from "./icons";
import type { PlayMode, Song } from "./types";

export const playModes: PlayMode[] = [0, 1, 2, 3];

export const normalizePlayMode = (value: unknown): PlayMode => {
  const mode = Number(value);
  return playModes.includes(mode as PlayMode) ? (mode as PlayMode) : 0;
};

export const nextPlayMode = (mode: PlayMode): PlayMode =>
  ((mode + 1) % playModes.length) as PlayMode;

export const playModeIcon = (mode: PlayMode) => {
  if (mode === 1) return icons.repeatOne;
  if (mode === 2) return icons.shuffle;
  if (mode === 3) return icons.sequence;
  return icons.repeat;
};

export const playModeLabel = (mode: PlayMode) => {
  if (mode === 1) return "Repeat one";
  if (mode === 2) return "Shuffle";
  if (mode === 3) return "Sequence";
  return "List repeat";
};

export const getQueueSong = (
  queue: Song[],
  currentId: string | undefined,
  mode: PlayMode,
  step: 1 | -1,
  ended: boolean,
) => {
  if (!queue.length) return null;
  if (mode === 1 && ended)
    return queue.find((song) => song.id === currentId) || queue[0];
  if (mode === 2 && step === 1) {
    if (queue.length === 1) return queue[0];
    const candidates = queue.filter((song) => song.id !== currentId);
    return (
      candidates[Math.floor(Math.random() * candidates.length)] || queue[0]
    );
  }

  const currentIndex = Math.max(
    0,
    queue.findIndex((song) => song.id === currentId),
  );
  const nextIndex = currentIndex + step;

  if (mode === 3) {
    if (nextIndex < 0 || nextIndex >= queue.length) return null;
    return queue[nextIndex];
  }

  return queue[(nextIndex + queue.length) % queue.length];
};

export class PlaybackFailureGuard {
  private retrySongId = "";
  private retryCount = 0;
  private consecutiveSkips = 0;

  constructor(
    private readonly maxRetries = 1,
    private readonly maxConsecutiveSkips = 5,
  ) {}

  resetForSong(songId: string) {
    if (this.retrySongId === songId) return;
    this.retrySongId = songId;
    this.retryCount = 0;
  }

  markHealthy() {
    this.consecutiveSkips = 0;
  }

  shouldRetry(songId: string) {
    if (this.retrySongId !== songId) {
      this.retrySongId = songId;
      this.retryCount = 0;
    }
    if (this.retryCount >= this.maxRetries) return false;
    this.retryCount += 1;
    return true;
  }

  canSkip() {
    this.consecutiveSkips += 1;
    return this.consecutiveSkips <= this.maxConsecutiveSkips;
  }
}
