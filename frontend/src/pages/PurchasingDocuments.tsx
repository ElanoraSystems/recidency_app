import { useState } from "react";
import { Link } from "react-router-dom";
import { useList } from "../api/hooks";
import { StatusBadge } from "../components/Workflow";
import { Badge, Button, EmptyState, Modal, Spinner, Table, Td, Th } from "../components/ui";
import { addDays, fmtDate, todayIso } from "../lib/date";
import type { PurchaseOrder, PurchaseRequest, Supplier } from "../types";
import { useDecide } from "./PurchasingToday";
import type { GrnRow } from "./PurchasingToday";

type Tone = "neutral" | "warning" | "info" | "good" | "critical";
type Stage = "Requests" | "Orders" | "Receipts";

// One purchase: the request that started it, the orders made from it and the
// receipts that closed them. An order with no request stands on its own.
interface Purchase {
  key: string; code: string; date: string; who: string | null; supplier: string; costCenter: string; value: number
  pr?: PurchaseRequest; pos: PurchaseOrder[]; grns: GrnRow[]
  stage: Stage; label: string; tone: Tone; search: string
}

const doc = (tab: string, id: string) => `/purchasing?tab=${encodeURIComponent(tab)}&doc=${id}`;

function build(prs: PurchaseRequest[], pos: PurchaseOrder[], grns: GrnRow[], supplierName: (id: string) => string): Purchase[] {
  const mk = (pr: PurchaseRequest | undefined, orders: PurchaseOrder[]): Purchase => {
    const poIds = new Set(orders.map((o) => o.id));
    const receipts = grns.filter((g) => poIds.has(g.po_id));
    const live = orders.filter((o) => o.status !== "Rejected");
    let stage: Stage = "Requests", label = "Draft", tone: Tone = "neutral";
    if (orders.length === 0 && pr) {
      if (pr.status === "Submitted") [label, tone] = ["Awaiting approval", "warning"];
      else if (pr.status === "Approved") [label, tone] = ["Ready to order", "info"];
      else if (pr.status === "Rejected") [label, tone] = ["Rejected", "critical"];
      else if (pr.status === "Closed") [label, tone] = ["Closed", "neutral"];
    } else if (live.length === 0) {
      [stage, label, tone] = ["Orders", "Rejected", "critical"];
    } else if (live.some((o) => o.status === "Submitted")) {
      [stage, label, tone] = ["Orders", "Order awaiting approval", "warning"];
    } else if (live.every((o) => o.status === "Fully Received" || o.status === "Closed")) {
      [stage, label, tone] = ["Receipts", "Received", "good"];
    } else if (live.some((o) => o.status === "Partially Received")) {
      [stage, label, tone] = ["Orders", "Partly received", "info"];
    } else {
      [stage, label, tone] = ["Orders", "Ordered", "info"];
    }
    if (receipts.some((g) => g.has_variance && g.status === "Submitted")) [label, tone] = ["Price variance", "critical"];
    const suppliers = [...new Set(orders.map((o) => supplierName(o.supplier_id)))];
    const code = pr?.code ?? orders[0].code;
    return {
      key: pr?.id ?? orders[0].id, code, date: pr?.request_date ?? orders[0].order_date, who: pr?.requested_by_name ?? null,
      supplier: suppliers.join(", "), costCenter: pr?.cost_center ?? orders[0]?.cost_center ?? "",
      value: orders.length ? orders.reduce((s, o) => s + o.total, 0) : pr?.total_est_cost ?? 0,
      pr, pos: orders, grns: receipts, stage, label, tone,
      search: [code, suppliers.join(" "), ...orders.map((o) => o.code), ...receipts.map((g) => g.code), ...(pr?.lines.map((l) => l.item_name) ?? [])].join(" ").toLowerCase(),
    };
  };
  const byPr = new Map<string, PurchaseOrder[]>();
  const loose: PurchaseOrder[] = [];
  const known = new Set(prs.map((p) => p.id));
  for (const o of pos) {
    if (o.source_pr_id && known.has(o.source_pr_id)) byPr.set(o.source_pr_id, [...(byPr.get(o.source_pr_id) ?? []), o]);
    else loose.push(o);
  }
  return [...prs.map((p) => mk(p, byPr.get(p.id) ?? [])), ...loose.map((o) => mk(undefined, [o]))]
    .sort((a, b) => b.date.localeCompare(a.date) || b.code.localeCompare(a.code));
}

