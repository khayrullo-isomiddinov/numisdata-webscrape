export function formatPrice(amount: number | null, currency: string | null): string | null {
  if (amount === null) return null;
  const formatted = amount % 1 === 0 ? amount.toString() : amount.toFixed(2);
  return currency ? `${formatted} ${currency}` : formatted;
}

export function formatEstimate(low: number | null, high: number | null, currency: string | null): string | null {
  if (low === null && high === null) return null;
  if (low === high || high === null) return formatPrice(low, currency);
  if (low === null) return formatPrice(high, currency);
  const currencySuffix = currency ? ` ${currency}` : "";
  const lowStr = low % 1 === 0 ? low.toString() : low.toFixed(2);
  const highStr = high % 1 === 0 ? high.toString() : high.toFixed(2);
  return `${lowStr}–${highStr}${currencySuffix}`;
}

export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export function formatDateTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
