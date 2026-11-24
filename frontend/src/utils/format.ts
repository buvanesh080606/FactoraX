export function formatINR(value: string | number | null | undefined): string {
  const num = Number(value ?? 0);
  if (Number.isNaN(num)) return "₹0.00";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatQty(value: string | number | null | undefined): string {
  const num = Number(value ?? 0);
  if (Number.isNaN(num)) return "0";
  return Number.isInteger(num)
    ? num.toLocaleString("en-IN")
    : num.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

export function getLocalDateInputValue(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const plainDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  const d = plainDate
    ? new Date(Number(plainDate[1]), Number(plainDate[2]) - 1, Number(plainDate[3]))
    : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export function unwrapList<T>(data: { results?: T[] } | T[]): T[] {
  if (Array.isArray(data)) return data;
  return data?.results ?? [];
}
