// Version 2 of the report page ("studio"): minimal and editorial, dark by default, with a Light/Dark switch.
// The switch is a hidden checkbox plus CSS :has(), so it works even though Apify serves the page without scripts.
import { THEMES } from './analysis.js';
import { type AppSummary, type CardItem, esc, fmtDay, quotesHtml, type ReportData, stars } from './report.js';

const dot = (i: number) => `<span class="dot" style="--c:var(--a${Math.max(0, i)})"></span>`;
const youTag = (isYours: boolean) => (isYours ? ' <span class="you">you</span>' : '');
const barWidth = (v: number, scale: number) => `${Math.max(v > 0 ? 2 : 0, Math.min(100, (v / scale) * 100)).toFixed(1)}%`;
const appIdx = (d: ReportData, name: string) => Math.max(0, d.apps.findIndex((a) => a.name === name));

/** Thin horizontal bar; the value is always printed, so colour is never the only signal. */
function bar(nameHtml: string, value: number, i: number, scale: number): string {
    return `<div class="b"><span class="bn">${dot(i)}${nameHtml}</span><span class="bt" aria-hidden="true"><i style="width:${barWidth(value, scale)};background:var(--a${i})"></i></span><span class="bv">${value}%</span></div>`;
}

/**
 * A collapsed section: the summary row shows the number, title and a one-line takeaway; clicking it reveals the detail.
 * Uses <details>, so it works without scripts (Apify serves the page without them).
 */
function sec(id: string, no: number, title: string, _takeaway: string, lead: string, body: string): string {
    return `<section id="${id}"><div class="shead"><span class="no">${String(no).padStart(2, '0')}</span><div><h2>${title}</h2><p>${lead}</p></div></div>${body}</section>`;
}

/** Per theme: your share minus the best rival's share. Positive means you are worse. Sorted worst first. */
function gapRows(d: ReportData) {
    return THEMES.filter((t) => t.code !== 'OTHER')
        .map((t) => {
            const vals = d.apps.map((a) => a.themeShares[t.code] ?? 0);
            const rivalMax = Math.max(0, ...vals.slice(1));
            return { t, vals, gap: Math.round(((vals[0] ?? 0) - rivalMax) * 10) / 10 };
        })
        .sort((a, b) => b.gap - a.gap);
}

/** Theme label without its bracketed examples, for one-line summaries. */
const shortLabel = (s: string) => s.replace(/\s*\(.*?\)/g, '').trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// ---------- Scoreboard: one column per app, with a ring and a star-mix bar ----------

function starBar(a: AppSummary): string {
    const keys = ['1', '2', '3', '4', '5'];
    const total = keys.reduce((s, k) => s + (a.starMix[k] ?? 0), 0) || 1;
    const share = (k: string) => Math.round(((a.starMix[k] ?? 0) / total) * 100);
    const alpha = [1, 0.72, 0.46, 0.3, 0.18];
    const segs = keys.map((k, n) => `<span style="flex:${a.starMix[k] ?? 0};opacity:${alpha[n]}" title="${k}★: ${a.starMix[k] ?? 0} reviews"></span>`).join('');
    const label = keys.map((k) => `${k}★ ${share(k)}%`).join(', ');
    return `<div class="stars"><div class="sbar" role="img" aria-label="Star mix: ${label}">${segs}</div><p class="scap"><span>1★ ${share('1')}%</span><span>5★ ${share('5')}%</span></p></div>`;
}

