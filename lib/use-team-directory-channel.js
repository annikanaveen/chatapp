import { computed } from "vue";
import { useGraffitiSession } from "@graffiti-garden/wrapper-vue";
import { directoryChannelForActor } from "./user-team-profile.js";

/** Graffiti directory channel for the signed-in user’s team (shared roster); falls back to the legacy global channel for guests. */
export function useTeamDirectoryChannel() {
  const session = useGraffitiSession();
  return computed(() => directoryChannelForActor(session.value?.actor ?? null));
}
