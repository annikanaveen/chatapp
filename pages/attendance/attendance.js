import { ref, computed, watch } from "vue";
import { useGraffiti, useGraffitiSession, useGraffitiDiscover } from "@graffiti-garden/wrapper-vue";
import { loadTemplate } from "../../lib/load-template.js";
import {
  ATTENDANCE_EXCUSE_DISCOVER_SCHEMA,
  ATTENDANCE_DECISION_DISCOVER_SCHEMA,
} from "../messages/constants.js";
import { useTeamDirectoryChannel } from "../../lib/use-team-directory-channel.js";
import { useViewerTeamRole } from "../../lib/use-viewer-team-role.js";

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function toIsoDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizeKind(s) {
  const v = String(s || "").trim().toLowerCase();
  return v === "tardy" ? "tardy" : "absence";
}

function normalizeStatus(s) {
  const v = String(s || "").trim().toLowerCase();
  if (v === "excused" || v === "unexcused" || v === "pending") {
    return v;
  }
  return "pending";
}

function sortByDateThenPublishedDesc(a, b) {
  const da = String(a?.value?.date || "");
  const db = String(b?.value?.date || "");
  if (da !== db) {
    // ISO dates sort lexicographically
    return db.localeCompare(da);
  }
  const pa = Number(a?.value?.published || 0);
  const pb = Number(b?.value?.published || 0);
  return pb - pa;
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

function formatSubmittedDate(published) {
  const ms = Number(published);
  if (!Number.isFinite(ms) || ms <= 0) {
    return "";
  }
  try {
    return new Date(ms).toLocaleDateString();
  } catch {
    return "";
  }
}

function formatExcuseForDate(isoDateStr) {
  const s = String(isoDateStr || "").trim();
  if (!s) {
    return "";
  }
  // Expecting YYYY-MM-DD; force local date to avoid UTC shift.
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    return s;
  }
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(year, monthIndex, day);
  if (Number.isNaN(d.getTime())) {
    return s;
  }
  try {
    // Example: "Mon, 5/2/26" in en-US; drop comma for "Mon 5/2/26"
    return d
      .toLocaleDateString(undefined, {
        weekday: "short",
        month: "numeric",
        day: "numeric",
        year: "2-digit",
      })
      .replace(",", "");
  } catch {
    return s;
  }
}

