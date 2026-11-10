const $ = (selector) => document.querySelector(selector);

const state = {
  report: null,
  history: { snapshots: [] },
  health: null,
  periodKey: 'MONTH',
  storeKey: 'equestrian',
  monthKey: '',
  visibleRows: []
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function number(value, maximumFractionDigits = 0) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(Number(value) || 0);
}

function currency(value, code = 'USD') {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code || 'USD',
      maximumFractionDigits: Math.abs(amount) < 1000 ? 2 : 0
    }).format(amount);
  } catch {
    return `${code || 'USD'} ${number(amount, 2)}`;
  }
}

function percentage(value, digits = 1) {
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : `${number(value, digits)}%`;
}

function getCurrentPeriod() {
  return state.report?.periods?.[state.periodKey] || (state.periodKey === 'MONTH' ? state.report?.periods?.YTD2026 : null) || null;
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove('show'), 3400);
}

function renderKpis(periodReport) {
  const summary = periodReport.summary;
  const margin = periodReport.grossMargin?.withDropshipping;
  const currencyCode = summary.currency || 'USD';
  $('#period-title').textContent = periodReport.period?.label || 'Selected period';
  $('#kpi-unique').textContent = number(summary.totalUniqueSkus);
  $('#kpi-top80').textContent = number(summary.top80SkuCount);
  $('#kpi-sales').textContent = currency(summary.netSales, currencyCode);
  $('#kpi-margin').textContent = percentage(margin?.grossMargin);
  $('#kpi-unique-change').textContent = `${number(summary.totalUnitsSold)} units sold`;
  $('#kpi-top80-share').textContent = `${number(summary.remainingSkuCount)} remaining`;
  $('#kpi-margin-coverage').textContent = `Cost coverage ${percentage(margin?.costCoveragePct, 0)}`;
  $('#pareto-count').textContent = number(summary.top80SkuCount);
  $('#pareto-rest').textContent = number(summary.remainingSkuCount);
  $('#donut-total').textContent = number(summary.totalUniqueSkus);
  $('#donut-top-count').textContent = number(summary.top80SkuCount);
  $('#donut-rest-count').textContent = number(summary.remainingSkuCount);
  const concentration = summary.totalUniqueSkus > 0 ? summary.top80SkuCount / summary.totalUniqueSkus * 100 : 0;
  $('#concentration-insight').textContent = `${number(concentration, 1)}% of SKUs generate 80% of sales`;
  const topRatio = summary.totalUniqueSkus > 0 ? summary.top80SkuCount / summary.totalUniqueSkus * 100 : 0;
  $('#donut-chart').style.background = `conic-gradient(var(--black) 0 ${topRatio}%, var(--surface-muted) ${topRatio}% 100%)`;
}

function renderPeriodComparison() {
  const fy = state.report?.periods?.FY2025?.summary;
  const ytd = state.report?.periods?.YTD2026?.summary;
  if (!fy || !ytd) return;
  const fyShare = fy.totalUniqueSkus > 0 ? fy.top80SkuCount / fy.totalUniqueSkus * 100 : 0;
  const ytdShare = ytd.totalUniqueSkus > 0 ? ytd.top80SkuCount / ytd.totalUniqueSkus * 100 : 0;
  const deltaLabel = (before, after, suffix = '') => {
    const delta = Number(after || 0) - Number(before || 0);
    return `${delta > 0 ? '+' : ''}${number(delta, 1)}${suffix}`;
  };
  $('#compare-unique-fy').textContent = number(fy.totalUniqueSkus);
  $('#compare-unique-ytd').textContent = number(ytd.totalUniqueSkus);
  $('#compare-unique-delta').textContent = `${deltaLabel(fy.totalUniqueSkus, ytd.totalUniqueSkus)} SKUs vs. FY 2025`;
  $('#compare-top-fy').textContent = number(fy.top80SkuCount);
  $('#compare-top-ytd').textContent = number(ytd.top80SkuCount);
  $('#compare-top-delta').textContent = `${deltaLabel(fy.top80SkuCount, ytd.top80SkuCount)} SKUs in the 80% group`;
  $('#compare-share-fy').textContent = percentage(fyShare, 1);
  $('#compare-share-ytd').textContent = percentage(ytdShare, 1);
  $('#compare-share-delta').textContent = `${deltaLabel(fyShare, ytdShare, ' pp')} of total SKU base`;
  if (ytdShare < fyShare) {
    $('#compare-insight-title').textContent = 'Sales concentration is increasing';
    $('#compare-insight-copy').textContent = `A smaller share of the SKU catalog now generates 80% of sales (${number(ytdShare, 1)}% vs. ${number(fyShare, 1)}% in FY 2025).`;
  } else if (ytdShare > fyShare) {
    $('#compare-insight-title').textContent = 'Sales concentration is decreasing';
    $('#compare-insight-copy').textContent = `A larger share of the SKU catalog is now required to generate 80% of sales (${number(ytdShare, 1)}% vs. ${number(fyShare, 1)}% in FY 2025).`;
  } else {
    $('#compare-insight-title').textContent = 'Sales concentration is unchanged';
    $('#compare-insight-copy').textContent = 'The share of the SKU catalog required to generate 80% of sales is the same in both periods.';
  }
}

