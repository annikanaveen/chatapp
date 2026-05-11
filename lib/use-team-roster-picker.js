import { computed } from "vue";
import { useGraffitiDiscover } from "@graffiti-garden/wrapper-vue";
import { TEAM_MEMBER_ROSTER_DISCOVER_SCHEMA } from "../pages/messages/constants.js";
import { loadUserTeamProfile, normalizeTeamIdInput } from "./user-team-profile.js";
import { buildRosterPickerRowsFromDiscover } from "./team-audience-resolve.js";

/**
 * Roster-backed members for audience pickers (messages, calendar, forms).
 */
export function useTeamRosterPickerRows(teamDirectory, session) {
  const { objects: directoryObjects, isFirstPoll } = useGraffitiDiscover(
    () => [teamDirectory.value],
    TEAM_MEMBER_ROSTER_DISCOVER_SCHEMA,
    () => session.value,
  );

  const teamIdNorm = computed(() => {
    const actor = session.value?.actor;
    if (!actor) {
      return null;
    }
    const tid = loadUserTeamProfile(actor).teamId;
    return normalizeTeamIdInput(String(tid || "")) || null;
  });

  const rosterMembers = computed(() =>
    buildRosterPickerRowsFromDiscover(directoryObjects.value || [], teamIdNorm.value),
  );

  return {
    rosterMembers,
    rosterDiscoverLoading: isFirstPoll,
    teamIdNorm,
  };
}
