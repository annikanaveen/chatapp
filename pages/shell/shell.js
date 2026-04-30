import { computed } from "vue";
import { useRoute } from "vue-router";
import { loadTemplate } from "../../lib/load-template.js";

export async function createRootShell() {
  const template = await loadTemplate(
    new URL("./root.html", import.meta.url).href,
  );

  return {
    template,
    setup() {
      const route = useRoute();
      const hideBottomToolbar = computed(() => {
        return route.matched.some((record) => record.meta.hideTabBar);
      });
      return { hideBottomToolbar };
    },
  };
}
