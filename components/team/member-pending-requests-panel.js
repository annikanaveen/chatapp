import { MemberHandle } from "../member/member-handle.js";

const MemberPendingRequestsPanel = {
  name: "MemberPendingRequestsPanel",
  components: { MemberHandle },
  props: {
    pendingRows: { type: Array, required: true },
    actingOn: { type: Object, required: true },
  },
  emits: ["approve", "reject"],
  template: `
    <section class="member-requests-section" aria-labelledby="requests-heading">
      <h2 id="requests-heading" class="member-requests-section-title">New requests</h2>
      <ul v-if="pendingRows.length > 0" class="member-requests-list">
        <li v-for="row in pendingRows" :key="row.requesterActor" class="member-requests-card">
          <div class="member-requests-card-main">
            <p class="member-requests-name">{{ row.displayName }}</p>
            <p class="member-requests-tags">
              {{ row.roleLabel }} · {{ row.sportLabel }} · {{ row.teamLabel }}
            </p>
            <p class="member-requests-handle" translate="no">
              @<member-handle :actor="row.requesterActor" :fallback="row.handleFallback" />
            </p>
          </div>
          <div class="member-requests-card-actions">
            <button
              type="button"
              class="member-requests-btn member-requests-btn--approve"
              :disabled="actingOn.has(row.requesterActor)"
              @click="$emit('approve', row.requesterActor)"
            >
              Approve
            </button>
            <button
              type="button"
              class="member-requests-btn member-requests-btn--reject"
              :disabled="actingOn.has(row.requesterActor)"
              @click="$emit('reject', row.requesterActor)"
            >
              Decline
            </button>
          </div>
        </li>
      </ul>
      <p v-else class="member-requests-empty">No pending requests.</p>
    </section>
  `,
};

export { MemberPendingRequestsPanel };
