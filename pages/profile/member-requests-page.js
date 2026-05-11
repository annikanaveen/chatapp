import { ref, computed, watch, nextTick } from "vue";
import { useRouter } from "vue-router";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";
import { loadTemplate } from "../../lib/load-template.js";
import {
  JOIN_REQUEST_DISCOVER_SCHEMA,
  JOIN_RESOLUTION_DISCOVER_SCHEMA,
  TEAM_MANIFEST_DISCOVER_SCHEMA,
  TEAM_MEMBER_ROSTER_DISCOVER_SCHEMA,
  CHAT_CREATE_DISCOVER_SCHEMA,
  ROLE_CHANGE_REQUEST_DISCOVER_SCHEMA,
  ROLE_CHANGE_RESOLUTION_DISCOVER_SCHEMA,
} from "../messages/constants.js";
import { useTeamDirectoryChannel } from "../../lib/use-team-directory-channel.js";
import {
  loadUserTeamProfile,
  directoryChannelForTeamId,
  normalizeTeamIdInput,
} from "../../lib/user-team-profile.js";
import {
  listPendingJoinRequests,
  listApprovedTeamMemberActors,
  latestJoinRequestOnTeamForActor,
  latestJoinResolutionObjectOnTeamForActor,
  latestTeamMemberDisplayNameForActor,
  latestTeamMemberRosterForTeam,
  teamMemberRosterPayloadSignature,
} from "../../lib/join-requests-logic.js";
import {
  listPendingRoleChangeRequests,
  latestApprovedRoleChangeForActor,
} from "../../lib/role-change-logic.js";
import { MemberPendingRequestsPanel } from "../../components/team/member-pending-requests-panel.js";
import { CurrentTeamMembersPanel } from "../../components/team/current-team-members-panel.js";
import { deriveTeamGroups } from "../../lib/team-groups.js";
import { syncDefaultTeamGroupChats } from "../../lib/default-team-chats.js";
import { rosterRowsFromRosterMembersPayload } from "../../lib/team-audience-resolve.js";

function clipActorToShortLabel(actor) {
  const trimmed = String(actor || "").trim();
  if (!trimmed) {
    return "";
  }
  const dot = trimmed.indexOf(".");
  if (dot === -1) {
    return trimmed;
  }
  return trimmed.slice(0, dot) || trimmed;
}

function sportLabelForRequest(role, sport) {
  if (role === "coach") {
    return "—";
  }
  if (sport === "swimmer") {
    return "Swimmer";
  }
  if (sport === "diver") {
    return "Diver";
  }
  return "—";
}

function teamLabelForRequest(role, team) {
  if (role === "coach") {
    return "—";
  }
  if (team === "women") {
    return "Women";
  }
  if (team === "men") {
    return "Men";
  }
  return "—";
}

