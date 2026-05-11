import { MemberHandle } from "../member/member-handle.js";
import { MemberDisplayName } from "../member/member-display-name.js";

const CurrentTeamMembersPanel = {
  name: "CurrentTeamMembersPanel",
  components: { MemberHandle, MemberDisplayName },
  props: {
    memberRows: { type: Array, required: true },
  },
  template: `
    <section class="member-requests-section" aria-labelledby="members-heading">
      <h2 id="members-heading" class="member-requests-section-title">Current members</h2>
      <ul v-if="memberRows.length > 0" class="member-requests-list">
        <li
          v-for="row in memberRows"
          :key="'m-' + row.requesterActor"
          class="member-requests-card member-requests-card--member"
        >
          <div class="member-requests-card-main">
            <p class="member-requests-name">
              <member-display-name
                :actor="row.requesterActor"
                :explicit-name="row.explicitDisplayName"
              />
              <span v-if="row.isOwner" class="member-requests-pill">Owner</span>
              <span v-if="row.isSelf" class="member-requests-pill">You</span>
            </p>
            <p class="member-requests-tags">
              {{ row.roleLabel }} · {{ row.sportLabel }} · {{ row.teamLabel }}
            </p>
            <p class="member-requests-handle" translate="no">
              @<member-handle :actor="row.requesterActor" :fallback="row.handleFallback" />
            </p>
          </div>
        </li>
      </ul>
      <p v-else class="member-requests-empty">No members listed yet.</p>
    </section>
  `,
};

export { CurrentTeamMembersPanel };
