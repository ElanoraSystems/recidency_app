import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useCreate, useList } from "../api/hooks";
import { AttachmentsPanel } from "../components/AttachmentsPanel";
import { BarChartH, catColor, Sparkline } from "../components/charts";
import { Icon } from "../components/icons";
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Spinner, Table, Td, Th } from "../components/ui";
import { fmtDate, monthLabel, todayIso } from "../lib/date";
import type { Expense, ResidenceSettingsInfo } from "../types";

const CATEGORIES = [
  "Food", "Staff", "Maintenance", "Vehicles", "Utilities", "Residence Purchases",
  "Garden", "Pool", "Events", "Contractors", "Other",
];

export function ExpensesPage() {
  const { data, isLoading } = useList<Expense>("expenses", "/expenses");
  const { data: residence } = useQuery<ResidenceSettingsInfo>({
    queryKey: ["residence"],
    queryFn: async () => (await api.get("/settings/residence")).data,
  });
  const [addOpen, setAddOpen] = useState(false);
  const [category, setCategory] = useState("all");
  const [active, setActive] = useState<Expense | null>(null);

  const expenses = data ?? [];
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const budget = residence?.monthly_budget ?? 0;
  const util = budget ? Math.round((total / budget) * 100) : 0;

  const monthTotals: Record<string, number> = {};
  for (const e of expenses) monthTotals[monthLabel(e.date)] = (monthTotals[monthLabel(e.date)] ?? 0) + e.amount;
  const trendPoints = Object.entries(monthTotals).map(([label, value]) => ({ label, value }));

  const catTotals: Record<string, number> = {};
  for (const e of expenses) catTotals[e.category] = (catTotals[e.category] ?? 0) + e.amount;
  const catRows = Object.entries(catTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([label, value], i) => ({ label, value, color: catColor(i) }));

  const categories = Array.from(new Set(expenses.map((e) => e.category)));
  const filtered = expenses.filter((e) => category === "all" || e.category === category).sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle="Track spending against the monthly residence budget."
        action={<Button onClick={() => setAddOpen(true)}>+ Log Expense</Button>}
      />

      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <Card>
          <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>Monthly budget</div>
          <div className="mb-2 flex items-end justify-between">
            <span className="font-display text-2xl font-semibold">KWD {total.toFixed(0)}</span>
            <span className="text-xs" style={{ color: "var(--ink-500)" }}>of KWD {budget.toFixed(0)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--surface-sunken)" }}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(util, 100)}%`, background: util > 100 ? "var(--status-critical)" : "var(--brass-500)" }} />
          </div>
          <div className="mt-2 text-xs" style={{ color: "var(--ink-500)" }}>
            {util}% utilized · KWD {Math.max(budget - total, 0).toFixed(0)} remaining
          </div>
        </Card>

        <Card>
          <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>Spend trend</div>
          {trendPoints.length < 2 ? (
            <div className="text-[12.5px]" style={{ color: "var(--ink-400)" }}>Not enough history yet to chart a trend.</div>
          ) : (
            <>
              <Sparkline points={trendPoints} />
              <div className="mt-2 text-xs" style={{ color: "var(--ink-500)" }}>{util > 100 ? "Over budget this month" : "On track"}</div>
            </>
          )}
        </Card>

        <Card>
          <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>Category breakdown</div>
          {catRows.length === 0 ? (
            <div className="text-[12.5px]" style={{ color: "var(--ink-400)" }}>No expenses logged yet.</div>
          ) : (
            <BarChartH rows={catRows} fmt={(v) => `KWD ${v.toFixed(0)}`} />
          )}
        </Card>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
          value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="ml-auto text-[12.5px]" style={{ color: "var(--ink-500)" }}>{filtered.length} entries</span>
      </div>

      {isLoading ? <Spinner /> : filtered.length === 0 ? <EmptyState label="No expenses logged yet." /> : (
        <Table>
          <thead><tr><Th>Date</Th><Th>Category</Th><Th>Supplier</Th><Th>Method</Th><Th>Notes</Th><Th>Amount</Th><Th>Receipt</Th></tr></thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id} className="cursor-pointer" onClick={() => setActive(e)}>
                <Td>{fmtDate(e.date)}</Td>
                <Td><Badge>{e.category}</Badge></Td>
                <Td>{e.supplier ?? "—"}</Td>
                <Td>{e.method}</Td>
                <Td className="max-w-[200px] truncate">{e.notes ?? "—"}</Td>
                <Td className="font-semibold">KWD {e.amount.toFixed(2)}</Td>
                <Td>
                  <span className="flex items-center gap-1 text-xs" style={{ color: "var(--brass-600)" }}>
                    <Icon name="upload" className="h-3.5 w-3.5" />Manage
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {addOpen && <NewExpenseModal onClose={() => setAddOpen(false)} />}
      {active && <ExpenseReceiptModal expense={active} onClose={() => setActive(null)} />}
    </div>
  );
}

function ExpenseReceiptModal({ expense, onClose }: { expense: Expense; onClose: () => void }) {
  return (
    <Modal title={`${expense.category} — KWD ${expense.amount.toFixed(2)}`} onClose={onClose}>
      <div className="flex flex-col gap-3 text-[13px]">
        <div className="grid grid-cols-2 gap-2">
          <InfoRow label="Date" value={fmtDate(expense.date)} />
          <InfoRow label="Method" value={expense.method} />
          <InfoRow label="Supplier / Payee" value={expense.supplier ?? "—"} />
        </div>
        {expense.notes && <p style={{ color: "var(--ink-700)" }}>{expense.notes}</p>}
        <AttachmentsPanel entityType="expense" entityId={expense.id} />
      </div>
    </Modal>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px]" style={{ color: "var(--ink-400)" }}>{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export function NewExpenseModal({ onClose }: { onClose: () => void }) {
  const create = useCreate<Expense>("expenses", "/expenses");
  const [form, setForm] = useState({ category: CATEGORIES[0], amount: 0, date: todayIso(), method: "Card", supplier: "", notes: "" });
  const [saved, setSaved] = useState<Expense | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await create.mutateAsync(form as never);
    setSaved(res);
  }

  if (saved) {
    return (
      <Modal title="Attach receipt" onClose={onClose}>
        <div className="flex flex-col gap-3 text-[13px]">
          <div className="text-[12.5px]" style={{ color: "var(--ink-500)" }}>
            Expense logged — {saved.category} · KWD {saved.amount.toFixed(2)}. Attach a receipt now, or skip and add one later from the Expenses list.
          </div>
          <AttachmentsPanel entityType="expense" entityId={saved.id} />
          <Button onClick={onClose}>Done</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Log expense" onClose={onClose}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-medium">Category
            <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.category} onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Amount (KWD)
            <input type="number" step="0.01" required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.amount} onChange={(e) => setForm((s) => ({ ...s, amount: Number(e.target.value) }))} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Date
            <input type="date" required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.date} onChange={(e) => setForm((s) => ({ ...s, date: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Payment method
            <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.method} onChange={(e) => setForm((s) => ({ ...s, method: e.target.value }))}>
              {["Card", "Cash", "Bank Transfer"].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Supplier / Payee
          <input className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.supplier} onChange={(e) => setForm((s) => ({ ...s, supplier: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Notes
          <textarea className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.notes} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} />
        </label>
        <div className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--ink-400)" }}>
          <Icon name="upload" className="h-4 w-4" />You'll be able to attach the receipt right after saving.
        </div>
        <Button type="submit" disabled={create.isPending}>{create.isPending ? "Saving..." : "Save Expense"}</Button>
      </form>
    </Modal>
  );
}
