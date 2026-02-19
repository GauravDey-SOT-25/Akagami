/**
 * app.js — Financial Forensics Engine
 * RIFT 2026 Hackathon
 */

// ── App State ──
let appState = { transactions: [], graph: null, detection: null, processingTime: 0, cy: null };

// ── Filter State ──
const filterState = { normal: true, suspicious: true, ring: true };
const FILTER_STYLE = {
  normal:     { glow: '0 0 10px rgba(58,122,204,0.85), 0 0 22px rgba(58,122,204,0.4)',  border: '#3a7acc' },
  suspicious: { glow: '0 0 10px rgba(255,16,48,0.85),  0 0 22px rgba(255,16,48,0.4)',   border: '#ff1030' },
  ring:       { glow: '0 0 10px rgba(240,96,32,0.85),  0 0 22px rgba(240,96,32,0.4)',   border: '#f06020' }
};

function getNodeFilterKey(cyNode) {
  if (cyNode.hasClass('ring'))       return 'ring';
  if (cyNode.hasClass('suspicious')) return 'suspicious';
  return 'normal';
}

function applyFiltersToInstance(cy) {
  if (!cy) return;
  cy.batch(() => {
    cy.nodes().forEach(node => filterState[getNodeFilterKey(node)] ? node.show() : node.hide());
    cy.edges().forEach(edge => {
      const ok = filterState[getNodeFilterKey(edge.source())] && filterState[getNodeFilterKey(edge.target())];
      ok ? edge.show() : edge.hide();
    });
  });
}

function applyFilters() {
  applyFiltersToInstance(appState.cy);
  applyFiltersToInstance(cyOverlay);
}

function syncAllButtonStyles() {
  document.querySelectorAll('.legend-item[data-filter]').forEach(btn => {
    const key = btn.dataset.filter;
    const dot = btn.querySelector('.legend-dot');
    const isOn = filterState[key];
    const s = FILTER_STYLE[key] || FILTER_STYLE.normal;
    btn.style.opacity     = isOn ? '1' : '0.28';
    btn.style.boxShadow   = isOn ? s.glow : 'none';
    btn.style.borderColor = isOn ? s.border : '';
    if (dot) dot.style.boxShadow = isOn ? s.glow : 'none';
  });
}

function handleFilterToggle(key) {
  if (filterState[key]) {
    const remaining = ['normal','suspicious','ring'].filter(k => filterState[k]).length;
    if (remaining === 1) return;
  }
  filterState[key] = !filterState[key];
  applyFilters();
  syncAllButtonStyles();
}

let filterButtonsInited = false;
function initFilterButtons() {
  filterState.normal = true; filterState.suspicious = true; filterState.ring = true;
  applyFilters();
  syncAllButtonStyles();
  if (!filterButtonsInited) {
    filterButtonsInited = true;
    document.querySelectorAll('.legend-item[data-filter]:not([data-overlay-filter])').forEach(btn => {
      btn.style.cursor = 'pointer';
      btn.style.userSelect = 'none';
      btn.style.transition = 'opacity 0.18s, box-shadow 0.18s, border-color 0.18s';
      btn.addEventListener('click', () => handleFilterToggle(btn.dataset.filter));
    });
  }
  syncAllButtonStyles();
}

// ── DOM Refs ──
const dropZone      = document.getElementById('dropZone');
const fileInput     = document.getElementById('fileInput');
const errorBox      = document.getElementById('errorBox');
const uploadMeta    = document.getElementById('uploadMeta');
const statsBar      = document.getElementById('statsBar');
const resultsGrid   = document.getElementById('resultsGrid');
const exportSection = document.getElementById('exportSection');
const progressBar   = document.getElementById('progressBar');
const dropProgress  = document.getElementById('dropProgress');
const loadSampleBtn = document.getElementById('loadSampleBtn');

// ── Upload Handlers ──
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) processFile(file);
});
fileInput.addEventListener('change', e => { if (e.target.files[0]) processFile(e.target.files[0]); });
loadSampleBtn.addEventListener('click', loadSampleData);

function processFile(file) {
  if (!file.name.endsWith('.csv')) { showError('Please upload a CSV file.'); return; }
  hideError();
  setStatus('processing', 'Parsing...');
  showProgress();
  const reader = new FileReader();
  reader.onload = e => setTimeout(() => runPipeline(e.target.result, file.name), 50);
  reader.readAsText(file);
}

function runPipeline(csvText, filename) {
  try {
    const t0 = performance.now();
    setProgress(20);
    const { transactions, skipped } = Parser.parseCSV(csvText);
    appState.transactions = transactions;
    setProgress(45);
    appState.graph = GraphBuilder.build(transactions);
    setProgress(70);
    appState.detection = DetectionEngine.run(appState.graph);
    appState.processingTime = ((performance.now() - t0) / 1000).toFixed(2);
    setProgress(100);
    setTimeout(() => {
      hideProgress();
      renderResults(filename, transactions, appState.graph, appState.detection, skipped);
      setStatus('done', 'Analysis Complete');
    }, 300);
  } catch (err) {
    hideProgress();
    showError(err.message);
    setStatus('error', 'Error');
  }
}

// ── Render Results ──
function renderResults(filename, transactions, graph, detection, skipped) {
  const { suspicious, fraudRings } = detection;
  uploadMeta.style.display = 'flex';
  document.getElementById('metaFilename').textContent = filename;
  document.getElementById('metaRows').textContent = `${transactions.length.toLocaleString()} transactions`;
  if (skipped > 0) document.getElementById('metaTime').textContent = `${skipped} rows skipped`;
  statsBar.style.display = 'grid';
  document.getElementById('statAccounts').textContent   = graph.nodes.size.toLocaleString();
  document.getElementById('statTxns').textContent       = transactions.length.toLocaleString();
  document.getElementById('statSuspicious').textContent = suspicious.length;
  document.getElementById('statRings').textContent      = fraudRings.length;
  document.getElementById('statTime').textContent       = `${appState.processingTime}s`;
  resultsGrid.style.display   = 'grid';
  exportSection.style.display = 'block';

  // Show date search bar and seed date bounds
  initDateSearchBar(transactions);

  renderGraph(graph, suspicious, fraudRings);
  renderAccountsTable(suspicious);
  renderRingsPanel(fraudRings);
  renderSummarySection(transactions, graph, detection);
}

// ── Summary Section ──
let _summaryModalWired = false;

function renderSummarySection(transactions, graph, detection) {
  const { suspicious, fraudRings } = detection;

  // Show the trigger button
  const section = document.getElementById('summarySection');
  section.style.display = 'block';

  // Wire modal open/close once
  if (!_summaryModalWired) {
    _summaryModalWired = true;
    document.getElementById('openSummaryBtn').addEventListener('click', () => {
      document.getElementById('summaryModalBackdrop').style.display = 'flex';
      document.body.style.overflow = 'hidden';
    });
    document.getElementById('closeSummaryBtn').addEventListener('click', closeSummaryModal);
    document.getElementById('summaryModalBackdrop').addEventListener('click', e => {
      if (e.target === e.currentTarget) closeSummaryModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && document.getElementById('summaryModalBackdrop').style.display !== 'none') closeSummaryModal();
    });
  }

  // Always re-render the grid content so it reflects filtered data
  _buildSummaryGrid(transactions, graph, detection);
}

function closeSummaryModal() {
  document.getElementById('summaryModalBackdrop').style.display = 'none';
  document.body.style.overflow = '';
}

