import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { api } from "../api/client";
import { useList } from "../api/hooks";
import { useAuth } from "../auth/AuthContext";
import { BarChartH, catColor, DonutChart } from "../components/charts";
import { Icon } from "../components/icons";
import { Badge, Button, Card, Modal, PageHeader, Spinner, StatTile } from "../components/ui";
import { daysLabel, daysUntil, monthLabel, todayIso } from "../lib/date";
import { NewExpenseModal } from "./Expenses";
import { NewTaskModal } from "./Tasks";
import type {
  ApprovalItem, Area, Asset, DashboardSummary, DocumentItem, EventItem, Expense,
  Guest, InventoryItem, MaintenanceRequest, PmScheduleItem, ResidenceSettingsInfo, TaskItem, Vehicle,
} from "../types";

export function Dashboard() {
  const { user, hasModule } = useAuth();
  const [modal, setModal] = useState<"task" | "expense" | null>(null);

  const { data: summary, isLoading } = useQuery<DashboardSummary>({
    queryKey: ["dashboard-summary"],
    queryFn: async () => (await api.get("/dashboard/summary")).data,
  });
  const { data: residence } = useQuery<ResidenceSettingsInfo>({
    queryKey: ["residence"],
    queryFn: async () => (await api.get("/settings/residence")).data,
  });
  const { data: expenses } = useList<Expense>("expenses", "/expenses");
  const { data: approvals } = useList<ApprovalItem>("approvals", "/approvals");
  const { data: areas } = useList<Area>("areas", "/areas");
  const { data: inventory } = useList<InventoryItem>("inventory", "/inventory");
  const { data: maintenanceRequests } = useList<MaintenanceRequest>("maintenance-requests", "/maintenance-requests");
  const { data: tasks } = useList<TaskItem>("tasks", "/tasks");
  const { data: guests } = useList<Guest>("guests", "/guests");
  const { data: events } = useList<EventItem>("events", "/events");
  const { data: documents } = useList<DocumentItem>("documents", "/documents");
  const { data: pmSchedule } = useList<PmScheduleItem>("pm-schedule", "/pm-schedule");
  const { data: assets } = useList<Asset>("assets", "/assets");
  const { data: vehicles } = useList<Vehicle>("vehicles", "/vehicles");

  if (isLoading || !summary) return <Spinner />;

  const today = todayIso();
  const todaysTasks = tasks?.filter((t) => t.due_date === today) ?? [];
  const doneToday = todaysTasks.filter((t) => t.status === "Completed" || t.status === "Verified").length;
  const taskPct = todaysTasks.length ? Math.round((doneToday / todaysTasks.length) * 100) : 0;

  const expByCat: Record<string, number> = {};
  (expenses ?? []).forEach((e) => { expByCat[e.category] = (expByCat[e.category] ?? 0) + e.amount; });
  const catKeys = Object.keys(expByCat);
  const donutSegs = catKeys.map((k, i) => ({ label: k, value: expByCat[k], color: catColor(i) }));

  const monthByLabel: Record<string, number> = {};
  (expenses ?? []).forEach((e) => {
    const label = monthLabel(e.date);
    monthByLabel[label] = (monthByLabel[label] ?? 0) + e.amount;
  });
  const monthRows = Object.entries(monthByLabel).map(([label, value]) => ({ label, value, color: "var(--brass-500)" }));

  const upcomingGuests = [...(guests ?? [])].sort((a, b) => a.arrival.localeCompare(b.arrival)).slice(0, 3);
  const upcomingEvents = [...(events ?? [])].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
  const expDocs = (documents ?? [])
    .filter((d) => d.expiry && daysUntil(d.expiry) <= 30)
    .sort((a, b) => daysUntil(a.expiry!) - daysUntil(b.expiry!))
    .slice(0, 5);
  const pmDue = (pmSchedule ?? [])
    .filter((p) => daysUntil(p.due_date) <= 30)
    .sort((a, b) => daysUntil(a.due_date) - daysUntil(b.due_date))
    .slice(0, 4);
  const assetName = (id: string) => assets?.find((a) => a.id === id)?.name ?? "";

  const vehAlerts: { name: string; type: string; days: number }[] = [];
  (vehicles ?? []).forEach((v) => {
    if (v.insurance_expiry && daysUntil(v.insurance_expiry) <= 30) vehAlerts.push({ name: v.name, type: "Insurance", days: daysUntil(v.insurance_expiry) });
    if (v.reg_expiry && daysUntil(v.reg_expiry) <= 30) vehAlerts.push({ name: v.name, type: "Registration", days: daysUntil(v.reg_expiry) });
    if (v.next_service && daysUntil(v.next_service) <= 14) vehAlerts.push({ name: v.name, type: "Service", days: daysUntil(v.next_service) });
  });
  vehAlerts.sort((a, b) => a.days - b.days);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div>
      <PageHeader
        title={`${greeting}, ${user?.name.split(" ")[0]}`}
        subtitle={new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + " · Residence overview at a glance"}
        action={
          <div className="flex gap-2">
            {hasModule("expenses") && (
              <Button variant="secondary" onClick={() => setModal("expense")}>
                <span className="flex items-center gap-1.5"><Icon name="plus" className="h-3.5 w-3.5" />Log Expense</span>
              </Button>
            )}
            {hasModule("tasks") && (
              <Button onClick={() => setModal("task")}>
                <span className="flex items-center gap-1.5"><Icon name="plus" className="h-3.5 w-3.5" />New Task</span>
              </Button>
            )}
          </div>
        }
      />

      {user?.user_type === "staff" && <MyAttendanceLeaveCard />}

      <div className="mb-3.5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Staff Onsite" icon="people" value={summary.staff_onsite}
          sub={`${summary.staff_onsite} on the active roster`}
        />
        <StatTile
          label="Today's Tasks" icon="tasks" value={`${taskPct}%`} suffix="done"
          progress={taskPct} sub={`${doneToday} of ${todaysTasks.length} complete`}
        />
        <StatTile
          label="Housekeeping" icon="housekeeping" value={`${summary.housekeeping_avg_completion}%`}
          progress={summary.housekeeping_avg_completion} progressColor="var(--status-good)"
          sub={`${areas?.length ?? 0} areas tracked`}
        />
        <StatTile
          label="Maintenance" icon="maintenance" value={summary.maintenance_pending} suffix="pending"
          progress={maintenanceRequests?.length ? (summary.maintenance_pending / maintenanceRequests.length) * 100 : 0}
          progressColor="var(--status-warning)" sub={`of ${maintenanceRequests?.length ?? 0} total requests`}
        />
      </div>
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Inventory" icon="inventory" value={summary.low_stock_items} suffix="low stock"
          progress={inventory?.length ? (summary.low_stock_items / inventory.length) * 100 : 0}
          progressColor="var(--status-critical)" sub={`of ${inventory?.length ?? 0} items tracked`}
        />
        <StatTile label="Purchasing" icon="purchasing" value={summary.purchasing_pending} suffix="requests" sub="awaiting approval" />
        <StatTile label="Today's Expenses" icon="expenses" value={`KWD ${summary.today_spend.toFixed(0)}`} sub="logged today" />
        <StatTile
          label="Monthly Spend" icon="reports"
          value={`${residence ? Math.round((summary.month_spend / (residence.monthly_budget || 1)) * 100) : 0}%`}
          suffix="of budget"
          progress={residence ? Math.min((summary.month_spend / (residence.monthly_budget || 1)) * 100, 100) : 0}
          progressColor={residence && summary.month_spend > residence.monthly_budget ? "var(--status-critical)" : "var(--brass-500)"}
          sub={`KWD ${summary.month_spend.toFixed(0)} of ${residence ? `KWD ${residence.monthly_budget.toFixed(0)}` : "—"}`}
        />
      </div>

      <div className="mb-3.5 grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-[15px] font-semibold">Expense breakdown</h3>
            <span className="text-xs" style={{ color: "var(--ink-400)" }}>All time</span>
          </div>
          {donutSegs.length === 0 ? (
            <EmptyRow label="No expenses logged yet" />
          ) : (
            <div className="flex flex-wrap items-center gap-4">
              <DonutChart segments={donutSegs} centerValue={expenses ? String(expenses.reduce((s, e) => s + e.amount, 0).toFixed(0)) : "0"} centerSub="KWD spent" />
              <div className="flex min-w-[140px] flex-1 flex-col gap-2">
                {catKeys.map((c, i) => (
                  <div key={c} className="flex items-center gap-2 text-[12.5px]">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: catColor(i) }} />
                    <span style={{ color: "var(--ink-700)" }}>{c}</span>
                    <span className="ml-auto tabular-nums" style={{ color: "var(--ink-400)" }}>KWD {expByCat[c].toFixed(0)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-[15px] font-semibold">Expenditure by month</h3>
            <span className="text-xs" style={{ color: "var(--ink-400)" }}>Trend</span>
          </div>
          {monthRows.length === 0 ? <EmptyRow label="No expense history yet" /> : <BarChartH rows={monthRows} fmt={(v) => `KWD ${v.toFixed(0)}`} />}
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-[15px] font-semibold">Priority alerts</h3>
            <span className="text-xs" style={{ color: "var(--ink-400)" }}>{approvals?.length ?? 0} total</span>
          </div>
          <div className="flex max-h-[260px] flex-col gap-2 overflow-y-auto">
            {!approvals || approvals.length === 0 ? (
              <EmptyRow label="All clear — no urgent alerts" />
            ) : (
              approvals.slice(0, 6).map((a) => (
                <div
                  key={`${a.type}-${a.id}`}
                  className="flex items-start gap-2.5 rounded-lg p-2.5"
                  style={{ background: "var(--status-warning-bg)" }}
                >
                  <Icon name="alertTriangle" className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0" style={{ color: "var(--status-warning)" }}>
                    <div className="truncate text-[12.5px] font-semibold">{a.title}</div>
                    <div className="truncate text-[11.5px] opacity-80">{a.sub}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <div className="mb-3.5 grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-[15px] font-semibold">Upcoming guests</h3>
          </div>
          <div className="flex flex-col gap-3">
            {upcomingGuests.length === 0 ? <EmptyRow label="No guests scheduled" /> : upcomingGuests.map((g) => (
              <div key={g.id} className="flex items-center gap-3">
                <Avatar text={g.name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{g.name}</div>
                  <div className="truncate text-xs" style={{ color: "var(--ink-400)" }}>{g.count} guests · {g.room}</div>
                </div>
                <Badge tone="info">{daysLabel(daysUntil(g.arrival))}</Badge>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-[15px] font-semibold">Upcoming events</h3>
          </div>
          <div className="flex flex-col gap-3">
            {upcomingEvents.length === 0 ? <EmptyRow label="No events scheduled" /> : upcomingEvents.map((e) => (
              <div key={e.id} className="flex items-center gap-3">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                  style={{ background: "var(--brass-100)", color: "var(--brass-700)" }}
                >
                  <Icon name="events" className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{e.name}</div>
                  <div className="truncate text-xs" style={{ color: "var(--ink-400)" }}>{e.guests_count} guests · {e.location}</div>
                </div>
                <Badge>{daysLabel(daysUntil(e.date))}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card>
          <h3 className="mb-3 font-display text-[15px] font-semibold">Documents expiring</h3>
          <div className="flex flex-col gap-2.5">
            {expDocs.length === 0 ? <EmptyRow label="Nothing expiring soon" /> : expDocs.map((d) => (
              <MiniAlertRow key={d.id} title={d.name} sub={`${d.category} · ${daysLabel(daysUntil(d.expiry!))}`} critical={daysUntil(d.expiry!) <= 7} />
            ))}
          </div>
        </Card>
        <Card>
          <h3 className="mb-3 font-display text-[15px] font-semibold">Preventive maintenance</h3>
          <div className="flex flex-col gap-2.5">
            {pmDue.length === 0 ? <EmptyRow label="Nothing due soon" /> : pmDue.map((p) => (
              <MiniAlertRow key={p.id} title={assetName(p.asset_id)} sub={`${p.task} · ${daysLabel(daysUntil(p.due_date))}`} critical={daysUntil(p.due_date) < 0} />
            ))}
          </div>
        </Card>
        <Card>
          <h3 className="mb-3 font-display text-[15px] font-semibold">Vehicle reminders</h3>
          <div className="flex flex-col gap-2.5">
            {vehAlerts.length === 0 ? <EmptyRow label="All vehicles up to date" /> : vehAlerts.slice(0, 4).map((a, i) => (
              <MiniAlertRow key={i} title={a.name} sub={`${a.type} · ${daysLabel(a.days)}`} critical={a.days < 7} />
            ))}
          </div>
        </Card>
      </div>

      {modal === "task" && <NewTaskModal initial={{}} onClose={() => setModal(null)} />}
      {modal === "expense" && <NewExpenseModal onClose={() => setModal(null)} />}
    </div>
  );
}

interface MyAttendanceRow { id: string; date: string; check_in: string | null; check_out: string | null; status: string }
interface MyLeaveRow { id: string; type: string; from_date: string; to_date: string; days: number; status: string; reason: string | null; requested_on: string }
const LEAVE_TYPES = ["Annual Leave", "Sick Leave", "Unpaid Leave", "Emergency Leave", "Other"];

function MyAttendanceLeaveCard() {
  const qc = useQueryClient();
  const { data: attendance } = useQuery<MyAttendanceRow[]>({
    queryKey: ["my-attendance"],
    queryFn: async () => (await api.get("/people/attendance/mine")).data,
  });
  const { data: leaveRequests } = useQuery<MyLeaveRow[]>({
    queryKey: ["my-leave-requests"],
    queryFn: async () => (await api.get("/people/leave-requests/mine")).data,
  });
  const [leaveOpen, setLeaveOpen] = useState(false);
  const today = todayIso();
  const todayRecord = attendance?.find((a) => a.date === today);
  const pendingLeave = leaveRequests?.filter((l) => l.status === "Pending").length ?? 0;

  const checkIn = useMutation({
    mutationFn: async () => api.post("/people/attendance/checkin"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-attendance"] }),
  });
  const checkOut = useMutation({
    mutationFn: async () => api.post("/people/attendance/checkout"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-attendance"] }),
  });

  return (
    <Card className="mb-5 flex flex-wrap items-center justify-between gap-4">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>My Attendance Today</div>
        {todayRecord?.status === "Present" ? (
          <div className="mt-0.5 text-[13px]">
            Checked in at <span className="font-semibold">{todayRecord.check_in}</span>
            {todayRecord.check_out && <> · Checked out at <span className="font-semibold">{todayRecord.check_out}</span></>}
          </div>
        ) : todayRecord?.status === "Absent" ? (
          <div className="mt-0.5 text-[13px]" style={{ color: "var(--status-serious)" }}>Marked absent today</div>
        ) : (
          <div className="mt-0.5 text-[13px]" style={{ color: "var(--ink-400)" }}>Not checked in yet today</div>
        )}
      </div>
      <div className="flex items-center gap-2">
        {!todayRecord || todayRecord.status !== "Present" ? (
          <Button onClick={() => checkIn.mutate()} disabled={checkIn.isPending}>{checkIn.isPending ? "..." : "Check In"}</Button>
        ) : !todayRecord.check_out ? (
          <Button variant="secondary" onClick={() => checkOut.mutate()} disabled={checkOut.isPending}>{checkOut.isPending ? "..." : "Check Out"}</Button>
        ) : (
          <Badge tone="good">Shift complete</Badge>
        )}
        <Button variant="ghost" onClick={() => setLeaveOpen(true)}>
          + Request Leave{pendingLeave > 0 ? ` (${pendingLeave} pending)` : ""}
        </Button>
      </div>
      {leaveOpen && <RequestLeaveModal onClose={() => setLeaveOpen(false)} />}
    </Card>
  );
}

function RequestLeaveModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ type: LEAVE_TYPES[0], from_date: todayIso(), to_date: todayIso(), reason: "" });
  const [error, setError] = useState<string | null>(null);
  const submit = useMutation({
    mutationFn: async () => api.post("/people/leave-requests/mine", { ...form, reason: form.reason || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-leave-requests"] });
      qc.invalidateQueries({ queryKey: ["approvals"] });
      onClose();
    },
    onError: (err: unknown) => {
      const message = axios.isAxiosError(err) ? (err.response?.data as { detail?: string } | undefined)?.detail : undefined;
      setError(message ?? "Could not submit — please try again.");
    },
  });

  return (
    <Modal title="Request leave" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); setError(null); submit.mutate(); }} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-medium">Type
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.type} onChange={(e) => setForm((s) => ({ ...s, type: e.target.value }))}>
            {LEAVE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-medium">From date
            <input type="date" required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.from_date} onChange={(e) => setForm((s) => ({ ...s, from_date: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">To date
            <input type="date" required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.to_date} onChange={(e) => setForm((s) => ({ ...s, to_date: e.target.value }))} />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Reason (optional)
          <textarea placeholder="Optional details for your manager" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.reason} onChange={(e) => setForm((s) => ({ ...s, reason: e.target.value }))} />
        </label>
        {error && (
          <div className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--status-critical-bg)", color: "var(--status-critical)" }}>
            {error}
          </div>
        )}
        <Button type="submit" disabled={submit.isPending}>{submit.isPending ? "Submitting..." : "Submit request"}</Button>
      </form>
    </Modal>
  );
}

function Avatar({ text }: { text: string }) {
  const label = text.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
      style={{ background: "var(--brass-100)", color: "var(--brass-700)" }}
    >
      {label}
    </div>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-3 text-[12.5px]" style={{ color: "var(--ink-400)" }}>
      <Icon name="info" className="h-4 w-4" />
      {label}
    </div>
  );
}

function MiniAlertRow({ title, sub, critical }: { title: string; sub: string; critical: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: critical ? "var(--status-critical)" : "var(--status-warning)" }}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-semibold">{title}</div>
        <div className="truncate text-xs" style={{ color: "var(--ink-400)" }}>{sub}</div>
      </div>
    </div>
  );
}

