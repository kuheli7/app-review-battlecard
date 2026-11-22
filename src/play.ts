// Google Play data via the open-source google-play-scraper package: app search, app details and newest reviews.
import gplay from 'google-play-scraper';

import type { AppInfo, Review } from './apple.js';

const PKG = /^[a-zA-Z][\w]*(\.[\w]+)+$/;
// gplay.sort.NEWEST at runtime; the package's typings declare `sort` wrongly, so use the value directly.
const SORT_NEWEST = 2 as any;

async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await fn();
        } catch (err) {
            if (attempt >= retries) throw err;
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
    }
}

/** Accepts a Google Play URL, a package name (com.application.zomato) or an app name. */
export async function resolvePlayApp(input: string, country: string): Promise<AppInfo> {
    const raw = input.trim();
    const fromUrl = raw.match(/[?&]id=([\w.]+)/);
    let appId = fromUrl ? fromUrl[1] : PKG.test(raw) ? raw : null;

    if (!appId) {
        const results = await withRetry(async () => gplay.search({ term: raw, num: 5, country }));
        if (!results.length) throw new Error(`No Google Play app found for "${raw}" in country "${country}"`);
        // Prefer a result whose title starts with the search term, otherwise take Google's top hit.
        const term = raw.toLowerCase();
        const hit = results.find((r) => String(r.title ?? '').toLowerCase().startsWith(term)) ?? results[0];
        appId = hit.appId;
    }

    const a = await withRetry(async () => gplay.app({ appId: appId!, country }));
    const title = String(a.title ?? raw);
    return {
        input: raw,
        id: a.appId ?? appId,
        name: title.split(/[:\-–|]/)[0].trim() || title,
        developer: a.developer ?? null,
        url: a.url ?? `https://play.google.com/store/apps/details?id=${appId}`,
        icon: a.icon ?? null,
        currentVersion: a.version && a.version !== 'VARY' ? a.version : null,
        currentVersionReleaseDate: a.updated ? new Date(a.updated).toISOString() : null,
        storeRating: typeof a.score === 'number' ? Math.round(a.score * 100) / 100 : null,
        ratingCount: typeof a.ratings === 'number' ? a.ratings : null,
    };
}

/** Newest reviews first. Reviewer names and avatars are NOT stored. */
export async function fetchPlayReviews(appId: string, country: string, max: number, lang = 'en'): Promise<Review[]> {
    const res = await withRetry(async () =>
        gplay.reviews({ appId, sort: SORT_NEWEST, num: max, lang, country }),
    );
    const seen = new Set<string>();
    const out: Review[] = [];
    for (const r of res.data ?? []) {
        if (!r?.score || seen.has(r.id)) continue;
        seen.add(r.id);
        out.push({
            id: String(r.id),
            rating: Number(r.score),
            version: r.version ?? null,
            title: String(r.title ?? ''),
            text: String(r.text ?? ''),
            date: r.date ? new Date(r.date).toISOString() : '',
            replied: Boolean(r.replyText),
        });
    }
    out.sort((a, b) => b.date.localeCompare(a.date));
    return out.slice(0, max);
}
