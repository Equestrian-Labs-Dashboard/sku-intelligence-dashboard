import { isDateInPeriod } from './periods.mjs';

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function getSku(line) {
  const value = line?.sku || line?.variant?.sku;
  return typeof value === 'string' ? value.trim() : '';
}

function getUnitCost(line) {
  const value = line?.variant?.inventoryItem?.unitCost?.amount;
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isDropshipLine(order, line, configuredTags) {
  const tags = [
    ...(Array.isArray(order?.tags) ? order.tags : []),
    ...(Array.isArray(line?.product?.tags) ? line.product.tags : [])
  ].map((tag) => String(tag).trim().toLowerCase());
  if (tags.some((tag) => configuredTags.includes(tag))) return true;
  return (line?.customAttributes || []).some((attribute) => {
    const text = `${attribute?.key || ''} ${attribute?.value || ''}`.toLowerCase();
    return /dropship|drop.?ship|supplier.?fulfil|supplier.?fulfill/.test(text);
  });
}

function metadataBySku(orders, configuredTags) {
  const map = new Map();
  for (const order of orders || []) {
    for (const line of order?.lineItems?.nodes || []) {
      const sku = getSku(line);
      if (!sku) continue;
      const previous = map.get(sku) || {};
      const unitCost = getUnitCost(line);
      map.set(sku, {
        productTitle: line?.product?.title || line?.title || previous.productTitle || sku,
        category: line?.product?.productType || previous.category || 'Uncategorized',
        vendor: line?.product?.vendor || previous.vendor || '—',
        unitCost: unitCost ?? previous.unitCost ?? null,
        isDropship: Boolean(previous.isDropship || isDropshipLine(order, line, configuredTags))
      });
    }
  }
  return map;
}

function marginForRows(rows) {
  const netSalesWithKnownCost = rows.reduce((sum, row) => sum + (row.costKnownSales || 0), 0);
  const costOfGoodsSold = rows.reduce((sum, row) => sum + (row.costOfGoodsSold || 0), 0);
  const grossProfit = netSalesWithKnownCost - costOfGoodsSold;
  const totalNetSales = rows.reduce((sum, row) => sum + row.netSales, 0);
  const coverage = totalNetSales > 0 ? (netSalesWithKnownCost / totalNetSales) * 100 : 0;
  return {
    netSales: round(totalNetSales),
    netSalesWithKnownCost: round(netSalesWithKnownCost),
    costOfGoodsSold: round(costOfGoodsSold),
    grossProfit: round(grossProfit),
    grossMargin: netSalesWithKnownCost > 0 ? round((grossProfit / netSalesWithKnownCost) * 100) : null,
    costCoveragePct: round(Math.max(0, Math.min(100, coverage)))
  };
}

function giniCoefficient(rows) {
  const values = rows.map((row) => Math.max(0, row.netSales)).filter((value) => value > 0).sort((a, b) => a - b);
  const n = values.length;
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!n || total <= 0) return 0;
  const weighted = values.reduce((sum, value, index) => sum + (index + 1) * value, 0);
  return round(((2 * weighted) / (n * total) - (n + 1) / n) * 100, 2);
}

