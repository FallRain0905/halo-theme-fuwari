import { Capacitor, registerPlugin } from "@capacitor/core";
import { apiRequest } from "./modules/api";
import { config, resolveUrl } from "./modules/config";
import { icons } from "./modules/icons";
import {
  buildAlbums,
  normalizeSongs,
  songsFromIds as getSongsFromIds,
} from "./modules/library";
import { parseLyrics } from "./modules/lyrics";
import {
  getDailyRecommendations,
  getHeartRecommendations,
  getLoopRankingSongs as getLoopRankingSongsFor,
} from "./modules/recommendations";
import { readJson, saveIdSet } from "./modules/storage";
import type {
  AlbumGroup,
  LyricLine,
  PlayMode,
  Playlist,
  PlayStats,
  PlayerView,
  Song,
} from "./modules/types";
import {
  escapeHtml,
  formatTime,
  makeLocalId,
  normalize,
  setInfoItem,
} from "./modules/utils";
import {
  getQueueSong,
  nextPlayMode,
  normalizePlayMode,
  PlaybackFailureGuard,
  playModeIcon,
  playModeLabel,
} from "./modules/playerQueue";
import "./styles.css";

const storageKey = "fallrain-music-mobile-state";
const favoriteStorageKey = "fallrain-music:favorites";
const playlistStorageKey = "fallrain-music:playlists";
const recentStorageKey = "fallrain-music:recent";
const playerViewStorageKey = "fallrain-music:player-view";
const playStatsStorageKey = "fallrain-music:play-stats";
const playbackRateStorageKey = "fallrain-music:playback-rate";
const defaultPlaylistId = "default";
const playbackRates = [0.75, 1, 1.25, 1.5, 2];
const audio = new Audio();
audio.preload = "metadata";
let endAdvanceLocked = false;
let waitingWatchdog = window.setTimeout(() => undefined, 0);
window.clearTimeout(waitingWatchdog);
const failureGuard = new PlaybackFailureGuard();
let sleepTimerId = window.setTimeout(() => undefined, 0);
window.clearTimeout(sleepTimerId);
let importPollTimer = window.setTimeout(() => undefined, 0);
window.clearTimeout(importPollTimer);
let downloadPollTimer = window.setTimeout(() => undefined, 0);
window.clearTimeout(downloadPollTimer);

type ImportJob = {
  id: string;
  type: string;
  mode: "download" | "library";
  status: "running" | "done" | "failed";
  code: number | null;
  startedAt: string;
  finishedAt: string;
  expiresAt: string;
  category: string;
  itemCount: number;
  songs: number;
  downloadUrl: string;
  error: string;
  log: string;
};

type MusicBackgroundPlugin = {
  start(options: { title: string; artist: string }): Promise<{ ok: boolean }>;
  stop(): Promise<{ ok: boolean }>;
};

type FileDownloadPlugin = {
  download(options: {
    url: string;
    fileName?: string;
    token?: string;
  }): Promise<{
    ok: boolean;
    downloadId: number;
    fileName: string;
    destination: string;
  }>;
  query(options: { downloadId: number }): Promise<{
    ok: boolean;
    downloadId: number;
    status: string;
    reason: number;
    totalBytes: number;
    downloadedBytes: number;
    progress: number;
    localUri: string;
    done: boolean;
    failed: boolean;
  }>;
};

const MusicBackground =
  registerPlugin<MusicBackgroundPlugin>("MusicBackground");
const FileDownload = registerPlugin<FileDownloadPlugin>("FileDownload");

const state = {
  songs: [] as Song[],
  filtered: [] as Song[],
  collectionSongs: [] as Song[],
  currentIndex: -1,
  category: "",
  playMode: 0 as PlayMode,
  lyrics: [] as LyricLine[],
  currentLyricIndex: -1,
  restoringTime: 0,
  albums: [] as AlbumGroup[],
  visibleAlbums: [] as AlbumGroup[],
  playerView: "cover" as PlayerView,
  favoriteIds: new Set<string>(),
  playlistIds: new Set<string>(),
  playlists: [] as Playlist[],
  activePlaylistId: defaultPlaylistId,
  recentIds: [] as string[],
  playStats: {} as PlayStats,
  albumDetailSongs: [] as Song[],
  artistDetailSongs: [] as Song[],
  sleepTimer: {
    type: "off" as "off" | "time" | "song" | "list",
    label: "Off",
    endAt: 0,
  },
  importJob: null as ImportJob | null,
};

const $ = <T extends HTMLElement>(selector: string) => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

const ui = {
  menu: $("#menuButton"),
  refresh: $("#refreshButton"),
  coverBackdrop: $("#coverBackdrop") as HTMLImageElement,
  cover: $("#cover") as HTMLImageElement,
  coverEmpty: $("#coverEmpty"),
  title: $("#title"),
  artist: $("#artist"),
  album: $("#album"),
  currentTime: $("#currentTime"),
  duration: $("#duration"),
  seek: $("#seek") as HTMLInputElement,
  mode: $("#modeButton"),
  modeIcon: $("#modeIcon"),
  prev: $("#prevButton"),
  play: $("#playButton"),
  playIcon: $("#playIcon"),
  next: $("#nextButton"),
  lyricsButton: $("#lyricsButton"),
  search: $("#search") as HTMLInputElement,
  featuredRail: $("#featuredRail"),
  recentCount: $("#recentCount"),
  recentList: $("#recentList"),
  loopCount: $("#loopCount"),
  loopList: $("#loopList"),
  albumCount: $("#albumCount"),
  albumGrid: $("#albumGrid"),
  empty: $("#empty"),
  miniPlayer: $("#miniPlayer"),
  miniCover: $("#miniCover") as HTMLImageElement,
  miniCoverEmpty: $("#miniCoverEmpty"),
  miniTitle: $("#miniTitle"),
  miniArtist: $("#miniArtist"),
  miniPlay: $("#miniPlayButton"),
  miniPlayIcon: $("#miniPlayIcon"),
  miniProgressBar: $("#miniProgressBar"),
  drawer: $("#libraryDrawer"),
  drawerScrim: $("#drawerScrim"),
  closeDrawer: $("#closeDrawerButton"),
  drawerAll: $("#drawerAllButton"),
  drawerFavorite: $("#drawerFavoriteButton"),
  drawerPlaylist: $("#drawerPlaylistButton"),
  drawerRecent: $("#drawerRecentButton"),
  drawerBiliImport: $("#drawerBiliImportButton"),
  drawerCreatePlaylist: $("#drawerCreatePlaylistButton"),
  drawerPlaylistList: $("#drawerPlaylistList"),
  drawerAllCount: $("#drawerAllCount"),
  drawerFavoriteCount: $("#drawerFavoriteCount"),
  drawerPlaylistCount: $("#drawerPlaylistCount"),
  drawerRecentCount: $("#drawerRecentCount"),
  collectionScrim: $("#collectionScrim"),
  collectionDrawer: $("#collectionDrawer"),
  closeCollection: $("#closeCollectionButton"),
  collectionTitle: $("#collectionTitle"),
  collectionSubtitle: $("#collectionSubtitle"),
  collectionPlayAll: $("#collectionPlayAllButton"),
  collectionList: $("#collectionList"),
  importScrim: $("#importScrim"),
  importDrawer: $("#importDrawer"),
  closeImport: $("#closeImportButton"),
  importForm: $("#biliImportForm") as HTMLFormElement,
  importItems: $("#biliImportItems") as HTMLTextAreaElement,
  importCategory: $("#biliImportCategory") as HTMLInputElement,
  importTokenField: $("#biliImportTokenField"),
  importToken: $("#biliImportToken") as HTMLInputElement,
  importPlaylist: $("#biliImportPlaylist") as HTMLInputElement,
  importFlat: $("#biliImportFlat") as HTMLInputElement,
  importStatus: $("#biliImportStatus"),
  importMeta: $("#biliImportMeta"),
  importLog: $("#biliImportLog"),
  importDownload: $("#biliImportDownloadButton") as HTMLButtonElement,
  importRefreshLibrary: $("#biliImportRefreshButton"),
  downloadManager: $("#biliDownloadManager"),
  downloadStatus: $("#biliDownloadStatus"),
  downloadMeta: $("#biliDownloadMeta"),
  downloadProgress: $("#biliDownloadProgress"),
  searchScrim: $("#searchScrim"),
  searchPanel: $("#searchPanel"),
  closeSearch: $("#closeSearchButton"),
  searchPanelInput: $("#searchPanelInput") as HTMLInputElement,
  searchSongResults: $("#searchSongResults"),
  searchAlbumResults: $("#searchAlbumResults"),
  searchArtistResults: $("#searchArtistResults"),
  searchPlaylistResults: $("#searchPlaylistResults"),
  albumScrim: $("#albumScrim"),
  albumDrawer: $("#albumDrawer"),
  closeAlbum: $("#closeAlbumButton"),
  albumDetailCover: $("#albumDetailCover") as HTMLImageElement,
  albumDetailTitle: $("#albumDetailTitle"),
  albumDetailSubtitle: $("#albumDetailSubtitle"),
  albumDetailMeta: $("#albumDetailMeta"),
  albumPlayAll: $("#albumPlayAllButton"),
  albumSongList: $("#albumSongList"),
  artistScrim: $("#artistScrim"),
  artistDrawer: $("#artistDrawer"),
  closeArtist: $("#closeArtistButton"),
  artistDetailTitle: $("#artistDetailTitle"),
  artistDetailSubtitle: $("#artistDetailSubtitle"),
  artistPlayAll: $("#artistPlayAllButton"),
  artistAlbumList: $("#artistAlbumList"),
  artistSongList: $("#artistSongList"),
  sheet: $("#playerSheet"),
  sheetBackdrop: $("#sheetBackdrop") as HTMLImageElement,
  sheetCover: $("#sheetCover") as HTMLImageElement,
  sheetCoverEmpty: $("#sheetCoverEmpty"),
  sheetHeaderTitle: $("#sheetHeaderTitle"),
  sheetHeaderArtist: $("#sheetHeaderArtist"),
  sheetRefresh: $("#sheetRefreshButton"),
  sheetStage: $("#sheetStage"),
  sheetTitle: $("#sheetTitle"),
  sheetArtist: $("#sheetArtist"),
  lyricsTitle: $("#lyricsTitle"),
  lyricsArtist: $("#lyricsArtist"),
  sheetViewTabs: $("#sheetViewTabs"),
  coverTab: $("#coverTab"),
  sheetLyrics: $("#sheetLyrics"),
  coverView: $("#coverView"),
  lyricsView: $("#lyricsView"),
  sheetCurrentTime: $("#sheetCurrentTime"),
  sheetDuration: $("#sheetDuration"),
  sheetSeek: $("#sheetSeek") as HTMLInputElement,
  sheetMode: $("#sheetModeButton"),
  sheetModeIcon: $("#sheetModeIcon"),
  sheetPrev: $("#sheetPrevButton"),
  sheetPlay: $("#sheetPlayButton"),
  sheetPlayIcon: $("#sheetPlayIcon"),
  sheetNext: $("#sheetNextButton"),
  sheetQueueButton: $("#sheetQueueButton"),
  favorite: $("#favoriteButton"),
  addPlaylist: $("#addPlaylistButton"),
  sheetMore: $("#sheetMoreButton"),
  moreScrim: $("#moreScrim"),
  moreDrawer: $("#moreDrawer"),
  closeMore: $("#closeMoreButton"),
  moreSubtitle: $("#moreSubtitle"),
  moreFavorite: $("#moreFavoriteButton"),
  morePlaylist: $("#morePlaylistButton"),
  moreInfo: $("#moreInfoButton"),
  moreQueue: $("#moreQueueButton"),
  moreSpeed: $("#moreSpeedButton"),
  speedValue: $("#speedValue"),
  moreSleep: $("#moreSleepButton"),
  sleepScrim: $("#sleepScrim"),
  sleepDrawer: $("#sleepDrawer"),
  closeSleep: $("#closeSleepButton"),
  sleepTimerStatus: $("#sleepTimerStatus"),
  lyricsTab: $("#lyricsTab"),
  queueScrim: $("#queueScrim"),
  queueDrawer: $("#queueDrawer"),
  closeQueue: $("#closeQueueButton"),
  queueMode: $("#queueModeButton"),
  queueModeIcon: $("#queueModeIcon"),
  clearQueue: $("#clearQueueButton"),
  playlistScrim: $("#playlistScrim"),
  playlistDrawer: $("#playlistDrawer"),
  closePlaylist: $("#closePlaylistButton"),
  playlistSubtitle: $("#playlistSubtitle"),
  newMix: $("#newMixButton"),
  playlistCreateForm: $("#playlistCreateForm") as HTMLFormElement,
  playlistNameInput: $("#playlistNameInput") as HTMLInputElement,
  playlistPickerList: $("#playlistPickerList"),
  infoScrim: $("#infoScrim"),
  infoDrawer: $("#infoDrawer"),
  closeInfo: $("#closeInfoButton"),
  infoSubtitle: $("#infoSubtitle"),
  infoList: $("#infoList"),
  sheetInfo: $("#sheetInfoButton"),
  sheetQueue: $("#sheetQueue"),
  queueCount: $("#queueCount"),
  closeSheet: $("#closeSheetButton"),
};

