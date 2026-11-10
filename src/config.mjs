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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function normalizeStore(value) { return (value || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, ''); }

export function getConfig() {
  const stores = [
    { key: 'equestrian', name: 'Equestrian Labs', shopifyStore: normalizeStore(process.env.EQUESTRIAN_SHOPIFY_STORE), shopifyAccessToken: (process.env.EQUESTRIAN_SHOPIFY_TOKEN || '').trim() },
    { key: 'cavali', name: 'Cavali', shopifyStore: normalizeStore(process.env.CAVALI_SHOPIFY_STORE), shopifyAccessToken: (process.env.CAVALI_SHOPIFY_TOKEN || '').trim() }
  ];
  return {
    stores,
    shopifyApiVersion: (process.env.SHOPIFY_API_VERSION || '2026-10').trim(),
    reportTimezone: (process.env.REPORT_TIMEZONE || 'America/La_Paz').trim(),
    dropshipTags: (process.env.DROPSHIP_TAGS || 'dropship,dropshipping').split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean),
    port: Number.parseInt(process.env.PORT || '3000', 10),
    host: (process.env.HOST || '127.0.0.1').trim()
  };
}

export function assertShopifyConfig(config) {
  if (!config.shopifyStore || !config.shopifyAccessToken) throw new Error('Shopify credentials are missing for this store.');
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(config.shopifyStore)) throw new Error(`Invalid Shopify store domain: ${config.shopifyStore}`);
  if (!/^\d{4}-\d{2}$/.test(config.shopifyApiVersion)) throw new Error('SHOPIFY_API_VERSION must use YYYY-MM format.');
}
