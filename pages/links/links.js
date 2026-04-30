import { loadTemplate } from "../../lib/load-template.js";

export async function createLinksView() {
  const template = await loadTemplate(
    new URL("./view.html", import.meta.url).href,
  );
  return {
    template,
    data() {
      return {
        title: "Links",
        description: "Links tab placeholder. We can build this next.",
      };
    },
  };
}