function renderPareto(periodReport) {
  const svg = $('#pareto-chart');
  const rows = (periodReport.skuRows || []).filter((row) => row.rank && row.netSales > 0).slice(0, 12);
  const width = 900;
  const height = 280;
  const margin = { top: 18, right: 48, bottom: 42, left: 48 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  if (!rows.length) {
    svg.innerHTML = `<text x="450" y="135" text-anchor="middle" fill="currentColor" opacity=".55" font-size="13">No SKU sales data available for this period.</text>`;
    return;
  }
  const maxSales = Math.max(...rows.map((row) => row.netSales), 1);
  const slot = plotWidth / rows.length;
  const barWidth = Math.min(38, slot * .58);
  const grid = [0, .25, .5, .75, 1].map((ratio) => {
    const y = margin.top + plotHeight * (1 - ratio);
    return `<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" class="chart-grid-line"/><text x="${margin.left - 10}" y="${y + 3}" text-anchor="end" class="chart-axis-label">${Math.round(ratio * maxSales / 1000)}k</text>`;
  }).join('');
  const bars = rows.map((row, index) => {
    const x = margin.left + index * slot + (slot - barWidth) / 2;
    const barHeight = row.netSales / maxSales * plotHeight;
    const y = margin.top + plotHeight - barHeight;
    return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4" class="pareto-bar"><title>${escapeHtml(row.sku)} · ${currency(row.netSales, periodReport.summary.currency)}</title></rect><text x="${x + barWidth / 2}" y="${height - 18}" text-anchor="middle" class="chart-axis-label">${index + 1}</text>`;
  }).join('');
  const points = rows.map((row, index) => {
    const x = margin.left + index * slot + slot / 2;
    const y = margin.top + plotHeight * (1 - Math.min(100, row.cumulativeShare) / 100);
    return `${x},${y}`;
  }).join(' ');
  const dots = rows.map((row, index) => {
    const x = margin.left + index * slot + slot / 2;
    const y = margin.top + plotHeight * (1 - Math.min(100, row.cumulativeShare) / 100);
    return `<circle cx="${x}" cy="${y}" r="3.3" class="pareto-point"><title>${number(row.cumulativeShare, 1)}% cumulative</title></circle>`;
  }).join('');
  svg.innerHTML = `${grid}<line x1="${margin.left}" y1="${margin.top + plotHeight * .2}" x2="${width - margin.right}" y2="${margin.top + plotHeight * .2}" class="pareto-threshold"/><text x="${width - margin.right + 7}" y="${margin.top + plotHeight * .2 + 3}" class="chart-axis-label">80%</text>${bars}<polyline points="${points}" class="pareto-line"/>${dots}<text x="${margin.left}" y="${height - 3}" class="chart-axis-label">SKU RANK</text>`;
}

function actionClass(action) {
  if (action === 'CORE STOCK') return 'core';
  if (action === 'DROPSHIP') return 'drop';
  return 'low';
}

function renderTable(periodReport) {
  const search = ($('#sku-search').value || '').trim().toLowerCase();
  const action = $('#action-filter').value;
  const rows = (periodReport.skuRows || []).filter((row) => {
    const matchesSearch = !search || `${row.sku} ${row.productTitle} ${row.category} ${row.vendor}`.toLowerCase().includes(search);
    const matchesAction = action === 'ALL' || row.action === action;
    return matchesSearch && matchesAction;
  });
  state.visibleRows = rows;
  $('#table-count').textContent = `${number(rows.length)} rows`;
  $('#table-pagination').textContent = `Showing ${number(rows.length)} of ${number(periodReport.skuRows?.length || 0)} SKU records`;
  const body = $('#sku-table-body');
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="9" class="empty-cell">No products match the current filters.</td></tr>';
    return;
  }
  body.innerHTML = rows.slice(0, 100).map((row) => `
    <tr>
      <td class="rank-cell numeric">${row.rank ? `#${number(row.rank)}` : '—'}</td>
      <td><div class="product-cell"><strong>${escapeHtml(row.productTitle)}</strong><small>${escapeHtml(row.sku)} · ${escapeHtml(row.category || 'Uncategorized')}</small></div></td>
      <td class="numeric">${number(row.unitsSold)}</td>
      <td class="numeric">${currency(row.netSales, periodReport.summary.currency)}</td>
      <td class="share-cell numeric">${percentage(row.salesShare, 2)}<div class="mini-bar"><span style="width:${Math.max(0, Math.min(100, Number(row.salesShare) || 0))}%"></span></div></td>
      <td class="numeric">${percentage(row.cumulativeShare, 1)}</td>
      <td class="numeric">${percentage(row.grossMargin, 1)}</td>
      <td class="numeric">${number(row.inventoryAvailable)}</td>
      <td><span class="action-pill ${actionClass(row.action)}">${escapeHtml(row.action || 'REVIEW')}</span></td>
    </tr>`).join('');
}

function renderMargin(periodReport) {
  const margin = periodReport.grossMargin || {};
  const withDrop = margin.withDropshipping || {};
  const withoutDrop = margin.withoutDropshipping || {};
  const currencyCode = periodReport.summary.currency || 'USD';
  $('#margin-with').textContent = percentage(withDrop.grossMargin);
  $('#margin-without').textContent = percentage(withoutDrop.grossMargin);
  $('#profit-with').textContent = currency(withDrop.grossProfit, currencyCode);
  $('#sales-with').textContent = currency(withDrop.netSalesWithKnownCost, currencyCode);
  $('#profit-without').textContent = currency(withoutDrop.grossProfit, currencyCode);
  $('#sales-without').textContent = currency(withoutDrop.netSalesWithKnownCost, currencyCode);
  $('#margin-with-bar').style.width = `${Math.max(0, Math.min(100, Number(withDrop.grossMargin) || 0))}%`;
  $('#margin-without-bar').style.width = `${Math.max(0, Math.min(100, Number(withoutDrop.grossMargin) || 0))}%`;
  const impact = margin.dropshippingImpactPp;
  $('#margin-impact').textContent = impact === null || impact === undefined ? '—' : `${impact > 0 ? '+' : ''}${number(impact, 2)} pp`;
  $('#impact-copy').textContent = impact === null || impact === undefined
    ? 'A comparison will appear when cost data is available for both groups.'
    : impact < 0
      ? `Including dropshipping reduces the reported gross margin by ${number(Math.abs(impact), 2)} percentage points.`
      : impact > 0
        ? `Including dropshipping increases the reported gross margin by ${number(impact, 2)} percentage points.`
        : 'Including dropshipping does not change the reported gross margin.';
  $('#cost-coverage').textContent = percentage(withDrop.costCoveragePct, 0);
  $('#cost-methodology').textContent = periodReport.dataQuality?.costBasis || 'Current Shopify unit cost is used where available. Historical unit costs are not reconstructed.';
}

function renderHistory() {
  const snapshots = [...(state.history?.snapshots || [])].sort((a, b) => a.month.localeCompare(b.month));
  const svg = $('#history-chart');
  if (!snapshots.length) {
    svg.innerHTML = '<text x="450" y="120" text-anchor="middle" fill="currentColor" opacity=".55" font-size="13">Monthly snapshots will appear here after the first scheduled refresh.</text>';
    $('#history-month').textContent = 'No snapshots yet';
    $('#history-ytd-count').textContent = '—';
    $('#history-ytd-pareto').textContent = '—';
    $('#history-fy-count').textContent = '—';
    $('#history-hint').textContent = 'A snapshot is saved automatically when the monthly GitHub Action runs.';
    return;
  }
  const latest = snapshots[snapshots.length - 1];
  $('#history-month').textContent = latest.month;
  $('#history-ytd-count').textContent = number(latest.YTD2026?.totalUniqueSkus);
  $('#history-ytd-pareto').textContent = number(latest.YTD2026?.top80SkuCount);
  $('#history-fy-count').textContent = number(latest.FY2025?.totalUniqueSkus);
  $('#history-hint').textContent = snapshots.length > 1
    ? `${number(snapshots.length)} monthly snapshots stored. Compare the latest month with the previous snapshot to identify changes.`
    : 'One snapshot is available. The month-over-month comparison will become more useful after the next scheduled refresh.';

  const width = 900;
  const height = 250;
  const left = 48;
  const right = 24;
  const top = 18;
  const bottom = 38;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const values = snapshots.flatMap((item) => [Number(item.YTD2026?.totalUniqueSkus) || 0, Number(item.FY2025?.totalUniqueSkus) || 0]);
  const maxValue = Math.max(...values, 1) * 1.12;
  const x = (index) => snapshots.length === 1 ? left + plotW / 2 : left + (index / (snapshots.length - 1)) * plotW;
  const y = (value) => top + plotH - (value / maxValue) * plotH;
  const ytdPoints = snapshots.map((item, index) => `${x(index)},${y(Number(item.YTD2026?.totalUniqueSkus) || 0)}`).join(' ');
  const fyPoints = snapshots.map((item, index) => `${x(index)},${y(Number(item.FY2025?.totalUniqueSkus) || 0)}`).join(' ');
  const grid = [0, .25, .5, .75, 1].map((ratio) => {
    const yy = top + plotH * (1 - ratio);
    return `<line x1="${left}" y1="${yy}" x2="${width - right}" y2="${yy}" class="chart-grid-line"/><text x="${left - 10}" y="${yy + 3}" text-anchor="end" class="chart-axis-label">${number(maxValue * ratio)}</text>`;
  }).join('');
  const labels = snapshots.map((item, index) => `<text x="${x(index)}" y="${height - 10}" text-anchor="middle" class="chart-axis-label">${escapeHtml(item.month.slice(2))}</text>`).join('');
  const circles = (items, key, className) => items.map((item, index) => `<circle cx="${x(index)}" cy="${y(Number(item[key]?.totalUniqueSkus) || 0)}" r="3.5" class="${className}"/>`).join('');
  svg.innerHTML = `${grid}<polyline points="${fyPoints}" class="history-line-fy"/><polyline points="${ytdPoints}" class="history-line-ytd"/>${circles(snapshots, 'FY2025', 'history-point-fy')}${circles(snapshots, 'YTD2026', 'history-point-ytd')}${labels}`;
}

function renderSources() {
  const stores = state.health?.integrations?.stores || [];
  for (const key of ['equestrian', 'cavali']) {
    const store = stores.find((item) => item.key === key) || {};
    const stateNode = $(`#${key}-state`);
    if (stateNode) {
      stateNode.textContent = store.configured ? 'Configured' : 'Not configured';
      stateNode.className = `source-state${store.configured ? '' : ' source-state-pending'}`;
    }
    const storeNode = $(`#${key}-store`);
    const connectionNode = $(`#${key}-connection`);
    if (storeNode) storeNode.textContent = store.store || 'Not configured';
    if (connectionNode) connectionNode.textContent = store.configured ? 'Ready for live refresh' : 'Awaiting credentials';
  }
  const selected = stores.find((item) => item.key === state.storeKey);
  const live = Boolean(selected?.configured);
  $('#sidebar-status-title').textContent = live ? 'Shopify configured' : 'Preview environment';
  $('#sidebar-status-copy').textContent = live ? 'Selected store is connected' : 'Sample data loaded';
  $('#sidebar-status-dot').className = `status-dot ${live ? 'is-live' : 'is-warning'}`;
}

