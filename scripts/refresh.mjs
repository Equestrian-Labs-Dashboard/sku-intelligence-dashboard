import { loadEnvFile, getConfig } from '../src/config.mjs';
import { refreshAndSaveReport } from '../src/report-service.mjs';

loadEnvFile();
const config = getConfig();

function validatePeriod(report, storeName, label) {
  if (!report || !Array.isArray(report.skuRows) || !report.summary) {
    throw new Error(`${storeName}: ${label} report is missing SKU rows or summary data.`);
  }
  const required = [
    'grossSales', 'discounts', 'salesReversals', 'netSales',
    'quantityOrdered', 'netItemsSold', 'reversedQuantity', 'totalUniqueSkus'
  ];
  const missing = required.filter((key) => !Number.isFinite(Number(report.summary[key])));
  if (missing.length) {
    throw new Error(`${storeName}: ${label} ShopifyQL report is missing required metrics: ${missing.join(', ')}. No report should be published.`);
  }
  if (report.dataQuality?.salesSource !== 'ShopifyQL FROM sales grouped by product_variant_sku and product_title.') {
    throw new Error(`${storeName}: ${label} was not generated from the expected ShopifyQL sales source. No report should be published.`);
  }
  if (report.skuRows.length && !report.skuRows.some((row) => Number(row.netSales) !== 0 || Number(row.netItemsSold) !== 0)) {
    throw new Error(`${storeName}: ${label} contains SKU rows but no non-zero net sales or item activity. Check the ShopifyQL response before publishing.`);
  }
}

try {
  const result = await refreshAndSaveReport(config);
  console.log(`SKU reports refreshed successfully for ${result.month}.`);
  for (const [key, entry] of Object.entries(result.stores)) {
    console.log(`${entry.name} (${key})`);
    console.log(`  Sales source: ${entry.report.source.primary}`);
    for (const [periodKey, label] of [['FY2025', 'Full Year 2025'], ['YTD2026', '2026 YTD'], ['MONTH', 'Current month']]) {
      const period = entry.report.periods[periodKey];
      validatePeriod(period, entry.name, label);
      const summary = period.summary;
      console.log(`  ${label}:`);
      console.log(`    Unique SKUs: ${summary.totalUniqueSkus}`);
      console.log(`    Quantity ordered: ${summary.quantityOrdered}`);
      console.log(`    Net items sold: ${summary.netItemsSold}`);
      console.log(`    Reversed quantity: ${summary.reversedQuantity}`);
      console.log(`    Gross sales: ${summary.grossSales} ${summary.currency}`);
      console.log(`    Discounts: ${summary.discounts} ${summary.currency}`);
      console.log(`    Sales reversals: ${summary.salesReversals} ${summary.currency}`);
      console.log(`    Net sales: ${summary.netSales} ${summary.currency}`);
      console.log(`    SKU rows analyzed: ${period.skuRows.length}`);
      console.log(`    Concentration Gini: ${summary.concentrationGini}`);
    }
  }
} catch (error) {
  console.error(`Refresh failed: ${error.message}`);
  process.exitCode = 1;
}
