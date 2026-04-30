import { ref, computed, watch, watchEffect, nextTick } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";
import { MessageBubble } from "../../components/message/message.js";
import { loadTemplate } from "../../lib/load-template.js";
import { DIRECTORY_CHANNEL, DEFAULT_CHAT_TITLE } from "./constants.js";

function threadSetup() {
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

  const myMessage = ref("");

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
      undefined,
      true,
    );

  const sortedMessageObjects = computed(() => {
    return messageObjects.value.toSorted((a, b) => {
      return a.value.published - b.value.published;
    });
  });

  const messageScrollEl = ref(null);

  function scrollThreadToBottom() {
    nextTick(() => {
      const el = messageScrollEl.value;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    });
  }

  watch(
    [() => sortedMessageObjects.value.length, areMessageObjectsLoading],
    () => {
      if (areMessageObjectsLoading.value) {
        return;
      }
      scrollThreadToBottom();
    },
    { flush: "post" },
  );

  watch(
    () => channel.value,
    () => {
      scrollThreadToBottom();
    },
    { flush: "post" },
  );

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
    messageScrollEl,
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

export async function createMessagesDirectoryView() {
  const template = await loadTemplate(
    new URL("./directory.html", import.meta.url).href,
  );
  return {
    template,
    setup: directorySetup,
  };
}

export async function createMessagesThreadView() {
  const template = await loadTemplate(
    new URL("./thread.html", import.meta.url).href,
  );
  return {
    template,
    setup: threadSetup,
    components: {
      MessageBubble,
    },
  };
}
