import { TEAM_GROUP_ORDER } from "../../lib/team-groups.js";

export const DIRECTORY_CHANNEL = "main-channel-dftw";
export const DEFAULT_CHAT_TITLE = "ALL";

const TEAM_GROUP_SLUG_ENUM = [...TEAM_GROUP_ORDER];

/** Optional on join/roster payloads; matches `lib/team-groups.js` derivation. */
const TEAM_GROUPS_ARRAY_SCHEMA = {
  type: "array",
  items: {
    type: "string",
    enum: ["mens_team", "womens_team", "swim", "dive", "athletes", "coaches"],
  },
};

/** Graffiti discover schema for chat messages (objects posted to a chat channel). */
export const CHAT_MESSAGE_DISCOVER_SCHEMA = {
  properties: {
    value: {
      required: ["content", "published"],
      properties: {
        content: { type: "string" },
        published: { type: "number" },
      },
    },
  },
};

/** Graffiti discover schema for “Delete Chat” objects posted to the directory channel. */
export const CHAT_DELETE_DISCOVER_SCHEMA = {
  properties: {
    value: {
      required: ["activity", "type", "channel", "published"],
      properties: {
        activity: { const: "Delete" },
        type: { const: "Chat" },
        channel: { type: "string" },
        published: { type: "number" },
      },
    },
  },
};

/**
 * Posted by a coach to the team directory channel when the team is created.
 * Athletes use discover on this channel to confirm a team ID is real before joining.
 */
export const TEAM_MANIFEST_DISCOVER_SCHEMA = {
  properties: {
    value: {
      required: ["type", "teamId", "published"],
      properties: {
        type: { const: "TeamManifest" },
        teamId: { type: "string" },
        published: { type: "number" },
        /**
         * Human-readable team name chosen by the creating coach (e.g.
         * "MIT Swim and Dive"). Optional so legacy manifests without a name
         * remain valid; consumers should fall back to showing nothing.
         */
        teamName: { type: "string" },
      },
    },
  },
};

/** Someone asks to join the team; team owner must approve (JoinResolution). */
export const JOIN_REQUEST_DISCOVER_SCHEMA = {
  properties: {
    value: {
      required: ["type", "teamId", "status", "firstName", "lastName", "role", "published"],
      properties: {
        type: { const: "JoinRequest" },
        teamId: { type: "string" },
        status: { enum: ["pending"] },
        firstName: { type: "string" },
        lastName: { type: "string" },
        role: { enum: ["athlete", "coach"] },
        /** Athletes only; omitted on older requests or for coaches. */
        sport: { enum: ["swimmer", "diver"] },
        team: { enum: ["women", "men"] },
        published: { type: "number" },
        groups: TEAM_GROUPS_ARRAY_SCHEMA,
      },
    },
  },
};

/**
 * Posted by an existing team member who wants to change their approved role
 * (athlete↔coach) or their sport / squad team. The team owner reviews these
 * alongside join requests in the Manage Members page and posts a
 * `RoleChangeResolution` to approve or decline.
 *
 * `requestId` is a stable UUID per request so that the owner's resolution
 * can be matched back to a single request even if the member submits a new
 * one before the previous is resolved.
 */
export const ROLE_CHANGE_REQUEST_DISCOVER_SCHEMA = {
  properties: {
    value: {
      required: ["type", "teamId", "requestId", "role", "published"],
      properties: {
        type: { const: "RoleChangeRequest" },
        teamId: { type: "string" },
        requestId: { type: "string" },
        role: { enum: ["athlete", "coach"] },
        sport: { enum: ["swimmer", "diver"] },
        team: { enum: ["women", "men"] },
        firstName: { type: "string" },
        lastName: { type: "string" },
        groups: TEAM_GROUPS_ARRAY_SCHEMA,
        published: { type: "number" },
      },
    },
  },
};

/**
 * Posted by the team owner to approve or decline a `RoleChangeRequest`.
 * On approve, the new role/sport/team replace the member's roster entry on
 * the next roster sync (and on the member's local profile when discovered).
 */
export const ROLE_CHANGE_RESOLUTION_DISCOVER_SCHEMA = {
  properties: {
    value: {
      required: ["type", "teamId", "requestId", "requesterActor", "decision", "published"],
      properties: {
        type: { const: "RoleChangeResolution" },
        teamId: { type: "string" },
        requestId: { type: "string" },
        requesterActor: { type: "string" },
        decision: { enum: ["approved", "rejected"] },
        published: { type: "number" },
        /** Copied from the request on approve so teammates can update their view. */
        role: { enum: ["athlete", "coach"] },
        sport: { enum: ["swimmer", "diver"] },
        team: { enum: ["women", "men"] },
        groups: TEAM_GROUPS_ARRAY_SCHEMA,
      },
    },
  },
};

export const JOIN_RESOLUTION_DISCOVER_SCHEMA = {
  properties: {
    value: {
      required: ["type", "teamId", "requesterActor", "decision", "published"],
      properties: {
        type: { const: "JoinResolution" },
        teamId: { type: "string" },
        requesterActor: { type: "string" },
        decision: { enum: ["approved", "rejected"] },
        published: { type: "number" },
        /** Copied from the join request on approve so teammates can show names (join objects are not visible to them). */
        firstName: { type: "string" },
        lastName: { type: "string" },
        role: { enum: ["athlete", "coach"] },
        sport: { enum: ["swimmer", "diver"] },
        team: { enum: ["women", "men"] },
        groups: TEAM_GROUPS_ARRAY_SCHEMA,
      },
    },
  },
};

