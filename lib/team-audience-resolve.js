import {
  deriveTeamGroups,
  TEAM_GROUP_ORDER,
  TEAM_GROUP_PICKER_OPTIONS,
} from "./team-groups.js";
import {
  latestTeamMemberRosterForTeam,
  latestTeamMemberDisplayNameForActor,
} from "./join-requests-logic.js";

/** @typedef {{ actor: string; displayName: string; role?: string; sport?: string; team?: string }} RosterPickerRow */

export const AUDIENCE_KEY_PREFIX_GROUP = "g:";
export const AUDIENCE_KEY_PREFIX_MEMBER = "m:";

export function groupAudienceKey(slug) {
  return `${AUDIENCE_KEY_PREFIX_GROUP}${slug}`;
}

export function memberAudienceKey(actor) {
  return `${AUDIENCE_KEY_PREFIX_MEMBER}${actor}`;
}

function uniqueStrings(list) {
  return [...new Set((list || []).filter(Boolean))];
}

/**
 * Roster members in a logical group, **without** auto-including coaches (picker / custom events).
 */
export function rosterActorsInGroupSlug(rosterRows, slug) {
  const rows = rosterRows || [];
  return uniqueStrings(
    rows
      .filter((r) => deriveTeamGroups(r).includes(slug))
      .map((r) => r.actor),
  );
}

/**
 * Default team channel membership: only roster rows whose derived groups include `slug`
 * (e.g. coaches only in `coaches`, women swimmers in `womens_team`, `swim`, `athletes`).
 */
export function rosterActorsForDefaultTeamChannel(rosterRows, slug) {
  return rosterActorsInGroupSlug(rosterRows, slug);
}

/**
 * Expand multiselect keys into Graffiti actor ids.
 * @param {string[]} keys
 * @param {RosterPickerRow[]} rosterRows
 * @param {{ mode?: "exact" | "defaultChannels" }} [opts]
 */
export function expandAudienceKeys(keys, rosterRows, opts = {}) {
  const mode = opts.mode || "exact";
  const out = new Set();
  for (const key of keys || []) {
    if (typeof key !== "string" || !key) {
      continue;
    }
    if (key.startsWith(AUDIENCE_KEY_PREFIX_GROUP)) {
      const slug = key.slice(AUDIENCE_KEY_PREFIX_GROUP.length);
      if (!TEAM_GROUP_ORDER.includes(slug)) {
        continue;
      }
      const actors =
        mode === "defaultChannels"
          ? rosterActorsForDefaultTeamChannel(rosterRows, slug)
          : rosterActorsInGroupSlug(rosterRows, slug);
      for (const a of actors) {
        out.add(a);
      }
    } else if (key.startsWith(AUDIENCE_KEY_PREFIX_MEMBER)) {
      const actor = key.slice(AUDIENCE_KEY_PREFIX_MEMBER.length);
      if (actor) {
        out.add(actor);
      }
    }
  }
  return [...out];
}

/**
 * Build picker rows from directory discover objects (roster + display-name overlay).
 * @param {unknown[]} objects
 * @param {string | null} teamIdNorm
 * @returns {RosterPickerRow[]}
 */
export function buildRosterPickerRowsFromDiscover(objects, teamIdNorm) {
  if (!teamIdNorm) {
    return [];
  }
  const rosterVal = latestTeamMemberRosterForTeam(objects || [], teamIdNorm);
  const members = rosterVal?.members;
  if (!Array.isArray(members)) {
    return [];
  }
  return members.map((m) => {
    const actor = String(m.actor || "").trim();
    const overlay = latestTeamMemberDisplayNameForActor(objects || [], teamIdNorm, actor);
    let first = String(m.firstName ?? "").trim();
    let last = String(m.lastName ?? "").trim();
    if (overlay) {
      first = String(overlay.firstName || "").trim() || first;
      last = String(overlay.lastName || "").trim() || last;
    }
    const displayName = `${first} ${last}`.trim() || clipActorShort(actor);
    return {
      actor,
      displayName,
      role: m.role,
      sport: m.sport,
      team: m.team,
    };
  });
}

function clipActorShort(actor) {
  const t = String(actor || "").trim();
  if (!t) {
    return "";
  }
  const dot = t.indexOf(".");
  return dot === -1 ? t : t.slice(0, dot) || t;
}

/** Same shape as `buildRosterPickerRowsFromDiscover` rows; use the roster payload you just posted (discover is stale until the next poll). */
export function rosterRowsFromRosterMembersPayload(members) {
  return (members || []).map((m) => {
    const actor = String(m.actor || "").trim();
    return {
      actor,
      displayName:
        `${String(m.firstName ?? "").trim()} ${String(m.lastName ?? "").trim()}`.trim() ||
        clipActorShort(actor),
      role: m.role,
      sport: m.sport,
      team: m.team,
    };
  });
}

/**
 * Restore multiselect keys from a stored `audienceKeys` array, or infer from `actors` + roster.
 * @param {string[] | undefined} storedKeys
 * @param {string[] | undefined} actors
 * @param {RosterPickerRow[]} rosterRows
 */
export function audienceKeysForEdit(storedKeys, actors, rosterRows) {
  if (Array.isArray(storedKeys) && storedKeys.length) {
    return [...new Set(storedKeys.filter((k) => typeof k === "string" && k))];
  }
  const set = new Set();
  const actorList = uniqueStrings(actors);
  for (const r of rosterRows || []) {
    if (r.actor && actorList.includes(r.actor)) {
      set.add(memberAudienceKey(r.actor));
    }
  }
  return [...set];
}

/** Human-readable summary for labels (forms, calendar). */
export function summarizeAudienceKeys(keys, rosterRows) {
  const k = keys || [];
  if (!k.length) {
    return "";
  }
  const rowByActor = new Map((rosterRows || []).map((r) => [r.actor, r]));
  const parts = [];
  for (const key of k) {
    if (key.startsWith(AUDIENCE_KEY_PREFIX_GROUP)) {
      const slug = key.slice(AUDIENCE_KEY_PREFIX_GROUP.length);
      const opt = TEAM_GROUP_PICKER_OPTIONS.find((o) => o.slug === slug);
      parts.push(opt?.label || slug);
    } else if (key.startsWith(AUDIENCE_KEY_PREFIX_MEMBER)) {
      const actor = key.slice(AUDIENCE_KEY_PREFIX_MEMBER.length);
      const name = rowByActor.get(actor)?.displayName || clipActorShort(actor);
      parts.push(name || actor);
    }
  }
  return parts.join(", ");
}