const ensureDefaultPlaylist = () => {
  const existing = state.playlists.find(
    (playlist) => playlist.id === defaultPlaylistId,
  );
  if (existing) return existing;
  const timestamp = new Date().toISOString();
  const playlist = {
    id: defaultPlaylistId,
    name: "Default Playlist",
    songIds: [...state.playlistIds],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  state.playlists.unshift(playlist);
  return playlist;
};

const syncDefaultPlaylistSet = () => {
  const playlist = ensureDefaultPlaylist();
  state.playlistIds = new Set(playlist.songIds);
};

const savePlaylists = () => {
  syncDefaultPlaylistSet();
  localStorage.setItem(playlistStorageKey, JSON.stringify(state.playlists));
};

const normalizePlaylist = (item: unknown): Playlist | null => {
  const source = item as Partial<Playlist> & { song_count?: number };
  const id = normalize(source.id);
  const name = normalize(source.name);
  if (!id || !name) return null;
  const timestamp = new Date().toISOString();
  return {
    id,
    name,
    songIds: Array.isArray(source.songIds)
      ? source.songIds.map(normalize).filter(Boolean)
      : [],
    createdAt: normalize(source.createdAt) || timestamp,
    updatedAt: normalize(source.updatedAt) || timestamp,
  };
};

const loadLocalLibraryState = () => {
  state.favoriteIds = new Set(readJson<string[]>(favoriteStorageKey, []));
  state.playStats = readJson<PlayStats>(playStatsStorageKey, {});
  const rawPlaylists = readJson<unknown>(playlistStorageKey, []);
  if (
    Array.isArray(rawPlaylists) &&
    rawPlaylists.every((item) => typeof item === "string")
  ) {
    state.playlistIds = new Set(rawPlaylists.map(normalize).filter(Boolean));
    state.playlists = [];
    ensureDefaultPlaylist();
  } else if (Array.isArray(rawPlaylists)) {
    state.playlists = rawPlaylists
      .map(normalizePlaylist)
      .filter((item): item is Playlist => Boolean(item));
    ensureDefaultPlaylist();
    syncDefaultPlaylistSet();
  } else {
    state.playlists = [];
    ensureDefaultPlaylist();
  }
  state.recentIds = readJson<string[]>(recentStorageKey, []);
};

const loadRemoteLibraryState = async () => {
  if (!config.apiToken) return;
  const favorites = await apiRequest<{ songs: Song[] }>("/favorites", {}, true);
  if (favorites?.songs) {
    state.favoriteIds = new Set(favorites.songs.map((song) => song.id));
    saveIdSet(favoriteStorageKey, state.favoriteIds);
  }
  const remoteStats = await apiRequest<{ stats: PlayStats }>(
    "/stats",
    {},
    true,
  ).catch(() => null);
  if (remoteStats?.stats) {
    state.playStats = {
      ...remoteStats.stats,
      ...state.playStats,
    };
    localStorage.setItem(playStatsStorageKey, JSON.stringify(state.playStats));
  }
  const remoteHistory = await apiRequest<{ songs: Song[] }>(
    "/history",
    {},
    true,
  ).catch(() => null);
  if (remoteHistory?.songs) {
    const merged = [
      ...state.recentIds,
      ...remoteHistory.songs.map((song) => song.id),
    ].filter((id, index, ids) => ids.indexOf(id) === index);
    state.recentIds = merged.slice(0, 50);
    localStorage.setItem(recentStorageKey, JSON.stringify(state.recentIds));
  }
  const remote = await apiRequest<{
    playlists: Array<{ id: string; name: string; songs?: Song[] }>;
  }>("/playlists", {}, true);
  if (remote?.playlists?.length) {
    const local = new Map(
      state.playlists.map((playlist) => [playlist.id, playlist]),
    );
    remote.playlists.forEach((playlist) => {
      const existing = local.get(playlist.id);
      local.set(playlist.id, {
        id: playlist.id,
        name: playlist.name,
        songIds:
          playlist.songs?.map((song) => song.id) || existing?.songIds || [],
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });
    state.playlists = [...local.values()];
    ensureDefaultPlaylist();
    savePlaylists();
  }
};

const addRecentSong = (song: Song) => {
  state.recentIds = [
    song.id,
    ...state.recentIds.filter((id) => id !== song.id),
  ].slice(0, 50);
  localStorage.setItem(recentStorageKey, JSON.stringify(state.recentIds));
  updateDrawerCounts();
  void apiRequest(
    "/history",
    {
      method: "POST",
      body: JSON.stringify({
        songId: song.id,
        positionSeconds: audio.currentTime || 0,
      }),
    },
    true,
  ).catch(() => undefined);
};

const recordPlay = (song: Song, completed = false) => {
  const current = state.playStats[song.id] || {
    plays: 0,
    completed: 0,
    lastPlayedAt: "",
  };
  state.playStats[song.id] = {
    plays: current.plays + (completed ? 0 : 1),
    completed: current.completed + (completed ? 1 : 0),
    lastPlayedAt: new Date().toISOString(),
  };
  localStorage.setItem(playStatsStorageKey, JSON.stringify(state.playStats));
  void apiRequest(
    `/stats/${encodeURIComponent(song.id)}`,
    {
      method: "POST",
      body: JSON.stringify(state.playStats[song.id]),
    },
    true,
  ).catch(() => undefined);
};

const getRecommendedSongs = () => {
  const base = state.filtered.length ? state.filtered : state.songs;
  return getHeartRecommendations({
    songs: base,
    favorites: state.favoriteIds,
    defaultPlaylistIds: ensureDefaultPlaylist().songIds,
    stats: state.playStats,
  });
};

const getLoopRankingSongs = () => {
  const base = state.filtered.length ? state.filtered : state.songs;
  return getLoopRankingSongsFor(base, state.playStats);
};

const getDailySongs = () => {
  const base = state.filtered.length ? state.filtered : state.songs;
  return getDailyRecommendations({
    songs: base,
    favorites: state.favoriteIds,
    defaultPlaylistIds: ensureDefaultPlaylist().songIds,
    stats: state.playStats,
  });
};

const updateBackgroundPlayback = () => {
  if (!Capacitor.isNativePlatform()) return;
  if (audio.paused) {
    void MusicBackground.stop().catch(() => undefined);
    return;
  }
  const song = state.songs[state.currentIndex];
  void MusicBackground.start({
    title: song?.title || "FallRain Music",
    artist: song?.artist || "Playing audio",
  }).catch(() => undefined);
};

const songsFromIds = (ids: Iterable<string>) => {
  return getSongsFromIds(state.songs, ids);
};

const songPlaylistCount = (song: Song | null) =>
  song
    ? state.playlists.filter((playlist) => playlist.songIds.includes(song.id))
        .length
    : 0;

const isSameAlbum = (song: Song, target: Song | AlbumGroup) =>
  song.artist === target.artist &&
  song.album === ("album" in target ? target.album : target.title);

const albumForSong = (song: Song) =>
  buildAlbums(state.songs.filter((item) => isSameAlbum(item, song)))[0];

const songsByArtist = (artist: string) =>
  state.songs.filter((song) => song.artist === artist);

const updateDrawerCounts = () => {
  syncDefaultPlaylistSet();
  ui.drawerAllCount.textContent = String(state.songs.length);
  ui.drawerFavoriteCount.textContent = String(state.favoriteIds.size);
  ui.drawerPlaylistCount.textContent = String(state.playlistIds.size);
  ui.drawerRecentCount.textContent = String(
    state.recentIds.filter((id) => state.songs.some((song) => song.id === id))
      .length,
  );
  renderPlaylistLists();
};

const saveState = () => {
  const current = state.songs[state.currentIndex];
  if (!current) return;
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      id: current.id,
      time: audio.currentTime,
      playMode: state.playMode,
      category: state.category,
    }),
  );
};

