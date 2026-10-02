import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useList } from "../api/hooks";
import { fmtDateTime } from "../lib/date";
import type { CostCenter, CostOfSalesRow, PeriodStatus, StockBalances, StockMovementRow } from "../types";
import { errorText } from "./Workflow";
import { Badge, Button, DateRangeFilter, EmptyState, Spinner, Table, Td, Th } from "./ui";

const inputCls = "rounded-lg border px-2.5 py-1.5 text-sm";
const inputStyle = { borderColor: "var(--border-strong)" };
const fmtQty = (n: number) => (Math.round(n * 1000) / 1000).toString();

export function useStockBalances(costCenterId = "") {
  return useQuery<StockBalances>({
    queryKey: ["stock-balances", costCenterId],
    queryFn: async () => (await api.get("/stock/balances", { params: costCenterId ? { cost_center_id: costCenterId } : {} })).data,
  });
}

// Item x cost-center matrix. Each row's total is company-wide stock, so an
// internal transfer moves quantity between columns without changing the total.
export function BalancesTab() {
  const [costCenterId, setCostCenterId] = useState("");
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const { data, isLoading } = useStockBalances(costCenterId);
  if (isLoading || !data) return <Spinner />;

  const columns = costCenterId ? data.cost_centers.filter((c) => c.id === costCenterId) : data.cost_centers;
  const items = data.items.filter((i) =>
    i.name.toLowerCase().includes(search.toLowerCase()) && (!type || i.stock_type === type)
  );
  const totalValue = items.reduce((s, i) => s + i.total_value, 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input className={inputCls} style={inputStyle} placeholder="Search item…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className={inputCls} style={inputStyle} value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)}>
          <option value="">All cost centers</option>
          {data.cost_centers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <select className={inputCls} style={inputStyle} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Food &amp; general</option>
          <option value="food">Food</option>
          <option value="general">General</option>
        </select>
        <span className="ml-auto text-[13px]" style={{ color: "var(--ink-500)" }}>
          Stock value shown: <b>KWD {totalValue.toFixed(2)}</b>
        </span>
      </div>
      {items.length === 0 ? <EmptyState label="No stock matches these filters." /> : (
        <Table>
          <thead>
            <tr>
              <Th>Item</Th><Th>Unit</Th>
              {columns.map((c) => <Th key={c.id}>{c.label}</Th>)}
              <Th>Total</Th><Th>Value</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={`${i.stock_type}-${i.stock_id}`}>
                <Td className="font-medium">{i.name}</Td>
                <Td>{i.unit}</Td>
                {columns.map((c) => {
                  const q = i.by_location[c.id];
                  return <Td key={c.id} style={q ? undefined : { color: "var(--ink-300)" }}>{q ? fmtQty(q) : "—"}</Td>;
                })}
                <Td className="font-semibold">
                  {fmtQty(costCenterId ? (i.by_location[costCenterId] ?? 0) : i.total_qty)}
                </Td>
                <Td>KWD {i.total_value.toFixed(2)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

const TXN_TYPES = ["OPENING", "GRN", "MEAL_LOG", "TRANSFER", "WASTE", "STOCK_COUNT"];

// Append-only ledger of every inventory movement. Reversed documents show
// their original rows as Reversed plus the offsetting reversal rows.
export function MovementsTab({ stockId }: { stockId?: string }) {
  const { data: costCenters } = useList<CostCenter>("cost-centers", "/kitchen/cost-centers");
  const [f, setF] = useState({ from: "", to: "", cc: "", type: "", item: "", code: "" });
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const { data, isLoading } = useQuery<StockMovementRow[]>({
    queryKey: ["stock-movements", f, stockId ?? ""],
    queryFn: async () =>
      (await api.get("/stock/movements", {
        params: {
          date_from: f.from || undefined, date_to: f.to || undefined, cost_center_id: f.cc || undefined,
          txn_type: f.type || undefined, item: f.item || undefined, txn_code: f.code || undefined,
          stock_id: stockId || undefined,
        },
      })).data,
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <DateRangeFilter from={f.from} to={f.to} onFromChange={set("from")} onToChange={set("to")} />
        <select className={inputCls} style={inputStyle} value={f.cc} onChange={(e) => set("cc")(e.target.value)}>
          <option value="">All cost centers</option>
          {costCenters?.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <select className={inputCls} style={inputStyle} value={f.type} onChange={(e) => set("type")(e.target.value)}>
          <option value="">All types</option>
          {TXN_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
        </select>
        {!stockId && <input className={inputCls} style={inputStyle} placeholder="Item…" value={f.item} onChange={(e) => set("item")(e.target.value)} />}
        <input className={inputCls} style={inputStyle} placeholder="Txn #…" value={f.code} onChange={(e) => set("code")(e.target.value)} />
      </div>
      {isLoading ? <Spinner /> : !data || data.length === 0 ? <EmptyState label="No movements match these filters." /> : (
        <Table>
          <thead>
            <tr>
              <Th>Txn #</Th><Th>Date / time</Th><Th>Type</Th><Th>From</Th><Th>To</Th><Th>Item</Th>
              <Th>Qty</Th><Th>Unit</Th><Th>Unit cost</Th><Th>Value</Th><Th>User</Th><Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((m) => (
              <tr key={m.id}>
                <Td className="font-medium">{m.txn_code ?? "—"}</Td>
                <Td>{fmtDateTime(m.created_at)}</Td>
                <Td>{m.txn_type.replace("_", " ")}{m.is_reversal ? " (reversal)" : ""}</Td>
                <Td>{m.from_cost_center ?? "—"}</Td>
                <Td>{m.to_cost_center ?? "—"}</Td>
                <Td>{m.item_name}</Td>
                <Td>{fmtQty(m.qty)}</Td>
                <Td>{m.unit}</Td>
                <Td>{m.unit_cost.toFixed(3)}</Td>
                <Td>{m.total_value.toFixed(3)}</Td>
                <Td>{m.user_name ?? "—"}</Td>
                <Td><Badge tone={m.status === "Posted" ? "good" : "warning"}>{m.status}</Badge></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

// Compact per-location breakdown for one item, used in the stock detail modal.
export function LocationBreakdown({ stockId }: { stockId: string }) {
  const { data } = useStockBalances();
  const item = data?.items.find((i) => i.stock_id === stockId);
  if (!data || !item) return null;
  const rows = data.cost_centers.filter((c) => item.by_location[c.id]);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>By cost center</div>
      {rows.map((c) => (
        <div key={c.id} className="flex justify-between py-0.5">
          <span>{c.label}</span><span className="font-medium">{fmtQty(item.by_location[c.id])} {item.unit}</span>
        </div>
      ))}
    </div>
  );
}

const monthName = (period: string) =>
  new Date(period + "-01T00:00:00").toLocaleDateString("en-GB", { month: "short", year: "numeric" });
const kwd = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Month-end close: closing recalculates the month's cost of sales from the
// ledger and locks the month against further stock postings, so a reported
// figure cannot move afterwards unless the owner reopens the month.
function PeriodsPanel() {
  const { user } = useAuth();
  const isOwner = user?.user_type === "owner";
  const qc = useQueryClient();
  const { data } = useQuery<PeriodStatus[]>({
    queryKey: ["stock-periods"],
    queryFn: async () => (await api.get("/stock/periods")).data,
  });
  const act = useMutation({
    mutationFn: async ({ period, close, reason }: { period: string; close: boolean; reason?: string }) =>
      (await api.post(`/stock/periods/${period}/${close ? "close" : "reopen"}`, close ? {} : { reason })).data,
    onSuccess: () => {
      for (const k of ["stock-periods", "cost-of-sales"]) qc.invalidateQueries({ queryKey: [k] });
    },
  });
  if (!data || data.length === 0) return null;

  function reopen(period: string) {
    const reason = window.prompt(`Reason for reopening ${period}?`);
    if (reason?.trim()) act.mutate({ period, close: false, reason });
  }

  return (
    <div>
      <h3 className="mb-2 text-[13px] font-semibold" style={{ color: "var(--ink-700)" }}>Month-end close</h3>
      {act.isError && <p className="mb-2 text-[13px]" style={{ color: "var(--status-critical)" }}>{errorText(act.error)}</p>}
      <Table>
        <thead><tr><Th>Month</Th><Th>Status</Th><Th>Counted</Th><Th>Not counted</Th><Th>{" "}</Th></tr></thead>
        <tbody>
          {data.map((p) => (
            <tr key={p.period}>
              <Td className="font-medium">{monthName(p.period)}</Td>
              <Td>
                {p.closed
                  ? <Badge tone="info">Closed{p.closed_by_name ? ` by ${p.closed_by_name}` : ""}</Badge>
                  : <Badge tone="warning">{p.reopened_at ? "Reopened" : "Open"}</Badge>}
              </Td>
              <Td>{p.counted_centers.join(", ") || "—"}</Td>
              <Td style={p.uncounted_centers.length ? { color: "var(--status-warning)" } : undefined}>{p.uncounted_centers.join(", ") || "—"}</Td>
              <Td>
                {isOwner && (p.closed
                  ? <Button size="sm" variant="secondary" onClick={() => reopen(p.period)} disabled={act.isPending}>Reopen</Button>
                  : <Button size="sm" onClick={() => act.mutate({ period: p.period, close: true })} disabled={act.isPending}>Close month</Button>)}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="mt-1.5 text-[12px]" style={{ color: "var(--ink-400)" }}>
        Closing recalculates the month's cost of sales and blocks any stock posting dated in it (including reopening a document from it).
        Only the owner can close or reopen a month. Cost centers with activity but no count are flagged so they can be counted first.
      </p>
    </div>
  );
}

// Monthly cost of sales per cost center. A row is written each time a stock
// count is submitted, so this is the permanent month-by-month history.
export function CostOfSalesTab() {
  const { data: costCenters } = useList<CostCenter>("cost-centers", "/kitchen/cost-centers");
  const [f, setF] = useState({ cc: "", type: "", from: "", to: "" });
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const { data, isLoading } = useQuery<CostOfSalesRow[]>({
    queryKey: ["cost-of-sales", f],
    queryFn: async () =>
      (await api.get("/stock/cos", {
        params: { cost_center_id: f.cc || undefined, stock_type: f.type || undefined, period_from: f.from || undefined, period_to: f.to || undefined },
      })).data,
  });
  if (isLoading || !data) return <Spinner />;

  const periods = [...new Set(data.map((r) => r.period))].sort().reverse();
  const centers = [...new Set(data.map((r) => r.cost_center))].sort();
  const cell = (cc: string, period: string) =>
    data.filter((r) => r.cost_center === cc && r.period === period).reduce((s, r) => s + r.cost_of_sales, 0);
  const has = (cc: string, period: string) => data.some((r) => r.cost_center === cc && r.period === period);

  return (
    <div className="flex flex-col gap-5">
      <PeriodsPanel />
      <p className="text-[12.5px]" style={{ color: "var(--ink-500)" }}>
        Cost of sales = opening stock + purchases + transfers in - transfers out - closing stock, valued at cost from the
        stock ledger. It is calculated and saved for the cost center each time a monthly stock count is submitted (count
        date sets the month; a later count in the same month replaces the earlier figure).
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <select className={inputCls} style={inputStyle} value={f.cc} onChange={(e) => set("cc")(e.target.value)}>
          <option value="">All cost centers</option>
          {costCenters?.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <select className={inputCls} style={inputStyle} value={f.type} onChange={(e) => set("type")(e.target.value)}>
          <option value="">Food &amp; general</option>
          <option value="food">Food</option>
          <option value="general">General</option>
        </select>
        <label className="flex items-center gap-1.5 text-[12.5px]">From
          <input type="month" className={inputCls} style={inputStyle} value={f.from} onChange={(e) => set("from")(e.target.value)} />
        </label>
        <label className="flex items-center gap-1.5 text-[12.5px]">To
          <input type="month" className={inputCls} style={inputStyle} value={f.to} onChange={(e) => set("to")(e.target.value)} />
        </label>
      </div>

      {data.length === 0 ? (
        <EmptyState label="No cost of sales recorded yet - it appears here once a monthly stock count is submitted." />
      ) : (
        <>
          <Table>
            <thead>
              <tr><Th>Cost center (KWD)</Th>{periods.map((p) => <Th key={p}>{monthName(p)}</Th>)}<Th>Total</Th></tr>
            </thead>
            <tbody>
              {centers.map((cc) => (
                <tr key={cc}>
                  <Td className="font-medium">{cc}</Td>
                  {periods.map((p) => <Td key={p}>{has(cc, p) ? kwd(cell(cc, p)) : "—"}</Td>)}
                  <Td className="font-semibold">{kwd(periods.reduce((s, p) => s + cell(cc, p), 0))}</Td>
                </tr>
              ))}
              <tr>
                <Td className="font-semibold">All cost centers</Td>
                {periods.map((p) => <Td key={p} className="font-semibold">{kwd(centers.reduce((s, cc) => s + cell(cc, p), 0))}</Td>)}
                <Td className="font-bold">{kwd(data.reduce((s, r) => s + r.cost_of_sales, 0))}</Td>
              </tr>
            </tbody>
          </Table>

          <Table>
            <thead>
              <tr>
                <Th>Month</Th><Th>Cost center</Th><Th>Stock</Th><Th>Opening</Th><Th>Purchases</Th><Th>Transfers in</Th>
                <Th>Transfers out</Th><Th>Closing</Th><Th>Cost of sales</Th><Th>Meals</Th><Th>Waste</Th><Th>Count variance</Th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium">{monthName(r.period)}</Td>
                  <Td>{r.cost_center}</Td>
                  <Td className="capitalize">{r.stock_type}</Td>
                  <Td>{kwd(r.opening_value)}</Td>
                  <Td>{kwd(r.purchases)}</Td>
                  <Td>{kwd(r.transfers_in)}</Td>
                  <Td>{kwd(r.transfers_out)}</Td>
                  <Td>{kwd(r.closing_value)}</Td>
                  <Td className="font-semibold">{kwd(r.cost_of_sales)}</Td>
                  <Td>{kwd(r.meals_value)}</Td>
                  <Td>{kwd(r.waste_value)}</Td>
                  <Td>{kwd(r.count_variance)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </div>
  );
}
