const KEY_STORAGE = 'house-modeler:anthropic-key';

export function loadApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function saveApiKey(key: string) {
  try {
    localStorage.setItem(KEY_STORAGE, key);
  } catch {
    // Not remembered, but usable for this visit.
  }
}

export function forgetApiKey() {
  try {
    localStorage.removeItem(KEY_STORAGE);
  } catch {
    // ignore
  }
}
