import { TeamAudienceMultiselect } from "./team-audience-multiselect.js";

/**
 * Label + TeamAudienceMultiselect with the same structure as Messages → Create chat,
 * so calendar/forms don’t wrap the picker in `.calendar-field` (which forces full-width
 * inputs and breaks checkboxes).
 */
const TeamAudienceFormField = {
  name: "TeamAudienceFormField",
  components: { TeamAudienceMultiselect },
  props: {
    modelValue: { type: Array, default: () => [] },
    members: { type: Array, default: () => [] },
    disabled: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
    idPrefix: { type: String, default: "aud" },
  },
  emits: ["update:modelValue"],
  template: `
    <div class="team-audience-form-field">
      <span class="create-chat-audience-label"><slot /></span>
      <team-audience-multiselect
        :model-value="modelValue"
        @update:modelValue="$emit('update:modelValue', $event)"
        :members="members"
        :disabled="disabled"
        :loading="loading"
        :id-prefix="idPrefix"
      />
    </div>
  `,
};

export { TeamAudienceFormField };
