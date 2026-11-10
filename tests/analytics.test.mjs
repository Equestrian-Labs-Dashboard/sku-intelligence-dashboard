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

function metadataLine({ sku, title = sku, cost = 10, tags = [] }) {
  return {
    sku,
    title,
    product: { title, tags, productType: 'Test category', vendor: 'Test vendor' },
    variant: { sku, inventoryItem: { unitCost: cost === null ? null : { amount: String(cost) } } },
    customAttributes: []
  };
}

function metadataOrder(lines, tags = []) {
  return { id: 'order-1', tags, lineItems: { nodes: lines } };
}

function salesRow({
  sku, title = sku, grossSales = 100, discounts = -10, salesReversals = -5,
  netSales = grossSales + discounts + salesReversals,
  quantityOrdered = 2, netItemsSold = 1, reversedQuantity = -1
}) {
  return { sku, productTitle: title, grossSales, discounts, salesReversals, netSales, quantityOrdered, netItemsSold, reversedQuantity };
}

test('uses ShopifyQL sales metrics without multiplying line totals by quantity', () => {
  const sales = [salesRow({
    sku: '80308-906',
    title: 'GASTROGARD',
    grossSales: 22264.76,
    discounts: -2026.15,
    salesReversals: -812.20,
    netSales: 19426.41,
    quantityOrdered: 524,
    netItemsSold: 504,
    reversedQuantity: -20
  })];
  const metadata = [metadataOrder([metadataLine({ sku: '80308-906', title: 'GASTROGARD', cost: 1 })])];
  const report = buildPeriodReport(sales, metadata, period, { currencyCode: 'USD' });
  const row = report.skuRows[0];
  assert.equal(row.sku, '80308-906');
  assert.equal(row.grossSales, 22264.76);
  assert.equal(row.discounts, -2026.15);
  assert.equal(row.salesReversals, -812.2);
  assert.equal(row.netSales, 19426.41);
  assert.equal(row.quantityOrdered, 524);
  assert.equal(row.netItemsSold, 504);
  assert.equal(row.reversedQuantity, -20);
  assert.equal(report.summary.totalUniqueSkus, 1);
  assert.equal(report.summary.netItemsSold, 504);
});

test('counts distinct SKUs, not units, orders or duplicate title rows', () => {
  const sales = [
    salesRow({ sku: 'A', title: 'Old title', grossSales: 100, discounts: 0, salesReversals: 0, netSales: 100, quantityOrdered: 3, netItemsSold: 3, reversedQuantity: 0 }),
    salesRow({ sku: 'A', title: 'New title', grossSales: 50, discounts: 0, salesReversals: 0, netSales: 50, quantityOrdered: 2, netItemsSold: 2, reversedQuantity: 0 }),
    salesRow({ sku: 'B', grossSales: 25, discounts: 0, salesReversals: 0, netSales: 25, quantityOrdered: 1, netItemsSold: 1, reversedQuantity: 0 })
  ];
  const report = buildPeriodReport(sales, [], period);
  assert.equal(report.summary.totalUniqueSkus, 2);
  assert.equal(report.summary.quantityOrdered, 6);
  assert.equal(report.summary.netItemsSold, 6);
  assert.equal(report.skuRows.find((row) => row.sku === 'A').netSales, 150);
});

test('includes the complete SKU catalog and does not apply a Top 10 or fixed Pareto cutoff', () => {
  const sales = Array.from({ length: 35 }, (_, index) => salesRow({
    sku: `SKU-${String(index + 1).padStart(3, '0')}`,
    grossSales: 100 - index,
    discounts: 0,
    salesReversals: 0,
    netSales: 100 - index,
    quantityOrdered: 1,
    netItemsSold: 1,
    reversedQuantity: 0
  }));
  const report = buildPeriodReport(sales, [], period);
  assert.equal(report.skuRows.length, 35);
  assert.equal(report.summary.totalUniqueSkus, 35);
  assert.equal(report.skuRows[34].sku, 'SKU-035');
  assert.equal(report.skuRows[34].rank, 35);
  assert.ok(report.skuRows[34].cumulativeShare > 99);
  assert.equal(report.summary.top80SkuCount, undefined);
});

