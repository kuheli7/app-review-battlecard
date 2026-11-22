// Renders the battlecard as a one-page HTML report and as Markdown.
import { type NamedIssue, type SwitchingSignal, THEMES } from './analysis.js';

export interface CardItem {
    theme: string;
    themeLabel: string;
    owner: string;
    rival: string;
    yourShare: number;
    rivalShare: number;
    gapPoints: number;
    headline: string;
    evidence: string;
    message?: string;
    action?: string;
    /** Set when this opportunity's theme is also on your own fix-first list. */
    caution?: string;
    /** Statistical confidence that the gap is real (two-proportion z-test). */
    confidence?: 'high' | 'medium' | 'low';
    quotes: string[];
}

export interface AppSummary {
    name: string;
    isYours: boolean;
    appId: string;
    url: string | null;
    ratingCount: number | null;
    currentVersion: string | null;
    starMix: Record<string, number>;
    replyRateToNegative: number | null;
    icon: string | null;
    reviewsAnalyzed: number;
    negativeReviews: number;
    negativeShare: number;
    avgRatingRecent: number;
    storeRating: number | null;
    from: string | null;
    to: string | null;
    daysCovered: number;
    releaseNote: string | null;
    themeShares: Record<string, number>;
    themeCounts: Record<string, number>;
    classified: number;
    /** Labelled reviews with a concrete complaint; theme shares are of this number. */
    concrete?: number;
    /** Negative reviews sent to the AI (classified = how many it labelled). */
    sampled?: number;
}

export interface ReportData {
    yourApp: string;
    rivals: string[];
    store: string;
    country: string;
    verdict: string;
    opportunities: CardItem[];
    threats: CardItem[];
    apps: AppSummary[];
    yourIssues: NamedIssue[];
    fixFirst: string[];
    switching: SwitchingSignal[];
    generatedAt: string;
    model: string;
    /** Second, independent labelling pass on a sample of your app's reviews: how often both passes agree. */
    labelCheck?: { checked: number; agreed: number; share: number } | null;
    /** Apps from the input that were left out (not found, or too few reviews). */
    skipped?: string[];
}

export const esc = (s: unknown) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '?');

// One fixed colour per app, in input order (your app first). Validated as a categorical set
// (CVD-safe on adjacent pairs). Aqua and yellow are below 3:1 contrast, so every bar also prints its value.
const APP_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];

const appIndex = (d: ReportData, name: string) => Math.max(0, d.apps.findIndex((a) => a.name === name));
const appColor = (d: ReportData, name: string) => APP_COLORS[appIndex(d, name)] ?? APP_COLORS[0];
export const fmtDay = (iso: string | null) => {
    if (!iso) return '?';
    const t = new Date(iso);
    return Number.isNaN(t.getTime()) ? day(iso) : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};
export const stars = (n: number | null | undefined) => (typeof n === 'number' ? `${n.toFixed(1)}★` : '?');
const youTag = (isYours: boolean) => (isYours ? ' <span class="you">you</span>' : '');
const width = (v: number, scale: number) => `${Math.max(v > 0 ? 2 : 0, Math.min(100, (v / scale) * 100)).toFixed(1)}%`;

/** A thin horizontal bar with its value printed at the tip (never colour alone). */
function barRow(label: string, value: number, color: string, scale: number, suffix = '%'): string {
    return `<div class="cb"><span class="cb-name">${label}</span><span class="track" aria-hidden="true"><span class="fill" style="width:${width(value, scale)};background:${color}"></span></span><span class="cb-val">${value}${suffix}</span></div>`;
}

export function quotesHtml(quotes: string[]): string {
    const [first, ...rest] = quotes;
    if (!first) return '';
    const more = rest.length
        ? `<details><summary>${rest.length} more review${rest.length > 1 ? 's' : ''}</summary>${rest.map((q) => `<blockquote>“${esc(q)}”</blockquote>`).join('')}</details>`
        : '';
    return `<blockquote>“${esc(first)}”</blockquote>${more}`;
}

