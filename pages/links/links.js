import { ref, watch, onUnmounted, nextTick } from "vue";
import { useGraffiti, useGraffitiSession, useGraffitiDiscover } from "@graffiti-garden/wrapper-vue";
import { loadTemplate } from "../../lib/load-template.js";
import {
  DIRECTORY_CHANNEL,
  LINKS_BOARD_DISCOVER_SCHEMA,
} from "../messages/constants.js";

/** Legacy per-device storage; migrated once to Graffiti when the shared board is empty. */
function legacyLinksStorageKey(actor) {
  return `chatapp.links.v1:${actor || "guest"}`;
}

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function defaultLinksState() {
  return {
    sections: [],
  };
}

function normalizeUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) {
    return "";
  }
  if (/^https?:\/\//i.test(s)) {
    return s;
  }
  return `https://${s}`;
}

function pickLatestLinkBoard(objects) {
  let best = null;
  for (const obj of objects) {
    if (obj.value?.type !== "LinksBoard") {
      continue;
    }
    const pub = obj.value?.published;
    if (typeof pub !== "number") {
      continue;
    }
    if (!best || pub > best.value.published) {
      best = obj;
    }
  }
  return best;
}

function cloneSections(sections) {
  try {
    return JSON.parse(JSON.stringify(Array.isArray(sections) ? sections : []));
  } catch {
    return [];
  }
}

