import { loadTemplate } from "../../lib/load-template.js";

export async function createFormsView() {
  const template = await loadTemplate(
    new URL("./view.html", import.meta.url).href,
  );
  return {
    template,
    data() {
      return {
        title: "Forms",
        description: "Forms tab placeholder. We can build this next.",
      };
    },
  };
}
