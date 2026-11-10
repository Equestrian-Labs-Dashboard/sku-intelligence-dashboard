import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchShopifySalesBySku } from '../src/integrations/shopifyql.mjs';

const config = {
  shopifyStore: 'example.myshopify.com',
  shopifyAccessToken: 'test-token',
  shopifyApiVersion: '2026-10'
};
const period = {
  label: 'Full Year 2025',
  startDate: '2025-01-01',
  endDateExclusive: '2026-01-01'
};

test('queries ShopifyQL for the full SKU sales bridge and paginates beyond 1,000 rows', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body.variables.query);
    const offset = Number(body.variables.query.match(/OFFSET\s+(\d+)/i)?.[1] || 0);
    const rows = offset === 0
      ? Array.from({ length: 1000 }, (_, index) => ({
          product_variant_sku: `SKU-${index}`,
          product_title: `Product ${index}`,
          gross_sales: '100',
          discounts: '-10',
          sales_reversals: '-5',
          net_sales: '85',
          quantity_ordered: 2,
          net_items_sold: 1,
          reversed_quantity: -1
        }))
      : [{
          product_variant_sku: 'SKU-LAST',
          product_title: 'Last product',
          gross_sales: '50',
          discounts: '-5',
          sales_reversals: '-2',
          net_sales: '43',
          quantity_ordered: 1,
          net_items_sold: 1,
          reversed_quantity: 0
        }];
    return new Response(JSON.stringify({
      data: {
        shop: { currencyCode: 'USD' },
        shopifyqlQuery: {
          tableData: {
            columns: [
              'gross_sales', 'discounts', 'sales_reversals', 'net_sales',
              'quantity_ordered', 'net_items_sold', 'reversed_quantity',
              'product_variant_sku', 'product_title'
            ].map((name) => ({ name, dataType: 'STRING', displayName: name })),
            rows
          },
          parseErrors: [],
          parseWarnings: []
        }
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await fetchShopifySalesBySku(config, period);
    assert.equal(result.rows.length, 1001);
    assert.equal(result.currencyCode, 'USD');
    assert.equal(requests.length, 2);
    assert.match(requests[0], /FROM sales/);
    assert.match(requests[0], /WHERE line_type = 'Product'/);
    assert.match(requests[0], /product_variant_sku/);
    assert.match(requests[0], /gross_sales, discounts, sales_reversals, net_sales/);
    assert.match(requests[0], /quantity_ordered, net_items_sold, reversed_quantity/);
    assert.match(requests[1], /OFFSET 1000/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('returns a clear message when ShopifyQL access is missing', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    errors: [{ message: 'Access denied for shopifyqlQuery field. Required access: read_reports access scope.' }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    await assert.rejects(
      () => fetchShopifySalesBySku(config, period),
      /Enable the read_reports scope/i
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('rejects incomplete ShopifyQL columns rather than silently publishing zero metrics', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: {
      shop: { currencyCode: 'USD' },
      shopifyqlQuery: {
        tableData: {
          columns: [{ name: 'product_variant_sku' }, { name: 'net_sales' }],
          rows: [{ product_variant_sku: 'SKU-1', net_sales: '100' }]
        },
        parseErrors: []
      }
    }
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    await assert.rejects(
      () => fetchShopifySalesBySku(config, period),
      /Missing columns:.*gross_sales.*discounts.*sales_reversals/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('retries ShopifyQL GraphQL rate-limit errors returned with HTTP 200', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({
        errors: [{ message: 'Rate limited. Please retry later.' }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      data: {
        shop: { currencyCode: 'USD' },
        shopifyqlQuery: {
          tableData: {
            columns: [
              'gross_sales', 'discounts', 'sales_reversals', 'net_sales',
              'quantity_ordered', 'net_items_sold', 'reversed_quantity',
              'product_variant_sku', 'product_title'
            ].map((name) => ({ name, dataType: 'STRING', displayName: name })),
            rows: [{
              gross_sales: '100',
              discounts: '-10',
              sales_reversals: '-5',
              net_sales: '85',
              quantity_ordered: 2,
              net_items_sold: 1,
              reversed_quantity: -1,
              product_variant_sku: 'SKU-RETRY',
              product_title: 'Retry product'
            }]
          },
          parseErrors: []
        }
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await fetchShopifySalesBySku(config, period);
    assert.equal(calls, 2);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].sku, 'SKU-RETRY');
    assert.equal(result.rows[0].netSales, 85);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('retries GraphQL THROTTLED responses using throttle restore information', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({
        errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
        extensions: { cost: { requestedQueryCost: 10, throttleStatus: { currentlyAvailable: 0, restoreRate: 1000 } } }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      data: {
        shop: { currencyCode: 'USD' },
        shopifyqlQuery: {
          tableData: {
            columns: [
              'gross_sales', 'discounts', 'sales_reversals', 'net_sales',
              'quantity_ordered', 'net_items_sold', 'reversed_quantity',
              'product_variant_sku', 'product_title'
            ].map((name) => ({ name, dataType: 'STRING', displayName: name })),
            rows: []
          },
          parseErrors: []
        }
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await fetchShopifySalesBySku(config, period);
    assert.equal(calls, 2);
    assert.equal(result.rows.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