function linksSetup() {
  const graffiti = useGraffiti();
  const session = useGraffitiSession();

  const { objects: linkBoardObjects, isFirstPoll: areLinksBoardLoading } = useGraffitiDiscover(
    [DIRECTORY_CHANNEL],
    LINKS_BOARD_DISCOVER_SCHEMA,
    () => session.value,
  );

  const state = ref(defaultLinksState());
  const appliedPublished = ref(0);
  const isSavingLinks = ref(false);
  const migrateAttempted = ref(false);

  const draftLinkLabelBySectionId = ref({});
  const draftLinkUrlBySectionId = ref({});
  const copiedLinkId = ref(null);
  let copyResetTimer = null;

  const renamingSectionId = ref(null);
  const renameDraft = ref("");

  function clearCopyFeedbackTimer() {
    if (copyResetTimer) {
      clearTimeout(copyResetTimer);
      copyResetTimer = null;
    }
  }

  onUnmounted(() => {
    clearCopyFeedbackTimer();
    copiedLinkId.value = null;
  });

  function requireSessionForEdit() {
    if (!session.value?.actor) {
      window.alert("Log in to add or change shared links.");
      return false;
    }
    return true;
  }

  async function persistLinksBoard() {
    if (!session.value?.actor) {
      return;
    }
    const published = Date.now();
    const sections = cloneSections(state.value.sections);
    isSavingLinks.value = true;
    try {
      await graffiti.post(
        {
          value: {
            type: "LinksBoard",
            sections,
            published,
          },
          channels: [DIRECTORY_CHANNEL],
        },
        session.value,
      );
      appliedPublished.value = published;
    } catch (error) {
      console.error(error);
      window.alert(
        error?.message || "Could not save links. Check your connection and try again.",
      );
    } finally {
      isSavingLinks.value = false;
    }
  }

  function applyLatestFromRemote() {
    if (!session.value?.actor) {
      return;
    }
    const latest = pickLatestLinkBoard(linkBoardObjects.value || []);
    if (!latest) {
      return;
    }
    const pub = latest.value.published;
    if (typeof pub !== "number" || pub <= appliedPublished.value) {
      return;
    }
    state.value = {
      sections: cloneSections(latest.value.sections),
    };
    appliedPublished.value = pub;
  }

  function tryMigrateLegacyLocalStorageOnce() {
    if (migrateAttempted.value || !session.value?.actor) {
      return;
    }
    if (pickLatestLinkBoard(linkBoardObjects.value)) {
      migrateAttempted.value = true;
      return;
    }
    const actor = session.value.actor;
    const keys = [legacyLinksStorageKey(actor), legacyLinksStorageKey(null)];
    for (const key of [...new Set(keys)]) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) {
          continue;
        }
        const parsed = JSON.parse(raw);
        const sections = Array.isArray(parsed?.sections) ? parsed.sections : [];
        if (sections.length === 0) {
          continue;
        }
        state.value = { sections: cloneSections(sections) };
        localStorage.removeItem(key);
        migrateAttempted.value = true;
        void persistLinksBoard();
        return;
      } catch {
        /* ignore */
      }
    }
    migrateAttempted.value = true;
  }

  watch(
    () => session.value?.actor,
    (actor) => {
      state.value = defaultLinksState();
      appliedPublished.value = 0;
      draftLinkLabelBySectionId.value = {};
      draftLinkUrlBySectionId.value = {};
      renamingSectionId.value = null;
      renameDraft.value = "";
      migrateAttempted.value = false;
      if (actor) {
        nextTick(() => {
          applyLatestFromRemote();
        });
      }
    },
    { immediate: true },
  );

  watch(
    () => linkBoardObjects.value,
    () => {
      applyLatestFromRemote();
    },
    { deep: true },
  );

  watch([areLinksBoardLoading, () => session.value?.actor, () => linkBoardObjects.value], () => {
    if (areLinksBoardLoading.value || !session.value?.actor) {
      return;
    }
    tryMigrateLegacyLocalStorageOnce();
  });

  watch(renamingSectionId, (id) => {
    if (!id) {
      return;
    }
    nextTick(() => {
      const el = document.getElementById(`links-rename-${id}`);
      el?.focus();
      el?.select?.();
    });
  });

  function addSection() {
    if (!requireSessionForEdit()) {
      return;
    }
    const id = randomId();
    state.value.sections.push({
      id,
      title: "New section",
      links: [],
      createdAt: Date.now(),
    });
    void persistLinksBoard();
  }

  function removeSection(sectionId) {
    if (!requireSessionForEdit()) {
      return;
    }
    const idx = state.value.sections.findIndex((s) => s.id === sectionId);
    if (idx === -1) {
      return;
    }
    if (renamingSectionId.value === sectionId) {
      renamingSectionId.value = null;
      renameDraft.value = "";
    }
    state.value.sections.splice(idx, 1);
    const nextLabels = { ...draftLinkLabelBySectionId.value };
    const nextUrls = { ...draftLinkUrlBySectionId.value };
    delete nextLabels[sectionId];
    delete nextUrls[sectionId];
    draftLinkLabelBySectionId.value = nextLabels;
    draftLinkUrlBySectionId.value = nextUrls;
    void persistLinksBoard();
  }

  function addLink(sectionId) {
    if (!requireSessionForEdit()) {
      return;
    }
    const section = state.value.sections.find((s) => s.id === sectionId);
    if (!section) {
      return;
    }

    const label = String(draftLinkLabelBySectionId.value?.[sectionId] || "").trim();
    const url = normalizeUrl(draftLinkUrlBySectionId.value?.[sectionId]);

    if (!label) {
      window.alert("Please enter a label for this link.");
      return;
    }

    if (!url) {
      window.alert("Please enter a website URL.");
      return;
    }

    if (!Array.isArray(section.links)) {
      section.links = [];
    }

    section.links.push({
      id: randomId(),
      label,
      url,
      createdAt: Date.now(),
    });

    draftLinkLabelBySectionId.value = {
      ...draftLinkLabelBySectionId.value,
      [sectionId]: "",
    };
    draftLinkUrlBySectionId.value = {
      ...draftLinkUrlBySectionId.value,
      [sectionId]: "",
    };
    void persistLinksBoard();
  }

  function removeLink(sectionId, linkId) {
    if (!requireSessionForEdit()) {
      return;
    }
    const section = state.value.sections.find((s) => s.id === sectionId);
    if (!section || !Array.isArray(section.links)) {
      return;
    }
    const idx = section.links.findIndex((l) => l.id === linkId);
    if (idx === -1) {
      return;
    }
    section.links.splice(idx, 1);
    void persistLinksBoard();
  }

  async function copyLinkUrl(url, linkId) {
    const text = String(url || "").trim();
    if (!text) {
      return;
    }

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!ok) {
          throw new Error("execCommand copy failed");
        }
      }
    } catch {
      window.prompt("Copy this link:", text);
      return;
    }

    clearCopyFeedbackTimer();
    copiedLinkId.value = linkId;
    copyResetTimer = setTimeout(() => {
      copiedLinkId.value = null;
      copyResetTimer = null;
    }, 2000);
  }

  function startRenameSection(section) {
    if (!requireSessionForEdit()) {
      return;
    }
    renamingSectionId.value = section.id;
    renameDraft.value = String(section.title ?? "");
  }

  function cancelRenameSection() {
    renamingSectionId.value = null;
    renameDraft.value = "";
  }

  function commitRenameSection(sectionId) {
    if (!session.value?.actor) {
      cancelRenameSection();
      return;
    }
    if (renamingSectionId.value !== sectionId) {
      return;
    }
    const section = state.value.sections.find((s) => s.id === sectionId);
    if (!section) {
      cancelRenameSection();
      return;
    }
    const next = String(renameDraft.value || "").trim();
    if (!next) {
      cancelRenameSection();
      return;
    }
    section.title = next;
    cancelRenameSection();
    void persistLinksBoard();
  }

  return {
    state,
    draftLinkLabelBySectionId,
    draftLinkUrlBySectionId,
    copiedLinkId,
    renamingSectionId,
    renameDraft,
    areLinksBoardLoading,
    isSavingLinks,
    addSection,
    removeSection,
    addLink,
    removeLink,
    copyLinkUrl,
    startRenameSection,
    cancelRenameSection,
    commitRenameSection,
  };
}

export async function createLinksView() {
  const template = await loadTemplate(new URL("./view.html", import.meta.url).href);
  return {
    template,
    setup: linksSetup,
  };
}
