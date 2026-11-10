import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { loadEnvFile, getConfig } from './config.mjs';
import { getIntegrationStatus, loadHistory, loadLatestReport, loadStoreMonth, listAvailableMonths, refreshAndSaveReport } from './report-service.mjs';

loadEnvFile();
const config = getConfig();
const publicDir = resolve(process.cwd(), 'public');
const demoPath = resolve(process.cwd(), 'data', 'demo-report.json');
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(data));
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function reportToCsv(periodReport) {
  const columns = [
    'Rank', 'SKU', 'Product', 'Category', 'Vendor', 'Units Sold', 'Net Sales',
    'Sales Share (%)', 'Cumulative Share (%)', 'Gross Profit', 'Gross Margin (%)',
    'Available Inventory', 'Dropshipping', 'Inventory Action'
  ];
  const rows = (periodReport?.skuRows || []).map((row) => [
    row.rank ?? '', row.sku, row.productTitle, row.category, row.vendor, row.unitsSold,
    row.netSales, row.salesShare, row.cumulativeShare, row.grossProfit,
    row.grossMargin ?? '', row.inventoryAvailable, row.isDropship ? 'Yes' : 'No', row.action
  ]);
  return [columns, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

async function serveStatic(pathname, response) {
  const requested = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const filePath = resolve(publicDir, `.${requested}`);
  if (!filePath.startsWith(`${publicDir}${sep}`) && filePath !== publicDir) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error('Not a file');
    const body = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cache-Control': 'no-cache'
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    if (request.method === 'GET' && pathname === '/api/health') {
      sendJson(response, 200, {
        status: 'ok',
        generatedAt: new Date().toISOString(),
        integrations: getIntegrationStatus(config)
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/report') {
      const latest = await loadLatestReport();
      const storeKey = url.searchParams.get('store') || 'equestrian';
      const month = url.searchParams.get('month') || latest?.month;
      if (latest?.month === month && latest?.stores?.[storeKey]?.report) { sendJson(response, 200, latest.stores[storeKey].report); return; }
      const archived = month ? await loadStoreMonth(storeKey, month) : null;
      if (archived?.report) { sendJson(response, 200, archived.report); return; }
      if (latest?.stores?.[storeKey]?.report) { sendJson(response, 200, latest.stores[storeKey].report); return; }
      const demo = JSON.parse(await readFile(demoPath, 'utf8'));
      sendJson(response, 200, demo);
      return;
    }

    if (request.method === 'GET' && pathname === '/api/months') {
      const storeKey = url.searchParams.get('store') || 'equestrian';
      sendJson(response, 200, { months: await listAvailableMonths(storeKey) });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/history') {
      const storeKey = url.searchParams.get('store') || 'equestrian';
      sendJson(response, 200, await loadHistory(storeKey));
      return;
    }

    if (request.method === 'GET' && pathname === '/api/export.csv') {
      const periodKey = url.searchParams.get('period') || 'YTD2026';
      const storeKey = url.searchParams.get('store') || 'equestrian';
      const month = url.searchParams.get('month');
      if (!['FY2025', 'YTD2026', 'MONTH'].includes(periodKey)) {
        sendJson(response, 400, { error: 'Invalid period. Use FY2025 or YTD2026.' });
        return;
      }
      const archived = month ? await loadStoreMonth(storeKey, month) : null;
      const latest = await loadLatestReport();
      const report = archived?.report || latest?.stores?.[storeKey]?.report || JSON.parse(await readFile(demoPath, 'utf8'));
      const csv = reportToCsv(report.periods?.[periodKey]);
      response.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="sku-report-${periodKey.toLowerCase()}.csv"`,
        'Cache-Control': 'no-store'
      });
      response.end(`\uFEFF${csv}`);
      return;
    }

    if (request.method === 'POST' && pathname === '/api/refresh') {
      if (config.stores.some((store) => !store.shopifyStore || !store.shopifyAccessToken)) {
        sendJson(response, 400, { error: 'Both Shopify stores must be configured. Check the four store-specific credentials.' });
        return;
      }
      const report = await refreshAndSaveReport(config);
      sendJson(response, 200, { message: 'Report refreshed successfully.', generatedAt: report.generatedAt, report });
      return;
    }

    if (request.method === 'GET') {
      await serveStatic(pathname, response);
      return;
    }

    sendJson(response, 405, { error: 'Method not allowed.' });
  } catch (error) {
    sendJson(response, 500, { error: error.message || 'Unexpected server error.' });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`SKU Intelligence Dashboard running at http://${config.host}:${config.port}`);
  console.log(`Shopify stores configured: ${config.stores.filter((store) => store.shopifyStore && store.shopifyAccessToken).length}/2`);
});
