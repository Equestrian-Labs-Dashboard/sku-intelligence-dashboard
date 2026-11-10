const $ = (selector) => document.querySelector(selector);

const state = {
  report: null,
  history: { snapshots: [] },
  health: null,
  periodKey: 'MONTH',
  storeKey: 'equestrian',
  monthKey: '',
  visibleRows: [],
  tablePage: 0
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
  const summary = periodReport.summary || {};
  const margin = periodReport.grossMargin?.withDropshipping || {};
  const currencyCode = summary.currency || 'USD';
  $('#period-title').textContent = periodReport.period?.label || 'Selected period';
  $('#kpi-unique').textContent = number(summary.totalUniqueSkus);
  $('#kpi-net-items').textContent = number(summary.netItemsSold ?? summary.totalUnitsSold);
  $('#kpi-sales').textContent = currency(summary.netSales, currencyCode);
  $('#kpi-margin').textContent = percentage(margin.grossMargin);
  $('#kpi-unique-change').textContent = `${number(summary.quantityOrdered)} quantity ordered`;
  $('#kpi-quantity-bridge').textContent = `Reversed ${number(summary.reversedQuantity)}`;
  $('#kpi-margin-coverage').textContent = `Cost coverage ${percentage(margin.costCoveragePct, 0)}`;
  $('#bridge-gross').textContent = currency(summary.grossSales, currencyCode);
  $('#bridge-discounts').textContent = currency(summary.discounts, currencyCode);
  $('#bridge-reversals').textContent = currency(summary.salesReversals, currencyCode);
  $('#bridge-net').textContent = currency(summary.netSales, currencyCode);
  $('#bridge-ordered').textContent = number(summary.quantityOrdered);
  $('#bridge-net-items').textContent = number(summary.netItemsSold ?? summary.totalUnitsSold);
  $('#bridge-reversed-qty').textContent = number(summary.reversedQuantity);
  $('#pareto-count').textContent = number(summary.totalUniqueSkus);
  $('#pareto-rest').textContent = percentage(summary.topSkuShare, 2);
  $('#donut-total').textContent = currency(summary.netSales, currencyCode);
  const rows = periodReport.skuRows || [];
  const dropshipSales = rows.filter((row) => row.isDropship).reduce((sum, row) => sum + Math.max(0, row.netSales), 0);
  const stockedSales = rows.filter((row) => !row.isDropship).reduce((sum, row) => sum + Math.max(0, row.netSales), 0);
  const totalMix = dropshipSales + stockedSales;
  const dropshipShare = totalMix > 0 ? dropshipSales / totalMix * 100 : 0;
  $('#donut-top-count').textContent = `${currency(dropshipSales, currencyCode)} · ${percentage(dropshipShare, 1)}`;
  $('#donut-rest-count').textContent = `${currency(stockedSales, currencyCode)} · ${percentage(100 - dropshipShare, 1)}`;
  $('#concentration-insight').textContent = `${number(summary.totalUniqueSkus)} distinct SKUs contribute to ${currency(summary.netSales, currencyCode)} in net product sales.`;
  $('#donut-chart').style.background = `conic-gradient(var(--black) 0 ${dropshipShare}%, var(--surface-muted) ${dropshipShare}% 100%)`;
}

