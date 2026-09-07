import type { ReactNode } from "react";
import { Icon } from "./icons";

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(22, 26, 21, 0.45)" }}
      onClick={onClose}
    >
      <div
        className={`flex max-h-[88vh] w-full flex-col rounded-2xl border ${wide ? "max-w-2xl" : "max-w-xl"}`}
        style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow-lg)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b p-5 pb-4" style={{ borderColor: "var(--border)" }}>
          <h3 className="font-display text-lg font-semibold" style={{ color: "var(--ink-900)" }}>
            {title}
          </h3>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-[var(--surface-sunken)]" style={{ color: "var(--ink-400)" }}>
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-5 pt-4">{children}</div>
      </div>
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border p-5 ${className}`}
      style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow-sm)" }}
    >
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b pb-5" style={{ borderColor: "var(--border)" }}>
      <div>
        <h1 className="font-display text-xl font-semibold sm:text-2xl" style={{ color: "var(--ink-900)" }}>
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm" style={{ color: "var(--ink-500)" }}>
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export function StatTile({
  label,
  value,
  suffix,
  icon,
  tone = "neutral",
  progress,
  progressColor,
  sub,
}: {
  label: string;
  value: ReactNode;
  suffix?: string;
  icon?: string;
  tone?: Tone;
  progress?: number;
  progressColor?: string;
  sub?: string;
}) {
  return (
    <Card className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>
          {label}
        </span>
        {icon && <Icon name={icon} className="h-4 w-4" />}
      </div>
      <span className="font-display text-2xl font-semibold" style={{ color: toneColor(tone) }}>
        {value}
        {suffix && (
          <span className="ml-1 text-xs font-normal" style={{ color: "var(--ink-400)" }}>
            {suffix}
          </span>
        )}
      </span>
      {progress != null && (
        <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--surface-sunken)" }}>
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.min(progress, 100)}%`, background: progressColor ?? "var(--brass-500)" }}
          />
        </div>
      )}
      {sub && (
        <span className="text-[12px]" style={{ color: "var(--ink-400)" }}>
          {sub}
        </span>
      )}
    </Card>
  );
}

type Tone = "neutral" | "good" | "warning" | "serious" | "critical" | "info";

function toneColor(tone: Tone) {
  switch (tone) {
    case "good": return "var(--status-good)";
    case "warning": return "var(--status-warning)";
    case "serious": return "var(--status-serious)";
    case "critical": return "var(--status-critical)";
    case "info": return "var(--status-info)";
    default: return "var(--ink-900)";
  }
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  const bg = tone === "neutral" ? "var(--status-neutral-bg)" : `var(--status-${tone}-bg)`;
  return (
    <span className="status-pill" style={{ background: bg, color: toneColor(tone) }}>
      {children}
    </span>
  );
}

export function statusTone(status: string): Tone {
  const s = status.toLowerCase();
  if (["approved", "active", "completed", "verified", "goods received", "paid", "present", "reviewed"].includes(s)) return "good";
  if (["pending", "pending approval", "pending review", "proposed", "ordered", "in progress", "assigned"].includes(s)) return "warning";
  if (["rejected", "overdue", "critical", "absent", "flagged"].includes(s)) return "critical";
  if (["reported", "on leave"].includes(s)) return "serious";
  return "info";
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  ...rest
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: "linear-gradient(155deg, var(--brass-400), var(--brass-600))", color: "#1c1607" },
    secondary: { background: "var(--surface-sunken)", color: "var(--ink-900)" },
    ghost: { background: "transparent", color: "var(--ink-700)", border: "1px solid var(--border-strong)" },
    danger: { background: "var(--status-critical-bg)", color: "var(--status-critical)" },
  };
  const sizeClass = size === "sm" ? "rounded-md px-2.5 py-1.5 text-[12px] font-semibold" : "rounded-lg px-3.5 py-2 text-[13px] font-bold";
  return (
    <button
      className={`${sizeClass} transition hover:brightness-110 disabled:opacity-45 disabled:cursor-not-allowed ${className}`}
      style={styles[variant]}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border" style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow-sm)" }}>
      <table className="w-full border-collapse text-left text-[13px]">{children}</table>
    </div>
  );
}

export function Th({ children }: { children?: ReactNode }) {
  return (
    <th
      className="border-b px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider"
      style={{ borderColor: "var(--border)", color: "var(--ink-400)" }}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className = "",
  ...rest
}: { children: ReactNode; className?: string } & React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={`border-b px-4 py-2.5 ${className}`} style={{ borderColor: "var(--border)" }} {...rest}>
      {children}
    </td>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div
        className="h-6 w-6 animate-spin rounded-full border-2 border-transparent"
        style={{ borderTopColor: "var(--brass-500)", borderRightColor: "var(--brass-200)" }}
      />
    </div>
  );
}

export function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed p-10 text-center text-sm" style={{ borderColor: "var(--border-strong)", color: "var(--ink-400)" }}>
      {label}
    </div>
  );
}