function _buildSummaryGrid(transactions, graph, detection) {
  const { suspicious, fraudRings } = detection;
  const grid = document.getElementById('summaryGrid');

  const totalVolume = transactions.reduce((s, t) => s + t.amount, 0);
  const avgTxn      = totalVolume / (transactions.length || 1);
  const maxTxn      = Math.max(...transactions.map(t => t.amount));
  const minTxn      = Math.min(...transactions.map(t => t.amount));
  const suspVolume  = suspicious.reduce((s, acc) => {
    const node = graph.nodes.get(acc.account_id);
    return s + (node ? node.totalSent + node.totalReceived : 0);
  }, 0) / 2;
  const ringVolume  = fraudRings.reduce((s, ring) => {
    return s + ring.member_accounts.reduce((rs, acc) => {
      const node = graph.nodes.get(acc);
      return rs + (node ? node.totalSent : 0);
    }, 0);
  }, 0);

  const timestamps = transactions.map(t => t.timestamp).sort((a,b) => a - b);
  const dateFirst  = timestamps.length ? new Date(timestamps[0]) : null;
  const dateLast   = timestamps.length ? new Date(timestamps[timestamps.length - 1]) : null;
  const spanDays   = dateFirst && dateLast ? Math.max(1, Math.round((dateLast - dateFirst) / 86400000)) : 1;
  const txnPerDay  = (transactions.length / spanDays).toFixed(1);

  const fmt = n => n >= 1e6 ? `$${(n/1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n/1e3).toFixed(1)}k` : `$${n.toFixed(0)}`;
  const fmtDate = d => d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : '—';

  const patternCount = new Map();
  for (const acc of suspicious) for (const p of acc.detected_patterns) patternCount.set(p, (patternCount.get(p) || 0) + 1);
  const sortedPatterns = [...patternCount.entries()].sort((a,b) => b[1]-a[1]);
  const maxPatCount    = sortedPatterns[0]?.[1] || 1;
  const patColors      = ['#00c8f0','#8060f0','#f06020','#ff1030','#f0a000','#00e090'];

  const topSusp = suspicious.slice(0, 8);

  const flowMap = new Map();
  for (const txn of transactions) {
    const key = `${txn.sender_id}→${txn.receiver_id}`;
    if (!flowMap.has(key)) flowMap.set(key, { sender: txn.sender_id, receiver: txn.receiver_id, total: 0, count: 0 });
    const f = flowMap.get(key); f.total += txn.amount; f.count++;
  }
  const topFlows = [...flowMap.values()].sort((a,b) => b.total - a.total).slice(0, 8);

  const dayMap = new Map();
  for (const txn of transactions) {
    const d = new Date(txn.timestamp);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (!dayMap.has(key)) dayMap.set(key, { out: 0, count: 0 });
    dayMap.get(key).out += txn.amount; dayMap.get(key).count++;
  }
  const sortedDays = [...dayMap.entries()].sort((a,b) => a[0].localeCompare(b[0])).slice(-10);
  const maxDayVol  = Math.max(...sortedDays.map(([,v]) => v.out), 1);

  function nodeFlowHtml(accId) {
    const node = graph.nodes.get(accId);
    if (!node) return '—';
    const total = node.totalSent + node.totalReceived || 1;
    const op = ((node.totalSent / total) * 100).toFixed(0);
    return `<div class="sum-flow-bar-wrap" style="width:72px"><div class="sum-flow-out" style="width:${op}%"></div><div class="sum-flow-in" style="width:${100-op}%"></div></div>`;
  }

  grid.innerHTML = `
    <div class="sum-block sum-block-wide">
      <div class="sum-block-header"><span class="sum-block-title">Overview</span><span class="sum-block-badge">${fmtDate(dateFirst)} → ${fmtDate(dateLast)} · ${spanDays}d span</span></div>
      <div class="sum-kpi-row">
        <div class="sum-kpi"><div class="sum-kpi-val accent">${graph.nodes.size.toLocaleString()}</div><div class="sum-kpi-label">Total Accounts</div></div>
        <div class="sum-kpi"><div class="sum-kpi-val">${transactions.length.toLocaleString()}</div><div class="sum-kpi-label">Transactions</div></div>
        <div class="sum-kpi"><div class="sum-kpi-val success">${fmt(totalVolume)}</div><div class="sum-kpi-label">Total Volume</div></div>
        <div class="sum-kpi"><div class="sum-kpi-val">${txnPerDay}</div><div class="sum-kpi-label">Txns / Day</div></div>
      </div>
      <div class="sum-kpi-row" style="border-top:1px solid #111520;padding-top:14px;padding-bottom:18px;">
        <div class="sum-kpi"><div class="sum-kpi-val danger">${suspicious.length}</div><div class="sum-kpi-label">Suspicious Accounts</div></div>
        <div class="sum-kpi"><div class="sum-kpi-val ring">${fraudRings.length}</div><div class="sum-kpi-label">Fraud Rings</div></div>
        <div class="sum-kpi"><div class="sum-kpi-val warn">${fmt(suspVolume)}</div><div class="sum-kpi-label">Suspicious Volume</div></div>
        <div class="sum-kpi"><div class="sum-kpi-val warn">${suspicious.length && graph.nodes.size ? ((suspicious.length/graph.nodes.size)*100).toFixed(1)+'%' : '0%'}</div><div class="sum-kpi-label">Fraud Rate</div></div>
      </div>
    </div>

    <div class="sum-block">
      <div class="sum-block-header"><span class="sum-block-title">Top Suspicious Accounts</span><span class="sum-block-badge">by score</span></div>
      <table class="sum-table"><thead><tr><th>#</th><th>Account</th><th>Score</th><th>Flow</th><th>Patterns</th></tr></thead><tbody>
        ${topSusp.length ? topSusp.map((acc, i) => {
          const sc = acc.suspicion_score;
          const scColor = sc >= 75 ? '#ff1030' : sc >= 50 ? '#f0a000' : '#00c8f0';
          return `<tr data-account="${acc.account_id}"><td><span class="sum-rank">${i+1}</span></td><td class="sum-acc-id">${acc.account_id}</td><td><div class="sum-score-wrap"><div class="sum-score-bar"><div class="sum-score-fill" style="width:${sc}%;background:${scColor}"></div></div><span class="sum-score-num" style="color:${scColor}">${sc}</span></div></td><td>${nodeFlowHtml(acc.account_id)}</td><td>${acc.detected_patterns.map(p=>`<span class="sum-pattern-tag">${p.replace(/_/g,' ')}</span>`).join('')}</td></tr>`;
        }).join('') : `<tr><td colspan="5" style="color:#3a4f68;text-align:center;padding:20px;">None detected</td></tr>`}
      </tbody></table>
    </div>

    <div class="sum-block">
      <div class="sum-block-header"><span class="sum-block-title">Fraud Rings</span><span class="sum-block-badge">${fraudRings.length} detected</span></div>
      <table class="sum-table"><thead><tr><th>Ring</th><th>Members</th><th>Pattern</th><th>Risk</th><th>Volume</th></tr></thead><tbody>
        ${fraudRings.length ? fraudRings.map(ring => {
          const vol = ring.member_accounts.reduce((s,acc) => { const n=graph.nodes.get(acc); return s+(n?n.totalSent:0); },0);
          const rc = ring.risk_score>=75?'sum-risk-high':ring.risk_score>=50?'sum-risk-med':'sum-risk-low';
          return `<tr><td class="sum-ring-id">${ring.ring_id}</td><td>${ring.member_accounts.length}</td><td><span class="sum-pattern-tag">${ring.pattern_type.replace(/_/g,' ')}</span></td><td class="${rc}">${ring.risk_score}</td><td class="sum-amount">${fmt(vol)}</td></tr>`;
        }).join('') : `<tr><td colspan="5" style="color:#3a4f68;text-align:center;padding:20px;">None detected</td></tr>`}
      </tbody></table>
    </div>

    <div class="sum-block">
      <div class="sum-block-header"><span class="sum-block-title">Pattern Distribution</span><span class="sum-block-badge">across flagged accounts</span></div>
      <div class="sum-pattern-bars">
        ${sortedPatterns.length ? sortedPatterns.map(([pat,cnt],i) => `
          <div class="sum-pat-row">
            <span class="sum-pat-name">${pat.replace(/_/g,' ')}</span>
            <div class="sum-pat-track"><div class="sum-pat-fill" style="width:${(cnt/maxPatCount*100).toFixed(1)}%;background:${patColors[i%patColors.length]}"></div></div>
            <span class="sum-pat-count">${cnt}</span>
          </div>`).join('') : '<div style="color:#3a4f68;font-family:Space Mono,monospace;font-size:10px;padding:8px 0;">No patterns detected</div>'}
      </div>
    </div>

    <div class="sum-block">
      <div class="sum-block-header"><span class="sum-block-title">Top Money Flows</span><span class="sum-block-badge">highest volume pairs</span></div>
      <table class="sum-table"><thead><tr><th>#</th><th>From</th><th>To</th><th>Total</th><th>Txns</th></tr></thead><tbody>
        ${topFlows.map((f,i) => `<tr><td><span class="sum-rank">${i+1}</span></td><td class="sum-acc-id">${f.sender}</td><td class="sum-acc-id">${f.receiver}</td><td class="sum-amount">${fmt(f.total)}</td><td>${f.count}</td></tr>`).join('')}
      </tbody></table>
    </div>

    <div class="sum-block">
      <div class="sum-block-header"><span class="sum-block-title">Transaction Statistics</span><span class="sum-block-badge">amount distribution</span></div>
      <table class="sum-table"><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>
        <tr><td>Total Volume</td><td class="sum-amount">${fmt(totalVolume)}</td></tr>
        <tr><td>Average Amount</td><td class="sum-amount">${fmt(avgTxn)}</td></tr>
        <tr><td>Largest Transaction</td><td class="sum-amount">${fmt(maxTxn)}</td></tr>
        <tr><td>Smallest Transaction</td><td class="sum-amount">${fmt(minTxn)}</td></tr>
        <tr><td>Suspicious Volume</td><td><span class="sum-risk-med">${fmt(suspVolume)}</span></td></tr>
        <tr><td>Ring-linked Volume</td><td><span class="sum-risk-high">${fmt(ringVolume)}</span></td></tr>
        <tr><td>Unique Sender–Receiver Pairs</td><td>${flowMap.size.toLocaleString()}</td></tr>
        <tr><td>Avg Txns / Day</td><td>${txnPerDay}</td></tr>
        <tr><td>Date Range</td><td>${fmtDate(dateFirst)} → ${fmtDate(dateLast)}</td></tr>
      </tbody></table>
    </div>

    <div class="sum-block sum-block-wide">
      <div class="sum-block-header"><span class="sum-block-title">Daily Transaction Activity</span><span class="sum-block-badge">last ${sortedDays.length} active days</span></div>
      ${sortedDays.length ? `
        <div style="padding:14px 18px;display:flex;flex-direction:column;gap:7px;">
          ${sortedDays.map(([date,v]) => {
            const barPct = (v.out/maxDayVol*100).toFixed(1);
            return `<div style="display:grid;grid-template-columns:90px 1fr 100px;align-items:center;gap:12px;">
              <span style="font-family:'Space Mono',monospace;font-size:9px;color:#3a4f68;">${date}</span>
              <div style="height:10px;background:#111520;border-radius:3px;overflow:hidden;"><div style="height:100%;width:${barPct}%;background:linear-gradient(90deg,#00c8f0,#8060f0);border-radius:3px;"></div></div>
              <span style="font-family:'Space Mono',monospace;font-size:9px;color:#6e88a6;text-align:right;">${fmt(v.out)} · ${v.count} txns</span>
            </div>`;
          }).join('')}
        </div>
        <div class="sum-legend-row"><span><span class="sum-legend-dot" style="background:linear-gradient(90deg,#00c8f0,#8060f0)"></span>Transaction Volume</span></div>
      ` : '<div style="color:#3a4f68;font-family:Space Mono,monospace;font-size:10px;padding:20px;">No dated transactions</div>'}
    </div>
  `;

  grid.querySelectorAll('tr[data-account]').forEach(row => {
    row.addEventListener('click', () => openAccountPanel(row.dataset.account));
  });
}

