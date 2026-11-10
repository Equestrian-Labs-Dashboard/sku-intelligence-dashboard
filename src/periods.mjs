function localDateString(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function addDays(value, amount) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}
function addMonths(year, month, amount) {
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}
export function getReportPeriods(asOf = new Date(), timeZone = 'America/La_Paz') {
  const cutoffDate = localDateString(asOf, timeZone);
  const [year, month] = cutoffDate.split('-').map(Number);
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const next = addMonths(year, month, 1);
  const monthEnd = `${next.year}-${String(next.month).padStart(2, '0')}-01`;
  return {
    FY2025: { key: 'FY2025', label: 'Full Year 2025', startDate: '2025-01-01', endDateExclusive: '2026-01-01', cutoffDate: '2025-12-31' },
    YTD2026: { key: 'YTD2026', label: '2026 Year to Date', startDate: '2026-01-01', endDateExclusive: cutoffDate < '2026-01-01' ? '2026-01-01' : addDays(cutoffDate, 1), cutoffDate: cutoffDate < '2026-01-01' ? null : cutoffDate },
    MONTH: { key: 'MONTH', label: `${new Intl.DateTimeFormat('en-US', { month: 'long', timeZone }).format(asOf)} ${year}`, startDate: monthStart, endDateExclusive: monthEnd, cutoffDate },
    monthKey: `${year}-${String(month).padStart(2, '0')}`
  };
}
export function isDateInPeriod(value, period) {
  if (!value) return false;
  const date = String(value).slice(0, 10);
  return date >= period.startDate && date < period.endDateExclusive;
}
