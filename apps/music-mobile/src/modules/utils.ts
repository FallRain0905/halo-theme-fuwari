export const normalize = (value: unknown) => String(value ?? "").trim();

export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[char];
  });

export const setInfoItem = (label: string, value: string) => `
  <div>
    <dt>${escapeHtml(label)}</dt>
    <dd>${escapeHtml(value || "-")}</dd>
  </div>
`;

export const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${min}:${sec}`;
};

export const makeLocalId = (prefix = "playlist") =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
