import { ref, computed, watch, onUnmounted } from "vue";
import { useGraffiti, useGraffitiSession, useGraffitiDiscover } from "@graffiti-garden/wrapper-vue";
import { loadTemplate } from "../../lib/load-template.js";
import { setCachedHandleForActor } from "../../lib/actor-handle-cache.js";
import {
  DIRECTORY_CHANNEL,
  FORM_DEFINITION_DISCOVER_SCHEMA,
  FORM_RESPONSE_DISCOVER_SCHEMA,
} from "../messages/constants.js";

const GRAFFITI_ACTOR_SUFFIX = ".graffiti.actor";

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

function formVisibleToSessionActor(formObject, sessionActor) {
  if (!formObject?.value || !sessionActor) {
    return false;
  }
  if (formObject.actor === sessionActor) {
    return true;
  }
  const actors = formObject.value.assignedActors;
  if (!Array.isArray(actors) || actors.length === 0) {
    return true;
  }
  return actors.includes(sessionActor);
}

function formatAssignmentSummary(formObject) {
  const v = formObject?.value;
  const actors = v?.assignedActors;
  if (!Array.isArray(actors) || actors.length === 0) {
    return "Everyone";
  }
  const handles = v?.assignedHandles;
  if (Array.isArray(handles) && handles.length > 0) {
    return handles.join(", ");
  }
  return `${actors.length} member(s)`;
}

async function resolveAssignmentsFromInviteField(graffiti, rawText) {
  const handles = parseInviteHandles(rawText);
  if (handles.length === 0) {
    return { assignedActors: [], assignedHandles: [] };
  }
  const assignedActors = [];
  const assignedHandles = [];
  const seen = new Set();
  for (const handle of handles) {
    const lookupHandle = normalizeGraffitiHandleForLookup(handle);
    let actor;
    try {
      actor = await graffiti.handleToActor(lookupHandle);
    } catch {
      throw new Error(`Could not look up “${handle}”. Check your connection and try again.`);
    }
    if (actor == null) {
      throw new Error(`Unknown Graffiti username: “${handle}”`);
    }
    if (seen.has(actor)) {
      continue;
    }
    seen.add(actor);
    const short =
      clipHandleToShortLabel(lookupHandle) || clipHandleToShortLabel(handle) || String(handle).trim();
    if (short) {
      setCachedHandleForActor(actor, short);
    }
    assignedActors.push(actor);
    assignedHandles.push(short || String(handle).trim());
  }
  return { assignedActors, assignedHandles };
}

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function pickLatestById(objects) {
  const byId = new Map();
  for (const o of Array.isArray(objects) ? objects : []) {
    const id = String(o?.value?.id || "").trim();
    if (!id) {
      continue;
    }
    const pub = Number(o?.value?.published || 0);
    const prev = byId.get(id);
    const prevPub = Number(prev?.value?.published || 0);
    if (!prev || pub > prevPub) {
      byId.set(id, o);
    }
  }
  return [...byId.values()];
}

/** Latest response per formId for the current actor only. */
function pickLatestMyResponseByFormId(objects, actor) {
  const byFormId = new Map();
  for (const o of Array.isArray(objects) ? objects : []) {
    if (o?.actor !== actor || o?.value?.type !== "FormResponse") {
      continue;
    }
    const formId = String(o?.value?.formId || "").trim();
    if (!formId) {
      continue;
    }
    const pub = Number(o?.value?.published || 0);
    const prev = byFormId.get(formId);
    const prevPub = Number(prev?.value?.published || 0);
    if (!prev || pub > prevPub) {
      byFormId.set(formId, o);
    }
  }
  return byFormId;
}

