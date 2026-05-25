import type { PlayStats, Song } from "./types";

type RecommendationOptions = {
  songs: Song[];
  favorites: Set<string>;
  defaultPlaylistIds: string[];
  stats: PlayStats;
};

const dateKey = () => new Date().toISOString().slice(0, 10);

const stableHash = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const anchorsFor = ({
  songs,
  favorites,
  defaultPlaylistIds,
}: RecommendationOptions) => {
  const ids = new Set([...favorites, ...defaultPlaylistIds]);
  return songs.filter((song) => ids.has(song.id));
};

const similarityScore = (song: Song, anchors: Song[]) =>
  anchors.reduce((score, anchor) => {
    let next = score;
    if (song.artist === anchor.artist) next += 4;
    if (song.album === anchor.album) next += 2;
    if (song.category && song.category === anchor.category) next += 2;
    return next;
  }, 0);

const diversify = (
  songs: Array<{ song: Song; score: number }>,
  limit: number,
) => {
  const artistCounts = new Map<string, number>();
  const albumCounts = new Map<string, number>();
  const result: Song[] = [];
  for (const item of songs) {
    const artistCount = artistCounts.get(item.song.artist) || 0;
    const albumCount = albumCounts.get(item.song.album) || 0;
    if (artistCount >= 2 || albumCount >= 2) continue;
    result.push(item.song);
    artistCounts.set(item.song.artist, artistCount + 1);
    albumCounts.set(item.song.album, albumCount + 1);
    if (result.length >= limit) break;
  }
  return result;
};

export const getDailyRecommendations = (
  options: RecommendationOptions,
  limit = 3,
) => {
  const anchors = anchorsFor(options);
  const seed = dateKey();
  const scored = options.songs
    .map((song) => {
      const stats = options.stats[song.id];
      const liked = options.favorites.has(song.id);
      return {
        song,
        score:
          similarityScore(song, anchors) +
          Math.min(stats?.completed || 0, 10) * 0.6 +
          Math.min(stats?.plays || 0, 12) * 0.18 +
          (liked ? -2 : 0) +
          (stableHash(`${seed}:${song.id}`) % 1000) / 1000,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.song.title.localeCompare(b.song.title, "zh-Hans-CN"),
    );
  const diverse = diversify(scored, limit);
  return diverse.length ? diverse : options.songs.slice(0, limit);
};

export const getHeartRecommendations = (
  options: RecommendationOptions,
  limit = 3,
) => {
  const anchors = anchorsFor(options);
  const scored = options.songs
    .map((song) => ({
      song,
      score:
        similarityScore(song, anchors) +
        Math.min(options.stats[song.id]?.plays || 0, 10) * 0.25 -
        (options.favorites.has(song.id) ? 1 : 0),
    }))
    .filter((item) => item.score >= 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.song.title.localeCompare(b.song.title, "zh-Hans-CN"),
    );
  return (
    scored.some((item) => item.score > 0)
      ? diversify(scored, limit)
      : options.songs
  ).slice(0, limit);
};

export const getLoopRankingSongs = (
  songs: Song[],
  stats: PlayStats,
  limit = 3,
) => {
  const ranked = songs
    .map((song) => ({
      song,
      score:
        (stats[song.id]?.plays || 0) + (stats[song.id]?.completed || 0) * 2,
    }))
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.song.title.localeCompare(b.song.title, "zh-Hans-CN"),
    )
    .map((item) => item.song);
  return (ranked.length ? ranked : songs.slice(3, 6)).slice(0, limit);
};
