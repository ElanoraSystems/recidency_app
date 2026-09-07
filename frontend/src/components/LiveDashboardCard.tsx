import { Icon } from "./icons";

// A tiny, honest preview of the real Tasks module — not a stock illustration.
// Each checkbox ticks itself off in a staggered loop, echoing how the actual
// task board behaves once you're signed in.
const TASKS = ["Prepare lunch menu", "Log meal served", "Restock pantry"];

export function LiveDashboardCard({ style }: { style?: React.CSSProperties }) {
  return (
    <div
      className="login-dashboard-card absolute w-[196px] rounded-2xl border p-3.5 shadow-lg"
      style={{
        background: "rgba(28, 32, 26, 0.6)",
        backdropFilter: "blur(12px)",
        borderColor: "var(--rail-border)",
        boxShadow: "0 12px 32px -12px rgba(0,0,0,0.5)",
        ...style,
      }}
    >
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--rail-text-dim)" }}>
          Today&rsquo;s Tasks
        </span>
        <Icon name="tasks" className="h-3.5 w-3.5" style={{ color: "var(--rail-accent)" }} />
      </div>

      <div className="mb-3 flex flex-col gap-2">
        {TASKS.map((t, i) => (
          <div key={t} className="flex items-center gap-2">
            <span
              className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border text-[9px] font-bold"
              style={{ borderColor: "var(--rail-accent)", color: "var(--rail-accent)" }}
            >
              <span className="login-task-check" style={{ animationDelay: `${i * 850}ms` }}>
                ✓
              </span>
            </span>
            <span
              className="login-task-text text-[11px]"
              style={{ color: "var(--rail-text)", animationDelay: `${i * 850}ms` }}
            >
              {t}
            </span>
          </div>
        ))}
      </div>

      <div className="h-1 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.1)" }}>
        <div className="login-progress-bar h-full rounded-full" style={{ background: "var(--rail-accent)" }} />
      </div>
    </div>
  );
}
