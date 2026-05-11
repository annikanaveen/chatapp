import { computed, ref, watch } from "vue";
import { useGraffitiSession } from "@graffiti-garden/wrapper-vue";
import { useTeamDirectoryChannel } from "./use-team-directory-channel.js";
import { useTeamRosterPickerRows } from "./use-team-roster-picker.js";
import { loadUserTeamProfile } from "./user-team-profile.js";

/**
 * Authoritative role for the signed-in viewer on their current team.
 *
 * Resolution order:
 *  1. The viewer's locally-stored profile role. This is set during onboarding
 *     (athlete or coach) and is the source of truth for which UI to render.
 *  2. The viewer's row on the latest team roster (owner-posted snapshot) — used
 *     when local profile has no role yet (e.g., migrated legacy accounts).
 *
 * Returns `{ viewerRole, isCoach, isAthlete, rosterMembers, rosterDiscoverLoading }`.
 */
export function useViewerTeamRole() {
  const session = useGraffitiSession();
  const teamDirectory = useTeamDirectoryChannel();
  const { rosterMembers, rosterDiscoverLoading, teamIdNorm } =
    useTeamRosterPickerRows(teamDirectory, session);

  /**
   * `loadUserTeamProfile` reads localStorage, which Vue can't track. We re-read
   * it whenever the actor changes so role flips during onboarding/login are
   * reflected immediately, and force a re-read via a bumped revision otherwise.
   */
  const localProfileRevision = ref(0);
  watch(
    () => session.value?.actor,
    () => {
      localProfileRevision.value += 1;
    },
    { immediate: true },
  );

  const localRole = computed(() => {
    void localProfileRevision.value;
    const actor = session.value?.actor;
    if (!actor) {
      return null;
    }
    const r = loadUserTeamProfile(actor)?.role;
    return r === "coach" || r === "athlete" ? r : null;
  });

  const viewerRole = computed(() => {
    if (localRole.value) {
      return localRole.value;
    }
    const actor = session.value?.actor;
    if (!actor) {
      return null;
    }
    const row = rosterMembers.value.find((r) => r.actor === actor);
    if (row?.role === "coach" || row?.role === "athlete") {
      return row.role;
    }
    return null;
  });

  const isCoach = computed(() => viewerRole.value === "coach");
  const isAthlete = computed(() => viewerRole.value === "athlete");

  return {
    viewerRole,
    isCoach,
    isAthlete,
    rosterMembers,
    rosterDiscoverLoading,
    teamIdNorm,
  };
}
