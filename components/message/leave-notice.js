import { computed } from "vue";

let stylePromise;

function loadStyle() {
  if (!stylePromise) {
    stylePromise = fetch("./components/message/style.css")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Failed to load message styles.");
        }
        return response.text();
      })
      .then((cssText) => {
        if (!document.getElementById("message-bubble-style")) {
          const styleElement = document.createElement("style");
          styleElement.id = "message-bubble-style";
          styleElement.textContent = cssText;
          document.head.appendChild(styleElement);
        }
      });
  }
  return stylePromise;
}

function formatActorHandle(handle) {
  if (handle === undefined) {
    return "Loading...";
  }
  if (handle === null) {
    return "Unknown user";
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
  const hostMarker = ".graffiti.actor";
  const markerAt = text.toLowerCase().indexOf(hostMarker);
  if (markerAt > 0) {
    return text.slice(0, markerAt);
  }
  const firstDot = text.indexOf(".");
  if (firstDot > 0) {
    return text.slice(0, firstDot);
  }
  return text || "Unknown user";
}

function formatPublishedTimestamp(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
}

const LeaveNotice = {
  name: "LeaveNotice",
  props: {
    actor: { type: String, required: true },
    published: { type: Number, required: true },
  },
  setup(props) {
    loadStyle().catch(() => {});

    const formattedTimestamp = computed(() => formatPublishedTimestamp(props.published));
    const isoTimestamp = computed(() => {
      const timestampDate = new Date(props.published);
      return Number.isNaN(timestampDate.getTime()) ? "" : timestampDate.toISOString();
    });

    return {
      formatActorHandle,
      formattedTimestamp,
      isoTimestamp,
    };
  },
  template: `
    <div class="thread-leave-notice" role="status">
      <div class="thread-leave-notice-row">
        <span class="thread-leave-notice-main">
          <graffiti-actor-to-handle :actor="actor" v-slot="{ handle }">
            <span class="thread-leave-notice-name">{{ formatActorHandle(handle) }}</span>
          </graffiti-actor-to-handle>
          <span class="thread-leave-notice-action"> left the chat</span>
        </span>
        <span aria-hidden="true" class="thread-leave-notice-dot">•</span>
        <time class="thread-leave-notice-time" :datetime="isoTimestamp">{{ formattedTimestamp }}</time>
      </div>
    </div>
  `,
};

export { LeaveNotice };
