import { format, formatDistanceToNowStrict } from "date-fns";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });
const num = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

/** Formats integer paise as rupees, e.g. 1234500 -> "₹12,345". */
export function formatINR(paise: number | null | undefined, decimals = false): string {
  if (paise == null) return "—";
  return (decimals ? inr2 : inr).format(paise / 100);
}

export const paiseToRupees = (paise: number) => paise / 100;
export const rupeesToPaise = (rupees: number) => Math.round(rupees * 100);

export function formatNumber(n: number | null | undefined, oneDecimal = false): string {
  if (n == null || Number.isNaN(n)) return "—";
  return (oneDecimal ? num1 : num).format(n);
}

export function formatKm(km: number | null | undefined): string {
  if (km == null) return "—";
  // Large totals do not need a decimal place.
  return `${(Math.abs(km) >= 1000 ? num : num1).format(km)} km`;
}

export function formatPercent(fraction: number | null | undefined): string {
  if (fraction == null || Number.isNaN(fraction)) return "—";
  return `${num1.format(fraction * 100)}%`;
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || Number.isNaN(minutes)) return "—";
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

type DateLike = string | number | Date | null | undefined;

export function formatDate(d: DateLike): string {
  if (!d) return "—";
  return format(new Date(d), "dd MMM yyyy");
}

export function formatDateTime(d: DateLike): string {
  if (!d) return "—";
  return format(new Date(d), "dd MMM yyyy, hh:mm a");
}

export function formatTime(d: DateLike): string {
  if (!d) return "—";
  return format(new Date(d), "hh:mm:ss a");
}

export function timeAgo(d: DateLike): string {
  if (!d) return "—";
  return `${formatDistanceToNowStrict(new Date(d))} ago`;
}

/** Value for <input type="date">. */
export function toDateInput(d: DateLike): string {
  if (!d) return "";
  return format(new Date(d), "yyyy-MM-dd");
}

/** Value for <input type="datetime-local">. */
export function toDateTimeInput(d: DateLike): string {
  if (!d) return "";
  return format(new Date(d), "yyyy-MM-dd'T'HH:mm");
}

export function daysUntil(d: DateLike, now: Date = new Date()): number | null {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - now.getTime()) / 86_400_000);
}
