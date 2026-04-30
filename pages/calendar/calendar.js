import { loadTemplate } from "../../lib/load-template.js";

export async function createCalendarView() {
  const template = await loadTemplate(
    new URL("./view.html", import.meta.url).href,
  );
  return {
    template,
    data() {
      return {
        title: "Calendar",
        description: "Calendar tab placeholder. We can build this next.",
      };
    },
  };
}