function scoreboard(d: ReportData, no: number): string {
    const cols = d.apps
        .map((a, i) => {
            const reply = a.replyRateToNegative !== null ? `<div><dt>Replies to 1–2★</dt><dd>${a.replyRateToNegative}%</dd></div>` : '';
            return `<div class="col" style="--c:var(--a${i})">
<div class="who">${a.icon ? `<img src="${esc(a.icon)}" alt="">` : dot(i)}<b>${esc(a.name)}</b>${youTag(a.isYours)}</div>
<div class="ring" style="--p:${a.negativeShare}" role="img" aria-label="${a.negativeShare}% of recent reviews are 1 or 2 stars"><span>${Math.round(a.negativeShare)}<small>%</small></span></div>
<p class="rcap">of recent reviews are 1–2★</p>
${starBar(a)}
<dl class="facts"><div><dt>Recent average</dt><dd>${stars(a.avgRatingRecent)}</dd></div><div><dt>Store rating</dt><dd>${stars(a.storeRating)}</dd></div>${reply}</dl>
<p class="fine">${a.reviewsAnalyzed} reviews, ${fmtDay(a.from)} to ${fmtDay(a.to)}${a.currentVersion ? ` · v${esc(a.currentVersion)}` : ''}</p>
${a.releaseNote ? `<p class="fine rel">${esc(a.releaseNote)}</p>` : ''}
</div>`;
        })
        .join('');
    const tk = `${d.apps.map((a) => `${esc(a.name)} ${Math.round(a.negativeShare)}%`).join(' · ')} of recent reviews are 1–2★.`;
    return sec('scoreboard', no, 'Scoreboard', tk, 'Who is losing more reviews, and how they are replying.', `<div class="cols" style="--n:${d.apps.length}">${cols}</div>`);
}

// ---------- Complaint mix: a dot plot, one row per theme, one dot per app ----------

function mixSection(d: ReportData, no: number): string {
    const rows = gapRows(d);
    const max = Math.max(1, ...rows.flatMap((r) => r.vals));
    const step = max <= 50 ? 10 : 20;
    const top = Math.max(step, Math.ceil(max / step) * step);
    const n = top / step;
    const ticks = Array.from({ length: n + 1 }, (_, k) => `<span>${k * step}%</span>`).join('');
    const legend = d.apps.map((a, i) => `<span class="key">${dot(i)}${esc(a.name)}${youTag(a.isYours)}</span>`).join('');
    const body = rows
        .map(({ t, vals, gap }) => {
            const lo = Math.min(...vals);
            const hi = Math.max(...vals);
            const pos = (v: number) => `${((v / top) * 100).toFixed(2)}%`;
            const dots = d.apps
                .map((a, i) => {
                    const tip = `${a.name}: ${a.themeCounts[t.code] ?? 0} of ${a.concrete ?? a.classified} specific 1–2★ complaints (${vals[i]}%)`;
                    return `<span class="pt" style="left:${pos(vals[i] ?? 0)};background:var(--a${i});z-index:${d.apps.length - i}" title="${esc(tip)}"></span>`;
                })
                .join('');
            const nums = d.apps.map((_, i) => `<span>${dot(i)}${vals[i]}</span>`).join('');
            const abs = Math.round(Math.abs(gap));
            const verdict = abs < 1 ? ['level', 'even'] : gap > 0 ? ['worse', `${abs} pts worse`] : ['better', `${abs} pts better`];
            return `<div class="mrow"><div class="mlab"><span>${esc(t.label)}</span><small>${esc(t.owner)}</small></div>
<div class="plot" style="--n:${n}"><span class="rail" style="left:${pos(lo)};width:${(((hi - lo) / top) * 100).toFixed(2)}%"></span>${dots}</div>
<div class="mnums">${nums}</div><div class="mgap ${verdict[0]}">${verdict[1]}</div></div>`;
        })
        .join('');
    const worst = rows[0];
    const best = rows[rows.length - 1];
    const tk =
        worst && best && d.apps.length > 1
            ? `Furthest behind: ${esc(shortLabel(worst.t.label))} (${worst.gap > 0 ? `${Math.round(worst.gap)} pts worse` : 'no theme where you trail'}). Furthest ahead: ${esc(shortLabel(best.t.label))} (${best.gap < 0 ? `${Math.round(-best.gap)} pts better` : 'none'}).`
            : "Each theme's share of every app's own 1–2★ reviews.";
    return sec('mix', no, 'Complaint mix', tk, "Share of each app's own specific 1–2★ complaints that are about each theme (vague reviews like \"bad\" or \"ok\" are left out). Compare the mix, not the average stars. Sorted from where you are worst to where you are best.",
`<div class="legend">${legend}</div>
<div class="mchart"><div class="mrow maxis"><div class="mlab"></div><div class="plot ticks">${ticks}</div><div class="mnums"></div><div class="mgap"></div></div>${body}</div>`);
}

// ---------- Moves: opportunities and threats ----------

