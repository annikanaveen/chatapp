/**
 * Helpers for deriving pending and resolved role-change requests on a team.
 *
 * Role-change requests are posted by current team members who want to switch
 * roles (athlete ↔ coach) or change their sport / squad team. The team owner
 * posts a matching `RoleChangeResolution` to approve or decline.
 */

import { normalizeTeamIdInput } from "./user-team-profile.js";

/** Latest `RoleChangeRequest` per requester actor for a team (by `published`). */
export function latestRoleChangeRequestForActor(
  requestObjects,
  teamIdNorm,
  requesterActor,
) {
  const a = typeof requesterActor === "string" ? requesterActor.trim() : "";
  if (!a || !teamIdNorm) {
    return null;
  }
  let best = null;
  for (const o of requestObjects || []) {
    const v = o?.value;
    if (!v || v.type !== "RoleChangeRequest") {
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

/** Latest `RoleChangeResolution` for a specific `requestId` on a team. */
export function latestRoleChangeResolutionForRequestId(
  resolutionObjects,
  teamIdNorm,
  requestId,
) {
  const id = typeof requestId === "string" ? requestId.trim() : "";
  if (!id || !teamIdNorm) {
    return null;
  }
  let best = null;
  for (const o of resolutionObjects || []) {
    const v = o?.value;
    if (!v || v.type !== "RoleChangeResolution") {
      continue;
    }
    if (String(v.requestId || "").trim() !== id) {
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

/** Latest approved `RoleChangeResolution` for a member on a team (by `published`). */
export function latestApprovedRoleChangeForActor(
  resolutionObjects,
  teamIdNorm,
  requesterActor,
) {
  const a = typeof requesterActor === "string" ? requesterActor.trim() : "";
  if (!a || !teamIdNorm) {
    return null;
  }
  let best = null;
  for (const o of resolutionObjects || []) {
    const v = o?.value;
    if (!v || v.type !== "RoleChangeResolution") {
      continue;
    }
    if (v.decision !== "approved") {
      continue;
    }
    if (String(v.requesterActor || "").trim() !== a) {
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

/** Latest `RoleChangeResolution` (any decision) for a member on a team. */
export function latestRoleChangeResolutionForActor(
  resolutionObjects,
  teamIdNorm,
  requesterActor,
) {
  const a = typeof requesterActor === "string" ? requesterActor.trim() : "";
  if (!a || !teamIdNorm) {
    return null;
  }
  let best = null;
  for (const o of resolutionObjects || []) {
    const v = o?.value;
    if (!v || v.type !== "RoleChangeResolution") {
      continue;
    }
    if (String(v.requesterActor || "").trim() !== a) {
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
 * Pending requests: the latest `RoleChangeRequest` per actor on this team where
 * either there is no resolution for the `requestId`, or it is older than the
 * request itself (e.g. member resubmitted).
 */
export function listPendingRoleChangeRequests(
  requestObjects,
  resolutionObjects,
  teamIdNorm,
) {
  if (!teamIdNorm) {
    return [];
  }
  const bestByActor = new Map();
  for (const o of requestObjects || []) {
    const v = o?.value;
    if (!v || v.type !== "RoleChangeRequest") {
      continue;
    }
    const tid = normalizeTeamIdInput(String(v.teamId || ""));
    if (tid !== teamIdNorm) {
      continue;
    }
    const actor = typeof o.actor === "string" ? o.actor.trim() : "";
    if (!actor) {
      continue;
    }
    const pub = Number(v.published) || 0;
    const prev = bestByActor.get(actor);
    if (!prev || pub > prev.pub) {
      bestByActor.set(actor, { pub, object: o });
    }
  }

  const pending = [];
  for (const { object } of bestByActor.values()) {
    const reqId = String(object?.value?.requestId || "").trim();
    if (!reqId) {
      continue;
    }
    const res = latestRoleChangeResolutionForRequestId(
      resolutionObjects,
      teamIdNorm,
      reqId,
    );
    if (res) {
      continue;
    }
    pending.push(object);
  }

  return pending.sort((a, b) => {
    return (Number(b?.value?.published) || 0) - (Number(a?.value?.published) || 0);
  });
}
