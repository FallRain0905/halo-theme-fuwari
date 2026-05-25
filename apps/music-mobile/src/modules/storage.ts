export const readJson = <T>(key: string, fallback: T): T => {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
};

export const saveIdSet = (key: string, value: Set<string>) => {
  localStorage.setItem(key, JSON.stringify([...value]));
};
