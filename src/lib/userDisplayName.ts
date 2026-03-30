const STORAGE_KEY = "ih-last-user-first-last";

export const firstLastFromName = (value: string) => {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1]}`;
};

export function rememberUserFirstLastName(fullName: string) {
  if (typeof window === "undefined") return;
  const trimmed = fullName.trim();
  if (!trimmed) return;
  const firstLast = firstLastFromName(trimmed);
  if (!firstLast) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, firstLast);
  } catch {
    // ignore storage failures
  }
}

export function readRememberedUserFirstLastName() {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