const chipStyle = (done: boolean, now: boolean): React.CSSProperties => ({
  background: done ? "var(--status-good-bg)" : now ? "var(--brass-100)" : "var(--surface-sunken)",
  color: done ? "var(--status-good)" : now ? "var(--brass-700)" : "var(--ink-500)",
  outline: now ? "1px solid var(--brass-500)" : "none",
});

function TrailChip({ label, to, done, now }: { label: string; to?: string; done: boolean; now: boolean }) {
  const cls = "whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11.5px] font-bold";
  return to
    ? <Link to={to} onClick={(e) => e.stopPropagation()} className={cls} style={chipStyle(done, now)}>{label}</Link>
    : <span className={cls} style={chipStyle(done, now)}>{label}</span>;
}

function Trail({ p }: { p: Purchase }) {
  const prDone = !!p.pr && !["Draft", "Submitted"].includes(p.pr.status);
  const poDone = p.pos.length > 0 && p.pos.every((o) => ["Fully Received", "Closed"].includes(o.status));
  const joint = <span className="h-0.5 w-3 shrink-0" style={{ background: "var(--border-strong)" }} />;
  return (
    <div className="flex items-center gap-1">
      {p.pr && <TrailChip label="PR" to={doc("Purchase Requests", p.pr.id)} done={prDone} now={!prDone} />}
      {p.pr && joint}
      {p.pos.length === 0
        ? <TrailChip label="PO" done={false} now={prDone} />
        : p.pos.map((o, i) => <TrailChip key={o.id} label={p.pos.length > 1 ? `PO ${i + 1}` : "PO"} to={doc("Purchase Orders", o.id)} done={["Fully Received", "Closed"].includes(o.status)} now={!poDone} />)}
      {joint}
      {p.grns.length > 0
        ? p.grns.map((g, i) => <TrailChip key={g.id} label={p.grns.length > 1 ? `GRN ${i + 1}` : "GRN"} to={doc("Goods Received", g.id)} done={poDone} now={!poDone} />)
        : <TrailChip label="GRN" done={false} now={false} />}
    </div>
  );
}

const PERIODS = [{ id: "", label: "All time" }, { id: "week", label: "Last 7 days" }, { id: "month", label: "This month" }];

