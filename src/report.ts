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
}

const esc = (s: unknown) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '?');

function cardHtml(c: CardItem, kind: 'opp' | 'thr'): string {
    const extra = kind === 'opp' ? `<p class="msg">💬 ${esc(c.message)}</p>` : `<p class="msg">🛠 ${esc(c.action)}</p>`;
    const caution = c.caution ? `<p class="caution">${esc(c.caution)}</p>` : '';
    const quotes = c.quotes.map((q) => `<blockquote>“${esc(q)}”</blockquote>`).join('');
    return `<div class="card ${kind}"><h3>${esc(c.headline)}</h3><p class="ev">${esc(c.evidence)}</p>${caution}${extra}${quotes}</div>`;
}

function switchingHtml(d: ReportData): string {
    if (!d.switching.length) return '';
    const cards = d.switching
        .map((sw) => {
            const kind = sw.app === d.yourApp ? 'thr' : sw.mentions === d.yourApp ? 'opp' : '';
            const quotes = sw.quotes.map((q) => `<blockquote>“${esc(q)}”</blockquote>`).join('');
            return `<div class="card ${kind}"><h3>${sw.count} of ${esc(sw.app)}'s ${sw.negativeReviews} recent 1–2★ reviews mention ${esc(sw.mentions)}</h3>${quotes}</div>`;
        })
        .join('');
    return `<h2>🔁 Switching signals: unhappy users who name another app</h2>${cards}`;
}

function issuesHtml(d: ReportData): string {
    if (!d.yourIssues.length) return '';
    const ver = d.apps[0]?.currentVersion ?? null;
    const showVer = ver && d.yourIssues.some((i) => i.inCurrentVersion !== null);
    const rows = d.yourIssues
        .map(
            (i, n) =>
                `<tr><td class="th"><b>${n + 1}. ${esc(i.title)}</b><br><small>${esc(i.owner)}</small></td><td>${i.count} <small>(${i.shareOfNegative}%)</small></td>` +
                `${showVer ? `<td>${i.inCurrentVersion ?? '–'}</td>` : ''}<td><small>${i.quotes[0] ? `“${esc(i.quotes[0])}”` : ''}</small></td></tr>`,
        )
        .join('');
    return `<h2>🛠 Bug triage: ${esc(d.yourApp)}'s top issues (fix the first 3 first)</h2>
<table><tr><th>Issue · owner team</th><th>Mentioned in (of ${d.apps[0]?.classified ?? '?'} 1–2★)</th>${showVer ? `<th>In v${esc(ver)}</th>` : ''}<th>Example</th></tr>${rows}</table>
<p class="foot">A review can mention several issues, so these counts overlap. The complaint mix table below uses each review's main complaint only.</p>`;
}

