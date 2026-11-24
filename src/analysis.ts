// Deterministic analysis: per-app stats, theme shares and the head-to-head comparison.
// The LLM only labels reviews and writes copy; every number comes from this file.
import type { Review } from './apple.js';

export const THEMES = [
    { code: 'BUGS', label: 'Crashes, bugs & app speed', owner: 'Engineering' },
    { code: 'PAYMENTS', label: 'Payments & refunds', owner: 'Payments & Support' },
    { code: 'FULFILMENT', label: 'Delivery & fulfilment (late, cancelled, missing, no-show)', owner: 'Operations' },
    { code: 'QUALITY', label: 'Product, food, service or content quality', owner: 'Operations & Partners' },
    { code: 'PRICING', label: 'Prices, fees & subscriptions', owner: 'Pricing & Growth' },
    { code: 'SUPPORT', label: 'Customer support', owner: 'Support' },
    { code: 'UX', label: 'App design, features & ads', owner: 'Product' },
    { code: 'ACCOUNT', label: 'Account, login & security', owner: 'Engineering' },
    { code: 'OTHER', label: 'Other', owner: '-' },
] as const;

export type ThemeCode = (typeof THEMES)[number]['code'];
export const THEME_CODES = THEMES.map((t) => t.code) as ThemeCode[];
export const themeLabel = (c: string) => THEMES.find((t) => t.code === c)?.label ?? c;
export const themeOwner = (c: string) => THEMES.find((t) => t.code === c)?.owner ?? '-';

const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : 0);

export interface ReleaseHealth {
    latestVersion: string;
    latestReviews: number;
    latestNegativeShare: number;
    previousVersion: string | null;
    previousReviews: number | null;
    previousNegativeShare: number | null;
    note: string;
}

export interface AppStats {
    reviewsAnalyzed: number;
    from: string | null;
    to: string | null;
    daysCovered: number;
    avgRatingRecent: number;
    starMix: Record<string, number>;
    negativeReviews: number;
    negativeShare: number;
    /** Google Play only: % of 1-2 star reviews the developer replied to. */
    replyRateToNegative: number | null;
    release: ReleaseHealth | null;
}

export const isNegative = (r: Review) => r.rating <= 2;

export function computeStats(reviews: Review[], currentVersion: string | null): AppStats {
    const n = reviews.length;
    const starMix: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    for (const r of reviews) starMix[String(r.rating)] = (starMix[String(r.rating)] ?? 0) + 1;
    const neg = reviews.filter(isNegative).length;
    const dates = reviews.map((r) => r.date).filter(Boolean).sort();
    const from = dates[0] ?? null;
    const to = dates[dates.length - 1] ?? null;
    const daysCovered =
        from && to ? Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) || 1) : 0;

    // Release health: negative share of the latest version vs the version before it (min 5 reviews each).
    const byVersion = new Map<string, { first: string; total: number; neg: number }>();
    for (const r of reviews) {
        if (!r.version) continue;
        const v = byVersion.get(r.version) ?? { first: r.date, total: 0, neg: 0 };
        v.total++;
        if (isNegative(r)) v.neg++;
        if (r.date < v.first) v.first = r.date;
        byVersion.set(r.version, v);
    }
    const ordered = [...byVersion.entries()].filter(([, v]) => v.total >= 5).sort((a, b) => a[1].first.localeCompare(b[1].first));
    let release: ReleaseHealth | null = null;
    if (ordered.length) {
        let li = ordered.findIndex(([ver]) => ver === currentVersion);
        if (li < 0) li = ordered.length - 1;
        const [lv, l] = ordered[li];
        const prev = li > 0 ? ordered[li - 1] : null;
        const ls = pct(l.neg, l.total);
        const ps = prev ? pct(prev[1].neg, prev[1].total) : null;
        let note = `v${lv}: ${ls}% of ${l.total} reviews are 1–2★.`;
        if (prev && ps !== null) {
            const diff = Math.round((ls - ps) * 10) / 10;
            const trend = Math.abs(diff) < 5 ? 'about the same as' : diff > 0 ? 'worse than' : 'better than';
            note = `v${lv} is ${trend} v${prev[0]}: ${ls}% vs ${ps}% of reviews are 1–2★ (${l.total} vs ${prev[1].total} reviews).`;
        }
        release = {
            latestVersion: lv,
            latestReviews: l.total,
            latestNegativeShare: ls,
            previousVersion: prev ? prev[0] : null,
            previousReviews: prev ? prev[1].total : null,
            previousNegativeShare: ps,
            note,
        };
    }

    return {
        reviewsAnalyzed: n,
        from,
        to,
        daysCovered,
        avgRatingRecent: n ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / n) * 100) / 100 : 0,
        starMix,
        negativeReviews: neg,
        negativeShare: pct(neg, n),
        replyRateToNegative: reviews.some((r) => r.replied !== undefined)
            ? pct(reviews.filter((r) => isNegative(r) && r.replied).length, neg)
            : null,
        release,
    };
}