// ── Account Detail Panel ──
function openAccountPanel(accountId, panelEl) {
  if (!panelEl) panelEl = document.getElementById('accountDetailPanel');
  const graph     = appState.graph;
  const detection = appState.detection;
  const node      = graph.nodes.get(accountId);
  if (!node) return;

  const susInfo  = detection.suspicious.find(s => s.account_id === accountId);
  const ringInfo = susInfo?.ring_id ? detection.fraudRings.find(r => r.ring_id === susInfo.ring_id) : null;
  const txns     = (graph.txnByAccount.get(accountId) || []).slice().sort((a,b) => b.timestamp - a.timestamp).slice(0, 20);
  const sentTo   = new Set(node.outEdges.map(e => e.target));
  const recvFrom = new Set(node.inEdges.map(e => e.source));

  let statusLabel = 'Normal', statusClass = 'nd2-status-normal';
  if (ringInfo)     { statusLabel = 'Ring Member'; statusClass = 'nd2-status-ring'; }
  else if (susInfo) { statusLabel = 'Suspicious';  statusClass = 'nd2-status-suspicious'; }

  const score      = susInfo?.suspicion_score ?? 0;
  const scoreColor = score >= 75 ? '#ff1030' : score >= 50 ? '#f0a000' : score > 0 ? '#00c8f0' : '#3a4f68';
  const totalFlow  = node.totalSent + node.totalReceived || 1;
  const sentPct    = ((node.totalSent / totalFlow) * 100).toFixed(1);
  const recvPct    = ((node.totalReceived / totalFlow) * 100).toFixed(1);

  const patternHtml = susInfo ? susInfo.detected_patterns.map(p => `<span class="nd2-pattern">${p.replace(/_/g,' ')}</span>`).join('') : '<span class="nd2-muted">None detected</span>';
  const ringHtml = ringInfo ? `
    <div class="nd2-ring-block">
      <div class="nd2-ring-id">${ringInfo.ring_id}</div>
      <div class="nd2-ring-meta"><span>${ringInfo.member_accounts.length} members</span><span class="nd2-ring-dot">·</span><span>${ringInfo.pattern_type.replace(/_/g,' ')}</span><span class="nd2-ring-dot">·</span><span>Risk ${ringInfo.risk_score}</span></div>
      <div class="nd2-ring-peers">${ringInfo.member_accounts.filter(a => a !== accountId).map(a => `<span class="nd2-ring-peer" data-peer="${a}">${a}</span>`).join('')}</div>
    </div>` : '';

  const txnRows = txns.map(txn => {
    const isSent  = txn.sender_id === accountId;
    const peer    = isSent ? txn.receiver_id : txn.sender_id;
    const dt      = new Date(txn.timestamp);
    const dateStr = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
    return `<div class="nd2-txn-row"><div class="nd2-txn-dir ${isSent?'sent':'recv'}">${isSent?'↑ OUT':'↓ IN'}</div><div class="nd2-txn-peer">${peer}</div><div class="nd2-txn-amount ${isSent?'sent':'recv'}">${isSent?'−':'+'}$${txn.amount.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div><div class="nd2-txn-date">${dateStr}</div></div>`;
  }).join('');

  panelEl.innerHTML = `
    <div class="nd2-header">
      <div class="nd2-header-left">
        <div class="nd2-label">Account Details</div>
        <div class="nd2-account-id">${accountId}</div>
        <span class="nd2-status ${statusClass}">${statusLabel}</span>
      </div>
      <button class="nd2-close" id="closeAccountPanel" title="Close">✕</button>
    </div>
    <div class="nd2-body">
      ${susInfo ? `<div class="nd2-section"><div class="nd2-section-title">Suspicion Score</div><div class="nd2-score-row"><div class="nd2-score-track"><div class="nd2-score-fill" style="width:${score}%;background:${scoreColor};box-shadow:0 0 8px ${scoreColor}88"></div></div><span class="nd2-score-val" style="color:${scoreColor}">${score}</span></div></div>` : ''}
      <div class="nd2-section">
        <div class="nd2-section-title">Transaction Flow</div>
        <div class="nd2-stats-grid">
          <div class="nd2-stat"><div class="nd2-stat-val">${node.txnCount}</div><div class="nd2-stat-label">Total Txns</div></div>
          <div class="nd2-stat"><div class="nd2-stat-val sent">$${node.totalSent.toLocaleString(undefined,{maximumFractionDigits:0})}</div><div class="nd2-stat-label">Total Sent</div></div>
          <div class="nd2-stat"><div class="nd2-stat-val recv">$${node.totalReceived.toLocaleString(undefined,{maximumFractionDigits:0})}</div><div class="nd2-stat-label">Total Received</div></div>
          <div class="nd2-stat"><div class="nd2-stat-val">${sentTo.size + recvFrom.size}</div><div class="nd2-stat-label">Counterparties</div></div>
        </div>
        <div class="nd2-flow-bar-wrap">
          <span class="nd2-flow-label sent">OUT ${sentPct}%</span>
          <div class="nd2-flow-bar"><div class="nd2-flow-sent" style="width:${sentPct}%"></div></div>
          <span class="nd2-flow-label recv">IN ${recvPct}%</span>
        </div>
      </div>
      <div class="nd2-section"><div class="nd2-section-title">Detected Patterns</div><div class="nd2-patterns">${patternHtml}</div></div>
      ${ringHtml ? `<div class="nd2-section"><div class="nd2-section-title">Fraud Ring</div>${ringHtml}</div>` : ''}
      <div class="nd2-section">
        <div class="nd2-section-title">Connections</div>
        <div class="nd2-conn-row">
          <div><div class="nd2-conn-label">↑ Sends To (${sentTo.size})</div><div class="nd2-conn-list">${[...sentTo].map(a=>`<span class="nd2-conn-peer sent-peer">${a}</span>`).join('')}</div></div>
          <div><div class="nd2-conn-label">↓ Receives From (${recvFrom.size})</div><div class="nd2-conn-list">${[...recvFrom].map(a=>`<span class="nd2-conn-peer recv-peer">${a}</span>`).join('')}</div></div>
        </div>
      </div>
      <div class="nd2-section"><div class="nd2-section-title">Recent Transactions <span class="nd2-muted">(last ${txns.length})</span></div><div class="nd2-txn-list">${txnRows || '<div class="nd2-muted" style="padding:8px 0">No transactions found</div>'}</div></div>
    </div>
  `;

  panelEl.style.display = 'flex';
  requestAnimationFrame(() => panelEl.classList.add('nd2-open'));
  panelEl.querySelector('.nd2-close').addEventListener('click', () => closeAccountPanel(panelEl));
  panelEl.querySelectorAll('[data-peer]').forEach(el => { el.style.cursor='pointer'; el.addEventListener('click', () => openAccountPanel(el.dataset.peer, panelEl)); });
  panelEl.querySelectorAll('.nd2-conn-peer').forEach(el => { el.style.cursor='pointer'; el.addEventListener('click', () => openAccountPanel(el.textContent.trim(), panelEl)); });
}

function closeAccountPanel(panelEl) {
  const panel = panelEl || document.getElementById('accountDetailPanel');
  panel.classList.remove('nd2-open');
  setTimeout(() => { panel.style.display = 'none'; }, 280);
}

