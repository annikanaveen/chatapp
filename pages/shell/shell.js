import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useGraffitiSession } from "@graffiti-garden/wrapper-vue";
import { loadTemplate } from "../../lib/load-template.js";
import { loadUserTeamProfile } from "../../lib/user-team-profile.js";

export async function createRootShell() {
  const template = await loadTemplate(
    new URL("./root.html", import.meta.url).href,
  );

  return {
    template,
    setup() {
      const route = useRoute();
      const router = useRouter();
      const session = useGraffitiSession();

      const hideBottomToolbar = computed(() => {
        return route.matched.some((record) => record.meta.hideTabBar);
      });

      watch(
        () => ({
          sess: session.value,
          name: route.name,
        }),
        ({ sess, name }) => {
          if (sess === undefined) {
            return;
          }
          if (sess === null) {
            if (name === "waiting-approval") {
              router.replace({ name: "onboarding" });
            }
            return;
          }
          if (!sess?.actor) {
            return;
          }
          const actor = sess.actor;
          const p = loadUserTeamProfile(actor);
          const wizardDone = Boolean(p.onboardingComplete && p.directoryChannel);

          if (!wizardDone) {
            if (name !== "onboarding") {
              router.replace({ name: "onboarding" });
            }
            return;
          }

          if (p.pendingTeamJoin) {
            if (name !== "waiting-approval") {
              router.replace({ name: "waiting-approval" });
            }
            return;
          }

          if (name === "onboarding" || name === "waiting-approval") {
            router.replace({ name: "messages-directory" });
          }
        },
        { immediate: true },
      );

      return { hideBottomToolbar };
    },
  };
}
