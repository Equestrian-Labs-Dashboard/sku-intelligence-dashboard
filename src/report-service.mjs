import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { getReportPeriods } from './periods.mjs';
import { buildReport, buildPeriodReport } from './analytics.mjs';
import { fetchShopifyOrdersForPeriod } from './integrations/shopify.mjs';
import { fetchShopifySalesBySku } from './integrations/shopifyql.mjs';

const DATA_DIR = resolve(process.cwd(), 'data');
const ARCHIVE_DIR = join(DATA_DIR, 'archive');
const LATEST_PATH = join(DATA_DIR, 'latest-report.json');

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

function shopConfig(store, config) {
  return { ...config, shopifyStore: store.shopifyStore, shopifyAccessToken: store.shopifyAccessToken };
}

function monthPeriod(year, month) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const next = new Date(Date.UTC(year, month, 1));
  const endDateExclusive = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const until = new Date(`${endDateExclusive}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() - 1);
  const cutoffDate = until.toISOString().slice(0, 10);
  const label = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${startDate}T12:00:00Z`));
  return { key: 'MONTH', label, startDate, endDateExclusive, cutoffDate };
}

export async function refreshAndSaveReport(config) {
  await mkdir(ARCHIVE_DIR, { recursive: true });
  const periods = getReportPeriods(new Date(), config.reportTimezone);
  const stores = {};
  const capturedAt = new Date().toISOString();
  const [currentYear, currentMonth] = periods.monthKey.split('-').map(Number);

  for (const store of config.stores) {
    if (!store.shopifyStore || !store.shopifyAccessToken) {
      throw new Error(`Missing credentials for ${store.name}. Configure its two GitHub Actions secrets.`);
    }
    const scoped = shopConfig(store, config);

    console.log(`[${store.name}] Exporting order metadata and current product costs from Shopify Bulk Operations...`);
    const fy2025Orders = await fetchShopifyOrdersForPeriod(scoped, periods.FY2025);
    const ytd2026Orders = await fetchShopifyOrdersForPeriod(scoped, periods.YTD2026);
    const metadataOrders = [...fy2025Orders, ...ytd2026Orders];

    console.log(`[${store.name}] Querying ShopifyQL sales metrics for FY2025 and 2026 YTD...`);
    const fy2025Sales = await fetchShopifySalesBySku(scoped, periods.FY2025);
    const ytd2026Sales = await fetchShopifySalesBySku(scoped, periods.YTD2026);

    const salesByMonth = new Map();
    for (const year of [2025, 2026]) {
      const lastMonth = year === 2025 ? 12 : (currentYear === 2026 ? currentMonth : 0);
      for (let month = 1; month <= lastMonth; month += 1) {
        const monthKey = `${year}-${String(month).padStart(2, '0')}`;
        const period = monthPeriod(year, month);
        console.log(`[${store.name}] ShopifyQL ${monthKey}...`);
        const result = await fetchShopifySalesBySku(scoped, period);
        salesByMonth.set(monthKey, result);
      }
    }

    const currentMonthSales = salesByMonth.get(periods.monthKey) || await fetchShopifySalesBySku(scoped, periods.MONTH);
    const salesByPeriod = {
      FY2025: fy2025Sales.rows,
      YTD2026: ytd2026Sales.rows,
      MONTH: currentMonthSales.rows
    };
    const unassignedByPeriod = {
      FY2025: fy2025Sales.unassigned,
      YTD2026: ytd2026Sales.unassigned,
      MONTH: currentMonthSales.unassigned
    };
    const metadataOrdersByPeriod = { FY2025: fy2025Orders, YTD2026: ytd2026Orders };
    const report = buildReport(salesByPeriod, metadataOrdersByPeriod, periods, {
      dropshipTags: config.dropshipTags,
      timezone: config.reportTimezone,
      currencyCode: currentMonthSales.currencyCode || ytd2026Sales.currencyCode || fy2025Sales.currencyCode || 'USD',
      unassignedByPeriod
    });

    report.source.shopifyStore = store.shopifyStore;
    report.source.storeKey = store.key;
    report.source.storeName = store.name;
    report.source.salesMetrics = 'ShopifyQL FROM sales';
    report.generatedAt = capturedAt;
    stores[store.key] = { name: store.name, shopifyStore: store.shopifyStore, report };

    const yearSummary = {
      FY2025: report.periods.FY2025,
      YTD2026: report.periods.YTD2026
    };

    for (const [monthKey, salesResult] of salesByMonth.entries()) {
      const [year, month] = monthKey.split('-').map(Number);
      const period = monthPeriod(year, month);
      const monthlyReport = buildPeriodReport(
        salesResult.rows,
        metadataOrders,
        period,
        {
          dropshipTags: config.dropshipTags,
          timezone: config.reportTimezone,
          currencyCode: salesResult.currencyCode || report.periods.MONTH.summary.currency,
          unassignedSales: salesResult.unassigned
        }
      );
      const storeYearDir = join(ARCHIVE_DIR, store.key, String(year));
      await mkdir(storeYearDir, { recursive: true });
      const archive = {
        generatedAt: capturedAt,
        source: report.source,
        reportingTimezone: config.reportTimezone,
        periods: {
          MONTH: monthlyReport,
          FY2025: {
            period: yearSummary.FY2025.period,
            summary: yearSummary.FY2025.summary,
            grossMargin: yearSummary.FY2025.grossMargin
          },
          YTD2026: {
            period: yearSummary.YTD2026.period,
            summary: yearSummary.YTD2026.summary,
            grossMargin: yearSummary.YTD2026.grossMargin
          }
        },
        notes: report.notes
      };
      await writeFile(
        join(storeYearDir, `${monthKey}.json`),
        `${JSON.stringify({ store: store.key, storeName: store.name, month: monthKey, capturedAt, report: archive })}\n`,
        'utf8'
      );
    }
  }

  const combined = {
    generatedAt: capturedAt,
    month: periods.monthKey,
    stores,
    defaultStore: 'equestrian'
  };
  await writeFile(LATEST_PATH, `${JSON.stringify(combined)}\n`, 'utf8');
  return combined;
}

export async function loadLatestReport() {
  return readJson(LATEST_PATH, null);
}

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
    snapshots.push({
      month,
      MONTH: saved.report.periods.MONTH?.summary,
      FY2025: saved.report.periods.FY2025?.summary,
      YTD2026: saved.report.periods.YTD2026?.summary
    });
  }
  return { snapshots: snapshots.reverse() };
}

export function getIntegrationStatus(config) {
  return {
    stores: config.stores.map((store) => ({
      key: store.key,
      name: store.name,
      store: store.shopifyStore || null,
      configured: Boolean(store.shopifyStore && store.shopifyAccessToken)
    }))
  };
}
