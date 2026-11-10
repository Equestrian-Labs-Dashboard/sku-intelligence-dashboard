import { assertShopifyConfig } from '../config.mjs';

const PAGE_SIZE = 1000;
const MAX_ROWS = 50000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastShopifyRequestAt = 0;

async function waitForShopifyRequestSlot() {
  const minimumIntervalMs = 600;
  const waitMs = minimumIntervalMs - (Date.now() - lastShopifyRequestAt);
  if (waitMs > 0) await sleep(waitMs);
  lastShopifyRequestAt = Date.now();
}

function previousDate(endDateExclusive) {
  const date = new Date(`${endDateExclusive}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function normalizeRow(row, columns = []) {
  if (Array.isArray(row)) {
    return Object.fromEntries(columns.map((column, index) => [column.name, row[index]]));
  }
  return row && typeof row === 'object' ? row : {};
}

function numeric(value) {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isThrottleResponse(response, body) {
  if (response?.status === 429) return true;
  const errors = body?.errors || [];
  return errors.some((error) => {
    const code = String(error?.extensions?.code || error?.code || '').toUpperCase();
    const message = String(error?.message || '');
    return code === 'THROTTLED' || /rate.?limit|throttl|too many requests|retry later/i.test(message);
  });
}

function throttleDelay(response, body, attempt) {
  const retryAfter = Number(response?.headers?.get?.('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(60000, Math.max(500, retryAfter * 1000));
  }

  const status = body?.extensions?.cost?.throttleStatus
    || body?.errors?.find((error) => error?.extensions?.cost?.throttleStatus)?.extensions?.cost?.throttleStatus;
  const available = Number(status?.currentlyAvailable);
  const restoreRate = Number(status?.restoreRate);
  const requested = Number(body?.extensions?.cost?.requestedQueryCost);
  if (Number.isFinite(available) && Number.isFinite(restoreRate) && restoreRate > 0) {
    const deficit = Number.isFinite(requested) && requested > 0 ? Math.max(1, requested - available) : Math.max(1, 100 - available);
    return Math.min(60000, Math.max(500, Math.ceil((deficit / restoreRate) * 1000) + 250));
  }

  // ShopifyQL can return a plain "Rate limited" GraphQL error without
  // throttleStatus. Use bounded exponential backoff rather than failing
  // immediately or retrying in a tight loop.
  return Math.min(60000, Math.max(1000, 1000 * (2 ** attempt)));
}

async function graphql(config, query, variables = {}) {
  const url = `https://${config.shopifyStore}/admin/api/${config.shopifyApiVersion}/graphql.json`;
  const maxAttempts = 8;
  let lastBody = {};
  let lastResponse = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await waitForShopifyRequestSlot();
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': config.shopifyAccessToken
      },
      body: JSON.stringify({ query, variables })
    });
    const body = await response.json().catch(() => ({}));
    lastBody = body;
    lastResponse = response;

    if (isThrottleResponse(response, body)) {
      if (attempt === maxAttempts - 1) {
        throw new Error(`Shopify GraphQL remained rate limited after ${maxAttempts} attempts for ${config.shopifyStore}. The workflow stopped without publishing partial report data. Last response: ${(body.errors || []).map((item) => item.message).join('; ') || `HTTP ${response.status}`}`);
      }
      const delay = throttleDelay(response, body, attempt);
      console.warn(`[ShopifyQL] Rate limited by ${config.shopifyStore}; retry ${attempt + 1}/${maxAttempts - 1} in ${delay} ms.`);
      await sleep(delay);
      continue;
    }

    if (response.status >= 500) {
      if (attempt === maxAttempts - 1) {
        throw new Error(`Shopify GraphQL HTTP ${response.status} after ${maxAttempts} attempts for ${config.shopifyStore}.`);
      }
      const delay = Math.min(30000, 1000 * (2 ** attempt));
      console.warn(`[ShopifyQL] Shopify server returned HTTP ${response.status}; retrying in ${delay} ms.`);
      await sleep(delay);
      continue;
    }

    const details = body.errors?.map((item) => item.message).join('; ') || JSON.stringify(body).slice(0, 500);
    if (!response.ok) {
      if (/read_reports|access denied|not authorized|protected customer data/i.test(details)) {
        throw new Error(`ShopifyQL access is unavailable for ${config.shopifyStore}. Enable the Shopify Admin API read_reports scope (and complete any Shopify protected-data approval required for ShopifyQL), reinstall/update the app, and replace that store's token in GitHub Secrets. Details: ${details}`);
      }
      throw new Error(`Shopify GraphQL HTTP ${response.status}: ${details}`);
    }
    if (body.errors?.length) {
      if (/read_reports|access denied|not authorized|protected customer data/i.test(details)) {
        throw new Error(`ShopifyQL access is unavailable for ${config.shopifyStore}. Enable the read_reports scope and update the Shopify app/token. Details: ${details}`);
      }
      throw new Error(`Shopify GraphQL error: ${details}`);
    }
    return body.data;
  }

  throw new Error(`Shopify GraphQL request failed for ${config.shopifyStore}: ${(lastBody.errors || []).map((item) => item.message).join('; ') || lastResponse?.status || 'unknown error'}`);
}

