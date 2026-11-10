import { assertShopifyConfig } from '../config.mjs';

// Shopify Bulk Operations do not allow connection fields nested inside list
// fields such as Order.refunds. Refund details are intentionally not requested
// here; see report data-quality notes so the report never implies refunds were
// included in net sales.
const BULK_QUERY = (search) => `
{
  orders(query: ${JSON.stringify(search)}, first: 250) {
    edges {
      node {
        __typename
        id
        name
        createdAt
        updatedAt
        cancelledAt
        currencyCode
        tags
        lineItems(first: 250) {
          edges {
            node {
              __typename
              id
              sku
              title
              quantity
              currentQuantity
              originalTotalSet { shopMoney { amount currencyCode } }
              totalDiscountSet { shopMoney { amount currencyCode } }
              discountedTotalSet { shopMoney { amount currencyCode } }
              discountedUnitPriceAfterAllDiscountsSet { shopMoney { amount currencyCode } }
              priceAfterAllDiscountsBeforeTaxesSet { shopMoney { amount currencyCode } }
              customAttributes { key value }
              product { id title tags productType vendor }
              variant {
                sku
                inventoryItem {
                  id
                  unitCost { amount currencyCode }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

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
    await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(1000 * (2 ** attempt), 15000)));
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Shopify API HTTP ${response.status}: ${JSON.stringify(body).slice(0, 800)}`);
  if (body.errors?.length) throw new Error(`Shopify GraphQL error: ${body.errors.map((e) => e.message).join('; ')}`);
  return body.data;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runBulkQuery(config, search) {
  const query = BULK_QUERY(search);
  const start = await graphql(config, `
    mutation StartSkuBulkQuery($query: String!) {
      bulkOperationRunQuery(query: $query) {
        bulkOperation { id status }
        userErrors { field message }
      }
    }
  `, { query });

  const result = start?.bulkOperationRunQuery;
  if (result?.userErrors?.length) {
    throw new Error(`Shopify could not start the bulk export: ${result.userErrors.map((e) => e.message).join('; ')}`);
  }
  const operationId = result?.bulkOperation?.id;
  if (!operationId) throw new Error('Shopify did not return a bulk operation ID.');

  const startedAt = Date.now();
  let operation;
  while (Date.now() - startedAt < 40 * 60 * 1000) {
    const poll = await graphql(config, `
      query CheckSkuBulkQuery($id: ID!) {
        node(id: $id) {
          ... on BulkOperation {
            id
            status
            errorCode
            url
            objectCount
          }
        }
      }
    `, { id: operationId });
    operation = poll?.node;
    if (!operation) throw new Error(`Shopify bulk operation ${operationId} could not be found.`);
    if (operation.status === 'COMPLETED') break;
    if (['FAILED', 'CANCELED', 'EXPIRED'].includes(operation.status)) {
      throw new Error(`Shopify bulk export ${operation.status.toLowerCase()}: ${operation.errorCode || 'no error code returned'}`);
    }
    await sleep(2000);
  }

  if (operation?.status !== 'COMPLETED') throw new Error('Shopify bulk export timed out after 40 minutes.');
  if (!operation.url) return [];
  const download = await fetch(operation.url);
  if (!download.ok) throw new Error(`Could not download Shopify bulk export (HTTP ${download.status}).`);
  const jsonl = await download.text();
  return jsonl.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function reconstructOrders(records) {
  const objects = new Map();
  const roots = [];
  for (const record of records) {
    const clean = { ...record };
    delete clean.__parentId;
    if (clean.__typename === 'Order') {
      clean.lineItems = { nodes: [] };
      objects.set(clean.id, clean);
      roots.push(clean);
    } else if (clean.__typename === 'LineItem') {
      const parent = objects.get(record.__parentId);
      if (parent) parent.lineItems.nodes.push(clean);
      objects.set(clean.id, clean);
    }
  }
  return roots;
}

async function fetchOrdersBySearch(config, search) {
  const records = await runBulkQuery(config, search);
  return reconstructOrders(records);
}

export async function fetchShopifyOrdersForPeriod(config, period) {
  assertShopifyConfig(config);
  const createdSearch = `created_at:>=${period.startDate} created_at:<${period.endDateExclusive} status:any`;
  const updatedSearch = `updated_at:>=${period.startDate} updated_at:<${period.endDateExclusive} status:any`;
  // Shopify permits only one active bulk query per shop at a time.
  // Run these exports sequentially rather than concurrently.
  const createdOrders = await fetchOrdersBySearch(config, createdSearch);
  const updatedOrders = await fetchOrdersBySearch(config, updatedSearch);
  const combined = new Map();
  for (const order of [...createdOrders, ...updatedOrders]) combined.set(order.id, order);
  return [...combined.values()];
}
