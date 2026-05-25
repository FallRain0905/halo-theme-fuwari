export type RawSong = {
  id?: string;
  title?: string;
  name?: string;
  artist?: string;
  author?: string;
  album?: string;
  category?: string;
  section?: string;
  genre?: string;
  track?: number;
  cover?: string;
  pic?: string;
  url?: string;
  src?: string;
  lrc?: string;
  lyric?: string;
  duration?: string;
};

export type Song = {
  id: string;
  title: string;
  artist: string;
  album: string;
  category: string;
  track: number;
  cover: string;
  url: string;
  lrc: string;
  duration: string;
};

export type LyricLine = {
  time: number;
  text: string;
};

export type AlbumGroup = {
  key: string;
  title: string;
  artist: string;
  category: string;
  cover: string;
  songs: Song[];
};

export type Playlist = {
  id: string;
  name: string;
  songIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type PlayStats = Record<
  string,
  {
    plays: number;
    completed: number;
    lastPlayedAt: string;
  }
>;

export type PlayerView = "cover" | "lyrics";

export type PlayMode = 0 | 1 | 2 | 3;
