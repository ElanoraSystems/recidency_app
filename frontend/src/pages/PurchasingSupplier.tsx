import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useList } from "../api/hooks";
import { StatusBadge } from "../components/Workflow";
import { Badge, EmptyState, Modal, Spinner, Table, Td, Th } from "../components/ui";
import { addDays, fmtDate, todayIso } from "../lib/date";
import type { CreditNote, PurchaseOrder, Supplier } from "../types";

interface SupplierGrn {
  id: string; code: string; status: string; po_id: string; po_code: string | null; supplier_id: string; date: string
  total: number; has_variance: boolean; variance_total: number; supplier_invoice_no: string | null
}
interface PriceCell { latest_price: number; latest_date: string }
interface Comparison { items: { item_master_id: string; name: string; unit: string; cells: Record<string, PriceCell> }[] }

const TABS = ["Orders", "Price list", "Credit notes", "Invoices"] as const;

// Everything about one supplier in one place: what was ordered, what each item
// costs against the best price from anyone else, credits and invoices.
export function SupplierProfile({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const { data: orders } = useList<PurchaseOrder>("purchase-orders", "/purchasing/purchase-orders");
  const { data: grns } = useList<SupplierGrn>("grns", "/purchasing/grns");
  const { data: credits } = useList<CreditNote>("credit-notes", "/credit-notes");
  const { data: comparison } = useQuery<Comparison>({
    queryKey: ["price-comparison", "", ""],
    queryFn: async () => (await api.get("/purchasing/price-comparison")).data,
  });
  const [tab, setTab] = useState<(typeof TABS)[number]>("Orders");

  if (!orders || !grns || !credits || !comparison) return <Modal title={supplier.name} onClose={onClose} wide><Spinner /></Modal>;

  const myOrders = orders.filter((o) => o.supplier_id === supplier.id).sort((a, b) => b.order_date.localeCompare(a.order_date));
  const myGrns = grns.filter((g) => g.supplier_id === supplier.id).sort((a, b) => b.date.localeCompare(a.date));
  const myCredits = credits.filter((c) => c.supplier_id === supplier.id).sort((a, b) => b.date.localeCompare(a.date));
  const since = addDays(todayIso(), -90);
  const spend90 = myGrns.filter((g) => g.status !== "Draft" && g.date >= since).reduce((s, g) => s + g.total, 0);
  const placed = myOrders.filter((o) => !["Draft", "Submitted", "Rejected"].includes(o.status));

  // On time: the last receipt reached the store by the date the order promised.
  const promised = placed.filter((o) => o.expected_date && myGrns.some((g) => g.po_id === o.id && g.status !== "Draft"));
  const onTime = promised.filter((o) => {
    const last = myGrns.filter((g) => g.po_id === o.id && g.status !== "Draft").map((g) => g.date).sort().pop()!;
    return last <= o.expected_date!;
  }).length;
  const onTimePct = promised.length ? Math.round((onTime / promised.length) * 100) : null;

  const priceRows = comparison.items
    .filter((i) => i.cells[supplier.id])
    .map((i) => {
      const now = i.cells[supplier.id].latest_price;
      const others = Object.entries(i.cells).filter(([id]) => id !== supplier.id).map(([, c]) => c.latest_price);
      const best = others.length ? Math.min(...others) : null;
      return { ...i, now, best, pct: best && best > 0 ? ((now - best) / best) * 100 : 0 };
    })
    .sort((a, b) => b.pct - a.pct);

  const tile = (label: string, value: string) => (
    <div className="rounded-xl border px-3 py-2.5" style={{ borderColor: "var(--border)", background: "var(--surface-hover)" }}>
      <div className="font-display text-xl font-semibold leading-none tabular-nums">{value}</div>
      <div className="mt-1 text-[11.5px] font-bold" style={{ color: "var(--ink-500)" }}>{label}</div>
    </div>
  );

  return (
    <Modal title={supplier.name} onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-[13px]">
        <div style={{ color: "var(--ink-500)" }}>{[supplier.category, supplier.contact, supplier.phone, supplier.email].filter(Boolean).join(" · ")}</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {tile("KWD received, 90 days", spend90.toFixed(2))}
          {tile("Orders placed", String(placed.length))}
          {tile("Delivered on time", onTimePct === null ? "—" : `${onTimePct}%`)}
          {tile(`Credit notes (${myCredits.length}), KWD`, myCredits.reduce((s, c) => s + c.amount, 0).toFixed(2))}
        </div>

        <div className="flex gap-4 overflow-x-auto border-b" style={{ borderColor: "var(--border)" }}>
          {TABS.map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className="whitespace-nowrap border-b-2 px-1 pb-2 text-[13px] font-semibold"
              style={{ borderColor: tab === t ? "var(--brass-500)" : "transparent", color: tab === t ? "var(--ink-900)" : "var(--ink-500)" }}>{t}</button>
          ))}
        </div>

        <div className="overflow-x-auto">
          {tab === "Orders" && (myOrders.length === 0 ? <EmptyState label="No orders with this supplier yet." /> : (
            <Table>
              <thead><tr><Th>Order</Th><Th>Date</Th><Th>Expected</Th><Th>Status</Th><Th>Payment</Th><Th>KWD</Th></tr></thead>
              <tbody>
                {myOrders.map((o) => (
                  <tr key={o.id}>
                    <Td className="font-medium">{o.code}{o.source_pr_code && <div className="text-xs font-normal" style={{ color: "var(--ink-400)" }}>{o.source_pr_code}</div>}</Td>
                    <Td>{fmtDate(o.order_date)}</Td><Td>{o.expected_date ? fmtDate(o.expected_date) : "—"}</Td>
                    <Td><StatusBadge status={o.status} /></Td>
                    <Td><Badge tone={o.payment_status === "Paid" ? "good" : "warning"}>{o.payment_status}</Badge></Td>
                    <Td className="tabular-nums">{o.total.toFixed(3)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ))}

          {tab === "Price list" && (priceRows.length === 0 ? <EmptyState label="No prices yet. They appear after the first order is placed with this supplier." /> : (
            <Table>
              <thead><tr><Th>Item</Th><Th>Price now</Th><Th>Best elsewhere</Th><Th>Compared</Th></tr></thead>
              <tbody>
                {priceRows.map((r) => (
                  <tr key={r.item_master_id}>
                    <Td className="font-medium">{r.name} <span className="font-normal" style={{ color: "var(--ink-400)" }}>/ {r.unit}</span></Td>
                    <Td className="tabular-nums">{r.now.toFixed(3)}</Td>
                    <Td className="tabular-nums">{r.best === null ? "—" : r.best.toFixed(3)}</Td>
                    <Td>
                      {r.best === null ? <Badge>Only supplier</Badge>
                        : r.now <= r.best + 0.0005 ? <Badge tone="good">Best</Badge>
                        : <Badge tone={r.pct > 5 ? "critical" : "warning"}>+{r.pct.toFixed(1)}%</Badge>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ))}

          {tab === "Credit notes" && (myCredits.length === 0 ? <EmptyState label="No credit notes from this supplier." /> : (
            <Table>
              <thead><tr><Th>Date</Th><Th>Order</Th><Th>Reason</Th><Th>KWD</Th></tr></thead>
              <tbody>
                {myCredits.map((c) => (
                  <tr key={c.id}>
                    <Td>{fmtDate(c.date)}</Td>
                    <Td>{orders.find((o) => o.id === c.po_id)?.code ?? "—"}</Td>
                    <Td>{c.reason}{c.notes && <div className="text-xs" style={{ color: "var(--ink-400)" }}>{c.notes}</div>}</Td>
                    <Td className="tabular-nums">{c.amount.toFixed(3)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ))}

          {tab === "Invoices" && (myGrns.length === 0 ? <EmptyState label="No receipts from this supplier yet." /> : (
            <Table>
              <thead><tr><Th>Invoice no.</Th><Th>Receipt</Th><Th>Date</Th><Th>Order</Th><Th>Status</Th><Th>KWD</Th></tr></thead>
              <tbody>
                {myGrns.map((g) => (
                  <tr key={g.id}>
                    <Td className="font-medium">{g.supplier_invoice_no ?? <span style={{ color: "var(--ink-400)" }}>Not recorded</span>}</Td>
                    <Td>{g.code}</Td><Td>{fmtDate(g.date)}</Td><Td>{g.po_code ?? "—"}</Td>
                    <Td><div className="flex gap-1.5"><StatusBadge status={g.status} />{g.has_variance && <Badge tone="critical">Variance {g.variance_total.toFixed(3)}</Badge>}</div></Td>
                    <Td className="tabular-nums">{g.total.toFixed(3)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ))}
        </div>
      </div>
    </Modal>
  );
}
