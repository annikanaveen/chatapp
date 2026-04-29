import { createApp, ref, computed, watchEffect } from "vue";
import {
  createRouter,
  createWebHashHistory,
  useRoute,
  useRouter,
} from "vue-router";
import { GraffitiDecentralized } from "@graffiti-garden/implementation-decentralized";
import {
  GraffitiPlugin,
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";
import { MessageBubble } from "./components/message/message.js";

const DIRECTORY_CHANNEL = "main-channel-dftw";
const DEFAULT_CHAT_TITLE = "ALL";

function setup() {
  // Initialize Graffiti
  const graffiti = useGraffiti();
  const session = useGraffitiSession();
  const route = useRoute();
  const router = useRouter();

  function normalizeChannel(channelParam) {
    return typeof channelParam === "string" && channelParam.trim()
      ? channelParam
      : DIRECTORY_CHANNEL;
  }

  const channel = computed(() => {
    return normalizeChannel(route.params.channel);
  });

  function chatRoute(chatChannel) {
    return {
      name: "messages-chat",
      params: { channel: normalizeChannel(chatChannel) },
    };
  }

  function navigateToChat(chatChannel, options = {}) {
    const { replace = false } = options;
    const targetChannel = normalizeChannel(chatChannel);
    const currentChannel = normalizeChannel(route.params.channel);
    if (route.name === "messages-chat" && targetChannel === currentChannel) {
      return;
    }

    const navigate = replace ? router.replace : router.push;
    navigate(chatRoute(targetChannel));
  }

  // Declare a signal for the message entered in the chat
  const myMessage = ref("");
  const newChatTitle = ref("");

  // "Discover" messages in the chat
  const { objects: messageObjects, isFirstPoll: areMessageObjectsLoading } =
    useGraffitiDiscover(
      () => [channel.value],
      {
        properties: {
          value: {
            required: ["content", "published"],
            properties: {
              content: { type: "string" },
              published: { type: "number" },
            },
          },
        },
      },
      undefined, // Don't look for private messages
      true, // Automatically poll for new messages (realtime)
    );

  // Sort the messages by their timestamp
  const sortedMessageObjects = computed(() => {
    return messageObjects.value.toSorted((a, b) => {
      return b.value.published - a.value.published;
    });
  });

  // A function to send a message.
  // Since the function is async, we
  // create an "isSending" signal for
  // displaying feedback.
  const isSending = ref(false);
  const canSendMessage = computed(() => {
    return Boolean(session.value && myMessage.value.trim());
  });

  async function sendMessage() {
    if (!canSendMessage.value) {
      return;
    }

    isSending.value = true;
    try {
      await graffiti.post(
        {
          value: {
            content: myMessage.value.trim(),
            published: Date.now(),
          },
          channels: [channel.value],
        },
        session.value,
      );
      myMessage.value = "";
    } finally {
      isSending.value = false;
    }
  }

  const isCreatingChat = ref(false);
  const canCreateChat = computed(() => {
    return Boolean(session.value && newChatTitle.value.trim());
  });

  async function newChat() {
    if (!canCreateChat.value) {
      return;
    }

    const createdChannel = crypto.randomUUID();
    isCreatingChat.value = true;
    try {
      await graffiti.post(
        {
          value: {
            activity: "Create",
            type: "Chat",
            channel: createdChannel,
            title: newChatTitle.value.trim(),
            published: Date.now(),
          },
          channels: [DIRECTORY_CHANNEL],
        },
        session.value,
      );
      navigateToChat(createdChannel);
      newChatTitle.value = "";
    } finally {
      isCreatingChat.value = false;
    }
  }

  const { objects: chatObjects, isFirstPoll: areChatsLoading } = useGraffitiDiscover(
    [DIRECTORY_CHANNEL],
    {
      properties: {
        value: {
          required: ["activity", "type", "channel", "title", "published"],
          properties: {
            activity: { const: "Create" },
            type: { const: "Chat" },
            channel: { type: "string" },
            title: { type: "string" },
            published: { type: "number" },
          },
        },
      },
    }
  );

  const { objects: chatLeaveObjects } = useGraffitiDiscover(
    [DIRECTORY_CHANNEL],
    {
      properties: {
        value: {
          required: ["activity", "type", "channel", "published"],
          properties: {
            activity: { const: "Leave" },
            type: { const: "Chat" },
            channel: { type: "string" },
            published: { type: "number" },
          },
        },
      },
    },
  );

  const chats = computed(() => {
    const byChannel = new Map();
    for (const object of chatObjects.value) {
      byChannel.set(object.value.channel, {
        channel: object.value.channel,
        title: object.value.title,
        published: object.value.published,
      });
    }
    return [...byChannel.values()].toSorted((a, b) => {
      return b.published - a.published;
    });
  });

  const leftChannels = computed(() => {
    const currentActor = session.value?.actor;
    const channels = new Set();

    if (!currentActor) {
      return channels;
    }

    for (const object of chatLeaveObjects.value) {
      if (object.actor === currentActor) {
        channels.add(object.value.channel);
      }
    }

    return channels;
  });

  const availableChats = computed(() => {
    const visibleChats = [{ channel: DIRECTORY_CHANNEL, title: DEFAULT_CHAT_TITLE }];

    for (const chat of chats.value) {
      if (!leftChannels.value.has(chat.channel)) {
        visibleChats.push(chat);
      }
    }

    return visibleChats;
  });

  const selectedChat = computed(() => {
    return (
      availableChats.value.find((chat) => chat.channel === channel.value) ?? {
        channel: DIRECTORY_CHANNEL,
        title: DEFAULT_CHAT_TITLE,
      }
    );
  });

  watchEffect(() => {
    const isCurrentChatVisible = availableChats.value.some((chat) => {
      return chat.channel === channel.value;
    });

    if (!isCurrentChatVisible) {
      navigateToChat(DIRECTORY_CHANNEL, { replace: true });
    }
  });

  const isLeavingChat = ref(false);
  const canLeaveSelectedChat = computed(() => {
    return Boolean(session.value && channel.value !== DIRECTORY_CHANNEL);
  });

  async function leaveChat() {
    if (!canLeaveSelectedChat.value) {
      return;
    }

    isLeavingChat.value = true;
    try {
      await graffiti.post(
        {
          value: {
            activity: "Leave",
            type: "Chat",
            channel: channel.value,
            published: Date.now(),
          },
          channels: [DIRECTORY_CHANNEL],
        },
        session.value,
      );

      navigateToChat(DIRECTORY_CHANNEL);
    } finally {
      isLeavingChat.value = false;
    }
  }

  // A function to delete a message.
  // Since the function is async, we
  // create an "isDeleting" signal for
  // displaying feedback.
  const isDeleting = ref(new Set());
  async function deleteMessage(message) {
    isDeleting.value.add(message.url);
    try {
      await graffiti.delete(message, session.value);
    } finally {
      isDeleting.value.delete(message.url);
    }
  }

  return {
    myMessage,
    messageObjects,
    areMessageObjectsLoading,
    sortedMessageObjects,
    isSending,
    canSendMessage,
    sendMessage,
    isDeleting,
    deleteMessage,
    newChat,
    newChatTitle,
    canCreateChat,
    isCreatingChat,
    areChatsLoading,
    availableChats,
    selectedChat,
    canLeaveSelectedChat,
    isLeavingChat,
    leaveChat,
    chats,
    channel,
    chatRoute,
  };
}

const MessagesView = {
  template: "#messages-template",
  setup,
  components: {
    MessageBubble,
  },
};
const RootShell = { template: "#root-template" };
const AppRoot = { template: "<router-view />" };
const FormsView = {
  template: "#placeholder-template",
  data() {
    return {
      title: "Forms",
      description: "Forms tab placeholder. We can build this next.",
    };
  },
};
const CalendarView = {
  template: "#placeholder-template",
  data() {
    return {
      title: "Calendar",
      description: "Calendar tab placeholder. We can build this next.",
    };
  },
};
const AttendanceView = {
  template: "#placeholder-template",
  data() {
    return {
      title: "Attendance",
      description: "Attendance tab placeholder. We can build this next.",
    };
  },
};
const LinksView = {
  template: "#placeholder-template",
  data() {
    return {
      title: "Links",
      description: "Links tab placeholder. We can build this next.",
    };
  },
};
const SettingsView = {
  template: "#placeholder-template",
  data() {
    return {
      title: "Settings",
      description: "Settings tab placeholder. We can build this next.",
    };
  },
};

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      component: RootShell,
      children: [
        { path: "", redirect: { name: "messages-home" } },
        {
          path: "messages",
          name: "messages-home",
          redirect: { name: "messages-chat", params: { channel: DIRECTORY_CHANNEL } },
        },
        {
          path: "messages/chat/:channel",
          name: "messages-chat",
          component: MessagesView,
        },
        { path: "forms", name: "forms", component: FormsView },
        { path: "calendar", name: "calendar", component: CalendarView },
        { path: "attendance", name: "attendance", component: AttendanceView },
        { path: "links", name: "links", component: LinksView },
        { path: "settings", name: "settings", component: SettingsView },
      ],
    },
    { path: "/:pathMatch(.*)*", redirect: { name: "messages-home" } },
  ],
});

createApp(AppRoot)
  .use(router)
  .use(GraffitiPlugin, {
    graffiti: new GraffitiDecentralized(),
  })
  .mount("#app");