// ── Graph ──
function renderGraph(graph, suspicious, fraudRings) {
  const suspSet       = new Set(suspicious.map(s => s.account_id));
  const ringMemberSet = new Set(fraudRings.flatMap(r => r.member_accounts));
  const ringColorMap  = new Map();
  for (const ring of fraudRings) for (const acc of ring.member_accounts) ringColorMap.set(acc, ring.ring_id);

  const MAX_NODES = 300;
  let nodeIds = [...graph.nodes.keys()];
  let edges   = graph.edges;
  if (nodeIds.length > MAX_NODES) {
    const priority = new Set([...suspSet, ...ringMemberSet]);
    for (const acc of suspSet) { for (const n of (graph.adjOut.get(acc)||[])) priority.add(n); for (const n of (graph.adjIn.get(acc)||[])) priority.add(n); }
    nodeIds = [...priority].slice(0, MAX_NODES);
    const nodeSet = new Set(nodeIds);
    edges = edges.filter(e => nodeSet.has(e.source) && nodeSet.has(e.target));
  }

  const cyNodes = nodeIds.map(id => {
    const node = graph.nodes.get(id);
    let cls = 'normal';
    if (ringMemberSet.has(id)) cls = 'ring';
    else if (suspSet.has(id))  cls = 'suspicious';
    return { data: { id, label: id.length > 10 ? id.slice(0,10)+'…' : id, txnCount: node.txnCount, totalSent: node.totalSent.toFixed(2), totalReceived: node.totalReceived.toFixed(2), ring: ringColorMap.get(id) || null }, classes: cls };
  });

  const edgeMap = new Map();
  for (const e of edges) {
    const key = `${e.source}__${e.target}`;
    if (!edgeMap.has(key)) edgeMap.set(key, { source: e.source, target: e.target, count: 0, total: 0 });
    edgeMap.get(key).count++; edgeMap.get(key).total += e.amount;
  }
  const cyEdges = [...edgeMap.values()].map((e, i) => ({ data: { id: `e_${i}`, source: e.source, target: e.target, count: e.count, total: e.total.toFixed(2) } }));

  if (appState.cy) appState.cy.destroy();

  appState.cy = cytoscape({
    container: document.getElementById('cy'),
    elements:  { nodes: cyNodes, edges: cyEdges },
    style: [
      { selector: 'node', style: { 'background-color': '#1a3a6b', 'border-color': '#3a7acc', 'border-width': 1.5, 'label': 'data(label)', 'color': '#ffffff', 'font-size': 9, 'font-family': 'Space Mono, monospace', 'font-weight': 'bold', 'text-valign': 'bottom', 'text-halign': 'center', 'text-margin-y': 8, 'text-background-color': '#0b0e17', 'text-background-opacity': 0.92, 'text-background-padding': '4px', 'text-background-shape': 'roundrectangle', 'text-wrap': 'ellipsis', 'text-max-width': '80px', 'min-zoomed-font-size': 6, 'width': 34, 'height': 34, 'cursor': 'pointer' } },
      { selector: 'node.suspicious', style: { 'background-color': '#6a0000', 'border-color': '#ff1030', 'border-width': 2.5, 'color': '#ffdddd', 'text-background-color': '#2a0000', 'text-background-opacity': 0.95, 'text-background-padding': '4px', 'text-background-shape': 'roundrectangle', 'width': 34, 'height': 34 } },
      { selector: 'node.ring',       style: { 'background-color': '#4a2000', 'border-color': '#f06020', 'border-width': 2.5, 'color': '#ffe8cc', 'text-background-color': '#1a0a00', 'text-background-opacity': 0.95, 'text-background-padding': '4px', 'text-background-shape': 'roundrectangle', 'width': 34, 'height': 34 } },
      { selector: 'node:selected',   style: { 'border-color': '#00c8f0', 'border-width': 3, 'background-color': '#003a50' } },
      { selector: 'edge', style: { 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#4a6a90', 'line-color': '#2e4a68', 'arrow-scale': 1.2, 'width': 1.5, 'opacity': 0.8 } },
      { selector: 'edge:selected', style: { 'line-color': '#00c8f0', 'target-arrow-color': '#00c8f0', 'width': 2.5, 'opacity': 1 } }
    ],
    layout: { name: 'cose', animate: false, randomize: false, nodeRepulsion: 12000, nodeOverlap: 20, idealEdgeLength: 120, edgeElasticity: 100, nestingFactor: 5, gravity: 80, numIter: 1000, initialTemp: 200, coolingFactor: 0.95, minTemp: 1.0 },
    zoom: 1, minZoom: 0.1, maxZoom: 5,
    userPanningEnabled: true, userZoomingEnabled: true, boxSelectionEnabled: false
  });

  initFilterButtons();
  initExpandButton();

  appState.cy.on('tap', 'node', evt => openAccountPanel(evt.target.id(), document.getElementById('accountDetailPanel')));
  appState.cy.on('tap', evt => { if (evt.target === appState.cy) closeAccountPanel(document.getElementById('accountDetailPanel')); });

  document.getElementById('layoutCose').addEventListener('click', function () {
    setActiveLayout(this); showCyGraph();
    appState.cy.layout({ name: 'cose', animate: true, nodeRepulsion: 12000, nodeOverlap: 20, idealEdgeLength: 120, edgeElasticity: 100, gravity: 80, numIter: 1000 }).run();
  });
  document.getElementById('layoutCircle').addEventListener('click', function () { setActiveLayout(this); showCyGraph(); appState.cy.layout({ name: 'circle', animate: true }).run(); });
  document.getElementById('layoutGrid').addEventListener('click',   function () { setActiveLayout(this); showCyGraph(); appState.cy.layout({ name: 'grid',   animate: true }).run(); });
  document.getElementById('layoutAdjList').addEventListener('click', function () { setActiveLayout(this); showAdjacencyList('adjListView', graph, suspicious, fraudRings); });
}

function setActiveLayout(btn) {
  document.querySelectorAll('.ctrl-btn:not(.expand-btn)').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}
function showCyGraph() {
  document.getElementById('cy').style.display = '';
  document.getElementById('adjListView').style.display = 'none';
}
function showAdjacencyList(containerId, graph, suspicious, fraudRings) {
  document.getElementById('cy').style.display = 'none';
  const container = document.getElementById(containerId);
  container.style.display = 'block';
  renderAdjacencyList(container, graph, suspicious, fraudRings);
}

function renderAdjacencyList(container, graph, suspicious, fraudRings) {
  const suspSet  = new Set(suspicious.map(s => s.account_id));
  const ringSet  = new Set(fraudRings.flatMap(r => r.member_accounts));
  const suspMap  = new Map(suspicious.map(s => [s.account_id, s]));
  const outMap   = new Map();
  const inMap    = new Map();

  for (const edge of graph.edges) {
    const { source, target, amount } = edge;
    if (!outMap.has(source)) outMap.set(source, new Map());
    const om = outMap.get(source);
    if (!om.has(target)) om.set(target, { count: 0, total: 0 });
    om.get(target).count++; om.get(target).total += amount;
    if (!inMap.has(target)) inMap.set(target, new Map());
    const im = inMap.get(target);
    if (!im.has(source)) im.set(source, { count: 0, total: 0 });
    im.get(source).count++; im.get(source).total += amount;
  }

  let sortMode = 'id', searchQ = '';

  function nodeClass(id) { return ringSet.has(id) ? 'ring' : suspSet.has(id) ? 'suspicious' : 'normal'; }
  function fmt(n) { return n >= 1000 ? `$${(n/1000).toFixed(1)}k` : `$${n.toFixed(0)}`; }

  function buildHTML() {
    let nodes = [...graph.nodes.keys()];
    if (searchQ) { const q = searchQ.toLowerCase(); nodes = nodes.filter(id => id.toLowerCase().includes(q)); }
    if (sortMode === 'score') nodes.sort((a,b) => ((suspMap.get(b)?.suspicion_score||0) - (suspMap.get(a)?.suspicion_score||0)) || a.localeCompare(b));
    else if (sortMode === 'degree') nodes.sort((a,b) => (((outMap.get(b)?.size||0)+(inMap.get(b)?.size||0)) - ((outMap.get(a)?.size||0)+(inMap.get(a)?.size||0))) || a.localeCompare(b));
    else nodes.sort((a,b) => a.localeCompare(b));

    const rows = nodes.map(id => {
      const node  = graph.nodes.get(id);
      const cls   = nodeClass(id);
      const sus   = suspMap.get(id);
      const outs  = [...(outMap.get(id) || new Map()).entries()];
      const ins   = [...(inMap.get(id)  || new Map()).entries()];
      const badgeHtml = cls !== 'normal' ? `<span class="adj-node-badge ${cls}">${cls==='ring'?'RING':'SUSP'}</span>` : '';
      const scoreHtml = sus ? `<span class="adj-node-meta">score <span>${sus.suspicion_score}</span></span>` : '';
      const outEdges = outs.map(([tgt,e]) => `<div class="adj-edge-item" data-peer="${tgt}"><span class="adj-edge-arrow out">→</span><span class="adj-edge-peer">${tgt}</span><span class="adj-edge-amount out">−${fmt(e.total)}</span><span class="adj-edge-count">${e.count}×</span></div>`).join('');
      const inEdges  = ins.map(([src,e])  => `<div class="adj-edge-item" data-peer="${src}"><span class="adj-edge-arrow in">←</span><span class="adj-edge-peer">${src}</span><span class="adj-edge-amount in">+${fmt(e.total)}</span><span class="adj-edge-count">${e.count}×</span></div>`).join('');
      return `<div class="adj-node-row" data-id="${id}">
        <div class="adj-node-header"><span class="adj-node-chevron">▶</span><span class="adj-node-dot ${cls}"></span><span class="adj-node-id">${id}</span>${badgeHtml}${scoreHtml}<span class="adj-node-meta">out <span>${outs.length}</span> · in <span>${ins.length}</span> · txns <span>${node.txnCount}</span></span></div>
        <div class="adj-edges-block">
          ${outs.length ? `<div class="adj-section-label">Outgoing (${outs.length})</div><div class="adj-edge-list">${outEdges}</div>` : ''}
          ${ins.length  ? `<div class="adj-section-label">Incoming (${ins.length})</div><div class="adj-edge-list">${inEdges}</div>`  : ''}
          ${!outs.length && !ins.length ? '<div class="adj-empty-edges">No edges</div>' : ''}
        </div>
      </div>`;
    }).join('');

    return `<div class="adj-toolbar">
      <input class="adj-search" id="adjSearch" placeholder="Search account…" value="${searchQ}" />
      <button class="adj-sort-btn ${sortMode==='id'?'active':''}" data-sort="id">A–Z</button>
      <button class="adj-sort-btn ${sortMode==='score'?'active':''}" data-sort="score">Score ↓</button>
      <button class="adj-sort-btn ${sortMode==='degree'?'active':''}" data-sort="degree">Degree ↓</button>
      <span class="adj-count">${nodes.length} nodes</span>
    </div><div class="adj-body">${rows}</div>`;
  }

  function attach() {
    const searchEl = container.querySelector('#adjSearch');
    if (searchEl) {
      searchEl.addEventListener('input', e => { searchQ = e.target.value; container.innerHTML = buildHTML(); attach(); });
      searchEl.focus(); const len = searchEl.value.length; searchEl.setSelectionRange(len, len);
    }
    container.querySelectorAll('.adj-sort-btn').forEach(btn => {
      btn.addEventListener('click', () => { sortMode = btn.dataset.sort; container.innerHTML = buildHTML(); attach(); });
    });
    container.querySelectorAll('.adj-node-row').forEach(row => {
      row.querySelector('.adj-node-header').addEventListener('click', () => row.classList.toggle('expanded'));
    });
    container.querySelectorAll('.adj-edge-item[data-peer]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        const inOverlay = container.id === 'adjListViewOverlay';
        const panelEl = inOverlay ? document.getElementById('accountDetailPanelOverlay') : document.getElementById('accountDetailPanel');
        openAccountPanel(el.dataset.peer, panelEl);
      });
    });
    container.querySelectorAll('.adj-node-id').forEach(el => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', e => {
        e.stopPropagation();
        const id = el.closest('.adj-node-row').dataset.id;
        const inOverlay = container.id === 'adjListViewOverlay';
        const panelEl = inOverlay ? document.getElementById('accountDetailPanelOverlay') : document.getElementById('accountDetailPanel');
        openAccountPanel(id, panelEl);
      });
    });
  }

  container.innerHTML = buildHTML();
  attach();
}

