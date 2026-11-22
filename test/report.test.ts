// Report rendering: both HTML designs and the Markdown must show the data, escape review text, and never break.
import { describe, expect, it } from 'vitest';

import { type AppSummary, renderHtml, renderMarkdown, type ReportData } from '../src/report.js';
import { renderHtmlStudio } from '../src/report_studio.js';

const app = (name: string, isYours: boolean, shares: Record<string, number>): AppSummary => ({
    name,
    isYours,
    appId: name.toLowerCase(),
    url: null,
    icon: null,
    ratingCount: 1000,
    currentVersion: '1.0',
    starMix: { 1: 40, 2: 10, 3: 5, 4: 5, 5: 40 },
    replyRateToNegative: isYours ? 80 : null,
    reviewsAnalyzed: 100,
    negativeReviews: 50,
    negativeShare: 50,
    avgRatingRecent: 3.1,
    storeRating: 4.2,
    from: '2026-11-20T00:00:00Z',
    to: '2026-11-22T00:00:00Z',
    daysCovered: 2,
    releaseNote: null,
    themeShares: shares,
    themeCounts: Object.fromEntries(Object.entries(shares).map(([k, v]) => [k, Math.round(v / 2)])),
    classified: 50,
    sampled: 50,
});

const EVIL = '<script>alert(1)</script> & "quotes"';

const data: ReportData = {
    yourApp: 'Alpha <b>App</b>',
    rivals: ['Beta'],
    store: 'Google Play',
    country: 'in',
    verdict: `Fix delivery first. ${EVIL}`,
    opportunities: [
        {
            theme: 'SUPPORT',
            themeLabel: 'Customer support',
            owner: 'Support',
            rival: 'Beta',
            yourShare: 10,
            rivalShare: 30,
            gapPoints: 20,
            confidence: 'high',
            headline: 'Beta users cannot reach support',
            evidence: "30% of Beta's 1–2★ reviews are about customer support, vs 10% of yours.",
            message: 'Real humans answer in 2 minutes.',
            caution: 'Fix before you advertise this: test caution.',
            quotes: [`Nobody answered my ticket for three days. ${EVIL}`],
        },
    ],
    threats: [
        {
            theme: 'FULFILMENT',
            themeLabel: 'Delivery & fulfilment',
            owner: 'Operations',
            rival: 'Beta',
            yourShare: 50,
            rivalShare: 20,
            gapPoints: 30,
            confidence: 'low',
            headline: 'You trail Beta on delivery',
            evidence: '50% of your 1–2★ reviews are about delivery, vs 20% of Beta’s.',
            action: 'Fix rider allocation.',
            quotes: [],
        },
    ],
    apps: [app('Alpha <b>App</b>', true, { FULFILMENT: 50, SUPPORT: 10, OTHER: 40 }), app('Beta', false, { FULFILMENT: 20, SUPPORT: 30, OTHER: 50 })],
    yourIssues: [
        {
            title: 'Order cancelled after long wait',
            theme: 'FULFILMENT',
            themeLabel: 'Delivery & fulfilment',
            owner: 'Operations',
            count: 12,
            shareOfNegative: 24,
            inCurrentVersion: 5,
            quotes: ['Waited an hour and then it got cancelled without refund.'],
        },
    ],
    fixFirst: ['Order cancelled after long wait (mentioned in 12 of 50 recent 1–2★ reviews; owner: Operations)'],
    switching: [{ app: 'Alpha <b>App</b>', mentions: 'Beta', count: 3, negativeReviews: 50, quotes: ['Beta at least refunds missing items properly.'] }],
    generatedAt: '2026-11-22T08:00:00.000Z',
    model: 'anthropic/claude-haiku-5.5',
    labelCheck: { checked: 15, agreed: 13, share: 86.7 },
};

const renderers = { studio: renderHtmlStudio, classic: renderHtml };

describe.each(Object.entries(renderers))('%s HTML report', (_name, render) => {
    const html = render(data);

    it('is a complete HTML page', () => {
        expect(html.startsWith('<!doctype html>')).toBe(true);
        expect(html.trimEnd().endsWith('</html>')).toBe(true);
    });

    it('escapes review text and app names (no script injection)', () => {
        expect(html).not.toContain('<script>');
        expect(html).not.toContain('<b>App</b>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('shows the verdict, cards, triage, switching and the accuracy check', () => {
        expect(html).toContain('Fix delivery first.');
        expect(html).toContain('Beta users cannot reach support');
        expect(html).toContain('You trail Beta on delivery');
        expect(html).toContain('Order cancelled after long wait');
        expect(html).toContain('Beta at least refunds missing items properly.');
        expect(html).toContain('86.7%');
    });

    it('still renders with no opportunities, threats, issues or switching', () => {
        const empty = render({ ...data, opportunities: [], threats: [], yourIssues: [], fixFirst: [], switching: [], labelCheck: null });
        expect(empty).toContain('</html>');
        expect(empty).toContain('Fix delivery first.');
    });
});

describe('studio design', () => {
    const html = renderHtmlStudio(data);

    it('is dark by default with a CSS-only light switch (Apify serves reports without scripts)', () => {
        expect(html).toContain('id="light"');
        expect(html).toContain(':root:has(#light:checked)');
        expect(html).not.toMatch(/<script/i);
    });

    it('uses no emoji', () => {
        const withoutStars = html.replace(/[★☆]/g, '');
        expect(withoutStars).not.toMatch(/\p{Extended_Pictographic}/u);
    });

    it('shows the confidence of each gap', () => {
        expect(html).toContain('high confidence');
        expect(html).toContain('low confidence');
    });
});

describe('Markdown report', () => {
    it('includes cards with confidence, the mix table and the accuracy check', () => {
        const md = renderMarkdown(data);
        expect(md).toContain('Beta users cannot reach support');
        expect(md).toContain('(confidence: high)');
        expect(md).toContain('| Customer support |');
        expect(md).toContain('agreed on 13 (86.7%)');
    });
});