function moveHtml(d: ReportData, c: CardItem, kind: 'opp' | 'thr', scale: number): string {
    const rival = bar(esc(c.rival), c.rivalShare, appIdx(d, c.rival), scale);
    const you = bar(`${esc(d.yourApp)}${youTag(true)}`, c.yourShare, 0, scale);
    const duel = kind === 'opp' ? rival + you : you + rival;
    const act =
        kind === 'opp'
            ? `<p class="act"><span class="lbl">Message to run</span>${esc(c.message)}</p>`
            : `<p class="act"><span class="lbl">Fix · ${esc(c.owner)}</span>${esc(c.action)}</p>`;
    const caution = c.caution ? `<p class="caution"><span class="tag">Fix first</span>${esc(c.caution)}</p>` : '';
    const conf = c.confidence
        ? `<small class="conf ${c.confidence}" title="Two-proportion z-test on the labelled reviews">${c.confidence} confidence</small>`
        : '';
    return `<article class="move"><div class="big"><b>${Math.abs(c.gapPoints)}</b><small>pts gap</small>${conf}</div>
<div class="mbody"><p class="th">${esc(c.themeLabel)}</p><h3>${esc(c.headline)}</h3>
<div class="duel" title="${esc(c.evidence)}">${duel}</div>${caution}${act}${quotesHtml(c.quotes)}</div></article>`;
}

/** Labelling coverage and the second-pass agreement check, in one sentence. */
function accuracyLine(d: ReportData): string {
    const cover = d.apps
        .map((a) => `${esc(a.name)} ${a.classified}${a.sampled ? ` of ${a.sampled}` : ''}${a.concrete !== undefined ? ` (${a.classified - a.concrete} vague)` : ''}`)
        .join(', ');
    const check = d.labelCheck?.checked
        ? ` A second, independent AI pass re-labelled ${d.labelCheck.checked} of ${esc(d.yourApp)}'s reviews and agreed on ${d.labelCheck.share}%.`
        : '';
    const skip = d.skipped?.length ? `Skipped: ${esc(d.skipped.join(', '))}. ` : '';
    return `${skip}Reviews labelled: ${cover}.${check} `;
}

function moves(d: ReportData, no: number): string {
    const scale = Math.max(1, ...[...d.opportunities, ...d.threats].flatMap((c) => [c.yourShare, c.rivalShare]));
    const group = (kind: 'opp' | 'thr', title: string, sub: string, items: CardItem[]) =>
        items.length
            ? `<div class="group ${kind}"><h3 class="gh"><span class="mark"></span>${title}<small>${sub}</small></h3>${items.map((c) => moveHtml(d, c, kind, scale)).join('')}</div>`
            : '';
    const tk = `${d.opportunities.length} opportunit${d.opportunities.length === 1 ? 'y' : 'ies'} to message, ${d.threats.length} threat${d.threats.length === 1 ? '' : 's'} to fix.`;
    return sec('moves', no, 'Moves', tk, 'What to say where rivals are weak, and what to fix where you are.',
`${group('opp', 'Opportunities', "Where a rival's users complain more than yours.", d.opportunities)}
${group('thr', 'Threats', "Where your users complain more than a rival's.", d.threats)}`);
}

// ---------- Switching signals ----------

function switching(d: ReportData, no: number): string {
    if (!d.switching.length) return '';
    const items = d.switching
        .map((sw) => {
            const kind = sw.app === d.yourApp ? 'thr' : sw.mentions === d.yourApp ? 'opp' : 'neutral';
            const text = kind === 'thr' ? 'Your unhappy users name a rival' : kind === 'opp' ? "A rival's unhappy users name you" : 'Between rivals';
            const share = sw.negativeReviews ? (sw.count / sw.negativeReviews) * 100 : 0;
            return `<article class="sig ${kind}"><div class="sstat"><b>${sw.count}</b><small>of ${sw.negativeReviews} · ${share.toFixed(1)}%</small></div>
<div class="sbody"><p class="flow">${dot(appIdx(d, sw.app))}${esc(sw.app)}<span class="arrow">to</span>${dot(appIdx(d, sw.mentions))}${esc(sw.mentions)}<span class="kind">${text}</span></p>
<p class="sline">${sw.count} of ${esc(sw.app)}'s recent 1–2★ reviews mention ${esc(sw.mentions)}.</p>
<div class="meter" aria-hidden="true"><i style="width:${Math.max(1.5, share).toFixed(1)}%"></i></div>${quotesHtml(sw.quotes)}</div></article>`;
        })
        .join('');
    const tk = d.switching
        .slice(0, 2)
        .map((sw) => `${sw.count} of ${esc(sw.app)}'s 1–2★ reviews name ${esc(sw.mentions)}`)
        .join('; ');
    return sec('switching', no, 'Switching signals', `${tk}.`, 'Unhappy reviews that name another app in this comparison.', `<div class="sigs">${items}</div>`);
}