function cardHtml(d: ReportData, c: CardItem, kind: 'opp' | 'thr', scale: number): string {
    const rival = barRow(esc(c.rival), c.rivalShare, appColor(d, c.rival), scale);
    const you = barRow(`${esc(d.yourApp)}${youTag(true)}`, c.yourShare, APP_COLORS[0], scale);
    const bars = kind === 'opp' ? rival + you : you + rival;
    const extra =
        kind === 'opp'
            ? `<p class="msg"><span class="lbl">Message to run</span>${esc(c.message)}</p>`
            : `<p class="msg"><span class="lbl">Fix · ${esc(c.owner)}</span>${esc(c.action)}</p>`;
    const caution = c.caution ? `<p class="caution" role="note">${esc(c.caution)}</p>` : '';
    return `<article class="card ${kind}${c.caution ? ' warned' : ''}">
<div class="card-top"><span class="theme">${esc(c.themeLabel)}</span><span class="gap">${Math.abs(c.gapPoints)} pts gap</span></div>
<h3>${esc(c.headline)}</h3>
<div class="bars" title="${esc(c.evidence)}">${bars}<p class="cap">Share of each app's 1–2★ reviews about ${esc(c.themeLabel.toLowerCase())}</p></div>
${caution}${extra}${quotesHtml(c.quotes)}</article>`;
}

function appTilesHtml(d: ReportData): string {
    return d.apps
        .map((a, i) => {
            const reply =
                a.replyRateToNegative !== null
                    ? `<div class="kpi"><span class="kv">${a.replyRateToNegative}%</span><span class="kl">of 1–2★ reviews got a developer reply</span></div>`
                    : '';
            return `<div class="app" style="--c:${APP_COLORS[i] ?? APP_COLORS[0]}">
<div class="app-head">${a.icon ? `<img src="${esc(a.icon)}" alt="">` : '<span class="swatch"></span>'}<b>${esc(a.name)}</b>${youTag(a.isYours)}</div>
<div class="kpis">
<div class="kpi"><span class="kv">${a.negativeShare}%</span><span class="kl">of recent reviews are 1–2★</span></div>
<div class="kpi"><span class="kv">${stars(a.avgRatingRecent)}</span><span class="kl">recent average · store shows ${stars(a.storeRating)}</span></div>
${reply}
</div>
<p class="meta">${a.reviewsAnalyzed} reviews, ${fmtDay(a.from)} → ${fmtDay(a.to)} · ${a.negativeReviews} are 1–2★${a.currentVersion ? ` · v${esc(a.currentVersion)}` : ''}</p>
${a.releaseNote ? `<p class="meta">🚦 ${esc(a.releaseNote)}</p>` : ''}
</div>`;
        })
        .join('');
}

function switchingHtml(d: ReportData): string {
    if (!d.switching.length) return '';
    const cards = d.switching
        .map((sw) => {
            const kind = sw.app === d.yourApp ? 'thr' : sw.mentions === d.yourApp ? 'opp' : 'neutral';
            const tag =
                kind === 'thr'
                    ? '<span class="chip chip-thr">▼ Your unhappy users name a rival</span>'
                    : kind === 'opp'
                      ? '<span class="chip chip-opp">▲ A rival\'s unhappy users name you</span>'
                      : '<span class="chip">Between rivals</span>';
            return `<article class="sw ${kind}"><div class="sw-num">${sw.count}<small>of ${sw.negativeReviews}</small></div>
<div class="sw-body">${tag}<h3>${sw.count} of ${esc(sw.app)}'s recent 1–2★ reviews mention ${esc(sw.mentions)}</h3>${quotesHtml(sw.quotes)}</div></article>`;
        })
        .join('');
    return `<section><h2>🔁 Switching signals</h2><p class="lead">Unhappy reviews that name another app in this comparison.</p><div class="sw-grid">${cards}</div></section>`;
}

