/**
 * Derive actionable pending join requests from Graffiti objects.
 * JoinResolution overrides older JoinRequest objects for the same requester actor.
 */

import { normalizeTeamIdInput } from "./user-team-profile.js";
import { deriveTeamGroups } from "./team-groups.js";

/** Latest JoinResolution per requester, scoped to a canonical team ID. */
function latestJoinResolutionByRequesterForTeam(resolutionObjects, teamIdNorm) {
  const map = new Map();
  for (const o of resolutionObjects || []) {
    const v = o?.value;
    if (!v || v.type !== "JoinResolution") {
      continue;
    }
    const tid = normalizeTeamIdInput(String(v.teamId || ""));
    if (tid !== teamIdNorm) {
      continue;
    }
    const ra = v.requesterActor;
    if (typeof ra !== "string" || !ra.trim()) {
      continue;
    }
    const pub = Number(v.published) || 0;
    const prev = map.get(ra);
    if (!prev || pub > prev.pub) {
      map.set(ra, { pub, decision: v.decision, object: o });
    }
  }
  return map;
}

/** Latest JoinResolution entry for this requester on this team (`published` + `decision`). */
export function latestJoinResolutionRecordOnTeam(resolutionObjects, teamIdNorm, requesterActor) {
  const ra = typeof requesterActor === "string" ? requesterActor.trim() : "";
  if (!ra || !teamIdNorm) {
    return null;
  }
  const map = latestJoinResolutionByRequesterForTeam(resolutionObjects, teamIdNorm);
  return map.get(ra) ?? null;
}

function latestPendingJoinPublishedOnTeam(joinObjects, teamIdNorm, requesterActor) {
  const ra = typeof requesterActor === "string" ? requesterActor.trim() : "";
  if (!ra || !teamIdNorm) {
    return null;
  }
  let best = null;
  for (const o of joinObjects || []) {
    if (o.actor !== ra) {
      continue;
    }
    const v = o?.value;
    if (!v || v.type !== "JoinRequest" || v.status !== "pending") {
      continue;
    }
    const tid = normalizeTeamIdInput(String(v.teamId || ""));
    if (tid !== teamIdNorm) {
      continue;
    }
    const pub = Number(v.published) || 0;
    if (best === null || pub > best) {
      best = pub;
    }
  }
  return best;
}

/**
 * Team creator plus actors whose latest JoinResolution on this team is approved,
 * and whose latest pending JoinRequest (if any) is not newer than that approval
 * (so re-requests after leaving require a new approval).
 */
export function listApprovedTeamMemberActors(
  resolutionObjects,
  teamIdNorm,
  ownerActor,
  joinObjects,
) {
  const joins = joinObjects || [];
  const resolved = latestJoinResolutionByRequesterForTeam(resolutionObjects, teamIdNorm);
  const out = new Set();
  const own = typeof ownerActor === "string" ? ownerActor.trim() : "";
  if (own) {
    out.add(own);
  }
  for (const [ra, info] of resolved) {
    if (info.decision !== "approved") {
      continue;
    }
    const pendingJoinPub = latestPendingJoinPublishedOnTeam(joins, teamIdNorm, ra);
    if (pendingJoinPub != null && pendingJoinPub > info.pub) {
      continue;
    }
    out.add(ra);
  }
  return [...out];
}

/** Latest JoinRequest object from an actor for this team (any status), for display metadata. */
export function latestJoinRequestOnTeamForActor(joinObjects, teamIdNorm, actor) {
  const a = typeof actor === "string" ? actor.trim() : "";
  if (!a) {
    return null;
  }
  let best = null;
  for (const o of joinObjects || []) {
    const v = o?.value;
    if (!v || v.type !== "JoinRequest") {
      continue;
    }
    if (o.actor !== a) {
      continue;
    }
    const tid = normalizeTeamIdInput(String(v.teamId || ""));
    if (tid !== teamIdNorm) {
      continue;
    }
    const pub = Number(v.published) || 0;
    if (!best || pub > best.pub) {
      best = { pub, object: o };
    }
  }
  return best?.object ?? null;
}

/** Latest JoinResolution Graffiti object for this actor on this team (by `published`). */
export function latestJoinResolutionObjectOnTeamForActor(
  resolutionObjects,
  teamIdNorm,
  requesterActor,
) {
  const ra = typeof requesterActor === "string" ? requesterActor.trim() : "";
  if (!ra || !teamIdNorm) {
    return null;
  }
  let best = null;
  for (const o of resolutionObjects || []) {
    const v = o?.value;
    if (!v || v.type !== "JoinResolution") {
      continue;
    }
    if (v.requesterActor !== ra) {
      continue;
    }
    const tid = normalizeTeamIdInput(String(v.teamId || ""));
    if (tid !== teamIdNorm) {
      continue;
    }
    const pub = Number(v.published) || 0;
    if (!best || pub > best.pub) {
      best = { pub, object: o };
    }
  }
  return best?.object ?? null;
}