// ── Accounts Table ──
function renderAccountsTable(suspicious) {
  const tbody = document.getElementById('accountsBody');
  tbody.innerHTML = '';
  if (!suspicious.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text3);text-align:center;padding:24px;">No suspicious accounts detected.</td></tr>';
    return;
  }
  for (const acc of suspicious) {
    const score = acc.suspicion_score;
    const color = score >= 75 ? 'var(--danger)' : score >= 50 ? 'var(--warn)' : 'var(--accent)';
    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="acc-id">${acc.account_id}</td>
      <td><div class="score-bar-wrap"><div class="score-bar"><div class="score-bar-fill" style="width:${score}%;background:${color}"></div></div><span class="score-val" style="color:${color}">${score}</span></div></td>
      <td>${acc.detected_patterns.map(p=>`<span class="pattern-tag">${p.replace(/_/g,' ')}</span>`).join('')}</td>
      <td>${acc.ring_id ? `<span class="ring-badge">${acc.ring_id}</span>` : `<span style="color:var(--text3);">—</span>`}</td>`;
    row.addEventListener('click', () => openAccountPanel(acc.account_id));
    tbody.appendChild(row);
  }
}

// ── Fraud Rings Panel ──
function renderRingsPanel(fraudRings) {
  const container = document.getElementById('ringsContainer');
  container.innerHTML = '';
  if (!fraudRings.length) { container.innerHTML = '<div style="color:var(--text3);font-family:var(--font-mono);font-size:12px;padding:16px;">No fraud rings detected.</div>'; return; }
  for (const ring of fraudRings) {
    const card = document.createElement('div');
    card.className = 'ring-card';
    card.innerHTML = `
      <div class="ring-card-header"><span class="ring-id">${ring.ring_id}</span><span class="ring-risk">${ring.risk_score}</span></div>
      <div class="ring-meta"><div class="ring-meta-item">Members: <span>${ring.member_accounts.length}</span></div><div class="ring-meta-item">Pattern: <span class="pattern-type-badge">${ring.pattern_type.replace(/_/g,' ')}</span></div><div class="ring-meta-item">Risk Score: <span>${ring.risk_score}</span></div></div>
      <div class="ring-members">${ring.member_accounts.map(acc=>`<span class="ring-member" data-account="${acc}" style="cursor:pointer">${acc}</span>`).join('')}</div>`;
    card.querySelectorAll('[data-account]').forEach(el => el.addEventListener('click', () => openAccountPanel(el.dataset.account)));
    container.appendChild(card);
  }
}

// ── JSON Export ──
document.getElementById('downloadBtn').addEventListener('click', () => {
  const { graph, detection, processingTime } = appState;
  const { suspicious, fraudRings } = detection;
  const output = {
    suspicious_accounts: suspicious.map(a => ({ account_id: a.account_id, suspicion_score: a.suspicion_score, detected_patterns: a.detected_patterns, ring_id: a.ring_id || null })),
    fraud_rings:         fraudRings.map(r => ({ ring_id: r.ring_id, member_accounts: r.member_accounts, pattern_type: r.pattern_type, risk_score: r.risk_score })),
    summary: { total_accounts_analyzed: graph.nodes.size, suspicious_accounts_flagged: suspicious.length, fraud_rings_detected: fraudRings.length, processing_time_seconds: parseFloat(processingTime) }
  };
  const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `forensic_report_${Date.now()}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
});

// ── Sample Data ──
function loadSampleData() {
  const blob = new Blob([generateSampleCSV()], { type: 'text/csv' });
  processFile(new File([blob], 'sample_transactions.csv', { type: 'text/csv' }));
}

function generateSampleCSV() {
  const rows = ['transaction_id,sender_id,receiver_id,amount,timestamp'];
  const now  = Date.now();
  const accs = Array.from({ length: 40 }, (_, i) => `ACC_${String(i+1).padStart(5,'0')}`);
  let tid    = 1;
  function addTxn(s, r, amount, offset = 0) {
    const ts = new Date(now - offset);
    const pad = n => String(n).padStart(2,'0');
    rows.push(`TXN_${String(tid++).padStart(6,'0')},${s},${r},${amount.toFixed(2)},${ts.getFullYear()}-${pad(ts.getMonth()+1)}-${pad(ts.getDate())}T${pad(ts.getHours())}:${pad(ts.getMinutes())}:${pad(ts.getSeconds())}`);
  }
  addTxn('ACC_00001','ACC_00002',5000,7200000); addTxn('ACC_00002','ACC_00003',4800,6900000); addTxn('ACC_00003','ACC_00001',4600,6600000);
  addTxn('ACC_00004','ACC_00005',10000,5000000); addTxn('ACC_00005','ACC_00006',9500,4800000); addTxn('ACC_00006','ACC_00007',9000,4600000); addTxn('ACC_00007','ACC_00004',8500,4400000);
  for (let i=11;i<=22;i++) addTxn(accs[i],'ACC_00010',1000+Math.random()*500,Math.random()*50000000);
  for (let i=24;i<=35;i++) addTxn('ACC_00023',accs[i],800+Math.random()*400,Math.random()*40000000);
  addTxn('ACC_00008','ACC_00036',20000,3000000); addTxn('ACC_00036','ACC_00037',19500,2900000);
  addTxn('ACC_00037','ACC_00038',19000,2800000); addTxn('ACC_00038','ACC_00039',18500,2700000); addTxn('ACC_00040','ACC_00037',500,2600000);
  const norm = accs.slice(0,15);
  for (let i=0;i<60;i++) { const s=norm[Math.floor(Math.random()*norm.length)],r=norm[Math.floor(Math.random()*norm.length)]; if(s!==r) addTxn(s,r,100+Math.random()*5000,Math.random()*90000000); }
  return rows.join('\n');
}

// ── Helpers ──
function setStatus(state, text) { document.querySelector('.status-dot').className='status-dot '+state; document.querySelector('.status-text').textContent=text; }
function showError(msg) { errorBox.textContent='⚠ '+msg; errorBox.style.display='block'; }
function hideError()    { errorBox.style.display='none'; }
function showProgress() { dropProgress.classList.add('active'); progressBar.style.width='0%'; }
function hideProgress() { dropProgress.classList.remove('active'); progressBar.style.width='0%'; }
function setProgress(p) { progressBar.style.width=p+'%'; }

// ── Fullscreen Overlay ──
let cyOverlay = null;

