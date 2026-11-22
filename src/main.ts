// App Review Battlecard: compare your app's App Store reviews with rivals and get
// opportunities (where rivals' users are angrier) and threats (where yours are).
import { Actor, log } from 'apify';

import { type AppInfo, fetchReviews, type Review, resolveApp } from './apple.js';
import { fetchPlayReviews, resolvePlayApp } from './play.js';
import {
    type AppStats,
    type Competitor,
    computeIssues,
    computeStats,
    computeThemes,
    findGaps,
    type Gap,
    isNegative,
    type NamedIssue,
    switchingSignals,
    type ThemeResult,
} from './analysis.js';
import { type BattlecardCopy, classifyReviews, type LlmUsage, nameIssues, writeBattlecard } from './llm.js';
import { type AppSummary, type CardItem, renderHtml, renderMarkdown, type ReportData } from './report.js';

interface Input {
    apps?: string[];
    store?: 'googlePlay' | 'appStore';
    country?: string;
    reviewsPerApp?: number;
    maxNegativeReviewsForAI?: number;
    model?: string;
}

const DEFAULT_APPS = ['Swiggy', 'Zomato'];
const clamp = (v: unknown, lo: number, hi: number, dflt: number) => {
    const n = Number(v);
    return v !== undefined && v !== null && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
};

await Actor.init();

const state: Record<string, unknown> = { stage: 'starting' };
Actor.on('aborting', async () => {
    await Actor.setValue('STATE', state);
    await Actor.exit();
});

async function status(msg: string) {
    state.stage = msg;
    log.info(msg);
    await Actor.setStatusMessage(msg);
}

/** Ends the run as FAILED with a clear message. Nothing is pushed to the dataset, so the user is not charged for a result. */
async function failRun(msg: string): Promise<never> {
    log.error(msg);
    await Actor.setValue('STATE', state);
    await Actor.fail(msg);
    return process.exit(1);
}

