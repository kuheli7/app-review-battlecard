// Unit tests for the deterministic part of the battlecard: everything that is computed in code, not by the AI.
import { describe, expect, it } from 'vitest';

import type { Review } from '../src/apple.js';
import {
    computeIssues,
    computeStats,
    computeThemes,
    findGaps,
    gapConfidence,
    isQuotable,
    labelAgreement,
    switchingSignals,
    type ThemeCode,
    type ThemeResult,
} from '../src/analysis.js';

let seq = 0;
const rv = (rating: number, text: string, extra: Partial<Review> = {}): Review => ({
    id: `id${++seq}`,
    rating,
    version: null,
    title: '',
    text,
    date: '2026-11-20T10:00:00Z',
    ...extra,
});
const LONG = 'This is a long enough review text to be quoted on the report page.';

/** Builds a ThemeResult from theme counts, the same way computeThemes does. */
function themesFrom(counts: Partial<Record<ThemeCode, number>>): ThemeResult {
    const reviews: Review[] = [];
    const labels = new Map<string, ThemeCode>();
    for (const [code, n] of Object.entries(counts)) {
        for (let i = 0; i < (n ?? 0); i++) {
            const r = rv(1, `${code} complaint number ${i}: ${LONG}`);
            reviews.push(r);
            labels.set(r.id, code as ThemeCode);
        }
    }
    return computeThemes(reviews, labels);
}

describe('computeStats', () => {
    it('counts stars, negative share and average', () => {
        const reviews = [rv(1, 'a'), rv(2, 'b'), rv(5, 'c'), rv(5, 'd')];
        const s = computeStats(reviews, null);
        expect(s.reviewsAnalyzed).toBe(4);
        expect(s.starMix).toEqual({ 1: 1, 2: 1, 3: 0, 4: 0, 5: 2 });
        expect(s.negativeReviews).toBe(2);
        expect(s.negativeShare).toBe(50);
        expect(s.avgRatingRecent).toBe(3.25);
        expect(s.replyRateToNegative).toBeNull(); // App Store has no reply field
    });

    it('computes the developer reply rate on 1-2 star reviews only', () => {
        const reviews = [
            rv(1, 'a', { replied: true }),
            rv(2, 'b', { replied: false }),
            rv(1, 'c', { replied: false }),
            rv(5, 'd', { replied: true }), // a reply to a 5-star review does not count
        ];
        expect(computeStats(reviews, null).replyRateToNegative).toBe(33.3);
    });

    it('compares the latest version with the one before it', () => {
        const old = Array.from({ length: 10 }, (_, i) =>
            rv(i < 2 ? 1 : 5, 'x', { version: '1.0', date: `2026-11-0${(i % 5) + 1}T00:00:00Z` }),
        );
        const cur = Array.from({ length: 10 }, (_, i) => rv(i < 6 ? 1 : 5, 'y', { version: '1.1', date: '2026-11-15T00:00:00Z' }));
        const s = computeStats([...old, ...cur], '1.1');
        expect(s.release?.latestVersion).toBe('1.1');
        expect(s.release?.previousVersion).toBe('1.0');
        expect(s.release?.latestNegativeShare).toBe(60);
        expect(s.release?.previousNegativeShare).toBe(20);
        expect(s.release?.note).toContain('worse than');
    });

    it('handles an empty list without crashing', () => {
        const s = computeStats([], null);
        expect(s.reviewsAnalyzed).toBe(0);
        expect(s.negativeShare).toBe(0);
        expect(s.avgRatingRecent).toBe(0);
        expect(s.release).toBeNull();
    });
});

describe('computeThemes', () => {
    it('turns labels into counts and shares of the labelled reviews', () => {
        const t = themesFrom({ FULFILMENT: 6, SUPPORT: 3, PRICING: 1 });
        expect(t.classified).toBe(10);
        expect(t.sampled).toBe(10);
        expect(t.counts.FULFILMENT).toBe(6);
        expect(t.shares.FULFILMENT).toBe(60);
        expect(t.shares.SUPPORT).toBe(30);
        expect(t.shares.BUGS).toBe(0);
    });

    it('ignores reviews the AI did not label (shares use labelled reviews only)', () => {
        const a = rv(1, LONG);
        const b = rv(1, LONG);
        const t = computeThemes([a, b], new Map([[a.id, 'BUGS' as ThemeCode]]));
        expect(t.sampled).toBe(2);
        expect(t.classified).toBe(1);
        expect(t.shares.BUGS).toBe(100);
    });

    it('only quotes clean, long-enough reviews', () => {
        const ok = rv(1, 'Delivery was two hours late and nobody answered the phone.');
        const short = rv(1, 'bad');
        const rude = rv(1, 'This fucking app never delivers my order on time, worst ever.');
        const labels = new Map<string, ThemeCode>([
            [ok.id, 'FULFILMENT'],
            [short.id, 'FULFILMENT'],
            [rude.id, 'FULFILMENT'],
        ]);
        expect(computeThemes([ok, short, rude], labels).quotes.FULFILMENT).toEqual([ok.text]);
    });
});

describe('isQuotable', () => {
    it('keeps "bcz" (because) but drops whole-word abuse', () => {
        expect(isQuotable('I uninstalled the app bcz the refund never came back')).toBe(true);
        expect(isQuotable('worst app bc never again ordering from here ever')).toBe(false);
        expect(isQuotable('too short')).toBe(false);
    });
});