function toDatetimeLocalInputValue(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) {
    return "";
  }
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  const pad = (x) => String(x).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${y}-${m}-${day}T${h}:${min}`;
}

function fromDatetimeLocalInputValue(s) {
  const t = new Date(String(s || "").trim()).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function formatDueDateTime(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) {
    return "";
  }
  try {
    return new Date(n).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function sortActiveForms(a, b) {
  const da = Number(a?.value?.dueAt);
  const db = Number(b?.value?.dueAt);
  if (Number.isFinite(da) && Number.isFinite(db) && da !== db) {
    return da - db;
  }
  const pa = Number(a?.value?.published || 0);
  const pb = Number(b?.value?.published || 0);
  return pb - pa;
}

function sortHistoryForms(a, b) {
  const da = Number(a?.value?.dueAt);
  const db = Number(b?.value?.dueAt);
  if (Number.isFinite(da) && Number.isFinite(db) && da !== db) {
    return db - da;
  }
  const pa = Number(a?.value?.published || 0);
  const pb = Number(b?.value?.published || 0);
  return pb - pa;
}

function formsSetup() {
  const graffiti = useGraffiti();
  const session = useGraffitiSession();

  const { objects: formDefRaw, isFirstPoll: formDefFirstPoll } = useGraffitiDiscover(
    [DIRECTORY_CHANNEL],
    FORM_DEFINITION_DISCOVER_SCHEMA,
    () => session.value,
  );

  const { objects: formResponseRaw, isFirstPoll: formResponseFirstPoll } = useGraffitiDiscover(
    [DIRECTORY_CHANNEL],
    FORM_RESPONSE_DISCOVER_SCHEMA,
    () => session.value,
  );

  const isLoading = computed(() => !!formDefFirstPoll.value || !!formResponseFirstPoll.value);

  const latestFormObjects = computed(() => {
    const all = Array.isArray(formDefRaw.value) ? formDefRaw.value : [];
    const defs = all.filter((o) => o?.value?.type === "FormDefinition");
    return pickLatestById(defs);
  });

  const visibleFormObjects = computed(() => {
    const actor = session.value?.actor;
    if (!actor) {
      return [];
    }
    return latestFormObjects.value.filter((o) => formVisibleToSessionActor(o, actor));
  });

  const myResponseByFormId = computed(() => {
    const actor = session.value?.actor;
    if (!actor) {
      return new Map();
    }
    const all = Array.isArray(formResponseRaw.value) ? formResponseRaw.value : [];
    return pickLatestMyResponseByFormId(all, actor);
  });

  const scopeFilter = ref("active");

  const nowMs = ref(Date.now());
  let nowTimer = null;
  if (typeof window !== "undefined") {
    nowTimer = window.setInterval(() => {
      nowMs.value = Date.now();
    }, 60_000);
  }
  onUnmounted(() => {
    if (nowTimer != null) {
      window.clearInterval(nowTimer);
    }
  });

  const scopedForms = computed(() => {
    const t = nowMs.value;
    const list = visibleFormObjects.value.filter((o) => {
      const due = Number(o?.value?.dueAt);
      const open = Number.isFinite(due) && due > t;
      return scopeFilter.value === "active" ? open : !open;
    });
    const sorter = scopeFilter.value === "active" ? sortActiveForms : sortHistoryForms;
    return [...list].sort(sorter);
  });

  const completedForms = computed(() => {
    const m = myResponseByFormId.value;
    return scopedForms.value.filter((o) => {
      const id = String(o?.value?.id || "").trim();
      return id && m.has(id);
    });
  });

  const incompleteForms = computed(() => {
    const m = myResponseByFormId.value;
    return scopedForms.value.filter((o) => {
      const id = String(o?.value?.id || "").trim();
      return id && !m.has(id);
    });
  });

  const detailFormId = ref(null);

  const detailForm = computed(() => {
    const id = String(detailFormId.value || "").trim();
    if (!id) {
      return null;
    }
    return visibleFormObjects.value.find((o) => String(o?.value?.id || "").trim() === id) ?? null;
  });

  function openFormDetail(formObject) {
    const id = String(formObject?.value?.id || "").trim();
    if (!id) {
      return;
    }
    detailFormId.value = id;
  }

  function closeFormDetail() {
    detailFormId.value = null;
  }

  watch(detailForm, (obj) => {
    if (detailFormId.value && !obj) {
      detailFormId.value = null;
    }
  });

  function isCreator(formObject) {
    const actor = session.value?.actor;
    return !!(actor && formObject?.actor === actor);
  }

  function responseFor(formObject) {
    const id = String(formObject?.value?.id || "").trim();
    return id ? myResponseByFormId.value.get(id) : undefined;
  }

  const isFormModalOpen = ref(false);
  const isSubmittingFormDef = ref(false);
  const formDefError = ref("");
  const editingFormId = ref(null);

  const draftTitle = ref("");
  const draftDescription = ref("");
  const draftQuestion = ref("");
  const draftDueLocal = ref(toDatetimeLocalInputValue(Date.now() + 7 * 24 * 60 * 60 * 1000));
  /** Comma/space-separated Graffiti usernames; empty = visible to everyone (same parsing as New chat). */
  const draftInviteHandles = ref("");

  function resetFormDraft() {
    draftTitle.value = "";
    draftDescription.value = "";
    draftQuestion.value = "";
    draftDueLocal.value = toDatetimeLocalInputValue(Date.now() + 7 * 24 * 60 * 60 * 1000);
    draftInviteHandles.value = "";
    formDefError.value = "";
    editingFormId.value = null;
  }

  function openNewFormModal() {
    if (!session.value?.actor) {
      window.alert("Log in to create a form.");
      return;
    }
    closeFormDetail();
    resetFormDraft();
    isFormModalOpen.value = true;
  }

  function openEditFormModal(formObject) {
    if (!session.value?.actor) {
      window.alert("Log in to edit this form.");
      return;
    }
    closeFormDetail();
    if (!isCreator(formObject)) {
      return;
    }
    const v = formObject?.value;
    if (!v?.id) {
      return;
    }
    formDefError.value = "";
    editingFormId.value = String(v.id);
    draftTitle.value = String(v.title || "");
    draftDescription.value = String(v.description ?? "");
    draftQuestion.value = String(v.questionPrompt || "");
    draftDueLocal.value = toDatetimeLocalInputValue(v.dueAt) || draftDueLocal.value;
    const ah = v.assignedHandles;
    draftInviteHandles.value =
      Array.isArray(ah) && ah.length > 0 ? ah.join(", ") : "";
    isFormModalOpen.value = true;
  }

  function closeFormModal() {
    isFormModalOpen.value = false;
    formDefError.value = "";
  }

  const deletingFormId = ref(null);

  async function deleteFormById(formId) {
    const id = String(formId || "").trim();
    const actor = session.value?.actor;
    if (!actor || !id) {
      return false;
    }
    const all = Array.isArray(formDefRaw.value) ? formDefRaw.value : [];
    const matches = all.filter(
      (o) => o?.value?.type === "FormDefinition" && o?.value?.id === id && o?.actor === actor,
    );
    deletingFormId.value = id;
    try {
      for (const o of matches) {
        await graffiti.delete(o, session.value);
      }
      deletingFormId.value = null;
      return true;
    } catch (error) {
      console.error(error);
      deletingFormId.value = null;
      window.alert(error?.message || "Could not delete this form.");
      return false;
    }
  }

  async function confirmDeleteForm(formObject) {
    if (!isCreator(formObject)) {
      return;
    }
    const id = String(formObject?.value?.id || "").trim();
    if (!id) {
      return;
    }
    const ok = window.confirm(
      "Delete this form? Others will no longer see it. Submitted responses may still exist on the network. This cannot be undone.",
    );
    if (!ok) {
      return;
    }
    const success = await deleteFormById(id);
    if (success) {
      closeFormDetail();
    }
  }

  async function submitFormDefinition() {
    if (!session.value?.actor) {
      formDefError.value = "Log in to save this form.";
      return;
    }
    formDefError.value = "";
    const title = String(draftTitle.value || "").trim();
    const description = String(draftDescription.value ?? "").trim();
    const questionPrompt = String(draftQuestion.value || "").trim();
    const dueAt = fromDatetimeLocalInputValue(draftDueLocal.value);

    if (!title) {
      formDefError.value = "Please enter a title.";
      return;
    }
    if (!questionPrompt) {
      formDefError.value = "Please enter the question text.";
      return;
    }
    if (!Number.isFinite(dueAt)) {
      formDefError.value = "Please choose a valid due date and time.";
      return;
    }

    isSubmittingFormDef.value = true;
    try {
      let assignedActors = [];
      let assignedHandles = [];
      const parsed = parseInviteHandles(draftInviteHandles.value);
      if (parsed.length > 0) {
        ({ assignedActors, assignedHandles } = await resolveAssignmentsFromInviteField(
          graffiti,
          draftInviteHandles.value,
        ));
      }
      const id = editingFormId.value || randomId();
      const value = {
        type: "FormDefinition",
        id,
        title,
        description,
        questionPrompt,
        dueAt,
        published: Date.now(),
        assignedActors,
        assignedHandles,
      };
      await graffiti.post({ value, channels: [DIRECTORY_CHANNEL] }, session.value);
      isSubmittingFormDef.value = false;
      isFormModalOpen.value = false;
      resetFormDraft();
    } catch (error) {
      console.error(error);
      isSubmittingFormDef.value = false;
      formDefError.value = error?.message || "Could not save this form. Please try again.";
    }
  }

  const submittingResponseFormId = ref(null);
  const responseDrafts = ref({});
  const responseErrors = ref({});

  function setResponseError(formId, message) {
    const id = String(formId || "").trim();
    if (!id) {
      return;
    }
    const next = { ...responseErrors.value };
    if (!message) {
      delete next[id];
    } else {
      next[id] = message;
    }
    responseErrors.value = next;
  }

  function responseErrorFor(formObject) {
    const id = String(formObject?.value?.id || "").trim();
    return id ? String(responseErrors.value[id] || "") : "";
  }

  function responseDraftFor(formObject) {
    const id = String(formObject?.value?.id || "").trim();
    return id ? String(responseDrafts.value[id] ?? "") : "";
  }

  function setResponseDraft(formObject, text) {
    const id = String(formObject?.value?.id || "").trim();
    if (!id) {
      return;
    }
    setResponseError(id, "");
    responseDrafts.value = { ...responseDrafts.value, [id]: text };
  }

  async function submitResponse(formObject) {
    if (!session.value?.actor) {
      setResponseError(formObject?.value?.id, "Log in to submit.");
      return;
    }
    const formId = String(formObject?.value?.id || "").trim();
    if (!formId) {
      return;
    }
    setResponseError(formId, "");
    const dueAt = Number(formObject?.value?.dueAt);
    if (!Number.isFinite(dueAt) || dueAt <= Date.now()) {
      setResponseError(formId, "This form is no longer accepting responses.");
      return;
    }
    const answer = String(responseDrafts.value[formId] ?? "").trim();
    if (!answer) {
      setResponseError(formId, "Please enter a response.");
      return;
    }
    submittingResponseFormId.value = formId;
    try {
      const value = {
        type: "FormResponse",
        formId,
        answer,
        published: Date.now(),
      };
      await graffiti.post({ value, channels: [DIRECTORY_CHANNEL] }, session.value);
      submittingResponseFormId.value = null;
      const nextDrafts = { ...responseDrafts.value };
      delete nextDrafts[formId];
      responseDrafts.value = nextDrafts;
      setResponseError(formId, "");
      closeFormDetail();
    } catch (error) {
      console.error(error);
      submittingResponseFormId.value = null;
      setResponseError(formId, error?.message || "Could not submit. Please try again.");
    }
  }

  function openResponsesComingSoon() {
    window.alert("A full response viewer for form creators will be available in a future update.");
  }

  watch(
    () => session.value?.actor,
    (actor) => {
      if (!actor) {
        closeFormModal();
        resetFormDraft();
        detailFormId.value = null;
        responseDrafts.value = {};
        responseErrors.value = {};
        submittingResponseFormId.value = null;
        deletingFormId.value = null;
      }
    },
  );

  watch(isFormModalOpen, (open) => {
    if (!open) {
      formDefError.value = "";
    }
  });

  watch(draftInviteHandles, () => {
    formDefError.value = "";
  });

  return {
    isLoading,
    scopeFilter,
    completedForms,
    incompleteForms,
    formatDueDateTime,
    formatAssignmentSummary,
    detailForm,
    openFormDetail,
    closeFormDetail,
    isCreator,
    responseFor,
    isFormModalOpen,
    isSubmittingFormDef,
    formDefError,
    editingFormId,
    draftTitle,
    draftDescription,
    draftQuestion,
    draftDueLocal,
    draftInviteHandles,
    openNewFormModal,
    openEditFormModal,
    closeFormModal,
    submitFormDefinition,
    responseDraftFor,
    setResponseDraft,
    submitResponse,
    submittingResponseFormId,
    responseErrorFor,
    openResponsesComingSoon,
    nowMs,
    deletingFormId,
    confirmDeleteForm,
  };
}

export async function createFormsView() {
  const template = await loadTemplate(new URL("./view.html", import.meta.url).href);
  return {
    template,
    setup: formsSetup,
  };
}