const readSavedState = () => {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || "{}") as {
      id?: string;
      time?: number;
      playMode?: number;
      category?: string;
    };
  } catch {
    return {};
  }
};

const setImage = (
  img: HTMLImageElement,
  fallback: HTMLElement,
  src: string,
) => {
  img.removeAttribute("src");
  img.classList.remove("visible");
  fallback.hidden = false;
  if (!src) return;
  img.onload = () => {
    img.classList.add("visible");
    fallback.hidden = true;
  };
  img.onerror = () => {
    img.classList.remove("visible");
    fallback.hidden = false;
  };
  img.src = src;
};

const updateArtwork = (song: Song | null) => {
  setImage(ui.cover, ui.coverEmpty, song?.cover || "");
  setImage(ui.miniCover, ui.miniCoverEmpty, song?.cover || "");
  setImage(ui.sheetCover, ui.sheetCoverEmpty, song?.cover || "");
  ui.coverBackdrop.classList.remove("visible");
  ui.coverBackdrop.removeAttribute("src");
  ui.sheetBackdrop.classList.remove("visible");
  ui.sheetBackdrop.removeAttribute("src");
  if (song?.cover) {
    ui.coverBackdrop.onload = () => ui.coverBackdrop.classList.add("visible");
    ui.coverBackdrop.src = song.cover;
    ui.sheetBackdrop.onload = () => ui.sheetBackdrop.classList.add("visible");
    ui.sheetBackdrop.src = song.cover;
  }
};

const setMediaSession = (song: Song) => {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title,
    artist: song.artist,
    album: song.album,
    artwork: song.cover
      ? [
          {
            src: song.cover,
            sizes: "512x512",
            type: "image/jpeg",
          },
        ]
      : [],
  });
  navigator.mediaSession.setActionHandler("play", () => void play());
  navigator.mediaSession.setActionHandler("pause", () => audio.pause());
  navigator.mediaSession.setActionHandler("previoustrack", () => playPrev());
  navigator.mediaSession.setActionHandler("nexttrack", () => playNext(false));
  navigator.mediaSession.setActionHandler("stop", () => audio.pause());
  navigator.mediaSession.setActionHandler("seekto", (details) => {
    if (typeof details.seekTime === "number")
      audio.currentTime = details.seekTime;
  });
};

const updateNowPlaying = (song: Song | null) => {
  ui.title.textContent = song?.title || "Nothing playing";
  ui.artist.textContent = song?.artist || "";
  ui.album.textContent = song?.album || "";
  ui.miniTitle.textContent = song?.title || "Nothing playing";
  ui.miniArtist.textContent = song?.artist || "";
  ui.sheetHeaderTitle.textContent = song?.title || "Nothing playing";
  ui.sheetHeaderArtist.textContent = song?.artist || "";
  ui.sheetTitle.textContent = song?.title || "Nothing playing";
  ui.sheetArtist.textContent = song ? `${song.artist} - ${song.album}` : "";
  ui.lyricsTitle.textContent = song?.title || "Nothing playing";
  ui.lyricsArtist.textContent = song ? `${song.artist} - ${song.album}` : "";
  ui.moreSubtitle.textContent = song?.title || "Current track";
  updateArtwork(song);
  ui.miniPlayer.classList.toggle("is-idle", !song);
  updateLibraryActionButtons(song);
  renderSongInfo(song);
  if (song) setMediaSession(song);
};

const renderSongInfo = (song: Song | null) => {
  ui.infoSubtitle.textContent = song?.title || "Current track";
  if (!song) {
    ui.infoList.innerHTML = setInfoItem("Status", "Nothing playing");
    return;
  }
  ui.infoList.innerHTML = [
    setInfoItem("Title", song.title),
    `
      <div>
        <dt>Artist</dt>
        <dd><button class="info-link" type="button" data-info-action="artist">${escapeHtml(song.artist)}</button></dd>
      </div>
    `,
    `
      <div>
        <dt>Album</dt>
        <dd><button class="info-link" type="button" data-info-action="album">${escapeHtml(song.album)}</button></dd>
      </div>
    `,
    setInfoItem("Category", song.category),
    setInfoItem("Track", song.track ? String(song.track) : ""),
    setInfoItem("Duration", song.duration || formatTime(audio.duration)),
    setInfoItem("Lyrics", song.lrc ? "Available" : "Not available"),
    setInfoItem("Favorite", state.favoriteIds.has(song.id) ? "Yes" : "No"),
    setInfoItem(
      "Playlists",
      songPlaylistCount(song)
        ? `${songPlaylistCount(song)} playlist(s)`
        : "Not added",
    ),
  ].join("");
};

const updatePlayButton = () => {
  const icon = audio.paused ? icons.play : icons.pause;
  const label = audio.paused ? "Play" : "Pause";
  ui.playIcon.innerHTML = icon;
  ui.miniPlayIcon.innerHTML = icon;
  ui.sheetPlayIcon.innerHTML = icon;
  ui.play.setAttribute("aria-label", label);
  ui.miniPlay.setAttribute("aria-label", label);
  ui.sheetPlay.setAttribute("aria-label", label);
  ui.sheet.classList.toggle("is-playing", !audio.paused);
  updateBackgroundPlayback();
};

const updateModeButton = () => {
  const icon = playModeIcon(state.playMode);
  const label = playModeLabel(state.playMode);
  ui.modeIcon.innerHTML = icon;
  ui.sheetModeIcon.innerHTML = icon;
  ui.queueModeIcon.innerHTML = icon;
  ui.mode.setAttribute("aria-label", label);
  ui.sheetMode.setAttribute("aria-label", label);
  ui.queueMode.setAttribute("aria-label", label);
};

const cyclePlayMode = () => {
  state.playMode = nextPlayMode(state.playMode);
  updateModeButton();
  saveState();
};

const updateLibraryActionButtons = (song: Song | null) => {
  const favorite = Boolean(song && state.favoriteIds.has(song.id));
  const playlist = songPlaylistCount(song) > 0;
  ui.favorite.classList.toggle("active", favorite);
  ui.addPlaylist.classList.toggle("active", playlist);
  ui.favorite.setAttribute("aria-pressed", String(favorite));
  ui.addPlaylist.setAttribute("aria-pressed", String(playlist));
  updateDrawerCounts();
};

const renderSongRows = (
  container: HTMLElement,
  songs: Song[],
  startIndex = 0,
) => {
  container.innerHTML = "";
  songs.forEach((song, index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "home-song";
    const active = state.songs[state.currentIndex]?.id === song.id;
    if (active) item.classList.add("active");
    item.innerHTML = `
      <span class="home-song-cover">${song.cover ? `<img src="${escapeHtml(song.cover)}" alt="">` : ""}</span>
      <span class="item-main">
        <strong>${escapeHtml(song.title)}</strong>
        <small>
          ${state.favoriteIds.has(song.id) ? '<b class="song-badge heart">♥</b>' : ""}
          <b class="song-badge">${escapeHtml(song.category || "Local")}</b>
          ${escapeHtml(song.artist)}
        </small>
      </span>
      <span class="home-song-play" aria-hidden="true">
        <svg class="icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7-11-7Z"/></svg>
      </span>
    `;
    item.addEventListener("click", () => void playSong(song, true));
    container.append(item);
  });
};

const renderRecent = () => {
  const recent = getRecommendedSongs();
  ui.recentCount.textContent = `${recent.length} tracks`;
  renderSongRows(ui.recentList, recent);
};

