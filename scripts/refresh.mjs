import { loadEnvFile, getConfig } from '../src/config.mjs';
import { refreshAndSaveReport } from '../src/report-service.mjs';

loadEnvFile();
const config = getConfig();
try {
  const result = await refreshAndSaveReport(config);
  console.log(`SKU reports refreshed successfully for ${result.month}.`);
  for (const [key, entry] of Object.entries(result.stores)) {
    console.log(`${entry.name} (${key})`);
    console.log(`  FY 2025 unique SKUs: ${entry.report.periods.FY2025.summary.totalUniqueSkus}`);
    console.log(`  2026 YTD unique SKUs: ${entry.report.periods.YTD2026.summary.totalUniqueSkus}`);
    console.log(`  Current month unique SKUs: ${entry.report.periods.MONTH.summary.totalUniqueSkus}`);
    console.log(`  FY 2025 Pareto SKUs: ${entry.report.periods.FY2025.summary.top80SkuCount}`);
    console.log(`  2026 YTD Pareto SKUs: ${entry.report.periods.YTD2026.summary.top80SkuCount}`);
  }
} catch (error) {
  console.error(`Refresh failed: ${error.message}`);
  process.exitCode = 1;
}
