import { ref, computed, reactive, watch, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiActorToHandle,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";
import { loadTemplate } from "../../lib/load-template.js";
import {
  loadUserTeamProfile,
  saveUserTeamProfile,
  defaultUserTeamProfile,
  normalizeTeamIdInput,
} from "../../lib/user-team-profile.js";
import { useTeamDirectoryChannel } from "../../lib/use-team-directory-channel.js";
import {
  JOIN_REQUEST_DISCOVER_SCHEMA,
  JOIN_RESOLUTION_DISCOVER_SCHEMA,
  TEAM_MANIFEST_DISCOVER_SCHEMA,
  ROLE_CHANGE_REQUEST_DISCOVER_SCHEMA,
  ROLE_CHANGE_RESOLUTION_DISCOVER_SCHEMA,
} from "../messages/constants.js";
import { listPendingJoinRequests } from "../../lib/join-requests-logic.js";
import {
  latestRoleChangeRequestForActor,
  latestRoleChangeResolutionForActor,
  listPendingRoleChangeRequests,
} from "../../lib/role-change-logic.js";
import { copyPlainTextWithLegacyFallback } from "../../lib/copy-plain-text.js";
import { deriveTeamGroups } from "../../lib/team-groups.js";

const MAX_PROFILE_PHOTO_BYTES = 4 * 1024 * 1024;

const PROFILE_PHOTO_EXT_ALLOWLIST = new Set([".jpg", ".jpeg", ".png"]);

const PROFILE_PHOTO_ALLOWED_MIMES = new Set(["image/jpeg", "image/png"]);

function profilePhotoFileLabel(file) {
  const raw = String(file?.name || "").trim();
  if (!raw) {
    return "This file";
  }
  return raw.length > 48 ? `${raw.slice(0, 45)}…` : raw;
}

function clipHandleToShortLabel(handle) {
  if (handle === undefined || handle === null) {
    return null;
  }
  const trimmed = String(handle).trim();
  if (!trimmed) {
    return "";
  }
  const dot = trimmed.indexOf(".");
  if (dot === -1) {
    return trimmed;
  }
  return trimmed.slice(0, dot) || trimmed;
}

function labelRole(role) {
  if (role === "athlete") {
    return "Athlete";
  }
  if (role === "coach") {
    return "Coach";
  }
  return "Not set";
}

function labelSport(sport) {
  if (sport === "swimmer") {
    return "Swimmer";
  }
  if (sport === "diver") {
    return "Diver";
  }
  return "Not set";
}

function labelTeam(team) {
  if (team === "women") {
    return "Women";
  }
  if (team === "men") {
    return "Men";
  }
  return "Not set";
}

function profileSubsetFromStored(stored) {
  const base = defaultUserTeamProfile();
  const rawPhoto = stored.profilePhotoMediaUrl;
  const photoUrl =
    typeof rawPhoto === "string" && rawPhoto.trim() ? rawPhoto.trim() : null;
  return {
    firstName: stored.firstName || "",
    lastName: stored.lastName || "",
    profilePhotoMediaUrl: photoUrl,
    role: stored.role ?? base.role,
    sport: stored.sport ?? base.sport,
    team: stored.team ?? base.team,
    pendingApproval: Boolean(stored.pendingApproval),
    teamId: stored.teamId ?? base.teamId,
  };
}

function profileSetup() {
  const graffiti = useGraffiti();
  const session = useGraffitiSession();
  const router = useRouter();
  const teamDirectory = useTeamDirectoryChannel();

  const { objects: joinObjects } = useGraffitiDiscover(
    () => [teamDirectory.value],
    JOIN_REQUEST_DISCOVER_SCHEMA,
    () => session.value,
  );
  const { objects: resolutionObjects } = useGraffitiDiscover(
    () => [teamDirectory.value],
    JOIN_RESOLUTION_DISCOVER_SCHEMA,
    () => session.value,
  );
  const { objects: manifestObjects } = useGraffitiDiscover(
    () => [teamDirectory.value],
    TEAM_MANIFEST_DISCOVER_SCHEMA,
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

  const { handle: graffitiHandle } = useGraffitiActorToHandle(
    () => session.value?.actor,
  );

  const handleFull = computed(() => {
    const handle = graffitiHandle.value;
    if (handle === undefined || handle === null) {
      return "";
    }
    return String(handle);
  });

  const handleDisplay = computed(() => {
    const handle = graffitiHandle.value;
    if (handle === undefined) {
      return "…";
    }
    if (handle === null) {
      return "—";
    }
    const short = clipHandleToShortLabel(handle);
    return short || "—";
  });

  const saved = ref(profileSubsetFromStored(defaultUserTeamProfile()));
  const draft = reactive({
    firstName: "",
    lastName: "",
    role: null,
    sport: null,
    team: null,
  });
  const editing = ref(false);

  const headerEditing = ref(false);
  const headerDraft = reactive({ firstName: "", lastName: "" });
  const headerBusy = ref(false);
  const headerError = ref("");
  function rejectProfilePhotoChoice(message) {
    headerError.value = message;
    window.alert(message);
  }
  const headerPhotoInput = ref(null);
  const headerPendingPhotoFile = ref(null);
  const pendingAvatarPreviewUrl = ref(null);
  const photoRemoveRequested = ref(false);
  const avatarDisplayUrl = ref(null);

  const teamIdJustCopied = ref(false);
  let teamIdCopyResetTimer = null;

  function clearTeamIdCopyTimer() {
    if (teamIdCopyResetTimer) {
      clearTimeout(teamIdCopyResetTimer);
      teamIdCopyResetTimer = null;
    }
  }

  function revokeAvatarDisplayUrl() {
    const u = avatarDisplayUrl.value;
    if (u) {
      URL.revokeObjectURL(u);
      avatarDisplayUrl.value = null;
    }
  }

  function revokePendingAvatarPreview() {
    const u = pendingAvatarPreviewUrl.value;
    if (u) {
      URL.revokeObjectURL(u);
      pendingAvatarPreviewUrl.value = null;
    }
  }

  onUnmounted(() => {
    clearTeamIdCopyTimer();
    teamIdJustCopied.value = false;
    revokeAvatarDisplayUrl();
    revokePendingAvatarPreview();
  });

  function loadTeamProfile() {
    const actor = session.value?.actor;
    if (!actor) {
      saved.value = profileSubsetFromStored(defaultUserTeamProfile());
      return;
    }
    saved.value = profileSubsetFromStored(loadUserTeamProfile(actor));
  }

  /** Publishes first/last name to the team directory so other members’ lists update. */
  async function publishTeamMemberDisplayNameIfJoined(firstName, lastName) {
    const sess = session.value;
    if (!sess?.actor) {
      return;
    }
    const full = loadUserTeamProfile(sess.actor);
    if (!full.onboardingComplete) {
      return;
    }
    const tid = full.teamId;
    if (!tid || tid === "legacy") {
      return;
    }
    const canon = normalizeTeamIdInput(String(tid));
    if (!canon) {
      return;
    }
    const channel = String(teamDirectory.value || "").trim();
    if (!channel) {
      return;
    }
    await graffiti.post(
      {
        value: {
          type: "TeamMemberDisplayName",
          teamId: canon,
          firstName: String(firstName || "").trim(),
          lastName: String(lastName || "").trim(),
          published: Date.now(),
        },
        channels: [channel],
      },
      sess,
    );
  }

  watch(
    () => session.value?.actor,
    () => {
      loadTeamProfile();
      editing.value = false;
      headerEditing.value = false;
      headerPendingPhotoFile.value = null;
      photoRemoveRequested.value = false;
      headerError.value = "";
      Object.assign(headerDraft, { firstName: "", lastName: "" });
      revokePendingAvatarPreview();
      Object.assign(draft, {
        firstName: "",
        lastName: "",
        role: null,
        sport: null,
        team: null,
      });
    },
    { immediate: true },
  );

  watch(
    () => [session.value?.actor, saved.value.profilePhotoMediaUrl],
    async () => {
      revokeAvatarDisplayUrl();
      const mediaUrl = saved.value.profilePhotoMediaUrl;
      const sess = session.value;
      if (!mediaUrl || !sess?.actor) {
        return;
      }
      const target = String(mediaUrl).trim();
      if (!target) {
        return;
      }
      try {
        const { data } = await graffiti.getMedia(
          target,
          { types: ["image/*"], maxBytes: 5 * 1024 * 1024 },
          sess,
        );
        if (saved.value.profilePhotoMediaUrl !== target) {
          return;
        }
        avatarDisplayUrl.value = URL.createObjectURL(data);
      } catch (err) {
        console.warn("Profile photo could not be loaded", err);
      }
    },
    { immediate: true },
  );

  watch(
    () => draft.role,
    (role) => {
      if (!editing.value) {
        return;
      }
      if (role === "coach") {
        draft.sport = null;
        draft.team = null;
      }
    },
  );

  const roleDisplay = computed(() => labelRole(saved.value.role));
  const sportDisplay = computed(() => labelSport(saved.value.sport));
  const teamDisplay = computed(() => labelTeam(saved.value.team));

  const displayName = computed(() => {
    const first = String(saved.value.firstName || "").trim();
    const last = String(saved.value.lastName || "").trim();
    const combined = `${first} ${last}`.trim();
    return combined || handleDisplay.value;
  });

  const avatarVisualUrl = computed(() => {
    if (headerEditing.value && photoRemoveRequested.value) {
      return null;
    }
    if (headerEditing.value && pendingAvatarPreviewUrl.value) {
      return pendingAvatarPreviewUrl.value;
    }
    return avatarDisplayUrl.value;
  });

  const avatarAriaLabel = computed(() =>
    avatarVisualUrl.value ? "Profile photo" : "Profile photo (not set)",
  );

  const showHeaderPhotoRemove = computed(
    () =>
      headerEditing.value &&
      (Boolean(saved.value.profilePhotoMediaUrl) ||
        Boolean(headerPendingPhotoFile.value)),
  );

  const showTeamId = computed(() => {
    const id = saved.value.teamId;
    return Boolean(saved.value.role === "coach" && id && id !== "legacy");
  });

  const latestManifestObjectForCurrentTeam = computed(() => {
    const tid = saved.value.teamId;
    if (!tid || tid === "legacy") {
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
  });

  const teamOwnerActor = computed(() => {
    return latestManifestObjectForCurrentTeam.value?.actor ?? null;
  });

  /** Human-readable team name from the latest TeamManifest, or "" if unset (legacy teams). */
  const teamName = computed(() => {
    const v = latestManifestObjectForCurrentTeam.value?.value;
    const raw = typeof v?.teamName === "string" ? v.teamName.trim() : "";
    return raw;
  });

  const isTeamOwner = computed(() => {
    const actor = session.value?.actor;
    return Boolean(actor && teamOwnerActor.value && actor === teamOwnerActor.value);
  });

  const showManageRequestsEntry = computed(() => isTeamOwner.value);

  const showViewMembersEntry = computed(() => {
    if (showManageRequestsEntry.value) {
      return false;
    }
    const actor = session.value?.actor;
    if (!actor) {
      return false;
    }
    const full = loadUserTeamProfile(actor);
    if (!full.onboardingComplete || full.pendingTeamJoin) {
      return false;
    }
    const ch = typeof full.directoryChannel === "string" ? full.directoryChannel.trim() : "";
    if (!ch) {
      return false;
    }
    const manifest = latestManifestObjectForCurrentTeam.value;
    if (!manifest) {
      return false;
    }
    if (manifest.actor === actor) {
      return false;
    }
    return true;
  });

  const pendingMemberRequestCount = computed(() => {
    if (!showManageRequestsEntry.value) {
      return 0;
    }
    const joinCount = listPendingJoinRequests(
      joinObjects.value || [],
      resolutionObjects.value || [],
    ).length;
    const tid = saved.value.teamId;
    const canon =
      tid && tid !== "legacy" ? normalizeTeamIdInput(String(tid)) : null;
    const roleChangeCount = canon
      ? listPendingRoleChangeRequests(
          roleChangeRequestObjects.value || [],
          roleChangeResolutionObjects.value || [],
          canon,
        ).length
      : 0;
    return joinCount + roleChangeCount;
  });

  function startHeaderEdit() {
    Object.assign(headerDraft, {
      firstName: saved.value.firstName || "",
      lastName: saved.value.lastName || "",
    });
    headerPendingPhotoFile.value = null;
    photoRemoveRequested.value = false;
    headerError.value = "";
    revokePendingAvatarPreview();
    headerEditing.value = true;
  }

  function cancelHeaderEdit() {
    headerEditing.value = false;
    headerPendingPhotoFile.value = null;
    photoRemoveRequested.value = false;
    headerError.value = "";
    revokePendingAvatarPreview();
  }

  function triggerHeaderPhotoPicker() {
    headerPhotoInput.value?.click?.();
  }

  function onHeaderPhotoInputChange(ev) {
    const input = ev.target;
    const file = input?.files?.[0];
    if (input) {
      input.value = "";
    }
    if (!file) {
      return;
    }

    const label = profilePhotoFileLabel(file);
    const mime = String(file.type || "").trim().toLowerCase();
    const extMatch = String(file.name || "").match(/\.[^.]+$/i);
    const ext = extMatch ? extMatch[0].toLowerCase() : "";

    const allowedByMime = mime && PROFILE_PHOTO_ALLOWED_MIMES.has(mime);
    const allowedByExtUnknownMime =
      mime === "" && ext && PROFILE_PHOTO_EXT_ALLOWLIST.has(ext);
    if (!allowedByMime && !allowedByExtUnknownMime) {
      const typeHint = mime ? ` The file type was reported as “${mime}”.` : "";
      rejectProfilePhotoChoice(
        `${label} isn’t a supported format.${typeHint} Profile photos must be JPEG or PNG (.jpg, .jpeg, .png).`,
      );
      return;
    }

    if (file.size > MAX_PROFILE_PHOTO_BYTES) {
      rejectProfilePhotoChoice(
        `${label} is too large. Profile photos must be 4 MB or smaller.`,
      );
      return;
    }

    revokePendingAvatarPreview();
    pendingAvatarPreviewUrl.value = URL.createObjectURL(file);
    headerPendingPhotoFile.value = file;
    photoRemoveRequested.value = false;
    headerError.value = "";
  }

  function requestRemoveHeaderPhoto() {
    photoRemoveRequested.value = true;
    headerPendingPhotoFile.value = null;
    revokePendingAvatarPreview();
    headerError.value = "";
  }

  async function saveHeaderEdit() {
    if (!headerDraft.firstName.trim() || !headerDraft.lastName.trim()) {
      window.alert("Please enter your first and last name.");
      return;
    }
    const actor = session.value?.actor;
    const sess = session.value;
    if (!actor || !sess) {
      return;
    }

    headerBusy.value = true;
    headerError.value = "";
    try {
      const cur = loadUserTeamProfile(actor);
      const nameChanged =
        headerDraft.firstName.trim() !== String(cur.firstName || "").trim() ||
        headerDraft.lastName.trim() !== String(cur.lastName || "").trim();
      let rawPhoto = cur.profilePhotoMediaUrl;
      let nextPhoto =
        typeof rawPhoto === "string" && rawPhoto.trim() ? rawPhoto.trim() : null;

      if (photoRemoveRequested.value) {
        if (nextPhoto) {
          try {
            await graffiti.deleteMedia(nextPhoto, sess);
          } catch {
            /* ignore missing or already deleted */
          }
        }
        nextPhoto = null;
      } else if (headerPendingPhotoFile.value) {
        const uploaded = await graffiti.postMedia(
          { data: headerPendingPhotoFile.value },
          sess,
        );
        if (nextPhoto && nextPhoto !== uploaded) {
          try {
            await graffiti.deleteMedia(nextPhoto, sess);
          } catch {
            /* ignore */
          }
        }
        nextPhoto = uploaded;
      }

      saveUserTeamProfile(actor, {
        ...cur,
        firstName: headerDraft.firstName.trim(),
        lastName: headerDraft.lastName.trim(),
        profilePhotoMediaUrl: nextPhoto,
      });
      loadTeamProfile();
      if (nameChanged) {
        try {
          await publishTeamMemberDisplayNameIfJoined(
            headerDraft.firstName.trim(),
            headerDraft.lastName.trim(),
          );
        } catch (pubErr) {
          console.error(pubErr);
          window.alert(
            "Saved on this device, but teammates may not see your new name yet. Try again later.",
          );
        }
      }
      revokePendingAvatarPreview();
      headerPendingPhotoFile.value = null;
      photoRemoveRequested.value = false;
      headerEditing.value = false;
    } catch (err) {
      console.error(err);
      headerError.value =
        err?.message || "Could not save your profile. Check your connection and try again.";
    } finally {
      headerBusy.value = false;
    }
  }

  function startEdit() {
    Object.assign(draft, {
      firstName: saved.value.firstName || "",
      lastName: saved.value.lastName || "",
      role: saved.value.role,
      sport: saved.value.sport,
      team: saved.value.team,
    });
    editing.value = true;
  }

  function cancelEdit() {
    editing.value = false;
  }

  async function saveEdit() {
    if (!draft.firstName.trim() || !draft.lastName.trim()) {
      window.alert("Please enter your first and last name.");
      return;
    }
    if (!draft.role) {
      window.alert("Please choose whether you are an athlete or a coach.");
      return;
    }
    if (draft.role === "athlete") {
      if (!draft.sport || !draft.team) {
        window.alert("Athletes must choose both a sport and a team.");
        return;
      }
    }

    const actor = session.value?.actor;
    const sess = session.value;
    if (!actor) {
      return;
    }

    const nameChanged =
      draft.firstName.trim() !== String(saved.value.firstName || "").trim() ||
      draft.lastName.trim() !== String(saved.value.lastName || "").trim();

    const roleChanged =
      draft.role !== saved.value.role ||
      (draft.role === "athlete" &&
        (draft.sport !== saved.value.sport || draft.team !== saved.value.team));

    const cur = loadUserTeamProfile(actor);
    const ownerActor = teamOwnerActor.value;
    const isOwnerEditing = Boolean(
      ownerActor && actor === ownerActor && cur.teamId && cur.teamId !== "legacy",
    );
    const isNonOwnerMember = Boolean(
      ownerActor && actor !== ownerActor && cur.teamId && cur.teamId !== "legacy",
    );

    if (roleChanged && isNonOwnerMember) {
      const canon = normalizeTeamIdInput(String(cur.teamId || ""));
      if (!canon) {
        window.alert(
          "Could not identify your team. Please reload and try again.",
        );
        return;
      }
      try {
        const requestId =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        const requestValue = {
          type: "RoleChangeRequest",
          teamId: canon,
          requestId,
          role: draft.role,
          firstName: draft.firstName.trim(),
          lastName: draft.lastName.trim(),
          published: Date.now(),
        };
        if (draft.role === "athlete") {
          if (draft.sport) {
            requestValue.sport = draft.sport;
          }
          if (draft.team) {
            requestValue.team = draft.team;
          }
        }
        const groups = deriveTeamGroups({
          role: draft.role,
          sport: draft.role === "athlete" ? draft.sport : null,
          team: draft.role === "athlete" ? draft.team : null,
        });
        if (groups.length) {
          requestValue.groups = groups;
        }
        await graffiti.post(
          {
            value: requestValue,
            channels: [teamDirectory.value],
            allowed: [...new Set([actor, ownerActor])],
          },
          sess,
        );
      } catch (e) {
        console.error(e);
        window.alert(
          e?.message ||
            "Could not send your role change request. Check your connection and try again.",
        );
        return;
      }

      saveUserTeamProfile(actor, {
        ...cur,
        firstName: draft.firstName.trim(),
        lastName: draft.lastName.trim(),
        pendingApproval: true,
      });
      saved.value = profileSubsetFromStored(loadUserTeamProfile(actor));
      editing.value = false;
    } else {
      saveUserTeamProfile(actor, {
        ...cur,
        firstName: draft.firstName.trim(),
        lastName: draft.lastName.trim(),
        role: draft.role,
        sport: draft.role === "athlete" ? draft.sport : null,
        team: draft.role === "athlete" ? draft.team : null,
        pendingApproval: roleChanged && !isOwnerEditing,
      });
      saved.value = profileSubsetFromStored(loadUserTeamProfile(actor));
      editing.value = false;
    }

    if (nameChanged) {
      try {
        await publishTeamMemberDisplayNameIfJoined(
          draft.firstName.trim(),
          draft.lastName.trim(),
        );
      } catch (e) {
        console.error(e);
        window.alert(
          "Your changes were saved on this device, but your new name could not be published for teammates to see. Try again later.",
        );
      }
    }
  }

  /**
   * Watch for the owner's RoleChangeResolution on this member's request and
   * apply it to local profile: approved → adopt the new role/sport/team and
   * clear `pendingApproval`; rejected → just clear `pendingApproval` (the
   * member's role/sport/team haven't changed yet since we deferred the local
   * write until approval).
   */
  watch(
    () => [
      session.value?.actor,
      teamOwnerActor.value,
      roleChangeResolutionObjects.value,
    ],
    () => {
      const actor = session.value?.actor;
      if (!actor) {
        return;
      }
      const cur = loadUserTeamProfile(actor);
      const tid = cur.teamId;
      if (!tid || tid === "legacy") {
        return;
      }
      const canon = normalizeTeamIdInput(String(tid));
      if (!canon) {
        return;
      }
      const owner = teamOwnerActor.value;
      if (!owner || actor === owner) {
        return;
      }

      const latest = latestRoleChangeResolutionForActor(
        roleChangeResolutionObjects.value || [],
        canon,
        actor,
      );
      if (!latest) {
        return;
      }
      if (latest.actor !== owner) {
        return;
      }
      const rv = latest.value;
      const resPub = Number(rv?.published || 0);
      const lastSeen = Number(cur.lastSeenRoleChangeResolutionMs || 0);
      if (resPub <= lastSeen) {
        return;
      }

      const patch = {
        lastSeenRoleChangeResolutionMs: resPub,
        pendingApproval: false,
      };
      let approved = false;
      if (rv?.decision === "approved") {
        approved = true;
        if (rv.role === "coach" || rv.role === "athlete") {
          patch.role = rv.role;
        }
        if (patch.role === "athlete" || (!patch.role && cur.role === "athlete")) {
          if (rv.sport === "swimmer" || rv.sport === "diver") {
            patch.sport = rv.sport;
          }
          if (rv.team === "women" || rv.team === "men") {
            patch.team = rv.team;
          }
        } else if (patch.role === "coach") {
          patch.sport = null;
          patch.team = null;
        }
      }
      saveUserTeamProfile(actor, patch);
      saved.value = profileSubsetFromStored(loadUserTeamProfile(actor));

      if (!approved && rv?.decision === "rejected") {
        roleChangeDeclinedNotice.value =
          "Your role change request was declined by your coach.";
      } else if (approved) {
        roleChangeDeclinedNotice.value = "";
      }
    },
    { immediate: true, deep: true },
  );

  const roleChangeDeclinedNotice = ref("");
  function dismissRoleChangeDeclinedNotice() {
    roleChangeDeclinedNotice.value = "";
  }

  /** True when this member has an outstanding RoleChangeRequest awaiting the owner. */
  const hasPendingRoleChangeRequest = computed(() => {
    const actor = session.value?.actor;
    const tid = saved.value.teamId;
    if (!actor || !tid || tid === "legacy") {
      return false;
    }
    const canon = normalizeTeamIdInput(String(tid));
    if (!canon) {
      return false;
    }
    const owner = teamOwnerActor.value;
    if (!owner || actor === owner) {
      return false;
    }
    const req = latestRoleChangeRequestForActor(
      roleChangeRequestObjects.value || [],
      canon,
      actor,
    );
    if (!req) {
      return false;
    }
    const reqPub = Number(req?.value?.published || 0);
    const res = latestRoleChangeResolutionForActor(
      roleChangeResolutionObjects.value || [],
      canon,
      actor,
    );
    const resPub = Number(res?.value?.published || 0);
    return reqPub > resPub;
  });

  /** Human-readable description of the currently requested role / sport / team. */
  const pendingRoleChangeSummary = computed(() => {
    if (!hasPendingRoleChangeRequest.value) {
      return "";
    }
    const actor = session.value?.actor;
    const tid = saved.value.teamId;
    if (!actor || !tid) {
      return "";
    }
    const canon = normalizeTeamIdInput(String(tid));
    if (!canon) {
      return "";
    }
    const req = latestRoleChangeRequestForActor(
      roleChangeRequestObjects.value || [],
      canon,
      actor,
    );
    const v = req?.value;
    if (!v) {
      return "";
    }
    const parts = [];
    if (v.role === "athlete") {
      parts.push("Athlete");
    } else if (v.role === "coach") {
      parts.push("Coach");
    }
    if (v.sport === "swimmer") {
      parts.push("Swimmer");
    } else if (v.sport === "diver") {
      parts.push("Diver");
    }
    if (v.team === "women") {
      parts.push("Women");
    } else if (v.team === "men") {
      parts.push("Men");
    }
    return parts.join(" · ");
  });

  function leaveTeam() {
    if (
      !window.confirm(
        "Leave this team? You will leave the shared team space. To join again (even the same team), you must send a new request and wait for the coach to approve it.",
      )
    ) {
      return;
    }
    const actor = session.value?.actor;
    if (!actor) {
      return;
    }
    const cur = loadUserTeamProfile(actor);
    saveUserTeamProfile(actor, {
      ...cur,
      teamId: null,
      directoryChannel: null,
      onboardingComplete: false,
      pendingTeamJoin: false,
      joinDeniedPendingOnboarding: false,
      ignoreJoinResolutionsBeforeMs: Date.now(),
    });
    saved.value = profileSubsetFromStored(loadUserTeamProfile(actor));
    editing.value = false;
    router.replace({ name: "onboarding" });
  }

  async function copyTeamId() {
    const id = saved.value.teamId;
    if (!id || id === "legacy") {
      return;
    }
    const text = String(id).trim();
    if (!text) {
      return;
    }
    const ok = await copyPlainTextWithLegacyFallback(text);
    if (!ok) {
      window.prompt("Copy team ID:", text);
      return;
    }
    clearTeamIdCopyTimer();
    teamIdJustCopied.value = true;
    teamIdCopyResetTimer = setTimeout(() => {
      teamIdJustCopied.value = false;
      teamIdCopyResetTimer = null;
    }, 2000);
  }

  return {
    handleDisplay,
    handleFull,
    displayName,
    avatarVisualUrl,
    avatarAriaLabel,
    headerEditing,
    headerDraft,
    headerBusy,
    headerError,
    headerPhotoInput,
    showHeaderPhotoRemove,
    startHeaderEdit,
    cancelHeaderEdit,
    saveHeaderEdit,
    triggerHeaderPhotoPicker,
    onHeaderPhotoInputChange,
    requestRemoveHeaderPhoto,
    photoRemoveRequested,
    saved,
    draft,
    editing,
    roleDisplay,
    sportDisplay,
    teamDisplay,
    teamName,
    showTeamId,
    showManageRequestsEntry,
    showViewMembersEntry,
    pendingMemberRequestCount,
    hasPendingRoleChangeRequest,
    pendingRoleChangeSummary,
    roleChangeDeclinedNotice,
    dismissRoleChangeDeclinedNotice,
    leaveTeam,
    startEdit,
    cancelEdit,
    saveEdit,
    copyTeamId,
    teamIdJustCopied,
  };
}

export async function createProfileView() {
  const template = await loadTemplate(
    new URL("./profile.html", import.meta.url).href,
  );
  return {
    template,
    setup: profileSetup,
  };
}
