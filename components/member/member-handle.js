import { computed, ref, watchEffect } from "vue";
import { useGraffitiActorToHandle } from "@graffiti-garden/wrapper-vue";
import { getCachedHandleForActor, setCachedHandleForActor } from "../../lib/actor-handle-cache.js";

const HOST_MARKER = ".graffiti.actor";

function clipHandleToShortLabel(handle) {
  if (handle === undefined || handle === null) {
    return null;
  }
  const trimmed = String(handle).trim();
  if (!trimmed) {
    return "";
  }
  const dot = trimmed.indexOf(".");
  if (dot === -1) {
    return trimmed;
  }
  return trimmed.slice(0, dot) || trimmed;
}

function formatHandle(handle) {
  if (handle === undefined) {
    return "…";
  }
  if (handle === null) {
    return "Unknown";
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
  return text || "Unknown";
}

const MemberHandle = {
  name: "MemberHandle",
  props: {
    actor: { type: String, required: true },
    fallback: { type: String, default: "" },
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
        const formatted = formatHandle(h);
        if (formatted && formatted !== "Unknown" && formatted !== "…") {
          setCachedHandleForActor(props.actor, formatted);
          cached.value = formatted;
        }
      }
    });

    const display = computed(() => {
      const h = handle.value;
      if (h === undefined) {
        return cached.value || "…";
      }
      if (h === null) {
        return (
          cached.value ||
          props.fallback ||
          clipHandleToShortLabel(props.actor) ||
          "Unknown"
        );
      }
      return formatHandle(h);
    });

    return { display };
  },
  template: `<span translate="no">{{ display }}</span>`,
};

export { MemberHandle };