function attendanceSetup() {
  const graffiti = useGraffiti();
  const session = useGraffitiSession();
  const teamDirectory = useTeamDirectoryChannel();
  const { isCoach, rosterMembers } = useViewerTeamRole();

  const { objects: excuseObjectsRaw, isFirstPoll } = useGraffitiDiscover(
    () => [teamDirectory.value],
    ATTENDANCE_EXCUSE_DISCOVER_SCHEMA,
    () => session.value,
  );

  const { objects: decisionObjectsRaw, isFirstPoll: isDecisionFirstPoll } =
    useGraffitiDiscover(
      () => [teamDirectory.value],
      ATTENDANCE_DECISION_DISCOVER_SCHEMA,
      () => session.value,
    );

  const isLoading = computed(
    () => !!isFirstPoll.value || !!isDecisionFirstPoll.value,
  );

  /** Latest coach decision per excuse id (by `published`). */
  const latestDecisionByExcuseId = computed(() => {
    const all = Array.isArray(decisionObjectsRaw.value) ? decisionObjectsRaw.value : [];
    const byId = new Map();
    for (const o of all) {
      const v = o?.value;
      if (!v || v.type !== "AttendanceDecision") {
        continue;
      }
      const eid = String(v.excuseId || "").trim();
      if (!eid) {
        continue;
      }
      const pub = Number(v.published || 0);
      const prev = byId.get(eid);
      const prevPub = Number(prev?.value?.published || 0);
      if (!prev || pub > prevPub) {
        byId.set(eid, o);
      }
    }
    return byId;
  });

  /** Effective status: latest coach decision overlays the athlete-posted status. */
  function effectiveStatusFor(excuseObject) {
    const id = String(excuseObject?.value?.id || "").trim();
    const decision = id ? latestDecisionByExcuseId.value.get(id) : null;
    const decided = normalizeStatus(decision?.value?.status);
    if (decision && (decided === "excused" || decided === "unexcused" || decided === "pending")) {
      return decided;
    }
    return normalizeStatus(excuseObject?.value?.status);
  }

  /** All AttendanceExcuse objects on this team channel (any actor). */
  const allExcuseObjects = computed(() => {
    const all = Array.isArray(excuseObjectsRaw.value) ? excuseObjectsRaw.value : [];
    return all.filter((o) => o?.value?.type === "AttendanceExcuse");
  });

  /** Excuses posted by the signed-in actor. */
  const myExcuseObjects = computed(() => {
    const actor = session.value?.actor;
    if (!actor) {
      return [];
    }
    return allExcuseObjects.value.filter((o) => o?.actor === actor);
  });

  /** Excuses the viewer can act on (coach: everyone; athlete: their own). */
  const visibleExcuseObjects = computed(() => {
    return isCoach.value ? allExcuseObjects.value : myExcuseObjects.value;
  });

  const sortedVisibleExcuses = computed(() => {
    return [...pickLatestById(visibleExcuseObjects.value)].sort(
      sortByDateThenPublishedDesc,
    );
  });

  const pendingExcuses = computed(() =>
    sortedVisibleExcuses.value.filter((o) => effectiveStatusFor(o) === "pending"),
  );
  const excusedExcuses = computed(() =>
    sortedVisibleExcuses.value.filter((o) => effectiveStatusFor(o) === "excused"),
  );
  const unexcusedExcuses = computed(() =>
    sortedVisibleExcuses.value.filter((o) => effectiveStatusFor(o) === "unexcused"),
  );

  /** Roster row for the excuse's submitter (used in coach view to show a name). */
  function submitterDisplayNameFor(excuseObject) {
    const actor = String(excuseObject?.actor || "").trim();
    if (!actor) {
      return "";
    }
    const row = (rosterMembers.value || []).find((r) => r.actor === actor);
    if (row?.displayName) {
      return row.displayName;
    }
    const dot = actor.indexOf(".");
    return dot === -1 ? actor : actor.slice(0, dot) || actor;
  }

  const selectedStatusFilter = ref("pending");

  const isSubmitExcuseOpen = ref(false);
  const isSubmitting = ref(false);
  const submitError = ref("");
  const deletingId = ref(null);

  const editingId = ref(null);
  const editingStatus = ref("pending");

  const draftDate = ref(toIsoDate(new Date()));
  const draftKind = ref("absence");
  const draftTitle = ref("");
  const draftDetails = ref("");

  function resetDraft() {
    draftDate.value = toIsoDate(new Date());
    draftKind.value = "absence";
    draftTitle.value = "";
    draftDetails.value = "";
    submitError.value = "";
    editingId.value = null;
    editingStatus.value = "pending";
  }

  function openSubmitExcuseModal() {
    if (!session.value?.actor) {
      window.alert("Log in to submit an attendance excuse.");
      return;
    }
    if (isCoach.value) {
      window.alert("Coaches review excuses from athletes; they don't submit their own.");
      return;
    }
    resetDraft();
    isSubmitExcuseOpen.value = true;
  }

  function openEditExcuseModal(excuseObject) {
    if (!session.value?.actor) {
      window.alert("Log in to edit an attendance excuse.");
      return;
    }
    const actor = session.value.actor;
    if (excuseObject?.actor !== actor) {
      return;
    }
    const v = excuseObject?.value;
    if (!v?.id) {
      return;
    }
    submitError.value = "";
    editingId.value = String(v.id);
    editingStatus.value = normalizeStatus(v.status);
    draftDate.value = String(v.date || "").trim() || toIsoDate(new Date());
    draftKind.value = normalizeKind(v.kind);
    draftTitle.value = String(v.title || "");
    draftDetails.value = String(v.details ?? "");
    isSubmitExcuseOpen.value = true;
  }

  function closeSubmitExcuseModal() {
    isSubmitExcuseOpen.value = false;
    submitError.value = "";
  }

  async function postAttendanceExcusePayload({ excuseId, status, dateStr, kind, title, details }) {
    if (!session.value?.actor) {
      throw new Error("Not signed in.");
    }
    const value = {
      type: "AttendanceExcuse",
      id: excuseId || randomId(),
      date: String(dateStr || "").trim(),
      kind: normalizeKind(kind),
      title: String(title || "").trim(),
      details: String(details ?? "").trim(),
      status: normalizeStatus(status),
      published: Date.now(),
    };

    await graffiti.post(
      {
        value,
        channels: [teamDirectory.value],
      },
      session.value,
    );
  }

  async function deleteExcuseById(excuseId) {
    if (!session.value?.actor || !excuseId) {
      return false;
    }
    const matches = (myExcuseObjects.value || []).filter(
      (o) => o?.value?.type === "AttendanceExcuse" && o?.value?.id === excuseId,
    );
    deletingId.value = excuseId;
    try {
      for (const o of matches) {
        await graffiti.delete(o, session.value);
      }
      deletingId.value = null;
      return true;
    } catch (error) {
      console.error(error);
      deletingId.value = null;
      window.alert(error?.message || "Could not delete this excuse.");
      return false;
    }
  }

  async function confirmDeleteExcuse(excuseObject) {
    const id = String(excuseObject?.value?.id || "").trim();
    if (!id) {
      return;
    }
    const actor = session.value?.actor;
    if (!actor || excuseObject?.actor !== actor) {
      return;
    }
    const ok = window.confirm("Delete this attendance excuse? This cannot be undone.");
    if (!ok) {
      return;
    }
    await deleteExcuseById(id);
  }

  /** Coach action: post a decision overlay for the excuse. */
  const decidingId = ref(null);
  async function setDecisionStatus(excuseObject, nextStatus) {
    if (!session.value?.actor) {
      window.alert("Log in to update attendance.");
      return;
    }
    if (!isCoach.value) {
      return;
    }
    const excuseId = String(excuseObject?.value?.id || "").trim();
    if (!excuseId) {
      return;
    }
    const status = normalizeStatus(nextStatus);
    if (status === effectiveStatusFor(excuseObject)) {
      return;
    }
    decidingId.value = excuseId;
    try {
      await graffiti.post(
        {
          value: {
            type: "AttendanceDecision",
            excuseId,
            status,
            published: Date.now(),
          },
          channels: [teamDirectory.value],
        },
        session.value,
      );
    } catch (error) {
      console.error(error);
      window.alert(error?.message || "Could not update attendance. Please try again.");
    } finally {
      decidingId.value = null;
    }
  }

  async function submitExcuse() {
    if (!session.value?.actor) {
      submitError.value = "Log in to submit an excuse.";
      return;
    }
    if (isCoach.value) {
      submitError.value = "Coaches don't submit their own excuses.";
      return;
    }
    submitError.value = "";

    const dateStr = String(draftDate.value || "").trim();
    const title = String(draftTitle.value || "").trim();
    const kind = normalizeKind(draftKind.value);
    const details = String(draftDetails.value ?? "").trim();

    if (!dateStr) {
      submitError.value = "Please select a date.";
      return;
    }
    if (!title) {
      submitError.value = "Please add a short title / reason.";
      return;
    }

    isSubmitting.value = true;
    try {
      const excuseId = editingId.value || randomId();
      const status = editingId.value ? editingStatus.value : "pending";
      await postAttendanceExcusePayload({ excuseId, status, dateStr, kind, title, details });
      isSubmitting.value = false;
      isSubmitExcuseOpen.value = false;
      resetDraft();
    } catch (error) {
      console.error(error);
      isSubmitting.value = false;
      submitError.value = error?.message || "Could not submit this excuse. Please try again.";
    }
  }

  // If the user logs out while the modal is open, close it.
  watch(
    () => session.value?.actor,
    (actor) => {
      if (!actor) {
        closeSubmitExcuseModal();
        deletingId.value = null;
        resetDraft();
      }
    },
  );

  return {
    isLoading,
    isCoach,
    pendingExcuses,
    excusedExcuses,
    unexcusedExcuses,
    selectedStatusFilter,
    formatSubmittedDate,
    formatExcuseForDate,
    submitterDisplayNameFor,
    effectiveStatusFor,
    deletingId,
    decidingId,
    editingId,
    isSubmitExcuseOpen,
    isSubmitting,
    submitError,
    draftDate,
    draftKind,
    draftTitle,
    draftDetails,
    openSubmitExcuseModal,
    openEditExcuseModal,
    closeSubmitExcuseModal,
    confirmDeleteExcuse,
    submitExcuse,
    setDecisionStatus,
  };
}

export async function createAttendanceView() {
  const template = await loadTemplate(new URL("./view.html", import.meta.url).href);
  return {
    template,
    setup: attendanceSetup,
  };
}
