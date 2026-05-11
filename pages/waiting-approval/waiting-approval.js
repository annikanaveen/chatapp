import { ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useGraffitiSession, useGraffitiDiscover } from "@graffiti-garden/wrapper-vue";
import { loadTemplate } from "../../lib/load-template.js";
import { JOIN_RESOLUTION_DISCOVER_SCHEMA } from "../messages/constants.js";
import { useTeamDirectoryChannel } from "../../lib/use-team-directory-channel.js";
import {
  loadUserTeamProfile,
  saveUserTeamProfile,
} from "../../lib/user-team-profile.js";
import { latestResolutionForRequester } from "../../lib/join-requests-logic.js";

function waitingApprovalSetup() {
  const session = useGraffitiSession();
  const router = useRouter();
  const teamDirectory = useTeamDirectoryChannel();
  const errorMessage = ref("");

  const { objects: resolutionObjects } = useGraffitiDiscover(
    () => [teamDirectory.value],
    JOIN_RESOLUTION_DISCOVER_SCHEMA,
    () => session.value,
  );

  watch(
    [resolutionObjects, session],
    () => {
      const actor = session.value?.actor;
      if (!actor) {
        return;
      }
      const p = loadUserTeamProfile(actor);
      if (!p.pendingTeamJoin) {
        return;
      }
      const latest = latestResolutionForRequester(resolutionObjects.value || [], actor);
      if (!latest) {
        return;
      }
      const ignoreBefore = Number(p.ignoreJoinResolutionsBeforeMs) || 0;
      if (ignoreBefore > 0 && latest.pub <= ignoreBefore) {
        return;
      }
      if (latest.decision === "approved") {
        saveUserTeamProfile(actor, {
          pendingTeamJoin: false,
          ignoreJoinResolutionsBeforeMs: null,
        });
        router.replace({ name: "messages-directory" });
        return;
      }
      if (latest.decision === "rejected") {
        saveUserTeamProfile(actor, {
          pendingTeamJoin: false,
          onboardingComplete: false,
          teamId: null,
          directoryChannel: null,
          joinDeniedPendingOnboarding: true,
          ignoreJoinResolutionsBeforeMs: null,
        });
        router.replace({ name: "onboarding" });
      }
    },
    { deep: true },
  );

  return {
    errorMessage,
  };
}

export async function createWaitingApprovalView() {
  const template = await loadTemplate(
    new URL("./waiting-approval.html", import.meta.url).href,
  );
  return {
    template,
    setup: waitingApprovalSetup,
  };
}
