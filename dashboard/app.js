// Token Launch Radar — page behaviour; recomputes every figure from data.js.
// Row fields: 0 slug, 1 name, 2 cat, 3 chains, 4 tvl, 5 chg, 6 age, 7 iv,
// 8 rank-lo, 9 rank-hi, 10 comparables, 11 family, 12 watchlist; 13 rank (set at load).
const M = D.m, ROWS = D.r;
ROWS.forEach((r, i) => { r[13] = i + 1; });
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const commas = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const fmtM = (x) => x >= 1e9 ? '$' + (x / 1e9).toFixed(2) + 'B' : '$' + (x / 1e6).toFixed(1) + 'M';
const fmt$ = (x) => '$' + commas(x);
const fmtNet = (x) => Math.abs(x) >= 1e6 ? fmtM(x) : fmt$(x);
const pct = (x, d) => (x >= 0 ? '+' : '') + x.toFixed(d === undefined ? 1 : d) + '%';
const chg = (v) => v === null ? null : v / 100;
const catName = (r) => r[2] < 0 ? 'none recorded' : M.cats[r[2]][0];
const chainNames = (r) => r[3].map((i) => M.chains[i]);
const bandOf = (age) => age === null ? -1 : age < 183 ? 0 : age < 365 ? 1 : age < 730 ? 2 : age < 1096 ? 3 : 4;
const oddsOf = (r) => {
  const b = bandOf(r[6]);
  if (b < 0) return M.base;
  const p = M.bands[b];
  return (p[0] + (M.ps || 20) * M.base) / (p[1] + (M.ps || 20));
};
const shrink = (raw, n, lo, hi) => clamp(1 + (raw - 1) * (n / (n + 5)), lo, hi);
const catFactor = (ci) => {
  if (!M.terms[1][5]) return 1;
  if (ci < 0) return 1;
  const c = M.cats[ci];
  if (!c || c[2] < 5 || c[1] === null) return 1;
  return shrink(c[1], c[2], 0.5, 2);
};
const growthCarry = (chg) => chg === null || !M.terms[2][5] ? 1 : clamp(1 + clamp(chg - M.mmc, -25, 25) / 100, 0.8, 1.25);
const chainFactor = (nch) => {
  if (!M.terms[3][5] || !M.ch) return 1;
  const bk = nch === 1 ? '1' : nch <= 3 ? '2-3' : '4+';
  const e = M.ch.find((x) => x[0] === bk);
  if (!e || e[2] < 5) return 1;
  return shrink(e[1], e[2], 0.7, 1.4);
};
const ageKey = (age) => age === null ? 'u' : age < 365 ? 'y0' : age < 730 ? 'y1' : age < 1096 ? 'y2' : 'y3';
const ageFactor = (age) => {
  if (!M.terms[4] || !M.terms[4][5]) return 1;
  const e = M.ag.find((x) => x[0] === ageKey(age));
  if (!e || e[2] < 5 || e[1] === null) return 1;
  return shrink(e[1], e[2], 0.5, 2);
};
// Adopted size curve: quadratic in log-log when kept, else power law.
const curveVal = (tv) => {
  if (M.qd && M.qq) { const u = Math.log(tv) - M.qq[3]; return Math.exp(M.qq[0] + M.qq[1] * u + M.qq[2] * u * u); }
  return Math.exp(M.a + M.b * Math.log(tv));
};
const vilOf = (r) => {
  let v = curveVal(r[4]);
  if (M.terms[1][5]) v *= catFactor(r[2]);
  if (M.terms[2][5]) v *= growthCarry(chg(r[5]));
  if (M.terms[3][5]) v *= chainFactor(r[3].length);
  if (M.terms[4] && M.terms[4][5]) v *= ageFactor(r[6]);
  return Math.round(v);
};
const famSteps = (fam) => [M.steps.c[0], M.steps.c[1], M.steps.c[2], M.steps.k[fam], M.steps.c[3], M.steps.c[4], M.steps.c[5], M.steps.c[6], M.steps.c[7], M.steps.t[fam]];
const famTotals = (fam) => {
  const s = famSteps(fam);
  return { fees: s.reduce((a, x) => a + x[1], 0), mins: s.reduce((a, x) => a + x[2], 0), wait: s.reduce((a, x) => a + x[3], 0) };
};
const planDep = (tvl) => clamp(Math.round(tvl * 0.00025), 1000, 20000);
const stepText = (t, r, dep) => t[0].replaceAll('{N}', r[1]).replaceAll('{D}', commas(dep)).replaceAll('{C}', M.chains[r[3][0]] || 'its chain').replaceAll('{T}', commas(r[4]))
  + ' Cost $' + t[1].toFixed(2) + '. Time ' + t[2] + ' min hands-on' + (t[3] ? ' + ' + t[3] + ' min waiting' : '') + '.';