// ---------- Bug triage ----------

function triage(d: ReportData, no: number): string {
    if (!d.yourIssues.length) return '';
    const ver = d.apps[0]?.currentVersion ?? null;
    const showVer = Boolean(ver) && d.yourIssues.some((i) => i.inCurrentVersion !== null);
    const total = d.apps[0]?.classified ?? 0;
    const scale = Math.max(1, ...d.yourIssues.map((i) => i.count));
    const rows = d.yourIssues
        .map((it, n) => {
            const first = n < 3;
            return `<tr class="${first ? 'first' : ''}"><td class="rk">${String(n + 1).padStart(2, '0')}</td>
<td><b>${esc(it.title)}</b>${first ? ' <span class="tag">Fix first</span>' : ''}<small>${esc(it.owner)} · ${esc(it.themeLabel)}</small>${it.quotes[0] ? `<q>${esc(it.quotes[0])}</q>` : ''}</td>
<td class="cnt"><div class="b"><span class="bt" aria-hidden="true"><i style="width:${barWidth(it.count, scale)};background:var(--a0)"></i></span><span class="bv">${it.count}</span></div><small>${it.shareOfNegative}% of 1–2★</small></td>
${showVer ? `<td class="ver">${it.inCurrentVersion ?? '-'}</td>` : ''}</tr>`;
        })
        .join('');
    const tk = `Fix first: ${d.yourIssues.slice(0, 3).map((i) => esc(clip(i.title, 48))).join('; ')}.`;
    return sec('triage', no, `Bug triage: ${esc(d.yourApp)}`, tk, `Specific recurring issues in your ${total} most recent 1–2★ reviews. Start with the first three. A review can mention several issues, so counts overlap.`,
`<table class="issues"><thead><tr><th></th><th>Issue · owner team</th><th>Reviews mentioning it</th>${showVer ? `<th>On v${esc(ver)}</th>` : ''}</tr></thead><tbody>${rows}</tbody></table>`);
}