function buildMembersPayloadForRoster(
  resolutions,
  joins,
  canon,
  ownerActor,
  displayNameObjects,
  roleChangeResolutions,
) {
  const actors = listApprovedTeamMemberActors(resolutions, canon, ownerActor, joins);
  const displayObjs = displayNameObjects || [];
  const roleResolutions = roleChangeResolutions || [];
  return actors.map((requesterActor) => {
    const join = latestJoinRequestOnTeamForActor(joins, canon, requesterActor);
    const v = join?.value;
    const resolutionObj = latestJoinResolutionObjectOnTeamForActor(
      resolutions,
      canon,
      requesterActor,
    );
    const rv = resolutionObj?.value;
    const fn = String(v?.firstName ?? rv?.firstName ?? "").trim();
    const ln = String(v?.lastName ?? rv?.lastName ?? "").trim();
    const isOwner = requesterActor === ownerActor;
    const stored = isOwner ? loadUserTeamProfile(requesterActor) : null;
    const storedFn = String(stored?.firstName ?? "").trim();
    const storedLn = String(stored?.lastName ?? "").trim();
    const overlay = latestTeamMemberDisplayNameForActor(
      displayObjs,
      canon,
      requesterActor,
    );
    let firstName = fn || storedFn;
    let lastName = ln || storedLn;
    if (overlay) {
      firstName = String(overlay.firstName || "").trim() || firstName;
      lastName = String(overlay.lastName || "").trim() || lastName;
    }
    let role = v?.role ?? rv?.role ?? (isOwner ? "coach" : undefined);
    let sport = v?.sport ?? rv?.sport;
    let team = v?.team ?? rv?.team;
    // An approved role change posted after the join resolution wins.
    const approvedRoleChange = latestApprovedRoleChangeForActor(
      roleResolutions,
      canon,
      requesterActor,
    );
    if (approvedRoleChange) {
      if (approvedRoleChange.role === "coach" || approvedRoleChange.role === "athlete") {
        role = approvedRoleChange.role;
      }
      if (role === "coach") {
        sport = undefined;
        team = undefined;
      } else if (role === "athlete") {
        if (
          approvedRoleChange.sport === "swimmer" ||
          approvedRoleChange.sport === "diver"
        ) {
          sport = approvedRoleChange.sport;
        }
        if (
          approvedRoleChange.team === "women" ||
          approvedRoleChange.team === "men"
        ) {
          team = approvedRoleChange.team;
        }
      }
    }
    const entry = { actor: requesterActor, firstName, lastName };
    if (role) {
      entry.role = role;
    }
    if (sport) {
      entry.sport = sport;
    }
    if (team) {
      entry.team = team;
    }
    const groups = deriveTeamGroups({ role, sport, team });
    if (groups.length) {
      entry.groups = groups;
    }
    return entry;
  });
}

function applyMemberDisplayNameOverlay(rows, displayObjects, canon) {
  if (!canon || !Array.isArray(rows) || !rows.length) {
    return rows;
  }
  const objs = displayObjects || [];
  return rows.map((row) => {
    const d = latestTeamMemberDisplayNameForActor(objs, canon, row.requesterActor);
    if (!d) {
      return row;
    }
    const explicitDisplayName = `${d.firstName} ${d.lastName}`.trim();
    if (!explicitDisplayName) {
      return row;
    }
    const sortKey =
      explicitDisplayName ||
      row.sortKey ||
      clipActorToShortLabel(row.requesterActor);
    return { ...row, explicitDisplayName, sortKey };
  });
}

function rosterMembersToRows(rosterMembers, ownerActor, sessionActor) {
  return rosterMembers.map((m) => {
    const requesterActor = m.actor;
    const isOwner = requesterActor === ownerActor;
    const explicitDisplayName =
      `${String(m.firstName || "").trim()} ${String(m.lastName || "").trim()}`.trim();
    const role = m.role;
    const roleLabel =
      role === "coach"
        ? "Coach"
        : role === "athlete"
          ? "Athlete"
          : isOwner
            ? "Coach"
            : "Member";
    const sport = m.sport;
    const team = m.team;
    const sortKey =
      explicitDisplayName.trim() || clipActorToShortLabel(requesterActor);
    return {
      requesterActor,
      explicitDisplayName,
      sortKey,
      roleLabel,
      sportLabel: sportLabelForRequest(role, sport),
      teamLabel: teamLabelForRequest(role, team),
      handleFallback: clipActorToShortLabel(requesterActor),
      isOwner,
      isSelf: Boolean(sessionActor && requesterActor === sessionActor),
    };
  });
}