export interface ThemeResult {
    /** Negative reviews sent to the AI. */
    sampled: number;
    /** Negative reviews the AI returned a label for. */
    classified: number;
    /** Labelled reviews with a concrete complaint (classified minus OTHER). Theme shares use this as the base. */
    concrete: number;
    counts: Record<string, number>;
    shares: Record<string, number>;
    quotes: Record<string, string[]>;
}

function trimQuote(r: Review): string {
    const body = (r.text || r.title).replace(/\s+/g, ' ').trim();
    return body.length > 200 ? `${body.slice(0, 197).trimEnd()}…` : body;
}

// Quotes go on screen in reports and demos, so skip reviews with abuse (English and common Hindi/Hinglish).
// "bc"/"mc" are whole-word only, so "bcz"/"bcoz" (because) still pass.
const BAD_WORDS =
    /\b(fuck|shit|bitch|bastard|asshole|chutiya|chutia|madarchod|behenchod|bhenchod|benchod|gaand|gandu|harami|haramkhor|kamina|kamine|bhosdi|bhosda|lavde|lawde|lodu|randi|bsdk|bkl)\w*|\b(bc|mc|saala|saale)\b|\bma+ ?ki\b|\bma ?bhen/i;
export const isQuotable = (q: string) => q.length >= 25 && !BAD_WORDS.test(q);
// Concrete details make a quote useful evidence: money, time, an order, a refund, an OTP, a driver...
const CONCRETE =
    /₹|\brs\.?\s?\d|\binr\b|\d+\s?(?:mins?|minutes?|hrs?|hours?|days?)\b|\brefund|\botp\b|\border|\bdeliver|\bpayment|\bpaid\b|\bdebit|\bcharg|\bcancel|\bdriver|\brider|\bcaptain|\bcustomer (?:care|support|service)|\bsupport\b|\bitems?\b|\bmissing|\bcrash|\blog ?in\b|\baccount|\bwallet|\bupi\b|\bbank|\bcoupon|\bfees?\b|\bprices?\b|\bsubscri|\bads?\b|\bupdate|\bfood\b|\bcold\b|\bstale|\bspill|\bwrong\b|\blate\b/gi;
