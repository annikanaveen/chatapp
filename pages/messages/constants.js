export const DIRECTORY_CHANNEL = "main-channel-dftw";
export const DEFAULT_CHAT_TITLE = "ALL";

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