function render() {
  if (!state.report) return;
  const periodReport = getCurrentPeriod();
  if (!periodReport) return;
  $('#demo-banner').hidden = !state.report.source?.demo;
  renderKpis(periodReport);
  renderPeriodComparison();
  renderPareto(periodReport);
  renderTable(periodReport);
  renderMargin(periodReport);
  renderHistory();
  renderSources();
  const generatedAt = state.report.generatedAt ? new Date(state.report.generatedAt) : null;
  $('#updated-at').textContent = generatedAt && !Number.isNaN(generatedAt.valueOf())
    ? `Last refreshed ${generatedAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`
    : 'Awaiting first refresh';
  $('#table-footnote').textContent = periodReport.dataQuality?.paretoBasis || 'SKU values are distinct product identifiers, not units sold.';
}

async function loadSelection() {
  const monthQuery = state.monthKey ? `&month=${encodeURIComponent(state.monthKey)}` : '';
  const [reportResponse, historyResponse, healthResponse, monthsResponse] = await Promise.all([
    fetch(`/api/report?store=${encodeURIComponent(state.storeKey)}${monthQuery}`),
    fetch(`/api/history?store=${encodeURIComponent(state.storeKey)}`),
    fetch('/api/health'),
    fetch(`/api/months?store=${encodeURIComponent(state.storeKey)}`)
  ]);
  if (!reportResponse.ok) throw new Error('Could not load the selected store report.');
  state.report = await reportResponse.json();
  state.history = historyResponse.ok ? await historyResponse.json() : { snapshots: [] };
  state.health = healthResponse.ok ? await healthResponse.json() : null;
  const months = monthsResponse.ok ? (await monthsResponse.json()).months || [] : [];
  const monthSelect = $('#month-select');
  const selected = state.monthKey || months[0] || '';
  monthSelect.innerHTML = `<option value="">Latest available</option>${months.map((month) => `<option value="${escapeHtml(month)}">${escapeHtml(month)}</option>`).join('')}`;
  monthSelect.value = state.monthKey;
  render();
}

