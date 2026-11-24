// The battlecard's words. Every number on the card is written here, in code. The AI may only write short lines
// without numbers, and each line is checked before it is used; a line that fails gets a plain template instead.
// Pure functions, so they are unit-tested without the network.
import type { Confidence, Gap } from './analysis.js';

/** "1 opportunity", "2 opportunities". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Short theme names for sentences (the full labels are long and are shown on the cards already). */
const SHORT: Record<string, string> = {
    BUGS: 'crashes and bugs',
    PAYMENTS: 'payments and refunds',
    FULFILMENT: 'delivery and fulfilment',
    QUALITY: 'product or service quality',
    PRICING: 'prices and fees',
    SUPPORT: 'customer support',
    UX: 'app design, features and ads',
    ACCOUNT: 'login and account problems',
};
export const shortTheme = (code: string, label = code) => SHORT[code] ?? label.toLowerCase();

const rank = (c: Confidence) => (c === 'high' ? 2 : c === 'medium' ? 1 : 0);
/** Stronger evidence first, then the bigger gap. */
export const byStrength = (a: Gap, b: Gap) => rank(b.confidence) - rank(a.confidence) || b.gapPoints - a.gapPoints;

/**
 * The one-sentence verdict, built from the computed gaps (no AI). It leads with the stronger of the top threat and
 * the top opportunity that is not on your own fix-first list, names both apps next to their own number, and uses
 * one metric only: the share of each app's specific 1–2★ complaints.
 */
export function buildVerdict(you: string, opportunities: Gap[], threats: Gap[], fixFirstThemes: ReadonlySet<string> = new Set()): string {
    const thr = [...threats].sort(byStrength)[0];
    const opp = [...opportunities].filter((g) => !fixFirstThemes.has(g.theme)).sort(byStrength)[0];
    const lead = [thr && { g: thr, side: 'thr' as const }, opp && { g: opp, side: 'opp' as const }]
        .filter((x): x is { g: Gap; side: 'thr' | 'opp' } => Boolean(x))
        .sort((a, b) => byStrength(a.g, b.g))[0];
    if (!lead) {
        const blocked = [...opportunities].sort(byStrength)[0];
        if (blocked) {
            return `${blocked.rival}'s users complain more about ${shortTheme(blocked.theme, blocked.themeLabel)}, but it is also on your own fix-first list, so fix it before you advertise it.`;
        }
        return 'No clear complaint gap between these apps in this sample.';
    }
    const { g, side } = lead;
    const t = shortTheme(g.theme, g.themeLabel);
    const yours = `${g.yourShare}% of ${you}'s specific 1–2★ complaints`;
    const theirs = `${g.rivalShare}% of ${g.rival}'s`;
    if (g.confidence === 'low') {
        const [a, b] = side === 'thr' ? [yours, theirs] : [`${g.rivalShare}% of ${g.rival}'s specific 1–2★ complaints`, `${g.yourShare}% of ${you}'s`];
        return `No clear gap yet. The biggest difference is ${t} (${a} vs ${b}), but it rests on few complaints, so check again with more reviews.`;
    }
    return side === 'thr'
        ? `Biggest risk: ${yours} are about ${t}, vs ${theirs}. Fix this before marketing against rivals.`
        : `Biggest opening: ${g.rivalShare}% of ${g.rival}'s specific 1–2★ complaints are about ${t}, vs ${g.yourShare}% of ${you}'s. Lead with this in campaigns aimed at ${g.rival} users.`;
}

// "1–2★", "1-2 stars", "5 star" are allowed; any other digit in an AI line is a number the AI made up or moved.
const STAR_TEXT = /\b[1-5]\s*(?:[–-]\s*[1-5])?\s*(?:★|-?stars?\b)/gi;
// Marketing claims the review data cannot back up.
const CLAIM = /\b(guarantee\w*|always|instant\w*|fastest|quickest|cheapest|lowest|best|number one|no\.?\s?1|zero)\b|#\s?1\b/i;

/** Checks one AI line. Returns the cleaned line, or null and the reason it was rejected. */
export function vetLine(line: unknown, opts: { maxWords: number; noClaims?: boolean }): { text: string | null; reason?: string } {
    if (typeof line !== 'string' || !line.trim()) return { text: null, reason: 'missing' };
    const text = line.replace(/\s+/g, ' ').trim();
    if (/\d/.test(text.replace(STAR_TEXT, ''))) return { text: null, reason: `has a number: "${text}"` };
    if (opts.noClaims && CLAIM.test(text)) return { text: null, reason: `makes a claim the data can't back: "${text}"` };
    if (text.split(' ').length > opts.maxWords) return { text: null, reason: `too long: "${text}"` };
    return { text };
}

export interface AiOpportunity {
    theme?: unknown;
    headline?: unknown;
    message?: unknown;
}
export interface AiThreat {
    theme?: unknown;
    action?: unknown;
}

export interface CardCopy {
    headline: string;
    message?: string;
    action?: string;
    /** AI lines that were rejected and replaced by a template, with the reason. */
    rejected: string[];
}

/** Headline and message for an opportunity: the AI's lines when they pass the checks, a template otherwise. */
export function opportunityCopy(g: Gap, ai: AiOpportunity | undefined): CardCopy {
    const t = shortTheme(g.theme, g.themeLabel);
    const rejected: string[] = [];
    if (g.confidence === 'low') {
        // Few complaints: no marketing line at all, just say how thin the evidence is.
        return {
            headline: `Early sign: more of ${g.rival}'s complaints are about ${t}`,
            message: `Low confidence: this rests on ${g.rivalCount} of ${g.rival}'s specific complaints and ${g.yourCount} of yours. Check again with more reviews before using it.`,
            rejected,
        };
    }
    const h = vetLine(ai?.headline, { maxWords: 14 });
    const m = vetLine(ai?.message, { maxWords: 35, noClaims: true });
    if (ai && !h.text) rejected.push(`headline ${h.reason}`);
    if (ai && !m.text) rejected.push(`message ${m.reason}`);
    return {
        headline: h.text ?? `More of ${g.rival}'s complaints are about ${t}`,
        message: m.text ?? `Speak to ${g.rival} users who are frustrated with ${t}, and invite them to try you instead.`,
        rejected,
    };
}

/**
 * Headline and action for a threat. The headline is always a template: it must be about your app, and the AI
 * sometimes wrote it about the rival or got the direction wrong. The action is the AI's when it passes the checks.
 */
export function threatCopy(g: Gap, ai: AiThreat | undefined): CardCopy {
    const t = shortTheme(g.theme, g.themeLabel);
    const rejected: string[] = [];
    if (g.confidence === 'low') {
        return {
            headline: `Early sign: more of your complaints are about ${t} than ${g.rival}'s`,
            action: `Low confidence: this rests on ${g.yourCount} of your specific complaints and ${g.rivalCount} of ${g.rival}'s. Owner: ${g.owner}. Check again with more reviews before acting.`,
            rejected,
        };
    }
    const a = vetLine(ai?.action, { maxWords: 35 });
    if (ai && !a.text) rejected.push(`action ${a.reason}`);
    return {
        headline: `More of your complaints are about ${t} than ${g.rival}'s`,
        action: a.text ?? `Owner: ${g.owner}. Read the quoted complaints and fix the most common cause first.`,
        rejected,
    };
}