export function renderHtml(d: ReportData): string {
    const themes = THEMES.filter((t) => t.code !== 'OTHER');
    const head = d.apps.map((a) => `<th>${esc(a.name)}${a.isYours ? ' <span class="you">you</span>' : ''}</th>`).join('');
    const rows = themes
        .map((t) => {
            const vals = d.apps.map((a) => a.themeShares[t.code] ?? 0);
            const max = Math.max(...vals);
            const cells = d.apps
                .map((a, i) => {
                    const v = vals[i];
                    const hot = v === max && v > 0 ? ' class="hot"' : '';
                    return `<td${hot}><div class="bar" style="width:${Math.min(100, v)}%"></div><span>${v}%</span> <small>(${a.themeCounts[t.code] ?? 0})</small></td>`;
                })
                .join('');
            return `<tr><td class="th">${esc(t.label)}<br><small>${esc(t.owner)}</small></td>${cells}</tr>`;
        })
        .join('');
    const stats = d.apps
        .map(
            (a) => `<div class="stat">${a.icon ? `<img src="${esc(a.icon)}" alt="">` : ''}<div><b>${esc(a.name)}</b>${a.isYours ? ' <span class="you">you</span>' : ''}<br>
<small>${a.reviewsAnalyzed} recent reviews (${day(a.from)} → ${day(a.to)}) · ${a.negativeReviews} are 1–2★ (${a.negativeShare}%) · recent avg ${a.avgRatingRecent}★ · store ${a.storeRating ?? '?'}★${a.replyRateToNegative !== null ? ` · developer replied to ${a.replyRateToNegative}% of 1–2★ reviews` : ''}</small>
${a.releaseNote ? `<br><small>🚦 ${esc(a.releaseNote)}</small>` : ''}</div></div>`,
        )
        .join('');

    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Battlecard: ${esc(d.yourApp)} vs ${esc(d.rivals.join(', '))}</title>
<style>
body{font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f6f7fb;color:#1c1e26}
.wrap{max-width:1000px;margin:0 auto;padding:24px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 10px}h3{font-size:15px;margin:0 0 6px}
.sub{color:#5b6070;margin:0 0 16px}.verdict{background:#1c1e26;color:#fff;padding:16px 18px;border-radius:10px;font-size:17px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:760px){.grid{grid-template-columns:1fr}}
.card{background:#fff;border-radius:10px;padding:14px 16px;margin-bottom:12px;border-left:5px solid #999}
.card.opp{border-color:#16a34a}.card.thr{border-color:#dc2626}.ev{color:#5b6070;margin:0 0 6px}.msg{font-weight:600;margin:0 0 6px}.caution{background:#fff7e6;border:1px solid #f5c26b;color:#7a4b00;border-radius:6px;padding:6px 8px;margin:0 0 6px;font-size:13px}
blockquote{margin:6px 0 0;padding:6px 10px;background:#f2f3f7;border-radius:6px;font-size:13px;color:#3a3f4d}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden}
th,td{padding:8px 10px;border-bottom:1px solid #eceef3;text-align:left;vertical-align:top;font-size:14px}
td{position:relative}td span{position:relative;font-weight:600}.bar{position:absolute;left:0;top:0;bottom:0;background:#e8ecff}
td.hot .bar{background:#ffe1e1}.th small,td small{color:#7a7f8e}.you{background:#4f46e5;color:#fff;border-radius:4px;padding:0 5px;font-size:11px}
.stat{display:flex;gap:10px;align-items:flex-start;background:#fff;border-radius:10px;padding:10px 12px;margin-bottom:8px}.stat img{width:40px;height:40px;border-radius:9px}
.foot{color:#7a7f8e;font-size:12px;margin-top:24px}
</style></head><body><div class="wrap">
<h1>⚔️ ${esc(d.yourApp)} vs ${esc(d.rivals.join(' vs '))}</h1>
<p class="sub">App Review Battlecard · ${esc(d.store)} ${esc(d.country.toUpperCase())} · ${esc(d.generatedAt.slice(0, 16).replace('T', ' '))} UTC</p>
<div class="verdict">${esc(d.verdict)}</div>
<div class="grid"><div><h2>🟢 Opportunities: where rivals are weaker</h2>${d.opportunities.map((c) => cardHtml(c, 'opp')).join('') || '<p>No clear rival weakness in this sample.</p>'}</div>
<div><h2>🔴 Threats: where you are weaker</h2>${d.threats.map((c) => cardHtml(c, 'thr')).join('') || '<p>No clear weakness vs rivals in this sample.</p>'}</div></div>
${switchingHtml(d)}
${issuesHtml(d)}
<h2>Complaint mix: share of each app's own 1–2★ reviews</h2>
<table><tr><th>Theme · owner team</th>${head}</tr>${rows}</table>
<h2>Data behind it</h2>${stats}
<p class="foot">Method: the most recent ${esc(d.store)} reviews per app; an AI model (${esc(d.model)}) labels every 1–2★ review with one theme; shares and gaps are computed in code. We compare the <b>mix</b> of complaints, not average stars, because in-app rating prompts inflate star averages. Quotes are real reviews.</p>
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
        lines.push(`- **${c.headline}**: ${c.evidence}`);
        if (c.caution) lines.push(`  - ${c.caution}`);
        lines.push(`  - Message: ${c.message}`);
        for (const q of c.quotes) lines.push(`  - “${q}”`);
    }
    if (!d.opportunities.length) lines.push('- No clear rival weakness in this sample.');
    lines.push('', '## 🔴 Threats (where you are weaker)', '');
    for (const c of d.threats) {
        lines.push(`- **${c.headline}**: ${c.evidence}`, `  - Action: ${c.action}`);
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
    lines.push('', "## Complaint mix (share of each app's own 1–2★ reviews)", '');
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
    return lines.join('\n');
}
