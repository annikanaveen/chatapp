/**
 * Visibility checks for objects whose audience is selected via the team
 * audience picker (groups like `g:swim` and/or specific members `m:actor`).
 *
 * Calendar events and form definitions both store an `audienceKeys` array at
 * post time. A member's actor-id-based snapshot (`memberActors` /
 * `assignedActors`) reflects the roster *at post time only* — so a swimmer who
 * joins the team after an event was created would not be in that snapshot and
 * could not see the event, even though the event was logically assigned to
 * "all swimmers". To keep group-based assignments durable, we evaluate
 * audienceKeys against the viewer's currently derived team groups at render
 * time, in addition to the static actor lists.
 */

import {
  AUDIENCE_KEY_PREFIX_GROUP,
  AUDIENCE_KEY_PREFIX_MEMBER,
} from "./team-audience-resolve.js";

/**
 * @param {{
 *   audienceKeys?: unknown[];
 *   memberActors?: unknown[];
 *   creatorActor?: string | null;
 * }} target
 * @param {{ viewerActor: string | null; viewerGroups: string[] }} viewer
 */
export function isAudienceObjectVisibleToViewer(target, viewer) {
  const viewerActor = typeof viewer?.viewerActor === "string" ? viewer.viewerActor : "";
  const viewerGroups = Array.isArray(viewer?.viewerGroups) ? viewer.viewerGroups : [];

  if (target?.creatorActor && viewerActor && target.creatorActor === viewerActor) {
    return true;
  }

  const keys = Array.isArray(target?.audienceKeys)
    ? target.audienceKeys.filter((k) => typeof k === "string")
    : [];
  const actors = Array.isArray(target?.memberActors)
    ? target.memberActors.filter((a) => typeof a === "string")
    : [];

  // Fully open: legacy events with neither restriction.
  if (!keys.length && !actors.length) {
    return true;
  }

  // Audience-key match: group-based assignment honors dynamic membership.
  for (const key of keys) {
    if (key.startsWith(AUDIENCE_KEY_PREFIX_GROUP)) {
      const slug = key.slice(AUDIENCE_KEY_PREFIX_GROUP.length);
      if (slug && viewerGroups.includes(slug)) {
        return true;
      }
    } else if (key.startsWith(AUDIENCE_KEY_PREFIX_MEMBER)) {
      const actor = key.slice(AUDIENCE_KEY_PREFIX_MEMBER.length);
      if (actor && viewerActor && actor === viewerActor) {
        return true;
      }
    }
  }

  /**
   * Fallback: the snapshot `memberActors` list is authoritative when there
   * were no `audienceKeys` (i.e., the author hand-picked specific people).
   * If audienceKeys are present and didn't match above, the viewer is not
   * part of the dynamic audience and should not see the object.
   */
  if (!keys.length && viewerActor && actors.includes(viewerActor)) {
    return true;
  }

  return false;
}
