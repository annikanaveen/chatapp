import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";
import { MemberHandle } from "../../components/member/member-handle.js";
import { loadTemplate } from "../../lib/load-template.js";
import {
  DIRECTORY_CHANNEL,
  CALENDAR_EVENT_DISCOVER_SCHEMA,
} from "../messages/constants.js";
import {
  getCachedHandleForActor,
  setCachedHandleForActor,
} from "../../lib/actor-handle-cache.js";

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

function uniqueActors(actors) {
  return [...new Set(actors)];
}

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function toIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Display stored "HH:mm" or "HH:mm:ss" (from `<input type="time">`) as 12-hour, e.g. 2:05pm. */
function formatTime12h(raw) {
  const s = String(raw ?? "").trim();
  if (!s) {
    return "";
  }
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) {
    return s;
  }
  let hour = parseInt(m[1], 10);
  const minute = m[2];
  if (Number.isNaN(hour) || hour < 0 || hour > 23) {
    return s;
  }
  const period = hour >= 12 ? "pm" : "am";
  hour %= 12;
  if (hour === 0) {
    hour = 12;
  }
  return `${hour}:${minute}${period}`;
}

/** Latest object per event id (edits post new objects with higher `published`). */
function dedupeEventsById(objects) {
  const byId = new Map();
  for (const obj of objects) {
    const v = obj.value;
    if (!v || v.type !== "CalendarEvent" || typeof v.id !== "string" || !v.id) {
      continue;
    }
    const pub = typeof v.published === "number" ? v.published : 0;
    const prev = byId.get(v.id);
    if (!prev || pub > (prev.value.published || 0)) {
      byId.set(v.id, obj);
    }
  }
  return [...byId.values()];
}

function eventIsRestricted(v) {
  if (!v || v.type !== "CalendarEvent") {
    return true;
  }
  if (v.restricted === false) {
    return false;
  }
  return true;
}

function monthIndex(year, month0) {
  return year * 12 + month0;
}

/** dir +1 = next month, -1 = previous */
function stepViewMonth(viewYear, viewMonth, dir) {
  if (dir > 0) {
    if (viewMonth.value === 11) {
      viewMonth.value = 0;
      viewYear.value += 1;
    } else {
      viewMonth.value += 1;
    }
  } else {
    if (viewMonth.value === 0) {
      viewMonth.value = 11;
      viewYear.value -= 1;
    } else {
      viewMonth.value -= 1;
    }
  }
}

/**
 * Slides the grid horizontally, swaps month mid-transition (carousel-style),
 * then completes the slide. dir matches step direction (+1 forward in time).
 */
async function slideOneMonthStep(gridEl, dir, applyMonthStep, halfMs) {
  if (!gridEl) {
    applyMonthStep();
    return;
  }
  const pxOut = -dir * 14;
  gridEl.style.transitionProperty = "transform";
  gridEl.style.transitionDuration = `${halfMs}ms`;
  gridEl.style.transitionTimingFunction = "cubic-bezier(0.25, 0.8, 0.25, 1)";
  gridEl.style.transform = `translateX(${pxOut}px)`;

  await new Promise((resolve) => {
    let settled = false;
    const finish = (ev) => {
      if (ev && ev.target !== gridEl) {
        return;
      }
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(tid);
      gridEl.removeEventListener("transitionend", onEnd);
      resolve();
    };
    const onEnd = (ev) => finish(ev);
    const tid = setTimeout(() => finish(), halfMs + 100);
    gridEl.addEventListener("transitionend", onEnd);
  });

  applyMonthStep();

  const pxIn = dir * 14;
  gridEl.style.transition = "none";
  gridEl.style.transform = `translateX(${pxIn}px)`;
  void gridEl.offsetHeight;
  gridEl.style.transitionProperty = "transform";
  gridEl.style.transitionDuration = `${halfMs}ms`;
  gridEl.style.transitionTimingFunction = "cubic-bezier(0.25, 0.8, 0.25, 1)";
  gridEl.style.transform = "translateX(0)";

  await new Promise((resolve) => {
    let settled = false;
    const finish = (ev) => {
      if (ev && ev.target !== gridEl) {
        return;
      }
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(tid);
      gridEl.removeEventListener("transitionend", onEnd);
      resolve();
    };
    const onEnd = (ev) => finish(ev);
    const tid = setTimeout(() => finish(), halfMs + 100);
    gridEl.addEventListener("transitionend", onEnd);
  });
}