function openGraphOverlay() {
  const overlay = document.getElementById('graphOverlay');
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  const elements = appState.cy.elements().jsons();
  if (cyOverlay) { cyOverlay.destroy(); cyOverlay = null; }
  cyOverlay = cytoscape({
    container: document.getElementById('cyOverlay'),
    elements,
    style: appState.cy.style().json(),
    layout: { name: 'preset' },
    zoom: appState.cy.zoom(), pan: appState.cy.pan(),
    minZoom: 0.05, maxZoom: 8,
    userPanningEnabled: true, userZoomingEnabled: true, boxSelectionEnabled: false
  });
  cyOverlay.on('tap', 'node', evt => openAccountPanel(evt.target.id(), document.getElementById('accountDetailPanelOverlay')));
  cyOverlay.on('tap', evt => { if (evt.target === cyOverlay) closeAccountPanel(document.getElementById('accountDetailPanelOverlay')); });

  document.getElementById('ovLayoutCose').onclick = function () { setActiveOverlayLayout(this); showOverlayCyGraph(); cyOverlay.layout({ name:'cose', animate:true, nodeRepulsion:12000, nodeOverlap:20, idealEdgeLength:120, edgeElasticity:100, gravity:80, numIter:1000 }).run(); };
  document.getElementById('ovLayoutCircle').onclick = function () { setActiveOverlayLayout(this); showOverlayCyGraph(); cyOverlay.layout({ name:'circle', animate:true }).run(); };
  document.getElementById('ovLayoutGrid').onclick   = function () { setActiveOverlayLayout(this); showOverlayCyGraph(); cyOverlay.layout({ name:'grid',   animate:true }).run(); };
  document.getElementById('ovLayoutAdjList').onclick = function () {
    setActiveOverlayLayout(this);
    document.getElementById('cyOverlay').style.display = 'none';
    const ov = document.getElementById('adjListViewOverlay');
    ov.style.display = 'block';
    renderAdjacencyList(ov, appState.graph, appState.detection.suspicious, appState.detection.fraudRings);
  };

  setTimeout(() => cyOverlay.fit(undefined, 40), 80);
  applyFiltersToInstance(cyOverlay);

  document.querySelectorAll('[data-overlay-filter]').forEach(btn => {
    btn.style.cursor = 'pointer'; btn.style.userSelect = 'none';
    btn.style.transition = 'opacity 0.18s, box-shadow 0.18s, border-color 0.18s';
    btn.onclick = () => handleFilterToggle(btn.dataset.filter);
  });
  syncAllButtonStyles();
}

function closeGraphOverlay() {
  document.getElementById('graphOverlay').style.display = 'none';
  document.body.style.overflow = '';
  closeAccountPanel(document.getElementById('accountDetailPanelOverlay'));
  const adjOv = document.getElementById('adjListViewOverlay');
  if (adjOv) { adjOv.style.display = 'none'; adjOv.innerHTML = ''; }
  if (cyOverlay) { cyOverlay.destroy(); cyOverlay = null; }
}

function setActiveOverlayLayout(btn) {
  document.querySelectorAll('.overlay-controls .ctrl-btn:not(.expand-btn)').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}
function showOverlayCyGraph() {
  document.getElementById('cyOverlay').style.display = '';
  document.getElementById('adjListViewOverlay').style.display = 'none';
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('collapseGraph').addEventListener('click', closeGraphOverlay);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeAccountPanel(document.getElementById('accountDetailPanel'));
      closeAccountPanel(document.getElementById('accountDetailPanelOverlay'));
      closeGraphOverlay();
    }
  });
});

function initExpandButton() {
  const btn = document.getElementById('expandGraph');
  if (btn) btn.onclick = () => { if (appState.cy) openGraphOverlay(); };
}

// ── Parser ──
const Parser = (() => {
  const REQUIRED = ['transaction_id','sender_id','receiver_id','amount','timestamp'];
  function validateHeaders(h) {
    const norm = h.map(x => x.trim().toLowerCase());
    const miss = REQUIRED.filter(c => !norm.includes(c));
    if (miss.length) throw new Error(`Missing required columns: ${miss.join(', ')}`);
    return norm;
  }
  function parseRow(row, headers) {
    const idx = c => headers.indexOf(c);
    const tid = String(row[idx('transaction_id')]||'').trim();
    const sid = String(row[idx('sender_id')]     ||'').trim();
    const rid = String(row[idx('receiver_id')]   ||'').trim();
    if (!tid||!sid||!rid) return null;
    
    // Fix: Strip currency symbols and commas before parsing
    const rawAmt = String(row[idx('amount')]||'').replace(/[^0-9.-]/g, '');
    const amount = parseFloat(rawAmt);
    
    // Fix: Handle "YYYY-MM-DD HH:MM:SS" strictly across all browsers
    let dateStr = String(row[idx('timestamp')]||'').trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateStr)) {
        dateStr = dateStr.replace(' ', 'T'); 
    }
    const timestamp = new Date(dateStr).getTime();
    
    if (isNaN(amount)||amount<0||isNaN(timestamp)) return null;
    return { transaction_id:tid, sender_id:sid, receiver_id:rid, amount, timestamp };
  }
  function parseCSV(csvText) {
    const res = Papa.parse(csvText, { skipEmptyLines:true, dynamicTyping:false });
    if (!res.data||res.data.length<2) throw new Error('CSV file is empty or has no data rows.');
    const headers = validateHeaders(res.data[0]);
    const transactions=[]; let skipped=0;
    for (let i=1;i<res.data.length;i++) {
      const row=res.data[i];
      if (row.every(c=>!String(c).trim())) continue;
      const txn=parseRow(row,headers);
      txn?transactions.push(txn):skipped++;
    }
    if (!transactions.length) throw new Error('No valid transactions found in the CSV file.');
    return { transactions, skipped };
  }
  return { parseCSV };
})();

// ── Graph Builder ──
const GraphBuilder = (() => {
  function build(transactions) {
    const nodes=new Map(),edges=[],adjOut=new Map(),adjIn=new Map(),txnByAccount=new Map();
    function ensure(id) {
      if (!nodes.has(id)) { nodes.set(id,{id,outEdges:[],inEdges:[],transactions:[],totalSent:0,totalReceived:0,txnCount:0}); adjOut.set(id,new Set()); adjIn.set(id,new Set()); txnByAccount.set(id,[]); }
    }
    for (const txn of transactions) {
      const {transaction_id,sender_id,receiver_id,amount,timestamp}=txn;
      ensure(sender_id); ensure(receiver_id);
      const edge={source:sender_id,target:receiver_id,amount,timestamp,transaction_id};
      edges.push(edge);
      adjOut.get(sender_id).add(receiver_id); adjIn.get(receiver_id).add(sender_id);
      const sn=nodes.get(sender_id);   sn.outEdges.push(edge); sn.totalSent+=amount;     sn.txnCount++; sn.transactions.push(txn); txnByAccount.get(sender_id).push(txn);
      const rn=nodes.get(receiver_id); rn.inEdges.push(edge);  rn.totalReceived+=amount; rn.txnCount++; rn.transactions.push(txn); txnByAccount.get(receiver_id).push(txn);
    }
    return {nodes,edges,adjOut,adjIn,txnByAccount};
  }
  return {build};
})();

