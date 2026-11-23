// Picks which store app a typed name means. Pure functions, so they are unit-tested without the network.

/** Lowercase letters and digits only, so "Big basket" matches "bigbasket" and "Phone pe" matches "PhonePe". */
export const normName = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * The apps worth considering for a typed name, in store order.
 * - No title starts with the name (a typo like "Swigy"): the store's top result only.
 * - Several words ("Swiggy Delivery Partner"): the name is specific, so only titles that start with it.
 * - One word: it may be a nickname ("GPay", "jio"), so the store's top result competes with the titles
 *   that start with it.
 */
export function matchCandidates<T extends { title: string }>(typed: string, results: T[]): T[] {
    if (!results.length) return [];
    const n = normName(typed);
    const prefix = n ? results.filter((r) => normName(r.title).startsWith(n)) : [];
    if (!prefix.length) return [results[0]];
    if (/\s/.test(typed.trim())) return prefix;
    return [results[0], ...prefix.filter((r) => r !== results[0])];
}

/** Another candidate counts as a close match when it has at least this share of the chosen app's ratings. */
const CLOSE_SHARE = 0.25;

/**
 * Picks the candidate with the most ratings; ties keep store order. "GPay" then means Google Pay
 * (12.5M ratings), not a small app titled "gpay" (355), and "Swiggy" still means the customer app,
 * not "Swiggy Delivery Partner". Also returns the other candidates popular enough to be what the user meant.
 * If any candidate's rating count failed to load (`failed`), popularity can't be trusted (Swiggy's own app
 * failing would hand the win to its partner app), so the first candidate is used: the store's top result
 * when it is a candidate.
 */
export function pickMatch<T extends { ratings: number | null; failed?: boolean }>(candidates: T[]): { chosen: T; close: T[] } | null {
    if (!candidates.length) return null;
    if (candidates.some((c) => c.failed)) return { chosen: candidates[0], close: [] };
    let chosen = candidates[0];
    for (const c of candidates) if ((c.ratings ?? 0) > (chosen.ratings ?? 0)) chosen = c;
    const top = chosen.ratings ?? 0;
    const close = candidates.filter((c) => c !== chosen && top > 0 && (c.ratings ?? 0) >= top * CLOSE_SHARE);
    return { chosen, close };
}

/**
 * One line telling the user what a typed name was matched to, or null when it is obvious
 * (the title starts with the typed name and no other popular app matches).
 */
export function matchNote(a: {
    typedName?: string | null;
    storeTitle?: string;
    developer: string | null;
    otherMatches?: string[];
}): string | null {
    if (!a.typedName || !a.storeTitle) return null;
    const others = a.otherMatches ?? [];
    if (normName(a.storeTitle).startsWith(normName(a.typedName)) && !others.length) return null;
    const by = a.developer ? ` by ${a.developer}` : '';
    const also = others.length ? ` (also similar: ${others.join(', ')})` : '';
    return `"${a.typedName}" = ${a.storeTitle}${by}${also}`;
}