function aggregateShopifyRows(salesRows) {
  const map = new Map();
  for (const source of salesRows || []) {
    const sku = String(source.sku || source.product_variant_sku || '').trim();
    if (!sku) continue;
    let row = map.get(sku);
    if (!row) {
      row = {
        sku,
        productTitle: source.productTitle || source.product_title || sku,
        grossSales: 0,
        discounts: 0,
        salesReversals: 0,
        netSales: 0,
        quantityOrdered: 0,
        netItemsSold: 0,
        reversedQuantity: 0
      };
      map.set(sku, row);
    }
    // ShopifyQL can return separate rows when a variant's product title changed.
    // Aggregate those rows to one unique SKU without losing any sales metrics.
    row.grossSales += Number(source.grossSales ?? source.gross_sales) || 0;
    row.discounts += Number(source.discounts) || 0;
    row.salesReversals += Number(source.salesReversals ?? source.sales_reversals) || 0;
    row.netSales += Number(source.netSales ?? source.net_sales) || 0;
    row.quantityOrdered += Number(source.quantityOrdered ?? source.quantity_ordered) || 0;
    row.netItemsSold += Number(source.netItemsSold ?? source.net_items_sold) || 0;
    row.reversedQuantity += Number(source.reversedQuantity ?? source.reversed_quantity) || 0;
    if ((Number(source.netSales ?? source.net_sales) || 0) > (Number(row._bestTitleSales) || -Infinity)) {
      row.productTitle = source.productTitle || source.product_title || row.productTitle;
      row._bestTitleSales = Number(source.netSales ?? source.net_sales) || 0;
    }
  }
  return [...map.values()].map(({ _bestTitleSales, ...row }) => row);
}

export function buildPeriodReport(salesRows, metadataOrders, period, options = {}) {
  const configuredTags = options.dropshipTags || ['dropship', 'dropshipping'];
  const metadata = metadataBySku(metadataOrders, configuredTags);
  const currency = options.currencyCode || 'USD';
  const aggregated = aggregateShopifyRows(salesRows);

  const allRows = aggregated.map((sales) => {
    const meta = metadata.get(sales.sku) || {};
    const unitCost = meta.unitCost ?? null;
    const costOfGoodsSold = unitCost === null ? 0 : unitCost * sales.netItemsSold;
    const costKnownSales = unitCost === null ? 0 : sales.netSales;
    const grossProfit = costKnownSales - costOfGoodsSold;
    return {
      ...sales,
      productTitle: meta.productTitle || sales.productTitle || sales.sku,
      category: meta.category || 'Uncategorized',
      vendor: meta.vendor || '—',
      unitsSold: sales.netItemsSold,
      costOfGoodsSold: round(costOfGoodsSold),
      costKnownSales,
      costMissingUnits: unitCost === null ? sales.netItemsSold : 0,
      grossProfit: round(grossProfit),
      grossMargin: costKnownSales > 0 ? round((grossProfit / costKnownSales) * 100) : null,
      isDropship: Boolean(meta.isDropship),
      inventoryAvailable: null,
      currency
    };
  }).filter((row) => row.quantityOrdered !== 0 || row.netItemsSold !== 0 || row.netSales !== 0 || row.salesReversals !== 0);

  const rankedRows = allRows
    .sort((a, b) => b.netSales - a.netSales || b.netItemsSold - a.netItemsSold || a.sku.localeCompare(b.sku));
  const totalNetSales = rankedRows.reduce((sum, row) => sum + row.netSales, 0);
  let cumulativeSales = 0;
  rankedRows.forEach((row, index) => {
    cumulativeSales += row.netSales;
    row.rank = index + 1;
    row.salesShare = totalNetSales !== 0 ? round((row.netSales / totalNetSales) * 100) : 0;
    row.cumulativeShare = totalNetSales !== 0 ? round((cumulativeSales / totalNetSales) * 100) : 0;
    row.action = row.isDropship ? 'DROPSHIP' : 'STOCK REVIEW';
  });

  const soldRows = rankedRows.filter((row) => row.quantityOrdered > 0 || row.netItemsSold > 0);
  const withDropshipping = marginForRows(rankedRows);
  const withoutDropshipping = marginForRows(rankedRows.filter((row) => !row.isDropship));
  const marginImpactPp = withDropshipping.grossMargin !== null && withoutDropshipping.grossMargin !== null
    ? round(withDropshipping.grossMargin - withoutDropshipping.grossMargin)
    : null;

  const positiveSalesRows = rankedRows.filter((row) => row.netSales > 0);
  const topSku = positiveSalesRows[0] || null;
  const concentrationGini = giniCoefficient(rankedRows);

  return {
    period,
    summary: {
      totalUniqueSkus: soldRows.length,
      totalUnitsSold: round(rankedRows.reduce((sum, row) => sum + row.netItemsSold, 0), 0),
      quantityOrdered: round(rankedRows.reduce((sum, row) => sum + row.quantityOrdered, 0), 0),
      netItemsSold: round(rankedRows.reduce((sum, row) => sum + row.netItemsSold, 0), 0),
      reversedQuantity: round(rankedRows.reduce((sum, row) => sum + row.reversedQuantity, 0), 0),
      grossSales: round(rankedRows.reduce((sum, row) => sum + row.grossSales, 0)),
      discounts: round(rankedRows.reduce((sum, row) => sum + row.discounts, 0)),
      salesReversals: round(rankedRows.reduce((sum, row) => sum + row.salesReversals, 0)),
      netSales: round(totalNetSales),
      topSkuShare: topSku ? topSku.salesShare : 0,
      concentrationGini,
      ordersCount: null,
      missingSkuLines: 0,
      dropshipSkuCount: soldRows.filter((row) => row.isDropship).length,
      currency
    },
    grossMargin: {
      withDropshipping,
      withoutDropshipping,
      dropshippingImpactPp: marginImpactPp
    },
    skuRows: rankedRows,
    dataQuality: {
      salesSource: 'ShopifyQL FROM sales grouped by product_variant_sku and product_title.',
      salesBasis: 'Gross sales, discounts, sales reversals, net sales and quantities are taken directly from ShopifyQL. They are not reconstructed from order line totals.',
      quantityBasis: 'Quantity ordered is the original quantity. Net items sold is after reversals. Reversed quantity is the quantity removed through refunds, returns, cancellations or order edits; Shopify may report it as a negative value.',
      skuCountBasis: 'Unique SKU count is the number of distinct non-empty product_variant_sku values with ordered or net item activity. It is not a unit count or order count.',
      periodBasis: 'Sales metrics follow Shopify sales-event reporting for the selected date range. Adjustments can be attributed to the date they occur, which may differ from filtering orders only by their creation date.',
      productGrouping: 'The report counts variant SKUs. A product-level Shopify report can combine multiple variants, so product totals and SKU totals are not always directly comparable.',
      costBasis: 'Gross margin uses the current Shopify unit cost where available, multiplied by net items sold. Historical unit costs are not reconstructed.',
      inventoryBasis: 'Available inventory is not currently synchronized; it is shown as unavailable rather than zero.',
      concentrationBasis: 'The full SKU catalog is ranked by actual net sales. No fixed 80/20 distribution is assumed.'
    }
  };
}

