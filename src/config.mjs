import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadEnvFile(filePath = resolve(process.cwd(), '.env')) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function getConfig() {
  const store = (process.env.SHOPIFY_STORE || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
  const dropshipTags = (process.env.DROPSHIP_TAGS || 'dropship,dropshipping')
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);

  return {
    shopifyStore: store,
    shopifyAccessToken: (process.env.SHOPIFY_ACCESS_TOKEN || '').trim(),
    ponevaStore: (process.env.PONEVA_STORE || '').trim(),
    ponevaApiToken: (process.env.PONEVA_API_TOKEN || '').trim(),
    shopifyApiVersion: (process.env.SHOPIFY_API_VERSION || '2026-10').trim(),
    reportTimezone: (process.env.REPORT_TIMEZONE || 'America/La_Paz').trim(),
    dropshipTags,
    port: Number.parseInt(process.env.PORT || '3000', 10),
    host: (process.env.HOST || '127.0.0.1').trim()
  };
}

export function assertShopifyConfig(config) {
  if (!config.shopifyStore || !config.shopifyAccessToken) {
    throw new Error('Shopify is not configured. Set SHOPIFY_STORE and SHOPIFY_ACCESS_TOKEN.');
  }
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(config.shopifyStore)) {
    throw new Error('SHOPIFY_STORE must be the Shopify myshopify.com domain, for example: example-store.myshopify.com');
  }
  if (!/^\d{4}-\d{2}$/.test(config.shopifyApiVersion)) {
    throw new Error('SHOPIFY_API_VERSION must use YYYY-MM format, for example 2026-10.');
  }
}
