import { ref, computed, reactive, watch } from "vue";
import { useGraffitiSession, useGraffitiActorToHandle } from "@graffiti-garden/wrapper-vue";
import { loadTemplate } from "../../lib/load-template.js";

function teamProfileStorageKey(actor) {
  return `chatapp.teamProfile.v1:${actor}`;
}

function defaultTeamProfile() {
  return {
    role: null,
    sport: null,
    team: null,
    pendingApproval: false,
  };
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

function labelRole(role) {
  if (role === "athlete") {
    return "Athlete";
  }
  if (role === "coach") {
    return "Coach";
  }
  return "Not set";
}

function labelSport(sport) {
  if (sport === "swimmer") {
    return "Swimmer";
  }
  if (sport === "diver") {
    return "Diver";
  }
  return "Not set";
}

function labelTeam(team) {
  if (team === "women") {
    return "Women";
  }
  if (team === "men") {
    return "Men";
  }
  return "Not set";
}

function profileSetup() {
  const session = useGraffitiSession();

  const { handle: graffitiHandle } = useGraffitiActorToHandle(
    () => session.value?.actor,
  );

  const handleFull = computed(() => {
    const handle = graffitiHandle.value;
    if (handle === undefined || handle === null) {
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

  const saved = ref(defaultTeamProfile());
  const draft = reactive(defaultTeamProfile());
  const editing = ref(false);

  function loadTeamProfile() {
    const actor = session.value?.actor;
    if (!actor) {
      saved.value = defaultTeamProfile();
      return;
    }
    try {
      const raw = localStorage.getItem(teamProfileStorageKey(actor));
      if (!raw) {
        saved.value = defaultTeamProfile();
        return;
      }
      saved.value = { ...defaultTeamProfile(), ...JSON.parse(raw) };
    } catch {
      saved.value = defaultTeamProfile();
    }
  }

  watch(
    () => session.value?.actor,
    () => {
      loadTeamProfile();
      editing.value = false;
      Object.assign(draft, defaultTeamProfile());
    },
    { immediate: true },
  );

  watch(
    () => draft.role,
    (role) => {
      if (!editing.value) {
        return;
      }
      if (role === "coach") {
        draft.sport = null;
        draft.team = null;
      }
    },
  );

  const roleDisplay = computed(() => labelRole(saved.value.role));
  const sportDisplay = computed(() => labelSport(saved.value.sport));
  const teamDisplay = computed(() => labelTeam(saved.value.team));

  function startEdit() {
    Object.assign(draft, saved.value);
    editing.value = true;
  }

  function cancelEdit() {
    editing.value = false;
  }

  function saveEdit() {
    if (!draft.role) {
      window.alert("Please choose whether you are an athlete or a coach.");
      return;
    }
    if (draft.role === "athlete") {
      if (!draft.sport || !draft.team) {
        window.alert("Athletes must choose both a sport and a team.");
        return;
      }
    }

    const actor = session.value?.actor;
    if (!actor) {
      return;
    }

    const next = {
      role: draft.role,
      sport: draft.role === "athlete" ? draft.sport : null,
      team: draft.role === "athlete" ? draft.team : null,
      pendingApproval: true,
    };

    localStorage.setItem(teamProfileStorageKey(actor), JSON.stringify(next));
    saved.value = next;
    editing.value = false;
  }

  return {
    handleDisplay,
    handleFull,
    saved,
    draft,
    editing,
    roleDisplay,
    sportDisplay,
    teamDisplay,
    startEdit,
    cancelEdit,
    saveEdit,
  };
}

export async function createProfileView() {
  const template = await loadTemplate(
    new URL("./profile.html", import.meta.url).href,
  );
  return {
    template,
    setup: profileSetup,
  };
}
