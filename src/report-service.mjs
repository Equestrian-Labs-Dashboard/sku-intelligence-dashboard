import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { getReportPeriods } from './periods.mjs';
import { buildReport, buildPeriodReport } from './analytics.mjs';
import { fetchShopifyOrdersForPeriod } from './integrations/shopify.mjs';

const DATA_DIR = resolve(process.cwd(), 'data');
const ARCHIVE_DIR = join(DATA_DIR, 'archive');
const LATEST_PATH = join(DATA_DIR, 'latest-report.json');
async function readJson(path, fallback) { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; } }
function shopConfig(store, config) { return { ...config, shopifyStore: store.shopifyStore, shopifyAccessToken: store.shopifyAccessToken }; }

function monthPeriod(year, month, timeZone) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const next = new Date(Date.UTC(year, month, 1));
  const endDateExclusive = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const date = new Date(`${startDate}T12:00:00Z`);
  const label = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone }).format(date);
  return { key: 'MONTH', label, startDate, endDateExclusive, cutoffDate: endDateExclusive };
}

export async function refreshAndSaveReport(config) {
  await mkdir(ARCHIVE_DIR, { recursive: true });
  const periods = getReportPeriods(new Date(), config.reportTimezone);
  const stores = {};
  const capturedAt = new Date().toISOString();
  const [currentYear, currentMonth] = periods.monthKey.split('-').map(Number);

  for (const store of config.stores) {
    if (!store.shopifyStore || !store.shopifyAccessToken) throw new Error(`Missing credentials for ${store.name}. Configure its two GitHub Actions secrets.`);
    const scoped = shopConfig(store, config);

    // Retrieve each full reporting window once. Monthly snapshots are then
    // calculated locally from these complete order sets, avoiding 24 extra
    // Shopify bulk exports on every monthly run.
    const fy2025Orders = await fetchShopifyOrdersForPeriod(scoped, periods.FY2025);
    const ytd2026Orders = await fetchShopifyOrdersForPeriod(scoped, periods.YTD2026);
    const currentMonthOrders = ytd2026Orders;
    const ordersByPeriod = {
      FY2025: fy2025Orders,
      YTD2026: ytd2026Orders,
      MONTH: currentMonthOrders
    };
    const report = buildReport(ordersByPeriod, periods, { dropshipTags: config.dropshipTags, timezone: config.reportTimezone });
    report.source.shopifyStore = store.shopifyStore;
    report.source.storeKey = store.key;
    report.source.storeName = store.name;
    report.generatedAt = capturedAt;
    stores[store.key] = { name: store.name, shopifyStore: store.shopifyStore, report };

    const monthlySources = new Map([[2025, fy2025Orders], [2026, ytd2026Orders]]);
    const monthKeys = [];
    for (const year of [2025, 2026]) {
      const lastMonth = year === 2025 ? 12 : currentYear === 2026 ? currentMonth : 0;
      for (let month = 1; month <= lastMonth; month += 1) {
        const monthKey = `${year}-${String(month).padStart(2, '0')}`;
        const period = monthPeriod(year, month, config.reportTimezone);
        const monthlyReport = buildPeriodReport(monthlySources.get(year), period, {
          dropshipTags: config.dropshipTags,
          timezone: config.reportTimezone
        });
        const storeYearDir = join(ARCHIVE_DIR, store.key, String(year));
        await mkdir(storeYearDir, { recursive: true });
        const monthlyArchive = {
          generatedAt: capturedAt,
          source: report.source,
          reportingTimezone: config.reportTimezone,
          periods: {
            MONTH: monthlyReport,
            FY2025: { period: report.periods.FY2025.period, summary: report.periods.FY2025.summary, grossMargin: report.periods.FY2025.grossMargin },
            YTD2026: { period: report.periods.YTD2026.period, summary: report.periods.YTD2026.summary, grossMargin: report.periods.YTD2026.grossMargin }
          },
          notes: report.notes
        };
        await writeFile(join(storeYearDir, `${monthKey}.json`), `${JSON.stringify({
          store: store.key,
          storeName: store.name,
          month: monthKey,
          capturedAt,
          report: monthlyArchive
        })}\n`, 'utf8');
        monthKeys.push(monthKey);
      }
    }
  }

  const combined = { generatedAt: capturedAt, month: periods.monthKey, stores, defaultStore: 'equestrian' };
  await writeFile(LATEST_PATH, `${JSON.stringify(combined)}\n`, 'utf8');
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