const netAt = (r, dep) => Math.round(dep / r[4] * 0.07 * r[7] - famTotals(r[11]).fees);
const nphAt = (r, dep) => netAt(r, dep) / (famTotals(r[11]).mins / 60);
const verdictAt = (r, dep) => {
  const net = netAt(r, dep);
  if (net <= 0) return 'SKIP';
  const tb = dep * 0.04 * (12 / 52);
  return net > tb && nphAt(r, dep) > 25 ? 'FARM' : 'THIN';
};
const fnv1a = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return ('0000000' + (h >>> 0).toString(16)).slice(-8);
};
const state = { q: '', cat: '', chain: '', verdict: '', chip: 'all', sort: 'rank', dir: 1, dep: 'plan' };
const depOf = (r) => state.dep === '1000' ? 1000 : state.dep === '10000' ? 10000 : planDep(r[4]);
const wlCount = ROWS.filter((r) => r[12]).length;
// header panels
function renderKpis() {
  let farm = 0, best = null, bn = -Infinity;
  for (const r of ROWS) {
    const v = verdictAt(r, planDep(r[4]));
    if (v === 'FARM') farm++;
    const n = nphAt(r, planDep(r[4]));
    if (n > bn) { bn = n; best = r; }
  }
  const cards = [
    [wlCount + ' of ' + wlCount, 'watchlist ranked'],
    [ROWS.length, 'ranked: ' + wlCount + ' watchlist + ' + (ROWS.length - wlCount) + ' early'],
    [M.loo.m.toFixed(1) + '× / ' + M.loo.wf.toFixed(1) + '×', 'held-out miss, flat ' + M.loo.b.toFixed(1) + '×'],
    [M.cov[0].toFixed(0) + '% / ' + M.cov[1].toFixed(0) + '%', 'in P25–P75 / P10–P90 bands'],
    [M.br.loo.toFixed(3), 'token-odds Brier vs base ' + M.br.loob.toFixed(3)],
    [farm + ' FARM', 'farm at plan size · best $' + bn.toFixed(0) + '/hr · ' + (best ? best[1] : '')],
  ];
  $('kpis').innerHTML = cards.map((c) => '<div class="kpi"><b>' + c[0] + '</b><span>' + c[1] + '</span></div>').join('');
}
function renderLedger() {
  const L = M.led;
  const segs = [[L.rk, '#0F766E'], [L.an, '#1A1D21'], [L.tn, '#C9C2B4'], [L.un, '#F59E0B']];
  $('ledger-bar').innerHTML = segs.map((s) => '<div style="width:' + (s[0] / L.tot * 100).toFixed(2) + '%;background:' + s[1] + '"></div>').join('');
  $('ledger-text').innerHTML = '<b>' + L.rk + ' ranked</b> (' + wlCount + ' watchlist + ' + (L.rk - wlCount) + ' early below the $50M floor) + <b>' + L.an + '</b> traded anchors with a usable market cap + <b>' + L.tn + '</b> traded without one + <b>' + L.un + '</b> pre-token set aside = <b>' + L.tot + '</b>. Cutoff $' + commas(L.cut) + ' TVL; ' + L.bc + ' early protocols sit below it, unranked.';
  $('ledger-reasons').textContent = 'Above the floor (' + L.af + '): ' + Object.entries(L.rs).map((e) => e[0] + ' ' + e[1]).join(' · ') + '.';
}
function renderEvidence() {
  const curveTxt = M.qd ? 'ln market cap = ' + M.qq[0].toFixed(3) + ' + ' + M.qq[1].toFixed(3) + ' × u + ' + M.qq[2].toFixed(3) + ' × u², u = ln TVL − ' + M.qq[3].toFixed(2) : 'ln market cap = ' + M.a.toFixed(3) + ' + ' + M.b.toFixed(3) + ' × ln TVL';
  const facs = ['TVL × size-curve multiple (fitted: ' + curveTxt + ')'];
  if (M.terms[1][5]) facs.push('category factor');
  if (M.terms[2][5]) facs.push('growth carry');
  if (M.terms[3][5]) facs.push('chain-count factor');
  if (M.terms[4][5]) facs.push('age factor');
  $('formula').innerHTML = '<b>Implied value = value-if-launched × token odds.</b> Value-if-launched = ' + facs.join(' × ') + '. Token odds = the shrunk share of same-age-band peers that record a token — the peers&rsquo; record, not a forecast. Flat TVL multiple (' + M.flat.toFixed(3) + '×) is the baseline the fitted curve beats.';
  document.querySelector('#term-table tbody').innerHTML = M.terms.map((t) => '<tr><td>' + esc(t[0]) + '</td><td>' + t[1].toFixed(2) + '× vs ' + t[2].toFixed(2) + '×</td><td>' + t[3].toFixed(2) + '× vs ' + t[4].toFixed(2) + '×</td><td>' + (t[5] ? 'Kept' : 'Dropped') + '</td></tr>').join('');
  document.querySelector('#odds-table tbody').innerHTML = M.oterms.map((t) => '<tr><td>' + esc(t[0]) + '</td><td>' + t[1].toFixed(3) + ' vs base ' + t[2].toFixed(3) + '</td><td>' + t[3].toFixed(3) + ' vs base ' + t[4].toFixed(3) + '</td><td>' + (t[5] ? 'Kept' : 'Dropped') + '</td></tr>').join('');
  const g = M.terms[2];
  $('evidence-note').textContent = 'A term is kept only if it improves both tests. Bands come from leave-one-out residuals: ' + M.cov[0].toFixed(0) + '% of the ' + M.led.an + ' real caps sit inside P25–P75 (stated 50%), ' + M.cov[1].toFixed(0) + '% inside P10–P90 (stated 80%). Curve fitted on ' + M.mc[0] + ' traded tokens with a usable market cap (of ' + (M.mc[0] + M.mc[1] + M.mc[2] + M.mc[3]) + ' traded: ' + M.mc[1] + ' record none, ' + M.mc[2] + ' record $0, ' + M.mc[3] + ' records −$1, a data error). Growth (excess over the market median week, capped ±25%) was tested and dropped: LOO ' + g[1].toFixed(2) + '× vs ' + g[2].toFixed(2) + '× without it, walk-forward ' + g[3].toFixed(2) + '× vs ' + g[4].toFixed(2) + '×.';
  renderChart();
}
function renderChart() {
  const pts = M.anchors.map((a) => [a[1] * 1000, a[2] * 1000]);
  const rows = ROWS.map((r) => [r[4], r[7]]);
  const all = pts.concat(rows);
  const xs = all.map((p) => Math.log(p[0])), ys = all.map((p) => Math.log(p[1]));
  const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
  const W = 640, H = 210, P = 34;
  const X = (v) => P + (Math.log(v) - x0) / (x1 - x0) * (W - 2 * P);
  const Y = (v) => H - P - (Math.log(v) - y0) / (y1 - y0) * (H - 2 * P);
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%">';
  for (let e = Math.ceil(x0 / Math.LN10); e <= Math.floor(x1 / Math.LN10); e++) {
    const v = Math.pow(10, e);
    s += '<line x1="' + X(v).toFixed(1) + '" y1="' + (H - P) + '" x2="' + X(v).toFixed(1) + '" y2="' + P + '" stroke="#EDE7DA"/>';
    s += '<text x="' + X(v).toFixed(1) + '" y="' + (H - 12) + '" font-size="10" fill="#5B6470" text-anchor="middle">$' + (v >= 1e9 ? (v / 1e9) + 'B' : (v / 1e6) + 'M') + '</text>';
  }
  const curve = (mult) => {
    let d = '';
    for (let i = 0; i <= 40; i++) {
      const tv = Math.exp(x0 + (x1 - x0) * i / 40);
      d += (i ? 'L' : 'M') + X(tv).toFixed(1) + ' ' + Y(curveVal(tv) * mult).toFixed(1);
    }
    return d;
  };
  s += '<path d="' + curve(M.q[1]) + '" fill="none" stroke="#0F766E" stroke-dasharray="4 3" stroke-width="1"/>';
  s += '<path d="' + curve(M.q[2]) + '" fill="none" stroke="#0F766E" stroke-dasharray="4 3" stroke-width="1"/>';
  s += '<path d="' + curve(1) + '" fill="none" stroke="#1A1D21" stroke-width="2"/>';
  s += pts.map((p) => '<circle cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) + '" r="2.6" fill="#0F766E"/>').join('');
  s += rows.map((p) => '<circle cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) + '" r="2" fill="#9AA3AD"/>').join('');
  s += '</svg>';
  $('chart').innerHTML = s;
}
function renderSelfcheck() {
  const n = ROWS.length;
  let ranksOk = true, monoOk = true;
  for (let i = 0; i < n; i++) {
    if (ROWS[i][13] !== i + 1) ranksOk = false;
    if (i && ROWS[i][7] > ROWS[i - 1][7]) monoOk = false;
  }
  const sum = ROWS.reduce((a, r) => a + r[7], 0);
  const chk = fnv1a(ROWS.map((r) => r[0] + ':' + r[13] + ':' + r[7]).join('|'));
  const ok = n === M.led.rk && ranksOk && monoOk && chk === M.sum && sum === M.tot;
  $('selfcheck').className = 'selfcheck' + (ok ? '' : ' bad');
  $('selfcheck').innerHTML = '<b>Self-check ' + (ok ? 'passed' : 'FAILED') + ' — recomputed here:</b> board file: ' + n + ' of ' + M.led.rk + ' rows · ranks 1–' + n + ', no gaps · values never rise · total ' + fmtM(sum) + ' = board total · checksum ' + chk + (chk === M.sum ? ' matches' : ' MISMATCH') + '.';
}

// board table
function filtered() {
  const q = state.q.toLowerCase();
  let list = ROWS.filter((r) => {
    if (state.chip === 'wl' && !r[12]) return false;
    if (state.chip === 'off' && (r[12] || r[4] < M.floor)) return false;
    if (state.chip === 'early' && r[4] >= M.floor) return false;
    if (['farm', 'thin', 'skip'].includes(state.chip) && verdictAt(r, depOf(r)).toLowerCase() !== state.chip) return false;
    if (state.cat && catName(r) !== state.cat) return false;
    if (state.chain && !chainNames(r).includes(state.chain)) return false;
    if (state.verdict && verdictAt(r, depOf(r)) !== state.verdict) return false;
    if (q && !(r[1].toLowerCase().includes(q) || catName(r).toLowerCase().includes(q) || chainNames(r).some((c) => c.toLowerCase().includes(q)))) return false;
    return true;
  });
  const key = state.sort;
  const val = (r) => key === 'rank' ? r[13] : key === 'name' ? r[1] : key === 'tvl' ? r[4] : key === 'chg' ? (r[5] === null ? -99999 : r[5]) : key === 'age' ? (r[6] === null ? -1 : r[6]) : key === 'odds' ? oddsOf(r) : key === 'vil' ? vilOf(r) : key === 'iv' ? r[7] : nphAt(r, depOf(r));
  return list.slice().sort((a, b) => {
    const va = val(a), vb = val(b);
    const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return (c === 0 ? a[0].localeCompare(b[0]) : c) * state.dir;
  });
}
function renderTable() {
  const list = filtered();
  const badge = (r) => r[12] ? '<span class="badge b-wl">WATCHLIST</span>' : r[4] < M.floor ? '<span class="badge b-early">EARLY</span>' : '<span class="badge b-off">OFF-LIST</span>';
  $('board').querySelector('tbody').innerHTML = list.map((r) => {
    const dep = depOf(r), net = netAt(r, dep), nph = nphAt(r, dep), v = verdictAt(r, dep);
    const vil = vilOf(r), odds = oddsOf(r);
    const b = bandOf(r[6]);
    const age = r[6] === null ? 'not reported' : (r[6] / 365).toFixed(1) + 'y';
    return '<tr data-slug="' + r[0] + '" class="' + (r[13] === 1 ? 'top1' : '') + '">'
      + '<td><b>' + r[13] + '</b><div class="psub">' + r[8] + '–' + r[9] + '</div></td>'
      + '<td><span class="pname">' + esc(r[1]) + '</span>' + badge(r) + '<div class="psub">' + esc(catName(r)) + ' · ' + esc(chainNames(r).join(', ')) + '</div></td>'
      + '<td class="num">' + fmtM(r[4]) + '</td>'
      + '<td class="num">' + (r[5] === null ? 'n/a' : pct(chg(r[5]))) + '<div class="psub">exc. ' + (r[5] === null ? 'n/a' : pct(chg(r[5]) - M.mmc)) + '</div></td>'
      + '<td class="num">' + age + '</td>'
      + '<td class="num">' + (odds * 100).toFixed(0) + '%<div class="psub">' + (b < 0 ? 'age unknown' : M.bands[b][0] + ' of ' + M.bands[b][1] + ' peers') + '</div></td>'
      + '<td class="num">' + fmtM(vil) + '</td>'
      + '<td class="num"><b>' + fmtM(r[7]) + '</b><div class="psub">' + fmtM(vil * M.q[1] * odds) + '–' + fmtM(vil * M.q[2] * odds) + '</div></td>'
      + '<td class="num"><span class="v-' + v + '">' + v + '</span><div class="psub">net ' + (net < 0 ? '−' : '+') + fmtNet(Math.abs(net)) + ' · $' + nph.toFixed(0) + '/hr</div></td></tr>';
  }).join('');
  $('rowcount').textContent = list.length + ' of ' + ROWS.length + ' rows' + (state.chip !== 'all' ? ' — ' + state.chip.toUpperCase() + ' only' : '');
  document.querySelectorAll('#board tbody tr').forEach((tr) => tr.addEventListener('click', () => { location.hash = '#d=' + tr.dataset.slug; }));
}
function renderControls() {
  const cats = [...new Set(ROWS.map(catName))].sort();
  $('f-cat').innerHTML = '<option value="">All categories</option>' + cats.map((c) => '<option>' + esc(c) + '</option>').join('');
  $('f-chain').innerHTML = '<option value="">All chains</option>' + M.chains.map((c) => '<option>' + esc(c) + '</option>').join('');
  const chips = [['all', 'All ' + ROWS.length], ['wl', 'Watchlist ' + wlCount], ['off', 'Off-list'], ['early', 'Early below floor'], ['farm', 'Farm'], ['thin', 'Marginal'], ['skip', 'Skip']];
  $('chips').innerHTML = chips.map((c) => '<button type="button" class="chip' + (state.chip === c[0] ? ' on' : '') + '" data-chip="' + c[0] + '">' + c[1] + '</button>').join('');
  document.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => { state.chip = b.dataset.chip; syncHash(); renderAll(); }));
}
// detail view
function renderDetail(slug) {
  const r = ROWS.find((x) => x[0] === slug);
  if (!r) { location.hash = ''; return; }
  const dep = planDep(r[4]), tot = famTotals(r[11]);
  const vil = vilOf(r), odds = oddsOf(r), ivLive = Math.round(vil * odds);
  const net = netAt(r, dep), nph = nphAt(r, dep), v = verdictAt(r, dep);
  const tb = dep * 0.04 * (12 / 52);
  const rawMvc = tot.fees * r[4] / (0.07 * r[7]);
  const mvc = rawMvc > 30000 ? null : Math.max(100, Math.ceil(rawMvc / 100) * 100);
  const b = bandOf(r[6]);
  const bp = b < 0 ? 'age unknown — base rate used' : M.bands[b][0] + ' of ' + M.bands[b][1] + ' peers aged ' + ['under 6 months', '6–12 months', '1–2 years', '2–3 years', 'over 3 years'][b] + ' record a token';
  const mult = curveVal(r[4]) / r[4];
  const uq = M.qd ? Math.log(r[4]) - M.qq[3] : 0;
  const plMult = M.qd ? Math.exp(M.qq[0] + M.qq[1] * uq) / r[4] : mult;
  const qFac = M.qd ? Math.exp(M.qq[2] * uq * uq) : 1;
  const near = r[10].map((ai) => {
    const a = M.anchors[ai];
    let pred = curveVal(a[1] * 1000);
    if (M.terms[1][5]) pred *= catFactor(a[3]);
    if (M.terms[2][5]) pred *= growthCarry(chg(a[4] === undefined ? null : a[4]));
    const real = a[2] * 1000;
    return { name: a[0], tvl: a[1] * 1000, mcap: real, mult: real / (a[1] * 1000), pred: Math.round(pred), miss: Math.max(pred / real, real / pred) };
  });
  const depRows = [1000, 5000, 10000, 30000];
  const nearDep = depRows.reduce((a, d) => Math.abs(d - dep) < Math.abs(a - dep) ? d : a, depRows[0]);
  const matrix = depRows.map((d) => [0.035, 0.07, 0.14].map((s) => {
    const n2 = Math.round(d / r[4] * s * r[7] - tot.fees);
    const v2 = n2 <= 0 ? 'SKIP' : (n2 > d * 0.04 * (12 / 52) && n2 / (tot.mins / 60) > 25 ? 'FARM' : 'THIN');
    return { d, s, n: n2, v: v2, hl: d === nearDep && s === 0.07 };
  }));
  const steps = famSteps(r[11]).map((t) => stepText(t, r, dep));
  const listed = r[6] === null ? 'not reported' : new Date(Date.parse(M.asof + 'T00:00:00Z') - r[6] * 86400000).toISOString().slice(0, 10);
  $('board-view').hidden = true;
  const dv = $('detail-view');
  dv.hidden = false;
  dv.innerHTML = '<button type="button" class="back" id="back">← Back to board</button>'
    + '<div class="detail-grid"><section class="card"><h2>' + esc(r[1]) + '</h2>'
    + '<p class="small">' + (r[12] ? '<span class="badge b-wl">WATCHLIST</span>' : r[4] < M.floor ? '<span class="badge b-early">EARLY</span>' : '<span class="badge b-off">OFF-LIST</span>') + ' ' + esc(catName(r)) + ' · ' + esc(chainNames(r).join(', ')) + '</p>'
    + '<div class="big">' + fmtM(r[7]) + '</div><p class="small">implied value · rank ' + r[13] + ' of ' + ROWS.length + ' (bootstrap range ' + r[8] + '–' + r[9] + ')<br>Band P25–P75 ' + fmtM(vil * M.q[1] * odds) + '–' + fmtM(vil * M.q[2] * odds) + '</p>'
    + '<h3>Inputs, as recorded</h3><dl class="kv">'
    + '<dt>TVL</dt><dd>' + fmt$(r[4]) + '</dd><dt>7-day change</dt><dd>' + (r[5] === null ? 'not reported' : pct(chg(r[5]), 2)) + '</dd>'
    + '<dt>Listed date</dt><dd>' + listed + '</dd>'
    + '<dt>Age, no token</dt><dd>' + (r[6] === null ? 'not reported' : r[6] + ' days (' + (r[6] / 365).toFixed(1) + ' years)') + '</dd>'
    + '<dt>Category</dt><dd>' + esc(catName(r)) + '</dd><dt>Chains</dt><dd>' + r[3].length + ' — ' + esc(chainNames(r).join(', ')) + '</dd></dl></section>'
    + '<section class="card"><h2>How the value is built</h2>'
    + '<table class="build"><tbody>'
    + '<tr><td>TVL</td><td>' + fmt$(r[4]) + '</td></tr>'
    + (M.qd
      ? '<tr><td>× size-curve multiple, power-law part</td><td>×' + plMult.toFixed(3) + '</td></tr>'
        + '<tr><td>× quadratic size-curve factor exp(' + M.qq[2].toFixed(3) + '·u²), u = ln TVL − ' + M.qq[3].toFixed(2) + '</td><td>×' + qFac.toFixed(3) + ' · ' + fmt$(Math.round(curveVal(r[4]))) + ' after size curve</td></tr>'
      : '<tr><td>× size-curve multiple at this TVL</td><td>×' + mult.toFixed(3) + '</td></tr>')
    + (M.terms[1][5] ? '<tr><td>× category factor (' + (r[2] < 0 || M.cats[r[2]][2] < 5 ? 'fewer than 5 comparables — factor 1' : M.cats[r[2]][2] + ' comparables in category') + ')</td><td>×' + catFactor(r[2]).toFixed(3) + '</td></tr>' : '')
    + (M.terms[2][5] ? '<tr><td>× growth carry (excess ' + (r[5] === null ? 'not reported' : pct(chg(r[5]) - M.mmc)) + ' over the market median week)</td><td>×' + growthCarry(chg(r[5])).toFixed(3) + '</td></tr>' : '')
    + (M.terms[3][5] ? '<tr><td>× chain-count factor</td><td>×' + chainFactor(r[3].length).toFixed(3) + '</td></tr>' : '')
    + (M.terms[4] && M.terms[4][5] ? '<tr><td>× age factor</td><td>×' + ageFactor(r[6]).toFixed(3) + '</td></tr>' : '')
    + '<tr><td><b>= value if it launches</b></td><td><b>' + fmt$(vil) + '</b></td></tr>'
    + '<tr><td>× token odds (' + bp + '; shrunk odds ' + (odds * 100).toFixed(0) + '%)</td><td>×' + odds.toFixed(3) + '</td></tr>'
    + '<tr><td><b>= implied value</b></td><td><b>' + fmt$(r[7]) + '</b></td></tr></tbody></table>'
    + '<p class="small">Dropped (factor 1 here): ' + M.terms.filter((t) => !t[5]).map((t) => t[0]).join(', ') + ' — none improved both held-out tests (see the term table).</p>'
    + '<p class="small"><b>Recomputed in this page: ' + esc(r[1]) + '’s implied value is ' + fmt$(ivLive) + ' at rank ' + r[13] + ' — ' + (ivLive === r[7] ? 'equals the board file' : 'differs from the board file by ' + fmt$(Math.abs(ivLive - r[7]))) + '.</b></p>'
    + '<h3>Nearest comparables</h3><table class="mini"><thead><tr><th>Protocol</th><th>TVL</th><th>Market cap</th><th>Mult.</th><th>Blind price</th><th>Miss</th></tr></thead><tbody>'
    + (near.length ? near.map((n) => '<tr><td>' + esc(n.name) + '</td><td class="num">' + fmtM(n.tvl) + '</td><td class="num">' + fmtM(n.mcap) + '</td><td class="num">' + n.mult.toFixed(3) + '×</td><td class="num">' + fmtM(n.pred) + '</td><td class="num">' + n.miss.toFixed(2) + '×</td></tr>').join('') : '<tr><td colspan="6">No traded comparable in this category — the category factor is 1.</td></tr>')
    + '</tbody></table></section>'
    + '<section class="card"><h2>Farm plan — <span class="v-' + v + '">' + v + '</span></h2>'
    + '<dl class="kv"><dt>Deposit</dt><dd>' + fmt$(dep) + ' (0.025% of TVL, $1,000–$20,000)</dd><dt>Horizon</dt><dd>12 weeks</dd>'
    + '<dt>Drop share</dt><dd>7% of implied value, pro-rata by deposit</dd><dt>Fees</dt><dd>' + fmt$(tot.fees) + '</dd>'
    + '<dt>T-bill</dt><dd>' + fmt$(tb) + ' at 4% a year over 12 weeks</dd><dt>Net after fees</dt><dd>' + fmt$(net) + '</dd>'
    + '<dt>Net per hour</dt><dd>$' + nph.toFixed(2) + ' (hurdle $25)</dd>'
    + '<dt>Minimum viable capital</dt><dd>' + (mvc === null ? 'No deposit up to $30,000 pays — fees exceed the slice' : fmt$(mvc)) + '</dd></dl>'
    + '<p class="small"><b>Verdict rule:</b> FARM when net beats the T-bill benchmark AND net per hour beats $25; THIN when net is positive but below one bar; SKIP when net is zero or negative. The drop is the model&rsquo;s slice, not a payout; yield meanwhile is left out.</p>'
    + '<h3>Net by deposit × share</h3><table class="matrix"><thead><tr><th>Deposit</th><th>3.5%</th><th>7%</th><th>14%</th></tr></thead><tbody>'
    + matrix.map((row) => '<tr><th>' + fmt$(row[0].d) + '</th>' + row.map((c) => '<td class="' + (c.hl ? 'hl ' : '') + 'v-' + c.v + '">' + c.v + '<br>' + fmt$(c.n) + '</td>').join('') + '</tr>').join('')
    + '</tbody></table>'
    + '<h3>Farm plan — 10 steps</h3><ol class="plan">'
    + steps.map((s) => '<li>' + esc(s) + '</li>').join('')
    + '</ol><p class="tot">Plan total: fees ' + fmt$(tot.fees) + ' · hands-on ' + tot.mins + ' min · waiting ' + tot.wait + ' min.</p>'
    + '<div class="warn"><b>Stop rule:</b> exit if TVL falls 30% below ' + fmt$(r[4]) + ' or withdrawals pause. Never pay to claim.</div>'
    + '</section></div>';
  $('back').addEventListener('click', () => { location.hash = ''; });
}
// routing
function parseHash() {
  const h = location.hash.replace(/^#/, '');
  const p = new URLSearchParams(h.replace(/;/g, '&'));
  if (p.get('d')) { renderDetail(p.get('d')); return; }
  $('detail-view').hidden = true;
  $('board-view').hidden = false;
  if (p.get('f')) state.chip = p.get('f');
  if (p.get('s')) { state.sort = p.get('s'); state.dir = p.get('dir') === 'desc' ? -1 : 1; }
  renderAll();
}
function syncHash() {
  const q = [];
  if (state.chip !== 'all') q.push('f=' + state.chip);
  if (state.sort !== 'rank') { q.push('s=' + state.sort); q.push('dir=' + (state.dir === 1 ? 'asc' : 'desc')); }
  history.replaceState(null, '', q.length ? '#' + q.join('&') : '#');
}
function renderAll() { renderTable(); renderControls(); }
document.querySelectorAll('#board thead th').forEach((th) => th.addEventListener('click', () => {
  const k = th.dataset.sort;
  if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = k === 'name' ? 1 : -1; }
  syncHash(); renderAll();
}));
$('q').addEventListener('input', (e) => { state.q = e.target.value; renderTable(); });
$('f-cat').addEventListener('change', (e) => { state.cat = e.target.value; renderTable(); });
$('f-chain').addEventListener('change', (e) => { state.chain = e.target.value; renderTable(); });
$('f-verdict').addEventListener('change', (e) => { state.verdict = e.target.value; renderTable(); });
$('f-dep').addEventListener('change', (e) => { state.dep = e.target.value; renderTable(); });
$('reset').addEventListener('click', () => {
  Object.assign(state, { q: '', cat: '', chain: '', verdict: '', chip: 'all', sort: 'rank', dir: 1, dep: 'plan' });
  $('q').value = ''; $('f-cat').value = ''; $('f-chain').value = ''; $('f-verdict').value = ''; $('f-dep').value = 'plan';
  syncHash(); renderAll();
});
window.addEventListener('hashchange', parseHash);
renderKpis(); renderLedger(); renderEvidence(); renderSelfcheck(); renderControls(); parseHash();
