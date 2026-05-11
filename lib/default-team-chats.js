import { TEAM_GROUP_CHAT_DEFINITIONS, deriveTeamGroups } from "./team-groups.js";
import { rosterActorsForDefaultTeamChannel } from "./team-audience-resolve.js";
import { loadUserTeamProfile } from "./user-team-profile.js";

function uniqueActors(actors) {
  return [...new Set((actors || []).filter(Boolean))];
}

function randomChannelId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function sortedActorSig(actors) {
  return JSON.stringify([...(actors || [])].filter(Boolean).sort());
}

/**
 * Latest Create-Chat object per `defaultTeamGroupSlug` (by `published`).
 * @param {unknown[]} chatObjects
 * @returns {Map<string, { channel: string; title: string; memberActors: string[]; published: number }>}
 */
export function latestDefaultGroupChatStateBySlug(chatObjects) {
  /** @type {Map<string, { channel: string; title: string; memberActors: string[]; published: number }>} */
  const map = new Map();
  for (const o of chatObjects || []) {
    const v = o?.value;
    if (!v || v.activity !== "Create" || v.type !== "Chat") {
      continue;
    }
    const slug = v.defaultTeamGroupSlug;
    if (typeof slug !== "string" || !slug) {
      continue;
    }
    const pub = Number(v.published) || 0;
    const prev = map.get(slug);
    if (prev && pub <= prev.published) {
      continue;
    }
    const ch = String(v.channel || "").trim();
    if (!ch) {
      continue;
    }
    map.set(slug, {
      channel: ch,
      title: String(v.title || "").trim(),
      memberActors: Array.isArray(v.memberActors) ? v.memberActors : [],
      published: pub,
    });
  }
  return map;
}

/**
 * After a new team manifest, create one chat per `TEAM_GROUP_CHAT_DEFINITIONS`.
 * @param {{ post: (o: unknown, s: unknown) => Promise<unknown> }} graffiti
 * @param {unknown} session
 * @param {string} directoryChannel
 * @param {string} coachActor
 */
export async function postDefaultTeamGroupChats(graffiti, session, directoryChannel, coachActor) {
  if (!graffiti?.post || !session || !directoryChannel || !coachActor) {
    return;
  }
  const p = loadUserTeamProfile(coachActor);
  const creatorGroups = deriveTeamGroups({
    role: p.role,
    sport: p.sport,
    team: p.team,
  });
  for (const spec of TEAM_GROUP_CHAT_DEFINITIONS) {
    const channel = randomChannelId();
    const inChannel = creatorGroups.includes(spec.slug);
    const memberActors = inChannel ? [coachActor] : [];
    /** Creator stays on `allowed` so empty squad channels can still be synced from the coach client. */
    const allowedRecipients = uniqueActors([...memberActors, coachActor]);
    try {
      await graffiti.post(
        {
          value: {
            activity: "Create",
            type: "Chat",
            channel,
            title: spec.title,
            published: Date.now(),
            memberActors: uniqueActors(memberActors),
            defaultTeamGroupSlug: spec.slug,
          },
          channels: [directoryChannel],
          allowed: allowedRecipients,
        },
        session,
      );
    } catch (e) {
      console.error(e);
    }
  }
}

/**
 * Update default channel ACLs when the roster changes (coach client).
 * @param {{ post: (o: unknown, s: unknown) => Promise<unknown> }} graffiti
 * @param {unknown} session
 * @param {string} directoryChannel
 * @param {unknown[]} chatObjects
 * @param {import("./team-audience-resolve.js").RosterPickerRow[]} rosterRows
 */
export async function syncDefaultTeamGroupChats(
  graffiti,
  session,
  directoryChannel,
  chatObjects,
  rosterRows,
) {
  if (!graffiti?.post || !session || !directoryChannel) {
    return;
  }
  const poster = typeof session.actor === "string" ? session.actor : "";
  const bySlug = latestDefaultGroupChatStateBySlug(chatObjects);
  for (const spec of TEAM_GROUP_CHAT_DEFINITIONS) {
    const cur = bySlug.get(spec.slug);
    if (!cur?.channel) {
      continue;
    }
    const desired = rosterActorsForDefaultTeamChannel(rosterRows, spec.slug);
    if (sortedActorSig(cur.memberActors) === sortedActorSig(desired)) {
      continue;
    }
    const title = cur.title || spec.title;
    /**
     * Include the previous member set in `allowed` so anyone who is being
     * removed from the squad can still discover this update — otherwise
     * Graffiti's ACL hides the newer Create from them and their client
     * keeps showing the stale version with themselves still listed.
     */
    const allowedRecipients = uniqueActors([
      ...desired,
      ...(Array.isArray(cur.memberActors) ? cur.memberActors : []),
      poster,
    ]);
    try {
      await graffiti.post(
        {
          value: {
            activity: "Create",
            type: "Chat",
            channel: cur.channel,
            title,
            published: Date.now(),
            memberActors: uniqueActors(desired),
            defaultTeamGroupSlug: spec.slug,
          },
          channels: [directoryChannel],
          allowed: allowedRecipients,
        },
        session,
      );
    } catch (e) {
      console.error(e);
    }
  }
}
