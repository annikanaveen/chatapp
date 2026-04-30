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
  useGraffitiActorToHandle,
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

  function goToChannelList() {
    router.push({ name: "messages-directory" });
  }

  // Declare a signal for the message entered in the chat
  const myMessage = ref("");

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

  const {
    objects: chatObjects,
    isFirstPoll: areDirectoryChatsLoading,
  } = useGraffitiDiscover(
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
    },
  );

  const { objects: chatLeaveObjects, isFirstPoll: areLeaveObjectsLoading } =
    useGraffitiDiscover(
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

  watchEffect((onCleanup) => {
    // Until directory + leave data have finished their first poll, `availableChats`
    // only contains ALL — redirecting would incorrectly kick users out of every
    // non-main channel. Wait for sync, then re-check (with a short delay so a
    // just-created chat can appear in discover).
    if (areDirectoryChatsLoading.value || areLeaveObjectsLoading.value) {
      return;
    }

    const isCurrentChatVisible = availableChats.value.some((chat) => {
      return chat.channel === channel.value;
    });

    if (isCurrentChatVisible) {
      return;
    }

    const bounce = setTimeout(() => {
      if (areDirectoryChatsLoading.value || areLeaveObjectsLoading.value) {
        return;
      }
      const stillMissing = !availableChats.value.some((chat) => {
        return chat.channel === channel.value;
      });
      if (stillMissing) {
        router.replace({ name: "messages-directory" });
      }
    }, 600);

    onCleanup(() => {
      clearTimeout(bounce);
    });
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

      goToChannelList();
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
    availableChats,
    selectedChat,
    canLeaveSelectedChat,
    isLeavingChat,
    leaveChat,
    channel,
    goToChannelList,
  };
}

function directorySetup() {
  const graffiti = useGraffiti();
  const session = useGraffitiSession();
  const router = useRouter();

  function normalizeChannel(channelParam) {
    return typeof channelParam === "string" && channelParam.trim()
      ? channelParam
      : DIRECTORY_CHANNEL;
  }

  function chatRoute(chatChannel) {
    return {
      name: "messages-chat",
      params: { channel: normalizeChannel(chatChannel) },
    };
  }

  const newChatTitle = ref("");
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
      await router.push(chatRoute(createdChannel));
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
    },
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

  return {
    newChatTitle,
    canCreateChat,
    isCreatingChat,
    newChat,
    areChatsLoading,
    availableChats,
    chatRoute,
  };
}

const MessagesThreadView = {
  template: "#messages-thread-template",
  setup,
  components: {
    MessageBubble,
  },
};

const MessagesDirectoryView = {
  template: "#messages-directory-template",
  setup: directorySetup,
};

const RootShell = {
  template: "#root-template",
  setup() {
    const route = useRoute();
    const hideBottomToolbar = computed(() => {
      return route.matched.some((record) => record.meta.hideTabBar);
    });
    return { hideBottomToolbar };
  },
};
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

function profileSetup() {
  const session = useGraffitiSession();

  const { handle: graffitiHandle } = useGraffitiActorToHandle(
    () => session.value?.actor,
  );

  const handleFull = computed(() => {
    const handle = graffitiHandle.value;
    if (handle === undefined) {
      return "";
    }
    if (handle === null) {
      return "";
    }
    return String(handle);
  });

  const handleDisplay = computed(() => {
    const handle = graffitiHandle.value;
    if (handle === undefined) {
      return "…";
    }
    if (handle === null) {
      return "—";
    }
    const short = clipHandleToShortLabel(handle);
    return short || "—";
  });

  const profileTags = [
    { id: "aquatic", category: "Aquatic sport", choice: "Swimmer (not diver)" },
    { id: "role", category: "Team role", choice: "Athlete (not coach)" },
    { id: "season", category: "Season", choice: "Spring roster" },
  ];

  return {
    handleDisplay,
    handleFull,
    profileTags,
  };
}

const ProfileView = {
  template: "#profile-template",
  setup: profileSetup,
};

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      component: RootShell,
      children: [
        { path: "", redirect: { name: "messages-directory" } },
        {
          path: "messages",
          name: "messages-directory",
          component: MessagesDirectoryView,
        },
        {
          path: "messages/chat/:channel",
          name: "messages-chat",
          component: MessagesThreadView,
          meta: { hideTabBar: true },
        },
        { path: "forms", name: "forms", component: FormsView },
        { path: "calendar", name: "calendar", component: CalendarView },
        { path: "attendance", name: "attendance", component: AttendanceView },
        { path: "links", name: "links", component: LinksView },
        {
          path: "profile",
          name: "profile",
          component: ProfileView,
        },
        {
          path: "settings",
          redirect: { name: "profile" },
        },
      ],
    },
    { path: "/:pathMatch(.*)*", redirect: { name: "messages-directory" } },
  ],
});

createApp(AppRoot)
  .use(router)
  .use(GraffitiPlugin, {
    graffiti: new GraffitiDecentralized(),
  })
  .mount("#app");