export function PurchasingDocuments() {
  const { data: requests, isLoading } = useList<PurchaseRequest>("purchase-requests", "/purchasing/purchase-requests");
  const { data: orders } = useList<PurchaseOrder>("purchase-orders", "/purchasing/purchase-orders");
  const { data: grns } = useList<GrnRow>("grns", "/purchasing/grns");
  const { data: suppliers } = useList<Supplier>("suppliers", "/suppliers");
  const { decide, error } = useDecide();
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<"" | Stage>("");
  const [period, setPeriod] = useState("");
  const [cc, setCc] = useState("");
  const [supplier, setSupplier] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);

  if (isLoading) return <Spinner />;
  const supplierName = (id: string) => suppliers?.find((s) => s.id === id)?.name ?? "Supplier";
  const all = build(requests ?? [], orders ?? [], grns ?? [], supplierName);
  const today = todayIso();
  const since = period === "week" ? addDays(today, -7) : period === "month" ? `${today.slice(0, 8)}01` : "";
  const centers = [...new Set(all.map((p) => p.costCenter).filter(Boolean))].sort();
  const supplierOptions = [...new Set(all.flatMap((p) => p.supplier.split(", ").filter(Boolean)))].sort();
  const rows = all.filter((p) =>
    (!q || p.search.includes(q.trim().toLowerCase())) && (!stage || p.stage === stage) && (!since || p.date >= since) &&
    (!cc || p.costCenter === cc) && (!supplier || p.supplier.split(", ").includes(supplier)));
  const open = all.find((p) => p.key === openKey) ?? null;
  const field = "rounded-lg border px-2.5 py-1.5 text-sm";
  const border = { borderColor: "var(--border-strong)" };

  // The one action available next, so the list doubles as a to-do list.
  const next = (p: Purchase) => {
    const busy = decide.isPending;
    if (p.grns.some((g) => g.has_variance && g.status === "Submitted")) return <Link to={doc("Goods Received", p.grns[0].id)}><Button size="sm" variant="secondary">Review</Button></Link>;
    if (p.pr?.status === "Draft") return <Link to={`/purchasing/requests/${p.pr.id}/edit`}><Button size="sm" variant="secondary">Continue</Button></Link>;
    if (p.pr?.status === "Submitted") return (
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => decide.mutate({ kind: "purchase-requests", id: p.pr!.id, approve: true })}>Approve</Button>
        <Button size="sm" variant="danger" disabled={busy} onClick={() => decide.mutate({ kind: "purchase-requests", id: p.pr!.id, approve: false })}>Reject</Button>
      </div>
    );
    if (p.pr?.status === "Approved" && p.pos.length === 0) return <Link to={`/purchasing/orders/new/${p.pr.id}`}><Button size="sm">Create orders</Button></Link>;
    const submitted = p.pos.find((o) => o.status === "Submitted");
    if (submitted) return (
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => decide.mutate({ kind: "purchase-orders", id: submitted.id, approve: true })}>Approve order</Button>
        <Button size="sm" variant="danger" disabled={busy} onClick={() => decide.mutate({ kind: "purchase-orders", id: submitted.id, approve: false })}>Reject</Button>
      </div>
    );
    const receivable = p.pos.find((o) => o.status === "Approved" || o.status === "Partially Received");
    if (receivable) return <Link to={`/purchasing/grn/${receivable.id}`}><Button size="sm">Receive</Button></Link>;
    return <span className="text-[12px]" style={{ color: "var(--ink-400)" }}>View</span>;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code, supplier or item" className={`${field} min-w-[200px] flex-1`} style={border} />
        <div className="flex rounded-lg p-0.5" style={{ background: "var(--surface-sunken)" }}>
          {(["", "Requests", "Orders", "Receipts"] as const).map((s) => (
            <button key={s || "All"} type="button" onClick={() => setStage(s)} className="rounded-md px-3 py-1 text-[12.5px] font-bold"
              style={{ background: stage === s ? "var(--surface)" : "transparent", color: stage === s ? "var(--ink-900)" : "var(--ink-500)" }}>{s || "All"}</button>
          ))}
        </div>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} className={field} style={border}>
          {PERIODS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <select value={cc} onChange={(e) => setCc(e.target.value)} className={field} style={border}>
          <option value="">All cost centers</option>{centers.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={supplier} onChange={(e) => setSupplier(e.target.value)} className={field} style={border}>
          <option value="">All suppliers</option>{supplierOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {error && <p className="text-[13px]" style={{ color: "var(--status-critical)" }}>{error}</p>}

      {rows.length === 0 ? <EmptyState label="No purchases match these filters." /> : (
        <div className="overflow-x-auto">
          <Table>
            <thead><tr><Th>Purchase</Th><Th>Trail</Th><Th>Supplier</Th><Th>Cost center</Th><Th>KWD</Th><Th>Status</Th><Th>Next</Th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.key} className="cursor-pointer" onClick={() => setOpenKey(p.key)}>
                  <Td className="font-medium">{p.code}
                    <div className="text-xs font-normal" style={{ color: "var(--ink-400)" }}>{fmtDate(p.date)}{p.who ? ` · ${p.who}` : ""}</div>
                  </Td>
                  <Td><Trail p={p} /></Td>
                  <Td>{p.supplier || "—"}</Td>
                  <Td>{p.costCenter || "—"}</Td>
                  <Td className="tabular-nums">{p.value.toFixed(3)}</Td>
                  <Td><Badge tone={p.tone}>{p.label}</Badge></Td>
                  <Td onClick={(e) => e.stopPropagation()}>{next(p)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      {open && <PurchaseDetail p={open} supplierName={supplierName} onClose={() => setOpenKey(null)} />}
    </div>
  );
}

// The whole story of one purchase: where it stands, every document in it and
// what was asked for.
function PurchaseDetail({ p, supplierName, onClose }: { p: Purchase; supplierName: (id: string) => string; onClose: () => void }) {
  const live = p.pos.filter((o) => o.status !== "Rejected");
  const received = live.length > 0 && live.every((o) => ["Fully Received", "Closed"].includes(o.status));
  const steps = [
    { name: "Requested", on: !!p.pr && p.pr.status !== "Draft", when: p.pr?.request_date },
    { name: "Approved", on: (!!p.pr && ["Approved", "Closed"].includes(p.pr.status)) || p.pos.length > 0, when: undefined },
    { name: "Ordered", on: live.length > 0, when: live[0]?.order_date },
    { name: "Received", on: received || p.grns.length > 0, when: p.grns[0]?.date },
    { name: "Paid", on: live.length > 0 && live.every((o) => o.payment_status === "Paid"), when: undefined },
  ];
  const lines = p.pr?.lines ?? [];
  return (
    <Modal title={`${p.code} — ${p.label}`} onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-[13px]">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {steps.map((s) => (
            <div key={s.name} className="rounded-lg border px-2.5 py-2" style={{ borderColor: s.on ? "var(--status-good)" : "var(--border)", background: s.on ? "var(--status-good-bg)" : "var(--surface)" }}>
              <div className="text-[11px] font-extrabold uppercase tracking-wider" style={{ color: s.on ? "var(--status-good)" : "var(--ink-400)" }}>{s.name}</div>
              <div className="text-[12px]" style={{ color: "var(--ink-500)" }}>{s.when ? fmtDate(s.when) : s.on ? "Done" : "Pending"}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <h3 className="text-[12px] font-extrabold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>Documents</h3>
          {p.pr && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)" }}>
              <span><b>{p.pr.code}</b> <span style={{ color: "var(--ink-500)" }}>Request · {p.pr.cost_center ?? "—"} · KWD {p.pr.total_est_cost.toFixed(3)}</span></span>
              <span className="flex items-center gap-3"><StatusBadge status={p.pr.status} /><Link to={doc("Purchase Requests", p.pr.id)} className="text-xs font-semibold" style={{ color: "var(--brass-600)" }}>Open</Link></span>
            </div>
          )}
          {p.pos.map((o) => (
            <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)" }}>
              <span><b>{o.code}</b> <span style={{ color: "var(--ink-500)" }}>Order · {supplierName(o.supplier_id)} · KWD {o.total.toFixed(3)}</span></span>
              <span className="flex items-center gap-3"><StatusBadge status={o.status} /><Badge tone={o.payment_status === "Paid" ? "good" : "warning"}>{o.payment_status}</Badge><Link to={doc("Purchase Orders", o.id)} className="text-xs font-semibold" style={{ color: "var(--brass-600)" }}>Open</Link></span>
            </div>
          ))}
          {p.grns.map((g) => (
            <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)" }}>
              <span><b>{g.code}</b> <span style={{ color: "var(--ink-500)" }}>Receipt · {fmtDate(g.date)} · KWD {g.total.toFixed(3)}</span></span>
              <span className="flex items-center gap-3">
                {g.has_variance && <Badge tone="critical">Variance {g.variance_total.toFixed(3)}</Badge>}
                <StatusBadge status={g.status} /><Link to={doc("Goods Received", g.id)} className="text-xs font-semibold" style={{ color: "var(--brass-600)" }}>Open</Link>
              </span>
            </div>
          ))}
          {p.pos.length === 0 && <p style={{ color: "var(--ink-500)" }}>No orders have been made from this request yet.</p>}
        </div>

        {lines.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[12px] font-extrabold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>Requested items</h3>
            <div className="overflow-x-auto">
              <Table>
                <thead><tr><Th>Item</Th><Th>Qty</Th><Th>Indicative price</Th><Th>Line cost</Th></tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <Td className="font-medium">{l.item_name}{l.description && <div className="text-[11.5px] font-normal" style={{ color: "var(--ink-500)" }}>{l.description}</div>}</Td>
                      <Td>{l.qty} {l.unit}</Td><Td>{l.est_unit_price.toFixed(3)}</Td><Td>{l.est_cost.toFixed(2)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
