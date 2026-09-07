import { useState } from "react";
import { useList } from "../api/hooks";
import { BarChartH, catColor, DonutChart } from "../components/charts";
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, StatTile, Table, Td, Th, statusTone } from "../components/ui";
import { monthLabel } from "../lib/date";
import { toast } from "../lib/toast";
import type {
  Area, Expense, FoodInventoryItem, InventoryItem, PurchaseOrder, StaffMember, Supplier, TaskItem,
} from "../types";

const TABS = ["Overview", "Staff", "Suppliers"] as const;

export function Reports() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");

  return (
    <div>
      <PageHeader
        title="Reports & Analytics"
        subtitle="Residence-wide performance, filterable by date, category and department."
        action={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => toast("Exporting to Excel… (simulated)")}>
              Export Excel
            </Button>
            <Button variant="ghost" onClick={() => toast("Exporting to PDF… (simulated)")}>
              Export PDF
            </Button>
          </div>
        }
      />

      <div className="mb-5 flex gap-1 rounded-xl p-1" style={{ background: "var(--surface-sunken)", width: "fit-content" }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="rounded-lg px-3.5 py-1.5 text-[13px] font-semibold"
            style={{
              background: tab === t ? "var(--surface)" : "transparent",
              color: tab === t ? "var(--ink-900)" : "var(--ink-500)",
              boxShadow: tab === t ? "var(--shadow-sm)" : "none",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && <OverviewTab />}
      {tab === "Staff" && <StaffTab />}
      {tab === "Suppliers" && <SuppliersTab />}
    </div>
  );
}