test('uses configured tags to identify dropshipping and compares margins', () => {
  const sales = [
    salesRow({ sku: 'STOCK', grossSales: 100, discounts: 0, salesReversals: 0, netSales: 100, quantityOrdered: 1, netItemsSold: 1, reversedQuantity: 0 }),
    salesRow({ sku: 'DROP', grossSales: 100, discounts: 0, salesReversals: 0, netSales: 100, quantityOrdered: 1, netItemsSold: 1, reversedQuantity: 0 })
  ];
  const metadata = [metadataOrder([
    metadataLine({ sku: 'STOCK', cost: 40 }),
    metadataLine({ sku: 'DROP', cost: 70, tags: ['dropshipping'] })
  ])];
  const report = buildPeriodReport(sales, metadata, period);
  assert.equal(report.skuRows.find((row) => row.sku === 'DROP').action, 'DROPSHIP');
  assert.equal(report.grossMargin.withDropshipping.grossMargin, 45);
  assert.equal(report.grossMargin.withoutDropshipping.grossMargin, 60);
  assert.equal(report.grossMargin.dropshippingImpactPp, -15);
});

test('does not report missing inventory as zero', () => {
  const report = buildPeriodReport([salesRow({ sku: 'A' })], [], period);
  assert.equal(report.skuRows[0].inventoryAvailable, null);
  assert.match(report.dataQuality.inventoryBasis, /not currently synchronized/i);
});

test('reports cost coverage when current unit cost is missing', () => {
  const sales = [
    salesRow({ sku: 'KNOWN', grossSales: 100, discounts: 0, salesReversals: 0, netSales: 100, quantityOrdered: 1, netItemsSold: 1, reversedQuantity: 0 }),
    salesRow({ sku: 'MISSING', grossSales: 100, discounts: 0, salesReversals: 0, netSales: 100, quantityOrdered: 1, netItemsSold: 1, reversedQuantity: 0 })
  ];
  const metadata = [metadataOrder([
    metadataLine({ sku: 'KNOWN', cost: 40 }),
    metadataLine({ sku: 'MISSING', cost: null })
  ])];
  const report = buildPeriodReport(sales, metadata, period);
  assert.equal(report.grossMargin.withDropshipping.costCoveragePct, 50);
  assert.equal(report.grossMargin.withDropshipping.grossMargin, 60);
});

test('builds the requested 2025 and 2026 reporting windows', () => {
  const periods = getReportPeriods(new Date('2026-11-09T15:00:00Z'), 'America/La_Paz');
  assert.equal(periods.FY2025.startDate, '2025-01-01');
  assert.equal(periods.FY2025.endDateExclusive, '2026-01-01');
  assert.equal(periods.YTD2026.startDate, '2026-01-01');
  assert.equal(periods.YTD2026.cutoffDate, '2026-11-09');
});


test('keeps blank-SKU product sales in financial totals without counting them as a SKU', async () => {
  const sales = [
    salesRow({
      sku: 'SKU-1',
      grossSales: 100,
      discounts: -10,
      salesReversals: -5,
      netSales: 85,
      quantityOrdered: 2,
      netItemsSold: 1,
      reversedQuantity: -1
    })
  ];
  const report = buildPeriodReport(sales, [], period, {
    unassignedSales: {
      rowCount: 1,
      grossSales: 50,
      discounts: -5,
      salesReversals: -2,
      netSales: 43,
      quantityOrdered: 1,
      netItemsSold: 1,
      reversedQuantity: 0
    }
  });
  assert.equal(report.summary.totalUniqueSkus, 1);
  assert.equal(report.skuRows.length, 1);
  assert.equal(report.summary.grossSales, 150);
  assert.equal(report.summary.discounts, -15);
  assert.equal(report.summary.salesReversals, -7);
  assert.equal(report.summary.netSales, 128);
  assert.equal(report.summary.quantityOrdered, 3);
  assert.equal(report.summary.netItemsSold, 2);
  assert.equal(report.summary.unassignedSkuSales.netSales, 43);
  assert.match(report.dataQuality.unassignedSkuBasis, /blank product_variant_sku/i);
});