describe('findGaps', () => {
    it('finds opportunities where the rival is worse and threats where you are worse', () => {
        const you = { name: 'You', themes: themesFrom({ FULFILMENT: 40, SUPPORT: 5, PRICING: 5 }) };
        const rival = { name: 'Rival', themes: themesFrom({ FULFILMENT: 20, SUPPORT: 20, PRICING: 10 }) };
        const { opportunities, threats } = findGaps(you, [rival]);
        expect(opportunities.map((g) => g.theme)).toEqual(['SUPPORT', 'PRICING']);
        expect(opportunities[0].gapPoints).toBe(30); // 40% vs 10%
        expect(threats.map((g) => g.theme)).toEqual(['FULFILMENT']);
        expect(threats[0].gapPoints).toBe(40); // 80% vs 40%
        expect(threats[0].confidence).toBe('high');
    });

    it('ignores tiny gaps and themes with fewer than 2 reviews', () => {
        const you = { name: 'You', themes: themesFrom({ BUGS: 50, UX: 49 }) };
        const rival = { name: 'Rival', themes: themesFrom({ BUGS: 49, UX: 50, ACCOUNT: 1 }) };
        const { opportunities, threats } = findGaps(you, [rival]);
        expect(opportunities).toEqual([]); // ACCOUNT gap is 1 review only; UX gap is < 3 pts
        expect(threats).toEqual([]);
    });

    it('lists each theme once, against the rival with the biggest gap', () => {
        const you = { name: 'You', themes: themesFrom({ BUGS: 10, SUPPORT: 10 }) };
        const r1 = { name: 'R1', themes: themesFrom({ BUGS: 10, SUPPORT: 30 }) };
        const r2 = { name: 'R2', themes: themesFrom({ BUGS: 10, SUPPORT: 90 }) };
        const { opportunities } = findGaps(you, [r1, r2]);
        expect(opportunities).toHaveLength(1);
        expect(opportunities[0].rival).toBe('R2');
    });
});

describe('gapConfidence', () => {
    it('is high for a big gap on enough reviews and low for a small sample', () => {
        expect(gapConfidence(40, 100, 15, 100)).toBe('high');
        expect(gapConfidence(3, 10, 1, 10)).toBe('low');
        expect(gapConfidence(0, 0, 5, 10)).toBe('low');
    });
});

describe('switchingSignals', () => {
    it('finds 1-2 star reviews that name a rival, including split brand names', () => {
        const neg = [
            rv(1, 'Switching to Zomato, at least they refund missing items properly.'),
            rv(1, 'Big basket delivers on time, this app never does anymore sadly.'),
            rv(2, 'Nothing about other apps here, just a late delivery again today.'),
        ];
        const out = switchingSignals('Swiggy', neg, ['Zomato', 'BigBasket', 'Go Puff']);
        expect(out.map((s) => [s.mentions, s.count])).toEqual([
            ['Zomato', 1],
            ['BigBasket', 1],
        ]);
        expect(out[0].negativeReviews).toBe(3);
    });

    it('does not match a name inside another word', () => {
        const neg = [rv(1, 'The olaf character in the ad is annoying and the app is slow.')];
        expect(switchingSignals('Uber', neg, ['Ola'])).toEqual([]);
    });
});

describe('computeIssues', () => {
    it('counts in code, drops weak or duplicate issues and keeps the biggest first', () => {
        const neg = Array.from({ length: 10 }, (_, i) => rv(1, `Issue review ${i}: ${LONG}`, { version: i < 3 ? '2.0' : '1.9' }));
        const ids = neg.map((r) => r.id);
        const issues = computeIssues(
            neg,
            [
                { title: 'Refund not credited', theme: 'PAYMENTS', reviewIds: [ids[0], ids[1]] },
                { title: 'OTP not received', theme: 'ACCOUNT', reviewIds: [ids[2], ids[3], ids[4], 'made-up-id'] },
                { title: 'refund not credited', theme: 'PAYMENTS', reviewIds: [ids[5], ids[6]] }, // duplicate title
                { title: 'Only one review', theme: 'BUGS', reviewIds: [ids[7]] }, // too few
                { title: 'Unknown theme', theme: 'WEATHER', reviewIds: [ids[8], ids[9]] }, // becomes OTHER, dropped
            ],
            '2.0',
        );
        expect(issues.map((i) => [i.title, i.count])).toEqual([
            ['OTP not received', 3], // the made-up id is ignored
            ['Refund not credited', 2],
        ]);
        expect(issues[0].shareOfNegative).toBe(30);
        expect(issues[0].inCurrentVersion).toBe(1);
        expect(issues[0].owner).toBe('Engineering');
    });
});

describe('labelAgreement', () => {
    it('reports how many labels match between two passes', () => {
        const a = new Map([
            ['x', 'BUGS'],
            ['y', 'SUPPORT'],
            ['z', 'PRICING'],
        ]);
        const b = new Map([
            ['x', 'BUGS'],
            ['y', 'PRICING'],
            ['q', 'UX'], // not in the first pass, not counted
        ]);
        expect(labelAgreement(a, b)).toEqual({ checked: 2, agreed: 1, share: 50 });
    });
});

describe('vague reviews (OTHER) are left out of theme shares', () => {
    it('uses only concrete complaints as the base', () => {
        const t = themesFrom({ FULFILMENT: 3, SUPPORT: 1, OTHER: 6 });
        expect(t.classified).toBe(10);
        expect(t.concrete).toBe(4);
        expect(t.shares.FULFILMENT).toBe(75);
        expect(t.shares.OTHER).toBe(60); // OTHER's own share is of all labelled reviews
    });

    it('does not invent gaps when a rival simply has more vague reviews', () => {
        const you = { name: 'You', themes: themesFrom({ PAYMENTS: 10, BUGS: 10 }) };
        const rival = { name: 'Rival', themes: themesFrom({ PAYMENTS: 10, BUGS: 10, OTHER: 60 }) };
        const { opportunities, threats } = findGaps(you, [rival]);
        expect(opportunities).toEqual([]);
        expect(threats).toEqual([]);
    });
});
