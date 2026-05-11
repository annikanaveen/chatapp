import { ref, reactive, watch, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { useGraffiti, useGraffitiSession } from "@graffiti-garden/wrapper-vue";
import { loadTemplate } from "../../lib/load-template.js";
import {
  validateTeamIdExists,
  fetchTeamManifestCreatorActor,
} from "../../lib/team-validation.js";
import {
  loadUserTeamProfile,
  saveUserTeamProfile,
  generateTeamId,
  directoryChannelForTeamId,
  normalizeTeamIdInput,
} from "../../lib/user-team-profile.js";
import { copyPlainTextWithLegacyFallback } from "../../lib/copy-plain-text.js";
import { deriveTeamGroups } from "../../lib/team-groups.js";
import { postDefaultTeamGroupChats } from "../../lib/default-team-chats.js";

function onboardingSetup() {
  const graffiti = useGraffiti();
  const session = useGraffitiSession();
  const router = useRouter();

  const step = ref(0);
  const error = ref("");
  const isWorking = ref(false);

  const draft = reactive({
    firstName: "",
    lastName: "",
    role: null,
    sport: null,
    team: null,
    athleteTeamIdInput: "",
    coachJoinTeamIdInput: "",
    /** Human-readable team name the coach chooses when creating a new team. */
    coachTeamName: "",
  });

  /** Coach step 2: pick flow → create new team vs join existing. */
  const coachTeamPhase = ref("choose");

  const coachTeamId = ref("");

  const coachTeamIdJustCopied = ref(false);
  let coachTeamIdCopyResetTimer = null;

  function clearCoachTeamIdCopyTimer() {
    if (coachTeamIdCopyResetTimer) {
      clearTimeout(coachTeamIdCopyResetTimer);
      coachTeamIdCopyResetTimer = null;
    }
  }

  onUnmounted(() => {
    clearCoachTeamIdCopyTimer();
    coachTeamIdJustCopied.value = false;
  });

  function hydrateFromStorage(actor) {
    const p = loadUserTeamProfile(actor);
    draft.firstName = p.firstName || "";
    draft.lastName = p.lastName || "";
    draft.role = p.role;
    draft.sport = p.sport;
    draft.team = p.team;
    draft.athleteTeamIdInput = "";
    draft.coachJoinTeamIdInput = "";
    if (p.teamId && p.teamId !== "legacy" && !p.onboardingComplete && p.role === "coach") {
      coachTeamId.value = p.teamId;
      coachTeamPhase.value = "create";
    } else {
      coachTeamId.value = "";
      coachTeamPhase.value = "choose";
    }
  }

  /** After a join decline, show a message and return user to the team-ID step. */
  function consumeJoinDenialNoticeIfPresent(actor) {
    const p = loadUserTeamProfile(actor);
    if (!p.joinDeniedPendingOnboarding) {
      return;
    }
    saveUserTeamProfile(actor, { joinDeniedPendingOnboarding: false });
    error.value =
      "Your request to join that team was declined. You can enter a different team ID below.";
    if (p.role === "athlete") {
      step.value = 3;
      draft.athleteTeamIdInput = "";
    } else if (p.role === "coach") {
      step.value = 2;
      coachTeamPhase.value = "join";
      draft.coachJoinTeamIdInput = "";
      coachTeamId.value = "";
    }
  }

  watch(
    () => session.value?.actor,
    (actor) => {
      if (actor) {
        hydrateFromStorage(actor);
        consumeJoinDenialNoticeIfPresent(actor);
      }
    },
    { immediate: true },
  );

  watch(
    () => draft.role,
    (role) => {
      if (role === "coach") {
        draft.sport = null;
        draft.team = null;
      }
    },
  );

  function persistBasics() {
    const actor = session.value?.actor;
    if (!actor) {
      return;
    }
    saveUserTeamProfile(actor, {
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
      role: draft.role,
      sport: draft.role === "athlete" ? draft.sport : null,
      team: draft.role === "athlete" ? draft.team : null,
    });
  }

  function submitNames() {
    error.value = "";
    if (!draft.firstName.trim() || !draft.lastName.trim()) {
      error.value = "Please enter your first and last name.";
      return;
    }
    persistBasics();
    step.value = 1;
  }

  function submitRole() {
    error.value = "";
    if (!draft.role) {
      error.value = "Choose whether you are an athlete or a coach.";
      return;
    }
    persistBasics();
    step.value = 2;
    if (draft.role === "coach") {
      coachTeamPhase.value = coachTeamId.value ? "create" : "choose";
      draft.coachJoinTeamIdInput = "";
    }
  }

  function submitAthleteDetails() {
    error.value = "";
    if (!draft.sport || !draft.team) {
      error.value = "Choose both sport and team.";
      return;
    }
    persistBasics();
    step.value = 3;
  }

  async function createCoachTeam() {
    error.value = "";
    const actor = session.value?.actor;
    const sess = session.value;
    if (!actor || !sess) {
      return;
    }
    const teamName = String(draft.coachTeamName || "").trim();
    if (!teamName) {
      error.value = "Please enter a name for your team.";
      return;
    }
    isWorking.value = true;
    try {
      const teamId = generateTeamId();
      const directoryChannel = directoryChannelForTeamId(teamId);
      if (!directoryChannel) {
        error.value = "Could not create a team. Try again.";
        return;
      }
      try {
        await graffiti.post(
          {
            value: {
              type: "TeamManifest",
              teamId,
              teamName,
              published: Date.now(),
            },
            channels: [directoryChannel],
          },
          sess,
        );
      } catch (e) {
        console.error(e);
        error.value =
          e?.message ||
          "Could not register your team on the network. Check your connection and try again.";
        return;
      }
      await postDefaultTeamGroupChats(graffiti, sess, directoryChannel, actor);
      saveUserTeamProfile(actor, {
        teamId,
        directoryChannel,
        onboardingComplete: false,
      });
      coachTeamId.value = teamId;
    } finally {
      isWorking.value = false;
    }
  }

  function finishCoachOnboarding() {
    const actor = session.value?.actor;
    if (!actor || !coachTeamId.value) {
      return;
    }
    saveUserTeamProfile(actor, { onboardingComplete: true, pendingTeamJoin: false });
    router.replace({ name: "messages-directory" });
  }

  function selectCoachCreateTeam() {
    error.value = "";
    coachTeamPhase.value = "create";
  }

  function selectCoachJoinTeam() {
    error.value = "";
    coachTeamPhase.value = "join";
  }

  async function submitCoachJoin() {
    error.value = "";
    const actor = session.value?.actor;
    const sess = session.value;
    if (!actor || !sess) {
      return;
    }
    const normalized = normalizeTeamIdInput(draft.coachJoinTeamIdInput);
    if (!normalized) {
      error.value = "Enter a valid team ID (32 hex characters, with or without hyphens).";
      return;
    }
    const directoryChannel = directoryChannelForTeamId(normalized);
    if (!directoryChannel) {
      error.value = "Invalid team ID.";
      return;
    }
    isWorking.value = true;
    try {
      const exists = await validateTeamIdExists(graffiti, sess, normalized);
      if (!exists) {
        error.value =
          "No team found with that ID. Check the ID or ask your head coach for the correct team ID.";
        return;
      }
      await submitJoinRequestAfterValidation(normalized, directoryChannel);
    } finally {
      isWorking.value = false;
    }
  }

  async function submitAthleteJoin() {
    error.value = "";
    const actor = session.value?.actor;
    const sess = session.value;
    if (!actor || !sess) {
      return;
    }
    const normalized = normalizeTeamIdInput(draft.athleteTeamIdInput);
    if (!normalized) {
      error.value = "Enter a valid team ID (32 hex characters, with or without hyphens).";
      return;
    }
    const directoryChannel = directoryChannelForTeamId(normalized);
    if (!directoryChannel) {
      error.value = "Invalid team ID.";
      return;
    }
    isWorking.value = true;
    try {
      const exists = await validateTeamIdExists(graffiti, sess, normalized);
      if (!exists) {
        error.value =
          "No team found with that ID. Ask your coach for the correct ID or try again.";
        return;
      }
      await submitJoinRequestAfterValidation(normalized, directoryChannel);
    } finally {
      isWorking.value = false;
    }
  }

  async function submitJoinRequestAfterValidation(normalized, directoryChannel) {
    error.value = "";
    const actor = session.value?.actor;
    const sess = session.value;
    if (!actor || !sess) {
      return;
    }

    const creatorActor = await fetchTeamManifestCreatorActor(graffiti, sess, normalized);
    if (!creatorActor) {
      error.value = "Could not find the team owner. Try again.";
      return;
    }
    if (creatorActor === actor) {
      error.value =
        "You created this team ID. Continue from your coach setup, or enter a different team if you meant to join someone else.";
      return;
    }

    try {
      const joinValue = {
        type: "JoinRequest",
        teamId: normalized,
        status: "pending",
        firstName: draft.firstName.trim(),
        lastName: draft.lastName.trim(),
        role: draft.role,
        published: Date.now(),
        groups: deriveTeamGroups({
          role: draft.role,
          sport: draft.role === "athlete" ? draft.sport : null,
          team: draft.role === "athlete" ? draft.team : null,
        }),
      };
      if (draft.role === "athlete") {
        if (draft.sport) {
          joinValue.sport = draft.sport;
        }
        if (draft.team) {
          joinValue.team = draft.team;
        }
      }
      await graffiti.post(
        {
          value: joinValue,
          channels: [directoryChannel],
          allowed: [...new Set([creatorActor, actor])],
        },
        sess,
      );
    } catch (e) {
      console.error(e);
      error.value = e?.message || "Could not send join request. Try again.";
      return;
    }

    saveUserTeamProfile(actor, {
      teamId: normalized,
      directoryChannel,
      onboardingComplete: true,
      pendingTeamJoin: true,
    });
    router.replace({ name: "waiting-approval" });
  }

  async function copyTeamId() {
    const text = String(coachTeamId.value || "").trim();
    if (!text) {
      return;
    }
    const ok = await copyPlainTextWithLegacyFallback(text);
    if (!ok) {
      window.prompt("Copy team ID:", text);
      return;
    }
    clearCoachTeamIdCopyTimer();
    coachTeamIdJustCopied.value = true;
    coachTeamIdCopyResetTimer = setTimeout(() => {
      coachTeamIdJustCopied.value = false;
      coachTeamIdCopyResetTimer = null;
    }, 2000);
  }

  function goBack() {
    error.value = "";
    const actor = session.value?.actor;

    if (step.value === 2 && draft.role === "coach") {
      if (coachTeamPhase.value === "join") {
        draft.coachJoinTeamIdInput = "";
        coachTeamPhase.value = "choose";
        return;
      }
      if (coachTeamPhase.value === "create") {
        if (coachTeamId.value && actor) {
          saveUserTeamProfile(actor, {
            teamId: null,
            directoryChannel: null,
          });
          coachTeamId.value = "";
        }
        coachTeamPhase.value = "choose";
        return;
      }
      if (coachTeamPhase.value === "choose") {
        step.value = 1;
        return;
      }
    }

    if (step.value <= 0) {
      return;
    }
    step.value -= 1;
  }

  return {
    step,
    draft,
    error,
    isWorking,
    coachTeamPhase,
    coachTeamId,
    coachTeamIdJustCopied,
    submitNames,
    submitRole,
    submitAthleteDetails,
    selectCoachCreateTeam,
    selectCoachJoinTeam,
    createCoachTeam,
    finishCoachOnboarding,
    submitCoachJoin,
    submitAthleteJoin,
    copyTeamId,
    goBack,
  };
}

export async function createOnboardingView() {
  const template = await loadTemplate(
    new URL("./onboarding.html", import.meta.url).href,
  );
  return {
    template,
    setup: onboardingSetup,
  };
}
