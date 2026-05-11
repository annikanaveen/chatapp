import { computed, ref, watchEffect } from "vue";
import { useGraffitiActorToHandle } from "@graffiti-garden/wrapper-vue";
import { getCachedHandleForActor, setCachedHandleForActor } from "../../lib/actor-handle-cache.js";

const HOST_MARKER = ".graffiti.actor";

function formatActorHandleLabel(handle) {
  if (handle === undefined) {
    return "…";
  }
  if (handle === null) {
    return "Member";
  }
  let text = String(handle).trim();
  try {
    if (/^https?:\/\//iu.test(text)) {
      text = new URL(text).hostname;
    }
  } catch {
    // keep text as-is
  }
  text = text.replace(/^graffiti\.actor[.:/-]?/iu, "");
  const markerAt = text.toLowerCase().indexOf(HOST_MARKER);
  if (markerAt > 0) {
    return text.slice(0, markerAt);
  }
  const firstDot = text.indexOf(".");
  if (firstDot > 0) {
    return text.slice(0, firstDot);
  }
  return text || "Member";
}

const MemberDisplayName = {
  name: "MemberDisplayName",
  props: {
    actor: { type: String, required: true },
    /** First/last (or other explicit roster label). Empty → Graffiti @handle. */
    explicitName: { type: String, default: "" },
  },
  setup(props) {
    const { handle } = useGraffitiActorToHandle(() => props.actor);
    const cached = ref(getCachedHandleForActor(props.actor));

    watchEffect(() => {
      cached.value = getCachedHandleForActor(props.actor);
    });

    watchEffect(() => {
      const h = handle.value;
      if (typeof h === "string" && h.trim()) {
        const formatted = formatActorHandleLabel(h);
        if (formatted && formatted !== "Member" && formatted !== "…") {
          setCachedHandleForActor(props.actor, formatted);
          cached.value = formatted;
        }
      }
    });

    const display = computed(() => {
      const name = String(props.explicitName || "").trim();
      if (name) {
        return name;
      }
      const h = handle.value;
      if (h === undefined) {
        return cached.value || "…";
      }
      if (h === null) {
        return cached.value || "Member";
      }
      return formatActorHandleLabel(h);
    });

    return { display };
  },
  template: `<span>{{ display }}</span>`,
};

export { MemberDisplayName };