try {
    const input = (await Actor.getInput<Input>()) ?? {};
    let appInputs = (input.apps?.length ? input.apps : DEFAULT_APPS).map((s) => String(s).trim()).filter(Boolean);
    if (appInputs.length < 2) await failRun('Add at least 2 apps: your app first, then 1 to 3 rivals.');
    if (appInputs.length > 4) {
        log.warning(`Only the first 4 apps are compared; ignoring ${appInputs.slice(4).join(', ')}`);
        appInputs = appInputs.slice(0, 4);
    }
    const country = String(input.country ?? 'in').toLowerCase().trim() || 'in';
    const reviewsPerApp = clamp(input.reviewsPerApp, 50, 500, 500);
    const maxNeg = clamp(input.maxNegativeReviewsForAI, 20, 200, 100);
    const model = String(input.model ?? '').trim() || 'anthropic/claude-haiku-5.5';
    const store = input.store === 'appStore' ? 'appStore' : 'googlePlay';
    const storeName = store === 'appStore' ? 'App Store' : 'Google Play';
    const resolve = store === 'appStore' ? resolveApp : resolvePlayApp;
    const getReviews = store === 'appStore' ? fetchReviews : fetchPlayReviews;
    state.input = { appInputs, store, country, reviewsPerApp, maxNeg, model };

    // 1. Resolve apps.
    await status(`Finding ${appInputs.length} apps on ${storeName} (${country.toUpperCase()})…`);
    const resolved = await Promise.allSettled(appInputs.map(async (a) => resolve(a, country)));
    if (resolved[0].status === 'rejected') {
        await failRun(`Could not find your app "${appInputs[0]}": ${(resolved[0].reason as Error).message}`);
    }
    const apps: AppInfo[] = [];
    resolved.forEach((r, i) => {
        if (r.status === 'fulfilled') {
            if (!apps.some((a) => a.id === r.value.id)) apps.push(r.value);
        } else {
            log.warning(`Skipping "${appInputs[i]}": ${(r.reason as Error).message}`);
        }
    });
    if (apps.length < 2) await failRun('Fewer than 2 distinct apps were found. Check the app names, IDs or URLs.');
    state.apps = apps.map((a) => `${a.name} (${a.id})`);
    log.info(`Apps: ${(state.apps as string[]).join(', ')}`);

    // 2. Download recent reviews in parallel.
    await status(`Downloading up to ${reviewsPerApp} recent ${storeName} reviews per app…`);
    const reviewLists = await Promise.all(
        apps.map(async (a) => getReviews(a.id, country, reviewsPerApp).catch((err) => {
            log.warning(`Could not download reviews for ${a.name}: ${(err as Error).message}`);
            return [] as Review[];
        })),
    );
    const withData = apps
        .map((app, i) => ({ app, reviews: reviewLists[i], stats: computeStats(reviewLists[i], app.currentVersion) }))
        .filter((x) => {
            if (x.reviews.length < 10) log.warning(`Skipping ${x.app.name}: only ${x.reviews.length} reviews found`);
            return x.reviews.length >= 10;
        });
    if (!withData.length || withData[0].app.id !== apps[0].id) {
        await failRun(`Your app ${apps[0].name} has too few recent ${storeName} reviews in "${country}" to analyse.`);
    }
    if (withData.length < 2) await failRun('None of the rival apps has enough recent reviews to compare.');
    for (const x of withData) {
        log.info(
            `${x.app.name}: ${x.stats.reviewsAnalyzed} reviews, ${x.stats.negativeReviews} are 1-2 stars, avg ${x.stats.avgRatingRecent}`,
        );
    }

    // 3. AI labels each negative review with one theme (one call per app, in parallel).
    const totalNeg = withData.reduce((s, x) => s + Math.min(maxNeg, x.stats.negativeReviews), 0);
    await status(`AI is sorting ${totalNeg} negative reviews into complaint themes…`);
    const usage: LlmUsage[] = [];
    // Bug triage for your app runs in parallel. It is optional: if it fails, the battlecard still ships without it.
    const yourNeg = withData[0].reviews.filter(isNegative).slice(0, maxNeg);
    const issuesPromise =
        yourNeg.length >= 6
            ? nameIssues(model, withData[0].app.name, yourNeg).catch((err) => {
                  log.warning(`Bug triage skipped: ${(err as Error).message}`);
                  return null;
              })
            : Promise.resolve(null);
    const classified = await Promise.allSettled(
        withData.map(async (x) => {
            const neg = x.reviews.filter(isNegative).slice(0, maxNeg);
            if (neg.length < 3) return computeThemes(neg, new Map());
            const { labels, usage: u } = await classifyReviews(model, x.app.name, neg);
            if (u) usage.push(u);
            return computeThemes(neg, labels);
        }),
    );
    if (classified[0].status === 'rejected') {
        await failRun(`The AI step failed for ${withData[0].app.name}: ${(classified[0].reason as Error).message}`);
    }
    const analysed: { app: AppInfo; stats: AppStats; themes: ThemeResult; reviews: Review[] }[] = [];
    classified.forEach((c, i) => {
        if (c.status === 'fulfilled' && c.value.classified >= 3) {
            analysed.push({ app: withData[i].app, stats: withData[i].stats, themes: c.value, reviews: withData[i].reviews });
        } else {
            const why = c.status === 'rejected' ? (c.reason as Error).message : 'fewer than 3 negative reviews';
            log.warning(`Leaving ${withData[i].app.name} out of the comparison: ${why}`);
        }
    });
    if (!analysed.length || analysed[0].app.id !== apps[0].id) {
        await failRun(`Your app ${apps[0].name} has fewer than 3 negative reviews in this sample, so there is nothing to compare.`);
    }
    if (analysed.length < 2) await failRun('No rival could be analysed, so no battlecard was produced.');

    // 4. Head-to-head gaps, computed in code.
    const you: Competitor = { name: analysed[0].app.name, themes: analysed[0].themes };
    const rivals: Competitor[] = analysed.slice(1).map((a) => ({ name: a.app.name, themes: a.themes }));
    const { opportunities, threats } = findGaps(you, rivals);

    // Switching signals: 1-2 star reviews that mention another compared app by name (plain text match).
    const switching = analysed.flatMap((a) =>
        switchingSignals(a.app.name, a.reviews.filter(isNegative), analysed.filter((b) => b !== a).map((b) => b.app.name)),
    );

    // Bug triage for your app: AI-named issues, counted and quoted in code.
    let yourIssues: NamedIssue[] = [];
    const issuesResult = await issuesPromise;
    if (issuesResult) {
        if (issuesResult.usage) usage.push(issuesResult.usage);
        yourIssues = computeIssues(yourNeg, issuesResult.issues, analysed[0].app.currentVersion);
        log.info(`Bug triage: ${yourIssues.length} named issues for ${you.name}`);
    }
    const fixFirst = yourIssues
        .slice(0, 3)
        .map((i) => `${i.title} (mentioned in ${i.count} of ${yourNeg.length} recent 1–2★ reviews; owner: ${i.owner})`);

    // 5. AI writes the copy; if it fails, fall back to plain sentences built from the numbers.
    await status('Writing the battlecard…');
    const facts = analysed.map((a) => ({
        app: a.app.name,
        recentReviews: a.stats.reviewsAnalyzed,
        negativeReviews: a.stats.negativeReviews,
        negativeShare: a.stats.negativeShare,
        avgRatingRecent: a.stats.avgRatingRecent,
        days: a.stats.daysCovered,
        release: a.stats.release?.note ?? null,
    }));
    let copy: BattlecardCopy | null = null;
    try {
        const yourFixFirst = yourIssues.slice(0, 3).map((i) => ({ theme: i.theme, issue: i.title, reviews: i.count }));
        const r = await writeBattlecard(model, you.name, rivals.map((x) => x.name), { apps: facts, yourFixFirst }, opportunities, threats);
        copy = r.copy;
        if (r.usage) usage.push(r.usage);
    } catch (err) {
        log.warning(`AI copywriting failed, using plain sentences instead: ${(err as Error).message}`);
    }

    const evidence = (g: Gap, side: 'opp' | 'thr') =>
        side === 'opp'
            ? `${g.rivalShare}% of ${g.rival}'s 1–2★ reviews are about ${g.themeLabel.toLowerCase()}, vs ${g.yourShare}% of yours.`
            : `${g.yourShare}% of your 1–2★ reviews are about ${g.themeLabel.toLowerCase()}, vs ${g.rivalShare}% of ${g.rival}'s.`;
    const toCards = (gaps: Gap[], side: 'opp' | 'thr'): CardItem[] =>
        gaps.map((g) => {
            const base = {
                theme: g.theme,
                themeLabel: g.themeLabel,
                owner: g.owner,
                rival: g.rival,
                yourShare: g.yourShare,
                rivalShare: g.rivalShare,
                gapPoints: g.gapPoints,
                evidence: evidence(g, side),
                quotes: g.quotes,
            };
            const label = g.themeLabel.toLowerCase();
            if (side === 'opp') {
                const c = copy?.opportunities.find((o) => o?.theme === g.theme);
                // A rival can be worse at something that is still one of your own top problems. Say so on the card.
                const clash = yourIssues.slice(0, 3).find((i) => i.theme === g.theme);
                return {
                    ...base,
                    ...(clash
                        ? {
                              caution: `⚠ Fix before you advertise this: "${clash.title}" is on your own fix-first list (mentioned in ${clash.count} of your ${yourNeg.length} recent 1–2★ reviews).`,
                          }
                        : {}),
                    headline: c?.headline || `${g.rival} users are angrier about ${label}`,
                    message: c?.message || `Lead with your strength in ${label} in campaigns aimed at ${g.rival} users.`,
                };
            }
            const c = copy?.threats.find((t) => t?.theme === g.theme);
            return {
                ...base,
                headline: c?.headline || `You trail ${g.rival} on ${label}`,
                action: c?.action || `Owner: ${g.owner}. Review the quoted complaints and fix the top cause first.`,
            };
        });
    // Opportunities you can use right away come first; the ones with a caution go last.
    const oppCards = toCards(opportunities, 'opp').sort((a, b) => Number(Boolean(a.caution)) - Number(Boolean(b.caution)));
    const thrCards = toCards(threats, 'thr');
    const verdict =
        copy?.verdict ||
        (oppCards[0]
            ? `Biggest opening: ${oppCards[0].evidence}`
            : thrCards[0]
              ? `Biggest risk: ${thrCards[0].evidence}`
              : 'No large complaint gaps between these apps in the current sample.');

    const appSummaries: AppSummary[] = analysed.map((a, i) => ({
        name: a.app.name,
        isYours: i === 0,
        appId: a.app.id,
        url: a.app.url,
        icon: a.app.icon,
        reviewsAnalyzed: a.stats.reviewsAnalyzed,
        negativeReviews: a.stats.negativeReviews,
        negativeShare: a.stats.negativeShare,
        avgRatingRecent: a.stats.avgRatingRecent,
        storeRating: a.app.storeRating,
        ratingCount: a.app.ratingCount,
        currentVersion: a.app.currentVersion,
        starMix: a.stats.starMix,
        replyRateToNegative: a.stats.replyRateToNegative,
        from: a.stats.from,
        to: a.stats.to,
        daysCovered: a.stats.daysCovered,
        releaseNote: a.stats.release?.note ?? null,
        themeShares: a.themes.shares,
        themeCounts: a.themes.counts,
        classified: a.themes.classified,
    }));

    const generatedAt = new Date().toISOString();
    const report: ReportData = {
        yourApp: you.name,
        rivals: rivals.map((r) => r.name),
        store: storeName,
        country,
        verdict,
        opportunities: oppCards,
        threats: thrCards,
        apps: appSummaries,
        yourIssues,
        fixFirst,
        switching,
        generatedAt,
        model,
    };

    const kv = await Actor.openKeyValueStore();
    await kv.setValue('BATTLECARD', renderHtml(report), { contentType: 'text/html; charset=utf-8' });
    await kv.setValue('BATTLECARD_MD', renderMarkdown(report), { contentType: 'text/markdown; charset=utf-8' });
    // Signed links (the SDK adds a signature when the store is private), so the report can be shared without logging in.
    const reportUrl = Actor.isAtHome() ? kv.getPublicUrl('BATTLECARD') : null;
    const markdownUrl = Actor.isAtHome() ? kv.getPublicUrl('BATTLECARD_MD') : null;

    const tokens = usage.reduce((s, u) => s + (u.total_tokens ?? 0), 0);
    // Exactly one dataset item per run = one battlecard (the billable result).
    await Actor.pushData({
        type: 'battlecard',
        yourApp: you.name,
        rivals: rivals.map((r) => r.name),
        store: storeName,
        country,
        verdict,
        topOpportunity: oppCards[0] ? `${oppCards[0].headline}: ${oppCards[0].evidence}` : null,
        topThreat: thrCards[0] ? `${thrCards[0].headline}: ${thrCards[0].evidence}` : null,
        opportunities: oppCards,
        threats: thrCards,
        fixFirst,
        yourIssues,
        switching,
        apps: appSummaries,
        reportUrl,
        markdownUrl,
        model,
        aiCopy: Boolean(copy),
        tokensUsed: tokens,
        generatedAt,
    });

    await status(
        `Done: ${you.name} vs ${rivals.map((r) => r.name).join(', ')}. ${oppCards.length} opportunities, ${thrCards.length} threats, ${yourIssues.length} named issues. Open the Output tab for the battlecard.`,
    );
    await Actor.exit();
} catch (err) {
    await failRun(`Unexpected error: ${(err as Error).message}`);
}
