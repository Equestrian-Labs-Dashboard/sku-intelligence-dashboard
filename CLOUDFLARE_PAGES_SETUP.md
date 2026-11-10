# SKU Intelligence Dashboard — Cloudflare Pages deployment

This project keeps GitHub as the source of truth and uses Cloudflare Pages for the customer-facing dashboard. GitHub Actions remains responsible for Shopify extraction and monthly JSON snapshots.

## 1. Create a separate Pages project

In Cloudflare Dashboard:

1. Open **Workers & Pages → Create application → Pages → Connect to Git**.
2. Select the existing repository `Equestrian-Labs-Dashboard/sku-intelligence-dashboard`.
3. Project name: `sku-intelligence-dashboard` (or another available name).
4. Production branch: `main`.
5. Framework preset: **None**.
6. Build command: leave blank.
7. Build output directory: `public`.
8. Root directory: leave blank.
9. Save and deploy.

Do not disconnect GitHub, delete the repository, or change the existing Concierge Pages project. This creates a separate Pages project from the same SKU repository.

The `functions/` directory is at the repository root. Cloudflare Pages automatically builds these Pages Functions. Static files are served from `public/`.

## 2. Cloudflare Variables and Secrets

In **Workers & Pages → sku-intelligence-dashboard → Settings → Variables and Secrets → Production**, reuse the same Google access values already used by the Concierge Commissions Pages project:

| Name | Type | Value |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Text | Same Google OAuth Web Client ID |
| `GOOGLE_CREDENTIALS` | Secret | Same service-account JSON |
| `USER_REGISTRY_SHEET_ID` | Text | Same Register Users Google Sheet ID |
| `SESSION_SECRET` | Secret | Same existing session secret |
| `USER_REGISTRY_TAB` | Text (optional) | `User Access Registry` |
| `SESSION_TTL_SECONDS` | Text (optional) | `28800` |
| `USER_REGISTRY_CACHE_SECONDS` | Text (optional) | `30` |

`USER_REGISTRY_TAB`, `SESSION_TTL_SECONDS`, and `USER_REGISTRY_CACHE_SECONDS` are optional because the code has defaults.

**No Shopify credentials are required in Cloudflare Pages.** The four Shopify tokens remain only in GitHub Actions Secrets:

- `EQUESTRIAN_SHOPIFY_STORE`
- `EQUESTRIAN_SHOPIFY_TOKEN`
- `CAVALI_SHOPIFY_STORE`
- `CAVALI_SHOPIFY_TOKEN`

Do not add or expose Shopify tokens in Cloudflare variables, static JSON, HTML, or JavaScript. Cloudflare serves the already-generated report data; GitHub Actions does the Shopify extraction.

## 3. Google OAuth allowed origin

In Google Cloud Console, open the same OAuth Web Client used by Concierge. Add the new Pages production origin to **Authorized JavaScript origins**:

`https://sku-intelligence-dashboard.pages.dev`

Use the actual Pages hostname Cloudflare assigns if the project name is different. Do not add a path such as `/index.html`.

## 4. Grant access in the existing Register Users sheet

In the existing `User Access Registry` tab, find each user who should see this dashboard. Add `SKU Intelligence` to that user's **Report Access** cell, preserving any existing access values (separate entries with commas).

The report access is checked server-side on both the dashboard page and every API endpoint. A user without the `SKU Intelligence` permission receives Access denied even if they know the URL.

## 5. Publish the first real data

The GitHub Actions workflow is already configured to:

1. Refresh Corro and Cavali from Shopify using ShopifyQL sales analytics and GraphQL Bulk Operations for product metadata.
2. Save monthly JSON files under `data/archive/`.
3. Copy the latest report and archives into `public/data/`.
4. Generate `public/data/archive-index.json`.
5. Commit both source data and Pages assets to `main`.

That commit triggers Cloudflare Pages automatic deployment. Run **Actions → Monthly SKU Intelligence Report → Run workflow** after the Pages project and variables are configured. Wait for the workflow commit and then for the Pages deployment to finish.

## 6. Pages settings summary

- Git integration: enabled, connected to the SKU repository.
- Production branch: `main`.
- Framework preset: `None`.
- Build command: blank.
- Build output directory: `public`.
- Root directory: blank.
- Automatic deployments: enabled.

Do not use GitHub Pages for this dashboard. The customer-facing site is Cloudflare Pages.

## 7. Important data protection

The root dashboard and `/data/*` static JSON URLs are protected by the Pages middleware. API endpoints also independently validate the signed session and `SKU Intelligence` report permission. JavaScript and CSS are public assets; report JSON is not served directly to unauthorized visitors.

The Cloudflare Pages project does not run the Shopify refresh itself. GitHub Actions remains the scheduled data pipeline. The dashboard's refresh button communicates that refresh is managed by the administrator workflow.


## ShopifyQL permission requirement

The Shopify Admin API custom app for each store must include the `read_reports` scope for the dashboard's ShopifyQL `FROM sales` query. Shopify's current `shopifyqlQuery` documentation also lists protected customer data approval requirements. Keep the existing four GitHub Secrets; if the app permissions are changed, update the token value inside the existing store-specific Secret after reinstalling/updating the Shopify app. No Shopify tokens are stored in Cloudflare Pages.
