let templatePromise;
let stylePromise;

function loadTemplate() {
  if (!templatePromise) {
    templatePromise = fetch("./components/message/template.html").then((response) => {
      if (!response.ok) {
        throw new Error("Failed to load message template.");
      }
      return response.text();
    });
  }
  return templatePromise;
}

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

const MessageBubble = {
  name: "MessageBubble",
  props: {
    actor: { type: String, required: true },
    username: { type: String, default: "" },
    content: { type: String, required: true },
    published: { type: Number, required: true },
    sessionActor: { type: String, default: "" },
  },
  setup(props) {
    loadStyle().catch(() => {
      // Keep rendering if style fetch fails.
    });

    function stripGraffitiActorPrefix(value) {
      if (typeof value !== "string") {
        return "";
      }
      return value.replace(/^graffiti\.actor[.:/-]?/, "");
    }

    const timestampDate = new Date(props.published);
    function formatTimestamp(timestamp) {
      const date = new Date(timestamp);
      return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
    }

    return {
      displayName:
        stripGraffitiActorPrefix(props.username || props.actor) || "Unknown user",
      formattedTimestamp: formatTimestamp(props.published),
      isoTimestamp: Number.isNaN(timestampDate.getTime())
        ? ""
        : timestampDate.toISOString(),
      isMine: props.actor === props.sessionActor,
    };
  },
  template: await loadTemplate(),
};

export { MessageBubble };
