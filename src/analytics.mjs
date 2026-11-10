import { isDateInPeriod } from './periods.mjs';

function amount(moneyBag) {
  const value = moneyBag?.shopMoney?.amount ?? moneyBag?.amount;
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function moneyCurrency(moneyBag) {
  return moneyBag?.shopMoney?.currencyCode ?? moneyBag?.currencyCode ?? null;
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

function availableInventory(line) {
  const levels = line?.variant?.inventoryItem?.inventoryLevels?.nodes || [];
  return levels.reduce((total, level) => {
    const available = (level?.quantities || []).find((item) => item.name === 'available');
    return total + (Number(available?.quantity) || 0);
  }, 0);
}

function isDropshipLine(order, line, configuredTags) {
  const tags = [
    ...(Array.isArray(order?.tags) ? order.tags : []),
    ...(Array.isArray(line?.product?.tags) ? line.product.tags : [])
  ].map((tag) => String(tag).trim().toLowerCase());

  if (tags.some((tag) => configuredTags.includes(tag))) return true;

  const attributes = line?.customAttributes || [];
  return attributes.some((attribute) => {
    const text = `${attribute?.key || ''} ${attribute?.value || ''}`.toLowerCase();
    return /dropship|drop.?ship|supplier.?fulfil|supplier.?fulfill/.test(text);
  });
}

function addMovement(map, order, line, signedQuantity, signedRevenue, configuredTags, currency) {
  const sku = getSku(line);
  if (!sku) return false;

  let row = map.get(sku);
  if (!row) {
    row = {
      sku,
      productTitle: line?.product?.title || line?.title || 'Untitled product',
      category: line?.product?.productType || 'Uncategorized',
      vendor: line?.product?.vendor || '—',
      unitsSold: 0,
      netSales: 0,
      costOfGoodsSold: 0,
      costKnownSales: 0,
      costMissingUnits: 0,
      isDropship: false,
      inventoryAvailable: 0,
      inventoryItemIds: new Set(),
      currency: currency || moneyCurrency(line?.discountedTotalSet) || 'USD'
    };
    map.set(sku, row);
  }

  row.unitsSold += signedQuantity;
  row.netSales += signedRevenue;
  row.isDropship ||= isDropshipLine(order, line, configuredTags);

  const unitCost = getUnitCost(line);
  if (unitCost !== null) {
    row.costOfGoodsSold += unitCost * signedQuantity;
    row.costKnownSales += signedRevenue;
  } else {
    row.costMissingUnits += signedQuantity;
  }

  const inventoryItemId = line?.variant?.inventoryItem?.id;
  if (inventoryItemId && !row.inventoryItemIds.has(inventoryItemId)) {
    row.inventoryItemIds.add(inventoryItemId);
    row.inventoryAvailable += availableInventory(line);
  }

  return true;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function marginForRows(rows) {
  const netSalesWithKnownCost = rows.reduce((sum, row) => sum + row.costKnownSales, 0);
  const costOfGoodsSold = rows.reduce((sum, row) => sum + row.costOfGoodsSold, 0);
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

export function buildPeriodReport(orders, period, options = {}) {
  const configuredTags = options.dropshipTags || ['dropship', 'dropshipping'];
  const skuMap = new Map();
  const ordersWithSales = new Set();
  let missingSkuLines = 0;

  for (const order of orders || []) {
    if (order?.cancelledAt) continue;

    const lineItems = order?.lineItems?.nodes || [];
    const lineById = new Map(lineItems.map((line) => [line.id, line]));
    const createdInPeriod = isDateInPeriod(order.createdAt, period);

    if (createdInPeriod) {
      for (const line of lineItems) {
        const originalQuantity = Number(line.quantity) || 0;
        const currentQuantity = Number(line.currentQuantity ?? line.quantity) || 0;
        if (currentQuantity <= 0) continue;

        const discountedTotal = amount(line.discountedTotalSet);
        const discountedUnit = amount(line.priceAfterAllDiscountsBeforeTaxesSet) ?? amount(line.discountedUnitPriceAfterAllDiscountsSet);
        const scaledTotal = discountedUnit !== null
          ? discountedUnit * currentQuantity
          : discountedTotal !== null && originalQuantity > 0
            ? discountedTotal * (currentQuantity / originalQuantity)
            : 0;
        const revenue = discountedTotal === null && discountedUnit === null ? 0 : scaledTotal;
        const added = addMovement(skuMap, order, line, currentQuantity, revenue, configuredTags, moneyCurrency(line.discountedTotalSet));
        if (!added) missingSkuLines += 1;
        else if (revenue > 0) ordersWithSales.add(order.id);
      }
    }

    for (const refund of order?.refunds || []) {
      if (!isDateInPeriod(refund.createdAt, period)) continue;
      const refundTransactions = refund?.transactions?.nodes || [];
      if (refundTransactions.length && !refundTransactions.some((transaction) => transaction.status === 'SUCCESS')) continue;
      const refundLines = refund?.refundLineItems?.nodes || [];
      for (const refundLine of refundLines) {
        const originalLine = lineById.get(refundLine?.lineItem?.id);
        const line = originalLine || {
          sku: refundLine?.lineItem?.sku,
          title: refundLine?.lineItem?.title,
          variant: refundLine?.lineItem?.variant
        };
        const quantity = Number(refundLine.quantity) || 0;
        if (!quantity) continue;

        const unitPrice = amount(originalLine?.discountedUnitPriceAfterAllDiscountsSet);
        const totalPrice = amount(originalLine?.discountedTotalSet);
        const originalQty = Number(originalLine?.quantity) || 0;
        const fallbackUnitPrice = unitPrice ?? (totalPrice !== null && originalQty > 0 ? totalPrice / originalQty : 0);
        const refundSubtotal = amount(refundLine.subtotalSet);
        const refundRevenue = refundSubtotal ?? (fallbackUnitPrice * quantity);
        const added = addMovement(skuMap, order, line, -quantity, -refundRevenue, configuredTags, moneyCurrency(refundLine.subtotalSet) || moneyCurrency(originalLine?.discountedTotalSet));
        if (!added) missingSkuLines += 1;
      }
    }
  }

  const allRows = [...skuMap.values()].map((row) => {
    const { inventoryItemIds, ...clean } = row;
    const grossProfit = clean.costKnownSales - clean.costOfGoodsSold;
    return {
      ...clean,
      netSales: round(clean.netSales),
      costOfGoodsSold: round(clean.costOfGoodsSold),
      grossProfit: round(grossProfit),
      grossMargin: clean.costKnownSales > 0 ? round((grossProfit / clean.costKnownSales) * 100) : null,
      inventoryAvailable: Math.max(0, clean.inventoryAvailable)
    };
  });

  const soldRows = allRows
    .filter((row) => row.unitsSold > 0 && row.netSales > 0)
    .sort((a, b) => b.netSales - a.netSales || a.sku.localeCompare(b.sku));
  const paretoSales = soldRows.reduce((sum, row) => sum + row.netSales, 0);
  let cumulativeSales = 0;
  let top80SkuCount = 0;
  const rankedRows = soldRows.map((row, index) => {
    const share = paretoSales > 0 ? row.netSales / paretoSales : 0;
    cumulativeSales += row.netSales;
    const cumulativeShare = paretoSales > 0 ? cumulativeSales / paretoSales : 0;
    if (top80SkuCount === 0 && cumulativeShare >= 0.8) top80SkuCount = index + 1;
    return {
      ...row,
      rank: index + 1,
      salesShare: round(share * 100),
      cumulativeShare: round(cumulativeShare * 100),
      isTop80: false,
      action: row.isDropship ? 'DROPSHIP' : 'LOW PRIORITY'
    };
  });

  if (rankedRows.length && top80SkuCount === 0) top80SkuCount = rankedRows.length;
  for (const row of rankedRows) {
    row.isTop80 = row.rank <= top80SkuCount;
    if (!row.isDropship) row.action = row.isTop80 ? 'CORE STOCK' : 'LOW PRIORITY';
  }

  const rankedSkuSet = new Set(rankedRows.map((row) => row.sku));
  const nonParetoRows = allRows
    .filter((row) => !rankedSkuSet.has(row.sku))
    .map((row) => ({
      ...row,
      rank: null,
      salesShare: 0,
      cumulativeShare: 0,
      isTop80: false,
      action: row.isDropship ? 'DROPSHIP' : 'REVIEW RETURNS'
    }));

  const totalNetSales = allRows.reduce((sum, row) => sum + row.netSales, 0);
  const totalUnits = allRows.reduce((sum, row) => sum + row.unitsSold, 0);
  const withDropshipping = marginForRows(allRows);
  const withoutDropshipping = marginForRows(allRows.filter((row) => !row.isDropship));
  const marginImpactPp = withDropshipping.grossMargin !== null && withoutDropshipping.grossMargin !== null
    ? round(withDropshipping.grossMargin - withoutDropshipping.grossMargin)
    : null;

  return {
    period,
    summary: {
      totalUniqueSkus: soldRows.length,
      top80SkuCount,
      remainingSkuCount: Math.max(0, soldRows.length - top80SkuCount),
      totalUnitsSold: round(totalUnits, 0),
      netSales: round(totalNetSales),
      paretoSales: round(paretoSales),
      ordersCount: ordersWithSales.size,
      missingSkuLines,
      dropshipSkuCount: soldRows.filter((row) => row.isDropship).length,
      currency: soldRows[0]?.currency || allRows[0]?.currency || 'USD'
    },
    grossMargin: {
      withDropshipping,
      withoutDropshipping,
      dropshippingImpactPp: marginImpactPp
    },
    skuRows: [...rankedRows, ...nonParetoRows].map((row) => ({
      ...row,
      unitsSold: round(row.unitsSold, 0)
    })),
    dataQuality: {
      missingSkuLines,
      refundsIncluded: false,
      refundCoverage: 'Refund line items are not included in this Shopify Bulk export. Treat net sales and Pareto as pre-refund until refund ingestion is added.',
      costBasis: 'Current Shopify unit cost; historical unit costs are not reconstructed.',
      paretoBasis: 'Net product sales after discounts and successfully processed refunds, excluding taxes and shipping.'
    }
  };
}

export function buildReport(ordersByPeriod, periods, options = {}) {
  const fy2025 = buildPeriodReport(ordersByPeriod.FY2025 || [], periods.FY2025, options);
  const ytd2026 = buildPeriodReport(ordersByPeriod.YTD2026 || [], periods.YTD2026, options);
  const month = buildPeriodReport(ordersByPeriod.MONTH || [], periods.MONTH, options);

  return {
    generatedAt: new Date().toISOString(),
    source: {
      primary: 'Shopify Admin GraphQL API',
      demo: false,
      shopifyConnected: true,
      ponevaStatus: 'PENDING_API_CONTRACT'
    },
    reportingTimezone: options.timezone || 'America/La_Paz',
    periods: {
      FY2025: fy2025,
      YTD2026: ytd2026,
      MONTH: month
    },
    notes: [
      'Unique SKU counts are based on distinct non-empty SKU values with positive net units and net sales.',
      'Pareto ranking uses net product sales after discounts and successfully processed refunds; taxes and shipping are excluded.',
      'Gross margin uses the current Shopify unit cost available at report time, not historical cost at the time of sale.',
      'Dropshipping classification depends on configured tags or matching line-item properties.'
    ]
  };
}