const renderLoopSection = () => {
  const songs = getLoopRankingSongs();
  ui.loopCount.textContent = `${songs.length} tracks`;
  renderSongRows(ui.loopList, songs, 3);
};

const renderFeatured = () => {
  ui.featuredRail.innerHTML = "";
  const daily = getDailySongs();
  const cards = state.visibleAlbums.slice(0, 4);
  const featureItems = [
    {
      label: "每日推荐",
      title: "今天适合重听这些歌",
      cover: daily[0]?.cover || "",
      songs: daily,
    },
    ...cards.map((album) => ({
      label: album.category || "本地专辑",
      title: album.title,
      cover: album.cover,
      songs: album.songs,
    })),
  ];
  featureItems.forEach((feature) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "feature-card";
    item.innerHTML = `
      <span class="feature-cover">${feature.cover ? `<img src="${escapeHtml(feature.cover)}" alt="">` : ""}</span>
      <span class="feature-shade"></span>
      <strong>${escapeHtml(feature.label)}</strong>
      <small>${escapeHtml(feature.title)}</small>
      <span class="feature-play" aria-hidden="true">
        <svg class="icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7-11-7Z"/></svg>
      </span>
    `;
    item.addEventListener("click", () => {
      state.filtered = feature.songs;
      state.visibleAlbums = buildAlbums(state.filtered);
      if (feature.songs[0]) void playSong(feature.songs[0], true);
      renderRecent();
      renderLoopSection();
      renderAlbums();
      renderQueue();
    });
    ui.featuredRail.append(item);
  });
};

const renderPlaylistLists = () => {
  const current = state.songs[state.currentIndex] || null;
  ui.playlistSubtitle.textContent = current
    ? current.title
    : "Create and manage playlists";

  ui.drawerPlaylistList.innerHTML = "";
  state.playlists
    .filter((playlist) => playlist.id !== defaultPlaylistId)
    .forEach((playlist) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "drawer-playlist-item";
      item.innerHTML = `
        <span>${escapeHtml(playlist.name)}</span>
        <small>${playlist.songIds.length}</small>
      `;
      item.addEventListener("click", () =>
        openSongCollection(
          playlist.name,
          songsFromIds(playlist.songIds),
          `${playlist.songIds.length} tracks`,
        ),
      );
      ui.drawerPlaylistList.append(item);
    });

  ui.playlistPickerList.innerHTML = "";
  state.playlists.forEach((playlist) => {
    const contains = Boolean(current && playlist.songIds.includes(current.id));
    const firstSong = songsFromIds(playlist.songIds)[0];
    const item = document.createElement("button");
    item.type = "button";
    item.className = "playlist-picker-item";
    if (contains) item.classList.add("active");
    item.innerHTML = `
      <span class="playlist-picker-cover">
        ${firstSong?.cover ? `<img src="${escapeHtml(firstSong.cover)}" alt="">` : ""}
        ${contains ? '<b aria-hidden="true">✓</b>' : ""}
      </span>
      <span class="item-main">
        <strong>${escapeHtml(playlist.name)}</strong>
        <small>${playlist.songIds.length} track${playlist.songIds.length === 1 ? "" : "s"}</small>
      </span>
      <span class="playlist-added-pill">${contains ? "Added" : "Add"}</span>
    `;
    item.addEventListener("click", () => {
      if (current) void toggleSongInPlaylist(playlist.id, current);
      else
        openSongCollection(
          playlist.name,
          songsFromIds(playlist.songIds),
          `${playlist.songIds.length} tracks`,
        );
    });
    ui.playlistPickerList.append(item);
  });
};

const renderAlbums = () => {
  ui.albumGrid.innerHTML = "";
  ui.empty.hidden = state.visibleAlbums.length > 0;
  ui.albumCount.textContent = `${state.visibleAlbums.length} albums`;
  state.visibleAlbums.forEach((album) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "album-card";
    item.innerHTML = `
      <span class="album-cover">${album.cover ? `<img src="${escapeHtml(album.cover)}" alt="">` : ""}</span>
      <strong>${escapeHtml(album.title)}</strong>
      <small>${escapeHtml(album.artist)} - ${album.songs.length} tracks</small>
    `;
    item.addEventListener("click", () => {
      state.filtered = album.songs;
      void playSong(album.songs[0], true);
      setSheetOpen(true);
      renderQueue();
    });
    ui.albumGrid.append(item);
  });
};

const renderQueue = () => {
  ui.sheetQueue.innerHTML = "";
  ui.queueCount.textContent = `${state.filtered.length} tracks`;
  state.filtered.forEach((song, index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "queue-item";
    const active = state.songs[state.currentIndex]?.id === song.id;
    if (active) item.classList.add("active");
    item.innerHTML = `
      <span>${song.track || index + 1}</span>
      <strong>${escapeHtml(song.title)}</strong>
      <small>${escapeHtml(song.artist)}</small>
    `;
    item.addEventListener("click", () => playSong(song, true));
    ui.sheetQueue.append(item);
  });
};

const renderCollectionList = () => {
  ui.collectionList.innerHTML = "";
  if (!state.collectionSongs.length) {
    ui.collectionList.innerHTML =
      '<p class="collection-empty">No songs yet</p>';
    return;
  }
  state.collectionSongs.forEach((song, index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "collection-item";
    const active = state.songs[state.currentIndex]?.id === song.id;
    if (active) item.classList.add("active");
    item.innerHTML = `
      <span class="collection-cover">${song.cover ? `<img src="${escapeHtml(song.cover)}" alt="">` : ""}</span>
      <span class="item-main">
        <strong>${escapeHtml(song.title)}</strong>
        <small>${escapeHtml(song.artist)} - ${escapeHtml(song.album)}</small>
      </span>
      <span class="item-index">${song.track || index + 1}</span>
    `;
    item.addEventListener("click", () => {
      state.filtered = [...state.collectionSongs];
      state.visibleAlbums = buildAlbums(state.filtered);
      renderQueue();
      void playSong(song, true);
      setCollectionOpen(false);
    });
    ui.collectionList.append(item);
  });
};

const renderDetailSongList = (
  container: HTMLElement,
  songs: Song[],
  onClick: (song: Song) => void,
) => {
  container.innerHTML = "";
  if (!songs.length) {
    container.innerHTML = '<p class="collection-empty">No songs yet</p>';
    return;
  }
  songs.forEach((song, index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "collection-item";
    const active = state.songs[state.currentIndex]?.id === song.id;
    if (active) item.classList.add("active");
    item.innerHTML = `
      <span class="collection-cover">${song.cover ? `<img src="${escapeHtml(song.cover)}" alt="">` : ""}</span>
      <span class="item-main">
        <strong>${escapeHtml(song.title)}</strong>
        <small>${escapeHtml(song.artist)} - ${escapeHtml(song.album)}</small>
      </span>
      <span class="item-index">${song.track || index + 1}</span>
    `;
    item.addEventListener("click", () => onClick(song));
    container.append(item);
  });
};

const renderSearchGroup = (
  container: HTMLElement,
  items: Array<{
    title: string;
    subtitle: string;
    meta?: string;
    action: () => void;
  }>,
) => {
  container.innerHTML = "";
  container.className = "search-result-list";
  if (!items.length) {
    container.innerHTML = '<p class="collection-empty">No results</p>';
    return;
  }
  items.forEach((result) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "search-result-item";
    item.innerHTML = `
      <span>
        <strong>${escapeHtml(result.title)}</strong>
        <small>${escapeHtml(result.subtitle)}</small>
      </span>
      <small>${escapeHtml(result.meta || "")}</small>
    `;
    item.addEventListener("click", result.action);
    container.append(item);
  });
};

const setSearchOpen = (open: boolean) => {
  ui.searchPanel.classList.toggle("open", open);
  ui.searchScrim.hidden = !open;
  document.body.classList.toggle("modal-open", open);
  if (open) {
    ui.searchPanelInput.value = "";
    renderSearchResults();
    requestAnimationFrame(() => ui.searchPanelInput.focus());
  }
};

const setAlbumOpen = (open: boolean) => {
  ui.albumDrawer.classList.toggle("open", open);
  ui.albumScrim.hidden = !open;
  document.body.classList.toggle("modal-open", open);
};

const setArtistOpen = (open: boolean) => {
  ui.artistDrawer.classList.toggle("open", open);
  ui.artistScrim.hidden = !open;
  document.body.classList.toggle("modal-open", open);
};

const openAlbumDetail = (album: AlbumGroup) => {
  const songs = [...album.songs].sort(
    (a, b) => (a.track || 9999) - (b.track || 9999),
  );
  state.albumDetailSongs = songs;
  ui.albumDetailTitle.textContent = album.title;
  ui.albumDetailSubtitle.textContent = `${songs.length} track${songs.length === 1 ? "" : "s"}`;
  ui.albumDetailMeta.textContent = [album.artist, album.category]
    .filter(Boolean)
    .join(" - ");
  ui.albumDetailCover.src = album.cover || "";
  renderDetailSongList(ui.albumSongList, songs, (song) => {
    state.filtered = [...songs];
    state.visibleAlbums = buildAlbums(state.filtered);
    renderQueue();
    void playSong(song, true);
    setAlbumOpen(false);
  });
  setSearchOpen(false);
  setInfoOpen(false);
  setArtistOpen(false);
  setAlbumOpen(true);
};

