// Token Radar dashboard (model radar-2). No network: reads window.RADAR from
// data.js, renders the board, the detail view and the model sandbox.
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) { document.body.textContent = 'Token Radar: no data.'; return; }

  var $ = function (id) { return document.getElementById(id); };
  var rowsEl = $('rows'), detailEl = $('detail'), countEl = $('count');

  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  }
  function pct(x) {
    if (x === null || x === undefined) return '—';
    return (x > 0 ? '+' : '') + x.toFixed(1) + '%';
  }
  function ageStr(d) { return d === null || d === undefined ? '—' : d + 'd'; }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- farm steps: the same rules lib/model.ts uses, so the detail view
  // shows exactly the steps board.json carries for the row. ----
  function chainOf(r) { return r.chains.length ? r.chains[0] : 'its main chain'; }
  var CHAIN_GAS = {
    ethereum: 'ETH', arbitrum: 'ETH', base: 'ETH', optimism: 'ETH', linea: 'ETH',
    scroll: 'ETH', 'zksync era': 'ETH', unichain: 'ETH', mode: 'ETH', blast: 'ETH',
    ink: 'ETH', katana: 'ETH', 'world chain': 'ETH',
    solana: 'SOL', avalanche: 'AVAX', polygon: 'POL', tron: 'TRX', sui: 'SUI',
    monad: 'MON', binance: 'BNB', 'bnb chain': 'BNB', bsc: 'BNB', fantom: 'FTM',
    sonic: 'S', celo: 'CELO', cardano: 'ADA', ton: 'TON', sei: 'SEI', berachain: 'BERA',
    xdai: 'xDAI', gnosis: 'xDAI', 'hyperliquid l1': 'HYPE', mantle: 'MNT', bitcoin: 'BTC',
    near: 'NEAR', aptos: 'APT', injective: 'INJ', cronos: 'CRO', stellar: 'XLM',
    ripple: 'XRP', flare: 'FLR', polkadot: 'DOT', kusama: 'KSM', 'cosmos hub': 'ATOM',
    osmosis: 'OSMO', kava: 'KAVA', algorand: 'ALGO', hedera: 'HBAR', tezos: 'XTZ',
    vechain: 'VET', multiversx: 'EGLD', zilliqa: 'ZIL'
  };
  function gasFor(chain) { return CHAIN_GAS[(chain || '').toLowerCase()] || null; }
  function capitalFor(r) {
    if (r.tvl_usd >= 5e9) return 250;
    if (r.tvl_usd >= 1e9) return 150;
    if (r.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(r, capital, chain) {
    var c = (r.category || '').toLowerCase(), name = r.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Lend $' + capital + ' of USDC on ' + name + ' (' + chain + ') and leave the deposit earning.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Add $' + capital + ' of liquidity to ' + name + '\'s deepest pool on ' + chain + ' and hold the LP position.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC through ' + name + ' to ' + chain + ', then use the bridged funds inside its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + ' of the chain asset through ' + name + ' on ' + chain + ' and keep the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' (' + chain + ') and open a single small hedged position.';
    if (c.indexOf('prediction') >= 0) return 'Fund an account with $' + capital + ' on ' + name + ' and take one position in a live market.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and hold the vault shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of ' + name + '\'s yield-bearing asset on ' + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('payment') >= 0) return 'Route $' + capital + ' of payments through ' + name + ' on ' + chain + ' and keep the volume on one wallet.';
    if (c.indexOf('chain') >= 0) return 'Use ' + name + ' on ' + chain + ' with $' + capital + ' and keep the activity on one wallet.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(t, cost, time) {
    var s = t + ' Cost: ' + cost + '. Time: ' + time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s += ' Keep the position open and check the protocol\'s own page.';
    return s;
  }
  function weeklyFor(r, chain) {
    var c = (r.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow $20 against the deposit and repay it the same week, so the wallet shows a full borrow cycle.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Swap $10 through the pool each week, alternating the direction, so the wallet shows repeated trading.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $5 back the other way each week, so the wallet shows two-way volume.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Claim any staking rewards each week and restake them, so the wallet shows compounding use.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Open one small hedged position each week and close it the same day.';
    if (c.indexOf('prediction') >= 0) return 'Settle one small position in a live market each week.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Claim any vault rewards each week and re-deposit them, so the wallet shows compounding use.';
    if (c.indexOf('stable') >= 0) return 'Mint or redeem $10 of the stable asset each week.';
    if (c.indexOf('rwa') >= 0) return 'Check the asset\'s accrued yield each week and mint $10 more of it.';
    if (c.indexOf('insurance') >= 0) return 'Check the policy each week and renew it before it lapses.';
    if (c.indexOf('payment') >= 0) return 'Route one real payment through the app each week.';
    if (c.indexOf('chain') >= 0) return 'Do one real transaction on ' + chain + ' each week.';
    return 'Make one real deposit, swap or vote each week.';
  }
  function holdText(r, age, hold) {
    if (age === null || age === undefined) return 'Keep the position open for at least ' + hold + ' days, so the activity spans more than one monthly snapshot.';
    if (age >= 365) return 'Keep the position open for at least ' + hold + ' days — ' + r.name + ' has already run ' + age + ' days with no token, and airdrops after a long wait usually reward the wallets that stayed.';
    if (age < 180) return 'Keep the position open for at least ' + hold + ' days — ' + r.name + ' is only ' + age + ' days old, so a ' + hold + '-day hold puts you in from the early side.';
    return 'Keep the position open for at least ' + hold + ' days, so the activity spans more than one monthly snapshot.';
  }
  function rewardsText(r, chain) {
    var gas = gasFor(chain);
    if (gas !== null) return 'Check ' + r.name + '\'s own site for a rewards or points page it publishes, and claim only through a link on that page. On ' + chain + ', gas is paid in ' + gas + ', so keep a little ' + gas + ' in the wallet.';
    return 'Check ' + r.name + '\'s own site for a rewards or points page it publishes, and claim only through a link on that page.';
  }
  function farmSteps(r) {
    var chain = chainOf(r), capital = capitalFor(r), hold = holdDaysFor(r.age_days);
    return [
      stepText('Open a fresh wallet that holds only the funds you plan to farm, and store its recovery phrase offline, never in a screenshot or a chat.', 'under $3 of gas for the first transaction', '5 minutes'),
      stepText(actionFor(r, capital, chain), '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', '15 minutes to set up'),
      stepText(weeklyFor(r, chain), 'about $2 of gas a week', '10 minutes a week'),
      stepText(holdText(r, r.age_days, hold), 'the $' + capital + ' stays in the position', hold + ' days'),
      stepText(rewardsText(r, chain), 'no fee to check, and never pay to claim', '10 minutes'),
      stepText('Record the wallet address, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it cleanly.', 'nothing but the log', '5 minutes')
    ];
  }

  // ---- state ----
  var state = { q: '', cat: '', chain: '', view: 'board', sort: 'rank', dir: 1, sel: null };
  var sandbox = null; // null = submitted constants; otherwise {base_multiple, growth_weight, maturity_floor, breadth_per_chain}

  function baseMultiple(tvl, m) {
    return Math.max(m.multiple_floor, m.base_multiple * Math.pow(Math.max(tvl, 1) / m.size_floor_usd, m.size_exponent));
  }
  function impliedOf(r, m) {
    var age = (r.age_days === null || r.age_days === undefined) ? m.unknown_age_days : r.age_days;
    var g = r.change_7d === null || r.change_7d === undefined ? 0 : r.change_7d;
    g = Math.min(m.growth_cap, Math.max(m.growth_floor, g));
    var gm = 1 + (g / 100) * m.growth_weight;
    var mm = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var bm = 1 + m.breadth_per_chain * Math.min(r.chains.length, m.breadth_max_chains);
    return { implied: Math.max(1, Math.round(r.tvl_usd * baseMultiple(r.tvl_usd, m) * gm * mm * bm)), gm: gm, mm: mm, bm: bm, mult: baseMultiple(r.tvl_usd, m) };
  }

  function visibleRows() {
    var list = state.view === 'live' ? R.live.slice() : R.rows.slice();
    if (sandbox && state.view === 'board') {
      var m = Object.assign({}, R.model, sandbox);
      list = list.map(function (r) {
        var v = impliedOf(r, m);
        var c = Object.assign({}, r);
        c.implied_value_usd = v.implied; c.growth_multiplier = v.gm; c.maturity_multiplier = v.mm; c.breadth_multiplier = v.bm; c.base_multiple = v.mult;
        return c;
      });
      list.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1); });
      list.forEach(function (r, i) { r.rank = i + 1; });
    }
    var q = state.q.trim().toLowerCase();
    return list.filter(function (r) {
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      return true;
    });
  }

  function sortRows(list) {
    var k = state.sort, d = state.dir;
    return list.sort(function (a, b) {
      var x = a[k], y = b[k];
      if (x === null || x === undefined) x = -Infinity;
      if (y === null || y === undefined) y = -Infinity;
      if (typeof x === 'string') return d * (x < y ? -1 : x > y ? 1 : 0);
      return d * (x - y);
    });
  }

  function render() {
    var list = sortRows(visibleRows());
    var live = state.view === 'live';
    // The detail panel is never empty: with no selection, show the first
    // visible row, so the board shot carries a populated detail view.
    if (!state.sel && list.length) state.sel = list[0].slug;
    var maxVal = 1;
    (live ? R.live : R.rows).forEach(function (r) {
      var v = live ? (r.mcap_usd || 0) : r.implied_value_usd;
      if (v > maxVal) maxVal = v;
    });
    rowsEl.innerHTML = list.map(function (r) {
      var val = live ? (r.mcap_usd || 0) : r.implied_value_usd;
      var chg = r.change_7d;
      var cls = chg === null ? '' : (chg >= 0 ? 'up' : 'down');
      var barw = Math.max(4, Math.round(Math.sqrt(val / maxVal) * 100));
      return '<tr data-slug="' + esc(r.slug) + '" class="' + (state.sel === r.slug ? 'sel' : '') + '">' +
        '<td class="num">' + (live ? '—' : r.rank) + '</td>' +
        '<td><span class="nm">' + esc(r.name) + '</span><br><span class="sl">' + esc(r.slug) + '</span> <span class="nt' + (live ? ' live' : '') + '">● ' + (live ? 'live' : 'no token') + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + r.chains.slice(0, 2).map(function (c) { return '<span class="tag">' + esc(c) + '</span>'; }).join('') + (r.chains.length > 2 ? '<span class="tag">+' + (r.chains.length - 2) + '</span>' : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + cls + '">' + pct(chg) + '</td>' +
        '<td class="num">' + (live ? '—' : ageStr(r.age_days)) + '</td>' +
        '<td class="num"><b>' + money(val) + '</b><div class="vbar" title="Square-root scale: the tail stays readable"><div style="width:' + barw + '%"></div></div></td></tr>';
    }).join('');
    countEl.textContent = list.length + ' of ' + (live ? R.live_size : R.board_size) + ' protocols' + (sandbox && !live ? ' — re-ranked by the sandbox constants below' : '');
    renderDetail();
  }

  function bar(label, value, max) {
    var pctw = Math.max(2, Math.min(100, (value / max) * 100));
    return '<div class="bar"><span>' + label + '</span><div class="tr"><div class="fl" style="width:' + pctw.toFixed(0) + '%"></div></div><b>' + value.toFixed(2) + '×</b></div>';
  }

  function renderDetail() {
    if (!state.sel) {
      detailEl.innerHTML = '<p class="empty">Select a protocol to see its model breakdown and farm plan.</p>';
      return;
    }
    var r = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === state.sel) { r = R.rows[i]; break; }
    if (!r) for (var j = 0; j < R.live.length; j++) if (R.live[j].slug === state.sel) { r = R.live[j]; break; }
    if (!r) { detailEl.innerHTML = '<p class="empty">Protocol not found.</p>'; return; }
    var live = state.view === 'live' || r.mcap_usd !== null;
    var chainList = r.chains.length > 4 ? r.chains.slice(0, 4).map(esc).join(', ') + ' +' + (r.chains.length - 4) + ' more' : r.chains.map(esc).join(', ');
    var h = '<h2>' + esc(r.name) + '</h2><p class="note">' + esc(r.slug) + ' · ' + esc(r.category || 'uncategorised') + ' · ' + chainList + '</p>';
    h += '<div class="rowline"><span>TVL</span><b>' + money(r.tvl_usd) + '</b></div>';
    h += '<div class="rowline"><span>7-day change</span><b class="' + (r.change_7d === null ? '' : (r.change_7d >= 0 ? 'up' : 'down')) + '">' + pct(r.change_7d) + '</b></div>';
    if (live) {
      h += '<div class="rowline"><span>Market cap</span><b>' + money(r.mcap_usd || 0) + '</b></div>';
      h += '<p class="note">This protocol records a token, so the board shows the market\u2019s own value — it is never ranked on the pre-token board.</p>';
    } else {
      var v = impliedOf(r, R.model);
      h += '<div class="rowline"><span>Implied value</span><b class="big">' + money(r.implied_value_usd) + '</b></div>';
      h += '<div class="rowline"><span>Age with no token</span><b>' + ageStr(r.age_days) + '</b></div>';
      h += '<div class="bars">' + bar('Base multiple', r.base_multiple, 1.5) + bar('Growth', r.growth_multiplier, 2) + bar('Maturity', r.maturity_multiplier, 1) + bar('Breadth', r.breadth_multiplier, 1.2) + '</div>';
      h += '<p class="note">Model ' + esc(R.model_version) + ': the page recomputes this row from the snapshot\u2019s own figures as ' + money(v.implied) + ', the same number board.json carries. This is an estimate, not a price.</p>';
      h += '<h3>Farm plan</h3><ol>' + farmSteps(r).map(function (s) {
        var cut = s.indexOf(' Cost: ');
        if (cut < 0) return '<li>' + esc(s) + '</li>';
        return '<li>' + esc(s.slice(0, cut)) + ' <span class="ct">' + esc(s.slice(cut + 1)) + '</span></li>';
      }).join('') + '</ol>';
    }
    detailEl.innerHTML = h;
  }

  // ---- header, stats, filters ----
  var top = R.rows[0];
  $('meta').innerHTML = 'Snapshot <b>' + esc(R.as_of) + '</b> · DefiLlama<br>Model <b>' + esc(R.model_version) + '</b> · Floor <b>' + money(R.floor_usd) + '</b>';
  $('asof').textContent = R.as_of;
  $('stats').innerHTML =
    '<div class="stat"><div class="n">' + R.board_size + '</div><div class="l">Ranked rows</div></div>' +
    '<div class="stat"><div class="n">' + R.watchlist_size + '</div><div class="l">Watchlist covered</div></div>' +
    '<div class="stat"><div class="n">' + R.early_size + '</div><div class="l">Early finds</div></div>' +
    '<div class="stat"><div class="n">' + money(top.implied_value_usd) + '</div><div class="l">Top implied · ' + esc(top.name) + '</div></div>' +
    '<div class="stat"><div class="n">' + R.live_size + '</div><div class="l">Live tokens set aside</div></div>';
  var cats = {}, chains = {};
  R.rows.concat(R.live).forEach(function (r) {
    if (r.category) cats[r.category] = 1;
    r.chains.forEach(function (c) { chains[c] = 1; });
  });
  Object.keys(cats).sort().forEach(function (c) { $('cat').innerHTML += '<option>' + esc(c) + '</option>'; });
  Object.keys(chains).sort().forEach(function (c) { $('chain').innerHTML += '<option>' + esc(c) + '</option>'; });

  var m = R.model;
  $('consts').innerHTML =
    '<div><b>Base multiple 0.35 × (TVL / $50M)^−0.15</b><span>Declining with size, floored at 0.10</span></div>' +
    '<div><b>Growth × ' + m.growth_weight.toFixed(2) + '</b><span>7-day change, clamped −40% to +60%</span></div>' +
    '<div><b>Maturity 0.60 + age/1095 × 0.40</b><span>Days listed with no token; unknown counts as 365</span></div>' +
    '<div><b>Breadth +0.02 per chain</b><span>Up to 10 chains, from the snapshot\u2019s own chains</span></div>';
  var defs = [
    { k: 'base_multiple', label: 'Base multiple', min: 0.1, max: 0.6, step: 0.01, v: m.base_multiple },
    { k: 'growth_weight', label: 'Growth weight', min: 0, max: 1.5, step: 0.05, v: m.growth_weight },
    { k: 'maturity_floor', label: 'Maturity floor', min: 0.3, max: 0.9, step: 0.05, v: m.maturity_floor },
    { k: 'breadth_per_chain', label: 'Breadth per chain', min: 0, max: 0.05, step: 0.005, v: m.breadth_per_chain }
  ];
  $('sliders').innerHTML = defs.map(function (d, i) {
    return '<div><label>' + d.label + ' <output id="sb-o' + i + '">' + d.v.toFixed(3) + '</output></label>' +
      '<input type="range" id="sb-' + i + '" min="' + d.min + '" max="' + d.max + '" step="' + d.step + '" value="' + d.v + '"></div>';
  }).join('');
  defs.forEach(function (d, i) {
    $('sb-' + i).addEventListener('input', function (e) {
      $('sb-o' + i).textContent = (+e.target.value).toFixed(3);
      sandbox = sandbox || {};
      sandbox[d.k] = +e.target.value;
      var top1 = visibleRows()[0];
      $('sandbox-out').textContent = sandbox ? 'Sandbox top now: ' + (top1 ? top1.name + ' at ' + money(top1.implied_value_usd) : '—') + '. The submitted board keeps the constants above.' : '';
      render();
    });
  });

  // ---- events ----
  $('q').addEventListener('input', function (e) { state.q = e.target.value; render(); });
  $('cat').addEventListener('change', function (e) { state.cat = e.target.value; render(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; render(); });
  $('tab-board').addEventListener('click', function () { setView('board'); });
  $('tab-live').addEventListener('click', function () { setView('live'); });
  function setView(v) {
    state.view = v; state.sel = null;
    $('tab-board').setAttribute('aria-selected', v === 'board' ? 'true' : 'false');
    $('tab-live').setAttribute('aria-selected', v === 'live' ? 'true' : 'false');
    render();
  }
  document.querySelectorAll('#board th').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = 1; }
      render();
    });
  });
  rowsEl.addEventListener('click', function (e) {
    var tr = e.target.closest('tr');
    if (!tr) return;
    state.sel = tr.getAttribute('data-slug');
    render();
  });

  // ---- deep links: #detail=<slug>, #live ----
  function fromHash() {
    var h = location.hash || '';
    if (h.indexOf('#detail=') === 0) { state.sel = decodeURIComponent(h.slice(8)); }
    if (h === '#live') setView('live');
  }
  window.addEventListener('hashchange', function () { fromHash(); render(); });
  fromHash();
  render();
})();