/**
 * JoinRequest objects still awaiting approval: latest pending join per actor on this team
 * where there is no JoinResolution for the same team with `published` >= that join’s `published`.
 */
export function listPendingJoinRequests(joinObjects, resolutionObjects) {
  const bestJoinByActor = new Map();
  for (const o of joinObjects || []) {
    const v = o?.value;
    if (!v || v.type !== "JoinRequest" || v.status !== "pending") {
      continue;
    }
    const actor = o.actor;
    if (typeof actor !== "string" || !actor.trim()) {
      continue;
    }
    const teamIdNorm = normalizeTeamIdInput(String(v.teamId || ""));
    if (!teamIdNorm) {
      continue;
    }
    const joinPub = Number(v.published) || 0;
    const res = latestJoinResolutionRecordOnTeam(resolutionObjects, teamIdNorm, actor);
    if (res && res.pub >= joinPub) {
      continue;
    }
    const prev = bestJoinByActor.get(actor);
    if (!prev || joinPub > prev.pub) {
      bestJoinByActor.set(actor, { pub: joinPub, object: o });
    }
  }
  return [...bestJoinByActor.values()]
    .map((x) => x.object)
    .sort((a, b) => {
      return (Number(b?.value?.published) || 0) - (Number(a?.value?.published) || 0);
    });
}

export function latestResolutionForRequester(resolutionObjects, requesterActor) {
  let best = null;
  for (const o of resolutionObjects || []) {
    const v = o?.value;
    if (!v || v.type !== "JoinResolution" || v.requesterActor !== requesterActor) {
      continue;
    }
    const pub = Number(v.published) || 0;
    if (!best || pub > best.pub) {
      best = { pub, decision: v.decision, object: o };
    }
  }
  return best;
}

/**
 * Latest `TeamMemberDisplayName` posted by `memberActor` for this team (`published` wins).
 * Objects are filtered by `value.type` and normalized `teamId`; `object.actor` must match `memberActor`.
 */
export function latestTeamMemberDisplayNameForActor(
  objects,
  teamIdNorm,
  memberActor,
) {
  const tid = teamIdNorm;
  const actor = typeof memberActor === "string" ? memberActor.trim() : "";
  if (!tid || !actor) {
    return null;
  }
  let best = null;
  for (const o of objects || []) {
    if (o.actor !== actor) {
      continue;
    }
    const v = o?.value;
    if (!v || v.type !== "TeamMemberDisplayName") {
      continue;
    }
    const otid = normalizeTeamIdInput(String(v.teamId || ""));
    if (otid !== tid) {
      continue;
    }
    const pub = Number(v.published) || 0;
    if (!best || pub > best.pub) {
      best = {
        pub,
        firstName: String(v.firstName ?? "").trim(),
        lastName: String(v.lastName ?? "").trim(),
      };
    }
  }
  if (!best) {
    return null;
  }
  const combined = `${best.firstName} ${best.lastName}`.trim();
  if (!combined) {
    return null;
  }
  return { firstName: best.firstName, lastName: best.lastName };
}

/** Latest `TeamMemberRoster` value for a team (by `published`). */
export function latestTeamMemberRosterForTeam(objects, teamIdNorm) {
  if (!teamIdNorm) {
    return null;
  }
  let best = null;
  for (const o of objects || []) {
    const v = o?.value;
    if (!v || v.type !== "TeamMemberRoster" || !Array.isArray(v.members)) {
      continue;
    }
    const tid = normalizeTeamIdInput(String(v.teamId || ""));
    if (tid !== teamIdNorm) {
      continue;
    }
    const pub = Number(v.published) || 0;
    if (!best || pub > best.pub) {
      best = { pub, value: v };
    }
  }
  return best?.value ?? null;
}

/** Stable string for comparing roster payloads (avoid reposting identical snapshots). */
export function teamMemberRosterPayloadSignature(members) {
  const list = (members || [])
    .map((m) => ({
      actor: String(m.actor || "").trim(),
      firstName: String(m.firstName || "").trim(),
      lastName: String(m.lastName || "").trim(),
      role: m.role || "",
      sport: m.sport || "",
      team: m.team || "",
      groups: JSON.stringify(deriveTeamGroups({ role: m.role, sport: m.sport, team: m.team })),
    }))
    .filter((m) => m.actor)
    .sort((a, b) => a.actor.localeCompare(b.actor));
  return JSON.stringify(list);
}
