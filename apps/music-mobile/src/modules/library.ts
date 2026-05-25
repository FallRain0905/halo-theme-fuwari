import { resolveUrl } from "./config";
import type { AlbumGroup, RawSong, Song } from "./types";
import { normalize } from "./utils";

export const normalizeSongs = (data: unknown): Song[] => {
  const source = Array.isArray(data)
    ? data
    : Array.isArray((data as { songs?: unknown[] })?.songs)
      ? (data as { songs: unknown[] }).songs
      : [];

  return source
    .map((item, index) => {
      const song = item as RawSong;
      return {
        id: normalize(song.id) || `song-${index}`,
        title: normalize(song.title || song.name) || `Track ${index + 1}`,
        artist: normalize(song.artist || song.author) || "Unknown Artist",
        album: normalize(song.album) || "Unknown Album",
        category: normalize(song.category || song.section || song.genre),
        track: Number(song.track) || 0,
        cover: resolveUrl(normalize(song.cover || song.pic)),
        url: resolveUrl(normalize(song.url || song.src)),
        lrc: normalize(song.lrc || song.lyric),
        duration: normalize(song.duration),
      };
    })
    .filter((song) => song.url);
};

export const makeAlbumKey = (song: Song) => `${song.artist}::${song.album}`;

export const buildAlbums = (songs: Song[]) => {
  const groups = new Map<string, AlbumGroup>();
  songs.forEach((song) => {
    const key = makeAlbumKey(song);
    const group = groups.get(key);
    if (group) {
      group.songs.push(song);
      if (!group.cover && song.cover) group.cover = song.cover;
      return;
    }
    groups.set(key, {
      key,
      title: song.album,
      artist: song.artist,
      category: song.category,
      cover: song.cover,
      songs: [song],
    });
  });
  return [...groups.values()].sort((a, b) => {
    const category = a.category.localeCompare(b.category, "zh-Hans-CN");
    if (category) return category;
    const artist = a.artist.localeCompare(b.artist, "zh-Hans-CN");
    if (artist) return artist;
    return a.title.localeCompare(b.title, "zh-Hans-CN");
  });
};

export const songsFromIds = (songs: Song[], ids: Iterable<string>) => {
  const byId = new Map(songs.map((song) => [song.id, song]));
  return [...ids]
    .map((id) => byId.get(id))
    .filter((song): song is Song => Boolean(song));
};