function buildQuery(period, offset) {
  const until = previousDate(period.endDateExclusive);
  return `FROM sales
SHOW gross_sales, discounts, sales_reversals, net_sales, quantity_ordered, net_items_sold, reversed_quantity, product_variant_sku, product_title
WHERE line_type = 'Product'
GROUP BY product_variant_sku, product_title
SINCE ${period.startDate} UNTIL ${until}
ORDER BY net_sales DESC, product_variant_sku ASC, product_title ASC
LIMIT ${PAGE_SIZE} OFFSET ${offset}`;
}

export async function fetchShopifySalesBySku(config, period) {
  assertShopifyConfig(config);
  const collected = [];
  let offset = 0;
  let currencyCode = null;

  while (true) {
    const queryText = buildQuery(period, offset);
    const data = await graphql(config, `
      query ShopifySkuSales($query: String!) {
        shop {
          currencyCode
        }
        shopifyqlQuery(query: $query) {
          tableData {
            columns { name dataType displayName }
            rows
          }
          parseErrors
          parseWarnings
        }
      }
    `, { query: queryText });

    currencyCode ||= data?.shop?.currencyCode || null;
    const result = data?.shopifyqlQuery;
    if (result?.parseErrors?.length) {
      throw new Error(`ShopifyQL could not run the SKU sales report for ${period.label}: ${result.parseErrors.join('; ')}. Check the ShopifyQL fields and API version.`);
    }
    if (!result?.tableData) {
      throw new Error(`ShopifyQL returned no table data for ${period.label}. The app must have read_reports access.`);
    }

    const columns = result.tableData.columns || [];
    const columnNames = new Set(columns.map((column) => String(column.name || '').trim()));
    const requiredColumns = [
      'product_variant_sku', 'product_title', 'gross_sales', 'discounts',
      'sales_reversals', 'net_sales', 'quantity_ordered',
      'net_items_sold', 'reversed_quantity'
    ];
    const missingColumns = requiredColumns.filter((name) => !columnNames.has(name));
    if (missingColumns.length) {
      throw new Error(
        `ShopifyQL returned an incomplete sales table for ${config.shopifyStore} (${period.label}). Missing columns: ${missingColumns.join(', ')}. Returned columns: ${[...columnNames].join(', ') || 'none'}. The old report has not been replaced.`
      );
    }
    const rawRows = result.tableData.rows || [];
    const rows = rawRows.map((row) => normalizeRow(row, columns));
    if (rawRows.length && !rows.some((row) => String(row.product_variant_sku ?? '').trim())) {
      throw new Error(`ShopifyQL returned ${rawRows.length} rows but no product_variant_sku values for ${config.shopifyStore} (${period.label}), even after filtering line_type = 'Product'. The result may have an unexpected ShopifyQL row shape or missing SKU dimension. The old report has not been replaced.`);
    }
    for (const row of rows) {
      const sku = String(row.product_variant_sku ?? '').trim();
      if (!sku) continue;
      const metricValues = [
        row.gross_sales, row.discounts, row.sales_reversals, row.net_sales,
        row.quantity_ordered, row.net_items_sold, row.reversed_quantity
      ];
      if (metricValues.some((value) => value === undefined || value === null || value === '')) {
        throw new Error(`ShopifyQL returned an incomplete metric row for SKU ${sku} at ${config.shopifyStore}. Required sales and quantity metrics are missing; the old report has not been replaced.`);
      }
      collected.push({
        sku,
        productTitle: String(row.product_title || '').trim() || sku,
        grossSales: numeric(row.gross_sales),
        discounts: numeric(row.discounts),
        salesReversals: numeric(row.sales_reversals),
        netSales: numeric(row.net_sales),
        quantityOrdered: numeric(row.quantity_ordered),
        netItemsSold: numeric(row.net_items_sold),
        reversedQuantity: numeric(row.reversed_quantity)
      });
    }

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    if (offset >= MAX_ROWS) {
      throw new Error(`ShopifyQL returned ${MAX_ROWS} rows for ${period.label}. Increase the MAX_ROWS safety limit only after reviewing Shopify's response-size guidance.`);
    }
  }

  return { rows: collected, currencyCode, querySource: 'ShopifyQL FROM sales' };
}
