import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { api } from "../api/client";
import { useList } from "../api/hooks";
import { useAuth } from "../auth/AuthContext";
import { BarChartH, catColor } from "../components/charts";
import { Icon } from "../components/icons";
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Spinner, StatTile } from "../components/ui";
import { todayIso } from "../lib/date";
import { NewTaskModal } from "./Tasks";
import type { ApprovalItem, DashboardSummary, InventoryItem, MealCategory, MealLogEntry, TaskItem } from "../types";

export function Dashboard() {
  const { user, hasModule } = useAuth();
  const [modal, setModal] = useState<"task" | null>(null);

  const { data: summary, isLoading } = useQuery<DashboardSummary>({
    queryKey: ["dashboard-summary"],
    queryFn: async () => (await api.get("/dashboard/summary")).data,
  });
  const { data: approvals } = useList<ApprovalItem>("approvals", "/approvals");
  const { data: inventory } = useList<InventoryItem>("inventory", "/inventory");
  const { data: tasks } = useList<TaskItem>("tasks", "/tasks");

  if (isLoading || !summary) return <Spinner />;

  const today = todayIso();
  const todaysTasks = tasks?.filter((t) => t.due_date === today) ?? [];
  const doneToday = todaysTasks.filter((t) => t.status === "Completed" || t.status === "Verified").length;
  const taskPct = todaysTasks.length ? Math.round((doneToday / todaysTasks.length) * 100) : 0;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div>
      <PageHeader
        title={`${greeting}, ${user?.name.split(" ")[0]}`}
        subtitle={new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + " · Residence overview at a glance"}
        action={
          hasModule("tasks") && (
            <Button onClick={() => setModal("task")}>
              <span className="flex items-center gap-1.5"><Icon name="plus" className="h-3.5 w-3.5" />New Task</span>
            </Button>
          )
        }
      />

      {user?.user_type === "staff" && <MyAttendanceLeaveCard />}

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatTile
          label="Today's Tasks" icon="tasks" value={`${taskPct}%`} suffix="done"
          progress={taskPct} sub={`${doneToday} of ${todaysTasks.length} complete`}
        />
        <StatTile
          label="Inventory" icon="inventory" value={summary.low_stock_items} suffix="low stock"
          progress={inventory?.length ? (summary.low_stock_items / inventory.length) * 100 : 0}
          progressColor="var(--status-critical)" sub={`of ${inventory?.length ?? 0} items tracked`}
        />
        <StatTile label="Purchasing" icon="purchasing" value={summary.purchasing_pending} suffix="requests" sub="awaiting approval" />
      </div>

      <Card className="mb-6">
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

      {hasModule("kitchen") && <KitchenConsumptionCard />}

      {modal === "task" && <NewTaskModal initial={{}} onClose={() => setModal(null)} />}
    </div>
  );
}

function KitchenConsumptionCard() {
  const { data: mealLog } = useList<MealLogEntry>("meal-log", "/kitchen/meal-log");
  const { data: mealCategoriesRaw } = useList<MealCategory>("meal-categories", "/kitchen/meal-categories");
  // The generic list endpoint always sorts descending, so re-sort A-Z here
  // rather than showing categories in a confusing, effectively-random order.
  const mealCategories = [...(mealCategoriesRaw ?? [])].sort((a, b) => a.label.localeCompare(b.label));

  const today = todayIso();
  const monthPrefix = today.slice(0, 7);
  const todayLogs = (mealLog ?? []).filter((m) => m.date === today);
  const monthLogs = (mealLog ?? []).filter((m) => m.date.slice(0, 7) === monthPrefix);
  const todayValue = todayLogs.reduce((s, m) => s + m.qty * m.unit_cost, 0);
  const monthValue = monthLogs.reduce((s, m) => s + m.qty * m.unit_cost, 0);
  const todayServed = todayLogs.reduce((s, m) => s + m.qty, 0);
  const monthServed = monthLogs.reduce((s, m) => s + m.qty, 0);
  const avgCost = monthServed ? monthValue / monthServed : 0;

  const byCat: Record<string, number> = {};
  for (const m of monthLogs) byCat[m.category] = (byCat[m.category] ?? 0) + m.qty * m.unit_cost;
  const catKeys = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);
  const catRows = catKeys.map((c, i) => ({ label: c, value: byCat[c], color: catColor(i) }));

  return (
    <div className="mb-6">
      <h3 className="mb-3 font-display text-[15px] font-semibold">Kitchen consumption</h3>
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Today's Consumption Value" icon="scale" value={`KWD ${todayValue.toFixed(2)}`} sub={`${todayServed} meals served today`} />
        <StatTile label="This Month's Consumption Value" icon="scale" value={`KWD ${monthValue.toFixed(2)}`} sub={`${monthServed} meals served this month`} />
        <StatTile label="Meals Served Today" icon="kitchen" value={todayServed} sub={`${todayLogs.length} entries logged`} />
        <StatTile label="Avg Recipe Cost / Meal" icon="expenses" value={`KWD ${avgCost.toFixed(3)}`} sub="Month to date" />
      </div>
      <p className="mb-4 text-[12px]" style={{ color: "var(--ink-400)" }}>
        Consumption value is the recipe-costed value of meals served — useful for tracking usage and portion control, but it is not the residence's food expense (that's purchases, tracked under Purchasing).
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 text-[15px] font-semibold">Consumption value by category — this month</h3>
          {catRows.length === 0 ? <EmptyState label="No meals logged this month yet." /> : <BarChartH rows={catRows} fmt={(v) => `KWD ${v.toFixed(2)}`} />}
        </Card>
        <Card>
          <h3 className="mb-3 text-[15px] font-semibold">Meal categories tracked</h3>
          <div className="flex flex-wrap gap-2">
            {mealCategories.length === 0 ? (
              <span className="text-xs" style={{ color: "var(--ink-400)" }}>None configured — add some in Settings → Meal Categories.</span>
            ) : mealCategories.map((c) => <Badge key={c.id}>{c.label}</Badge>)}
          </div>
        </Card>
      </div>
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

function EmptyRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-3 text-[12.5px]" style={{ color: "var(--ink-400)" }}>
      <Icon name="info" className="h-4 w-4" />
      {label}
    </div>
  );
}

