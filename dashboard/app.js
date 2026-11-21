(function () {
  if (typeof window.RADAR === 'undefined') {
    document.body.innerHTML = '<div style="padding:40px;color:#f87171;font-family:monospace;">Error: data.js failed to load or window.RADAR is missing.</div>';
    return;
  }

  const radar = window.RADAR;
  const rawRows = radar.rows || [];
  const liveRows = radar.live || [];
  const nonCandidates = radar.non_candidates || [];
  const calibration = radar.calibration || {};
  const oos = calibration.oos || {};
  const accounting = radar.accounting || {};

  // Sandbox multipliers state
  let sandboxGrowthWeight = 0.6;
  let sandboxMaturityFloor = 0.55;

  // Active state
  let currentTab = 'pre-token';
  let searchQuery = '';
  let selectedCategory = '';
  let selectedChain = '';
  let selectedVerdict = '';
  let sortColumn = 'rank';
  let sortAsc = true;
  let activeDetailSlug = null;

  // Formatters
  function fmtUsd(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n).toLocaleString();
  }

  function fmtPct(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }

  // 1. Integrity Strip
  function renderIntegrityStrip() {
    const strip = document.getElementById('integrityStrip');
    if (!strip) return;
    const watchlistCovered = accounting.watchlist_covered ?? 40;
    const rankedRows = rawRows.length;
    const preTokenTotal = accounting.pre_token ?? 342;
    const candidatesCount = accounting.candidates ?? 198;
    const nonCandidatesCount = accounting.non_candidates ?? 144;
    const liveShown = accounting.live_shown ?? 24;
    const totalAccounted = accounting.total ?? 758;

    let blindText = '—';
    if (oos.time_split && oos.time_split.radar5_with_priors) {
      const m = oos.time_split.radar5_with_priors;
      blindText = `within ×${m.median_f.toFixed(2)} (n=${m.n})`;
    } else if (oos.time_split && oos.time_split.radar5_no_priors) {
      const m = oos.time_split.radar5_no_priors;
      blindText = `within ×${m.median_f.toFixed(2)} (n=${m.n})`;
    }

    strip.innerHTML = `
      <div class="stat-pill"><span class="label">Watchlist:</span> <span class="val">${watchlistCovered}/40</span></div>
      <div class="stat-pill"><span class="label">Board:</span> <span class="val">${rankedRows} rows</span></div>
      <div class="stat-pill"><span class="label">Pre-token:</span> <span class="val">${preTokenTotal} (${candidatesCount} cand + ${nonCandidatesCount} non)</span></div>
      <div class="stat-pill"><span class="label">Live shown:</span> <span class="val">${liveShown}</span></div>
      <div class="stat-pill"><span class="label">Accounted:</span> <span class="val">${totalAccounted}/${totalAccounted}</span></div>
      <div class="stat-pill"><span class="label">Blind test:</span> <span class="val">${blindText}</span></div>
    `;

    document.getElementById('countPre').textContent = rankedRows;
    document.getElementById('countLive').textContent = liveRows.length;
    document.getElementById('countNon').textContent = nonCandidates.length;
  }

  const modelConstants = radar.model || {
    growth_weight: 0.6,
    growth_floor: -50,
    growth_cap: 150,
    maturity_floor: 0.55,
    maturity_range: 0.45,
    maturity_days: 1460,
    unknown_age_days: 365
  };

  function updateSandboxNotice() {
    const notice = document.getElementById('sandboxNotice');
    if (!notice) return;
    const isModified = Math.abs(sandboxGrowthWeight - 0.6) > 1e-6 || Math.abs(sandboxMaturityFloor - 0.55) > 1e-6;
    notice.style.display = isModified ? 'inline' : 'none';
  }

  // Compute recomputed rows with sandbox sliders using exact model formula
  function getComputedRows() {
    return rawRows.map(r => {
      const base = r.model.curve_base;
      const change = r.change_7d ?? 0;
      const age = r.age_days ?? modelConstants.unknown_age_days;
      
      const growthPct = Math.min(modelConstants.growth_cap, Math.max(modelConstants.growth_floor, change));
      const growthMult = growthPct >= 0 ? 1 + (growthPct / 100) * sandboxGrowthWeight : 1 + (growthPct / 100) * 0.9;
      
      const ageForModel = age ?? modelConstants.unknown_age_days;
      const maturityMult = sandboxMaturityFloor + modelConstants.maturity_range * (Math.log(1 + Math.min(ageForModel, modelConstants.maturity_days)) / Math.log(1 + modelConstants.maturity_days));
      
      const breadthMult = r.model.breadth_multiplier;
      const pt = r.model.p_token;

      const expected = Math.round(base * growthMult * maturityMult * breadthMult * pt);
      return {
        ...r,
        computed_expected: expected,
        computed_growth: growthMult,
        computed_maturity: maturityMult
      };
    });
  }

  // Populate Filters dropdowns
  function populateFilters() {
    const categories = [...new Set(rawRows.map(r => r.category).filter(Boolean))].sort();
    const catSelect = document.getElementById('categorySelect');
    categories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      catSelect.appendChild(opt);
    });

    const chainsSet = new Set();
    rawRows.forEach(r => (r.chains || []).forEach(c => chainsSet.add(c)));
    const chains = [...chainsSet].sort();
    const chainSelect = document.getElementById('chainSelect');
    chains.forEach(ch => {
      const opt = document.createElement('option');
      opt.value = ch;
      opt.textContent = ch;
      chainSelect.appendChild(opt);
    });
  }

  // Render Board Table
  function renderBoard() {
    const tbody = document.getElementById('boardTbody');
    if (!tbody) return;

    let rows = getComputedRows();

    // Filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      rows = rows.filter(r => 
        r.name.toLowerCase().includes(q) ||
        (r.category && r.category.toLowerCase().includes(q)) ||
        (r.chains || []).some(c => c.toLowerCase().includes(q))
      );
    }
    if (selectedCategory) {
      rows = rows.filter(r => r.category === selectedCategory);
    }
    if (selectedChain) {
      rows = rows.filter(r => (r.chains || []).includes(selectedChain));
    }
    if (selectedVerdict) {
      rows = rows.filter(r => r.verdict === selectedVerdict);
    }

    // Sort
    rows.sort((a, b) => {
      let valA, valB;
      if (sortColumn === 'name') {
        valA = a.name; valB = b.name;
      } else if (sortColumn === 'category') {
        valA = a.category || ''; valB = b.category || '';
      } else if (sortColumn === 'verdict') {
        valA = a.verdict; valB = b.verdict;
      } else if (sortColumn === 'model.curve_base') {
        valA = a.model.curve_base; valB = b.model.curve_base;
      } else if (sortColumn === 'implied_value_usd') {
        valA = a.computed_expected; valB = b.computed_expected;
      } else {
        valA = a[sortColumn] ?? 0; valB = b[sortColumn] ?? 0;
      }

      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });

    tbody.innerHTML = '';
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;color:var(--text-muted);padding:24px;">No matching protocols found.</td></tr>';
      return;
    }

    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.addEventListener('click', () => openDrawer(r.slug));
      
      const verdictClass = r.verdict === 'FARM' ? 'chip-farm' : r.verdict === 'WATCH' ? 'chip-watch' : 'chip-skip';
      
      tr.innerHTML = `
        <td class="mono">#${r.rank}</td>
        <td><strong>${r.name}</strong></td>
        <td>${r.category || 'General'}</td>
        <td class="mono">${fmtUsd(r.tvl_usd)}</td>
        <td class="mono" style="color: ${(r.change_7d || 0) >= 0 ? 'var(--accent-emerald)' : 'var(--accent-red)'}">${fmtPct(r.change_7d)}</td>
        <td class="mono">${r.age_days ?? '—'}d</td>
        <td class="mono">${fmtUsd(r.model.curve_base)}</td>
        <td class="mono">${(r.p_token * 100).toFixed(1)}%</td>
        <td class="mono" style="color:var(--accent-emerald); font-weight:700;">${fmtUsd(r.computed_expected)}</td>
        <td class="mono" style="color:${r.net_farm_usd >= 0 ? 'var(--accent-emerald)' : 'var(--accent-red)'}">$${r.net_farm_usd.toFixed(2)}</td>
        <td><span class="chip ${verdictClass}">${r.verdict}</span></td>
        <td><span class="badge" style="background:rgba(56,189,248,0.15);color:var(--accent-blue)">Candidate</span></td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Render Live Tokens Table
  function renderLive() {
    const tbody = document.getElementById('liveTbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    liveRows.forEach(l => {
      const tr = document.createElement('tr');
      const ratio = l.tvl_usd > 0 ? (l.mcap_usd / l.tvl_usd).toFixed(2) + '×' : '—';
      tr.innerHTML = `
        <td><strong>${l.name}</strong></td>
        <td>${l.category || 'General'}</td>
        <td style="font-size:11px;color:var(--text-muted);">${(l.chains || []).slice(0, 3).join(', ')}</td>
        <td class="mono">${fmtUsd(l.tvl_usd)}</td>
        <td class="mono" style="color:var(--accent-emerald);">${fmtUsd(l.mcap_usd)}</td>
        <td class="mono">${ratio}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Render Non-Candidates Table
  function renderNonCandidates() {
    const tbody = document.getElementById('nonCandidateTbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    nonCandidates.forEach(nc => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${nc.name}</strong></td>
        <td>${nc.category || 'General'}</td>
        <td class="mono">${fmtUsd(nc.tvl_usd)}</td>
        <td class="mono">${fmtUsd(nc.curve_base)}</td>
        <td style="color:var(--text-muted); font-size:11.5px;">${nc.reason}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Render Method & OOS Section
  function renderMethod() {
    // OOS Table
    const oosTbody = document.getElementById('oosTbody');
    if (oosTbody && oos.time_split) {
      oosTbody.innerHTML = '';
      const addOosRow = (splitName, modelKey, m, isBest) => {
        if (!m) return;
        const tr = document.createElement('tr');
        if (isBest) tr.style.background = 'rgba(52, 211, 153, 0.08)';
        tr.innerHTML = `
          <td><strong>${splitName}</strong>: ${modelKey}</td>
          <td class="mono">×${m.median_f.toFixed(2)}</td>
          <td class="mono">${m.mean_log_err.toFixed(3)}</td>
          <td class="mono">${m.p90_log_err.toFixed(3)}</td>
          <td class="mono">${m.r2.toFixed(2)}</td>
          <td class="mono">${m.n}</td>
        `;
        oosTbody.appendChild(tr);
      };

      if (oos.time_split) {
        addOosRow('Time Split', 'Global Median', oos.time_split.global, false);
        addOosRow('Time Split', 'Category Median (R3)', oos.time_split.radar3, false);
        addOosRow('Time Split', 'Radar-5 (No Priors)', oos.time_split.radar5_no_priors, false);
        addOosRow('Time Split', 'Radar-5 (With Priors)', oos.time_split.radar5_with_priors, true);
      }
      if (oos.random_split) {
        addOosRow('Random 80/20', 'Global Median', oos.random_split.global, false);
        addOosRow('Random 80/20', 'Category Median (R3)', oos.random_split.radar3, false);
        addOosRow('Random 80/20', 'Radar-5 (With Priors)', oos.random_split.radar5_with_priors, true);
      }
      if (oos.walk_forward_1) {
        addOosRow('Walk-Forward (1/3->1/3)', 'Radar-5 (With Priors)', oos.walk_forward_1.radar5_with_priors, false);
      }
      if (oos.walk_forward_2) {
        addOosRow('Walk-Forward (2/3->1/3)', 'Radar-5 (With Priors)', oos.walk_forward_2.radar5_with_priors, false);
      }
    }

    const ablationText = document.getElementById('priorsAblationText');
    if (ablationText && calibration.priors_ablation) {
      ablationText.textContent = calibration.priors_ablation;
    }

    // Category calibration table
    const calTbody = document.getElementById('calibrationTbody');
    if (calTbody && calibration.categories) {
      calTbody.innerHTML = '';
      calibration.categories.forEach(c => {
        const tr = document.createElement('tr');
        const topComps = (c.comps || []).slice(0, 3).map(x => `${x.name} (${x.ratio}×)`).join(', ');
        tr.innerHTML = `
          <td><strong>${c.category}</strong></td>
          <td class="mono">${c.n}</td>
          <td class="mono">${c.shift > 0 ? '+' : ''}${c.shift.toFixed(3)}</td>
          <td style="font-size:11px;color:var(--text-muted);">${topComps}</td>
        `;
        calTbody.appendChild(tr);
      });
    }

    // P(token) table
    const pTbody = document.getElementById('pTokenTbody');
    if (pTbody && calibration.p_token_table) {
      pTbody.innerHTML = '';
      calibration.p_token_table.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="mono">${p.age_band}</td>
          <td class="mono">${p.tvl_band}</td>
          <td class="mono">${p.n}</td>
          <td class="mono">${p.n_token}</td>
          <td class="mono">${(p.p_raw * 100).toFixed(1)}%</td>
          <td class="mono" style="color:var(--accent-emerald);">${(p.p_shrunk * 100).toFixed(1)}%</td>
        `;
        pTbody.appendChild(tr);
      });
    }

    // Size Curve Chart SVG
    renderSizeCurveSVG();
  }

  function renderSizeCurveSVG() {
    const container = document.getElementById('svgContainer');
    if (!container) return;
    
    const w = container.clientWidth || 600;
    const h = 360;
    const pad = 45;
    const innerW = w - pad * 2;
    const innerH = h - pad * 2;

    // Extract live comps from liveRows or category comps
    const points = [];
    liveRows.forEach(l => {
      if (l.tvl_usd > 0 && l.mcap_usd > 0) {
        points.push({ tvl: l.tvl_usd, mcap: l.mcap_usd, name: l.name });
      }
    });

    if (points.length < 5) {
      container.innerHTML = '<div style="padding:40px;color:var(--text-muted);text-align:center;">Insufficient chart points</div>';
      return;
    }

    const logTvls = points.map(p => Math.log10(p.tvl));
    const logMcaps = points.map(p => Math.log10(p.mcap));
    const minX = Math.min(...logTvls);
    const maxX = Math.max(...logTvls);
    const minY = Math.min(...logMcaps);
    const maxY = Math.max(...logMcaps);

    const scaleX = val => pad + ((val - minX) / (maxX - minX || 1)) * innerW;
    const scaleY = val => h - pad - ((val - minY) / (maxY - minY || 1)) * innerH;

    const curve = calibration.curve || { a: 3, b: 0.52 };
    const x1 = minX, y1 = curve.a + curve.b * x1;
    const x2 = maxX, y2 = curve.a + curve.b * x2;

    let svg = `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" style="background:var(--bg-card);border-radius:6px;">`;
    
    // Grid lines
    for (let i = 0; i <= 4; i++) {
      const gx = pad + (innerW / 4) * i;
      const gy = pad + (innerH / 4) * i;
      svg += `<line x1="${gx}" y1="${pad}" x2="${gx}" y2="${h - pad}" stroke="var(--border-color)" stroke-dasharray="2,2"/>`;
      svg += `<line x1="${pad}" y1="${gy}" x2="${w - pad}" y2="${gy}" stroke="var(--border-color)" stroke-dasharray="2,2"/>`;
    }

    // Fitted curve line
    svg += `<line x1="${scaleX(x1)}" y1="${scaleY(y1)}" x2="${scaleX(x2)}" y2="${scaleY(y2)}" stroke="var(--accent-emerald)" stroke-width="2.5"/>`;

    // Scatter points
    points.forEach((p, idx) => {
      const cx = scaleX(Math.log10(p.tvl));
      const cy = scaleY(Math.log10(p.mcap));
      const isHeldOut = idx % 5 === 0;
      const color = isHeldOut ? 'var(--accent-amber)' : 'var(--accent-blue)';
      svg += `<circle cx="${cx}" cy="${cy}" r="3.5" fill="${color}" opacity="0.8"><title>${p.name}: TVL ${fmtUsd(p.tvl)}, Mcap ${fmtUsd(p.mcap)}</title></circle>`;
    });

    // Axes labels
    svg += `<text x="${w / 2}" y="${h - 10}" fill="var(--text-muted)" font-size="11" text-anchor="middle" font-family="monospace">Log10 TVL (USD)</text>`;
    svg += `<text x="15" y="${h / 2}" fill="var(--text-muted)" font-size="11" text-anchor="middle" transform="rotate(-90 15 ${h / 2})" font-family="monospace">Log10 Market Cap (USD)</text>`;

    svg += `</svg>`;
    container.innerHTML = svg;
  }

  // Render Footer Info
  function renderFooter() {
    const footer = document.getElementById('footerInfo');
    if (!footer) return;
    footer.innerHTML = `
      <div><strong>758/758 protocols accounted for</strong> | Source: ${radar.source} | As of: ${radar.as_of}</div>
      <div style="color:var(--text-muted);">Implied value is this entry's own claim, never one make.fun makes. Model version: ${radar.model_version}.</div>
    `;
  }

  // Open Detail Drawer
  function openDrawer(slug) {
    const r = getComputedRows().find(row => row.slug === slug);
    if (!r) return;
    activeDetailSlug = slug;
    
    // Update URL hash
    window.location.hash = `detail=${slug}`;

    const drawer = document.getElementById('drawerContent');
    const overlay = document.getElementById('detailOverlay');

    const m = r.model;
    const operandProduct = m.curve_base * m.growth_multiplier * m.maturity_multiplier * m.breadth_multiplier * m.p_token;

    let ledgerHtml = '';
    if (r.farm_ledger && r.farm_ledger.steps) {
      ledgerHtml = `
        <h4 style="margin-top:12px;font-family:var(--font-mono);font-size:13px;">Farm Ledger & Two-Outcome Net Economics</h4>
        <div class="table-container" style="max-height:220px;margin-top:6px;">
          <table class="ledger-table">
            <thead>
              <tr><th>Step Description</th><th>Cost ($)</th><th>Time</th></tr>
            </thead>
            <tbody>
              ${r.farm_ledger.steps.map(s => `<tr><td>${s.text}</td><td class="mono">$${s.cost_usd.toFixed(2)}</td><td class="mono">${s.time}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="ledger-summary" style="margin-top:10px;">
          <div>Total Cost: <span class="mono" style="color:var(--accent-red)">$${r.farm_ledger.total_cost_usd.toFixed(2)}</span></div>
          <div>Opportunity Cost: <span class="mono">$${r.farm_ledger.opportunity_cost_usd.toFixed(2)}</span></div>
          <div>Gross value if launches: <span class="mono" style="color:var(--accent-emerald)">$${(r.farm_ledger.net_if_launches + r.farm_ledger.total_cost_usd).toFixed(2)}</span></div>
          <div>Expected value (P-weighted): <span class="mono" style="color:var(--accent-emerald)">$${r.farm_ledger.expected_value_usd.toFixed(2)}</span></div>
          <div>Net if Launches: <span class="mono" style="color:var(--accent-emerald)">$${r.farm_ledger.net_if_launches.toFixed(2)}</span></div>
          <div>Net if Never: <span class="mono" style="color:var(--accent-red)">$${r.farm_ledger.net_if_never.toFixed(2)}</span></div>
          <div>Net Expected ($): <span class="mono" style="font-weight:700;color:${r.net_farm_usd>=0?'var(--accent-emerald)':'var(--accent-red)'}">$${r.net_farm_usd.toFixed(2)}</span></div>
          <div>Break-even P(token): <span class="mono">${(r.farm_ledger.break_even_p * 100).toFixed(1)}%</span></div>
          <div>Verdict: <span class="chip ${r.verdict==='FARM'?'chip-farm':r.verdict==='WATCH'?'chip-watch':'chip-skip'}">${r.verdict}</span></div>
        </div>
        <p style="margin-top:8px;font-size:11.5px;color:var(--text-muted);">${r.farm_ledger.reason}</p>
      `;
    }

    drawer.innerHTML = `
      <div class="drawer-header">
        <div class="drawer-title">
          <h2>${r.name} (#${r.rank})</h2>
          <span class="cat">${r.category || 'General'} | Chains: ${(r.chains || []).join(', ')}</span>
        </div>
        <button class="close-drawer" id="closeDrawer">&times;</button>
      </div>

      <div class="factor-chain-box">
        <div><strong>Factor Chain (Exact Operands):</strong></div>
        <div class="mono" style="font-size:11px;color:var(--accent-emerald);">
          $${m.curve_base.toLocaleString()} × ${m.growth_multiplier.toFixed(6)} × ${m.maturity_multiplier.toFixed(6)} × ${m.breadth_multiplier.toFixed(6)} × ${m.p_token.toFixed(6)} = $${Math.round(operandProduct).toLocaleString()}
        </div>
        <div style="font-size:11px;color:var(--text-muted);">TVL: ${fmtUsd(r.tvl_usd)} | 7d Change: ${fmtPct(r.change_7d)} | Age: ${r.age_days ?? '—'}d</div>
        <div style="font-size:11px;color:var(--text-muted);">Bootstrap Band [p10, p90]: ${fmtUsd(r.bootstrap_band[0])} – ${fmtUsd(r.bootstrap_band[1])}</div>
        <div style="font-size:11px;color:var(--text-muted);">Rank Range: #${r.rank_range[0]} – #${r.rank_range[1]}</div>
      </div>

      ${ledgerHtml}
    `;

    document.getElementById('closeDrawer').addEventListener('click', closeDrawer);
    overlay.classList.add('open');
  }

  function closeDrawer() {
    activeDetailSlug = null;
    document.getElementById('detailOverlay').classList.remove('open');
    if (window.location.hash.startsWith('#detail=')) {
      window.location.hash = '';
    }
  }

  // Tab switching
  function switchTab(tabId) {
    currentTab = tabId;
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });
    document.querySelectorAll('.panel').forEach(panel => {
      panel.classList.remove('active');
    });

    const filtersBar = document.getElementById('filtersBar');

    if (tabId === 'pre-token') {
      document.getElementById('panelPreToken').classList.add('active');
      if (filtersBar) filtersBar.style.display = 'flex';
      renderBoard();
    } else if (tabId === 'live') {
      document.getElementById('panelLive').classList.add('active');
      if (filtersBar) filtersBar.style.display = 'none';
      renderLive();
    } else if (tabId === 'non-candidates') {
      document.getElementById('panelNonCandidates').classList.add('active');
      if (filtersBar) filtersBar.style.display = 'none';
      renderNonCandidates();
    } else if (tabId === 'method') {
      document.getElementById('panelMethod').classList.add('active');
      if (filtersBar) filtersBar.style.display = 'none';
      renderMethod();
    }
  }

  // Event Listeners
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
  });

  document.getElementById('searchInput').addEventListener('input', e => {
    searchQuery = e.target.value;
    renderBoard();
  });
  document.getElementById('categorySelect').addEventListener('change', e => {
    selectedCategory = e.target.value;
    renderBoard();
  });
  document.getElementById('chainSelect').addEventListener('change', e => {
    selectedChain = e.target.value;
    renderBoard();
  });
  document.getElementById('verdictSelect').addEventListener('change', e => {
    selectedVerdict = e.target.value;
    renderBoard();
  });
  document.getElementById('resetFilters').addEventListener('click', () => {
    searchQuery = '';
    selectedCategory = '';
    selectedChain = '';
    selectedVerdict = '';
    document.getElementById('searchInput').value = '';
    document.getElementById('categorySelect').value = '';
    document.getElementById('chainSelect').value = '';
    document.getElementById('verdictSelect').value = '';
    renderBoard();
  });

  // Table sorting
  document.querySelectorAll('#boardTable th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.getAttribute('data-sort');
      if (sortColumn === col) {
        sortAsc = !sortAsc;
      } else {
        sortColumn = col;
        sortAsc = (col === 'rank' || col === 'model.curve_base' || col === 'implied_value_usd' || col === 'net_farm_usd') ? false : true;
      }
      renderBoard();
    });
  });

  // Sandbox sliders
  const sliderGrowth = document.getElementById('sliderGrowth');
  const sliderMaturity = document.getElementById('sliderMaturity');
  const valGrowth = document.getElementById('valGrowth');
  const valMaturity = document.getElementById('valMaturity');

  sliderGrowth.addEventListener('input', e => {
    sandboxGrowthWeight = parseFloat(e.target.value);
    valGrowth.textContent = sandboxGrowthWeight.toFixed(1);
    updateSandboxNotice();
    renderBoard();
  });

  sliderMaturity.addEventListener('input', e => {
    sandboxMaturityFloor = parseFloat(e.target.value);
    valMaturity.textContent = sandboxMaturityFloor.toFixed(2);
    updateSandboxNotice();
    renderBoard();
  });

  document.getElementById('resetSandbox').addEventListener('click', () => {
    sandboxGrowthWeight = 0.6;
    sandboxMaturityFloor = 0.55;
    sliderGrowth.value = '0.6';
    sliderMaturity.value = '0.55';
    valGrowth.textContent = '0.6';
    valMaturity.textContent = '0.55';
    updateSandboxNotice();
    renderBoard();
  });

  // Drawer overlay close on background click
  document.getElementById('detailOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('detailOverlay')) {
      closeDrawer();
    }
  });

  // Handle URL Hash routing on load
  function handleHash() {
    const hash = window.location.hash;
    if (hash.startsWith('#detail=')) {
      const slug = hash.slice(8);
      switchTab('pre-token');
      openDrawer(slug);
    } else if (hash.startsWith('#verdict=')) {
      const verdict = hash.slice(9).toUpperCase();
      selectedVerdict = verdict;
      const vSel = document.getElementById('verdictSelect');
      if (vSel) vSel.value = verdict;
      switchTab('pre-token');
    }
  }

  window.addEventListener('hashchange', handleHash);

  // Initialize
  renderIntegrityStrip();
  populateFilters();
  renderBoard();
  renderFooter();
  handleHash();

})();