function issuesHtml(d: ReportData): string {
    if (!d.yourIssues.length) return '';
    const ver = d.apps[0]?.currentVersion ?? null;
    const showVer = ver && d.yourIssues.some((i) => i.inCurrentVersion !== null);
    const total = d.apps[0]?.classified ?? 0;
    const scale = Math.max(1, ...d.yourIssues.map((i) => i.count));
    const rows = d.yourIssues
        .map((i, n) => {
            const first = n < 3;
            return `<tr class="${first ? 'first' : ''}"><td><span class="rank">${n + 1}</span></td>
<td><b>${esc(i.title)}</b>${first ? ' <span class="chip chip-thr">Fix first</span>' : ''}<br><small>${esc(i.owner)} · ${esc(i.themeLabel)}</small></td>
<td class="num">${barRow('', i.count, APP_COLORS[0], scale, '')}<small>${i.shareOfNegative}% of 1–2★</small></td>
${showVer ? `<td class="num">${i.inCurrentVersion ?? '–'}</td>` : ''}
<td class="q">${i.quotes[0] ? `“${esc(i.quotes[0])}”` : ''}</td></tr>`;
        })
        .join('');
    return `<section><h2>🛠 Bug triage: ${esc(d.yourApp)}</h2><p class="lead">Specific recurring issues in your ${total} most recent 1–2★ reviews. Start with the first three.</p>
<div class="tbl"><table class="issues"><thead><tr><th scope="col"></th><th scope="col">Issue · owner team</th><th scope="col">Reviews mentioning it</th>${showVer ? `<th scope="col">On v${esc(ver)}</th>` : ''}<th scope="col">Example</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="note">A review can mention several issues, so these counts overlap. The complaint mix below uses each review's main complaint only.</p></section>`;
}

