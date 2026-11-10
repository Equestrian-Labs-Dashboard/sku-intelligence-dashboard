# SKU Intelligence Dashboard

A private, English-language SKU analytics dashboard for two independent Shopify stores: **Equestrian Labs** and **Cavali**. It supports FY 2025, 2026 YTD, the selected calendar month, Pareto 80/20, gross margin with/without dropshipping, inventory prioritization, CSV export and monthly JSON archives.

## 1. GitHub repository setup

1. Create a **Private** repository named `sku-intelligence-dashboard`.
2. Upload the contents of this project to the repository root (including the hidden `.github` directory).
3. Open **Settings → Secrets and variables → Actions → New repository secret**.
4. Create exactly these four repository secrets:

| Secret name | Value |
|---|---|
| `EQUESTRIAN_SHOPIFY_STORE` | `equestrian-labs.myshopify.com` |
| `EQUESTRIAN_SHOPIFY_TOKEN` | Admin API token for Equestrian Labs |
| `CAVALI_SHOPIFY_STORE` | `cavali-club.myshopify.com` |
| `CAVALI_SHOPIFY_TOKEN` | Admin API token for Cavali |

Do not include `https://` in the store domain. Never put tokens in source files, commits, screenshots or chat messages.

5. Open **Settings → Actions → General → Workflow permissions** and select **Read and write permissions**. Save.
6. Open the **Actions** tab. Select **Monthly SKU Intelligence Report**, then **Run workflow** to perform the first refresh. The workflow validates both connections, runs tests, downloads both stores and commits the JSON archives.

## 2. Automated monthly refresh

`.github/workflows/monthly-report.yml` runs on the first day of each month at 08:00 in Bolivia (`12:00 UTC`). GitHub may start scheduled workflows a little later during periods of high load. You can also run it manually from **Actions → Monthly SKU Intelligence Report → Run workflow**.

## 3. Monthly and annual JSON storage

Each store is archived separately. Example:

```text
data/
  latest-report.json
  archive/
    equestrian/
      2026/
        2026-11.json
        2026-12.json
    cavali/
      2026/
        2026-11.json
        2026-12.json
```

Each monthly JSON contains the complete SKU-level analysis for that month plus compact FY 2025 and 2026 YTD KPI/margin summaries. The latest full report is kept in `data/latest-report.json`; historical month files avoid duplicating all annual SKU rows. The dashboard month selector loads the selected store/month archive. This keeps the archive compact and avoids separate CSV or spreadsheet files. Monthly snapshots are retained in Git history; do not delete `data/archive/` if you need the historical trend.

## 4. Shopify permissions

Create a Shopify Admin API custom app for each store and grant the required read permissions, including orders, products, inventory and inventory item costs where available. For orders older than the default 60-day window, the app needs Shopify's approved `read_all_orders` access in addition to `read_orders`. If Shopify has not approved historical-order access, the FY 2025 report will be incomplete and the workflow may return an API permission error.

The integration uses Shopify Admin GraphQL API. Set `SHOPIFY_API_VERSION` in the workflow to a supported version if Shopify changes the version in use.

## 5. Run locally

Requires Node.js 20 or newer.

```bash
cp .env.example .env
# Fill in the four store credentials in .env
npm ci
npm test
npm run refresh
npm start
```

Open `http://127.0.0.1:3000`. On Windows, `start-dashboard.bat` starts the local server after dependencies are installed.

## 6. Dashboard controls

- **Store:** switch between Equestrian Labs and Cavali.
- **Month archive:** select a saved `YYYY-MM` snapshot; Latest available selects the newest archive.
- **Reporting period:** Selected Month, 2026 Year to Date or Full Year 2025.
- **Refresh data:** refreshes both stores and writes the current month's JSON archive.
- **Export CSV:** exports the selected store, month and reporting period.

## 7. Calculation notes

- Unique SKU means distinct non-empty SKU values with positive net units and sales; order repetition does not increase the count.
- Pareto ranks SKUs by net product sales after discounts and refunds. The top group is the minimum number of ranked SKUs whose cumulative share reaches or exceeds 80%.
- Gross margin is `(Net Sales - COGS) / Net Sales × 100`.
- Current Shopify unit cost is used where available. Shopify's current unit cost is not a historical cost ledger, so historical margin is an estimate unless historical costs are separately supplied.
- Dropshipping classification uses configured tags (`DROPSHIP_TAGS`) and matching line-item properties. Confirm that the store's product/order tagging convention is consistent.
- Inventory recommendations are decision support, not automatic purchase orders.

## 8. Deployment and data privacy

GitHub Actions refreshes and stores the JSON files in the private repository. It does **not** host the interactive Node.js dashboard. To give a client a live browser URL, deploy the Node.js app to a private server/hosting service and configure the same four environment variables there. Do not publish private commercial reports through public GitHub Pages.

## 9. Poneva

This version connects the two Shopify stores directly. Poneva is not configured as a sales source because its account-specific reporting API contract has not been verified. Do not add guessed Poneva endpoints or credentials to this workflow.

## Shopify query-cost protection

The Shopify connector uses smaller order pages (5 orders per request), up to 100 line items per order, and bounded refund/inventory subqueries to reduce GraphQL query cost below Shopify's 1,000-point single-query ceiling. If an order exceeds a nested line-item limit, refresh stops with a clear error rather than silently creating an incomplete SKU report. Unusually large orders require a Shopify GraphQL bulk export.

## Large Shopify order exports

The Shopify connector uses GraphQL Bulk Operations for order retrieval. This avoids the 1,000-point single-query ceiling and supports orders with more than 100 line items. The workflow waits for Shopify to finish each export, downloads the JSONL result, and reconstructs orders and line items before running the SKU analysis. The Shopify custom app must have the required order, product, and inventory-item read scopes; historical orders also require Shopify approval for `read_all_orders`.

## Refund-data limitation

The current Shopify Bulk export retrieves orders and all order line items. Shopify rejects refund-line-item connections nested inside the `Order.refunds` list in this bulk-query shape. Therefore, refund line items are currently excluded, and each report explicitly marks `refundsIncluded: false` and states that sales/Pareto are pre-refund. Do not use these pre-refund figures as final net sales until a separate refund-ingestion workflow is implemented.

## Refund ingestion compatibility

Bulk Operations retrieves orders, line items, and refund identifiers. To comply with Shopify's restriction against connection fields nested inside list fields in Bulk queries, refund line-item details are fetched separately only for orders that contain refunds. This preserves refund-aware net sales without putting `refundLineItems` inside the bulk export query.
