# SKU Intelligence Dashboard

Private English-language sales and inventory analytics for two Shopify stores: **Corro** (`equestrian-labs.myshopify.com`) and **Cavali** (`cavali-club.myshopify.com`).

The report is designed for decisions about SKU breadth, sales contribution, stock prioritization, dropshipping and gross margin. It analyzes the full SKU result set. It does **not** impose a fixed 80/20 distribution or limit the report to a Top 10.

## Reporting periods

- Full Year 2025.
- 2026 Year to Date.
- Every available calendar month in 2025 and 2026.
- The month selector loads the complete saved monthly SKU report for the selected store.

## Data sources and calculation method

### ShopifyQL is the sales source of truth

Sales metrics are queried directly from ShopifyQL using `FROM sales`, grouped by `product_variant_sku` and `product_title`. The query retrieves and paginates the complete SKU result set using `LIMIT 1000 OFFSET n`.

The report uses these ShopifyQL metrics without reconstructing them from order-line totals:

- `gross_sales`
- `discounts`
- `sales_reversals`
- `net_sales`
- `quantity_ordered`
- `net_items_sold`
- `reversed_quantity`

This prevents a line total from being multiplied by quantity and preserves Shopify's own treatment of refunds, returns, cancellations and order edits.

### SKU and quantity definitions

- **Unique SKUs sold:** distinct non-empty variant SKU codes with ordered or net item activity. The same SKU appearing on multiple orders is counted once.
- **Quantity ordered:** original item quantity before reversals.
- **Net items sold:** item quantity after reversals.
- **Reversed quantity:** quantity removed from orders through refunds, returns, cancellations or edits. Shopify may return this as a negative value.
- **Sales reversals:** value removed from sales through refunds, returns, cancellations or edits.
- **Net sales:** ShopifyQL product sales after discounts and sales reversals, excluding taxes, shipping, duties and fees.

A product-level Shopify report can combine multiple variants. Compare the same store, date range, filters and `product_variant_sku` dimension when validating against ShopifyQL.

### Sales concentration

All SKU rows are ranked by actual net sales. The cumulative sales-share curve uses the complete catalog. No fixed 80/20 assumption, Top 10 cutoff or other arbitrary SKU limit is applied. The Gini concentration index is included as a summary of how evenly sales are distributed across SKUs.

### Gross margin and dropshipping

Gross margin is calculated using Shopify's current unit cost where available, multiplied by net items sold. Historical unit costs are not reconstructed, so historical gross margin is an estimate if costs have changed. Cost coverage is displayed to show how much net sales has a known cost.

Dropshipping classification uses the configured `DROPSHIP_TAGS` (`dropship,dropshipping`) on order/product tags and matching line-item attributes. Confirm that both stores use consistent tags.

### Inventory availability

Inventory availability is currently **not synchronized**. The dashboard displays `Not synced` rather than presenting missing inventory data as zero. Product cost and descriptive metadata are enriched from Shopify Admin GraphQL Bulk Operations.

## GitHub setup

The existing four GitHub Actions secrets remain unchanged:

| Secret name | Value |
|---|---|
| `EQUESTRIAN_SHOPIFY_STORE` | `equestrian-labs.myshopify.com` |
| `EQUESTRIAN_SHOPIFY_TOKEN` | Admin API token for Corro |
| `CAVALI_SHOPIFY_STORE` | `cavali-club.myshopify.com` |
| `CAVALI_SHOPIFY_TOKEN` | Admin API token for Cavali |

Do not add tokens to source files, commits, screenshots or chat messages.

Set **Settings → Actions → General → Workflow permissions → Read and write permissions** so the workflow can commit JSON archives and Cloudflare Pages data assets.

## Shopify permissions required

Both Shopify custom apps need the scopes used by this workflow:

- `read_reports` — required for ShopifyQL `shopifyqlQuery`.
- `read_orders` and Shopify-approved `read_all_orders` — required to retrieve historical order metadata older than the default 60-day window.
- `read_products` — required for product metadata.
- Appropriate inventory-item read access for current unit cost fields, where available.

Shopify's current GraphQL Admin API documentation for `shopifyqlQuery` also lists protected customer data approval requirements. If Shopify denies `shopifyqlQuery`, update the app scopes/approvals in Shopify, reinstall or update the app, and replace that store's existing GitHub Secret with the newly issued token. No additional GitHub or Cloudflare secret names are introduced.

## Monthly GitHub Actions