function OverviewTab() {
  const { data: expenses, isLoading: l1 } = useList<Expense>("expenses", "/expenses");
  const { data: tasks, isLoading: l2 } = useList<TaskItem>("tasks", "/tasks");
  const { data: areas, isLoading: l3 } = useList<Area>("areas", "/areas");
  const { data: inventory } = useList<InventoryItem>("inventory", "/inventory");
  const { data: food } = useList<FoodInventoryItem>("food-inventory", "/kitchen/food-inventory");

  if (l1 || l2 || l3) return <Spinner />;

  const totalSpend = (expenses ?? []).reduce((s, e) => s + e.amount, 0);
  const invValue = (inventory ?? []).reduce((s, i) => s + i.stock * i.avg_price, 0);
  const foodValue = (food ?? []).reduce((s, f) => s + f.qty * f.cost, 0);
  const doneTasks = (tasks ?? []).filter((t) => t.status === "Completed" || t.status === "Verified").length;
  const taskPct = tasks?.length ? Math.round((doneTasks / tasks.length) * 100) : 0;
  const scoredAreas = (areas ?? []).filter((a) => a.last_score != null);
  const hkAvg = scoredAreas.length ? Math.round(scoredAreas.reduce((s, a) => s + (a.last_score ?? 0), 0) / scoredAreas.length) : 0;

  const monthTotals: Record<string, number> = {};
  for (const e of expenses ?? []) monthTotals[monthLabel(e.date)] = (monthTotals[monthLabel(e.date)] ?? 0) + e.amount;
  const monthRows = Object.entries(monthTotals).map(([label, value]) => ({ label, value, color: "var(--brass-500)" }));

  const catTotals: Record<string, number> = {};
  for (const e of expenses ?? []) catTotals[e.category] = (catTotals[e.category] ?? 0) + e.amount;
  const catKeys = Object.keys(catTotals).sort((a, b) => catTotals[b] - catTotals[a]);
  const donutSegs = catKeys.map((c, i) => ({ label: c, value: catTotals[c], color: catColor(i) }));

  const taskCat: Record<string, { done: number; total: number }> = {};
  for (const t of tasks ?? []) {
    taskCat[t.category] ??= { done: 0, total: 0 };
    taskCat[t.category].total++;
    if (t.status === "Completed" || t.status === "Verified") taskCat[t.category].done++;
  }
  const taskCatRows = Object.entries(taskCat).map(([label, v], i) => ({
    label, value: v.total ? Math.round((v.done / v.total) * 100) : 0, color: catColor(i),
  }));

  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Total Spend" icon="expenses" value={`KWD ${totalSpend.toFixed(0)}`} />
        <StatTile label="Inventory Value" icon="inventory" value={`KWD ${(invValue + foodValue).toFixed(0)}`} />
        <StatTile label="Task Completion" icon="tasks" value={`${taskPct}%`} progress={taskPct} progressColor="var(--status-good)" />
        <StatTile label="Housekeeping Avg" icon="housekeeping" value={`${hkAvg}%`} progress={hkAvg} progressColor="var(--brass-500)" />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 text-[15px] font-semibold">Monthly residence expenditure</h3>
          {monthRows.length === 0 ? <EmptyState label="No expense history yet." /> : <BarChartH rows={monthRows} fmt={(v) => `KWD ${v.toFixed(0)}`} />}
        </Card>
        <Card>
          <h3 className="mb-3 text-[15px] font-semibold">Spend by category</h3>
          {donutSegs.length === 0 ? <EmptyState label="No expenses logged yet." /> : (
            <div className="flex flex-wrap items-center gap-4">
              <DonutChart segments={donutSegs} centerValue={String(catKeys.length)} centerSub="categories" />
              <div className="flex min-w-[140px] flex-1 flex-col gap-2">
                {catKeys.map((c, i) => (
                  <div key={c} className="flex items-center gap-2 text-[12.5px]">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: catColor(i) }} />
                    <span style={{ color: "var(--ink-700)" }}>{c}</span>
                    <span className="ml-auto tabular-nums" style={{ color: "var(--ink-400)" }}>KWD {catTotals[c].toFixed(0)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <h3 className="mb-3 text-[15px] font-semibold">Task completion by category</h3>
        {taskCatRows.length === 0 ? <EmptyState label="No tasks logged yet." /> : <BarChartH rows={taskCatRows} fmt={(v) => `${v}%`} />}
      </Card>
    </div>
  );
}

function StaffTab() {
  const { data: staff, isLoading } = useList<StaffMember>("staff", "/people/staff");
  const { data: tasks } = useList<TaskItem>("tasks", "/tasks");

  if (isLoading) return <Spinner />;
  if (!staff || staff.length === 0) return <EmptyState label="No staff on file." />;

  return (
    <Card>
      <h3 className="mb-3 text-[15px] font-semibold">Attendance & task load by staff member</h3>
      <Table>
        <thead><tr><Th>Staff</Th><Th>Position</Th><Th>Status</Th><Th>Assigned Tasks</Th><Th>Completed</Th><Th>Completion</Th></tr></thead>
        <tbody>
          {staff.map((s) => {
            const mine = (tasks ?? []).filter((t) => t.assignee_id === s.id);
            const done = mine.filter((t) => t.status === "Completed" || t.status === "Verified").length;
            const pct = mine.length ? Math.round((done / mine.length) * 100) : 0;
            return (
              <tr key={s.id}>
                <Td className="font-medium">{s.name}</Td>
                <Td>{s.position}</Td>
                <Td><Badge tone={statusTone(s.status)}>{s.status}</Badge></Td>
                <Td>{mine.length}</Td>
                <Td>{done}</Td>
                <Td>{pct}%</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}

function SuppliersTab() {
  const { data: orders, isLoading } = useList<PurchaseOrder>("purchase-orders", "/purchasing/purchase-orders");
  const { data: suppliers } = useList<Supplier>("suppliers", "/suppliers");

  if (isLoading) return <Spinner />;

  const spend: Record<string, number> = {};
  for (const o of orders ?? []) spend[o.supplier_id] = (spend[o.supplier_id] ?? 0) + o.total;
  const supplierName = (id: string) => suppliers?.find((s) => s.id === id)?.name ?? id;
  const rows = Object.entries(spend)
    .sort((a, b) => b[1] - a[1])
    .map(([id, value], i) => ({ label: supplierName(id), value, color: catColor(i) }));

  return (
    <Card>
      <h3 className="mb-3 text-[15px] font-semibold">Supplier spend (from purchase orders)</h3>
      {rows.length === 0 ? <EmptyState label="No purchase orders yet." /> : <BarChartH rows={rows} fmt={(v) => `KWD ${v.toFixed(0)}`} />}
    </Card>
  );
}
