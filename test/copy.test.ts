// Unit tests for the battlecard's words: the verdict is built in code and AI lines are checked before use.
import { describe, expect, it } from 'vitest';

import { type Gap, quoteScore } from '../src/analysis.js';
import { buildVerdict, opportunityCopy, plural, threatCopy, vetLine } from '../src/copy.js';

const gap = (over: Partial<Gap>): Gap => ({
    theme: 'FULFILMENT',
    themeLabel: 'Delivery & fulfilment (late, cancelled, missing, no-show)',
    owner: 'Operations',
    rival: 'Zomato',
    yourShare: 39.1,
    rivalShare: 27.3,
    yourCount: 34,
    rivalCount: 21,
    gapPoints: 11.8,
    confidence: 'high',
    quotes: [],
    ...over,
});

describe('buildVerdict', () => {
    it('puts each number next to its own app (the bug in run 09)', () => {
        const thr = gap({ theme: 'PAYMENTS', rival: 'Paytm', yourShare: 63.2, rivalShare: 36.4, gapPoints: 26.8 });
        const v = buildVerdict('PhonePe', [], [thr]);
        expect(v).toBe(
            "Biggest risk: 63.2% of PhonePe's specific 1–2★ complaints are about payments and refunds, vs 36.4% of Paytm's. Fix this before marketing against rivals.",
        );
    });

    it('leads with the stronger signal: confidence first, then the bigger gap', () => {
        const thr = gap({ gapPoints: 20, confidence: 'medium' });
        const opp = gap({ theme: 'SUPPORT', yourShare: 6, rivalShare: 18, gapPoints: 12, confidence: 'high' });
        expect(buildVerdict('Swiggy', [opp], [thr])).toMatch(/^Biggest opening: 18% of Zomato's .* customer support, vs 6% of Swiggy's\./);
    });

    it('does not lead with an opportunity that is on your own fix-first list', () => {
        const opp = gap({ theme: 'SUPPORT', yourShare: 6, rivalShare: 18, gapPoints: 12 });
        const thr = gap({ gapPoints: 5, confidence: 'medium' });
        expect(buildVerdict('Swiggy', [opp], [thr], new Set(['SUPPORT']))).toMatch(/^Biggest risk:/);
        expect(buildVerdict('Swiggy', [opp], [], new Set(['SUPPORT']))).toContain('also on your own fix-first list');
    });

    it('says plainly when every gap rests on few complaints', () => {
        const v = buildVerdict('Swiggy', [], [gap({ confidence: 'low' })]);
        expect(v).toMatch(/^No clear gap yet\./);
        expect(v).toContain("39.1% of Swiggy's specific 1–2★ complaints vs 27.3% of Zomato's");
    });

    it('handles no gaps at all', () => {
        expect(buildVerdict('Swiggy', [], [])).toBe('No clear complaint gap between these apps in this sample.');
    });
});

describe('vetLine', () => {
    it('allows star ranges but rejects any other number', () => {
        expect(vetLine('Users hate the 1–2★ refund delays', { maxWords: 20 }).text).toBe('Users hate the 1–2★ refund delays');
        expect(vetLine('Refunds in 10 minutes', { maxWords: 20 }).text).toBeNull();
        expect(vetLine('Only 36.4% of complaints', { maxWords: 20 }).reason).toMatch(/number/);
    });

    it('rejects claims the review data cannot back', () => {
        expect(vetLine('The fastest delivery in town', { maxWords: 20, noClaims: true }).text).toBeNull();
        expect(vetLine('Refunds guaranteed, no questions', { maxWords: 20, noClaims: true }).text).toBeNull();
        expect(vetLine('Tired of waiting for refunds? Try us.', { maxWords: 20, noClaims: true }).text).toBe(
            'Tired of waiting for refunds? Try us.',
        );
    });

    it('rejects missing and overlong lines', () => {
        expect(vetLine(undefined, { maxWords: 5 }).reason).toBe('missing');
        expect(vetLine('one two three four five six', { maxWords: 5 }).text).toBeNull();
    });
});

describe('card copy', () => {
    it('always writes the threat headline about your app, never the rival', () => {
        const c = threatCopy(gap({}), { theme: 'FULFILMENT', action: 'Audit late orders with the ops team weekly.' });
        expect(c.headline).toBe("More of your complaints are about delivery and fulfilment than Zomato's");
        expect(c.action).toBe('Audit late orders with the ops team weekly.');
        expect(c.rejected).toEqual([]);
    });

    it('replaces an AI line that fails a check and records why', () => {
        const c = opportunityCopy(gap({ theme: 'SUPPORT' }), { theme: 'SUPPORT', headline: 'Zomato support ignores users', message: 'Replies in 5 minutes!' });
        expect(c.headline).toBe('Zomato support ignores users');
        expect(c.message).toMatch(/^Speak to Zomato users/);
        expect(c.rejected).toHaveLength(1);
    });

    it('uses no marketing line on a low-confidence gap', () => {
        const c = opportunityCopy(gap({ confidence: 'low', rivalCount: 4, yourCount: 1 }), { headline: 'Zomato is failing', message: 'Switch now' });
        expect(c.headline).toMatch(/^Early sign:/);
        expect(c.message).toContain("rests on 4 of Zomato's specific complaints and 1 of yours");
    });
});

describe('quoteScore', () => {
    it('prefers a concrete complaint over generic pleading', () => {
        const concrete = 'Order arrived 2 hours late, food was cold and the refund of ₹250 never came back.';
        const generic = 'Please improve your system, very bad experience, worst app I have ever used here.';
        expect(quoteScore(concrete)).toBeGreaterThan(quoteScore(generic));
    });
});

describe('plural', () => {
    it('uses the singular for one', () => {
        expect(plural(1, 'opportunity', 'opportunities')).toBe('1 opportunity');
        expect(plural(2, 'threat')).toBe('2 threats');
        expect(plural(0, 'named issue')).toBe('0 named issues');
    });
});