function renderPeriodComparison() {
  const fy = state.report?.periods?.FY2025?.summary;
  const ytd = state.report?.periods?.YTD2026?.summary;
  if (!fy || !ytd) return;
  const delta = (before, after, digits = 0) => {
    const value = Number(after || 0) - Number(before || 0);
    return `${value > 0 ? '+' : ''}${number(value, digits)}`;
  };
  $('#compare-unique-fy').textContent = number(fy.totalUniqueSkus);
  $('#compare-unique-ytd').textContent = number(ytd.totalUniqueSkus);
  $('#compare-unique-delta').textContent = `${delta(fy.totalUniqueSkus, ytd.totalUniqueSkus)} SKUs; periods differ`;
  $('#compare-units-fy').textContent = number(fy.netItemsSold ?? fy.totalUnitsSold);
  $('#compare-units-ytd').textContent = number(ytd.netItemsSold ?? ytd.totalUnitsSold);
  $('#compare-units-delta').textContent = `${delta(fy.netItemsSold ?? fy.totalUnitsSold, ytd.netItemsSold ?? ytd.totalUnitsSold)} net items`;
  const currencyCode = fy.currency || ytd.currency || 'USD';
  $('#compare-sales-fy').textContent = currency(fy.netSales, currencyCode);
  $('#compare-sales-ytd').textContent = currency(ytd.netSales, currencyCode);
  $('#compare-sales-delta').textContent = `${delta(fy.netSales, ytd.netSales, 2)} ${currencyCode}; periods differ`;
  const fyGini = Number(fy.concentrationGini) || 0;
  const ytdGini = Number(ytd.concentrationGini) || 0;
  const difference = ytdGini - fyGini;
  $('#compare-insight-title').textContent = difference > 0.5
    ? 'SKU sales are more concentrated in 2026 YTD'
    : difference < -0.5
      ? 'SKU sales are less concentrated in 2026 YTD'
      : 'SKU sales concentration is broadly similar';
  $('#compare-insight-copy').textContent = `Gini concentration index: ${number(fyGini, 2)} in FY 2025 vs. ${number(ytdGini, 2)} in 2026 YTD. Higher values indicate sales are concentrated in fewer SKUs. FY 2025 and 2026 YTD cover different lengths of time.`;
}

