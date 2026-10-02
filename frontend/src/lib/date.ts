// The residence's calendar day and clock, not the browser's or UTC's: Kuwait
// is UTC+3, so toISOString() gives yesterday between midnight and 3am.
const TZ = "Asia/Kuwait";

export function todayIso(): string {
  return dateIn(new Date());
}

// YYYY-MM-DD of any instant on the residence's calendar.
export function dateIn(instant: Date | string): string {
  return new Date(instant).toLocaleDateString("en-CA", { timeZone: TZ });
}

// "HH:MM" on the residence's clock.
export function timeHm(): string {
  return new Date().toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
}

// Calendar arithmetic on a YYYY-MM-DD string, independent of any time zone.
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysUntil(iso: string): number {
  return Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(todayIso() + "T00:00:00Z")) / 86400000);
}

export function daysLabel(n: number): string {
  if (n < 0) return `${Math.abs(n)}d overdue`;
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  return `in ${n}d`;
}

export function monthLabel(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { month: "short" });
}

export function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// For full timestamps (with time zone) such as audit entries and ledger rows.
export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
