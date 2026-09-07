import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../components/icons";
import { useNotifications } from "../lib/notifications";

const PRIORITY_COLOR: Record<string, string> = {
  Critical: "var(--status-critical)",
  High: "var(--status-serious)",
  Medium: "var(--status-warning)",
};

export function NotificationBell() {
  const { notifications } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-[9px] border"
        style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--ink-700)" }}
        title="Notifications"
      >
        <Icon name="bell" className="h-[17px] w-[17px]" />
        {notifications.length > 0 && (
          <span
            className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full border"
            style={{ background: "var(--status-critical)", borderColor: "var(--surface)" }}
          />
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+8px)] z-50 max-h-[70vh] w-[360px] max-w-[86vw] overflow-y-auto rounded-xl border"
          style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow-lg)" }}
        >
          <div
            className="flex items-center justify-between border-b px-4 py-3"
            style={{ borderColor: "var(--border)" }}
          >
            <h3 className="text-[14px] font-semibold" style={{ color: "var(--ink-900)" }}>Notifications</h3>
            <span className="status-pill" style={{ background: "var(--status-neutral-bg)", color: "var(--ink-700)" }}>
              {notifications.length}
            </span>
          </div>
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center" style={{ color: "var(--ink-400)" }}>
              <Icon name="checkCircle" className="h-6 w-6" />
              <span className="text-[13px]">All clear — no alerts.</span>
            </div>
          ) : (
            notifications.slice(0, 14).map((n) => (
              <button
                key={n.id}
                onClick={() => { navigate(n.route); setOpen(false); }}
                className="flex w-full items-start gap-2.5 border-b px-4 py-3 text-left last:border-b-0 hover:bg-[var(--surface-hover)]"
                style={{ borderColor: "var(--border)" }}
              >
                <Icon
                  name={n.priority === "Critical" || n.priority === "High" ? "alertTriangle" : "info"}
                  className="mt-0.5 h-4 w-4 shrink-0"
                  style={{ color: PRIORITY_COLOR[n.priority] }}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold" style={{ color: "var(--ink-900)" }}>{n.title}</div>
                  <div className="truncate text-[11.5px]" style={{ color: "var(--ink-400)" }}>{n.sub}</div>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