/**
 * Team directory objects used for the member list:
 * - `TeamMemberRoster` — owner-posted snapshot (`allowed` lists members so non-owners can read it).
 * - `TeamMemberDisplayName` — member-posted first/last updates (same channel; app filters by `type`).
 *
 * Both are combined in one discover schema so we only open one sync stream on this channel
 * (multiple parallel discovers on the same channel can stall `isFirstPoll` / app bootstrap).
 */
export const TEAM_MEMBER_ROSTER_DISCOVER_SCHEMA = {
  properties: {
    value: {
      required: ["type", "teamId", "published"],
      properties: {
        type: { enum: ["TeamMemberRoster", "TeamMemberDisplayName"] },
        teamId: { type: "string" },
        published: { type: "number" },
        members: {
          type: "array",
          items: {
            type: "object",
            required: ["actor"],
            properties: {
              actor: { type: "string" },
              firstName: { type: "string" },
              lastName: { type: "string" },
              role: { enum: ["athlete", "coach"] },
              sport: { enum: ["swimmer", "diver"] },
              team: { enum: ["women", "men"] },
              groups: TEAM_GROUPS_ARRAY_SCHEMA,
            },
          },
        },
        firstName: { type: "string" },
        lastName: { type: "string" },
      },
    },
  },
};

/** Graffiti discover schema for “Create Chat” objects posted to the directory channel. */
export const CHAT_CREATE_DISCOVER_SCHEMA = {
  properties: {
    value: {
      required: ["activity", "type", "channel", "title", "published"],
      properties: {
        activity: { const: "Create" },
        type: { const: "Chat" },
        channel: { type: "string" },
        title: { type: "string" },
        published: { type: "number" },
        memberActors: {
          type: "array",
          items: { type: "string" },
        },
        /** Auto-managed squad channels created with a new team. */
        defaultTeamGroupSlug: { enum: TEAM_GROUP_SLUG_ENUM },
        /** Picker state for custom chats (groups + members). */
        audienceKeys: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
  },
};

/** Shared “Links” tab: latest snapshot by `published` wins (posted to the directory channel). */
export const LINKS_BOARD_DISCOVER_SCHEMA = {
  properties: {
    value: {
      required: ["type", "sections", "published"],
      properties: {
        type: { const: "LinksBoard" },
        sections: { type: "array" },
        published: { type: "number" },
      },
    },
  },
};

/**
 * Calendar events on the directory channel.
 * Posts include `allowed` (organizer, plus invitees when listed). Legacy objects may have `restricted: false` (open).
 */
export const CALENDAR_EVENT_DISCOVER_SCHEMA = {
  properties: {
    value: {
      required: ["type", "id", "title", "date", "published"],
      properties: {
        type: { const: "CalendarEvent" },
        id: { type: "string" },
        title: { type: "string" },
        details: { type: "string" },
        date: { type: "string" },
        published: { type: "number" },
        time: { type: "string" },
        restricted: { type: "boolean" },
        memberActors: {
          type: "array",
          items: { type: "string" },
        },
        audienceKeys: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
  },
};

/**
 * Attendance excuses on the directory channel.
 * New submissions start in `status: "pending"` until a coach reviews them.
 */
export const ATTENDANCE_EXCUSE_DISCOVER_SCHEMA = {
  properties: {
    value: {
      required: ["type", "id", "date", "kind", "title", "details", "status", "published"],
      properties: {
        type: { const: "AttendanceExcuse" },
        id: { type: "string" },
        date: { type: "string" },
        kind: { enum: ["tardy", "absence"] },
        title: { type: "string" },
        details: { type: "string" },
        status: { enum: ["pending", "excused", "unexcused"] },
        published: { type: "number" },
      },
    },
  },
};

/**
 * Coach decisions on athlete attendance excuses (latest `published` per `excuseId` wins).
 * Stored separately from `AttendanceExcuse` so the athlete remains the canonical
 * author of the excuse and the coach's decision can simply overlay status.
 */
export const ATTENDANCE_DECISION_DISCOVER_SCHEMA = {
  properties: {
    value: {
      required: ["type", "excuseId", "status", "published"],
      properties: {
        type: { const: "AttendanceDecision" },
        excuseId: { type: "string" },
        status: { enum: ["pending", "excused", "unexcused"] },
        published: { type: "number" },
      },
    },
  },
};

/** Form definitions posted to the directory channel (visible to everyone). */
export const FORM_DEFINITION_DISCOVER_SCHEMA = {
  properties: {
    value: {
      required: ["type", "id", "title", "questionPrompt", "dueAt", "published"],
      properties: {
        type: { const: "FormDefinition" },
        id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        questionPrompt: { type: "string" },
        dueAt: { type: "number" },
        published: { type: "number" },
        /** If empty/missing, any signed-in member may see the form in the app. Otherwise only these actors (plus the creator). */
        assignedActors: {
          type: "array",
          items: { type: "string" },
        },
        assignedHandles: {
          type: "array",
          items: { type: "string" },
        },
        audienceKeys: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
  },
};

/** A user's submitted answer to a form (latest `published` per actor + formId wins). */
export const FORM_RESPONSE_DISCOVER_SCHEMA = {
  properties: {
    value: {
      required: ["type", "formId", "answer", "published"],
      properties: {
        type: { const: "FormResponse" },
        formId: { type: "string" },
        answer: { type: "string" },
        published: { type: "number" },
      },
    },
  },
};
