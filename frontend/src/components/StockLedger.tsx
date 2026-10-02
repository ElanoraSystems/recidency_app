import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useList } from "../api/hooks";
import { fmtDateTime } from "../lib/date";
import type { CostCenter, StockBalances, StockMovementRow } from "../types";
import { Badge, DateRangeFilter, EmptyState, Spinner, Table, Td, Th } from "./ui";

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
