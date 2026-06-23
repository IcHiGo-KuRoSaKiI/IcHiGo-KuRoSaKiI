#!/usr/bin/env node
/**
 * ICHI.DEV contribution heatmap generator.
 * Counts commits authored by the user across ALL repos (public + private)
 * the token can see, and renders a brand-themed SVG. Emits ONLY daily counts
 * and aggregate stats — never repo names, messages, or code.
 *
 * Env: GH_TOKEN | METRICS_TOKEN | GITHUB_TOKEN  (needs repo/contents read)
 *      GH_LOGIN (default IcHiGo-KuRoSaKiI), OUT (default ./contributions.svg)
 */
const TOKEN = process.env.GH_TOKEN || process.env.METRICS_TOKEN || process.env.GITHUB_TOKEN;
const LOGIN = process.env.GH_LOGIN || 'IcHiGo-KuRoSaKiI';
const OUT   = process.env.OUT || './contributions.svg';
const API   = 'https://api.github.com';
if (!TOKEN) { console.error('No token in env (GH_TOKEN / METRICS_TOKEN / GITHUB_TOKEN)'); process.exit(1); }

const H = { 'Authorization': `Bearer ${TOKEN}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'ichidev-heatmap' };

async function gh(path) {
  const url = path.startsWith('http') ? path : API + path;
  const r = await fetch(url, { headers: H });
  const next = (r.headers.get('link') || '').match(/<([^>]+)>;\s*rel="next"/);
  if (r.status === 409 || r.status === 404) return { data: [], next: null }; // empty/missing repo
  if (!r.ok) { console.error(`  ! ${r.status} ${path.slice(0, 70)}`); return { data: [], next: null }; }
  return { data: await r.json(), next: next ? next[1] : null };
}
async function ghAll(path) {
  let out = [], p = path;
  while (p) { const { data, next } = await gh(p); if (Array.isArray(data)) out = out.concat(data); p = next; }
  return out;
}

(async () => {
  const since = new Date(Date.now() - 371 * 864e5).toISOString();
  console.error(`Listing repos for ${LOGIN}…`);
  const repos = await ghAll(`/user/repos?per_page=100&affiliation=owner&sort=pushed`);
  console.error(`  ${repos.length} repos (public + private)`);

  const counts = {};                       // 'YYYY-MM-DD' -> commit count
  let total = 0, scanned = 0;
  for (const r of repos) {
    let p = `/repos/${r.full_name}/commits?author=${encodeURIComponent(LOGIN)}&since=${since}&per_page=100`;
    while (p) {
      const { data, next } = await gh(p);
      if (!Array.isArray(data)) break;
      for (const c of data) {
        const d = (c.commit?.author?.date || c.commit?.committer?.date || '').slice(0, 10);
        if (d) { counts[d] = (counts[d] || 0) + 1; total++; }
      }
      p = next;
    }
    scanned++;
  }
  console.error(`  scanned ${scanned} repos · ${total} authored commits in the last year`);

  // ---- build a 53-week grid ending today (start on the prior Sunday) ----
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today); start.setDate(start.getDate() - 364);
  while (start.getDay() !== 0) start.setDate(start.getDate() - 1);
  const days = [];
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    days.push({ date: new Date(d), key, n: counts[key] || 0 });
  }
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  // ---- stats ----
  const activeDays = days.filter(d => d.n > 0).length;
  let longest = 0, run = 0;
  for (const d of days) { run = d.n > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].n > 0) current++;
    else if (i === days.length - 1) continue; // today not yet committed — keep counting back
    else break;
  }

  // ---- render SVG ----
  const C = ['#12121f', '#0d3a4a', '#157a99', '#2bb6dd', '#50dcff'];
  const lvl = n => !n ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : n <= 9 ? 3 : 4;
  const CELL = 12, GAP = 3, PITCH = CELL + GAP, PAD = 18, LBL = 28, TITLE = 60, MON = 16;
  const gx = PAD + LBL, gy = PAD + TITLE + MON;
  const W = gx + weeks.length * PITCH + PAD;
  const Hh = gy + 7 * PITCH + 26 + PAD;
  const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  let cells = '', months = '', lastMon = -1;
  weeks.forEach((wk, wi) => {
    const first = wk[0]; const m = first.date.getMonth();
    if (m !== lastMon && first.date.getDate() <= 8) { months += `<text x="${gx + wi * PITCH}" y="${gy - 5}" class="mn">${MN[m]}</text>`; lastMon = m; }
    wk.forEach(d => {
      const x = gx + wi * PITCH, y = gy + d.date.getDay() * PITCH;
      const c = C[lvl(d.n)];
      cells += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2.5" fill="${c}"${lvl(d.n) === 4 ? ' filter="url(#g)"' : ''}><title>${d.key}: ${d.n} commit${d.n === 1 ? '' : 's'}</title></rect>`;
    });
  });
  const dayLbl = [['Mon', 1], ['Wed', 3], ['Fri', 5]].map(([t, r]) => `<text x="${gx - 7}" y="${gy + r * PITCH + CELL - 2}" class="dl" text-anchor="end">${t}</text>`).join('');
  const sqPitch = 16, sqSpan = 5 * sqPitch - 5, moreReserve = 38, sqLeftX = W - PAD - moreReserve - sqSpan;
  let legend = ''; for (let i = 0; i < 5; i++) legend += `<rect x="${sqLeftX + i * sqPitch}" y="${Hh - PAD - 11}" width="11" height="11" rx="2.5" fill="${C[i]}"/>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}" font-family="'JetBrains Mono','SF Mono',ui-monospace,Consolas,monospace">
<defs><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.1" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<linearGradient id="edge" x1="0" x2="1"><stop offset="0" stop-color="#50dcff"/><stop offset="0.55" stop-color="#ff4fa3"/><stop offset="1" stop-color="#ffd700"/></linearGradient></defs>
<rect x="0.5" y="0.5" width="${W - 1}" height="${Hh - 1}" rx="13" fill="#07070f" stroke="#2a2a45"/>
<text x="${PAD}" y="${PAD + 26}" class="big">${total.toLocaleString()} commits<tspan class="big dim"> in the last year</tspan></text>
<text x="${PAD}" y="${PAD + 47}" class="sub">across ${repos.length} repos · public + private · ${activeDays} active days · current streak ${current}d · longest ${longest}d</text>
${months}${dayLbl}${cells}
<text x="${PAD}" y="${Hh - PAD - 2}" class="dl">Most of this is private work — counted, never exposed.</text>
<text x="${sqLeftX - 7}" y="${Hh - PAD - 2}" class="dl" text-anchor="end">Less</text>${legend}<text x="${W - PAD}" y="${Hh - PAD - 2}" class="dl" text-anchor="end">More</text>
<rect x="13" y="${Hh - 4}" width="${W - 26}" height="3" rx="1.5" fill="url(#edge)" opacity="0.9"/>
<style>.big{fill:#50dcff;font-size:21px;font-weight:700}.big.dim{fill:#9a9cc0;font-weight:400;font-size:15px}.sub{fill:#9a9cc0;font-size:11.5px}.mn{fill:#8a8db5;font-size:10px}.dl{fill:#6a6d95;font-size:10px}</style>
</svg>`;

  const fs = await import('node:fs');
  fs.writeFileSync(OUT, svg);
  console.error(`\n✓ wrote ${OUT}`);
  console.log(JSON.stringify({ total, repos: repos.length, activeDays, current, longest }));
})();