function calendarSetup() {
  const graffiti = useGraffiti();
  const session = useGraffitiSession();

  const now = new Date();
  const viewYear = ref(now.getFullYear());
  const viewMonth = ref(now.getMonth());

  const calendarGridBodyRef = ref(null);
  const isJumpingToToday = ref(false);
  let jumpToTodayGeneration = 0;

  const {
    objects: calendarEventObjectsRaw,
    isFirstPoll: areCalendarEventsLoading,
  } = useGraffitiDiscover(
    [DIRECTORY_CHANNEL],
    CALENDAR_EVENT_DISCOVER_SCHEMA,
    () => session.value,
  );

  const dedupedEventObjects = computed(() =>
    dedupeEventsById(calendarEventObjectsRaw.value || []),
  );

  const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const monthLabel = computed(() => {
    const d = new Date(viewYear.value, viewMonth.value, 1);
    return d.toLocaleString(undefined, { month: "long", year: "numeric" });
  });

  const calendarCells = computed(() => {
    const y = viewYear.value;
    const m = viewMonth.value;
    const firstOfMonth = new Date(y, m, 1);
    const startPad = firstOfMonth.getDay();
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const dayIndex = 1 - startPad + i;
      const d = new Date(y, m, dayIndex);
      cells.push({
        iso: toIsoDate(d),
        dayOfMonth: d.getDate(),
        inCurrentMonth: d.getMonth() === m,
        isToday: isSameDay(d, new Date()),
      });
    }
    return cells;
  });

  const eventsByIso = computed(() => {
    const map = new Map();
    const list = dedupedEventObjects.value;
    for (const obj of list) {
      const v = obj.value;
      if (!v || v.type !== "CalendarEvent") {
        continue;
      }
      const iso = v.date;
      if (typeof iso !== "string" || !iso) {
        continue;
      }
      if (!map.has(iso)) {
        map.set(iso, []);
      }
      map.get(iso).push(obj);
    }
    for (const [, arr] of map) {
      arr.sort((a, b) => {
        const ta = a.value?.time || "";
        const tb = b.value?.time || "";
        if (ta !== tb) {
          return ta.localeCompare(tb);
        }
        return (a.value?.published || 0) - (b.value?.published || 0);
      });
    }
    return map;
  });

  function eventsOnDay(iso) {
    return eventsByIso.value.get(iso) || [];
  }

  function inviteActorsForDisplay(obj) {
    const v = obj.value;
    if (!v || !eventIsRestricted(v)) {
      return [];
    }
    const actors = v.memberActors;
    if (!Array.isArray(actors)) {
      return [];
    }
    const creator = obj.actor;
    return uniqueActors(actors).filter((a) => a !== creator);
  }

  function canEditEvent(obj) {
    return Boolean(session.value?.actor && obj.actor === session.value.actor);
  }

  function buildInviteHandlesFromObject(obj) {
    const parts = inviteActorsForDisplay(obj).map((a) => getCachedHandleForActor(a) || "");
    return parts.filter(Boolean).join(", ");
  }

  /** Compact chip label for a single-line day cell (title truncates; suffix stays short). */
  function calendarEventSuffix(obj) {
    const v = obj?.value;
    if (!v || v.type !== "CalendarEvent") {
      return "";
    }
    if (!eventIsRestricted(v)) {
      return "All";
    }
    const n = inviteActorsForDisplay(obj).length;
    if (n === 0) {
      return "You";
    }
    return `+${n}`;
  }

  const deletingUrl = ref(null);

  async function deleteEventById(eventId) {
    if (!session.value?.actor || !eventId) {
      return false;
    }
    const matches = (calendarEventObjectsRaw.value || []).filter(
      (o) =>
        o.value?.type === "CalendarEvent" &&
        o.value?.id === eventId &&
        o.actor === session.value.actor,
    );
    try {
      for (const o of matches) {
        deletingUrl.value = o.url;
        await graffiti.delete(o, session.value);
      }
      deletingUrl.value = null;
      return true;
    } catch (error) {
      console.error(error);
      deletingUrl.value = null;
      window.alert(error?.message || "Could not delete this event.");
      return false;
    }
  }

  /**
   * Posts a calendar event. `allowed` is always set to the organizer plus any invitees.
   * With no invitees, `allowed` is only the creator (private to that user).
   */
  async function postCalendarEventPayload({
    eventId,
    title,
    details,
    dateStr,
    timeTrimmed,
    inviteHandlesRaw,
  }) {
    if (!session.value?.actor) {
      throw new Error("Not signed in.");
    }

    const handles = parseInviteHandles(inviteHandlesRaw);
    const memberActors = [session.value.actor];

    for (const handle of handles) {
      const lookupHandle = normalizeGraffitiHandleForLookup(handle);
      let actor;
      try {
        actor = await graffiti.handleToActor(lookupHandle);
      } catch (error) {
        console.error(error);
        throw new Error(`Could not look up “${handle}”. Check your connection and try again.`);
      }
      if (actor == null) {
        throw new Error(`Unknown Graffiti username: “${handle}”`);
      }
      const short = clipHandleToShortLabel(lookupHandle) || clipHandleToShortLabel(handle);
      if (short) {
        setCachedHandleForActor(actor, short);
      }
      memberActors.push(actor);
    }

    const allowedMembers = uniqueActors(memberActors);

    const value = {
      type: "CalendarEvent",
      id: eventId,
      title: title.trim(),
      details: String(details ?? "").trim(),
      date: dateStr,
      published: Date.now(),
      restricted: true,
      memberActors: allowedMembers,
    };

    const t = String(timeTrimmed || "").trim();
    if (t) {
      value.time = t;
    }

    await graffiti.post(
      {
        value,
        channels: [DIRECTORY_CHANNEL],
        allowed: allowedMembers,
      },
      session.value,
    );
  }

  function prevMonth() {
    if (isJumpingToToday.value) {
      return;
    }
    stepViewMonth(viewYear, viewMonth, -1);
  }

  function nextMonth() {
    if (isJumpingToToday.value) {
      return;
    }
    stepViewMonth(viewYear, viewMonth, 1);
  }

  async function goToThisMonth() {
    const t = new Date();
    const ty = t.getFullYear();
    const tm = t.getMonth();
    const start = monthIndex(viewYear.value, viewMonth.value);
    const end = monthIndex(ty, tm);
    const delta = end - start;
    if (delta === 0 || isJumpingToToday.value) {
      return;
    }

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion) {
      viewYear.value = ty;
      viewMonth.value = tm;
      return;
    }

    jumpToTodayGeneration += 1;
    const gen = jumpToTodayGeneration;
    isJumpingToToday.value = true;

    const steps = Math.abs(delta);
    const dir = delta > 0 ? 1 : -1;
    const gridEl = calendarGridBodyRef.value;
    const halfMs = Math.max(26, Math.min(48, Math.floor(700 / Math.max(steps, 1))));

    try {
      for (let i = 0; i < steps; i++) {
        if (gen !== jumpToTodayGeneration) {
          return;
        }
        await slideOneMonthStep(
          gridEl,
          dir,
          () => stepViewMonth(viewYear, viewMonth, dir),
          halfMs,
        );
      }
    } finally {
      if (gen === jumpToTodayGeneration) {
        isJumpingToToday.value = false;
        if (gridEl) {
          gridEl.style.transition = "";
          gridEl.style.transform = "";
        }
      }
    }
  }

  const isAddEventOpen = ref(false);
  const newEventTitle = ref("");
  const newEventDetails = ref("");
  const newEventDate = ref(toIsoDate(new Date()));
  const newEventTime = ref("");
  const newEventInviteHandles = ref("");
  const eventCreateError = ref("");
  const isPostingEvent = ref(false);

  const isEventDetailOpen = ref(false);
  const detailEventObject = ref(null);
  const isEditingDetail = ref(false);
  const editTitle = ref("");
  const editDetails = ref("");
  const editDate = ref("");
  const editTime = ref("");
  const editInviteHandles = ref("");
  const detailError = ref("");
  const isSavingDetail = ref(false);

  const isAnyCalendarSaving = computed(
    () => isPostingEvent.value || isSavingDetail.value,
  );

  function openAddEventModal(isoDate) {
    eventCreateError.value = "";
    newEventTitle.value = "";
    newEventDetails.value = "";
    newEventDate.value = isoDate || toIsoDate(new Date());
    newEventTime.value = "";
    newEventInviteHandles.value = "";
    isAddEventOpen.value = true;
  }

  function closeAddEventModal() {
    if (isPostingEvent.value) {
      return;
    }
    isAddEventOpen.value = false;
  }

  function openEventDetail(obj) {
    detailError.value = "";
    isEditingDetail.value = false;
    detailEventObject.value = obj;
    isEventDetailOpen.value = true;
    syncEditDraftFromObject(obj);
  }

  function syncEditDraftFromObject(obj) {
    const v = obj?.value;
    if (!v) {
      return;
    }
    editTitle.value = String(v.title ?? "");
    editDetails.value = String(v.details ?? "");
    editDate.value = String(v.date ?? "");
    editTime.value = String(v.time ?? "");
    editInviteHandles.value = buildInviteHandlesFromObject(obj);
  }

  function closeEventDetail() {
    if (isSavingDetail.value) {
      return;
    }
    isEditingDetail.value = false;
    isEventDetailOpen.value = false;
    detailEventObject.value = null;
    detailError.value = "";
  }

  function startEditDetail() {
    if (!detailEventObject.value) {
      return;
    }
    syncEditDraftFromObject(detailEventObject.value);
    isEditingDetail.value = true;
    detailError.value = "";
  }

  function cancelEditDetail() {
    if (isSavingDetail.value) {
      return;
    }
    if (detailEventObject.value) {
      syncEditDraftFromObject(detailEventObject.value);
    }
    isEditingDetail.value = false;
    detailError.value = "";
  }

  watch(
    () => dedupedEventObjects.value,
    (objects) => {
      if (!detailEventObject.value || isEditingDetail.value) {
        return;
      }
      const id = detailEventObject.value.value?.id;
      if (!id) {
        return;
      }
      const latest = objects.find((o) => o.value?.id === id);
      if (latest) {
        detailEventObject.value = latest;
      }
    },
    { deep: true },
  );

  async function saveDetailEdit() {
    detailError.value = "";
    const obj = detailEventObject.value;
    if (!obj?.value?.id || !session.value?.actor) {
      return;
    }

    const title = editTitle.value.trim();
    if (!title) {
      detailError.value = "Enter a title.";
      return;
    }
    const dateStr = editDate.value;
    if (!dateStr) {
      detailError.value = "Pick a date.";
      return;
    }

    isSavingDetail.value = true;
    try {
      await postCalendarEventPayload({
        eventId: obj.value.id,
        title,
        details: editDetails.value,
        dateStr,
        timeTrimmed: editTime.value,
        inviteHandlesRaw: editInviteHandles.value,
      });
      isEditingDetail.value = false;
    } catch (error) {
      console.error(error);
      detailError.value =
        error?.message || "Could not save changes. Check your connection and try again.";
    } finally {
      isSavingDetail.value = false;
    }
  }

  async function confirmDeleteDetail() {
    const obj = detailEventObject.value;
    const id = obj?.value?.id;
    const title = obj?.value?.title || "event";
    if (!id || !canEditEvent(obj)) {
      return;
    }
    if (!window.confirm(`Delete “${title}”?`)) {
      return;
    }
    const ok = await deleteEventById(id);
    if (ok) {
      closeEventDetail();
    }
  }

  function onCalendarKeydown(event) {
    if (event.key !== "Escape") {
      return;
    }
    if (isSavingDetail.value || isPostingEvent.value) {
      return;
    }
    if (isEventDetailOpen.value) {
      closeEventDetail();
      return;
    }
    if (isAddEventOpen.value) {
      closeAddEventModal();
    }
  }

  onMounted(() => {
    window.addEventListener("keydown", onCalendarKeydown);
  });

  onUnmounted(() => {
    jumpToTodayGeneration += 1;
    isJumpingToToday.value = false;
    const gridEl = calendarGridBodyRef.value;
    if (gridEl) {
      gridEl.style.transition = "";
      gridEl.style.transform = "";
    }
    window.removeEventListener("keydown", onCalendarKeydown);
  });

  watch([newEventTitle, newEventDate, newEventInviteHandles], () => {
    eventCreateError.value = "";
  });

  async function submitNewEvent() {
    eventCreateError.value = "";
    if (!session.value?.actor) {
      eventCreateError.value = "Log in to create an event.";
      return;
    }

    const title = newEventTitle.value.trim();
    if (!title) {
      eventCreateError.value = "Enter a title.";
      return;
    }

    const dateStr = newEventDate.value;
    if (!dateStr) {
      eventCreateError.value = "Pick a date.";
      return;
    }

    isPostingEvent.value = true;
    try {
      await postCalendarEventPayload({
        eventId: randomId(),
        title,
        details: newEventDetails.value,
        dateStr,
        timeTrimmed: newEventTime.value,
        inviteHandlesRaw: newEventInviteHandles.value,
      });
      isAddEventOpen.value = false;
      newEventTitle.value = "";
      newEventDetails.value = "";
      newEventTime.value = "";
      newEventInviteHandles.value = "";
      newEventDate.value = toIsoDate(new Date());
    } catch (error) {
      console.error(error);
      eventCreateError.value =
        error?.message || "Could not save the event. Check your connection and try again.";
    } finally {
      isPostingEvent.value = false;
    }
  }

  const selectedEventValue = computed(() => detailEventObject.value?.value);

  return {
    weekdayLabels,
    monthLabel,
    calendarCells,
    eventsOnDay,
    inviteActorsForDisplay,
    calendarEventSuffix,
    formatTime12h,
    eventIsRestricted,
    canEditEvent,
    detailEventObject,
    selectedEventValue,
    isEventDetailOpen,
    isEditingDetail,
    editTitle,
    editDetails,
    editDate,
    editTime,
    editInviteHandles,
    detailError,
    isSavingDetail,
    isAnyCalendarSaving,
    openEventDetail,
    closeEventDetail,
    startEditDetail,
    cancelEditDetail,
    saveDetailEdit,
    confirmDeleteDetail,
    deletingUrl,
    calendarGridBodyRef,
    isJumpingToToday,
    prevMonth,
    nextMonth,
    goToThisMonth,
    areCalendarEventsLoading,
    isAddEventOpen,
    newEventTitle,
    newEventDetails,
    newEventDate,
    newEventTime,
    newEventInviteHandles,
    eventCreateError,
    isPostingEvent,
    openAddEventModal,
    closeAddEventModal,
    submitNewEvent,
  };
}

export async function createCalendarView() {
  const template = await loadTemplate(new URL("./view.html", import.meta.url).href);
  return {
    template,
    components: { MemberHandle },
    setup: calendarSetup,
  };
}