const CSS = `
:root{color-scheme:dark;--page:#13121a;--ink:#ecebf2;--ink2:#b6b4c6;--muted:#8d8aa0;--line:#2b2938;--faint:#1b1a25;--track:rgba(255,255,255,.1);--good:#7bd88f;--bad:#f08aa0;--warn:#f0c040;--a0:#8273e6;--a1:#d75a7f;--a2:#1b98bf;--a3:#b98317;--serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Times New Roman",serif;--sans:system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;--mono:ui-monospace,"SF Mono","Cascadia Mono",Consolas,Menlo,monospace}
:root:has(#light:checked){color-scheme:light;--page:#f6f4ef;--ink:#17150f;--ink2:#4a473f;--muted:#6b675c;--line:#d8d3c6;--faint:#ece8dd;--track:rgba(23,21,15,.09);--good:#1c7a3a;--bad:#b3261e;--warn:#b07d00;--a0:#00846b;--a1:#d9531e;--a2:#2b59c3;--a3:#b07d00}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--page);color:var(--ink);font:16px/1.6 var(--sans)}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;margin:0}
.bar{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--page) 88%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.bar-in{max-width:1080px;margin:0 auto;padding:0 32px;height:56px;display:flex;align-items:center;gap:28px}
.brand{font:600 11px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ink);margin-right:auto}
.bar a{font:500 12px/1 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);text-decoration:none;padding:6px 0;border-bottom:1.5px solid transparent}
.bar a:hover{color:var(--ink);border-bottom-color:var(--ink)}
.mode{display:inline-flex;align-items:center;gap:10px;cursor:pointer;font:600 11px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;user-select:none}
.mode .pill{width:34px;height:18px;border-radius:9px;border:1.5px solid var(--ink);position:relative;display:block}
.mode .pill i{position:absolute;top:2px;left:2px;width:11px;height:11px;border-radius:50%;background:var(--ink);transition:transform .2s}
.m-dark{color:var(--ink)}.m-light{color:var(--muted)}
:root:has(#light:checked) .mode .pill i{transform:translateX(16px)}
:root:has(#light:checked) .m-dark{color:var(--muted)}:root:has(#light:checked) .m-light{color:var(--ink)}
#light:focus-visible~.bar .mode{outline:2px solid var(--ink);outline-offset:5px;border-radius:4px}
@media(prefers-reduced-motion:reduce){.mode .pill i{transition:none}html{scroll-behavior:auto}}
main{max-width:1080px;margin:0 auto;padding:0 32px 96px}
.hero{padding:88px 0 8px}
.kicker{margin:0 0 28px;font:600 11px/1 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
h1{margin:0;font:400 clamp(40px,7vw,76px)/1.04 var(--serif);letter-spacing:-.02em;display:flex;flex-wrap:wrap;align-items:center;gap:6px 22px}
h1 .nm{display:inline-flex;align-items:center;gap:14px}h1 .nm img{width:clamp(34px,5vw,52px);height:clamp(34px,5vw,52px);border-radius:24%}
h1 .vs{font:italic 400 .42em/1 var(--serif);color:var(--muted)}
.meta{margin:26px 0 0;font:500 12px/1.4 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.verdict{margin-top:64px;padding-top:28px;border-top:1px solid var(--line);display:grid;grid-template-columns:140px 1fr;gap:12px 32px}
.verdict .lbl{font:600 11px/2.6 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.verdict p{margin:0;max-width:30em;font:400 clamp(22px,3vw,32px)/1.3 var(--serif)}
.lbl{display:block;font:600 11px/1.4 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
section{margin-top:128px;scroll-margin-top:84px}
.shead{display:grid;grid-template-columns:140px 1fr;gap:12px 32px;margin-bottom:48px;align-items:baseline}
.shead .no{font:400 15px/1 var(--mono);color:var(--muted);letter-spacing:.1em}
h2{margin:0;font:400 clamp(28px,3.6vw,40px)/1.15 var(--serif);letter-spacing:-.01em}
.shead p{margin:12px 0 0;max-width:40em;color:var(--ink2);font-size:15px}
h3{margin:0;font:400 22px/1.3 var(--serif)}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--c);margin-right:8px;vertical-align:1px;flex:none}
.you{font:600 10px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;border:1px solid currentColor;border-radius:3px;padding:2px 5px;margin-left:4px;vertical-align:2px;color:var(--ink2)}
.tag{display:inline-block;font:600 10px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;border:1px solid var(--warn);color:var(--warn);border-radius:3px;padding:3px 6px;margin-right:10px;vertical-align:2px}
.fine{margin:6px 0 0;font-size:13px;color:var(--muted);line-height:1.5}

.cols{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:0}
.col{padding:0 36px;border-left:1px solid var(--line)}.col:first-child{padding-left:0;border-left:0}.col:last-child{padding-right:0}
.who{display:flex;align-items:center;gap:10px;margin-bottom:36px;font-size:16px}.who img{width:30px;height:30px;border-radius:24%}
.ring{--p:0;width:132px;height:132px;border-radius:50%;background:conic-gradient(var(--c) calc(var(--p)*1%),var(--track) 0);display:grid;place-items:center;position:relative}
.ring::after{content:"";position:absolute;inset:11px;border-radius:50%;background:var(--page)}
.ring span{position:relative;z-index:1;font:400 38px/1 var(--serif)}.ring small{font-size:.5em;margin-left:1px;color:var(--muted)}
.rcap{margin:14px 0 36px;font-size:13px;color:var(--muted)}
.stars{margin-bottom:36px}.sbar{display:flex;gap:2px;height:10px}.sbar span{display:block;background:var(--c);border-radius:2px;min-width:0}
.scap{display:flex;justify-content:space-between;margin:8px 0 0;font:500 11px/1 var(--mono);color:var(--muted)}
.facts{margin:0;display:grid;gap:14px}.facts div{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding-bottom:14px;border-bottom:1px solid var(--line)}
.facts dt{font-size:13px;color:var(--ink2)}.facts dd{margin:0;font:400 24px/1 var(--serif)}
.rel{margin-top:14px}

.legend{display:flex;flex-wrap:wrap;gap:8px 28px;margin:0 0 32px;font-size:14px}.key{display:inline-flex;align-items:center}
.mchart{display:block}
.mrow{display:grid;grid-template-columns:minmax(180px,1.1fr) 3fr 92px 104px;gap:28px;align-items:center;padding:20px 0;border-top:1px solid var(--line)}
.maxis{border-top:0;padding:0 0 8px}
.mlab span{display:block;font-size:15px;line-height:1.35}.mlab small{display:block;margin-top:4px;font:500 11px/1.3 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.plot{position:relative;height:28px;margin:0 8px;background-image:linear-gradient(to right,var(--line) 1px,transparent 1px);background-size:calc(100%/var(--n)) 100%;border-right:1px solid var(--line)}
.plot.ticks{height:auto;display:flex;justify-content:space-between;background:none;border:0;font:500 11px/1 var(--mono);color:var(--muted)}
.rail{position:absolute;top:50%;height:2px;margin-top:-1px;background:var(--muted);opacity:.55}
.pt{position:absolute;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;box-shadow:0 0 0 2px var(--page)}
.mnums{display:flex;gap:12px;font:500 13px/1 var(--mono);color:var(--ink2);justify-content:flex-end}.mnums .dot{margin-right:5px}
.mgap{font:600 11px/1.2 var(--mono);letter-spacing:.06em;text-transform:uppercase;text-align:right;color:var(--muted)}
.mgap.worse{color:var(--bad)}.mgap.better{color:var(--good)}

.group+.group{margin-top:80px}
.gh{display:flex;align-items:baseline;gap:14px;font:400 26px/1.2 var(--serif);margin-bottom:8px}
.gh small{font:400 14px/1.4 var(--sans);color:var(--muted)}.gh .mark{display:inline-block;width:12px;height:12px;border-radius:2px;background:var(--good);align-self:center}
.group.thr .mark{background:var(--bad)}
.move{display:grid;grid-template-columns:140px 1fr;gap:12px 32px;padding:44px 0;border-top:1px solid var(--line)}.group .move:first-of-type{margin-top:28px}
.big b{display:block;font:400 64px/1 var(--serif);letter-spacing:-.02em}.big small{font:500 11px/1.4 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.big .conf{display:block;margin-top:8px;color:var(--ink2)}.big .conf.low{color:var(--muted);opacity:.8}.big .conf.high{color:var(--ink)}
.mbody{max-width:640px}.th{margin:0 0 10px;font:600 11px/1.4 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.duel{margin:28px 0 8px}
.b{display:grid;grid-template-columns:150px 1fr 44px;align-items:center;gap:14px;margin:12px 0;font-size:14px}
.bn{display:flex;align-items:center;white-space:nowrap}.bt{display:block;height:6px;border-radius:3px;background:var(--track);overflow:hidden}.bt i{display:block;height:100%;border-radius:3px}
.bv{text-align:right;font:500 13px/1 var(--mono)}
.act{margin:28px 0 0;font-size:16px}.caution{margin:24px 0 0;padding-left:16px;border-left:2px solid var(--warn);font-size:14px;color:var(--ink2)}
blockquote{margin:24px 0 0;padding-left:16px;border-left:1px solid var(--muted);font:italic 400 16px/1.55 var(--serif);color:var(--ink2)}
blockquote+blockquote{margin-top:16px}
details{margin-top:18px}summary{cursor:pointer;font:500 11px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}summary:hover{color:var(--ink)}

.sigs{display:grid;grid-template-columns:1fr 1fr;gap:0 64px}
.sig{display:grid;grid-template-columns:96px 1fr;gap:12px 24px;padding:40px 0;border-top:1px solid var(--line)}
.sstat b{display:block;font:400 56px/1 var(--serif)}.sstat small{display:block;margin-top:8px;font:500 11px/1.4 var(--mono);color:var(--muted)}
.flow{display:flex;flex-wrap:wrap;align-items:center;margin:0 0 10px;font-size:15px}.flow .arrow{margin:0 10px;font:italic 400 14px/1 var(--serif);color:var(--muted)}
.flow .kind{width:100%;margin-top:8px;font:600 11px/1.3 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.sig.thr .kind{color:var(--bad)}.sig.opp .kind{color:var(--good)}
.sline{margin:0 0 16px;font-size:15px}.meter{height:6px;border-radius:3px;background:var(--track);overflow:hidden}.meter i{display:block;height:100%;background:var(--ink2);border-radius:3px}
.sig blockquote{margin-top:20px;font-size:15px}

.issues{width:100%;border-collapse:collapse}
.issues th{text-align:left;font:600 11px/1.3 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);padding:0 24px 16px 0;border-bottom:1px solid var(--ink)}
.issues td{vertical-align:top;padding:32px 24px 32px 0;border-bottom:1px solid var(--line)}
.issues .rk{width:56px;font:400 15px/1.6 var(--mono);color:var(--muted)}
.issues td b{font:400 19px/1.35 var(--serif)}.issues td small{display:block;margin-top:6px;font:500 11px/1.4 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.issues q{display:block;margin-top:14px;max-width:34em;font:italic 400 15px/1.55 var(--serif);color:var(--ink2);quotes:"\\201C" "\\201D"}
.issues .cnt{width:210px}.issues .cnt .b{grid-template-columns:1fr 32px;margin:6px 0 0}.issues .cnt small{text-transform:none;letter-spacing:0;font-family:var(--sans);font-size:12px}
.issues .ver{width:90px;font:400 26px/1.2 var(--serif)}
.foot{margin:128px 0 0;padding-top:24px;border-top:1px solid var(--line);max-width:46em;font-size:13px;color:var(--muted)}
.foot b{color:var(--ink2);font-weight:600}.foot .lbl{margin-bottom:8px}

.overview{margin-top:56px}
.ovgrid{display:grid;grid-template-columns:repeat(var(--n,4),minmax(0,1fr));border-top:1px solid var(--line);border-left:1px solid var(--line);margin-top:14px}
.ov{padding:24px 24px 26px;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}
.ov .lbl{margin-bottom:12px}.ov.good .lbl{color:var(--good)}.ov.bad .lbl{color:var(--bad)}
.ov-apps{display:grid;gap:10px}.ov-app{display:flex;align-items:baseline;gap:0;font-size:15px}.ov-app>span:not(.dot){flex:1}
.ov-app b{font:400 30px/1 var(--serif)}.ov-app small{font-size:.5em;color:var(--muted);margin-left:1px}
.ov-h{margin:0;font:400 19px/1.35 var(--serif)}.ov-s{margin:8px 0 0;font:500 11px/1.5 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.ov-l{margin:0;padding-left:20px;font:400 16px/1.4 var(--serif)}.ov-l li{margin:0 0 8px}.ov-l small{font:500 11px/1 var(--mono);color:var(--muted);margin-left:6px}
.ov-hint{margin:14px 0 0;font-size:13px;color:var(--muted)}
.secs{margin-top:72px;border-top:1px solid var(--ink)}
details.sec{margin:0;border-bottom:1px solid var(--line);scroll-margin-top:72px}
.sec>summary{list-style:none;display:grid;grid-template-columns:140px 1fr auto;gap:12px 32px;align-items:center;padding:32px 0;cursor:pointer;font:inherit;letter-spacing:0;text-transform:none;color:var(--ink)}
.sec>summary::-webkit-details-marker{display:none}
.sec>summary .no{font:400 15px/1 var(--mono);color:var(--muted);letter-spacing:.1em}
.sec>summary h2{font-size:clamp(24px,3vw,32px)}
.sec>summary .tk{display:block;margin-top:8px;max-width:46em;font-size:15px;line-height:1.5;color:var(--ink2)}
.sec>summary:hover h2{text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:6px}
.sec>summary:focus-visible{outline:2px solid var(--ink);outline-offset:4px}
.tog{display:inline-flex;align-items:center;gap:12px;font:600 11px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.tl::before{content:"Show details"}.sec[open] .tl::before{content:"Hide"}
.chev{display:block;width:9px;height:9px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:translateY(-2px) rotate(45deg);transition:transform .2s}
.sec[open] .chev{transform:translateY(2px) rotate(-135deg)}
.sec>summary:hover .tog{color:var(--ink)}
.sbody{padding:8px 0 88px}.sbody .lead{margin:0 0 40px 172px;max-width:40em;color:var(--ink2);font-size:15px}
@media(prefers-reduced-motion:reduce){.chev{transition:none}}

@media(max-width:900px){
.ovgrid{grid-template-columns:repeat(2,minmax(0,1fr))}
.mrow{grid-template-columns:1fr auto;gap:10px 16px}.mlab{grid-column:1/-1}.plot{grid-column:1/-1;order:2}.mnums{order:3;justify-content:flex-start}.mgap{order:3}.maxis{display:none}
.sigs{grid-template-columns:1fr}.cols{grid-template-columns:1fr;gap:56px}.col,.col:first-child,.col:last-child{padding:0;border-left:0}
}
@media(max-width:700px){
main,.bar-in{padding-left:20px;padding-right:20px}.ovgrid{grid-template-columns:1fr}.sec>summary{grid-template-columns:1fr auto}.sec>summary .no{grid-column:1/-1}.sbody .lead{margin-left:0}.tl{display:none}.bar-in{gap:16px}.bar a{display:none}
.verdict,.shead,.move{grid-template-columns:1fr}.hero{padding-top:56px}section{margin-top:96px}
.b{grid-template-columns:110px 1fr 40px}.issues .ver,.issues th:nth-child(4){display:none}.issues .cnt{width:130px}
}
@media print{.bar{display:none}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}details:not(.sec){display:none}details.sec:not([open])>.sbody{display:block}details.sec:not([open])::details-content{content-visibility:visible;display:block}.tog{display:none}.move,.sig,tr{break-inside:avoid}}
`;

