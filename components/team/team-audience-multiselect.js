import { TEAM_GROUP_PICKER_OPTIONS } from "../../lib/team-groups.js";

const TeamAudienceMultiselect = {
  name: "TeamAudienceMultiselect",
  props: {
    modelValue: { type: Array, default: () => [] },
    members: { type: Array, default: () => [] },
    disabled: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
    idPrefix: { type: String, default: "aud" },
  },
  emits: ["update:modelValue"],
  data() {
    return {
      open: false,
    };
  },
  computed: {
    groupOptions() {
      return TEAM_GROUP_PICKER_OPTIONS;
    },
    selectedSet() {
      return new Set(this.modelValue || []);
    },
    panelId() {
      return `${this.idPrefix}-audience-panel`;
    },
    triggerId() {
      return `${this.idPrefix}-audience-trigger`;
    },
    triggerSummary() {
      if (this.loading) {
        return "Loading roster…";
      }
      const keys = this.modelValue || [];
      if (!keys.length) {
        return "Choose groups and members…";
      }
      const parts = [];
      for (const key of keys) {
        if (key.startsWith("g:")) {
          const slug = key.slice(2);
          const g = this.groupOptions.find((o) => o.slug === slug);
          parts.push(g?.label || slug);
        } else if (key.startsWith("m:")) {
          const actor = key.slice(2);
          const m = this.members.find((x) => x.actor === actor);
          parts.push(m?.displayName || actor.slice(0, 12));
        }
      }
      if (parts.length <= 2) {
        return parts.join(", ");
      }
      return `${parts.slice(0, 2).join(", ")} +${parts.length - 2} more`;
    },
  },
  mounted() {
    this._onDocClick = (e) => {
      if (!this.open || !this.$el) {
        return;
      }
      if (!this.$el.contains(e.target)) {
        this.open = false;
      }
    };
    this._onKeydown = (e) => {
      if (e.key === "Escape" && this.open) {
        this.open = false;
      }
    };
    document.addEventListener("click", this._onDocClick, true);
    document.addEventListener("keydown", this._onKeydown);
  },
  beforeUnmount() {
    document.removeEventListener("click", this._onDocClick, true);
    document.removeEventListener("keydown", this._onKeydown);
  },
  methods: {
    toggleDropdown() {
      if (this.disabled || this.loading) {
        return;
      }
      this.open = !this.open;
    },
    toggleKey(key) {
      if (this.disabled) {
        return;
      }
      const cur = new Set(this.modelValue || []);
      if (cur.has(key)) {
        cur.delete(key);
      } else {
        cur.add(key);
      }
      this.$emit("update:modelValue", [...cur]);
    },
    isOn(key) {
      return this.selectedSet.has(key);
    },
  },
  template: `
    <div
      class="team-audience-dropdown"
      :class="{ 'team-audience-dropdown--disabled': disabled, 'team-audience-dropdown--open': open }"
    >
      <button
        type="button"
        class="team-audience-dropdown-trigger"
        :id="triggerId"
        :disabled="disabled || loading"
        :aria-expanded="open ? 'true' : 'false'"
        :aria-controls="panelId"
        @click.stop="toggleDropdown"
      >
        <span class="team-audience-dropdown-trigger-text">{{ triggerSummary }}</span>
        <span class="team-audience-dropdown-chevron" aria-hidden="true">{{ open ? '▲' : '▼' }}</span>
      </button>

      <div
        v-show="open && !loading"
        :id="panelId"
        class="team-audience-dropdown-panel"
        role="group"
        :aria-labelledby="triggerId"
        @click.stop
      >
        <fieldset class="team-audience-fieldset">
          <legend class="team-audience-legend">Groups</legend>
          <ul class="team-audience-option-list" role="list">
            <li v-for="g in groupOptions" :key="g.key" class="team-audience-option-li">
              <label class="team-audience-check-label">
                <input
                  type="checkbox"
                  :checked="isOn(g.key)"
                  :disabled="disabled"
                  :id="idPrefix + '-g-' + g.slug"
                  @change="toggleKey(g.key)"
                />
                <span>{{ g.label }}</span>
              </label>
            </li>
          </ul>
        </fieldset>
        <fieldset class="team-audience-fieldset">
          <legend class="team-audience-legend">Members</legend>
          <p v-if="!members.length" class="team-audience-empty">No roster loaded yet.</p>
          <ul v-else class="team-audience-option-list team-audience-option-list--members" role="list">
            <li v-for="m in members" :key="m.actor" class="team-audience-option-li">
              <label class="team-audience-check-label">
                <input
                  type="checkbox"
                  :checked="isOn('m:' + m.actor)"
                  :disabled="disabled"
                  :id="idPrefix + '-m-' + m.actor"
                  @change="toggleKey('m:' + m.actor)"
                />
                <span>{{ m.displayName }}</span>
              </label>
            </li>
          </ul>
        </fieldset>
      </div>

      <p v-if="loading" class="team-audience-multiselect-loading"><em>Loading team roster…</em></p>
    </div>
  `,
};

export { TeamAudienceMultiselect };
