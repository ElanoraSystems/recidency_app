import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useList } from "../api/hooks";
import { useAuth } from "../auth/AuthContext";
import { BarChartH, catColor } from "../components/charts";
import { Icon } from "../components/icons";
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Spinner, StatTile, statusTone } from "../components/ui";
import { daysLabel, daysUntil, todayIso } from "../lib/date";
import { NewTaskModal } from "./Tasks";
import type { ApprovalItem, DashboardSummary, FoodInventoryItem, InventoryItem, MealCategory, MealLogEntry, PurchaseOrder, PurchaseRequest, StaffMember, TaskItem } from "../types";

// Only fetch what this person's modules need; the keys match the module
// screens, so the data is shared rather than loaded twice.
function useModuleList<T>(enabled: boolean, key: string, endpoint: string) {
  return useQuery<T[]>({ queryKey: [key], queryFn: async () => (await api.get(endpoint)).data, enabled });
}

interface Attention { key: string; tone: "critical" | "warning" | "info"; kind: string; title: string; sub: string; to: string }
const TONE_RANK = { critical: 0, warning: 1, info: 2 };
const APPROVAL_LINK: Record<ApprovalItem["type"], string> = {
  purchase_request: "/purchasing", purchase_order: "/purchasing", grn: "/purchasing",
  proposed_menu: "/kitchen", weekly_meal_plan: "/kitchen", waste_log: "/kitchen",
  asset: "/maintenance", maintenance_confirmation: "/maintenance", leave_request: "/people", task_review: "/tasks?due=review",
};

