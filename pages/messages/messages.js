import { ref, computed, watch, watchEffect, nextTick, onMounted, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";
import { MessageBubble } from "../../components/message/message.js";
import { LeaveNotice } from "../../components/message/leave-notice.js";
import { SystemNotice } from "../../components/message/system-notice.js";
import { MemberHandle } from "../../components/member/member-handle.js";
import { TeamAudienceFormField } from "../../components/team/team-audience-form-field.js";
import { loadTemplate } from "../../lib/load-template.js";
import {
  DEFAULT_CHAT_TITLE,
  CHAT_CREATE_DISCOVER_SCHEMA,
  CHAT_DELETE_DISCOVER_SCHEMA,
  CHAT_MESSAGE_DISCOVER_SCHEMA,
} from "./constants.js";
import { useTeamDirectoryChannel } from "../../lib/use-team-directory-channel.js";
import { setLastOpenedForChannel, getLastOpenedMap } from "../../lib/chat-last-opened.js";
import { expandAudienceKeys } from "../../lib/team-audience-resolve.js";
import { useTeamRosterPickerRows } from "../../lib/use-team-roster-picker.js";
import {
  defaultTeamGroupSlugFromChatCreateValue,
  sortChatsWithPinnedDefaultGroups,
} from "../../lib/team-groups.js";

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

/** Latest Create-Chat Graffiti object per channel (`published` wins). */
function latestCreateChatObjectPerChannel(objects) {
  const map = new Map();
  for (const object of objects || []) {
    const v = object?.value;
    if (!v || v.activity !== "Create" || v.type !== "Chat" || !v.channel) {
      continue;
    }
    const ch = v.channel;
    const pub = Number(v.published) || 0;
    const prev = map.get(ch);
    if (!prev || pub > (Number(prev.value.published) || 0)) {
      map.set(ch, object);
    }
  }
  return map;
}

function threadSetup() {
  const graffiti = useGraffiti();
  const session = useGraffitiSession();
  const teamDirectory = useTeamDirectoryChannel();
  const route = useRoute();
  const router = useRouter();
  const { rosterMembers, rosterDiscoverLoading } = useTeamRosterPickerRows(
    teamDirectory,
    session,
  );

  function normalizeChannel(channelParam) {
    return typeof channelParam === "string" && channelParam.trim()
      ? channelParam
      : teamDirectory.value;
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
      if (allowed != null) {
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
    () => [teamDirectory.value],
    CHAT_CREATE_DISCOVER_SCHEMA,
    () => session.value,
  );

  const { objects: chatLeaveObjects, isFirstPoll: areLeaveObjectsLoading } =
    useGraffitiDiscover(
      () => [teamDirectory.value],
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
      () => [teamDirectory.value],
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

  /**
   * Compare successive Create-Chat objects for this channel and synthesize
   * "rename" and "add member" timeline events. The earliest visible Create-Chat
   * for a viewer is treated as the chat's starting state (no events emitted for
   * its title or initial members).
   */
  const renameAndAddEventsForChannel = computed(() => {
    const events = [];
    const creates = chatObjects.value
      .filter((o) => o?.value?.channel === channel.value)
      .toSorted((a, b) => {
        const ap = Number(a.value.published) || 0;
        const bp = Number(b.value.published) || 0;
        if (ap !== bp) {
          return ap - bp;
        }
        return String(a.url).localeCompare(String(b.url));
      });
    if (creates.length < 2) {
      return events;
    }
    for (let i = 1; i < creates.length; i++) {
      const prev = creates[i - 1];
      const cur = creates[i];
      const prevValue = prev?.value || {};
      const curValue = cur?.value || {};
      const published = Number(curValue.published) || 0;

      const prevTitle = String(prevValue.title || "").trim();
      const curTitle = String(curValue.title || "").trim();
      if (curTitle && prevTitle !== curTitle) {
        events.push({
          kind: "rename",
          published,
          sortKey: `${cur.url}-rename`,
          actor: cur.actor,
          oldTitle: prevTitle,
          newTitle: curTitle,
        });
      }

      const prevMemberSet = new Set(
        Array.isArray(prevValue.memberActors) ? prevValue.memberActors : [],
      );
      const addedActors = (
        Array.isArray(curValue.memberActors) ? curValue.memberActors : []
      ).filter((a) => typeof a === "string" && a && !prevMemberSet.has(a));
      if (addedActors.length > 0) {
        events.push({
          kind: "add",
          published,
          sortKey: `${cur.url}-add`,
          actor: cur.actor,
          addedActors,
        });
      }
    }
    return events;
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
    const renameAndAddEvents = renameAndAddEventsForChannel.value;
    return [...messages, ...leaves, ...renameAndAddEvents].toSorted((a, b) => {
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
    const v = latestCreateForChannel.value?.value;
    if (!v) {
      return null;
    }
    const actors = v.memberActors;
    const defSlug = defaultTeamGroupSlugFromChatCreateValue(v);
    if (typeof defSlug === "string" && defSlug) {
      return Array.isArray(actors) ? actors : [];
    }
    return Array.isArray(actors) && actors.length > 0 ? actors : null;
  });

  const viewerInChatMembers = computed(() => {
    const me = session.value?.actor;
    if (!me) {
      return false;
    }
    const allowed = memberActorsForMessages.value;
    if (allowed == null) {
      return true;
    }
    return allowed.includes(me);
  });

  const canSendMessage = computed(() => {
    return Boolean(
      session.value &&
      myMessage.value.trim() &&
      viewerInChatMembers.value,
    );
  });

  const isPrivateGroupChat = computed(() => {
    const v = latestCreateForChannel.value?.value;
    if (defaultTeamGroupSlugFromChatCreateValue(v)) {
      return true;
    }
    const allowed = memberActorsForMessages.value;
    return Array.isArray(allowed) && allowed.length > 0;
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

  const latestThreadCreateByChannel = computed(() =>
    latestCreateChatObjectPerChannel(chatObjects.value),
  );

  const chats = computed(() => {
    const byChannel = new Map();
    for (const object of chatObjects.value) {
      const v = object.value;
      if (!v || v.activity !== "Create" || v.type !== "Chat" || !v.channel) {
        continue;
      }
      const ch = v.channel;
      const pub = Number(v.published) || 0;
      const prev = byChannel.get(ch);
      const prevPub = prev ? Number(prev.published) || 0 : -1;
      if (!prev || pub > prevPub) {
        byChannel.set(ch, {
          channel: ch,
          title: v.title,
          published: pub,
        });
      }
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
    const visibleChats = [{ channel: teamDirectory.value, title: DEFAULT_CHAT_TITLE }];
    const viewer = session.value?.actor;
    const latestMap = latestThreadCreateByChannel.value;

    for (const chat of chats.value) {
      if (leftChannels.value.has(chat.channel)) {
        continue;
      }
      if (deletedChannels.value.has(chat.channel)) {
        continue;
      }
      const latestObj = latestMap.get(chat.channel);
      const v = latestObj?.value;
      const squadSlug = defaultTeamGroupSlugFromChatCreateValue(v);
      if (typeof squadSlug === "string" && squadSlug && viewer) {
        const arr = Array.isArray(v.memberActors) ? v.memberActors : [];
        if (!arr.includes(viewer)) {
          continue;
        }
      }
      visibleChats.push(chat);
    }

    return sortChatsWithPinnedDefaultGroups(visibleChats, teamDirectory.value, latestMap);
  });

  const selectedChat = computed(() => {
    return (
      availableChats.value.find((chat) => chat.channel === channel.value) ?? {
        channel: teamDirectory.value,
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
    if (!session.value || channel.value === teamDirectory.value) {
      return false;
    }
    const v = latestCreateForChannel.value?.value;
    if (defaultTeamGroupSlugFromChatCreateValue(v)) {
      return false;
    }
    return true;
  });

  const chatCreatorActor = computed(() => {
    let earliest = null;
    for (const object of chatObjects.value) {
      if (object.value.channel !== channel.value) {
        continue;
      }
      const pub = Number(object.value.published) || 0;
      const bestPub = earliest ? Number(earliest.value.published) || 0 : Infinity;
      if (!earliest || pub < bestPub) {
        earliest = object;
      }
    }
    return earliest?.actor ?? null;
  });

  const canDeleteEntireChat = computed(() => {
    if (!session.value || channel.value === teamDirectory.value) {
      return false;
    }
    if (!latestCreateForChannel.value) {
      return false;
    }
    const creator = chatCreatorActor.value;
    return Boolean(creator && session.value.actor === creator);
  });

  const isDeletingChat = ref(false);

  const canRenameSelectedChat = computed(() => {
    if (!session.value || channel.value === teamDirectory.value) {
      return false;
    }
    const v = latestCreateForChannel.value?.value;
    if (!v) {
      return false;
    }
    if (defaultTeamGroupSlugFromChatCreateValue(v)) {
      return false;
    }
    if (!viewerInChatMembers.value) {
      return false;
    }
    return true;
  });

  const isRenamingChat = ref(false);

  const canAddMembersToChat = computed(() => {
    return canRenameSelectedChat.value;
  });

  const isAddMembersOpen = ref(false);
  const addMemberKeys = ref([]);
  const addMembersError = ref("");
  const isAddingMembers = ref(false);

  const currentChatActorSet = computed(() => {
    const set = new Set();
    const actors = memberActorsForMessages.value;
    if (Array.isArray(actors)) {
      for (const a of actors) {
        if (typeof a === "string" && a) {
          set.add(a);
        }
      }
    }
    return set;
  });

  const addableRosterMembers = computed(() => {
    const current = currentChatActorSet.value;
    return (rosterMembers.value || []).filter((m) => {
      const actor = String(m?.actor || "").trim();
      return actor && !current.has(actor);
    });
  });

  function openAddMembers() {
    if (!canAddMembersToChat.value) {
      return;
    }
    addMemberKeys.value = [];
    addMembersError.value = "";
    isAddMembersOpen.value = true;
  }

  function closeAddMembers() {
    if (isAddingMembers.value) {
      return;
    }
    isAddMembersOpen.value = false;
  }

  function onAddMembersKeydown(event) {
    if (event.key === "Escape" && isAddMembersOpen.value && !isAddingMembers.value) {
      closeAddMembers();
    }
  }

  onMounted(() => {
    window.addEventListener("keydown", onAddMembersKeydown);
  });

  onUnmounted(() => {
    window.removeEventListener("keydown", onAddMembersKeydown);
  });

  watch(addMemberKeys, () => {
    addMembersError.value = "";
  }, { deep: true });

  watch(
    () => channel.value,
    () => {
      isAddMembersOpen.value = false;
      addMemberKeys.value = [];
      addMembersError.value = "";
    },
  );

  async function addMembersToChat() {
    if (!canAddMembersToChat.value) {
      return;
    }
    addMembersError.value = "";

    const currentValue = latestCreateForChannel.value?.value;
    if (!currentValue) {
      return;
    }

    const invitedActors = expandAudienceKeys(
      addMemberKeys.value || [],
      rosterMembers.value,
      { mode: "exact" },
    );
    const current = currentChatActorSet.value;
    const newActors = invitedActors.filter((a) => !current.has(a));

    if (newActors.length === 0) {
      addMembersError.value = "Select at least one new member to add.";
      return;
    }

    const mergedMembers = uniqueActors([
      ...(Array.isArray(currentValue.memberActors) ? currentValue.memberActors : []),
      ...newActors,
    ]);
    const mergedKeys = (() => {
      const next = new Set(
        Array.isArray(currentValue.audienceKeys) ? currentValue.audienceKeys : [],
      );
      for (const k of addMemberKeys.value || []) {
        if (typeof k === "string" && k) {
          next.add(k);
        }
      }
      return [...next];
    })();

    isAddingMembers.value = true;
    try {
      const value = {
        activity: "Create",
        type: "Chat",
        channel: channel.value,
        title: currentValue.title,
        published: Date.now(),
        memberActors: mergedMembers,
      };
      if (mergedKeys.length > 0) {
        value.audienceKeys = mergedKeys;
      }
      await graffiti.post(
        {
          value,
          channels: [teamDirectory.value],
          allowed: mergedMembers,
        },
        session.value,
      );
      isAddMembersOpen.value = false;
      addMemberKeys.value = [];
    } catch (error) {
      console.error(error);
      addMembersError.value =
        error?.message || "Could not add members. Try again.";
    } finally {
      isAddingMembers.value = false;
    }
  }

  async function renameChat() {
    if (!canRenameSelectedChat.value) {
      return;
    }

    const currentValue = latestCreateForChannel.value?.value;
    if (!currentValue) {
      return;
    }
    const currentTitle = String(currentValue.title || "").trim();

    const proposedRaw = window.prompt("New chat name:", currentTitle);
    if (proposedRaw === null) {
      return;
    }
    const nextTitle = String(proposedRaw).trim();
    if (!nextTitle || nextTitle === currentTitle) {
      return;
    }

    const recipients = memberActorsForMessages.value;

    isRenamingChat.value = true;
    try {
      const value = {
        activity: "Create",
        type: "Chat",
        channel: channel.value,
        title: nextTitle,
        published: Date.now(),
      };
      if (Array.isArray(currentValue.memberActors)) {
        value.memberActors = uniqueActors(currentValue.memberActors);
      }
      if (
        Array.isArray(currentValue.audienceKeys) &&
        currentValue.audienceKeys.length > 0
      ) {
        value.audienceKeys = [...currentValue.audienceKeys];
      }

      const partial = {
        value,
        channels: [teamDirectory.value],
      };
      if (Array.isArray(recipients) && recipients.length > 0) {
        partial.allowed = uniqueActors(recipients);
      }

      await graffiti.post(partial, session.value);
    } finally {
      isRenamingChat.value = false;
    }
  }

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
          channels: [teamDirectory.value],
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
          channels: [teamDirectory.value],
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
    canRenameSelectedChat,
    canAddMembersToChat,
    isLeavingChat,
    isDeletingChat,
    isRenamingChat,
    leaveChat,
    deleteEntireChat,
    renameChat,
    channel,
    goToChannelList,
    isPrivateGroupChat,
    isMembersPanelOpen,
    toggleMembersPanel,
    closeMembersPanel,
    allMembers,
    compactMembers,
    remainingMemberCount,
    isAddMembersOpen,
    addMemberKeys,
    addMembersError,
    isAddingMembers,
    addableRosterMembers,
    rosterDiscoverLoading,
    openAddMembers,
    closeAddMembers,
    addMembersToChat,
  };
}

function directorySetup() {
  const graffiti = useGraffiti();
  const session = useGraffitiSession();
  const teamDirectory = useTeamDirectoryChannel();
  const route = useRoute();
  const router = useRouter();

  function normalizeChannel(channelParam) {
    return typeof channelParam === "string" && channelParam.trim()
      ? channelParam
      : teamDirectory.value;
  }

  function chatRoute(chatChannel) {
    return {
      name: "messages-chat",
      params: { channel: normalizeChannel(chatChannel) },
    };
  }

  const newChatTitle = ref("");
  const newChatAudienceKeys = ref([]);
  const chatCreateError = ref("");
  const isCreatingChat = ref(false);
  const isCreateChatOpen = ref(false);

  const { rosterMembers, rosterDiscoverLoading } = useTeamRosterPickerRows(teamDirectory, session);

  function openCreateChat() {
    chatCreateError.value = "";
    newChatAudienceKeys.value = [];
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

  watch(
    [newChatTitle, newChatAudienceKeys],
    () => {
      chatCreateError.value = "";
    },
    { deep: true },
  );

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
      const inviteActors = expandAudienceKeys(newChatAudienceKeys.value || [], rosterMembers.value, {
        mode: "exact",
      });
      const allowedMembers = uniqueActors([session.value.actor, ...inviteActors]);

      try {
        const value = {
          activity: "Create",
          type: "Chat",
          channel: createdChannel,
          title,
          published: Date.now(),
          memberActors: allowedMembers,
        };
        if (newChatAudienceKeys.value?.length) {
          value.audienceKeys = [...newChatAudienceKeys.value];
        }
        await graffiti.post(
          {
            value,
            channels: [teamDirectory.value],
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
        newChatAudienceKeys.value = [];
        return;
      }

      isCreateChatOpen.value = false;
      newChatTitle.value = "";
      newChatAudienceKeys.value = [];
    } finally {
      isCreatingChat.value = false;
    }
  }

  const { objects: chatObjects, isFirstPoll: areChatsLoading } = useGraffitiDiscover(
    () => [teamDirectory.value],
    CHAT_CREATE_DISCOVER_SCHEMA,
    () => session.value,
  );

  const { objects: chatLeaveObjects } = useGraffitiDiscover(
    () => [teamDirectory.value],
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
    () => [teamDirectory.value],
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

  const latestDirectoryCreateByChannel = computed(() =>
    latestCreateChatObjectPerChannel(chatObjects.value),
  );

  const chats = computed(() => {
    const byChannel = new Map();
    const latestMap = latestDirectoryCreateByChannel.value;
    for (const object of chatObjects.value) {
      const v = object.value;
      if (!v || v.activity !== "Create" || v.type !== "Chat" || !v.channel) {
        continue;
      }
      const ch = v.channel;
      const pub = Number(v.published) || 0;
      const prev = byChannel.get(ch);
      const prevPub = prev ? Number(prev.published) || 0 : -1;
      if (!prev || pub > prevPub) {
        byChannel.set(ch, {
          channel: ch,
          title: v.title,
          published: pub,
        });
      }
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
    const visibleChats = [{ channel: teamDirectory.value, title: DEFAULT_CHAT_TITLE }];
    const viewer = session.value?.actor;
    const latestMap = latestDirectoryCreateByChannel.value;

    for (const chat of chats.value) {
      if (leftChannels.value.has(chat.channel)) {
        continue;
      }
      if (deletedChannels.value.has(chat.channel)) {
        continue;
      }
      const latestObj = latestMap.get(chat.channel);
      const v = latestObj?.value;
      const squadSlug = defaultTeamGroupSlugFromChatCreateValue(v);
      if (typeof squadSlug === "string" && squadSlug && viewer) {
        const arr = Array.isArray(v.memberActors) ? v.memberActors : [];
        if (!arr.includes(viewer)) {
          continue;
        }
      }
      visibleChats.push(chat);
    }

    return sortChatsWithPinnedDefaultGroups(visibleChats, teamDirectory.value, latestMap);
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
    newChatAudienceKeys,
    rosterMembers,
    rosterDiscoverLoading,
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
    components: { TeamAudienceFormField },
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
      SystemNotice,
      MemberHandle,
      TeamAudienceFormField,
    },
  };
}