const openArtistDetail = (artist: string) => {
  const songs = songsByArtist(artist);
  const albums = buildAlbums(songs);
  state.artistDetailSongs = songs;
  ui.artistDetailTitle.textContent = artist;
  ui.artistDetailSubtitle.textContent = `${songs.length} track${songs.length === 1 ? "" : "s"} - ${albums.length} album${albums.length === 1 ? "" : "s"}`;
  ui.artistAlbumList.innerHTML = "";
  albums.forEach((album) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "detail-chip";
    item.innerHTML = `
      <strong>${escapeHtml(album.title)}</strong>
      <small>${album.songs.length} tracks</small>
    `;
    item.addEventListener("click", () => openAlbumDetail(album));
    ui.artistAlbumList.append(item);
  });
  renderDetailSongList(ui.artistSongList, songs, (song) => {
    state.filtered = [...songs];
    state.visibleAlbums = buildAlbums(state.filtered);
    renderQueue();
    void playSong(song, true);
    setArtistOpen(false);
  });
  setSearchOpen(false);
  setInfoOpen(false);
  setArtistOpen(true);
};

const renderSearchResults = () => {
  const query = ui.searchPanelInput.value.trim().toLowerCase();
  const match = (value: string) =>
    !query || value.toLowerCase().includes(query);
  const songResults = state.songs
    .filter((song) =>
      match(`${song.title} ${song.artist} ${song.album} ${song.category}`),
    )
    .slice(0, 8)
    .map((song) => ({
      title: song.title,
      subtitle: `${song.artist} - ${song.album}`,
      meta: song.category || "Song",
      action: () => {
        state.filtered = [...state.songs];
        state.visibleAlbums = [...state.albums];
        renderQueue();
        void playSong(song, true);
        setSearchOpen(false);
      },
    }));

  const albumResults = state.albums
    .filter((album) =>
      match(`${album.title} ${album.artist} ${album.category}`),
    )
    .slice(0, 6)
    .map((album) => ({
      title: album.title,
      subtitle: album.artist,
      meta: `${album.songs.length} tracks`,
      action: () => openAlbumDetail(album),
    }));

  const artists = [
    ...new Set(state.songs.map((song) => song.artist).filter(Boolean)),
  ]
    .filter((artist) => match(artist))
    .slice(0, 6)
    .map((artist) => {
      const songs = songsByArtist(artist);
      return {
        title: artist,
        subtitle: `${buildAlbums(songs).length} albums`,
        meta: `${songs.length} tracks`,
        action: () => openArtistDetail(artist),
      };
    });

  const playlistResults = state.playlists
    .filter((playlist) => match(playlist.name))
    .slice(0, 6)
    .map((playlist) => ({
      title: playlist.name,
      subtitle: "Playlist",
      meta: `${playlist.songIds.length} tracks`,
      action: () => {
        setSearchOpen(false);
        openSongCollection(
          playlist.name,
          songsFromIds(playlist.songIds),
          `${playlist.songIds.length} tracks`,
        );
      },
    }));

  renderSearchGroup(ui.searchSongResults, songResults);
  renderSearchGroup(ui.searchAlbumResults, albumResults);
  renderSearchGroup(ui.searchArtistResults, artists);
  renderSearchGroup(ui.searchPlaylistResults, playlistResults);
};

const applyFilter = () => {
  const query = ui.search.value.trim().toLowerCase();

  state.filtered = state.songs.filter((song) => {
    const haystack = `${song.title} ${song.artist} ${song.album}`.toLowerCase();
    return !query || haystack.includes(query);
  });

  state.visibleAlbums = state.albums.filter((album) => {
    const haystack =
      `${album.title} ${album.artist} ${album.category}`.toLowerCase();
    return (
      !query ||
      haystack.includes(query) ||
      album.songs.some((song) => state.filtered.includes(song))
    );
  });

  saveState();
  renderRecent();
  renderFeatured();
  renderLoopSection();
  renderAlbums();
  renderQueue();
};

const loadLyrics = async (song: Song) => {
  state.lyrics = [];
  state.currentLyricIndex = -1;
  ui.sheetLyrics.innerHTML = "";
  if (!song.lrc) {
    ui.sheetLyrics.innerHTML = '<p class="lyric-empty">No lyrics available</p>';
    return;
  }

  const text =
    /^https?:\/\//i.test(song.lrc) || song.lrc.startsWith("/")
      ? await fetch(resolveUrl(song.lrc)).then((response) =>
          response.ok ? response.text() : "",
        )
      : song.lrc;

  state.lyrics = parseLyrics(text);
  if (!state.lyrics.length) {
    ui.sheetLyrics.innerHTML =
      '<p class="lyric-empty">No timed lyrics available</p>';
    return;
  }
  state.lyrics.forEach((line, index) => {
    const div = document.createElement("button");
    div.type = "button";
    div.className = "lyric-line";
    div.dataset.index = String(index);
    div.textContent = line.text;
    div.addEventListener("click", () => {
      audio.currentTime = line.time;
    });
    ui.sheetLyrics.append(div);
  });
};

const highlightLyrics = () => {
  if (!state.lyrics.length) return;
  let activeIndex = -1;
  for (let i = 0; i < state.lyrics.length; i += 1) {
    if (audio.currentTime >= state.lyrics[i].time) activeIndex = i;
    else break;
  }
  if (activeIndex === state.currentLyricIndex) return;
  state.currentLyricIndex = activeIndex;
  ui.sheetLyrics
    .querySelectorAll<HTMLElement>(".lyric-line")
    .forEach((line, index) => {
      line.classList.toggle("active", index === activeIndex);
    });
  const activeSheetLine = ui.sheetLyrics.querySelector<HTMLElement>(
    `.lyric-line[data-index="${activeIndex}"]`,
  );
  if (activeSheetLine) {
    ui.sheetLyrics.scrollTo({
      top:
        activeSheetLine.offsetTop -
        ui.sheetLyrics.clientHeight / 2 +
        activeSheetLine.clientHeight / 2,
      behavior: "smooth",
    });
  }
};

const setDrawerOpen = (open: boolean) => {
  ui.drawer.classList.toggle("open", open);
  ui.drawerScrim.hidden = !open;
  document.body.classList.toggle("modal-open", open);
};

const setCollectionOpen = (open: boolean) => {
  ui.collectionDrawer.classList.toggle("open", open);
  ui.collectionScrim.hidden = !open;
  document.body.classList.toggle("modal-open", open);
};

const openSongCollection = (
  title: string,
  songs: Song[],
  subtitle?: string,
) => {
  state.collectionSongs = [...songs];
  ui.collectionTitle.textContent = title;
  ui.collectionSubtitle.textContent =
    subtitle || `${songs.length} track${songs.length === 1 ? "" : "s"}`;
  renderCollectionList();
  setDrawerOpen(false);
  setCollectionOpen(true);
};

const setImportOpen = (open: boolean) => {
  if (open) setDrawerOpen(false);
  ui.importDrawer.classList.toggle("open", open);
  ui.importScrim.hidden = !open;
  document.body.classList.toggle("modal-open", open);
};

const renderImportJob = (job: ImportJob | null) => {
  state.importJob = job;
  ui.importDownload.hidden = true;
  if (!job) {
    ui.importStatus.textContent = "Idle";
    ui.importMeta.textContent = "Paste links and start a job.";
    ui.importLog.textContent = "";
    return;
  }
  const statusText =
    job.status === "running"
      ? "Running"
      : job.status === "done"
        ? "Done"
        : "Failed";
  ui.importStatus.textContent = statusText;
  ui.importMeta.textContent =
    job.status === "done"
      ? `${job.itemCount} item(s), ${job.songs} songs synced`
      : job.error || `${job.itemCount} item(s) in ${job.category}`;
  ui.importLog.textContent = job.log || "";
  const selectedMode = getBiliImportMode();
  if (job.mode && job.mode !== selectedMode) {
    ui.importStatus.textContent = "Mode mismatch";
    ui.importMeta.textContent = `App selected ${selectedMode}, server created ${job.mode}. Restart music-api.`;
    ui.importLog.textContent = `Mode mismatch: selected ${selectedMode}, server created ${job.mode}.\n\n${ui.importLog.textContent}`;
  }
  ui.importLog.scrollTop = ui.importLog.scrollHeight;
  if (job.status === "done" && job.mode === "download" && job.downloadUrl) {
    ui.importDownload.hidden = false;
    ui.importDownload.dataset.url = job.downloadUrl;
    ui.importMeta.textContent = job.expiresAt
      ? `Ready until ${new Date(job.expiresAt).toLocaleTimeString()}`
      : "ZIP package is ready.";
  }
};

const getBiliImportMode = () => {
  const checked = ui.importForm.querySelector<HTMLInputElement>(
    'input[name="biliImportMode"]:checked',
  );
  return checked?.value === "library" ? "library" : "download";
};

const updateBiliImportMode = () => {
  const libraryMode = getBiliImportMode() === "library";
  ui.importTokenField.hidden = !libraryMode;
  ui.importRefreshLibrary.hidden = !libraryMode;
  if (!libraryMode) ui.importToken.value = "";
};

const pollImportJob = async (jobId: string) => {
  window.clearTimeout(importPollTimer);
  const token =
    state.importJob?.mode === "library" ? ui.importToken.value.trim() : "";
  const job = await apiRequest<ImportJob>(
    `/imports/${encodeURIComponent(jobId)}`,
    token ? { headers: { Authorization: `Bearer ${token}` } } : {},
    false,
  ).catch((error) => {
    ui.importStatus.textContent = "Status unavailable";
    ui.importMeta.textContent = error.message;
    return null;
  });
  if (!job) return;
  renderImportJob(job);
  if (job.status === "running") {
    importPollTimer = window.setTimeout(() => void pollImportJob(job.id), 1800);
    return;
  }
  if (job.status === "done") {
    await loadSongs().catch(() => undefined);
  }
};

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const setDownloadProgress = (progress: number) => {
  ui.downloadProgress.style.width = `${Math.min(100, Math.max(0, progress))}%`;
};

