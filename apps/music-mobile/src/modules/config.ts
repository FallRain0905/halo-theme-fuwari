export const config = {
  baseUrl: "https://blog.fallrain0905.top",
  apiBase:
    import.meta.env.VITE_MUSIC_API_BASE ||
    "https://blog.fallrain0905.top/music-api",
  apiToken:
    import.meta.env.VITE_MUSIC_API_TOKEN ||
    localStorage.getItem("fallrain-music:api-token") ||
    "",
  songsJson: "https://blog.fallrain0905.top/music-library/songs.json",
};

export const resolveUrl = (url: string) => {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `${config.baseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
};
