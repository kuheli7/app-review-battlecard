// App Store data: app lookup (iTunes Search/Lookup API) and recent reviews (public customer-reviews RSS feed).
import { log } from 'apify';

import { matchCandidates, normName, pickMatch } from './match.js';

const UA = 'Mozilla/5.0 (compatible; AppReviewBattlecard/1.0; +https://apify.com)';

export interface AppInfo {
    input: string;
    id: string;
    name: string;
    developer: string | null;
    url: string | null;
    icon: string | null;
    currentVersion: string | null;
    currentVersionReleaseDate: string | null;
    storeRating: number | null;
    ratingCount: number | null;
    /** Full store title, e.g. "Google Pay: Secure UPI payments". */
    storeTitle?: string;
    /** What the user typed when the app was found by name search; null for a URL, package name or ID. */
    typedName?: string | null;
    /** Other popular apps that also match the typed name (at least a quarter of the chosen app's ratings). */
    otherMatches?: string[];
}

export interface Review {
    id: string;
    rating: number;
    version: string | null;
    title: string;
    text: string;
    date: string;
    /** Google Play only: whether the developer replied to the review. */
    replied?: boolean;
}

async function getJson(url: string, retries = 2): Promise<any> {
    for (let attempt = 0; ; attempt++) {
        try {
            const res = await fetch(url, {
                headers: { 'User-Agent': UA, Accept: 'application/json,text/javascript,*/*' },
                signal: AbortSignal.timeout(20_000),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            // Apple serves the RSS JSON as text/javascript, so parse the text ourselves.
            return JSON.parse(await res.text());
        } catch (err) {
            if (attempt >= retries) throw err;
            await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        }
    }
}

/**
 * Short display name for an app. Store titles are long ("PhonePe UPI Payments, Loan App"), so keep the name the
 * user typed when the title starts with it as a whole word, otherwise cut the title at the first : - | or comma.
 */
export function displayName(title: string, typed: string | null): string {
    const t = title.trim();
    const want = typed ? normName(typed) : '';
    if (want.length >= 3) {
        // Walk the title until it covers the typed letters, ignoring spaces and punctuation, so "Phone pe" gives
        // "PhonePe" and "Uber Driver" gives "Uber Driver" (from "Uber - Driver: Drive & Deliver").
        let seen = '';
        for (let i = 0; i < t.length && seen.length < want.length; i++) {
            seen += normName(t.charAt(i));
            if (seen === want && !/[\p{L}\p{N}]/u.test(t.charAt(i + 1))) {
                return t.slice(0, i + 1).replace(/\s+[-–|]\s+|[:,]\s*/g, ' ').trim();
            }
        }
    }
    return t.split(/\s[-–|]\s|[:,|–]/)[0].trim() || t;
}

/** A store title cut to 40 characters, for short lists of other matches. */
export const clipTitle = (t: string): string => (t.length > 40 ? `${t.slice(0, 39).trim()}…` : t);

/** Accepts an App Store URL, a numeric app ID (optionally "id123..."), or an app name. */
export async function resolveApp(input: string, country: string): Promise<AppInfo> {
    const raw = input.trim();
    const m = raw.match(/id(\d{5,})/) ?? raw.match(/^(\d{5,})$/);
    let id = m ? m[1] : null;
    const typed = id ? null : raw;
    let otherMatches: string[] = [];

    if (!id) {
        const s = await getJson(
            `https://itunes.apple.com/search?term=${encodeURIComponent(raw)}&entity=software&country=${country}&limit=5`,
        );
        const results: any[] = s?.results ?? [];
        if (!results.length) throw new Error(`No App Store app found for "${raw}" in country "${country}"`);
        // Apple's search results include rating counts, so pick the most-rated candidate directly.
        const candidates = matchCandidates(
            raw,
            results.map((r) => ({ r, title: String(r.trackName ?? ''), ratings: typeof r.userRatingCount === 'number' ? r.userRatingCount : null })),
        );
        const pick = pickMatch(candidates)!;
        id = String(pick.chosen.r.trackId);
        otherMatches = pick.close.map((x) => clipTitle(x.title));
    }

    const l = await getJson(`https://itunes.apple.com/lookup?id=${id}&country=${country}`);
    const r = l?.results?.[0];
    if (!r) throw new Error(`App ID ${id} was not found in the "${country}" App Store`);
    return {
        input: raw,
        id: String(r.trackId ?? id),
        name: displayName(String(r.trackName ?? raw), typed),
        developer: r.sellerName ?? r.artistName ?? null,
        url: r.trackViewUrl ?? null,
        icon: r.artworkUrl100 ?? null,
        currentVersion: r.version ?? null,
        currentVersionReleaseDate: r.currentVersionReleaseDate ?? null,
        storeRating: typeof r.averageUserRating === 'number' ? Math.round(r.averageUserRating * 100) / 100 : null,
        ratingCount: typeof r.userRatingCount === 'number' ? r.userRatingCount : null,
        storeTitle: String(r.trackName ?? raw),
        typedName: typed,
        otherMatches,
    };
}

/** Most recent reviews, newest first. The feed gives 50 per page and at most 10 pages (500 reviews). */
export async function fetchReviews(appId: string, country: string, max: number): Promise<Review[]> {
    const pages = Math.min(10, Math.max(1, Math.ceil(max / 50)));
    // Apple's feed sometimes returns an empty page for one URL form and a full one for another,
    // so try both forms (twice) before giving up on a page.
    const urlForms = (p: number) => [
        `https://itunes.apple.com/${country}/rss/customerreviews/page=${p}/id=${appId}/sortBy=mostRecent/json`,
        `https://itunes.apple.com/rss/customerreviews/page=${p}/id=${appId}/sortby=mostrecent/json?cc=${country}`,
    ];
    const fetchPage = async (p: number) => {
        for (let round = 0; round < 2; round++) {
            for (const url of urlForms(p)) {
                const page = await getJson(url, 1).catch((err) => {
                    log.debug(`Review page ${p} for app ${appId} failed: ${(err as Error).message}`);
                    return null;
                });
                if (page?.feed?.entry) return page;
            }
        }
        return null;
    };
    const results = await Promise.all(Array.from({ length: pages }, async (_, i) => fetchPage(i + 1)));
    const empty = results.filter((r) => !r).length;
    if (empty) log.warning(`App Store feed returned ${empty} of ${pages} review pages empty for app ${appId}`);

    const seen = new Set<string>();
    const out: Review[] = [];
    for (const page of results) {
        let entries = page?.feed?.entry ?? [];
        if (!Array.isArray(entries)) entries = [entries];
        for (const e of entries) {
            const rating = Number(e?.['im:rating']?.label);
            if (!rating) continue; // the first entry of old feeds is app metadata, not a review
            const id = String(e?.id?.label ?? `${appId}-${out.length}`);
            if (seen.has(id)) continue;
            seen.add(id);
            out.push({
                id,
                rating,
                version: e?.['im:version']?.label ?? null,
                title: String(e?.title?.label ?? ''),
                text: String(e?.content?.label ?? ''),
                date: String(e?.updated?.label ?? ''),
            });
        }
    }
    out.sort((a, b) => b.date.localeCompare(a.date));
    return out.slice(0, max);
}