export function renderHtmlStudio(d: ReportData): string {
    const total = d.apps.reduce((s, a) => s + a.reviewsAnalyzed, 0);
    const names = d.apps
        .map((a, i) => `<span class="nm">${a.icon ? `<img src="${esc(a.icon)}" alt="">` : dot(i)}${esc(a.name)}</span>`)
        .join('<span class="vs">vs</span>');
    const when = new Date(d.generatedAt);
    const dateText = Number.isNaN(when.getTime())
        ? esc(d.generatedAt.slice(0, 10))
        : when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

    let no = 0;
    const parts: { id: string; label: string; html: string }[] = [
        { id: 'scoreboard', label: 'Scoreboard', html: scoreboard(d, ++no) },
        { id: 'mix', label: 'Mix', html: mixSection(d, ++no) },
        { id: 'moves', label: 'Moves', html: moves(d, ++no) },
    ];
    const sw = switching(d, no + 1);
    if (sw) parts.push({ id: 'switching', label: 'Switching', html: sw }), no++;
    const tr = triage(d, no + 1);
    if (tr) parts.push({ id: 'triage', label: 'Triage', html: tr }), no++;

    const nav = parts.map((p) => `<a href="#${p.id}">${p.label}</a>`).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Battlecard: ${esc(d.yourApp)} vs ${esc(d.rivals.join(', '))}</title>
<style>${CSS}</style></head><body>
<input type="checkbox" id="light" class="sr-only" autocomplete="off" aria-label="Light theme">
<header class="bar"><div class="bar-in"><span class="brand">App Review Battlecard</span>${nav}<label for="light" class="mode" title="Switch theme"><span class="m-dark">Dark</span><span class="pill"><i></i></span><span class="m-light">Light</span></label></div></header>
<main>
<div class="hero"><p class="kicker">Head-to-head review comparison</p><h1>${names}</h1>
<p class="meta">${esc(d.store)} · ${esc(d.country.toUpperCase())} · ${total.toLocaleString('en-US')} recent reviews · ${dateText}</p>
<div class="verdict"><span class="lbl">Verdict</span><p>${esc(d.verdict)}</p></div>
</div>
${parts.map((p) => p.html).join('\n')}
<p class="foot"><span class="lbl">Method</span>The most recent ${esc(d.store)} reviews per app. An AI model (${esc(d.model)}) labels every 1–2★ review with one theme; shares and gaps are computed in code. We compare the <b>mix</b> of complaints, not average stars, because in-app rating prompts inflate star averages. Each gap carries a confidence from a two-proportion z-test (high: about 95% sure it is not chance). ${accuracyLine(d)}Quotes are real reviews; reviewer names are never stored. Made with App Review Battlecard on Apify.</p>
</main></body></html>`;
}
