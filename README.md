# SKU Intelligence Dashboard

A lightweight, responsive dashboard for SKU performance, Pareto 80/20 analysis, inventory prioritization, monthly reporting, and gross margin comparison with and without dropshipping.

The dashboard interface, labels, charts, exports, and documentation are written in English.

## Features

- Distinct SKU counts for **Full Year 2025** and **2026 Year to Date**.
- SKU-level sales ranking with sales share and cumulative contribution.
- Pareto analysis that counts the SKU that crosses the 80% threshold.
- Remaining SKU count outside the 80% sales group.
- Product table with units sold, net sales, gross profit, gross margin, available inventory, and an inventory action label.
- Gross margin comparison including and excluding products classified as dropshipping.
- Cost coverage indicator so missing product costs are not silently treated as zero.
- Monthly snapshots, with up to 36 months retained in `data/history.json`.
- CSV export for each reporting period.
- Responsive light and dark themes.
- Shopify Admin GraphQL integration.
- Poneva connection status and a reserved adapter for account-specific reporting integration.
- Monthly GitHub Actions workflow, plus manual refresh.
- Automated tests for SKU deduplication, Pareto threshold logic, margin comparison, refunds, and reporting periods.

## Technology

- Node.js 20 or newer.
- Native Node.js HTTP server and `fetch` API.
- HTML, CSS, and vanilla JavaScript.
- No runtime npm dependencies are required.

## Quick start

1. Install Node.js 20 or newer.
2. Clone or download this repository.
3. Copy `.env.example` to `.env`.
4. Add your Shopify credentials to `.env`.
5. Start the dashboard:

   ```bash
   npm start
   ```

6. Open `http://127.0.0.1:3000`.
7. Use **Refresh data** to retrieve live Shopify data.

If Shopify credentials are not configured, the dashboard opens in Preview Mode with fictional sample data. Sample figures are not store results.

## Environment variables

| Variable | Required | Description |
|---|---:|---|
| `SHOPIFY_STORE` | Yes for live data | Shopify `myshopify.com` domain, such as `example-store.myshopify.com`. Do not enter the admin URL or a storefront custom domain. |
| `SHOPIFY_ACCESS_TOKEN` | Yes for live data | Shopify Admin API access token. |
| `PONEVA_STORE` | Optional until Poneva API is confirmed | Poneva store identifier from the account. |
| `PONEVA_API_TOKEN` | Optional until Poneva API is confirmed | Poneva API token. |
| `SHOPIFY_API_VERSION` | No | Shopify Admin GraphQL API version. Defaults to `2026-10`. |
| `REPORT_TIMEZONE` | No | Reporting timezone. Defaults to `America/La_Paz`. |
| `DROPSHIP_TAGS` | No | Comma-separated Shopify product/order tags used to classify dropshipping. Defaults to `dropship,dropshipping`. |
| `PORT` | No | Local server port. Defaults to `3000`. |
| `HOST` | No | Server bind address. Defaults to `127.0.0.1`. |

Never commit `.env` or expose API tokens in browser code.

## Shopify permissions

Create or use a Shopify Admin API custom app with read-only access wherever possible. The integration reads:

- Orders and refunds.
- Product and variant details, tags, product type, and vendor.
- Inventory availability.
- Current inventory-item unit cost.

For the 2025 historical report, the store/app must be granted access to older orders through Shopify's `read_all_orders` permission together with `read_orders`. Shopify normally restricts order access to the latest 60 days without older-order access. Product and inventory read permissions are also required for product metadata, available quantities, and costs. The Shopify user/app must have permission to view product costs for `unitCost` to be returned.

The app does not create, edit, cancel, or refund orders.

Official references:

- [Shopify Admin GraphQL Order object](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Order)
- [Shopify Admin GraphQL InventoryItem object](https://shopify.dev/docs/api/admin-graphql/latest/objects/InventoryItem)
- [Shopify API access scopes](https://shopify.dev/docs/api/usage/access-scopes)
- [Poneva integration contract and public API surfaces](https://poneva.com/docs/integration-contract)

## Reporting definitions

### Reporting periods

- **Full Year 2025:** January 1, 2025 through December 31, 2025.
- **2026 Year to Date:** January 1, 2026 through the report cutoff date, inclusive.
- The report cutoff is calculated in `REPORT_TIMEZONE`.

### Unique SKU count

A SKU is counted once per period, regardless of how many orders or order lines contain it. A SKU is included in the unique-sold count when its net units and net product sales are positive for the period. Blank SKU values are not counted and are tracked as missing-SKU lines.

### Pareto 80/20

SKUs are sorted from highest to lowest net product sales. Sales share is each SKU's net sales divided by total positive SKU net sales. Cumulative share is calculated in rank order. The top-80 group includes the SKU that first brings cumulative sales to 80% or higher. The remaining group is total unique SKUs minus the top-80 group.

Pareto sales are based on product line sales after discounts and successful line-item refunds. Taxes and shipping are excluded.

### Gross margin

`Gross Margin = (Net Sales with known cost - Cost of Goods Sold) / Net Sales with known cost × 100`

The report calculates margin for rows with an available unit cost and separately shows cost coverage. Missing costs are not treated as zero.

**Important cost limitation:** Shopify's inventory-item `unitCost` is the current cost available when the report runs. It is not a historical cost ledger. Historical gross margin is therefore an estimate unless historical cost data is provided separately.

### Dropshipping classification

A line is classified as dropshipping when its Shopify order tags or product tags match one of the configured `DROPSHIP_TAGS`, or when a line-item property contains a dropshipping indicator. Update the tags in Shopify or the configuration to match the store's actual workflow.

The report does not infer dropshipping from a vendor name or product title.

### Inventory action labels

- **CORE STOCK:** SKU belongs to the top-80 sales group and is not classified as dropshipping.
- **DROPSHIP:** SKU is classified as dropshipping.
- **LOW PRIORITY:** SKU has positive sales but is outside the top-80 group.
- **REVIEW RETURNS:** SKU has no positive net units/net sales after period refunds.

These are decision-support labels, not automatic purchase orders or reorder quantities. Reorder thresholds and supplier lead times are not included because they have not been provided.

## Poneva integration status

The Poneva adapter is deliberately fail-safe. It reads whether `PONEVA_STORE` and `PONEVA_API_TOKEN` are configured, but it does not send requests to an unverified endpoint.

The public Poneva documentation currently describes storefront/catalog search surfaces, not a sales/orders reporting API. Before enabling live reconciliation, confirm the account-specific reporting API documentation or provide a sample Poneva export and its column definitions. The adapter can then be completed without guessing endpoint paths, authentication headers, or response fields.

## Local refresh and tests

Run automated tests:

```bash
npm test
```

Refresh both reporting periods from Shopify and save the report/history files:

```bash
npm run refresh
```

Start the dashboard:

```bash
npm start
```

The server exposes:

- `GET /api/health` — integration configuration status.
- `GET /api/report` — latest report, or demo data before the first live refresh.
- `GET /api/history` — monthly snapshots.
- `GET /api/export.csv?period=FY2025` — CSV export.
- `GET /api/export.csv?period=YTD2026` — CSV export.
- `POST /api/refresh` — refresh Shopify data and save the report.

## GitHub Actions setup

Create these four repository secrets:

| Secret name | Value |
|---|---|
| `SHOPIFY_STORE` | Shopify `myshopify.com` store domain. |
| `SHOPIFY_ACCESS_TOKEN` | Shopify Admin API access token. |
| `PONEVA_STORE` | Poneva store identifier. |
| `PONEVA_API_TOKEN` | Poneva API token. |

The workflow is located at `.github/workflows/monthly-report.yml`.

- It runs on the first day of each month at 08:00 Bolivia time (12:00 UTC).
- It can also be started manually from the **Actions** tab.
- It runs the test suite before refreshing the report.
- It updates `data/latest-report.json` and appends/replaces the current month's snapshot in `data/history.json`.
- It commits changed report files using the repository's `GITHUB_TOKEN`.

The repository must allow GitHub Actions to write repository contents: **Settings → Actions → General → Workflow permissions → Read and write permissions**.

Keep the repository private because generated report files contain business sales and margin information. Do not publish the JSON report through a public static website.

## Deployment and access control

This repository contains a Node.js server, not a GitHub Pages-only site. GitHub Actions can refresh the report files, but GitHub Actions secrets do not become runtime secrets for GitHub Pages. To serve the interactive dashboard to a client, deploy the Node.js app to a private server/hosting service and configure the same environment variables in that hosting service. Restrict access to authorized users with the hosting provider's access controls or an authenticated reverse proxy.

The local development server binds to `127.0.0.1` by default. Only change `HOST` to `0.0.0.0` when the app is behind appropriate network and access controls.

## Monthly history

The workflow stores one snapshot per calendar month. If a manual run is repeated within the same month, that month's snapshot is replaced rather than duplicated. The latest 36 snapshots are retained.

## Data validation checklist

Before using the dashboard for purchasing decisions:

1. Confirm Shopify historical order access is enabled.
2. Confirm all active products have a unique, non-empty SKU.
3. Confirm dropshipping products are tagged consistently.
4. Confirm product costs are populated and the user has permission to view them.
5. Compare total order and SKU results with Shopify's native reports.
6. Reconcile with Poneva after its reporting API/export format is confirmed.
7. Review the cutoff date and reporting timezone.

## Security notes

- Never commit `.env`, access tokens, or private exports.
- Do not place credentials in `public/` or any browser JavaScript file.
- Use a private repository and private hosting for customer/business data.
- Rotate any token that is accidentally exposed.