export function buildReport(salesByPeriod, metadataOrdersByPeriod, periods, options = {}) {
  const metadataOrders = [...(metadataOrdersByPeriod.FY2025 || []), ...(metadataOrdersByPeriod.YTD2026 || [])];
  const metadata = metadataOrders;
  const build = (key) => buildPeriodReport(
    salesByPeriod[key] || [],
    metadata,
    periods[key],
    options
  );
  return {
    generatedAt: new Date().toISOString(),
    source: {
      primary: 'ShopifyQL sales analytics',
      metadata: 'Shopify Admin GraphQL Bulk Operations',
      demo: false,
      shopifyConnected: true,
      ponevaStatus: 'PENDING_API_CONTRACT'
    },
    reportingTimezone: options.timezone || 'America/La_Paz',
    periods: {
      FY2025: build('FY2025'),
      YTD2026: build('YTD2026'),
      MONTH: build('MONTH')
    },
    notes: [
      'All sales metrics are sourced directly from ShopifyQL FROM sales, grouped by product variant SKU.',
      'Distinct SKU counts are not unit counts or order counts.',
      'Sales reversals include refunds, returns, cancellations and order edits.',
      'A product-level report may combine multiple variant SKUs.',
      'No fixed 80/20 rule is assumed; the full SKU concentration curve is calculated from actual net sales.',
      'Gross margin uses current unit cost where available, not historical unit costs.',
      'Inventory availability is not currently synchronized.'
    ]
  };
}
