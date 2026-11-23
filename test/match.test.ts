// Which store app a typed name means. Rating counts are real Google Play (India) numbers from 23 Nov 2026.
import { describe, expect, it } from 'vitest';

import { matchCandidates, matchNote, normName, pickMatch } from '../src/match.js';

type App = { title: string; ratings: number | null };
const app = (title: string, ratings: number | null): App => ({ title, ratings });
const resolveName = (typed: string, results: App[]) => pickMatch(matchCandidates(typed, results));

describe('normName', () => {
    it('ignores case, spaces and punctuation', () => {
        expect(normName('Big basket')).toBe('bigbasket');
        expect(normName('Uber - Driver')).toBe('uberdriver');
    });
});

describe('picking the app a name means', () => {
    it('picks the popular app for a nickname, not a tiny app with that exact title', () => {
        const results = [app('Google Pay: Secure UPI payments', 12538728), app('gpay', 355)];
        expect(resolveName('GPay', results)?.chosen.title).toBe('Google Pay: Secure UPI payments');
    });

    it('picks the customer app over partner apps with the same prefix', () => {
        const results = [
            app('Swiggy: Food Instamart Dineout', 13902190),
            app('Swiggy Delivery Partner App', 423251),
            app('Swiggy Partner App', 42843),
        ];
        const r = resolveName('Swiggy', results);
        expect(r?.chosen.title).toBe('Swiggy: Food Instamart Dineout');
        expect(r?.close).toEqual([]); // partner apps are far less popular, so not "similar"
    });

    it('keeps a specific multi-word name even when the store ranks the big app first', () => {
        const results = [app('Swiggy: Food Instamart Dineout', 13902190), app('Swiggy Delivery Partner App', 423251)];
        expect(resolveName('Swiggy Delivery Partner', results)?.chosen.title).toBe('Swiggy Delivery Partner App');
    });

    it("falls back to the store's top result for a typo", () => {
        const results = [app('Swiggy: Food Instamart Dineout', 13902395), app('toing - Food Delivery', 918391)];
        expect(resolveName('Swigy', results)?.chosen.title).toBe('Swiggy: Food Instamart Dineout');
    });

    it('lists other popular matches when a short name is ambiguous', () => {
        const results = [
            app('MyJio: For Everything Jio', 27442969),
            app('JioSaavn - Music & Podcasts', 9204174),
            app('JioHotstar', 14477089),
            app('JioTV: Live TV', 3934337),
        ];
        const r = resolveName('jio', results);
        expect(r?.chosen.title).toBe('MyJio: For Everything Jio');
        expect(r?.close.map((x) => x.title)).toEqual(['JioSaavn - Music & Podcasts', 'JioHotstar']);
    });

    it("uses the store's top result when a rating count failed to load, instead of a smaller app", () => {
        const r = pickMatch([
            { title: 'Swiggy: Food Instamart Dineout', ratings: null, failed: true },
            { title: 'Swiggy Delivery Partner App', ratings: 423251 },
        ]);
        expect(r?.chosen.title).toBe('Swiggy: Food Instamart Dineout');
        expect(r?.close).toEqual([]);
    });

    it('keeps store order on a tie and copes with missing rating counts', () => {
        expect(resolveName('Ola', [app('Ola', null), app('Ola Driver', null)])?.chosen.title).toBe('Ola');
        expect(pickMatch([])).toBeNull();
    });
});

describe('matchNote', () => {
    it('stays quiet for an obvious match and speaks up for a nickname or an ambiguous name', () => {
        expect(matchNote({ typedName: 'Swiggy', storeTitle: 'Swiggy: Food Instamart Dineout', developer: 'Swiggy Limited' })).toBeNull();
        expect(matchNote({ typedName: null, storeTitle: 'Google Pay', developer: 'Google LLC' })).toBeNull(); // given as a link
        expect(matchNote({ typedName: 'GPay', storeTitle: 'Google Pay: Secure UPI payments', developer: 'Google LLC' })).toBe(
            '"GPay" = Google Pay: Secure UPI payments by Google LLC',
        );
        expect(
            matchNote({ typedName: 'jio', storeTitle: 'MyJio: For Everything Jio', developer: 'Jio Platforms Limited', otherMatches: ['JioHotstar'] }),
        ).toBe('"jio" = MyJio: For Everything Jio by Jio Platforms Limited (also similar: JioHotstar)');
    });
});
