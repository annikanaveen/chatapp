import { TEAM_MANIFEST_DISCOVER_SCHEMA } from "../pages/messages/constants.js";
import { directoryChannelForTeamId, normalizeTeamIdInput } from "./user-team-profile.js";

const DISCOVER_TIMEOUT_MS = 20000;

/**
 * Returns true if a TeamManifest for this team ID exists on Graffiti (coach registered the team).
 */
export async function validateTeamIdExists(graffiti, session, normalizedTeamId) {
  if (!graffiti || !session || !normalizedTeamId) {
    return false;
  }
  const channel = directoryChannelForTeamId(normalizedTeamId);
  if (!channel) {
    return false;
  }

  const stream = graffiti.discover([channel], TEAM_MANIFEST_DISCOVER_SCHEMA, session);
  let found = false;

  try {
    await Promise.race([
      (async () => {
        for await (const chunk of stream) {
          const v = chunk?.object?.value;
          if (!v || v.type !== "TeamManifest") {
            continue;
          }
          const posted = normalizeTeamIdInput(String(v.teamId || ""));
          if (posted && posted === normalizedTeamId) {
            found = true;
            return;
          }
        }
      })(),
      new Promise((resolve) => {
        setTimeout(resolve, DISCOVER_TIMEOUT_MS);
      }),
    ]);
  } catch {
    found = false;
  } finally {
    try {
      await stream.return?.({ cursor: "" });
    } catch {
      /* ignore iterator cleanup errors */
    }
  }

  return found;
}

/**
 * Graffiti actor who registered the team (posted TeamManifest). Used for join-request ACLs.
 */
export async function fetchTeamManifestCreatorActor(graffiti, session, normalizedTeamId) {
  if (!graffiti || !session || !normalizedTeamId) {
    return null;
  }
  const channel = directoryChannelForTeamId(normalizedTeamId);
  if (!channel) {
    return null;
  }

  const stream = graffiti.discover([channel], TEAM_MANIFEST_DISCOVER_SCHEMA, session);
  let best = null;

  try {
    await Promise.race([
      (async () => {
        for await (const chunk of stream) {
          const obj = chunk?.object;
          const v = obj?.value;
          if (!v || v.type !== "TeamManifest" || typeof obj?.actor !== "string") {
            continue;
          }
          const posted = normalizeTeamIdInput(String(v.teamId || ""));
          if (posted !== normalizedTeamId) {
            continue;
          }
          const pub = Number(v.published) || 0;
          if (!best || pub > best.pub) {
            best = { pub, creatorActor: obj.actor };
          }
        }
      })(),
      new Promise((resolve) => {
        setTimeout(resolve, DISCOVER_TIMEOUT_MS);
      }),
    ]);
  } catch {
    best = null;
  } finally {
    try {
      await stream.return?.({ cursor: "" });
    } catch {
      /* ignore */
    }
  }

  return best?.creatorActor ?? null;
}
