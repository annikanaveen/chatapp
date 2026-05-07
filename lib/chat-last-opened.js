const STORAGE_PREFIX = "chatapp-chat-last-opened:";

/**
 * @param {string} actor
 * @returns {Record<string, number>}
 */
export function getLastOpenedMap(actor) {
  if (!actor || typeof localStorage === "undefined") {
    return {};
  }
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${encodeURIComponent(actor)}`);
    if (!raw) {
      return {};
    }
    const data = JSON.parse(raw);
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return {};
    }
    return data;
  } catch {
    return {};
  }
}

/**
 * @param {string} actor
 * @param {string} channel
 * @param {number} [at]
 */
export function setLastOpenedForChannel(actor, channel, at = Date.now()) {
  if (!actor || !channel || typeof localStorage === "undefined") {
    return;
  }
  const map = getLastOpenedMap(actor);
  map[channel] = at;
  try {
    localStorage.setItem(
      `${STORAGE_PREFIX}${encodeURIComponent(actor)}`,
      JSON.stringify(map),
    );
  } catch {
    // quota / private mode
  }
}
