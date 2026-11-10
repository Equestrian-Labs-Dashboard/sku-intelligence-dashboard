import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { getReportPeriods } from './periods.mjs';
import { buildReport } from './analytics.mjs';
import { fetchShopifyOrdersForPeriod } from './integrations/shopify.mjs';

const DATA_DIR = resolve(process.cwd(), 'data');
const ARCHIVE_DIR = join(DATA_DIR, 'archive');
const LATEST_PATH = join(DATA_DIR, 'latest-report.json');
async function readJson(path, fallback) { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; } }
function shopConfig(store, config) { return { ...config, shopifyStore: store.shopifyStore, shopifyAccessToken: store.shopifyAccessToken }; }

export async function refreshAndSaveReport(config) {
  await mkdir(ARCHIVE_DIR, { recursive: true });
  const periods = getReportPeriods(new Date(), config.reportTimezone);
  const stores = {};
  const capturedAt = new Date().toISOString();
  for (const store of config.stores) {
    if (!store.shopifyStore || !store.shopifyAccessToken) throw new Error(`Missing credentials for ${store.name}. Configure its two GitHub Actions secrets.`);
    const scoped = shopConfig(store, config);
    const ordersByPeriod = {};
    for (const key of ['FY2025', 'YTD2026', 'MONTH']) ordersByPeriod[key] = await fetchShopifyOrdersForPeriod(scoped, periods[key]);
    const report = buildReport(ordersByPeriod, periods, { dropshipTags: config.dropshipTags, timezone: config.reportTimezone });
    report.source.shopifyStore = store.shopifyStore;
    report.source.storeKey = store.key;
    report.source.storeName = store.name;
    report.generatedAt = capturedAt;
    stores[store.key] = { name: store.name, shopifyStore: store.shopifyStore, report };
    const year = periods.monthKey.slice(0, 4);
    const storeYearDir = join(ARCHIVE_DIR, store.key, year);
    await mkdir(storeYearDir, { recursive: true });
    const compactArchive = {
      ...report,
      periods: {
        MONTH: report.periods.MONTH,
        FY2025: { period: report.periods.FY2025.period, summary: report.periods.FY2025.summary, grossMargin: report.periods.FY2025.grossMargin },
        YTD2026: { period: report.periods.YTD2026.period, summary: report.periods.YTD2026.summary, grossMargin: report.periods.YTD2026.grossMargin }
      }
    };
    await writeFile(join(storeYearDir, `${periods.monthKey}.json`), `${JSON.stringify({ store: store.key, storeName: store.name, month: periods.monthKey, capturedAt, report: compactArchive }, null, 2)}\n`, 'utf8');
  }
  const combined = { generatedAt: capturedAt, month: periods.monthKey, stores, defaultStore: 'equestrian' };
  await writeFile(LATEST_PATH, `${JSON.stringify(combined, null, 2)}\n`, 'utf8');
  return combined;
}

export async function loadLatestReport() { return readJson(LATEST_PATH, null); }
export async function loadStoreMonth(storeKey, monthKey) {
  if (!/^(equestrian|cavali)$/.test(storeKey) || !/^\d{4}-\d{2}$/.test(monthKey)) return null;
  return readJson(join(ARCHIVE_DIR, storeKey, monthKey.slice(0, 4), `${monthKey}.json`), null);
}
export async function listAvailableMonths(storeKey) {
  if (!/^(equestrian|cavali)$/.test(storeKey)) return [];
  const base = join(ARCHIVE_DIR, storeKey);
  const years = await readdir(base, { withFileTypes: true }).catch(() => []);
  const months = [];
  for (const year of years.filter((entry) => entry.isDirectory())) {
    const files = await readdir(join(base, year.name)).catch(() => []);
    months.push(...files.filter((file) => /^\d{4}-\d{2}\.json$/.test(file)).map((file) => file.slice(0, 7)));
  }
  return [...new Set(months)].sort().reverse();
}
export async function loadHistory(storeKey = 'equestrian') {
  const months = await listAvailableMonths(storeKey);
  const snapshots = [];
  for (const month of months) {
    const saved = await loadStoreMonth(storeKey, month);
    if (!saved?.report?.periods) continue;
    snapshots.push({ month, FY2025: saved.report.periods.FY2025?.summary, YTD2026: saved.report.periods.YTD2026?.summary });
  }
  return { snapshots: snapshots.reverse() };
}
export function getIntegrationStatus(config) {
  return { stores: config.stores.map((store) => ({ key: store.key, name: store.name, store: store.shopifyStore || null, configured: Boolean(store.shopifyStore && store.shopifyAccessToken) })) };
}
