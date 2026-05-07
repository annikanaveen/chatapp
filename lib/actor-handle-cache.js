const STORAGE_KEY = "chatapp.actorHandleCache.v1";

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function readMap() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const parsed = raw ? safeParse(raw) : null;
  if (!parsed || typeof parsed !== "object") {
    return {};
  }
  return parsed;
}

export function getCachedHandleForActor(actor) {
  if (!actor) {
    return "";
  }
  const map = readMap();
  const val = map[String(actor)];
  return typeof val === "string" ? val : "";
}

export function setCachedHandleForActor(actor, handleShort) {
  const a = String(actor || "").trim();
  const h = String(handleShort || "").trim();
  if (!a || !h) {
    return;
  }

  const map = readMap();
  map[a] = h;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota / privacy errors
  }
}