function memberRowsFromResolutions(resolutions, joins, canon, owner, sessionActor) {
  const actors = listApprovedTeamMemberActors(resolutions, canon, owner, joins);
  return actors
    .map((requesterActor) => {
      const join = latestJoinRequestOnTeamForActor(joins, canon, requesterActor);
      const v = join?.value;
      const resolutionObj = latestJoinResolutionObjectOnTeamForActor(
        resolutions,
        canon,
        requesterActor,
      );
      const rv = resolutionObj?.value;
      const fn = String(v?.firstName || "").trim();
      const ln = String(v?.lastName || "").trim();
      const rfn = String(rv?.firstName || "").trim();
      const rln = String(rv?.lastName || "").trim();
      const isOwner = requesterActor === owner;
      const fromJoin = `${fn} ${ln}`.trim();
      const fromResolution = `${rfn} ${rln}`.trim();
      const stored = isOwner ? loadUserTeamProfile(requesterActor) : null;
      const storedFn = String(stored?.firstName || "").trim();
      const storedLn = String(stored?.lastName || "").trim();
      const fromStored = `${storedFn} ${storedLn}`.trim();
      const explicitDisplayName = fromJoin || fromResolution || fromStored || "";
      const role = v?.role ?? rv?.role;
      const roleLabel =
        role === "coach"
          ? "Coach"
          : role === "athlete"
            ? "Athlete"
            : isOwner
              ? "Coach"
              : "Member";
      const sport = v?.sport ?? rv?.sport;
      const team = v?.team ?? rv?.team;
      const sortKey =
        explicitDisplayName.trim() || clipActorToShortLabel(requesterActor);
      return {
        requesterActor,
        explicitDisplayName,
        sortKey,
        roleLabel,
        sportLabel: sportLabelForRequest(role, sport),
        teamLabel: teamLabelForRequest(role, team),
        handleFallback: clipActorToShortLabel(requesterActor),
        isOwner,
        isSelf: Boolean(sessionActor && requesterActor === sessionActor),
      };
    })
    .sort((a, b) => {
      if (a.isOwner !== b.isOwner) {
        return a.isOwner ? -1 : 1;
      }
      return a.sortKey.localeCompare(b.sortKey, undefined, { sensitivity: "base" });
    });
}

