import { assertShopifyConfig } from '../config.mjs';

const PAGE_SIZE = 1000;
const MAX_ROWS = 50000;

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

async function graphql(config, query, variables = {}) {
  const url = `https://${config.shopifyStore}/admin/api/${config.shopifyApiVersion}/graphql.json`;
  let response;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': config.shopifyAccessToken
      },
      body: JSON.stringify({ query, variables })
    });
    if (response.status !== 429 && response.status < 500) break;
    const retryAfter = Number(response.headers.get('retry-after'));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(1000 * (2 ** attempt), 15000);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = body.errors?.map((item) => item.message).join('; ') || JSON.stringify(body).slice(0, 500);
    if (/read_reports|access denied|not authorized|protected customer data/i.test(details)) {
      throw new Error(`ShopifyQL access is unavailable for ${config.shopifyStore}. Enable the Shopify Admin API read_reports scope (and complete any Shopify protected-data approval required for ShopifyQL), reinstall/update the app, and replace that store's token in GitHub Secrets. Details: ${details}`);
    }
    throw new Error(`Shopify GraphQL HTTP ${response.status}: ${details}`);
  }
  if (body.errors?.length) {
    const details = body.errors.map((item) => item.message).join('; ');
    if (/read_reports|access denied|not authorized|protected customer data/i.test(details)) {
      throw new Error(`ShopifyQL access is unavailable for ${config.shopifyStore}. Enable the read_reports scope and update the Shopify app/token. Details: ${details}`);
    }
    throw new Error(`Shopify GraphQL error: ${details}`);
  }
  return body.data;
}

function buildQuery(period, offset) {
  const until = previousDate(period.endDateExclusive);
  return `FROM sales
SHOW gross_sales, discounts, sales_reversals, net_sales, quantity_ordered, net_items_sold, reversed_quantity, product_variant_sku, product_title
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
      throw new Error(`ShopifyQL returned ${rawRows.length} rows but no product_variant_sku values for ${config.shopifyStore} (${period.label}). The old report has not been replaced.`);
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