function mixHtml(d: ReportData): string {
    const themes = THEMES.filter((t) => t.code !== 'OTHER');
    const scale = Math.max(1, ...themes.flatMap((t) => d.apps.map((a) => a.themeShares[t.code] ?? 0)));
    const legend = d.apps
        .map((a, i) => `<span class="key"><span class="sw-dot" style="background:${APP_COLORS[i]}"></span>${esc(a.name)}${youTag(a.isYours)}</span>`)
        .join('');
    const head = d.apps.map((a) => `<th scope="col">${esc(a.name)}${youTag(a.isYours)}</th>`).join('');
    const rows = themes
        .map((t) => {
            const vals = d.apps.map((a) => a.themeShares[t.code] ?? 0);
            const max = Math.max(...vals);
            const cells = d.apps
                .map((a, i) => {
                    const v = vals[i];
                    const n = a.themeCounts[t.code] ?? 0;
                    const tip = `${a.name}: ${n} of ${a.concrete ?? a.classified} specific 1–2★ complaints (${v}%)`;
                    return `<td class="mix${v === max && v > 0 && d.apps.length > 1 ? ' top' : ''}" title="${esc(tip)}">${barRow('', v, APP_COLORS[i], scale)}<small>${n} review${n === 1 ? "" : "s"}</small></td>`;
                })
                .join('');
            return `<tr><th scope="row">${esc(t.label)}<br><small>${esc(t.owner)}</small></th>${cells}</tr>`;
        })
        .join('');
    return `<section><h2>📊 Complaint mix</h2><p class="lead">Share of each app's own specific 1–2★ complaints per theme (vague reviews like "bad" or "ok" are left out). Compare the mix, not the stars. The highest share in each row is bold.</p>
<div class="legend">${legend}</div>
<div class="tbl"><table class="mixt"><thead><tr><th scope="col">Theme · owner team</th>${head}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

export function renderHtml(d: ReportData): string {
    const cardScale = Math.max(1, ...[...d.opportunities, ...d.threats].flatMap((c) => [c.yourShare, c.rivalShare]));
    const totalReviews = d.apps.reduce((s, a) => s + a.reviewsAnalyzed, 0);
    const icons = d.apps
        .map((a) => (a.icon ? `<img src="${esc(a.icon)}" alt="${esc(a.name)}">` : ''))
        .filter(Boolean)
        .join('<span class="vs-dot">vs</span>');
    const title = `${esc(d.yourApp)} <span class="vs">vs</span> ${d.rivals.map(esc).join(' <span class="vs">vs</span> ')}`;

    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Battlecard: ${esc(d.yourApp)} vs ${esc(d.rivals.join(', '))}</title>
<style>
:root{color-scheme:light;--page:#f4f4f1;--surface:#fff;--ink:#0b0b0b;--ink2:#52514e;--muted:#6f6e69;--line:#e1e0d9;--good:#0ca30c;--good-ink:#006300;--bad:#d03b3b;--warn:#fab219;--you:#2a78d6}
*{box-sizing:border-box}
body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;margin:0;background:var(--page);color:var(--ink)}
.wrap{max-width:1080px;margin:0 auto;padding:28px 24px 40px}
h1{font-size:28px;line-height:1.2;margin:2px 0 4px;letter-spacing:-.01em}h2{font-size:19px;margin:0 0 2px}h3{font-size:16px;line-height:1.35;margin:0 0 10px}
section{margin-top:30px}.lead{color:var(--ink2);margin:0 0 12px;font-size:14px}.note{color:var(--muted);font-size:12px;margin:8px 0 0}
.hero{display:flex;gap:18px;align-items:center}.icons{display:flex;align-items:center;gap:6px;flex-shrink:0}
.icons img{width:52px;height:52px;border-radius:13px;box-shadow:0 1px 3px rgba(0,0,0,.15)}.vs-dot{font-size:12px;color:var(--muted);font-weight:600}
.eyebrow{margin:0;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--you)}.vs{color:var(--muted);font-weight:500;font-size:.75em}
.sub{color:var(--ink2);margin:0;font-size:14px}
.verdict{margin-top:20px;background:#14161c;color:#fff;border-radius:14px;padding:18px 22px}
.verdict .lbl{color:#9fc3f2}.verdict p{margin:4px 0 0;font-size:19px;line-height:1.4;font-weight:500}
.lbl{display:block;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:2px}
.apps{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;margin-top:16px}
.app{background:var(--surface);border:1px solid var(--line);border-top:4px solid var(--c);border-radius:12px;padding:14px 16px}
.app-head{display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:16px}.app-head img{width:28px;height:28px;border-radius:7px}
.swatch{width:14px;height:14px;border-radius:4px;background:var(--c)}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.kpi{display:flex;flex-direction:column}
.kv{font-size:24px;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums}.kl{font-size:12px;color:var(--ink2);line-height:1.3;margin-top:3px}
.meta{margin:10px 0 0;font-size:12px;color:var(--muted)}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}@media(max-width:780px){.cols{grid-template-columns:1fr}.kpis{grid-template-columns:1fr 1fr}}
.colh{display:flex;align-items:center;gap:8px;margin-bottom:10px}.colh .ico{width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:12px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:12px;border-left:5px solid var(--line)}
.card.opp{border-left-color:var(--good)}.card.thr{border-left-color:var(--bad)}.card.warned{border-left-color:var(--warn)}
.card-top{display:flex;justify-content:space-between;gap:8px;align-items:baseline;margin-bottom:4px}
.theme{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--ink2)}
.gap{font-size:12px;font-weight:700;background:#f1f0eb;border-radius:999px;padding:1px 9px;white-space:nowrap;font-variant-numeric:tabular-nums}
.bars{margin:0 0 10px}.cap{margin:4px 0 0;font-size:11px;color:var(--muted)}
.cb{display:grid;grid-template-columns:118px 1fr 44px;align-items:center;gap:8px;margin:3px 0;font-size:13px}
.cb-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.track{display:block;height:10px;background:#f1f0eb;border-radius:0 5px 5px 0;overflow:hidden}
.fill{display:block;height:100%;border-radius:0 4px 4px 0}.cb-val{font-weight:700;text-align:right;font-variant-numeric:tabular-nums}
.msg{margin:0 0 8px;font-weight:600}.msg .lbl{font-weight:700}
.caution{background:#fff6e0;border:1px solid #f5c26b;color:#5c3a00;border-radius:8px;padding:7px 10px;margin:0 0 8px;font-size:13px}
blockquote{margin:6px 0 0;padding:7px 11px;background:#f6f6f3;border-left:3px solid var(--line);border-radius:0 8px 8px 0;font-size:13px;color:#33322f}
details{margin-top:4px}summary{cursor:pointer;font-size:12px;color:var(--ink2)}
.you{background:var(--you);color:#fff;border-radius:4px;padding:0 5px;font-size:11px;font-weight:600;vertical-align:1px}
.chip{display:inline-block;font-size:11px;font-weight:700;border-radius:999px;padding:1px 8px;background:#f1f0eb;color:var(--ink2);white-space:nowrap}
.chip-opp{background:#e3f4e3;color:var(--good-ink)}.chip-thr{background:#fbe5e5;color:#9c1f1f}
.sw-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.sw{display:flex;gap:14px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px 16px;border-left:5px solid var(--line)}
.sw.thr{border-left-color:var(--bad)}.sw.opp{border-left-color:var(--good)}.sw h3{margin:6px 0 4px;font-size:15px}
.sw-num{font-size:34px;font-weight:800;line-height:1;text-align:center;min-width:60px;font-variant-numeric:tabular-nums}.sw-num small{display:block;font-size:11px;font-weight:600;color:var(--muted);margin-top:4px}
.sw-body{flex:1;min-width:0}
.tbl{overflow-x:auto;background:var(--surface);border:1px solid var(--line);border-radius:12px}
table{width:100%;border-collapse:collapse}th,td{padding:9px 12px;border-bottom:1px solid #eeede8;text-align:left;vertical-align:top;font-size:14px}
tr:last-child>*{border-bottom:0}thead th{font-size:12px;color:var(--ink2);font-weight:700;background:#fafaf8}
td small,th small{color:var(--muted);font-weight:400;font-size:12px}
.issues .rank{display:inline-flex;width:24px;height:24px;border-radius:50%;align-items:center;justify-content:center;background:#f1f0eb;font-weight:700;font-size:13px}
.issues tr.first .rank{background:var(--bad);color:#fff}.issues td.num{min-width:150px}.issues td.q{font-size:13px;color:#33322f;max-width:340px}
.issues .cb,.mixt .cb{grid-template-columns:1fr 40px;margin:0 0 2px}.issues .cb-name,.mixt .cb-name{display:none}
.mixt th[scope=row]{font-weight:600;width:34%}.mixt td.mix{min-width:150px}.mixt td.top .cb-val{font-weight:800;text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:3px}
.mixt td:not(.top) .cb-val{font-weight:500;color:var(--ink2)}
.legend{display:flex;flex-wrap:wrap;gap:14px;margin:0 0 8px;font-size:13px}.key{display:inline-flex;align-items:center;gap:6px}
.sw-dot{width:12px;height:12px;border-radius:3px;display:inline-block}
.foot{color:var(--muted);font-size:12px;margin-top:30px;border-top:1px solid var(--line);padding-top:12px}
@media print{body{background:#fff}.wrap{padding:0}.card,.app,.sw,tr{break-inside:avoid}details{display:none}.verdict{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="wrap">
<header class="hero">${icons ? `<div class="icons">${icons}</div>` : ''}<div><p class="eyebrow">App Review Battlecard</p><h1>${title}</h1>
<p class="sub">${esc(d.store)} · ${esc(d.country.toUpperCase())} · ${totalReviews.toLocaleString('en-US')} recent reviews read · ${esc(d.generatedAt.slice(0, 16).replace('T', ' '))} UTC</p></div></header>
<div class="verdict"><span class="lbl">Verdict</span><p>${esc(d.verdict)}</p></div>
<div class="apps">${appTilesHtml(d)}</div>
<section class="cols">
<div><div class="colh"><span class="ico" style="background:var(--good)">▲</span><h2>Opportunities</h2></div><p class="lead">Where a rival's users complain more than yours.</p>${d.opportunities.map((c) => cardHtml(d, c, 'opp', cardScale)).join('') || '<p class="lead">No clear rival weakness in this sample.</p>'}</div>
<div><div class="colh"><span class="ico" style="background:var(--bad)">▼</span><h2>Threats</h2></div><p class="lead">Where your users complain more than a rival's.</p>${d.threats.map((c) => cardHtml(d, c, 'thr', cardScale)).join('') || '<p class="lead">No clear weakness vs rivals in this sample.</p>'}</div>
</section>
${switchingHtml(d)}
${issuesHtml(d)}
${mixHtml(d)}
<p class="foot">${d.skipped?.length ? `<b>Skipped:</b> ${esc(d.skipped.join(', '))}. ` : ''}Method: the most recent ${esc(d.store)} reviews per app. An AI model (${esc(d.model)}) labels every 1–2★ review with one theme; shares and gaps are computed in code. We compare the <b>mix</b> of complaints, not average stars, because in-app rating prompts inflate star averages. ${d.labelCheck?.checked ? `Accuracy check: a second AI pass re-labelled ${d.labelCheck.checked} of ${esc(d.yourApp)}'s reviews and agreed on ${d.labelCheck.share}%. ` : ''}Quotes are real reviews; reviewer names are never stored. Made with App Review Battlecard on Apify.</p>
</div></body></html>`;
}

export function renderMarkdown(d: ReportData): string {
    const themes = THEMES.filter((t) => t.code !== 'OTHER');
    const lines: string[] = [];
    lines.push(`# ⚔️ ${d.yourApp} vs ${d.rivals.join(' vs ')}`, '');
    lines.push(`App Review Battlecard · ${d.store} ${d.country.toUpperCase()} · ${d.generatedAt.slice(0, 10)}`, '');
    lines.push(`> **${d.verdict}**`, '');
    lines.push('## 🟢 Opportunities (where rivals are weaker)', '');
    for (const c of d.opportunities) {
        lines.push(`- **${c.headline}**: ${c.evidence}${c.confidence ? ` (confidence: ${c.confidence})` : ''}`);
        if (c.caution) lines.push(`  - ${c.caution}`);
        lines.push(`  - Message: ${c.message}`);
        for (const q of c.quotes) lines.push(`  - “${q}”`);
    }
    if (!d.opportunities.length) lines.push('- No clear rival weakness in this sample.');
    lines.push('', '## 🔴 Threats (where you are weaker)', '');
    for (const c of d.threats) {
        lines.push(`- **${c.headline}**: ${c.evidence}${c.confidence ? ` (confidence: ${c.confidence})` : ''}`, `  - Action: ${c.action}`);
        for (const q of c.quotes) lines.push(`  - “${q}”`);
    }
    if (!d.threats.length) lines.push('- No clear weakness vs rivals in this sample.');
    if (d.switching.length) {
        lines.push('', '## 🔁 Switching signals (unhappy users who name another app)', '');
        for (const sw of d.switching) {
            lines.push(`- **${sw.count} of ${sw.app}'s ${sw.negativeReviews} recent 1–2★ reviews mention ${sw.mentions}**`);
            for (const q of sw.quotes) lines.push(`  - “${q}”`);
        }
    }
    if (d.yourIssues.length) {
        lines.push('', `## 🛠 Bug triage: ${d.yourApp}'s top issues (fix the first 3 first)`, '');
        d.yourIssues.forEach((i, n) => {
            lines.push(`${n + 1}. **${i.title}**: mentioned in ${i.count} reviews (${i.shareOfNegative}% of 1–2★), owner: ${i.owner}${i.inCurrentVersion !== null ? `, ${i.inCurrentVersion} in the current version` : ''}`);
            if (i.quotes[0]) lines.push(`   - “${i.quotes[0]}”`);
        });
    }
    lines.push('', "## Complaint mix (share of each app's own specific 1–2★ complaints; vague reviews left out)", '');
    lines.push(`| Theme | ${d.apps.map((a) => a.name + (a.isYours ? ' (you)' : '')).join(' | ')} |`);
    lines.push(`|---|${d.apps.map(() => '---').join('|')}|`);
    for (const t of themes) {
        lines.push(`| ${t.label} | ${d.apps.map((a) => `${a.themeShares[t.code] ?? 0}% (${a.themeCounts[t.code] ?? 0})`).join(' | ')} |`);
    }
    lines.push('', '## Data', '');
    for (const a of d.apps) {
        lines.push(
            `- **${a.name}**: ${a.reviewsAnalyzed} recent reviews (${day(a.from)} → ${day(a.to)}), ${a.negativeReviews} are 1–2★ (${a.negativeShare}%), recent avg ${a.avgRatingRecent}★, store ${a.storeRating ?? '?'}★.${a.replyRateToNegative !== null ? ` Developer replied to ${a.replyRateToNegative}% of 1–2★ reviews.` : ''}${a.releaseNote ? ` ${a.releaseNote}` : ''}`,
        );
    }
    if (d.skipped?.length) lines.push('', `Skipped: ${d.skipped.join(', ')}.`);
    if (d.labelCheck?.checked) {
        lines.push(
            '',
            `Accuracy check: a second, independent AI pass re-labelled ${d.labelCheck.checked} of ${d.yourApp}'s reviews and agreed on ${d.labelCheck.agreed} (${d.labelCheck.share}%). Confidence on each gap comes from a two-proportion z-test (high = about 95% sure the gap is not chance).`,
        );
    }
    return lines.join('\n');
}
