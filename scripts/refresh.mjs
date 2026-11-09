import { loadEnvFile, getConfig } from '../src/config.mjs';
import { refreshAndSaveReport } from '../src/report-service.mjs';

loadEnvFile();
const config = getConfig();

try {
  const report = await refreshAndSaveReport(config);
  console.log('SKU report refreshed successfully.');
  console.log(`FY 2025 unique SKUs: ${report.periods.FY2025.summary.totalUniqueSkus}`);
  console.log(`2026 YTD unique SKUs: ${report.periods.YTD2026.summary.totalUniqueSkus}`);
  console.log(`FY 2025 Pareto SKUs: ${report.periods.FY2025.summary.top80SkuCount}`);
  console.log(`2026 YTD Pareto SKUs: ${report.periods.YTD2026.summary.top80SkuCount}`);
} catch (error) {
  console.error(`Refresh failed: ${error.message}`);
  process.exitCode = 1;
}
