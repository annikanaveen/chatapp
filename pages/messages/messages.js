import { ref, computed, watch, watchEffect, nextTick, onMounted, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";
import { MessageBubble } from "../../components/message/message.js";
import { LeaveNotice } from "../../components/message/leave-notice.js";
import { MemberHandle } from "../../components/member/member-handle.js";
import { loadTemplate } from "../../lib/load-template.js";
import {
  DIRECTORY_CHANNEL,
  DEFAULT_CHAT_TITLE,
  CHAT_CREATE_DISCOVER_SCHEMA,
  CHAT_DELETE_DISCOVER_SCHEMA,
  CHAT_MESSAGE_DISCOVER_SCHEMA,
} from "./constants.js";
import { setLastOpenedForChannel, getLastOpenedMap } from "../../lib/chat-last-opened.js";
import { setCachedHandleForActor } from "../../lib/actor-handle-cache.js";

const GRAFFITI_ACTOR_SUFFIX = ".graffiti.actor";

/**
 * Turns a short invite like "annika" into "annika.graffiti.actor" for handleToActor.
 * Leaves values that already end with ".graffiti.actor" unchanged.
 */
function normalizeGraffitiHandleForLookup(segment) {
  const s = String(segment || "").trim();
  if (!s) {
    return "";
  }
  if (s.toLowerCase().endsWith(GRAFFITI_ACTOR_SUFFIX)) {
    return s;
  }
  return `${s}${GRAFFITI_ACTOR_SUFFIX}`;
}

function parseInviteHandles(raw) {
  return String(raw || "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

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

function uniqueActors(actors) {
  return [...new Set(actors)];
}

function clipActorToShortLabel(actor) {
  if (actor === undefined || actor === null) {
    return "";
  }
  const trimmed = String(actor).trim();
  if (!trimmed) {
    return "";
  }
  const dot = trimmed.indexOf(".");
  if (dot === -1) {
    return trimmed;
  }
  return trimmed.slice(0, dot) || trimmed;
}

function initialsFromLabel(label) {
  const t = String(label || "").trim();
  if (!t) {
    return "—";
  }
  const parts = t.split(/[\s._-]+/).filter(Boolean);
  const a = parts[0]?.[0] || t[0];
  const b = parts.length > 1 ? parts[1]?.[0] : t[1];
  const initial = `${a || ""}${b || ""}`.toUpperCase();
  return initial.slice(0, 2) || "—";
}

function hueFromString(input) {
  const s = String(input || "");
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return String(hash % 360);
}

function truncateChatPreview(text, maxLen = 72) {
  const t = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t.length) {
    return "";
  }
  if (t.length <= maxLen) {
    return t;
  }
  return `${t.slice(0, maxLen - 1)}…`;
}

function latestMessageByChannel(messageObjects, channelIds) {
  const latest = new Map();
  const idSet = new Set(channelIds);
  for (const obj of messageObjects) {
    const pub = obj.value?.published;
    if (typeof pub !== "number") {
      continue;
    }
    const chans = obj.channels;
    if (!Array.isArray(chans)) {
      continue;
    }
    for (const ch of chans) {
      if (!idSet.has(ch)) {
        continue;
      }
      const prev = latest.get(ch);
      if (!prev || pub > prev.value.published) {
        latest.set(ch, obj);
      }
    }
  }
  return latest;
}

function countMessagesAfterTimestamp(messageObjects, channelId, afterTs, viewerActor) {
  const threshold = typeof afterTs === "number" ? afterTs : 0;
  let n = 0;
  for (const obj of messageObjects) {
    const chans = obj.channels;
    if (!Array.isArray(chans) || !chans.includes(channelId)) {
      continue;
    }
    if (viewerActor && obj.actor === viewerActor) {
      continue;
    }
    const pub = obj.value?.published;
    if (typeof pub !== "number") {
      continue;
    }
    if (pub > threshold) {
      n++;
    }
  }
  return n;
}

function randomChannelId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

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
      CHAT_MESSAGE_DISCOVER_SCHEMA,
      () => session.value,
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
      const partial = {
        value: {
          content: myMessage.value.trim(),
          published: Date.now(),
        },
        channels: [channel.value],
      };
      const allowed = memberActorsForMessages.value;
      if (allowed) {
        partial.allowed = uniqueActors(allowed);
      }
      await graffiti.post(partial, session.value);
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
    CHAT_CREATE_DISCOVER_SCHEMA,
    () => session.value,
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
      () => session.value,
    );

  const { objects: chatDeleteObjects, isFirstPoll: areDeleteObjectsLoading } =
    useGraffitiDiscover(
      [DIRECTORY_CHANNEL],
      CHAT_DELETE_DISCOVER_SCHEMA,
      () => session.value,
    );

  const deletedChannels = computed(() => {
    const set = new Set();
    for (const object of chatDeleteObjects.value) {
      const ch = object.value.channel;
      if (typeof ch === "string" && ch.trim()) {
        set.add(ch);
      }
    }
    return set;
  });

  const leaveEventsForChannel = computed(() => {
    return chatLeaveObjects.value.filter((object) => {
      return object.value.channel === channel.value;
    });
  });

  const threadTimeline = computed(() => {
    const messages = sortedMessageObjects.value.map((object) => {
      return {
        kind: "message",
        published: object.value.published,
        sortKey: object.url,
        object,
      };
    });
    const leaves = leaveEventsForChannel.value.map((object) => {
      return {
        kind: "leave",
        published: object.value.published,
        sortKey: object.url,
        object,
      };
    });
    return [...messages, ...leaves].toSorted((a, b) => {
      if (a.published !== b.published) {
        return a.published - b.published;
      }
      return String(a.sortKey).localeCompare(String(b.sortKey));
    });
  });

  watch(
    [
      () => threadTimeline.value.length,
      areMessageObjectsLoading,
      areLeaveObjectsLoading,
      areDeleteObjectsLoading,
    ],
    () => {
      if (
        areMessageObjectsLoading.value ||
        areLeaveObjectsLoading.value ||
        areDeleteObjectsLoading.value
      ) {
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

  const latestCreateForChannel = computed(() => {
    let best = null;
    for (const object of chatObjects.value) {
      if (object.value.channel !== channel.value) {
        continue;
      }
      if (!best || object.value.published > best.value.published) {
        best = object;
      }
    }
    return best;
  });

  const memberActorsForMessages = computed(() => {
    const actors = latestCreateForChannel.value?.value?.memberActors;
    return Array.isArray(actors) && actors.length > 0 ? actors : null;
  });

  const isPrivateGroupChat = computed(() => {
    return Boolean(memberActorsForMessages.value);
  });

  const isMembersPanelOpen = ref(false);
  function toggleMembersPanel() {
    isMembersPanelOpen.value = !isMembersPanelOpen.value;
  }
  function closeMembersPanel() {
    isMembersPanelOpen.value = false;
  }

  watch(memberActorsForMessages, () => {
    if (!memberActorsForMessages.value) {
      isMembersPanelOpen.value = false;
    }
  });

  const allMembers = computed(() => {
    const actors = memberActorsForMessages.value;
    if (!actors) {
      return [];
    }
    const unique = uniqueActors(actors);
    return unique.map((actor) => {
      const label = clipActorToShortLabel(actor);
      return {
        actor,
        label,
        initials: initialsFromLabel(label),
        hue: hueFromString(actor),
      };
    });
  });

  const compactMembers = computed(() => {
    return allMembers.value.slice(0, 3);
  });

  const remainingMemberCount = computed(() => {
    const members = allMembers.value.length;
    return members > 3 ? members - 3 : 0;
  });

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
      if (leftChannels.value.has(chat.channel)) {
        continue;
      }
      if (deletedChannels.value.has(chat.channel)) {
        continue;
      }
      visibleChats.push(chat);
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
    if (
      areDirectoryChatsLoading.value ||
      areLeaveObjectsLoading.value ||
      areDeleteObjectsLoading.value
    ) {
      return;
    }

    const isCurrentChatVisible = availableChats.value.some((chat) => {
      return chat.channel === channel.value;
    });

    if (isCurrentChatVisible) {
      return;
    }

    const bounce = setTimeout(() => {
      if (
        areDirectoryChatsLoading.value ||
        areLeaveObjectsLoading.value ||
        areDeleteObjectsLoading.value
      ) {
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

  const chatCreatorActor = computed(() => {
    return latestCreateForChannel.value?.actor ?? null;
  });

  const canDeleteEntireChat = computed(() => {
    if (!session.value || channel.value === DIRECTORY_CHANNEL) {
      return false;
    }
    if (!latestCreateForChannel.value) {
      return false;
    }
    const creator = chatCreatorActor.value;
    return Boolean(creator && session.value.actor === creator);
  });

  const isDeletingChat = ref(false);

  async function deleteEntireChat() {
    if (!canDeleteEntireChat.value) {
      return;
    }

    const allowed = memberActorsForMessages.value;
    const recipients =
      Array.isArray(allowed) && allowed.length > 0
        ? uniqueActors(allowed)
        : session.value.actor
          ? [session.value.actor]
          : [];
    if (recipients.length === 0) {
      return;
    }

    if (
      !window.confirm(
        "Delete this chat for everyone? No one will be able to open it anymore.",
      )
    ) {
      return;
    }

    isDeletingChat.value = true;
    try {
      await graffiti.post(
        {
          value: {
            activity: "Delete",
            type: "Chat",
            channel: channel.value,
            published: Date.now(),
          },
          channels: [DIRECTORY_CHANNEL],
          allowed: recipients,
        },
        session.value,
      );
      goToChannelList();
    } finally {
      isDeletingChat.value = false;
    }
  }

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

  watch(
    () => [channel.value, session.value?.actor],
    ([ch, actor]) => {
      if (!ch || !actor) {
        return;
      }
      setLastOpenedForChannel(actor, ch);
    },
    { immediate: true },
  );

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
    areLeaveObjectsLoading,
    areDeleteObjectsLoading,
    threadTimeline,
    messageScrollEl,
    isSending,
    canSendMessage,
    sendMessage,
    isDeleting,
    deleteMessage,
    availableChats,
    selectedChat,
    canLeaveSelectedChat,
    canDeleteEntireChat,
    isLeavingChat,
    isDeletingChat,
    leaveChat,
    deleteEntireChat,
    channel,
    goToChannelList,
    isPrivateGroupChat,
    isMembersPanelOpen,
    toggleMembersPanel,
    closeMembersPanel,
    allMembers,
    compactMembers,
    remainingMemberCount,
  };
}

function directorySetup() {
  const graffiti = useGraffiti();
  const session = useGraffitiSession();
  const route = useRoute();
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
  const newChatInviteHandles = ref("");
  const chatCreateError = ref("");
  const isCreatingChat = ref(false);
  const isCreateChatOpen = ref(false);

  function openCreateChat() {
    chatCreateError.value = "";
    isCreateChatOpen.value = true;
  }

  function closeCreateChat() {
    if (isCreatingChat.value) {
      return;
    }
    isCreateChatOpen.value = false;
  }

  function onCreateChatKeydown(event) {
    if (event.key === "Escape" && isCreateChatOpen.value && !isCreatingChat.value) {
      closeCreateChat();
    }
  }

  onMounted(() => {
    window.addEventListener("keydown", onCreateChatKeydown);
  });

  onUnmounted(() => {
    window.removeEventListener("keydown", onCreateChatKeydown);
  });

  watch([newChatTitle, newChatInviteHandles], () => {
    chatCreateError.value = "";
  });

  async function newChat() {
    chatCreateError.value = "";

    if (!session.value?.actor) {
      chatCreateError.value = "Log in to create a chat.";
      return;
    }

    const title = newChatTitle.value.trim();
    if (!title) {
      chatCreateError.value = "Enter a group name.";
      return;
    }

    const createdChannel = randomChannelId();
    isCreatingChat.value = true;
    try {
      const handles = parseInviteHandles(newChatInviteHandles.value);
      const memberActors = [session.value.actor];

      for (const handle of handles) {
        const lookupHandle = normalizeGraffitiHandleForLookup(handle);
        let actor;
        try {
          actor = await graffiti.handleToActor(lookupHandle);
        } catch (error) {
          console.error(error);
          chatCreateError.value = `Could not look up "${handle}". Check your connection and try again.`;
          return;
        }
        if (actor == null) {
          chatCreateError.value = `Unknown Graffiti username: "${handle}"`;
          return;
        }
        const short = clipHandleToShortLabel(lookupHandle) || clipHandleToShortLabel(handle);
        if (short) {
          setCachedHandleForActor(actor, short);
        }
        memberActors.push(actor);
      }

      const allowedMembers = uniqueActors(memberActors);

      try {
        await graffiti.post(
          {
            value: {
              activity: "Create",
              type: "Chat",
              channel: createdChannel,
              title,
              published: Date.now(),
              memberActors: allowedMembers,
            },
            channels: [DIRECTORY_CHANNEL],
            allowed: allowedMembers,
          },
          session.value,
        );
      } catch (error) {
        console.error(error);
        chatCreateError.value =
          error?.message ||
          "Could not create the chat. Check your connection and try again.";
        return;
      }

      try {
        await router.push(chatRoute(createdChannel));
      } catch (error) {
        console.error(error);
        chatCreateError.value =
          "The chat was created. Open it from the list below if you are not redirected.";
        newChatTitle.value = "";
        newChatInviteHandles.value = "";
        return;
      }

      isCreateChatOpen.value = false;
      newChatTitle.value = "";
      newChatInviteHandles.value = "";
    } finally {
      isCreatingChat.value = false;
    }
  }

  const { objects: chatObjects, isFirstPoll: areChatsLoading } = useGraffitiDiscover(
    [DIRECTORY_CHANNEL],
    CHAT_CREATE_DISCOVER_SCHEMA,
    () => session.value,
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
    () => session.value,
  );

  const { objects: chatDeleteObjects } = useGraffitiDiscover(
    [DIRECTORY_CHANNEL],
    CHAT_DELETE_DISCOVER_SCHEMA,
    () => session.value,
  );

  const deletedChannels = computed(() => {
    const set = new Set();
    for (const object of chatDeleteObjects.value) {
      const ch = object.value.channel;
      if (typeof ch === "string" && ch.trim()) {
        set.add(ch);
      }
    }
    return set;
  });

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
      if (leftChannels.value.has(chat.channel)) {
        continue;
      }
      if (deletedChannels.value.has(chat.channel)) {
        continue;
      }
      visibleChats.push(chat);
    }

    return visibleChats;
  });

  const previewChannelIds = computed(() => {
    return availableChats.value.map((c) => c.channel);
  });

  const { objects: previewMessageObjects, isFirstPoll: arePreviewMessagesLoading } =
    useGraffitiDiscover(
      () => previewChannelIds.value,
      CHAT_MESSAGE_DISCOVER_SCHEMA,
      () => session.value,
      true,
    );

  const lastOpenedByChannel = ref({});

  function refreshLastOpenedFromStorage() {
    const actor = session.value?.actor;
    lastOpenedByChannel.value = actor ? getLastOpenedMap(actor) : {};
  }

  watch(() => session.value?.actor, refreshLastOpenedFromStorage, { immediate: true });

  watch(
    () => route.name,
    (name) => {
      if (name === "messages-directory") {
        refreshLastOpenedFromStorage();
      }
    },
  );

  const directoryChatRows = computed(() => {
    const ids = previewChannelIds.value;
    const latestMap = latestMessageByChannel(previewMessageObjects.value, ids);
    const opened = lastOpenedByChannel.value;
    const viewerActor = session.value?.actor;

    return availableChats.value.map((chat) => {
      const latest = latestMap.get(chat.channel);
      const preview = latest ? truncateChatPreview(latest.value.content) : "";
      const lastOpenedAt = opened[chat.channel];
      const unreadCount = countMessagesAfterTimestamp(
        previewMessageObjects.value,
        chat.channel,
        lastOpenedAt,
        viewerActor,
      );
      return {
        channel: chat.channel,
        title: chat.title,
        preview,
        unreadCount,
        unreadDisplay:
          unreadCount > 99 ? "99+" : unreadCount > 0 ? String(unreadCount) : "",
      };
    });
  });

  return {
    newChatTitle,
    newChatInviteHandles,
    chatCreateError,
    isCreatingChat,
    isCreateChatOpen,
    openCreateChat,
    closeCreateChat,
    newChat,
    areChatsLoading,
    arePreviewMessagesLoading,
    availableChats,
    directoryChatRows,
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
      LeaveNotice,
      MemberHandle,
    },
  };
}
