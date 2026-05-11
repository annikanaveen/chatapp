/**
 * Per-user team membership and onboarding state (localStorage, keyed by Graffiti actor).
 * Each team gets its own Graffiti directory channel so messages, forms, calendar, etc. stay scoped.
 */

import { DIRECTORY_CHANNEL } from "../pages/messages/constants.js";
import { deriveTeamGroups } from "./team-groups.js";

const STORAGE_V2_PREFIX = "chatapp.userTeam.v2";
const STORAGE_V1_PREFIX = "chatapp.teamProfile.v1";

export function userTeamStorageKey(actor) {
  return `${STORAGE_V2_PREFIX}:${actor}`;
}

export function defaultUserTeamProfile() {
  return {
    onboardingComplete: false,
    firstName: "",
    lastName: "",
    /** Graffiti media URL from postMedia; displayed as profile photo. */
    profilePhotoMediaUrl: null,
    role: null,
    sport: null,
    team: null,
    pendingApproval: false,
    teamId: null,
    directoryChannel: null,
    /** True after requesting to join a team until owner approves (or rejection clears flow). */
    pendingTeamJoin: false,
    /** Set when a join request is declined; onboarding clears it after showing a message. */
    joinDeniedPendingOnboarding: false,
    /**
     * When the user leaves a team locally, resolutions at or before this time (ms) are ignored
     * so an old “approved” JoinResolution does not skip a new join request.
     */
    ignoreJoinResolutionsBeforeMs: null,
    /** Derived from role / sport / team; kept in sync on load and save. */
    teamGroups: [],
  };
}

function withSyncedTeamGroups(profile) {
  const p = { ...profile };
  p.teamGroups = deriveTeamGroups({
    role: p.role,
    sport: p.sport,
    team: p.team,
  });
  return p;
}

function migrateFromV1(actor) {
  try {
    const raw = localStorage.getItem(`${STORAGE_V1_PREFIX}:${actor}`);
    if (!raw) {
      return null;
    }
    const v1 = JSON.parse(raw);
    const migrated = {
      ...defaultUserTeamProfile(),
      onboardingComplete: true,
      firstName: "",
      lastName: "",
      role: v1.role ?? null,
      sport: v1.sport ?? null,
      team: v1.team ?? null,
      pendingApproval: Boolean(v1.pendingApproval),
      pendingTeamJoin: false,
      teamId: "legacy",
      directoryChannel: DIRECTORY_CHANNEL,
    };
    const withGroups = withSyncedTeamGroups(migrated);
    localStorage.setItem(userTeamStorageKey(actor), JSON.stringify(withGroups));
    return withGroups;
  } catch {
    return null;
  }
}

export function loadUserTeamProfile(actor) {
  if (!actor) {
    return defaultUserTeamProfile();
  }
  try {
    const raw = localStorage.getItem(userTeamStorageKey(actor));
    if (raw) {
      return withSyncedTeamGroups({
        ...defaultUserTeamProfile(),
        ...JSON.parse(raw),
      });
    }
  } catch {
    /* ignore */
  }
  const migrated = migrateFromV1(actor);
  if (migrated) {
    return migrated;
  }
  return withSyncedTeamGroups(defaultUserTeamProfile());
}

export function saveUserTeamProfile(actor, partial) {
  if (!actor) {
    return;
  }
  const cur = loadUserTeamProfile(actor);
  const next = withSyncedTeamGroups({ ...cur, ...partial });
  localStorage.setItem(userTeamStorageKey(actor), JSON.stringify(next));
}

export function isOnboardingComplete(actor) {
  const p = loadUserTeamProfile(actor);
  return Boolean(p.onboardingComplete && p.directoryChannel);
}

/** Full app access: finished onboarding wizard and not waiting on a join approval. */
export function canAccessMainApp(actor) {
  const p = loadUserTeamProfile(actor);
  return Boolean(
    p.onboardingComplete && p.directoryChannel && !p.pendingTeamJoin,
  );
}

export function directoryChannelForActor(actor) {
  if (!actor) {
    return DIRECTORY_CHANNEL;
  }
  const p = loadUserTeamProfile(actor);
  if (typeof p.directoryChannel === "string" && p.directoryChannel.trim()) {
    return p.directoryChannel.trim();
  }
  return DIRECTORY_CHANNEL;
}

export function generateTeamId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function directoryChannelForTeamId(teamId) {
  const id = String(teamId || "").trim();
  if (!id) {
    return null;
  }
  return `team-${id}`;
}

/** Accepts pasted UUID with or without hyphens; returns canonical lowercase hyphenated form or null. */
export function normalizeTeamIdInput(raw) {
  const compact = String(raw || "")
    .replace(/[^0-9a-f]/gi, "")
    .toLowerCase();
  if (compact.length !== 32) {
    return null;
  }
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}