function renderPareto(periodReport) {
  const svg = $('#pareto-chart');
  const rows = (periodReport.skuRows || []).filter((row) => row.rank);
  const width = 900;
  const height = 280;
  const margin = { top: 18, right: 42, bottom: 42, left: 58 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  if (!rows.length) {
    svg.innerHTML = `<text x="450" y="135" text-anchor="middle" fill="currentColor" opacity=".55" font-size="13">No SKU sales data available for this period.</text>`;
    return;
  }
  const values = rows.map((row) => Number(row.netSales) || 0);
  const maxSales = Math.max(...values, 1);
  const minSales = Math.min(...values, 0);
  const range = Math.max(1, maxSales - minSales);
  const y = (value) => margin.top + ((maxSales - value) / range) * plotHeight;
  const baseline = y(0);
  const slot = plotWidth / rows.length;
  const barWidth = Math.max(.25, Math.min(3, slot * .72));
  const grid = [0, .25, .5, .75, 1].map((ratio) => {
    const value = maxSales - ratio * range;
    const yy = margin.top + ratio * plotHeight;
    return `<line x1="${margin.left}" y1="${yy}" x2="${width - margin.right}" y2="${yy}" class="chart-grid-line"/><text x="${margin.left - 9}" y="${yy + 3}" text-anchor="end" class="chart-axis-label">${number(value / 1000, 1)}k</text>`;
  }).join('');
  const bars = rows.map((row, index) => {
    const x = margin.left + index * slot + (slot - barWidth) / 2;
    const valueY = y(Number(row.netSales) || 0);
    const rectY = Math.min(valueY, baseline);
    const rectHeight = Math.max(.4, Math.abs(baseline - valueY));
    return `<rect x="${x.toFixed(2)}" y="${rectY.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${rectHeight.toFixed(2)}" class="pareto-bar"><title>Rank ${index + 1} · ${escapeHtml(row.sku)} · ${currency(row.netSales, periodReport.summary.currency)}</title></rect>`;
  }).join('');
  const points = rows.map((row, index) => {
    const x = margin.left + index * slot + slot / 2;
    const share = Math.max(-100, Math.min(200, Number(row.cumulativeShare) || 0));
    const pointY = margin.top + plotHeight * (1 - share / 100);
    return `${x.toFixed(2)},${pointY.toFixed(2)}`;
  }).join(' ');
  const ticks = [0, .25, .5, .75, 1].map((ratio) => {
    const rank = Math.max(1, Math.round(rows.length * ratio));
    const x = margin.left + (rank - .5) * slot;
    return `<text x="${x.toFixed(2)}" y="${height - 17}" text-anchor="middle" class="chart-axis-label">${number(rank)}</text>`;
  }).join('');
  svg.innerHTML = `${grid}<line x1="${margin.left}" y1="${baseline}" x2="${width - margin.right}" y2="${baseline}" class="chart-grid-line"/>${bars}<polyline points="${points}" class="pareto-line"/>${ticks}<text x="${margin.left}" y="${height - 3}" class="chart-axis-label">SKU RANK · ${number(rows.length)} SKUs IN THE FULL CATALOG</text>`;
}

function actionClass(action) {
  return action === 'DROPSHIP' ? 'drop' : 'core';
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
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  state.tablePage = Math.max(0, Math.min(state.tablePage, pageCount - 1));
  const start = state.tablePage * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  $('#table-count').textContent = `${number(rows.length)} SKU records`;
  $('#table-pagination').textContent = `${number(rows.length ? start + 1 : 0)}–${number(Math.min(start + pageSize, rows.length))} of ${number(rows.length)} · Page ${state.tablePage + 1}/${pageCount}`;
  $('#table-prev').disabled = state.tablePage === 0;
  $('#table-next').disabled = state.tablePage >= pageCount - 1;
  const body = $('#sku-table-body');
  if (!pageRows.length) {
    body.innerHTML = '<tr><td colspan="14" class="empty-cell">No products match the current filters.</td></tr>';
    return;
  }
  body.innerHTML = pageRows.map((row) => `
    <tr>
      <td class="rank-cell numeric">${row.rank ? `#${number(row.rank)}` : '—'}</td>
      <td><div class="product-cell"><strong>${escapeHtml(row.productTitle)}</strong><small>${escapeHtml(row.sku)} · ${escapeHtml(row.category || 'Uncategorized')}</small></div></td>
      <td class="numeric">${number(row.quantityOrdered)}</td>
      <td class="numeric">${number(row.netItemsSold)}</td>
      <td class="numeric">${number(row.reversedQuantity)}</td>
      <td class="numeric">${currency(row.grossSales, periodReport.summary.currency)}</td>
      <td class="numeric">${currency(row.discounts, periodReport.summary.currency)}</td>
      <td class="numeric">${currency(row.salesReversals, periodReport.summary.currency)}</td>
      <td class="numeric">${currency(row.netSales, periodReport.summary.currency)}</td>
      <td class="share-cell numeric">${percentage(row.salesShare, 2)}<div class="mini-bar"><span style="width:${Math.max(0, Math.min(100, Number(row.salesShare) || 0))}%"></span></div></td>
      <td class="numeric">${percentage(row.cumulativeShare, 1)}</td>
      <td class="numeric">${percentage(row.grossMargin, 1)}</td>
      <td class="numeric">${row.inventoryAvailable === null || row.inventoryAvailable === undefined ? 'Not synced' : number(row.inventoryAvailable)}</td>
      <td><span class="action-pill ${actionClass(row.action)}">${escapeHtml(row.action || 'STOCK REVIEW')}</span></td>
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
  const latestMonth = latest.MONTH || latest.monthSummary || {};
  $('#history-ytd-count').textContent = number(latestMonth.totalUniqueSkus ?? latest.YTD2026?.totalUniqueSkus);
  $('#history-ytd-pareto').textContent = number(latestMonth.concentrationGini ?? latest.YTD2026?.concentrationGini, 2);
  $('#history-fy-count').textContent = currency(latestMonth.netSales ?? latest.FY2025?.netSales, latestMonth.currency || 'USD');
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
  const values = snapshots.map((item) => Number((item.MONTH || item.YTD2026)?.totalUniqueSkus) || 0);
  const maxValue = Math.max(...values, 1) * 1.12;
  const x = (index) => snapshots.length === 1 ? left + plotW / 2 : left + (index / (snapshots.length - 1)) * plotW;
  const y = (value) => top + plotH - (value / maxValue) * plotH;
  const monthPoints = snapshots.map((item, index) => `${x(index)},${y(Number((item.MONTH || item.YTD2026)?.totalUniqueSkus) || 0)}`).join(' ');
  const grid = [0, .25, .5, .75, 1].map((ratio) => {
    const yy = top + plotH * (1 - ratio);
    return `<line x1="${left}" y1="${yy}" x2="${width - right}" y2="${yy}" class="chart-grid-line"/><text x="${left - 10}" y="${yy + 3}" text-anchor="end" class="chart-axis-label">${number(maxValue * ratio)}</text>`;
  }).join('');
  const labels = snapshots.map((item, index) => `<text x="${x(index)}" y="${height - 10}" text-anchor="middle" class="chart-axis-label">${escapeHtml(item.month.slice(2))}</text>`).join('');
  const circles = snapshots.map((item, index) => `<circle cx="${x(index)}" cy="${y(Number((item.MONTH || item.YTD2026)?.totalUniqueSkus) || 0)}" r="3.5" class="history-point-ytd"/>`).join('');
  svg.innerHTML = `${grid}<polyline points="${monthPoints}" class="history-line-ytd"/>${circles}${labels}`;
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
  $('#table-footnote').textContent = periodReport.dataQuality?.salesBasis || 'Sales metrics are sourced directly from ShopifyQL; SKU count is distinct variant codes, not units.';
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
  showToast('Data refresh runs through the scheduled GitHub Actions workflow. Ask your administrator for an on-demand refresh.');
}

function bindEvents() {
  $('#store-select').addEventListener('change', async (event) => { state.storeKey = event.target.value; state.monthKey = ''; state.tablePage = 0; await loadSelection().catch((error) => showToast(error.message)); });
  $('#month-select').addEventListener('change', async (event) => {
    state.monthKey = event.target.value;
    state.tablePage = 0;
    state.periodKey = 'MONTH';
    $('#period-select').value = 'MONTH';
    await loadSelection().catch((error) => showToast(error.message));
  });
  $('#period-select').addEventListener('change', async (event) => {
    state.periodKey = event.target.value;
    state.tablePage = 0;
    if (state.periodKey !== 'MONTH') {
      state.monthKey = '';
      $('#month-select').value = '';
      await loadSelection().catch((error) => showToast(error.message));
    } else {
      render();
    }
  });
  $('#refresh-button').addEventListener('click', refreshData);
  $('#export-button').addEventListener('click', () => {
    window.location.href = `/api/export.csv?store=${encodeURIComponent(state.storeKey)}&month=${encodeURIComponent(state.monthKey || $('#month-select').value)}&period=${encodeURIComponent(state.periodKey)}`;
  });
  $('#sku-search').addEventListener('input', () => {
    state.tablePage = 0;
    const periodReport = getCurrentPeriod();
    if (periodReport) renderTable(periodReport);
  });
  $('#action-filter').addEventListener('change', () => {
    state.tablePage = 0;
    const periodReport = getCurrentPeriod();
    if (periodReport) renderTable(periodReport);
  });
  $('#table-prev').addEventListener('click', () => {
    state.tablePage = Math.max(0, state.tablePage - 1);
    const periodReport = getCurrentPeriod();
    if (periodReport) renderTable(periodReport);
  });
  $('#table-next').addEventListener('click', () => {
    state.tablePage += 1;
    const periodReport = getCurrentPeriod();
    if (periodReport) renderTable(periodReport);
  });

  const helpContent = {
    'sku-count': {
      title: 'Unique SKUs sold',
      body: `<p>This is the number of distinct, non-empty product variant SKU codes with sales activity in the selected period.</p><p>It is not the number of units sold and it is not the number of orders. If the same SKU appears in 50 orders, it is counted once.</p><p>Shopify product-level reports can combine several variants. This dashboard counts at the variant-SKU level.</p>`
    },
    'quantity-ordered': {
      title: 'Quantity ordered',
      body: `<p>The original number of units ordered before quantities are removed by later adjustments.</p><p>One SKU can have 524 units ordered even if fewer units remain sold after refunds, returns, cancellations or order edits.</p>`
    },
    'net-items': {
      title: 'Net items sold',
      body: `<p>The number of items remaining after Shopify accounts for reversed quantities.</p><p>Example: 524 units ordered and 20 units reversed results in 504 net items sold. This is why unit totals can differ from the original order quantity.</p>`
    },
    'reversed-quantity': {
      title: 'Reversed quantity',
      body: `<p>The quantity removed from orders through refunds, returns, cancellations or order edits. Shopify can display this as a negative number.</p><p>It is not limited to physical products returned to the warehouse. It includes broader order adjustments.</p>`
    },
    'gross-sales': {
      title: 'Gross sales',
      body: `<p>Product sales value before discounts and sales reversals. It excludes taxes, shipping, duties and fees.</p>`
    },
    'discounts': {
      title: 'Discounts',
      body: `<p>The value deducted from product sales through discounts. The value and sign shown follow ShopifyQL's sales report output.</p>`
    },
    'sales-reversals': {
      title: 'Sales reversals',
      body: `<p>Value removed from orders through refunds, returns, cancellations or order edits. It is broader than physical returns alone.</p><p>Shopify renamed older returns metrics to sales reversals to make this distinction clearer.</p>`
    },
    'net-sales': {
      title: 'Net product sales',
      body: `<p>Shopify's product sales revenue after discounts and sales reversals, excluding taxes, shipping, duties and fees.</p><p>The dashboard reads this metric directly from ShopifyQL rather than multiplying an order line total by its quantity.</p>`
    },
    'gross-margin': {
      title: 'Gross margin and cost coverage',
      body: `<p>Gross margin is gross profit divided by net sales where product cost is recorded.</p><p>This report uses the current Shopify unit cost multiplied by net items sold. Shopify does not provide historical unit costs through the current workflow, so historical gross margin is an estimate when costs have changed.</p><p>Cost coverage shows the share of net sales for which a unit cost is available. Compare the coverage before relying on the margin.</p>`
    },
    'concentration': {
      title: 'SKU sales concentration',
      body: `<p>All SKU records are ranked by net sales. The cumulative line shows how much of total net sales is accounted for as more SKUs are included.</p><p>No fixed 80/20 split is assumed and the chart is not limited to a Top 10. The entire SKU catalog is included in the calculation.</p><p>The Gini index compares how evenly sales are distributed across SKUs. Higher values mean a larger share of sales is concentrated in fewer SKUs.</p>`
    },
    'dropshipping': {
      title: 'Dropshipping classification',
      body: `<p>A SKU is classified as dropshipping when its order or product tags match the configured tags, or when line-item attributes identify supplier fulfillment.</p><p>Products without those indicators are grouped as stocked / untagged. If your store uses a different dropshipping tag, the configured tag list must be updated.</p>`
    },
    'why-different': {
      title: 'Why can Shopify and this dashboard show different values?',
      body: `<p><strong>Sales source:</strong> This dashboard uses ShopifyQL's <code>FROM sales</code> dataset for gross sales, discounts, sales reversals, net sales and quantity metrics. These are not reconstructed from order line totals.</p><p><strong>SKU vs. product grouping:</strong> The dashboard groups by <code>product_variant_sku</code>. A product-level report can combine multiple variants, so product totals and SKU totals may differ.</p><p><strong>Quantity definitions:</strong> Quantity ordered is before reversals; net items sold is after reversals; reversed quantity includes refunds, returns, cancellations and order edits. These are three different measures.</p><p><strong>Date attribution:</strong> Shopify's sales dataset records sale and adjustment events. A refund or edit can be attributed to the date the adjustment occurred, not only the original order date. A report filtered by order creation date can therefore differ.</p><p><strong>Filters:</strong> To compare the same result, use the same store, date range, SKU dimension, sales metrics and filters in ShopifyQL. The example query in Shopify should use <code>product_variant_sku</code> and the same period selected here.</p><p><strong>Other fields:</strong> Product titles and current unit costs come from Shopify Admin product/order data. Titles can change over time, and current costs are not historical costs.</p>`
    }
  };

  function openHelp(key) {
    const item = helpContent[key] || helpContent['why-different'];
    $('#help-dialog-title').textContent = item.title;
    $('#help-dialog-body').innerHTML = item.body;
    const dialog = $('#help-dialog');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-help]');
    if (trigger) openHelp(trigger.dataset.help);
  });
  const closeHelp = () => {
    const dialog = $('#help-dialog');
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  };
  $('#help-dialog-close').addEventListener('click', closeHelp);
  $('#help-dialog-done').addEventListener('click', closeHelp);
  $('#help-dialog').addEventListener('click', (event) => {
    if (event.target === $('#help-dialog')) closeHelp();
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