async function loadDashboard() { await loadSelection(); }

async function refreshData() {
  const button = $('#refresh-button');
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<span class="button-icon">↻</span><span>Refreshing…</span>';
  try {
    const response = await fetch('/api/refresh', { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Refresh failed.');
    state.monthKey = result.report.month;
    await loadSelection();
    showToast('Both Shopify stores refreshed successfully.');
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
}

function bindEvents() {
  $('#store-select').addEventListener('change', async (event) => { state.storeKey = event.target.value; state.monthKey = ''; await loadSelection().catch((error) => showToast(error.message)); });
  $('#month-select').addEventListener('change', async (event) => { state.monthKey = event.target.value; await loadSelection().catch((error) => showToast(error.message)); });
  $('#period-select').addEventListener('change', (event) => {
    state.periodKey = event.target.value;
    render();
  });
  $('#refresh-button').addEventListener('click', refreshData);
  $('#export-button').addEventListener('click', () => {
    window.location.href = `/api/export.csv?store=${encodeURIComponent(state.storeKey)}&month=${encodeURIComponent(state.monthKey || $('#month-select').value)}&period=${encodeURIComponent(state.periodKey)}`;
  });
  $('#sku-search').addEventListener('input', () => {
    const periodReport = getCurrentPeriod();
    if (periodReport) renderTable(periodReport);
  });
  $('#action-filter').addEventListener('change', () => {
    const periodReport = getCurrentPeriod();
    if (periodReport) renderTable(periodReport);
  });
  $('#theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('sku-theme', next); } catch { /* storage is optional */ }
  });
  document.querySelectorAll('.nav-link').forEach((link) => {
    link.addEventListener('click', () => {
      document.querySelectorAll('.nav-link').forEach((item) => item.classList.remove('active'));
      link.classList.add('active');
    });
  });
}

try {
  const savedTheme = localStorage.getItem('sku-theme');
  if (savedTheme === 'dark' || savedTheme === 'light') document.documentElement.dataset.theme = savedTheme;
} catch { /* storage is optional */ }

bindEvents();
$('#store-select').value = state.storeKey;
loadDashboard().catch((error) => {
  showToast(error.message);
  $('#sku-table-body').innerHTML = '<tr><td colspan="9" class="empty-cell">Unable to load dashboard data. Check the server logs and try again.</td></tr>';
});
