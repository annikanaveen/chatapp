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

function formatPublishedTimestamp(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
}

const SystemNotice = {
  name: "SystemNotice",
  props: {
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
      formattedTimestamp,
      isoTimestamp,
    };
  },
  template: `
    <div class="thread-leave-notice" role="status">
      <div class="thread-leave-notice-row">
        <span class="thread-leave-notice-main"><slot /></span>
        <span aria-hidden="true" class="thread-leave-notice-dot">•</span>
        <time class="thread-leave-notice-time" :datetime="isoTimestamp">{{ formattedTimestamp }}</time>
      </div>
    </div>
  `,
};

export { SystemNotice };
