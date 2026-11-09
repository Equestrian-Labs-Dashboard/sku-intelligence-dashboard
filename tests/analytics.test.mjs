import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPeriodReport } from '../src/analytics.mjs';
import { getReportPeriods } from '../src/periods.mjs';

const period = {
  key: 'FY2025',
  label: 'Full Year 2025',
  startDate: '2025-01-01',
  endDateExclusive: '2026-01-01',
  cutoffDate: '2025-12-31'
};

function line({ id, sku, title, quantity = 1, sales = 100, cost = 40, tags = [], available = 5 }) {
  return {
    id,
    sku,
    title,
    quantity,
    currentQuantity: quantity,
    discountedTotalSet: { shopMoney: { amount: String(sales), currencyCode: 'USD' } },
    discountedUnitPriceAfterAllDiscountsSet: { shopMoney: { amount: String(sales / quantity), currencyCode: 'USD' } },
    product: { title, tags, productType: 'Test', vendor: 'Vendor' },
    variant: {
      sku,
      inventoryItem: {
        id: `inventory-${sku}`,
        unitCost: cost === null ? null : { amount: String(cost), currencyCode: 'USD' },
        inventoryLevels: { nodes: [{ quantities: [{ name: 'available', quantity: available }] }] }
      }
    },
    customAttributes: []
  };
}

test('counts distinct SKUs, not order lines or units', () => {
  const orders = [
    { id: 'o1', createdAt: '2025-02-01T10:00:00Z', lineItems: { nodes: [line({ id: 'l1', sku: 'A', title: 'Product A', quantity: 3, sales: 300 })] }, refunds: [] },
    { id: 'o2', createdAt: '2025-03-01T10:00:00Z', lineItems: { nodes: [line({ id: 'l2', sku: 'A', title: 'Product A', quantity: 2, sales: 200 }), line({ id: 'l3', sku: 'B', title: 'Product B', quantity: 1, sales: 50 })] }, refunds: [] }
  ];
  const report = buildPeriodReport(orders, period);
  assert.equal(report.summary.totalUniqueSkus, 2);
  assert.equal(report.summary.totalUnitsSold, 6);
  assert.equal(report.skuRows.find((row) => row.sku === 'A').unitsSold, 5);
});

test('Pareto includes the SKU that crosses the 80 percent threshold', () => {
  const orders = [{
    id: 'o1',
    createdAt: '2025-05-01T10:00:00Z',
    lineItems: { nodes: [
      line({ id: 'l1', sku: 'A', title: 'A', quantity: 1, sales: 80, cost: 30 }),
      line({ id: 'l2', sku: 'B', title: 'B', quantity: 1, sales: 15, cost: 5 }),
      line({ id: 'l3', sku: 'C', title: 'C', quantity: 1, sales: 5, cost: 2 })
    ] },
    refunds: []
  }];
  const report = buildPeriodReport(orders, period);
  assert.equal(report.summary.totalUniqueSkus, 3);
  assert.equal(report.summary.top80SkuCount, 1);
  assert.equal(report.summary.remainingSkuCount, 2);
  assert.equal(report.skuRows[0].sku, 'A');
  assert.equal(report.skuRows[0].cumulativeShare, 80);
});

test('calculates gross margin with and without dropshipping', () => {
  const orders = [{
    id: 'o1',
    createdAt: '2025-06-01T10:00:00Z',
    tags: [],
    lineItems: { nodes: [
      line({ id: 'l1', sku: 'STOCK', title: 'Stock product', quantity: 1, sales: 100, cost: 40 }),
      line({ id: 'l2', sku: 'DROP', title: 'Dropship product', quantity: 1, sales: 100, cost: 70, tags: ['dropshipping'] })
    ] },
    refunds: []
  }];
  const report = buildPeriodReport(orders, period);
  assert.equal(report.grossMargin.withDropshipping.grossMargin, 45);
  assert.equal(report.grossMargin.withoutDropshipping.grossMargin, 60);
  assert.equal(report.grossMargin.dropshippingImpactPp, -15);
});

test('assigns a successful refund to the refund date', () => {
  const original = line({ id: 'l1', sku: 'A', title: 'Product A', quantity: 2, sales: 200, cost: 50 });
  const order = {
    id: 'o1',
    createdAt: '2024-12-20T10:00:00Z',
    lineItems: { nodes: [original] },
    refunds: [{
      createdAt: '2025-02-01T10:00:00Z',
      transactions: { nodes: [{ status: 'SUCCESS' }] },
      refundLineItems: { nodes: [{ quantity: 1, subtotalSet: { shopMoney: { amount: '100', currencyCode: 'USD' } }, lineItem: { id: 'l1', sku: 'A', title: 'Product A' } }] }
    }]
  };
  const report = buildPeriodReport([order], period);
  assert.equal(report.summary.totalUniqueSkus, 0);
  assert.equal(report.summary.netSales, -100);
});

test('builds the requested 2025 and 2026 reporting windows', () => {
  const periods = getReportPeriods(new Date('2026-11-09T15:00:00Z'), 'America/La_Paz');
  assert.equal(periods.FY2025.startDate, '2025-01-01');
  assert.equal(periods.FY2025.endDateExclusive, '2026-01-01');
  assert.equal(periods.YTD2026.startDate, '2026-01-01');
  assert.equal(periods.YTD2026.cutoffDate, '2026-11-09');
});

test('does not treat missing unit costs as zero and reports cost coverage', () => {
  const orders = [{
    id: 'o1',
    createdAt: '2025-07-01T10:00:00Z',
    lineItems: { nodes: [
      line({ id: 'l1', sku: 'KNOWN', title: 'Known cost', quantity: 1, sales: 100, cost: 40 }),
      line({ id: 'l2', sku: 'MISSING', title: 'Missing cost', quantity: 1, sales: 100, cost: null })
    ] },
    refunds: []
  }];
  const report = buildPeriodReport(orders, period);
  assert.equal(report.grossMargin.withDropshipping.grossMargin, 60);
  assert.equal(report.grossMargin.withDropshipping.costCoveragePct, 50);
});
