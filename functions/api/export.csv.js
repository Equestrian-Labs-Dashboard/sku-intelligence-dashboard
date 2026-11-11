import { requireSkuAccess, readAssetJson, safeError } from "../_lib/sku_api.js";

function cell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export async function onRequestGet(context) {
  try {
    await requireSkuAccess(context);
    const url = new URL(context.request.url);
    const store = url.searchParams.get("store") || "equestrian";
    const month = url.searchParams.get("month");
    const period = url.searchParams.get("period") || "YTD2026";
    const requestedChannel = url.searchParams.get("channel") || "ALL";
    // Wellington / Collective classification is a Corro-only reporting filter.
    // Cavali exports always remain unfiltered and store-wide.
    const channel = store === "equestrian" ? requestedChannel : "ALL";
    if (!["equestrian", "cavali"].includes(store) || !["FY2025", "YTD2026", "MONTH"].includes(period)
      || !["ALL", "WELLINGTON", "COLLECTIVE"].includes(channel)) {
      return Response.json({ error: "Invalid export selection" }, { status: 400 });
    }

    let report;
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const saved = await readAssetJson(context, `/data/archive/${store}/${month.slice(0, 4)}/${month}.json`);
      report = saved?.report;
    } else {
      const latest = await readAssetJson(context, "/data/latest-report.json");
      report = latest?.stores?.[store]?.report;
    }

    const allRows = report?.periods?.[period]?.skuRows || [];
    const rows = allRows.filter((row) => {
      const types = row.channelTypes || [];
      return channel === "ALL"
        || (channel === "WELLINGTON" && types.includes("WELLINGTON"))
        || (channel === "COLLECTIVE" && types.includes("COLLECTIVE"));
    });
    const columns = [
      "Rank", "SKU", "Product", "Category", "Vendor",
      "Quantity Ordered", "Net Items Sold", "Reversed Quantity",
      "Gross Sales", "Discounts", "Sales Reversals", "Net Sales",
      "SKU Channel", "Channel Evidence", "Sales Share (%)", "Cumulative Share (%)",
      "Gross Profit", "Gross Margin (%)", "Available Inventory",
      "Dropshipping", "Fulfillment Classification"
    ];
    const csvRows = rows.map((row) => [
      row.rank ?? "", row.sku, row.productTitle, row.category, row.vendor,
      row.quantityOrdered, row.netItemsSold, row.reversedQuantity,
      row.grossSales, row.discounts, row.salesReversals, row.netSales,
      row.channelLabel || "Other / Unclassified", (row.channelEvidence || []).join(" | "),
      row.salesShare, row.cumulativeShare, row.grossProfit, row.grossMargin ?? "",
      row.inventoryAvailable ?? "Not synced", row.isDropship ? "Yes" : "No", row.action
    ]);
    const csv = [columns, ...csvRows].map((row) => row.map(cell).join(",")).join("\r\n");
    return new Response("\uFEFF" + csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="sku-${store}-${period.toLowerCase()}-${channel.toLowerCase()}.csv"`,
        "cache-control": "private, no-store"
      }
    });
  } catch (error) {
    return safeError(error);
  }
}