// Generic pleading or venting says nothing a team can act on ("please improve", "worst app").
const GENERIC =
    /\b(?:please|pls|plz|kindly)\s+(?:improve|fix|look|do something|update)|\bworst (?:app|service|experience)|\bvery (?:bad|poor)\b|\bbad (?:app|service|experience)|\bpathetic|\buseless|\bdo(?:n'?t| not) (?:download|install|use)|\bwaste of (?:time|money)|\bnot good\b|\bhate (?:this|it)\b/gi;

/** Higher = a more specific, quotable complaint. Medium length breaks ties (readable on a slide). */
export function quoteScore(q: string): number {
    const concrete = new Set((q.match(CONCRETE) ?? []).map((m) => m.toLowerCase().replace(/\d+/g, '#'))).size;
    const generic = (q.match(GENERIC) ?? []).length;
    return 2 * Math.min(concrete, 4) + (/\d/.test(q) ? 1 : 0) - 2 * generic - Math.abs(q.length - 120) / 60;
}

const pickQuotes = (rs: Review[], n: number) =>
    [...new Set(rs.map(trimQuote).filter(isQuotable))]
        .map((q, i) => ({ q, s: quoteScore(q), i }))
        .sort((a, b) => b.s - a.s || a.i - b.i)
        .slice(0, n)
        .map((x) => x.q);

/** Turns LLM labels (review id -> theme code) into counts, shares and real quotes picked in code. */
export function computeThemes(negReviews: Review[], labels: Map<string, ThemeCode>): ThemeResult {
    const counts: Record<string, number> = Object.fromEntries(THEME_CODES.map((c) => [c, 0]));
    const buckets: Record<string, Review[]> = Object.fromEntries(THEME_CODES.map((c) => [c, []]));
    let classified = 0;
    for (const r of negReviews) {
        const code = labels.get(r.id);
        if (!code) continue;
        classified++;
        counts[code]++;
        buckets[code].push(r);
    }
    // Vague reviews ("bad", "ok", a thumbs-up with 1 star) are OTHER. They are left out of the base, so an app with
    // many vague reviews does not look better on every theme. OTHER's own share is of all labelled reviews.
    const concrete = classified - counts.OTHER;
    const shares: Record<string, number> = {};
    const quotes: Record<string, string[]> = {};
    for (const c of THEME_CODES) {
        shares[c] = c === 'OTHER' ? pct(counts[c], classified) : pct(counts[c], concrete);
        quotes[c] = pickQuotes(buckets[c], 2);
    }
    return { sampled: negReviews.length, classified, concrete, counts, shares, quotes };
}

export interface Gap {
    theme: ThemeCode;
    themeLabel: string;
    owner: string;
    rival: string;
    yourShare: number;
    rivalShare: number;
    yourCount: number;
    rivalCount: number;
    gapPoints: number;
    /** How sure we are that the gap is not sampling noise (two-proportion z-test on the labelled reviews). */
    confidence: Confidence;
    quotes: string[];
}

export type Confidence = 'high' | 'medium' | 'low';

/**
 * Two-proportion z-test: is theme share c1/n1 really different from c2/n2, or could the gap be chance?
 * high = |z| >= 1.96 (about 95% sure), medium = |z| >= 1.28 (about 80%), otherwise low.
 */
export function gapConfidence(c1: number, n1: number, c2: number, n2: number): Confidence {
    // The z-test is unreliable on tiny samples, so fewer than 15 specific complaints on either side is always low.
    if (n1 < 15 || n2 < 15) return 'low';
    const p = (c1 + c2) / (n1 + n2);
    const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
    if (!se) return 'low';
    const z = Math.abs(c1 / n1 - c2 / n2) / se;
    return z >= 1.96 ? 'high' : z >= 1.28 ? 'medium' : 'low';
}

export interface Competitor {
    name: string;
    themes: ThemeResult;
}

/**
 * Opportunities: themes where a rival's users complain much more than yours (rival share - your share).
 * Threats: themes where your users complain much more than a rival's. One entry per theme, biggest gap first.
 */
export function findGaps(you: Competitor, rivals: Competitor[], limit = 3): { opportunities: Gap[]; threats: Gap[] } {
    const opp: Gap[] = [];
    const thr: Gap[] = [];
    for (const theme of THEME_CODES) {
        if (theme === 'OTHER') continue;
        for (const rv of rivals) {
            const ys = you.themes.shares[theme];
            const rs = rv.themes.shares[theme];
            const base = {
                theme,
                themeLabel: themeLabel(theme),
                owner: themeOwner(theme),
                rival: rv.name,
                yourShare: ys,
                rivalShare: rs,
                yourCount: you.themes.counts[theme],
                rivalCount: rv.themes.counts[theme],
                confidence: gapConfidence(
                    you.themes.counts[theme],
                    you.themes.concrete,
                    rv.themes.counts[theme],
                    rv.themes.concrete,
                ),
            };
            if (rs - ys >= 3 && rv.themes.counts[theme] >= 2) {
                opp.push({ ...base, gapPoints: Math.round((rs - ys) * 10) / 10, quotes: rv.themes.quotes[theme] });
            }
            if (ys - rs >= 3 && you.themes.counts[theme] >= 2) {
                thr.push({ ...base, gapPoints: Math.round((ys - rs) * 10) / 10, quotes: you.themes.quotes[theme] });
            }
        }
    }
    const pick = (arr: Gap[]) => {
        const seen = new Set<string>();
        return arr
            .sort((a, b) => b.gapPoints - a.gapPoints)
            .filter((g) => (seen.has(g.theme) ? false : (seen.add(g.theme), true)))
            .slice(0, limit);
    };
    return { opportunities: pick(opp), threats: pick(thr) };
}

export interface SwitchingSignal {
    app: string;
    mentions: string;
    count: number;
    negativeReviews: number;
    quotes: string[];
}

/** 1-2 star reviews of `app` that mention another compared app by name (plain text match, no AI). */
export function switchingSignals(app: string, negReviews: Review[], otherApps: string[]): SwitchingSignal[] {
    const out: SwitchingSignal[] = [];
    for (const other of otherApps) {
        const word = other.split(/\s+/)[0];
        if (word.length < 3 || /^(the|my|app|get|go|new)$/i.test(word)) continue;
        // "BigBasket" also matches "big basket".
        const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`);
        const pattern = escaped.replace(/([a-z])([A-Z])/g, (_m, a: string, b: string) => `${a}\\s?${b}`);
        const rx = new RegExp(`\\b${pattern}\\b`, 'i');
        const hits = negReviews.filter((r) => rx.test(`${r.title} ${r.text}`));
        if (hits.length) {
            out.push({ app, mentions: other, count: hits.length, negativeReviews: negReviews.length, quotes: pickQuotes(hits, 2) });
        }
    }
    return out;
}

export interface NamedIssue {
    title: string;
    theme: ThemeCode;
    themeLabel: string;
    owner: string;
    count: number;
    shareOfNegative: number;
    inCurrentVersion: number | null;
    quotes: string[];
}

/** Turns AI-named issues (title, theme, review ids) into counted, quoted issues. Counting is done here, not by the AI. */
export function computeIssues(
    negReviews: Review[],
    defs: { title: string; theme: string; reviewIds: string[] }[],
    currentVersion: string | null,
): NamedIssue[] {
    const byId = new Map(negReviews.map((r) => [r.id, r]));
    const seenTitles = new Set<string>();
    const kept = defs
        .map((d) => {
            const theme = (THEME_CODES.includes(d.theme as ThemeCode) ? d.theme : 'OTHER') as ThemeCode;
            const rs = [...new Set(d.reviewIds)].map((id) => byId.get(id)).filter((r): r is Review => Boolean(r));
            return { title: d.title.replace(/\s+/g, ' ').trim().slice(0, 90), theme, rs };
        })
        .filter((i) => {
            const key = i.title.toLowerCase();
            if (!i.title || i.theme === 'OTHER' || i.rs.length < 2 || seenTitles.has(key)) return false;
            seenTitles.add(key);
            return true;
        })
        .sort((a, b) => b.rs.length - a.rs.length)
        .slice(0, 6);
    // A review can describe several issues; show each quote only once across the table.
    const usedQuotes = new Set<string>();
    return kept.map((i) => {
        const quotes = pickQuotes(i.rs, 10).filter((q) => !usedQuotes.has(q)).slice(0, 2);
        quotes.forEach((q) => usedQuotes.add(q));
        return {
            title: i.title,
            theme: i.theme,
            themeLabel: themeLabel(i.theme),
            owner: themeOwner(i.theme),
            count: i.rs.length,
            shareOfNegative: pct(i.rs.length, negReviews.length),
            inCurrentVersion: currentVersion ? i.rs.filter((r) => r.version === currentVersion).length : null,
            quotes,
        };
    });
}

/** Share of review ids that got the same theme in two independent labelling passes. */
export function labelAgreement(a: Map<string, string>, b: Map<string, string>): { checked: number; agreed: number; share: number } {
    let checked = 0;
    let agreed = 0;
    for (const [id, code] of b) {
        const first = a.get(id);
        if (!first) continue;
        checked++;
        if (first === code) agreed++;
    }
    return { checked, agreed, share: pct(agreed, checked) };
}