const pollDownloadTask = async (downloadId: number) => {
  window.clearTimeout(downloadPollTimer);
  try {
    const task = await FileDownload.query({ downloadId });
    ui.downloadManager.hidden = false;
    setDownloadProgress(task.progress);
    if (task.done) {
      ui.downloadStatus.textContent = "Download complete";
      ui.downloadMeta.textContent = task.localUri || "Saved to Downloads.";
      return;
    }
    if (task.failed) {
      ui.downloadStatus.textContent = "Download failed";
      ui.downloadMeta.textContent = `Reason ${task.reason}`;
      return;
    }
    ui.downloadStatus.textContent = `Downloading ${Math.round(task.progress)}%`;
    ui.downloadMeta.textContent =
      task.totalBytes > 0
        ? `${formatBytes(task.downloadedBytes)} / ${formatBytes(task.totalBytes)}`
        : task.status;
    downloadPollTimer = window.setTimeout(
      () => void pollDownloadTask(downloadId),
      1200,
    );
  } catch (error) {
    ui.downloadStatus.textContent = "Download status unavailable";
    ui.downloadMeta.textContent =
      error instanceof Error ? error.message : "Unable to query download";
  }
};

const downloadImportZip = async () => {
  const url = ui.importDownload.dataset.url;
  const job = state.importJob;
  if (!url || !job) return;
  const fullUrl = /^https?:\/\//i.test(url) ? url : `${config.apiBase}${url}`;
  const fileName = `fallrain-bilibili-${job.id}.zip`;
  ui.importDownload.disabled = true;
  ui.importDownload.textContent = "Starting...";
  ui.downloadManager.hidden = false;
  ui.downloadStatus.textContent = "Preparing download";
  ui.downloadMeta.textContent = fileName;
  setDownloadProgress(0);
  try {
    if (Capacitor.isNativePlatform()) {
      const result = await FileDownload.download({ url: fullUrl, fileName });
      ui.importStatus.textContent = "Download started";
      ui.importMeta.textContent = `Saved to ${result.destination}`;
      ui.downloadStatus.textContent = "Download queued";
      ui.downloadMeta.textContent = result.destination;
      const downloadId = Number(result.downloadId);
      if (Number.isFinite(downloadId) && downloadId > 0) {
        void pollDownloadTask(downloadId);
      } else {
        ui.downloadStatus.textContent = "Download started";
        ui.downloadMeta.textContent =
          "System download manager accepted the task, but did not return an id.";
      }
    } else {
      const anchor = document.createElement("a");
      anchor.href = fullUrl;
      anchor.download = fileName;
      anchor.rel = "noopener";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      ui.importStatus.textContent = "Download started";
      ui.importMeta.textContent = fileName;
    }
  } catch (error) {
    ui.importStatus.textContent = "Download failed";
    ui.importMeta.textContent =
      error instanceof Error ? error.message : "Unable to start download";
  } finally {
    ui.importDownload.disabled = false;
    ui.importDownload.textContent = "Download ZIP";
  }
};

const startBiliImport = async () => {
  const mode = getBiliImportMode();
  const token = mode === "library" ? ui.importToken.value.trim() : "";
  if (mode === "library" && !token) {
    ui.importStatus.textContent = "Token required";
    ui.importMeta.textContent =
      "Add to library requires the administrator token.";
    return;
  }
  if (mode === "library" && (!config.apiToken || token !== config.apiToken)) {
    ui.importStatus.textContent = "Token rejected";
    ui.importMeta.textContent =
      "Only the administrator can add songs to the library.";
    return;
  }
  const items = ui.importItems.value.trim();
  if (!items) {
    ui.importStatus.textContent = "Missing links";
    ui.importMeta.textContent = "Enter at least one BV id or Bilibili URL.";
    return;
  }
  const submit =
    ui.importForm.querySelector<HTMLButtonElement>(".import-submit");
  if (submit) submit.disabled = true;
  ui.importStatus.textContent = "Starting";
  ui.importMeta.textContent =
    mode === "download"
      ? "Creating temporary ZIP job..."
      : "Creating library import job...";
  ui.importLog.textContent = `Client selected mode: ${mode}\n`;
  ui.downloadManager.hidden = true;
  setDownloadProgress(0);
  try {
    const job = await apiRequest<ImportJob>(
      "/imports/bilibili",
      {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: JSON.stringify({
          items,
          mode,
          category: ui.importCategory.value.trim() || "Bilibili",
          playlist: ui.importPlaylist.checked,
          flatCategory: ui.importFlat.checked,
          categoryDepth: 1,
        }),
      },
      false,
    );
    if (!job) throw new Error("Music API token is not configured.");
    renderImportJob(job);
    void pollImportJob(job.id);
  } catch (error) {
    ui.importStatus.textContent = "Failed";
    ui.importMeta.textContent =
      error instanceof Error ? error.message : "Import failed";
  } finally {
    if (submit) submit.disabled = false;
  }
};

const closeSheetDrawers = () => {
  ui.queueDrawer.classList.remove("open");
  ui.infoDrawer.classList.remove("open");
  ui.playlistDrawer.classList.remove("open");
  ui.moreDrawer.classList.remove("open");
  ui.sleepDrawer.classList.remove("open");
  ui.queueScrim.hidden = true;
  ui.infoScrim.hidden = true;
  ui.playlistScrim.hidden = true;
  ui.moreScrim.hidden = true;
  ui.sleepScrim.hidden = true;
};

const setSheetOpen = (open: boolean) => {
  ui.sheet.classList.toggle("open", open);
  document.body.classList.toggle("modal-open", open);
  if (!open) {
    closeSheetDrawers();
  }
  if (open) showSheetTab("cover");
};

const showSheetTab = (tab: PlayerView) => {
  state.playerView = tab;
  localStorage.setItem(playerViewStorageKey, tab);
  const views: Array<[PlayerView, HTMLElement, HTMLElement]> = [
    ["cover", ui.coverView, ui.coverTab],
    ["lyrics", ui.lyricsView, ui.lyricsTab],
  ];
  views.forEach(([view, panel, tabButton]) => {
    const active = view === tab;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
    tabButton.classList.toggle("active", active);
  });
  if (tab === "lyrics") highlightLyrics();
};

const setQueueOpen = (open: boolean) => {
  if (open) closeSheetDrawers();
  ui.queueDrawer.classList.toggle("open", open);
  ui.queueScrim.hidden = !open;
};

const setPlaylistDrawerOpen = (open: boolean) => {
  if (open) closeSheetDrawers();
  ui.playlistDrawer.classList.toggle("open", open);
  ui.playlistScrim.hidden = !open;
  if (open) {
    renderPlaylistLists();
  }
};

const setInfoOpen = (open: boolean) => {
  if (open) closeSheetDrawers();
  ui.infoDrawer.classList.toggle("open", open);
  ui.infoScrim.hidden = !open;
};

const setMoreOpen = (open: boolean) => {
  if (open) closeSheetDrawers();
  ui.moreDrawer.classList.toggle("open", open);
  ui.moreScrim.hidden = !open;
};

const setSleepOpen = (open: boolean) => {
  if (open) closeSheetDrawers();
  ui.sleepDrawer.classList.toggle("open", open);
  ui.sleepScrim.hidden = !open;
};

