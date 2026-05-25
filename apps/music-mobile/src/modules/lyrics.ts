import type { LyricLine } from "./types";

export const parseLyrics = (text: string) => {
  const lines: LyricLine[] = [];
  const timeReg = new RegExp("\\[(\\d{2}):(\\d{2})\\.(\\d{2,3})\\]", "g");
  text.split("\n").forEach((line) => {
    const matches = Array.from(line.matchAll(timeReg));
    if (!matches.length) return;
    const lyricText = line.replace(timeReg, "").trim();
    if (!lyricText) return;
    matches.forEach((match) => {
      const min = Number.parseInt(match[1], 10);
      const sec = Number.parseInt(match[2], 10);
      const ms = Number.parseInt(match[3], 10);
      lines.push({
        time: min * 60 + sec + ms / (match[3].length === 3 ? 1000 : 100),
        text: lyricText,
      });
    });
  });
  return lines.sort((a, b) => a.time - b.time);
};
