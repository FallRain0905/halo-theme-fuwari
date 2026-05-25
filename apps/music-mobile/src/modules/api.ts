import { config } from "./config";

export const apiRequest = async <T>(
  path: string,
  init: RequestInit = {},
  requiresAuth = false,
): Promise<T | null> => {
  if (requiresAuth && !config.apiToken) return null;
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  if (config.apiToken)
    headers.set("Authorization", `Bearer ${config.apiToken}`);
  const response = await fetch(`${config.apiBase}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) throw new Error(`API request failed: ${response.status}`);
  return (await response.json()) as T;
};