const createPlaylist = async (name: string) => {
  const trimmed = normalize(name);
  if (!trimmed) return;
  let id = makeLocalId();
  if (config.apiToken) {
    const remote = await apiRequest<{ id: string; name: string }>(
      "/playlists",
      {
        method: "POST",
        body: JSON.stringify({ name: trimmed }),
      },
      true,
    ).catch(() => null);
    if (remote?.id) id = remote.id;
  }
  const timestamp = new Date().toISOString();
  state.playlists.push({
    id,
    name: trimmed,
    songIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  savePlaylists();
  ui.playlistNameInput.value = "";
  ui.playlistCreateForm.hidden = true;
  updateDrawerCounts();
};

const toggleSongInPlaylist = async (playlistId: string, song: Song) => {
  const playlist = state.playlists.find((item) => item.id === playlistId);
  if (!playlist) return;
  const exists = playlist.songIds.includes(song.id);
  playlist.songIds = exists
    ? playlist.songIds.filter((id) => id !== song.id)
    : [...playlist.songIds, song.id];
  playlist.updatedAt = new Date().toISOString();
  savePlaylists();
  updateLibraryActionButtons(song);
  renderSongInfo(song);
  renderPlaylistLists();

  const path = `/playlists/${encodeURIComponent(playlistId)}/songs`;
  if (exists) {
    void apiRequest(
      `${path}/${encodeURIComponent(song.id)}`,
      {
        method: "DELETE",
      },
      true,
    ).catch(() => undefined);
  } else {
    void apiRequest(
      path,
      {
        method: "POST",
        body: JSON.stringify({ songId: song.id }),
      },
      true,
    ).catch(() => undefined);
  }
};

const toggleFavoriteSong = (song: Song) => {
  const willFavorite = !state.favoriteIds.has(song.id);
  if (willFavorite) state.favoriteIds.add(song.id);
  else state.favoriteIds.delete(song.id);
  saveIdSet(favoriteStorageKey, state.favoriteIds);
  updateLibraryActionButtons(song);
  renderSongInfo(song);
  renderRecent();
  void apiRequest(
    `/favorites/${encodeURIComponent(song.id)}`,
    {
      method: willFavorite ? "POST" : "DELETE",
      body: willFavorite ? JSON.stringify({}) : undefined,
    },
    true,
  ).catch(() => undefined);
};

const updatePlaybackRate = (rate: number) => {
  const safeRate = playbackRates.includes(rate) ? rate : 1;
  audio.playbackRate = safeRate;
  localStorage.setItem(playbackRateStorageKey, String(safeRate));
  ui.speedValue.textContent = `${safeRate}x`;
  if (
    "mediaSession" in navigator &&
    "setPositionState" in navigator.mediaSession
  ) {
    try {
      navigator.mediaSession.setPositionState({
        duration: Number.isFinite(audio.duration) ? audio.duration : 0,
        playbackRate: audio.playbackRate,
        position: audio.currentTime,
      });
    } catch {
      // Some WebView builds reject incomplete media position state.
    }
  }
};

const cyclePlaybackRate = () => {
  const currentIndex = playbackRates.findIndex(
    (rate) => rate === audio.playbackRate,
  );
  updatePlaybackRate(
    playbackRates[
      (currentIndex + 1 + playbackRates.length) % playbackRates.length
    ],
  );
};

const updateSleepTimerStatus = () => {
  if (state.sleepTimer.type === "time" && state.sleepTimer.endAt) {
    const remaining = Math.max(
      0,
      Math.ceil((state.sleepTimer.endAt - Date.now()) / 60000),
    );
    ui.sleepTimerStatus.textContent = `${remaining} min left`;
    return;
  }
  ui.sleepTimerStatus.textContent = state.sleepTimer.label;
};

const clearSleepTimer = () => {
  window.clearTimeout(sleepTimerId);
  state.sleepTimer = { type: "off", label: "Off", endAt: 0 };
  updateSleepTimerStatus();
};

const stopForSleepTimer = () => {
  audio.pause();
  clearSleepTimer();
};

const setSleepTimer = (mode: string) => {
  window.clearTimeout(sleepTimerId);
  if (mode === "off") {
    clearSleepTimer();
  } else if (mode === "song") {
    state.sleepTimer = { type: "song", label: "After current song", endAt: 0 };
  } else if (mode === "list") {
    state.sleepTimer = { type: "list", label: "After current list", endAt: 0 };
  } else {
    const minutes = Number(mode);
    state.sleepTimer = {
      type: "time",
      label: `${minutes} min`,
      endAt: Date.now() + minutes * 60_000,
    };
    sleepTimerId = window.setTimeout(stopForSleepTimer, minutes * 60_000);
  }
  updateSleepTimerStatus();
};

const shouldStopForSleepTimerAfterEnd = () => {
  if (state.sleepTimer.type === "song") return true;
  if (state.sleepTimer.type !== "list") return false;
  const queue = state.filtered.length ? state.filtered : state.songs;
  const current = state.songs[state.currentIndex];
  if (!current || !queue.length) return true;
  return queue[queue.length - 1]?.id === current.id;
};

const togglePlayerView = () => {
  showSheetTab(state.playerView === "cover" ? "lyrics" : "cover");
};

const playSong = async (song: Song, autoPlay: boolean) => {
  const index = state.songs.findIndex((item) => item.id === song.id);
  if (index === -1) return;
  endAdvanceLocked = false;
  window.clearTimeout(waitingWatchdog);
  failureGuard.resetForSong(song.id);
  state.currentIndex = index;
  audio.src = song.url;
  audio.load();
  updateNowPlaying(song);
  addRecentSong(song);
  recordPlay(song);
  renderRecent();
  renderLoopSection();
  renderQueue();
  void loadLyrics(song);
  saveState();
  if (autoPlay) {
    try {
      await play();
    } catch (error) {
      console.warn("Playback failed, skipping to next track", error);
      handlePlaybackFailure();
    }
  }
};

const playFilteredIndex = (index: number, autoPlay: boolean) => {
  const song = state.filtered[index];
  if (song) void playSong(song, autoPlay);
};

const play = async () => {
  if (state.currentIndex === -1 && state.filtered[0]) {
    await playSong(state.filtered[0], true);
    return;
  }
  await audio.play();
};

const getNextSong = (step = 1) => {
  const queue = state.filtered.length ? state.filtered : state.songs;
  const current = state.songs[state.currentIndex];
  return getQueueSong(
    queue,
    current?.id,
    state.playMode,
    step === -1 ? -1 : 1,
    false,
  );
};

const playNext = (ended: boolean) => {
  const queue = state.filtered.length ? state.filtered : state.songs;
  const current = state.songs[state.currentIndex];
  const song = getQueueSong(queue, current?.id, state.playMode, 1, ended);
  if (song) {
    void playSong(song, true);
    return;
  }
  endAdvanceLocked = false;
  audio.pause();
  audio.currentTime = 0;
};

const advanceAfterEnd = () => {
  if (endAdvanceLocked) return;
  endAdvanceLocked = true;
  const current = state.songs[state.currentIndex];
  if (current) recordPlay(current, true);
  if (shouldStopForSleepTimerAfterEnd()) {
    stopForSleepTimer();
    endAdvanceLocked = false;
    return;
  }
  playNext(true);
};

const scheduleSkipIfStillWaiting = () => {
  window.clearTimeout(waitingWatchdog);
  const startedAt = audio.currentTime;
  waitingWatchdog = window.setTimeout(() => {
    if (!audio.paused && Math.abs(audio.currentTime - startedAt) < 0.25) {
      console.warn("Playback stalled, skipping to next track");
      handlePlaybackFailure();
    }
  }, 18000);
};

const playPrev = () => {
  const song = getNextSong(-1);
  if (song) void playSong(song, true);
};

const handlePlaybackFailure = () => {
  const current = state.songs[state.currentIndex];
  if (!current) return;
  if (failureGuard.shouldRetry(current.id)) {
    audio.load();
    window.setTimeout(
      () => void play().catch(() => handlePlaybackFailure()),
      600,
    );
    return;
  }
  if (!failureGuard.canSkip()) {
    audio.pause();
    return;
  }
  window.setTimeout(() => playNext(false), 650);
};

const restoreSelection = () => {
  const saved = readSavedState();
  state.playMode = normalizePlayMode(saved.playMode);
  state.category = saved.category || "";
  state.restoringTime = Number(saved.time) || 0;
  updateModeButton();
  applyFilter();
  const savedSong = state.songs.find((song) => song.id === saved.id);
  void playSong(savedSong || state.songs[0], false);
};

const loadSongs = async () => {
  ui.albumCount.textContent = "Loading";
  let data: unknown | null = null;
  try {
    data = await apiRequest<{ songs: unknown[] }>(`/songs?t=${Date.now()}`);
  } catch (error) {
    console.warn("Music API unavailable, falling back to songs.json", error);
  }
  if (!data) {
    const response = await fetch(`${config.songsJson}?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(`Failed to load songs: ${response.status}`);
    data = await response.json();
  }
  state.songs = normalizeSongs(data);
  state.filtered = [...state.songs];
  state.albums = buildAlbums(state.songs);
  state.visibleAlbums = [...state.albums];
  await loadRemoteLibraryState().catch(() => undefined);
  updateDrawerCounts();
  restoreSelection();
};

const togglePlay = () => {
  if (audio.paused) void play();
  else audio.pause();
};

ui.menu.addEventListener("click", () => setDrawerOpen(true));
ui.closeDrawer.addEventListener("click", () => setDrawerOpen(false));
ui.drawerScrim.addEventListener("click", () => setDrawerOpen(false));
ui.drawerAll.addEventListener("click", () =>
  openSongCollection("All Music", state.songs),
);
ui.drawerFavorite.addEventListener("click", () =>
  openSongCollection(
    "Favorite Songs",
    songsFromIds(state.favoriteIds),
    `${state.favoriteIds.size} tracks`,
  ),
);
ui.drawerPlaylist.addEventListener("click", () => {
  const playlist = ensureDefaultPlaylist();
  openSongCollection(
    playlist.name,
    songsFromIds(playlist.songIds),
    `${playlist.songIds.length} tracks`,
  );
});
ui.drawerRecent.addEventListener("click", () =>
  openSongCollection(
    "Recently Played",
    songsFromIds(state.recentIds),
    `${state.recentIds.length} tracks`,
  ),
);
ui.drawerBiliImport.addEventListener("click", () => setImportOpen(true));
ui.drawerCreatePlaylist.addEventListener("click", () => {
  setDrawerOpen(false);
  setSheetOpen(true);
  setPlaylistDrawerOpen(true);
});
ui.collectionScrim.addEventListener("click", () => setCollectionOpen(false));
ui.closeCollection.addEventListener("click", () => setCollectionOpen(false));
ui.collectionPlayAll.addEventListener("click", () => {
  const first = state.collectionSongs[0];
  if (!first) return;
  state.filtered = [...state.collectionSongs];
  state.visibleAlbums = buildAlbums(state.filtered);
  renderQueue();
  void playSong(first, true);
  setCollectionOpen(false);
});
ui.importScrim.addEventListener("click", () => setImportOpen(false));
ui.closeImport.addEventListener("click", () => setImportOpen(false));
ui.importForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void startBiliImport();
});
ui.importForm
  .querySelectorAll<HTMLInputElement>('input[name="biliImportMode"]')
  .forEach((input) => input.addEventListener("change", updateBiliImportMode));
ui.importDownload.addEventListener("click", () => {
  void downloadImportZip();
});
ui.importRefreshLibrary.addEventListener("click", () => void loadSongs());
ui.search.addEventListener("click", () => setSearchOpen(true));
ui.search.addEventListener("focus", () => setSearchOpen(true));
ui.searchScrim.addEventListener("click", () => setSearchOpen(false));
ui.closeSearch.addEventListener("click", () => setSearchOpen(false));
ui.searchPanelInput.addEventListener("input", renderSearchResults);
ui.albumScrim.addEventListener("click", () => setAlbumOpen(false));
ui.closeAlbum.addEventListener("click", () => setAlbumOpen(false));
ui.albumPlayAll.addEventListener("click", () => {
  const first = state.albumDetailSongs[0];
  if (!first) return;
  state.filtered = [...state.albumDetailSongs];
  state.visibleAlbums = buildAlbums(state.filtered);
  renderQueue();
  void playSong(first, true);
  setAlbumOpen(false);
});
ui.artistScrim.addEventListener("click", () => setArtistOpen(false));
ui.closeArtist.addEventListener("click", () => setArtistOpen(false));
ui.artistPlayAll.addEventListener("click", () => {
  const first = state.artistDetailSongs[0];
  if (!first) return;
  state.filtered = [...state.artistDetailSongs];
  state.visibleAlbums = buildAlbums(state.filtered);
  renderQueue();
  void playSong(first, true);
  setArtistOpen(false);
});
ui.refresh.addEventListener("click", () => void loadSongs());
ui.sheetRefresh.addEventListener("click", () => void loadSongs());
ui.mode.addEventListener("click", cyclePlayMode);
ui.sheetMode.addEventListener("click", cyclePlayMode);
ui.queueMode.addEventListener("click", cyclePlayMode);
ui.play.addEventListener("click", togglePlay);
ui.miniPlay.addEventListener("click", togglePlay);
ui.sheetPlay.addEventListener("click", togglePlay);
ui.miniPlayer.addEventListener("click", (event) => {
  if ((event.target as HTMLElement).closest("button")) return;
  setSheetOpen(true);
});
ui.closeSheet.addEventListener("click", () => setSheetOpen(false));
ui.prev.addEventListener("click", playPrev);
ui.next.addEventListener("click", () => playNext(false));
ui.sheetPrev.addEventListener("click", playPrev);
ui.sheetNext.addEventListener("click", () => playNext(false));
ui.lyricsButton.addEventListener("click", () => {
  setSheetOpen(true);
  showSheetTab("lyrics");
});
ui.seek.addEventListener("input", () => {
  if (!Number.isFinite(audio.duration)) return;
  audio.currentTime = (Number(ui.seek.value) / 1000) * audio.duration;
});
ui.sheetSeek.addEventListener("input", () => {
  if (!Number.isFinite(audio.duration)) return;
  audio.currentTime = (Number(ui.sheetSeek.value) / 1000) * audio.duration;
});
ui.sheetQueueButton.addEventListener("click", () => {
  setSheetOpen(true);
  setQueueOpen(true);
});
ui.sheetViewTabs.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-view]",
  );
  if (!button) return;
  const view = button.dataset.view;
  if (view === "cover" || view === "lyrics") showSheetTab(view);
});
ui.coverView.addEventListener("click", (event) => {
  if ((event.target as HTMLElement).closest("button")) return;
  showSheetTab("lyrics");
});
ui.lyricsView.addEventListener("click", (event) => {
  if ((event.target as HTMLElement).closest("button")) return;
  showSheetTab("cover");
});
let touchStartX = 0;
let touchStartY = 0;
ui.sheetStage.addEventListener(
  "touchstart",
  (event) => {
    const touch = event.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
  },
  { passive: true },
);
ui.sheetStage.addEventListener(
  "touchend",
  (event) => {
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStartX;
    const deltaY = touch.clientY - touchStartY;
    if (Math.abs(deltaX) > 56 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4) {
      togglePlayerView();
    }
  },
  { passive: true },
);
ui.queueScrim.addEventListener("click", () => setQueueOpen(false));
ui.closeQueue.addEventListener("click", () => setQueueOpen(false));
ui.playlistScrim.addEventListener("click", () => setPlaylistDrawerOpen(false));
ui.closePlaylist.addEventListener("click", () => setPlaylistDrawerOpen(false));
ui.newMix.addEventListener("click", () => {
  ui.playlistCreateForm.hidden = !ui.playlistCreateForm.hidden;
  if (!ui.playlistCreateForm.hidden)
    requestAnimationFrame(() => ui.playlistNameInput.focus());
});
ui.playlistCreateForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void createPlaylist(ui.playlistNameInput.value);
});
ui.sheetInfo.addEventListener("click", () => setInfoOpen(true));
ui.infoScrim.addEventListener("click", () => setInfoOpen(false));
ui.closeInfo.addEventListener("click", () => setInfoOpen(false));
ui.infoList.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-info-action]",
  );
  const song = state.songs[state.currentIndex];
  if (!button || !song) return;
  if (button.dataset.infoAction === "album") {
    const album = albumForSong(song);
    if (album) openAlbumDetail(album);
  } else if (button.dataset.infoAction === "artist") {
    openArtistDetail(song.artist);
  }
});
ui.moreScrim.addEventListener("click", () => setMoreOpen(false));
ui.closeMore.addEventListener("click", () => setMoreOpen(false));
ui.moreFavorite.addEventListener("click", () => {
  const song = state.songs[state.currentIndex];
  if (!song) return;
  toggleFavoriteSong(song);
  setMoreOpen(false);
});
ui.morePlaylist.addEventListener("click", () => {
  setMoreOpen(false);
  setPlaylistDrawerOpen(true);
});
ui.moreInfo.addEventListener("click", () => {
  setMoreOpen(false);
  setInfoOpen(true);
});
ui.moreQueue.addEventListener("click", () => {
  setMoreOpen(false);
  setQueueOpen(true);
});
ui.moreSpeed.addEventListener("click", cyclePlaybackRate);
ui.moreSleep.addEventListener("click", () => {
  setMoreOpen(false);
  setSleepOpen(true);
});
ui.sleepScrim.addEventListener("click", () => setSleepOpen(false));
ui.closeSleep.addEventListener("click", () => setSleepOpen(false));
ui.sleepDrawer.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-sleep]",
  );
  if (!button) return;
  setSleepTimer(button.dataset.sleep || "off");
  setSleepOpen(false);
});
ui.clearQueue.addEventListener("click", () => {
  const current = state.songs[state.currentIndex];
  state.filtered = current ? [current] : [];
  renderQueue();
});
ui.favorite.addEventListener("click", () => {
  const song = state.songs[state.currentIndex];
  if (!song) return;
  toggleFavoriteSong(song);
});
ui.addPlaylist.addEventListener("click", () => {
  const song = state.songs[state.currentIndex];
  if (!song) return;
  setPlaylistDrawerOpen(true);
});
ui.sheetMore.addEventListener("click", () => {
  setMoreOpen(true);
});

audio.addEventListener("play", updatePlayButton);
audio.addEventListener("playing", () => {
  window.clearTimeout(waitingWatchdog);
  failureGuard.markHealthy();
});
audio.addEventListener("waiting", scheduleSkipIfStillWaiting);
audio.addEventListener("stalled", scheduleSkipIfStillWaiting);
audio.addEventListener("error", () => {
  console.warn("Audio element error, skipping to next track", audio.error);
  handlePlaybackFailure();
});
audio.addEventListener("pause", () => {
  window.clearTimeout(waitingWatchdog);
  updatePlayButton();
});
audio.addEventListener("loadedmetadata", () => {
  ui.duration.textContent = formatTime(audio.duration);
  ui.sheetDuration.textContent = formatTime(audio.duration);
  renderSongInfo(state.songs[state.currentIndex] || null);
  if (state.restoringTime > 0 && state.restoringTime < audio.duration) {
    audio.currentTime = state.restoringTime;
    state.restoringTime = 0;
  }
});
audio.addEventListener("timeupdate", () => {
  ui.currentTime.textContent = formatTime(audio.currentTime);
  ui.sheetCurrentTime.textContent = formatTime(audio.currentTime);
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    const progress = audio.currentTime / audio.duration;
    ui.seek.value = String(Math.round(progress * 1000));
    ui.sheetSeek.value = String(Math.round(progress * 1000));
    ui.miniProgressBar.style.width = `${Math.min(100, Math.max(0, progress * 100))}%`;
    if (
      !audio.paused &&
      audio.duration - audio.currentTime <= 0.35 &&
      audio.currentTime > 1
    ) {
      advanceAfterEnd();
    }
  }
  if (
    "mediaSession" in navigator &&
    "setPositionState" in navigator.mediaSession
  ) {
    try {
      navigator.mediaSession.setPositionState({
        duration: Number.isFinite(audio.duration) ? audio.duration : 0,
        playbackRate: audio.playbackRate,
        position: audio.currentTime,
      });
    } catch {
      // Some WebView builds reject incomplete media position state.
    }
  }
  highlightLyrics();
  if (state.sleepTimer.type === "time") updateSleepTimerStatus();
  if (Math.floor(audio.currentTime) % 5 === 0) saveState();
});
audio.addEventListener("ended", advanceAfterEnd);

loadLocalLibraryState();
updateNowPlaying(null);
updatePlayButton();
updateModeButton();
updatePlaybackRate(Number(localStorage.getItem(playbackRateStorageKey)) || 1);
updateSleepTimerStatus();
updateBiliImportMode();
void loadSongs().catch((error) => {
  console.error(error);
  ui.albumCount.textContent = "Load failed";
});