`.github/workflows/monthly-report.yml` runs on the first day of each month at 08:00 Bolivia time (`12:00 UTC`). It can also be run manually from **Actions → Monthly SKU Intelligence Report → Run workflow**.

Each refresh:
1. Retrieves product/order metadata using Shopify GraphQL Bulk Operations.
2. Retrieves exact sales metrics from ShopifyQL for FY 2025, 2026 YTD and each month available.
3. Calculates the complete SKU sales distribution and margin analysis.
4. Saves compact JSON archives per store/year/month.
5. Copies published JSON assets into `public/data/` for Cloudflare Pages.
6. Commits the updated archives and Pages assets to GitHub.

## JSON archive structure

```text
data/
  latest-report.json
  archive/
    equestrian/
      2025/
        2025-01.json
        ...
        2025-12.json
      2026/
        2026-01.json
        ...
    cavali/
      2025/
      2026/
public/
  data/
    latest-report.json
    archive-index.json
    archive/
      equestrian/
      cavali/
```

Monthly JSON files contain the full SKU-level monthly analysis plus compact FY 2025 and 2026 YTD summaries. The dashboard reads the selected store/month archive. GitHub history preserves the snapshots; do not delete `data/archive/` or `public/data/archive/` if historical comparisons are required.

## Cloudflare Pages

Connect the same GitHub repository to a separate Cloudflare Pages project.

- Framework preset: `None`
- Build command: leave empty
- Build output directory: `public`
- Root directory: repository root
- Production branch: `main`

The existing Cloudflare Google authentication and user registry configuration is reused. Shopify credentials remain in GitHub Actions only; Cloudflare Pages serves the prepared JSON assets and protected APIs. Do not add Shopify tokens to Cloudflare.

## Local development

Requires Node.js 20 or newer.

```bash
cp .env.example .env
# Add the four Shopify store values to .env
npm ci
npm test
npm run refresh
npm start
```

Open `http://127.0.0.1:3000`.

## Important report explanations

The dashboard includes click-to-open explanations beside important metrics. These explain why:
- SKU counts differ from units sold.
- Quantity ordered differs from net items sold.
- Reversed quantity can be negative.
- Product-level and variant-SKU totals can differ.
- Sales reversals can be attributed to a later adjustment date rather than the original order date.
- Historical gross margin can differ if current unit costs are not the same as costs at the time of sale.

These explanations help users compare the dashboard with Shopify using the same reporting dimension, period and filters.


## SKU channel filter: Wellington Warehouse and Shopify Collective

The dashboard includes a SKU channel filter with these options: All channels, Wellington Warehouse, Shopify Collective, and Other / Unclassified. There is no Concierge classification.

- **Wellington Warehouse** is identified from the order's current `retailLocation` (with legacy `physicalLocation` as a fallback) or from the assigned location of the exact `FulfillmentOrderLineItem` associated with that SKU. This avoids assigning a mixed-location order's warehouse to every line item.
- **Shopify Collective** is identified only from an explicit `Shopify Collective` tag on the order or product (case-insensitive; spaces, hyphens and underscores are normalized).
- A SKU can have evidence for both channels and will appear in either corresponding filter. SKUs without either signal are Other / Unclassified.
- If the Shopify app does not have the fulfillment-order read scopes, the Bulk export falls back to retail-location and explicit tag evidence. In that case, online fulfillment-only Wellington orders may remain unclassified.

The channel filter narrows the SKU table only. It does not reallocate ShopifyQL financial totals by channel: ShopifyQL sales metrics in this report are grouped by SKU for the whole store, while Wellington/Collective evidence is obtained from order and fulfillment metadata. This distinction is displayed in the dashboard so users do not mistake store-wide SKU sales for channel-only sales.

No additional GitHub Secrets or Cloudflare variables are required.


For complete online fulfillment-location coverage, the Shopify custom app should also have an applicable Fulfillment Orders read scope (for example `read_merchant_managed_fulfillment_orders` and/or `read_assigned_fulfillment_orders`, depending on the store's fulfillment setup). The refresh workflow detects missing scope access and retries the metadata export without fulfillment-order fields instead of failing. No additional token Secret names are required; if Shopify requires app reinstallation, update the value in the existing store token Secret.


## Corro-only SKU channel filter

The SKU Channel selector is available only when the Corro store is selected. Its options are All channels, Wellington Warehouse and Shopify Collective. It filters the SKU Analysis table and CSV export only. Executive KPIs, Shopify sales reconciliation, full-catalog concentration charts, year comparison and gross-margin panels remain store-wide and are not recalculated by this selector. Cavali does not display the channel selector.