// ── Detection Engine ──
const DetectionEngine = (() => {
  const MS_72H=72*60*60*1000,FAN_THRESHOLD=10,SHELL_CHAIN_LEN=3,SHELL_MAX_TXN=3,VELOCITY_THRESHOLD=5;
  const SCORE_CYCLE=50,SCORE_FAN=30,SCORE_SHELL=20,SCORE_VELOCITY=10;

  function detectCycles(nodes, adjOut) {
    const cycles = [], accountPatterns = new Map();
    const uniqueCycles = new Set();
    const MAX_DEPTH = 5;

    for (const startNode of nodes.keys()) {
      function dfs(curr, path, visitedSet) {
        if (path.length > MAX_DEPTH) return;
        for (const nb of (adjOut.get(curr) || new Set())) {
          if (nb === startNode && path.length >= 3) {
            const cycleStr = [...path].sort().join('|');
            if (!uniqueCycles.has(cycleStr)) {
              uniqueCycles.add(cycleStr);
              cycles.push([...path]);
              path.forEach(acc => {
                if (!accountPatterns.has(acc)) accountPatterns.set(acc, new Set());
                accountPatterns.get(acc).add(`cycle_length_${path.length}`);
              });
            }
          } else if (!visitedSet.has(nb)) {
            visitedSet.add(nb);
            path.push(nb);
            dfs(nb, path, visitedSet);
            path.pop();
            visitedSet.delete(nb);
          }
        }
      }
      dfs(startNode, [startNode], new Set([startNode]));
    }
    return { cycleAccounts: new Set(accountPatterns.keys()), cycles, accountPatterns };
  }

  function detectFanPatterns(nodes) {
    const fanAccounts=new Map();
    for (const [accId,node] of nodes) {
      const inTxns=node.inEdges.slice().sort((a,b)=>a.timestamp-b.timestamp);
      for (let i=0;i<inTxns.length;i++) {
        const wEnd=inTxns[i].timestamp+MS_72H; const snd=new Set();
        for (let j=i;j<inTxns.length&&inTxns[j].timestamp<=wEnd;j++) snd.add(inTxns[j].source);
        if (snd.size>=FAN_THRESHOLD) { if(!fanAccounts.has(accId)) fanAccounts.set(accId,new Set()); fanAccounts.get(accId).add('fan_in'); break; }
      }
      const outTxns=node.outEdges.slice().sort((a,b)=>a.timestamp-b.timestamp);
      for (let i=0;i<outTxns.length;i++) {
        const wEnd=outTxns[i].timestamp+MS_72H; const rcv=new Set();
        for (let j=i;j<outTxns.length&&outTxns[j].timestamp<=wEnd;j++) rcv.add(outTxns[j].target);
        if (rcv.size>=FAN_THRESHOLD) { if(!fanAccounts.has(accId)) fanAccounts.set(accId,new Set()); fanAccounts.get(accId).add('fan_out'); break; }
      }
    }
    return {fanAccounts};
  }

  function detectShellNetworks(nodes,adjOut) {
    const shellAccounts=new Set();
    function findChain(start,depth,vis) {
      for (const next of (adjOut.get(start)||new Set())) {
        if (vis.has(next)) continue;
        const nn=nodes.get(next); if(!nn) continue;
        vis.add(next);
        if (depth>=SHELL_CHAIN_LEN&&nn.txnCount<=SHELL_MAX_TXN) for (const a of vis) shellAccounts.add(a);
        else if (nn.txnCount<=SHELL_MAX_TXN||depth<SHELL_CHAIN_LEN) findChain(next,depth+1,vis);
        vis.delete(next);
      }
    }
    for (const [id,node] of nodes) {
        if (node.txnCount <= SHELL_MAX_TXN) findChain(id,1,new Set([id]));
    }
    return {shellAccounts};
  }

  function detectHighVelocity(nodes) {
    const velocityAccounts=new Set();
    for (const [accId,node] of nodes) {
      const txns=[...node.transactions].sort((a,b)=>a.timestamp-b.timestamp);
      if (txns.length<VELOCITY_THRESHOLD) continue;
      for (let i=0;i<txns.length;i++) {
        let cnt=0; const wEnd=txns[i].timestamp+3600000;
        for (let j=i;j<txns.length&&txns[j].timestamp<=wEnd;j++) cnt++;
        if (cnt>=VELOCITY_THRESHOLD) { velocityAccounts.add(accId); break; }
      }
    }
    return {velocityAccounts};
  }

  function scoreAccounts(nodes,cycleResult,fanResult,shellResult,velocityResult) {
    const rawScores=new Map(),patternsMap=new Map();
    function addScore(acc,pts,pat) { rawScores.set(acc,(rawScores.get(acc)||0)+pts); if(!patternsMap.has(acc)) patternsMap.set(acc,new Set()); patternsMap.get(acc).add(pat); }
    for (const [acc,pats] of cycleResult.accountPatterns) for (const p of pats) addScore(acc,SCORE_CYCLE,p);
    for (const [acc,pats] of fanResult.fanAccounts)       for (const p of pats) addScore(acc,SCORE_FAN,p);
    for (const acc of shellResult.shellAccounts)       addScore(acc,SCORE_SHELL,'shell_network');
    for (const acc of velocityResult.velocityAccounts) addScore(acc,SCORE_VELOCITY,'high_velocity');
    const maxRaw=Math.max(...rawScores.values(),1);
    const suspicious=[];
    for (const [acc,raw] of rawScores)
      suspicious.push({ account_id:acc, suspicion_score:Math.min(100,Math.round((raw/maxRaw)*1000)/10), detected_patterns:[...patternsMap.get(acc)], raw_score:raw });
    suspicious.sort((a,b)=>b.suspicion_score-a.suspicion_score);
    return suspicious;
  }

  function groupFraudRings(suspicious,cycleResult,adjOut,adjIn) {
    const suspSet=new Set(suspicious.map(s=>s.account_id));
    const parent=new Map();
    function find(x){ if(!parent.has(x)) parent.set(x,x); if(parent.get(x)!==x) parent.set(x,find(parent.get(x))); return parent.get(x); }
    function union(x,y){ const px=find(x),py=find(y); if(px!==py) parent.set(px,py); }
    for (const acc of suspSet) find(acc);
    for (const cycle of cycleResult.cycles) for (let i=1;i<cycle.length;i++) if(suspSet.has(cycle[0])&&suspSet.has(cycle[i])) union(cycle[0],cycle[i]);
    for (const acc of suspSet) {
      for (const nb of (adjOut.get(acc)||new Set())) if(suspSet.has(nb)) union(acc,nb);
      for (const nb of (adjIn.get(acc) ||new Set())) if(suspSet.has(nb)) union(acc,nb);
    }
    const groups=new Map();
    for (const acc of suspSet){ const r=find(acc); if(!groups.has(r)) groups.set(r,[]); groups.get(r).push(acc); }
    const rings=[]; let rn=1;
    for (const [,members] of groups) {
      if (members.length<2) continue;
      const ringId=`RING_${String(rn).padStart(3,'0')}`;
      const pc={};
      for (const acc of members){ const s=suspicious.find(s=>s.account_id===acc); if(s) for(const p of s.detected_patterns) pc[p]=(pc[p]||0)+1; }
      const dom=Object.keys(pc).sort((a,b)=>pc[b]-pc[a])[0]||'unknown';
      const avg=members.reduce((sum,acc)=>{ const s=suspicious.find(s=>s.account_id===acc); return sum+(s?s.suspicion_score:0); },0)/members.length;
      const risk=Math.min(100,Math.round((avg+Math.min(15,members.length*1.5))*10)/10);
      rings.push({ring_id:ringId,member_accounts:members,pattern_type:dom,risk_score:risk});
      for (const acc of members){ const s=suspicious.find(s=>s.account_id===acc); if(s) s.ring_id=ringId; }
      rn++;
    }
    return rings;
  }

  function run(graph) {
    const {nodes,adjOut,adjIn,txnByAccount}=graph;
    const cycleResult    = detectCycles(nodes,adjOut);
    const fanResult      = detectFanPatterns(nodes,txnByAccount);
    const shellResult    = detectShellNetworks(nodes,adjOut);
    const velocityResult = detectHighVelocity(nodes);
    const suspicious     = scoreAccounts(nodes,cycleResult,fanResult,shellResult,velocityResult);
    const fraudRings     = groupFraudRings(suspicious,cycleResult,adjOut,adjIn);
    return {suspicious,fraudRings,cycleResult,fanResult,shellResult,velocityResult};
  }

  return {run};
})();

// ════════════════════════════════════════════
// DATE SEARCH BAR
// ════════════════════════════════════════════

const dateSearchState = { active: false, fromMs: null, toMs: null };

// Convert a timestamp to YYYY-MM-DD string (local time)
function toDateInputVal(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

// Convert YYYY-MM-DD string to start/end of that day in ms
function dateInputToMs(val, endOfDay = false) {
  if (!val) return null;
  const [y, m, d] = val.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (endOfDay) dt.setHours(23, 59, 59, 999);
  return dt.getTime();
}

/**
 * Parse a free-form date string entered by the user.
 * Supports:
 * YYYY-MM-DD  → exact day
 * YYYY-MM     → full month
 * YYYY        → full year
 * "Jan 2025" / "January 2025" / "2025 Jan" → full month
 * Returns { fromMs, toMs } or null on failure.
 */
function parseManualDate(raw) {
  const s = raw.trim();
  if (!s) return null;

  const MONTHS = ['january','february','march','april','may','june',
                  'july','august','september','october','november','december'];
  const SHORT  = ['jan','feb','mar','apr','may','jun',
                  'jul','aug','sep','oct','nov','dec'];

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y,m,d] = s.split('-').map(Number);
    if (m<1||m>12||d<1||d>31) return null;
    const from = new Date(y, m-1, d);
    const to   = new Date(y, m-1, d, 23, 59, 59, 999);
    return { fromMs: from.getTime(), toMs: to.getTime(), label: s };
  }

  // YYYY-MM
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [y,m] = s.split('-').map(Number);
    if (m<1||m>12) return null;
    const from = new Date(y, m-1, 1);
    const to   = new Date(y, m, 0, 23, 59, 59, 999); // last day of month
    return { fromMs: from.getTime(), toMs: to.getTime(), label: `${y}-${String(m).padStart(2,'0')}` };
  }

  // YYYY
  if (/^\d{4}$/.test(s)) {
    const y = parseInt(s);
    const from = new Date(y, 0, 1);
    const to   = new Date(y, 11, 31, 23, 59, 59, 999);
    return { fromMs: from.getTime(), toMs: to.getTime(), label: `${y}` };
  }

  // "Jan 2025" or "January 2025" or "2025 Jan"
  const parts = s.toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (parts.length === 2) {
    let monthIdx = -1, year = -1;
    for (const p of parts) {
      const mi = SHORT.indexOf(p.slice(0,3));
      const fi = MONTHS.indexOf(p);
      if (mi !== -1) monthIdx = mi;
      else if (fi !== -1) monthIdx = fi;
      else if (/^\d{4}$/.test(p)) year = parseInt(p);
    }
    if (monthIdx !== -1 && year !== -1) {
      const from = new Date(year, monthIdx, 1);
      const to   = new Date(year, monthIdx + 1, 0, 23, 59, 59, 999);
      const mName = SHORT[monthIdx].charAt(0).toUpperCase() + SHORT[monthIdx].slice(1);
      return { fromMs: from.getTime(), toMs: to.getTime(), label: `${mName} ${year}` };
    }
  }

  return null; // couldn't parse
}

