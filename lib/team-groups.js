/**
 * Logical sub-groups within a team, derived from role / sport / gender squad.
 * Used for synced objects and local profile; not shown in the UI.
 *
 * Slugs are stable for future features and filtering.
 */

/** @typedef {"mens_team"|"womens_team"|"swim"|"dive"|"athletes"|"coaches"} TeamGroupSlug */

/** Canonical order for arrays stored on the wire. */
export const TEAM_GROUP_ORDER = /** @type {const} */ ([
  "mens_team",
  "womens_team",
  "swim",
  "dive",
  "athletes",
  "coaches",
]);

/**
 * Default per-team message channels (one Graffiti chat per slug).
 * `title` is the chat display name; `slug` matches roster derivation.
 */
export const TEAM_GROUP_CHAT_DEFINITIONS = /** @type {const} */ ([
  { slug: "womens_team", title: "WOMEN" },
  { slug: "mens_team", title: "MEN" },
  { slug: "swim", title: "SWIMMERS" },
  { slug: "dive", title: "DIVERS" },
  { slug: "athletes", title: "ATHLETES" },
  { slug: "coaches", title: "COACHES" },
]);

/** Labels for audience pickers (same slugs as `deriveTeamGroups`). */
export const TEAM_GROUP_PICKER_OPTIONS = TEAM_GROUP_CHAT_DEFINITIONS.map(({ slug, title }) => ({
  slug,
  label: title,
  key: `g:${slug}`,
}));

/**
 * Squad auto-channel slug from a Create Chat value, or null for custom chats.
 * Uses `defaultTeamGroupSlug` when present; otherwise matches known default titles (e.g. "WOMEN").
 */
export function defaultTeamGroupSlugFromChatCreateValue(v) {
  if (!v || v.activity !== "Create" || v.type !== "Chat") {
    return null;
  }
  const slug = v.defaultTeamGroupSlug;
  if (typeof slug === "string" && TEAM_GROUP_ORDER.includes(slug)) {
    return slug;
  }
  const title = String(v.title || "").trim();
  const def = TEAM_GROUP_CHAT_DEFINITIONS.find((d) => d.title === title);
  return def?.slug ?? null;
}

/**
 * Sort a list of visible chats so that the team-wide "ALL" chat stays first,
 * the auto-managed default team group chats (MEN, WOMEN, SWIMMERS, ...) are
 * pinned next in TEAM_GROUP_ORDER, and all remaining custom chats keep their
 * existing relative order (typically newest-first by published).
 *
 * @template T
 * @param {T[]} chats         Visible chats in their default order.
 * @param {string} directoryChannel  Channel id of the team-wide "ALL" chat.
 * @param {Map<string, { value?: any }>} latestCreateMap  Channel -> latest Create Chat object.
 * @returns {T[]}
 */
export function sortChatsWithPinnedDefaultGroups(chats, directoryChannel, latestCreateMap) {
  const allChat = chats.find((c) => c.channel === directoryChannel) ?? null;
  const pinned = [];
  const remaining = [];
  for (const chat of chats) {
    if (chat.channel === directoryChannel) {
      continue;
    }
    const latest = latestCreateMap?.get?.(chat.channel) ?? null;
    const slug = defaultTeamGroupSlugFromChatCreateValue(latest?.value);
    if (slug) {
      pinned.push({ chat, slug });
    } else {
      remaining.push(chat);
    }
  }
  pinned.sort((a, b) => {
    return TEAM_GROUP_ORDER.indexOf(a.slug) - TEAM_GROUP_ORDER.indexOf(b.slug);
  });

  const result = [];
  if (allChat) {
    result.push(allChat);
  }
  for (const { chat } of pinned) {
    result.push(chat);
  }
  for (const chat of remaining) {
    result.push(chat);
  }
  return result;
}

/**
 * @param {{ role?: string | null; sport?: string | null; team?: string | null }} input
 * @returns {TeamGroupSlug[]}
 */
export function deriveTeamGroups(input) {
  const role = input?.role ?? null;
  const sport = input?.sport ?? null;
  const team = input?.team ?? null;
  const set = new Set();
  if (role === "coach") {
    set.add("coaches");
  } else if (role === "athlete") {
    set.add("athletes");
    if (sport === "swimmer") {
      set.add("swim");
    }
    if (sport === "diver") {
      set.add("dive");
    }
    if (team === "men") {
      set.add("mens_team");
    }
    if (team === "women") {
      set.add("womens_team");
    }
  }
  return TEAM_GROUP_ORDER.filter((g) => set.has(g));
}
