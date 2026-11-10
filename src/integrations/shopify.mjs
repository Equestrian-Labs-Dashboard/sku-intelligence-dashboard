import { assertShopifyConfig } from '../config.mjs';

const ORDER_QUERY = `
  query OrdersForSkuReport($first: Int!, $after: String, $search: String!) {
    orders(first: $first, after: $after, query: $search) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        createdAt
        updatedAt
        cancelledAt
        currencyCode
        tags
        lineItems(first: 100) {
          pageInfo { hasNextPage }
          nodes {
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
                inventoryLevels(first: 1) {
                  nodes {
                    quantities(names: ["available"]) { name quantity }
                  }
                }
              }
            }
          }
        }
        refunds {
          id
          createdAt
          refundLineItems(first: 250) {
            nodes {
              quantity
              subtotalSet { shopMoney { amount currencyCode } }
              lineItem { id sku title }
            }
          }
          transactions(first: 5) { nodes { kind status } }
        }
      }
    }
  }
`;

async function shopifyGraphql(config, query, variables, attempt = 0) {
  const url = `https://${config.shopifyStore}/admin/api/${config.shopifyApiVersion}/graphql.json`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': config.shopifyAccessToken
      },
      body: JSON.stringify({ query, variables })
    });
  } catch (error) {
    throw new Error(`Could not reach Shopify: ${error.message}`);
  }

  if ((response.status === 429 || response.status >= 500) && attempt < 3) {
    const retryAfter = Number(response.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : (2 ** attempt) * 1000;
    await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 15000)));
    return shopifyGraphql(config, query, variables, attempt + 1);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Shopify API returned HTTP ${response.status}: ${JSON.stringify(body).slice(0, 700)}`);
  }
  if (Array.isArray(body.errors) && body.errors.length) {
    const message = body.errors.map((item) => item.message).join('; ');
    throw new Error(`Shopify GraphQL error: ${message}`);
  }
  if (!body.data?.orders) {
    throw new Error('Shopify returned an unexpected response. Check API permissions and API version.');
  }
  return body.data.orders;
}

async function fetchOrdersBySearch(config, search) {
  const orders = new Map();
  let after = null;
  let hasNextPage = true;

  while (hasNextPage) {
    // Small pages keep the calculated GraphQL query cost below Shopify's
    // 1,000-point single-query ceiling while preserving order pagination.
    const result = await shopifyGraphql(config, ORDER_QUERY, {
      first: 5,
      after,
      search
    });
    for (const order of result.nodes || []) {
      if (order.lineItems?.pageInfo?.hasNextPage) {
        throw new Error(`Order ${order.name || order.id} has more than 100 line items. A Shopify bulk export is required to avoid omitting SKU lines.`);
      }
      for (const refund of order.refunds || []) {
        if (refund.refundLineItems?.pageInfo?.hasNextPage) {
          throw new Error(`Order ${order.name || order.id} has more than 50 refund lines in one refund. A Shopify bulk export is required for a complete report.`);
        }
      }
      orders.set(order.id, order);
    }
    hasNextPage = Boolean(result.pageInfo?.hasNextPage);
    after = result.pageInfo?.endCursor || null;
  }

  return [...orders.values()];
}

export async function fetchShopifyOrdersForPeriod(config, period) {
  assertShopifyConfig(config);
  const createdSearch = `created_at:>=${period.startDate} created_at:<${period.endDateExclusive} status:any`;
  const updatedSearch = `updated_at:>=${period.startDate} updated_at:<${period.endDateExclusive} status:any`;

  const createdOrders = await fetchOrdersBySearch(config, createdSearch);
  const updatedOrders = await fetchOrdersBySearch(config, updatedSearch);
  const combined = new Map();
  for (const order of [...createdOrders, ...updatedOrders]) combined.set(order.id, order);
  return [...combined.values()];
}