function initDateSearchBar(allTransactions) {
  const bar = document.getElementById('dateSearchBar');
  bar.style.display = 'block';

  // Compute true min/max from the dataset (not today's date)
  const timestamps = allTransactions.map(t => t.timestamp);
  const dataMinTs  = Math.min(...timestamps);
  const dataMaxTs  = Math.max(...timestamps);
  const dataMinVal = toDateInputVal(dataMinTs);
  const dataMaxVal = toDateInputVal(dataMaxTs);

  // Show dataset range info
  const rangeEl = document.getElementById('dsbDatasetRange');
  if (rangeEl) rangeEl.innerHTML = `Dataset: <span>${dataMinVal}</span> → <span>${dataMaxVal}</span>`;

  const fromEl    = document.getElementById('dateFrom');
  const toEl      = document.getElementById('dateTo');
  const applyEl   = document.getElementById('applyDateFilter');
  const clearEl   = document.getElementById('clearDateFilter');
  const badge     = document.getElementById('dateResultBadge');
  const bottomRow = document.getElementById('dsbBottomRow');
  const manualEl  = document.getElementById('dateManualInput');
  const manualGo  = document.getElementById('dateManualGo');
  const manualErr = document.getElementById('dateManualError');

  // Seed date pickers to full dataset range
  fromEl.min = dataMinVal; fromEl.max = dataMaxVal;
  toEl.min   = dataMinVal; toEl.max   = dataMaxVal;
  fromEl.value = dataMinVal;
  toEl.value   = dataMaxVal;

  // Reset state
  dateSearchState.active = false;
  dateSearchState.fromMs = null;
  dateSearchState.toMs   = null;
  bottomRow.style.display = 'none';
  document.querySelectorAll('.dsb-quick').forEach(b => b.classList.remove('active'));

  // ── Quick range buttons ──
  // KEY FIX: anchor to dataMaxTs (latest date in dataset), not new Date()
  document.querySelectorAll('.dsb-quick').forEach(btn => {
    const fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);
    fresh.addEventListener('click', () => {
      document.querySelectorAll('.dsb-quick').forEach(b => b.classList.remove('active'));
      fresh.classList.add('active');
      manualEl.value = '';
      hideManualError();

      const range = fresh.dataset.range;
      // Anchor all relative ranges to the LAST date in the dataset
      const anchorTs  = dataMaxTs;
      const anchorDate = new Date(anchorTs);

      let fromTs, toTs;

      if (range === 'all') {
        fromTs = dataMinTs; toTs = dataMaxTs;
      } else if (range === 'latest-day') {
        // The single day that has the most recent transactions
        fromTs = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate()).getTime();
        toTs   = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate(), 23,59,59,999).getTime();
      } else if (range === '7d') {
        const f = new Date(anchorDate); f.setDate(f.getDate() - 6); f.setHours(0,0,0,0);
        fromTs = f.getTime(); toTs = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate(), 23,59,59,999).getTime();
      } else if (range === '30d') {
        const f = new Date(anchorDate); f.setDate(f.getDate() - 29); f.setHours(0,0,0,0);
        fromTs = f.getTime(); toTs = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate(), 23,59,59,999).getTime();
      }

      // Clamp to dataset bounds so we don't go before the earliest record
      fromTs = Math.max(fromTs, dataMinTs);
      toTs   = Math.min(toTs,   dataMaxTs);

      // Sync pickers to the computed range
      fromEl.value = toDateInputVal(fromTs);
      toEl.value   = toDateInputVal(toTs);

      if (range === 'all') {
        clearFilter(allTransactions, dataMinTs, dataMaxTs, dataMinVal, dataMaxVal);
      } else {
        runFilter(allTransactions, fromTs, toTs);
      }
    });
  });

  // ── Date picker apply ──
  const freshApply = applyEl.cloneNode(true);
  applyEl.parentNode.replaceChild(freshApply, applyEl);
  freshApply.addEventListener('click', () => {
    manualEl.value = '';
    hideManualError();
    document.querySelectorAll('.dsb-quick').forEach(b => b.classList.remove('active'));
    const fromMs = fromEl.value ? dateInputToMs(fromEl.value, false) : dataMinTs;
    const toMs   = toEl.value   ? dateInputToMs(toEl.value,   true)  : dataMaxTs;
    if (fromMs > toMs) {
      fromEl.style.borderColor = 'var(--danger)';
      toEl.style.borderColor   = 'var(--danger)';
      setTimeout(() => { fromEl.style.borderColor=''; toEl.style.borderColor=''; }, 1400);
      return;
    }
    runFilter(allTransactions, fromMs, toMs);
  });

  // ── Clear ──
  const freshClear = clearEl.cloneNode(true);
  clearEl.parentNode.replaceChild(freshClear, clearEl);
  freshClear.addEventListener('click', () => {
    manualEl.value = '';
    hideManualError();
    document.querySelectorAll('.dsb-quick').forEach(b => b.classList.remove('active'));
    clearFilter(allTransactions, dataMinTs, dataMaxTs, dataMinVal, dataMaxVal);
  });

  // ── Manual text search ──
  function runManual() {
    const raw = manualEl.value.trim();
    if (!raw) { hideManualError(); return; }
    const parsed = parseManualDate(raw);
    if (!parsed) {
      showManualError(`Could not parse "${raw}". Try: 2025-01-15, Jan 2025, 2025`);
      manualEl.classList.add('error');
      return;
    }
    hideManualError();
    manualEl.classList.remove('error');
    document.querySelectorAll('.dsb-quick').forEach(b => b.classList.remove('active'));
    // Clamp to dataset bounds
    const fromMs = Math.max(parsed.fromMs, dataMinTs);
    const toMs   = Math.min(parsed.toMs,   dataMaxTs);
    // Sync pickers
    fromEl.value = toDateInputVal(fromMs);
    toEl.value   = toDateInputVal(toMs);
    runFilter(allTransactions, fromMs, toMs, parsed.label);
  }

  const freshGo = manualGo.cloneNode(true);
  manualGo.parentNode.replaceChild(freshGo, manualGo);
  freshGo.addEventListener('click', runManual);
  manualEl.addEventListener('keydown', e => { if (e.key === 'Enter') runManual(); });
  // Live clear error on edit
  manualEl.addEventListener('input', () => { manualEl.classList.remove('error'); hideManualError(); });

  // ── Enter on date pickers ──
  [fromEl, toEl].forEach(el => {
    el.addEventListener('keydown', e => { if (e.key === 'Enter') freshApply.click(); });
  });

  function showManualError(msg) {
    manualErr.textContent = '⚠ ' + msg;
    manualErr.style.display = 'block';
  }
  function hideManualError() {
    manualErr.style.display = 'none';
    manualErr.textContent = '';
  }
}

// ── Core filter runner ──
function runFilter(allTransactions, fromMs, toMs, label) {
  const filtered = allTransactions.filter(t => t.timestamp >= fromMs && t.timestamp <= toMs);
  dateSearchState.active = true;
  dateSearchState.fromMs = fromMs;
  dateSearchState.toMs   = toMs;

  // Re-run full detection on filtered set
  const t0              = performance.now();
  const filteredGraph   = GraphBuilder.build(filtered);
  const filteredDet     = DetectionEngine.run(filteredGraph);
  const elapsed         = ((performance.now() - t0) / 1000).toFixed(2);
  const { suspicious, fraudRings } = filteredDet;

  // Update stats
  document.getElementById('statAccounts').textContent   = filteredGraph.nodes.size.toLocaleString();
  document.getElementById('statTxns').textContent       = filtered.length.toLocaleString();
  document.getElementById('statSuspicious').textContent = suspicious.length;
  document.getElementById('statRings').textContent      = fraudRings.length;
  document.getElementById('statTime').textContent       = `${elapsed}s`;

  // Re-render panels
  renderGraph(filteredGraph, suspicious, fraudRings);
  renderAccountsTable(suspicious);
  renderRingsPanel(fraudRings);
  renderSummarySection(filtered, filteredGraph, filteredDet);

  // Show result badge
  const fromLabel = label || toDateInputVal(fromMs);
  const toLabel   = toDateInputVal(toMs);
  const rangeStr  = fromLabel === toLabel ? fromLabel : `${fromLabel} → ${toLabel}`;
  const susClass  = suspicious.length >= 5 ? 'danger' : suspicious.length > 0 ? 'warn' : '';
  document.getElementById('dateResultBadge').innerHTML = `
    <span class="dsb-active-range">⊞ ${rangeStr}</span>
    <div class="dsb-badge-chip"><span class="dsb-badge-num accent">${filtered.length.toLocaleString()}</span><span class="dsb-badge-lbl">transactions</span></div>
    <div class="dsb-badge-chip ${suspicious.length>=5?'danger-chip':suspicious.length>0?'warn-chip':''}"><span class="dsb-badge-num ${susClass}">${suspicious.length}</span><span class="dsb-badge-lbl">suspicious</span></div>
    <div class="dsb-badge-chip ring-chip"><span class="dsb-badge-num ring">${fraudRings.length}</span><span class="dsb-badge-lbl">rings</span></div>
    ${filtered.length === 0 ? '<span style="color:var(--warn);font-size:10px;margin-left:6px;">⚠ No transactions in this range</span>' : ''}
  `;
  document.getElementById('dsbBottomRow').style.display = 'flex';
}

// ── Clear filter ──
function clearFilter(allTransactions, dataMinTs, dataMaxTs, dataMinVal, dataMaxVal) {
  dateSearchState.active = false;
  dateSearchState.fromMs = null;
  dateSearchState.toMs   = null;

  document.getElementById('dateFrom').value = dataMinVal;
  document.getElementById('dateTo').value   = dataMaxVal;
  document.getElementById('dsbBottomRow').style.display = 'none';

  // Re-run on full data
  const graph   = GraphBuilder.build(allTransactions);
  const det     = DetectionEngine.run(graph);
  const { suspicious, fraudRings } = det;

  document.getElementById('statAccounts').textContent   = graph.nodes.size.toLocaleString();
  document.getElementById('statTxns').textContent       = allTransactions.length.toLocaleString();
  document.getElementById('statSuspicious').textContent = suspicious.length;
  document.getElementById('statRings').textContent      = fraudRings.length;
  document.getElementById('statTime').textContent       = `${appState.processingTime}s`;

  renderGraph(graph, suspicious, fraudRings);
  renderAccountsTable(suspicious);
  renderRingsPanel(fraudRings);
  renderSummarySection(allTransactions, graph, det);
}