function memberRequestsPageSetup() {
  const graffiti = useGraffiti();
  const session = useGraffitiSession();
  const router = useRouter();
  const teamDirectory = useTeamDirectoryChannel();

  const { objects: joinObjects, isFirstPoll: joinFirst } = useGraffitiDiscover(
    () => [teamDirectory.value],
    JOIN_REQUEST_DISCOVER_SCHEMA,
    () => session.value,
  );
  const { objects: resolutionObjects, isFirstPoll: resFirst } = useGraffitiDiscover(
    () => [teamDirectory.value],
    JOIN_RESOLUTION_DISCOVER_SCHEMA,
    () => session.value,
  );
  const { objects: manifestObjects, isFirstPoll: manFirst } = useGraffitiDiscover(
    () => [teamDirectory.value],
    TEAM_MANIFEST_DISCOVER_SCHEMA,
    () => session.value,
  );
  const { objects: rosterObjects } = useGraffitiDiscover(
    () => [teamDirectory.value],
    TEAM_MEMBER_ROSTER_DISCOVER_SCHEMA,
    () => session.value,
  );
  const { objects: chatCreateObjects } = useGraffitiDiscover(
    () => [teamDirectory.value],
    CHAT_CREATE_DISCOVER_SCHEMA,
    () => session.value,
  );
  const { objects: roleChangeRequestObjects } = useGraffitiDiscover(
    () => [teamDirectory.value],
    ROLE_CHANGE_REQUEST_DISCOVER_SCHEMA,
    () => session.value,
  );
  const { objects: roleChangeResolutionObjects } = useGraffitiDiscover(
    () => [teamDirectory.value],
    ROLE_CHANGE_RESOLUTION_DISCOVER_SCHEMA,
    () => session.value,
  );

  /** Do not gate the UI on roster discover; `isFirstPoll` can stall and would leave “Loading…” forever. */
  const isDiscoverLoading = computed(() => {
    return !!(joinFirst.value || resFirst.value || manFirst.value);
  });

  function latestManifestForCurrentTeam() {
    const actor = session.value?.actor;
    const tid = loadUserTeamProfile(actor)?.teamId;
    if (!actor || !tid || tid === "legacy") {
      return null;
    }
    const canon = normalizeTeamIdInput(tid);
    if (!canon) {
      return null;
    }
    let best = null;
    for (const o of manifestObjects.value || []) {
      const v = o?.value;
      if (!v || v.type !== "TeamManifest") {
        continue;
      }
      const mtid = normalizeTeamIdInput(String(v.teamId || ""));
      if (mtid !== canon) {
        continue;
      }
      const pub = Number(v.published) || 0;
      if (!best || pub > best.pub) {
        best = { pub, object: o };
      }
    }
    return best?.object ?? null;
  }

  const isTeamOwner = computed(() => {
    const actor = session.value?.actor;
    const manifest = latestManifestForCurrentTeam();
    return Boolean(manifest && manifest.actor === actor);
  });

  /** Owner-only: pending join requests panel. */
  const showPendingRequestsPanel = computed(() => isTeamOwner.value);

  const teamIdNorm = computed(() => {
    const actor = session.value?.actor;
    const tid = loadUserTeamProfile(actor)?.teamId;
    if (!tid || tid === "legacy") {
      return null;
    }
    return normalizeTeamIdInput(tid);
  });

  const pageReady = computed(() => {
    if (isDiscoverLoading.value) {
      return false;
    }
    if (!teamIdNorm.value) {
      return false;
    }
    return Boolean(latestManifestForCurrentTeam());
  });

  const pageTitle = computed(() => {
    return isTeamOwner.value ? "Manage members" : "Team members";
  });

  const pageSubtitle = computed(() => {
    return isTeamOwner.value
      ? "Everyone on your team and people waiting to join."
      : "People on your team.";
  });

  watch(
    [isDiscoverLoading, manifestObjects, session, teamIdNorm],
    () => {
      if (isDiscoverLoading.value) {
        return;
      }
      const actor = session.value?.actor;
      if (!actor || !teamIdNorm.value) {
        router.replace({ name: "profile" });
        return;
      }
      if (!latestManifestForCurrentTeam()) {
        router.replace({ name: "profile" });
        return;
      }
    },
    { deep: true },
  );

  const memberRows = computed(() => {
    const canon = teamIdNorm.value;
    const manifest = latestManifestForCurrentTeam();
    const owner = manifest?.actor;
    const sessionActor = session.value?.actor;
    if (!canon || !owner) {
      return [];
    }
    const channelObjs = rosterObjects.value || [];
    const rosterVal = latestTeamMemberRosterForTeam(channelObjs, canon);
    const displayObjs = channelObjs;
    let rows;
    if (rosterVal?.members?.length) {
      rows = rosterMembersToRows(rosterVal.members, owner, sessionActor);
    } else {
      rows = memberRowsFromResolutions(
        resolutionObjects.value || [],
        joinObjects.value || [],
        canon,
        owner,
        sessionActor,
      );
    }
    rows = applyMemberDisplayNameOverlay(rows, displayObjs, canon);
    return rows.sort((a, b) => {
      if (a.isOwner !== b.isOwner) {
        return a.isOwner ? -1 : 1;
      }
      return a.sortKey.localeCompare(b.sortKey, undefined, { sensitivity: "base" });
    });
  });

  const pendingRows = computed(() => {
    const pending = listPendingJoinRequests(
      joinObjects.value || [],
      resolutionObjects.value || [],
    );
    return pending.map((o) => {
      const requesterActor = o.actor;
      const fn = String(o.value?.firstName || "").trim();
      const ln = String(o.value?.lastName || "").trim();
      const displayName = `${fn} ${ln}`.trim() || clipActorToShortLabel(requesterActor);
      const role = o.value?.role;
      const roleLabel = role === "coach" ? "Coach" : role === "athlete" ? "Athlete" : "Member";
      const sport = o.value?.sport;
      const team = o.value?.team;
      return {
        requesterActor,
        displayName,
        roleLabel,
        sportLabel: sportLabelForRequest(role, sport),
        teamLabel: teamLabelForRequest(role, team),
        handleFallback: clipActorToShortLabel(requesterActor),
      };
    });
  });

  const actingOn = ref(new Set());
  const actionError = ref("");
  const rosterSyncInFlight = ref(false);
  /**
   * If `syncTeamMemberRosterToChannel` is called while another run is
   * in-flight (e.g., reactive sources update mid-flight after an explicit
   * post-and-sync from `resolveRequest`), we mark this flag and re-run
   * once the current pass finishes. Without this coalescing, the second
   * call would be dropped and the squad-chat ACLs/`memberActors` would
   * remain stuck on whatever stale state the first run observed.
   */
  const rosterSyncPending = ref(false);

  /**
   * Overlay shape used by `resolveRequest` / `resolveRoleChange` to inject
   * a freshly posted resolution into the roster computation before the
   * Graffiti discover stream has surfaced it back to us. Without this,
   * the immediate post-and-sync would run on stale data and the squad
   * chat update for the affected member would be skipped until the next
   * watcher fire (which may never happen if the decentralized backend's
   * post-to-discover loop is slow or coalesced).
   *
   * @typedef {{
   *   extraResolutions?: unknown[];
   *   extraRoleChangeResolutions?: unknown[];
   * }} RosterSyncOverlays
   */

  /** @param {RosterSyncOverlays} [overlays] */
  async function runRosterSyncOnce(overlays) {
    if (!isTeamOwner.value || !session.value) {
      return;
    }
    const actor = session.value.actor;
    const tid = loadUserTeamProfile(actor)?.teamId;
    if (!tid || tid === "legacy") {
      return;
    }
    const normalized = normalizeTeamIdInput(tid);
    const channel = directoryChannelForTeamId(normalized);
    if (!normalized || !channel) {
      return;
    }
    const manifest = latestManifestForCurrentTeam();
    const ownerActor = manifest?.actor || actor;
    const resolutions = [
      ...(resolutionObjects.value || []),
      ...(overlays?.extraResolutions || []),
    ];
    const joins = joinObjects.value || [];
    const roleChangeResolutions = [
      ...(roleChangeResolutionObjects.value || []),
      ...(overlays?.extraRoleChangeResolutions || []),
    ];
    const built = buildMembersPayloadForRoster(
      resolutions,
      joins,
      normalized,
      ownerActor,
      rosterObjects.value || [],
      roleChangeResolutions,
    );
    if (!built.length) {
      return;
    }
    const nextSig = teamMemberRosterPayloadSignature(built);
    const existing = latestTeamMemberRosterForTeam(rosterObjects.value || [], normalized);
    const rosterUnchanged =
      existing?.members &&
      teamMemberRosterPayloadSignature(existing.members) === nextSig;
    if (!rosterUnchanged) {
      const allowedActors = [...new Set(built.map((m) => m.actor).filter(Boolean))];
      await graffiti.post(
        {
          value: {
            type: "TeamMemberRoster",
            teamId: normalized,
            published: Date.now(),
            members: built,
          },
          channels: [channel],
          allowed: allowedActors,
        },
        session.value,
      );
    }
    /**
     * Always run the squad-chat sync. It is internally idempotent (per-slug
     * sig check) and is the only path that fixes stale `memberActors` when
     * the roster itself happens to match (e.g., a previously-approved role
     * change whose ATHLETES chat update was skipped by an earlier bug).
     */
    const rosterRows = rosterRowsFromRosterMembersPayload(built);
    await syncDefaultTeamGroupChats(
      graffiti,
      session.value,
      channel,
      chatCreateObjects.value || [],
      rosterRows,
    );
  }

  /** @param {RosterSyncOverlays} [overlays] */
  async function syncTeamMemberRosterToChannel(overlays) {
    if (rosterSyncInFlight.value) {
      rosterSyncPending.value = true;
      return;
    }
    rosterSyncInFlight.value = true;
    try {
      /**
       * Loop while reactive sources keep changing during a run. Overlays
       * are applied on the first pass only — they exist to bridge the
       * post-to-discover gap for the just-posted resolution. Subsequent
       * passes read straight from the (by then up-to-date) discover stream.
       */
      let firstPass = true;
      do {
        rosterSyncPending.value = false;
        try {
          await runRosterSyncOnce(firstPass ? overlays : undefined);
        } catch (e) {
          console.error(e);
        }
        firstPass = false;
      } while (rosterSyncPending.value);
    } finally {
      rosterSyncInFlight.value = false;
    }
  }

  watch(
    () => [
      isDiscoverLoading.value,
      isTeamOwner.value,
      pageReady.value,
      teamIdNorm.value,
      resolutionObjects.value,
      joinObjects.value,
      rosterObjects.value,
      chatCreateObjects.value,
      roleChangeResolutionObjects.value,
    ],
    async () => {
      if (isDiscoverLoading.value || !pageReady.value || !isTeamOwner.value) {
        return;
      }
      await nextTick();
      await syncTeamMemberRosterToChannel();
    },
    { deep: true },
  );

  async function resolveRequest(requesterActor, decision) {
    actionError.value = "";
    const actor = session.value?.actor;
    const sess = session.value;
    if (!actor || !sess || !requesterActor) {
      return;
    }
    const p = loadUserTeamProfile(actor);
    const teamIdRaw = p.teamId;
    if (!teamIdRaw || teamIdRaw === "legacy") {
      return;
    }
    const normalized = normalizeTeamIdInput(teamIdRaw);
    const channel = directoryChannelForTeamId(normalized);
    if (!normalized || !channel) {
      return;
    }

    const manifest = latestManifestForCurrentTeam();
    const ownerActor = manifest?.actor || actor;
    const roster = listApprovedTeamMemberActors(
      resolutionObjects.value || [],
      normalized,
      ownerActor,
      joinObjects.value || [],
    );
    const allowedForResolution =
      decision === "approved"
        ? [...new Set([...roster, requesterActor])]
        : [...new Set([actor, requesterActor].filter(Boolean))];

    actingOn.value = new Set(actingOn.value).add(requesterActor);
    try {
      const joinMeta = latestJoinRequestOnTeamForActor(
        joinObjects.value || [],
        normalized,
        requesterActor,
      )?.value;
      const value = {
        type: "JoinResolution",
        teamId: normalized,
        requesterActor,
        decision,
        published: Date.now(),
      };
      if (decision === "approved" && joinMeta) {
        if (joinMeta.firstName != null) {
          value.firstName = joinMeta.firstName;
        }
        if (joinMeta.lastName != null) {
          value.lastName = joinMeta.lastName;
        }
        if (joinMeta.role) {
          value.role = joinMeta.role;
        }
        if (joinMeta.sport) {
          value.sport = joinMeta.sport;
        }
        if (joinMeta.team) {
          value.team = joinMeta.team;
        }
      }
      if (joinMeta) {
        value.groups = deriveTeamGroups({
          role: value.role ?? joinMeta.role,
          sport: value.sport ?? joinMeta.sport,
          team: value.team ?? joinMeta.team,
        });
      }
      await graffiti.post(
        {
          value,
          channels: [channel],
          allowed: allowedForResolution,
        },
        sess,
      );
      await nextTick();
      /**
       * Inject the just-posted resolution as an overlay so the immediate
       * sync sees it even if Graffiti's discover stream hasn't surfaced
       * it back yet. Without this, the squad-chat sync for this requester
       * would be skipped on the first pass and may not re-run.
       */
      await syncTeamMemberRosterToChannel({
        extraResolutions: [{ actor, value: { ...value } }],
      });
    } catch (e) {
      console.error(e);
      actionError.value =
        e?.message || "Could not save your decision. Check your connection and try again.";
    } finally {
      const next = new Set(actingOn.value);
      next.delete(requesterActor);
      actingOn.value = next;
    }
  }

  function approve(requesterActor) {
    resolveRequest(requesterActor, "approved");
  }

  function reject(requesterActor) {
    resolveRequest(requesterActor, "rejected");
  }

  /** Owner-side pending role-change requests, formatted for the UI. */
  const roleChangeRows = computed(() => {
    const canon = teamIdNorm.value;
    if (!canon) {
      return [];
    }
    const pending = listPendingRoleChangeRequests(
      roleChangeRequestObjects.value || [],
      roleChangeResolutionObjects.value || [],
      canon,
    );
    return pending.map((o) => {
      const v = o.value || {};
      const requesterActor = o.actor;
      const fn = String(v.firstName || "").trim();
      const ln = String(v.lastName || "").trim();
      const displayName = `${fn} ${ln}`.trim() || clipActorToShortLabel(requesterActor);
      const role = v.role;
      const sport = v.sport;
      const team = v.team;
      const roleLabel =
        role === "coach" ? "Coach" : role === "athlete" ? "Athlete" : "Member";
      return {
        requestId: String(v.requestId || "").trim(),
        requesterActor,
        displayName,
        roleLabel,
        sportLabel: sportLabelForRequest(role, sport),
        teamLabel: teamLabelForRequest(role, team),
        handleFallback: clipActorToShortLabel(requesterActor),
        requestedRole: role,
        requestedSport: sport,
        requestedTeam: team,
      };
    });
  });

  const actingOnRoleChange = ref(new Set());

  async function resolveRoleChange(row, decision) {
    actionError.value = "";
    const actor = session.value?.actor;
    const sess = session.value;
    if (!actor || !sess || !row?.requesterActor || !row?.requestId) {
      return;
    }
    if (!isTeamOwner.value) {
      return;
    }
    const p = loadUserTeamProfile(actor);
    const teamIdRaw = p.teamId;
    if (!teamIdRaw || teamIdRaw === "legacy") {
      return;
    }
    const normalized = normalizeTeamIdInput(teamIdRaw);
    const channel = directoryChannelForTeamId(normalized);
    if (!normalized || !channel) {
      return;
    }

    const roster = listApprovedTeamMemberActors(
      resolutionObjects.value || [],
      normalized,
      actor,
      joinObjects.value || [],
    );
    const allowedActors = [
      ...new Set([actor, row.requesterActor, ...roster].filter(Boolean)),
    ];

    const next = new Set(actingOnRoleChange.value);
    next.add(row.requesterActor);
    actingOnRoleChange.value = next;
    try {
      const value = {
        type: "RoleChangeResolution",
        teamId: normalized,
        requestId: row.requestId,
        requesterActor: row.requesterActor,
        decision,
        published: Date.now(),
      };
      if (decision === "approved") {
        if (row.requestedRole === "coach" || row.requestedRole === "athlete") {
          value.role = row.requestedRole;
        }
        if (value.role === "athlete") {
          if (row.requestedSport === "swimmer" || row.requestedSport === "diver") {
            value.sport = row.requestedSport;
          }
          if (row.requestedTeam === "women" || row.requestedTeam === "men") {
            value.team = row.requestedTeam;
          }
        }
        value.groups = deriveTeamGroups({
          role: value.role,
          sport: value.role === "athlete" ? value.sport : null,
          team: value.role === "athlete" ? value.team : null,
        });
      }
      await graffiti.post(
        {
          value,
          channels: [channel],
          allowed: allowedActors,
        },
        sess,
      );
      await nextTick();
      /**
       * Inject the just-posted role-change resolution as an overlay so
       * `latestApprovedRoleChangeForActor` picks it up even before the
       * Graffiti discover stream surfaces it back. This is what flips
       * the affected member's `sport` / `team` in the synthesized roster
       * rows, which is what `syncDefaultTeamGroupChats` uses to decide
       * who belongs in DIVE vs SWIM on this pass.
       */
      await syncTeamMemberRosterToChannel({
        extraRoleChangeResolutions: [{ actor, value: { ...value } }],
      });
    } catch (e) {
      console.error(e);
      actionError.value =
        e?.message || "Could not save your decision. Check your connection and try again.";
    } finally {
      const after = new Set(actingOnRoleChange.value);
      after.delete(row.requesterActor);
      actingOnRoleChange.value = after;
    }
  }

  function approveRoleChange(row) {
    resolveRoleChange(row, "approved");
  }

  function rejectRoleChange(row) {
    resolveRoleChange(row, "rejected");
  }

  function goBack() {
    router.push({ name: "profile" });
  }

  return {
    isDiscoverLoading,
    showPendingRequestsPanel,
    pageReady,
    pageTitle,
    pageSubtitle,
    memberRows,
    pendingRows,
    roleChangeRows,
    actingOn,
    actingOnRoleChange,
    actionError,
    approve,
    reject,
    approveRoleChange,
    rejectRoleChange,
    goBack,
  };
}

export async function createMemberRequestsPageView() {
  const template = await loadTemplate(
    new URL("./member-requests-page.html", import.meta.url).href,
  );
  return {
    template,
    components: { MemberPendingRequestsPanel, CurrentTeamMembersPanel },
    setup: memberRequestsPageSetup,
  };
}