export function Dashboard() {
  const { user, hasModule } = useAuth();
  const [modal, setModal] = useState<"task" | null>(null);
  const [showAll, setShowAll] = useState(false);
  const tasksOn = hasModule("tasks"), inventoryOn = hasModule("inventory"), purchasingOn = hasModule("purchasing"), kitchenOn = hasModule("kitchen");

  const { data: summary, isLoading } = useQuery<DashboardSummary>({
    queryKey: ["dashboard-summary"],
    queryFn: async () => (await api.get("/dashboard/summary")).data,
  });
  const { data: approvals } = useList<ApprovalItem>("approvals", "/approvals");
  const { data: tasks } = useModuleList<TaskItem>(tasksOn, "tasks", "/tasks");
  const { data: staff } = useModuleList<StaffMember>(tasksOn, "staff", "/people/staff");
  const { data: general } = useModuleList<InventoryItem>(inventoryOn, "inventory", "/inventory");
  const { data: food } = useModuleList<FoodInventoryItem>(inventoryOn, "food-inventory", "/kitchen/food-inventory");
  const { data: requests } = useModuleList<PurchaseRequest>(purchasingOn, "purchase-requests", "/purchasing/purchase-requests");
  const { data: orders } = useModuleList<PurchaseOrder>(purchasingOn, "purchase-orders", "/purchasing/purchase-orders");
  const { data: meals } = useModuleList<MealLogEntry>(kitchenOn, "meal-log", "/kitchen/meal-log");

  if (isLoading || !summary) return <Spinner />;

  const today = todayIso();
  const done = (t: TaskItem) => t.status === "Completed" || t.status === "Verified";
  const staffName = (id: string | null) => staff?.find((m) => m.id === id)?.name ?? "Unassigned";
  const todaysTasks = (tasks ?? []).filter((t) => t.due_date === today);
  const doneToday = todaysTasks.filter(done).length;
  const taskPct = todaysTasks.length ? Math.round((doneToday / todaysTasks.length) * 100) : 0;
  const overdue = (tasks ?? []).filter((t) => !done(t) && t.due_date < today).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const todoNow = [...overdue, ...todaysTasks.filter((t) => !done(t))];

  // Stock that needs a person: out, below its minimum, or close to its date.
  const stock = [
    ...(general ?? []).map((i) => ({ id: i.id, name: i.name, qty: i.stock, unit: i.unit, min: i.min, max: i.max, expiry: i.expiry })),
    ...(food ?? []).map((f) => ({ id: f.id, name: f.name, qty: f.qty, unit: f.unit, min: f.min, max: f.max, expiry: f.expiry })),
  ];
  const outOrLow = stock.filter((r) => (r.qty <= 0 ? r.min > 0 || r.max > 0 : r.qty < r.min));
  const expired = stock.filter((r) => r.qty > 0 && r.expiry && daysUntil(r.expiry) < 0);
  const expiring = stock.filter((r) => r.qty > 0 && r.expiry && daysUntil(r.expiry) >= 0 && daysUntil(r.expiry) <= 7);
  const stockAttention = outOrLow.length + expired.length;

  const toApprove = (requests ?? []).filter((r) => r.status === "Submitted").length + (orders ?? []).filter((o) => o.status === "Submitted").length;
  const readyToOrder = (requests ?? []).filter((r) => r.status === "Approved").length;
  const dueToReceive = (orders ?? []).filter((o) => (o.status === "Approved" || o.status === "Partially Received") && o.expected_date && o.expected_date <= today);
  const purchasingAction = toApprove + readyToOrder + dueToReceive.length;

  const posted = (meals ?? []).filter((m) => m.status !== "Draft" && m.date === today);
  const servedToday = posted.reduce((s, m) => s + m.lines.reduce((n, l) => n + l.qty, 0), 0);
  const consumptionToday = posted.reduce((s, m) => s + m.total, 0);

  const kpis: { key: string; to: string; node: React.ReactNode }[] = [];
  if (tasksOn) {
    kpis.push({ key: "today", to: "/tasks?due=today", node: <StatTile label="Today's tasks" icon="tasks" value={`${taskPct}%`} suffix="done" progress={taskPct} sub={`${doneToday} of ${todaysTasks.length} complete`} /> });
    kpis.push({ key: "overdue", to: "/tasks?due=overdue", node: <StatTile label="Overdue tasks" icon="alertTriangle" value={overdue.length} tone={overdue.length > 0 ? "critical" : "neutral"} sub={overdue.length ? "Need follow-up" : "Nothing overdue"} /> });
  }
  if (inventoryOn) kpis.push({ key: "stock", to: "/inventory", node: <StatTile label="Stock needs attention" icon="inventory" value={stockAttention} tone={stockAttention > 0 ? "critical" : "neutral"} sub={`${outOrLow.length} out or low · ${expired.length} expired · ${expiring.length} expiring soon`} /> });
  if (purchasingOn) kpis.push({ key: "purchasing", to: "/purchasing", node: <StatTile label="Purchasing needs action" icon="purchasing" value={purchasingAction} tone={purchasingAction > 0 ? "warning" : "neutral"} sub={`${toApprove} to approve · ${readyToOrder} to order · ${dueToReceive.length} to receive`} /> });
  if (kitchenOn) kpis.push({ key: "kitchen", to: "/kitchen", node: <StatTile label="Meals served today" icon="kitchen" value={servedToday} sub={`KWD ${consumptionToday.toFixed(2)} consumption value`} /> });

  // Everything that needs a person, most serious first.
  const attention: Attention[] = [
    ...overdue.slice(0, 6).map((t): Attention => ({ key: `t${t.id}`, tone: "critical", kind: "Overdue", title: t.title, sub: `${staffName(t.assignee_id)} · ${daysLabel(daysUntil(t.due_date))}`, to: "/tasks?due=overdue" })),
    ...outOrLow.slice(0, 6).map((r): Attention => ({ key: `s${r.id}`, tone: "critical", kind: r.qty <= 0 ? "Out of stock" : "Low stock", title: r.name, sub: `${r.qty} ${r.unit} left · minimum ${r.min}`, to: "/inventory" })),
    ...expired.slice(0, 4).map((r): Attention => ({ key: `x${r.id}`, tone: "critical", kind: "Expired", title: r.name, sub: `${r.qty} ${r.unit} · ${daysLabel(daysUntil(r.expiry!))}`.replace("overdue", "past its date"), to: "/inventory" })),
    ...expiring.slice(0, 4).map((r): Attention => ({ key: `e${r.id}`, tone: "warning", kind: "Expiring", title: r.name, sub: `${r.qty} ${r.unit} · expires ${daysLabel(daysUntil(r.expiry!))}`, to: "/inventory" })),
    ...dueToReceive.slice(0, 4).map((o): Attention => ({ key: `o${o.id}`, tone: "warning", kind: "Delivery due", title: o.code, sub: `Expected ${daysLabel(daysUntil(o.expected_date!))} · KWD ${o.total.toFixed(3)}`, to: "/purchasing?tab=Purchase%20Orders" })),
    ...(approvals ?? []).slice(0, 8).map((a): Attention => ({ key: `a${a.type}${a.id}`, tone: "info", kind: "Approval", title: a.title, sub: a.sub, to: APPROVAL_LINK[a.type] ?? "/" })),
  ].sort((x, y) => TONE_RANK[x.tone] - TONE_RANK[y.tone]);
  const visible = showAll ? attention : attention.slice(0, 8);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const toneColor = { critical: "var(--status-critical)", warning: "var(--status-warning)", info: "var(--status-info)" };

  return (
    <div>
      <PageHeader
        title={`${greeting}, ${user?.name.split(" ")[0]}`}
        subtitle={new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + " · Residence overview at a glance"}
        action={
          tasksOn && (
            <Button onClick={() => setModal("task")}>
              <span className="flex items-center gap-1.5"><Icon name="plus" className="h-3.5 w-3.5" />New Task</span>
            </Button>
          )
        }
      />

      {user?.user_type === "staff" && <MyAttendanceLeaveCard />}

      <div className="mb-5 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
        {kpis.map((k) => <Link key={k.key} to={k.to} className="block">{k.node}</Link>)}
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-[15px] font-semibold">Needs attention</h3>
            <span className="text-xs" style={{ color: "var(--ink-400)" }}>{attention.length} item{attention.length === 1 ? "" : "s"}</span>
          </div>
          {attention.length === 0 ? (
            <EmptyRow label="All clear — nothing needs attention right now" />
          ) : (
            <div className="flex flex-col">
              {visible.map((a) => (
                <Link key={a.key} to={a.to} className="flex items-center gap-3 border-t py-2.5 first:border-t-0 first:pt-0" style={{ borderColor: "var(--border)" }}>
                  <span className="w-[92px] shrink-0 text-[11px] font-extrabold uppercase tracking-wide" style={{ color: toneColor[a.tone] }}>{a.kind}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{a.title}</div>
                    <div className="truncate text-[12px]" style={{ color: "var(--ink-500)" }}>{a.sub}</div>
                  </div>
                  <span className="text-[12px] font-semibold" style={{ color: "var(--brass-600)" }}>Open</span>
                </Link>
              ))}
              {attention.length > 8 && (
                <button type="button" className="mt-2 self-start text-[12.5px] font-semibold" style={{ color: "var(--brass-600)" }} onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "Show fewer" : `Show all ${attention.length}`}
                </button>
              )}
            </div>
          )}
        </Card>

        {tasksOn && (
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-[15px] font-semibold">Tasks to do now</h3>
              <Link to="/tasks" className="text-xs font-semibold" style={{ color: "var(--brass-600)" }}>All tasks</Link>
            </div>
            {todoNow.length === 0 ? (
              <EmptyRow label={todaysTasks.length ? "Everything due today is done" : "No tasks due today"} />
            ) : (
              <div className="flex flex-col">
                {todoNow.slice(0, 8).map((t) => (
                  <Link key={t.id} to="/tasks" className="flex items-center gap-3 border-t py-2.5 first:border-t-0 first:pt-0" style={{ borderColor: "var(--border)" }}>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.priority === "High" ? "var(--status-critical)" : t.priority === "Low" ? "var(--status-good)" : "var(--status-warning)" }} title={`${t.priority} priority`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold">{t.title}</div>
                      <div className="truncate text-[12px]" style={{ color: t.due_date < today ? "var(--status-critical)" : "var(--ink-500)" }}>
                        {staffName(t.assignee_id)} · {t.due_date < today ? daysLabel(daysUntil(t.due_date)) : "due today"}
                      </div>
                    </div>
                    <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                  </Link>
                ))}
                {todoNow.length > 8 && <div className="pt-2 text-[12px]" style={{ color: "var(--ink-400)" }}>and {todoNow.length - 8} more</div>}
              </div>
            )}
          </Card>
        )}
      </div>

      {kitchenOn && <KitchenConsumptionCard />}

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
  // Drafts have not served anything yet; only submitted-onward meals count.
  const posted = (mealLog ?? []).filter((m) => m.status !== "Draft");
  const portions = (m: MealLogEntry) => m.lines.reduce((s, l) => s + l.qty, 0);
  const todayLogs = posted.filter((m) => m.date === today);
  const monthLogs = posted.filter((m) => m.date.slice(0, 7) === monthPrefix);
  const todayValue = todayLogs.reduce((s, m) => s + m.total, 0);
  const monthValue = monthLogs.reduce((s, m) => s + m.total, 0);
  const todayServed = todayLogs.reduce((s, m) => s + portions(m), 0);
  const monthServed = monthLogs.reduce((s, m) => s + portions(m), 0);
  const avgCost = monthServed ? monthValue / monthServed : 0;

  const byCat: Record<string, number> = {};
  for (const m of monthLogs) byCat[m.cost_center] = (byCat[m.cost_center] ?? 0) + m.total;
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
          <h3 className="mb-3 text-[15px] font-semibold">Consumption value by cost center — this month</h3>
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

