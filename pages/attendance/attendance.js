import { loadTemplate } from "../../lib/load-template.js";

export async function createAttendanceView() {
  const template = await loadTemplate(
    new URL("./view.html", import.meta.url).href,
  );
  return {
    template,
    data() {
      return {
        title: "Attendance",
        description: "Attendance tab placeholder. We can build this next.",
      };
    },
  };
}
