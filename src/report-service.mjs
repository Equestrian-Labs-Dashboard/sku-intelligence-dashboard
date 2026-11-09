import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getReportPeriods } from './periods.mjs';
import { buildReport } from './analytics.mjs';
import { fetchShopifyOrdersForPeriod } from './integrations/shopify.mjs';
import { getPonevaStatus } from './integrations/poneva.mjs';

const DATA_DIR = resolve(process.cwd(), 'data');
const REPORT_PATH = resolve(DATA_DIR, 'latest-report.json');
const HISTORY_PATH = resolve(DATA_DIR, 'history.json');

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function refreshAndSaveReport(config) {
  await mkdir(DATA_DIR, { recursive: true });
  const periods = getReportPeriods(new Date(), config.reportTimezone);
  const ordersByPeriod = {};

  ordersByPeriod.FY2025 = await fetchShopifyOrdersForPeriod(config, periods.FY2025);
  ordersByPeriod.YTD2026 = await fetchShopifyOrdersForPeriod(config, periods.YTD2026);

  const report = buildReport(ordersByPeriod, periods, {
    dropshipTags: config.dropshipTags,
    timezone: config.reportTimezone
  });
  report.source.poneva = getPonevaStatus(config);
  report.source.shopifyStore = config.shopifyStore;

  const history = await readJson(HISTORY_PATH, { snapshots: [] });
  const capturedAt = new Date().toISOString();
  const monthKey = capturedAt.slice(0, 7);
  const snapshot = {
    month: monthKey,
    capturedAt,
    FY2025: report.periods.FY2025.summary,
    YTD2026: report.periods.YTD2026.summary,
    FY2025Margin: report.periods.FY2025.grossMargin,
    YTD2026Margin: report.periods.YTD2026.grossMargin
  };
  const snapshots = Array.isArray(history.snapshots) ? history.snapshots : [];
  const existingIndex = snapshots.findIndex((item) => item.month === monthKey);
  if (existingIndex >= 0) snapshots[existingIndex] = snapshot;
  else snapshots.push(snapshot);
  snapshots.sort((a, b) => a.month.localeCompare(b.month));

  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(HISTORY_PATH, `${JSON.stringify({ snapshots: snapshots.slice(-36) }, null, 2)}\n`, 'utf8');
  return report;
}

export async function loadLatestReport() {
  return readJson(REPORT_PATH, null);
}

export async function loadHistory() {
  return readJson(HISTORY_PATH, { snapshots: [] });
}

export function getIntegrationStatus(config) {
  return {
    shopify: {
      configured: Boolean(config.shopifyStore && config.shopifyAccessToken),
      store: config.shopifyStore || null
    },
    poneva: getPonevaStatus(config)
  };
}
