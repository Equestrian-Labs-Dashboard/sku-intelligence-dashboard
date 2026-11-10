import { assertShopifyConfig } from '../config.mjs';

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
        refunds {
          __typename
          id
          createdAt
          refundLineItems(first: 250) {
            edges {
              node {
                __typename
                quantity
                subtotalSet { shopMoney { amount currencyCode } }
                lineItem { id sku title }
              }
            }
          }
          transactions(first: 20) { edges { node { kind status } } }
        }
      }
    }
  }
}`;

async function graphql(config, query, variables = {}) {
  const url = `https://${config.shopifyStore}/admin/api/${config.shopifyApiVersion}/graphql.json`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': config.shopifyAccessToken
    },
    body: JSON.stringify({ query, variables })
  });
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
      clean.refunds = [];
      objects.set(clean.id, clean);
      roots.push(clean);
    } else if (clean.__typename === 'LineItem') {
      const parent = objects.get(record.__parentId);
      if (parent) parent.lineItems.nodes.push(clean);
      objects.set(clean.id, clean);
    } else if (clean.__typename === 'Refund') {
      clean.refundLineItems = { nodes: [] };
      clean.transactions = { nodes: clean.transactions?.edges?.map((e) => e.node) || clean.transactions?.nodes || [] };
      const parent = objects.get(record.__parentId);
      if (parent) parent.refunds.push(clean);
      objects.set(clean.id, clean);
    } else if (clean.__typename === 'RefundLineItem') {
      const parent = objects.get(record.__parentId);
      if (parent) parent.refundLineItems.nodes.push(clean);
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
