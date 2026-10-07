import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useList } from "../api/hooks";
import { errorText } from "../components/Workflow";
import { Badge, Button, Card, EmptyState, Spinner } from "../components/ui";
import { daysLabel, daysUntil, todayIso } from "../lib/date";
import type { PrTemplate, PurchaseOrder, PurchaseRequest, Supplier, TxnStatus } from "../types";

export interface GrnRow { id: string; code: string; status: TxnStatus; po_id: string; po_code: string | null; supplier_name: string | null; date: string; total: number; variance_total: number; has_variance: boolean }

type Tone = "warning" | "info" | "good" | "critical";
interface Task { key: string; kind: string; tone: Tone; title: string; detail: string; actions: React.ReactNode }

const OPEN_PO = ["Approved", "Partially Received"];
const SHOWN = 8;

// Approve or reject a request or order where it is listed.
export function useDecide() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: async ({ kind, id, approve }: { kind: "purchase-requests" | "purchase-orders"; id: string; approve: boolean }) =>
      api.post(`/purchasing/${kind}/${id}/decision?approve=${approve}`),
    onMutate: () => setError(null),
    onError: (err) => setError(errorText(err)),
    onSettled: () => {
      for (const k of ["purchase-requests", "purchase-orders", "approvals"]) qc.invalidateQueries({ queryKey: [k] });
    },
  });
  return { decide, error };
}

// What needs doing now: the purchasing pipeline in one strip, and the next
// action on every document waiting for someone. Everything is derived from the
// same lists the other screens use; approving and rejecting work in place.
export function PurchasingToday({ onOpen }: { onOpen: (tab: string) => void }) {
  const { data: requests, isLoading } = useList<PurchaseRequest>("purchase-requests", "/purchasing/purchase-requests");
  const { data: orders } = useList<PurchaseOrder>("purchase-orders", "/purchasing/purchase-orders");
  const { data: suppliers } = useList<Supplier>("suppliers", "/suppliers");
  const { data: grns } = useList<GrnRow>("grns", "/purchasing/grns");
  const { data: templates } = useList<PrTemplate>("pr-templates", "/purchasing/pr-templates");
  const [showAll, setShowAll] = useState(false);

  const { decide, error } = useDecide();

  if (isLoading) return <Spinner />;

  const prs = requests ?? [];
  const pos = orders ?? [];
  const today = todayIso();
  const supplierName = (id: string) => suppliers?.find((s) => s.id === id)?.name ?? "Supplier";
  const money = (n: number) => `KWD ${n.toFixed(3)}`;

  const drafts = prs.filter((r) => r.status === "Draft");
  const prToApprove = prs.filter((r) => r.status === "Submitted");
  const poToApprove = pos.filter((o) => o.status === "Submitted");
  const readyToOrder = prs.filter((r) => r.status === "Approved");
  const onOrder = pos.filter((o) => OPEN_PO.includes(o.status));
  const dueToReceive = onOrder.filter((o) => o.expected_date && o.expected_date <= today);
  const variances = (grns ?? []).filter((g) => g.has_variance && g.status === "Submitted");
  const toPay = pos.filter((o) => o.payment_status === "Unpaid" && o.status !== "Rejected" && o.status !== "Submitted");

  const stages = [
    { label: "Drafts", n: drafts.length, hot: false, tab: "All documents" },
    { label: "To approve", n: prToApprove.length + poToApprove.length, hot: true, tab: "All documents" },
    { label: "Ready to order", n: readyToOrder.length, hot: true, tab: "All documents" },
    { label: "On order", n: onOrder.length, hot: false, tab: "All documents" },
    { label: "Due to receive", n: dueToReceive.length, hot: true, tab: "All documents" },
    { label: "To pay", n: toPay.length, hot: false, tab: "All documents" },
  ];

  const approveButtons = (kind: "purchase-requests" | "purchase-orders", id: string) => (
    <>
      <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ kind, id, approve: true })}>Approve</Button>
      <Button size="sm" variant="danger" disabled={decide.isPending} onClick={() => decide.mutate({ kind, id, approve: false })}>Reject</Button>
    </>
  );

  // Most urgent first: problems, then decisions, then ordering, then receiving.
  const tasks: Task[] = [
    ...variances.map((g): Task => ({
      key: `g${g.id}`, kind: "Review", tone: "critical", title: `${g.code} price variance`,
      detail: `${g.supplier_name ?? "Supplier"} · ${g.po_code ?? ""} · ${money(Math.abs(g.variance_total))} ${g.variance_total >= 0 ? "over" : "under"} the order`,
      actions: <Button size="sm" variant="secondary" onClick={() => onOpen("Goods Received")}>Review</Button>,
    })),
    ...prToApprove.map((r): Task => ({
      key: `r${r.id}`, kind: "Approve", tone: "warning", title: `${r.code} · ${r.cost_center ?? "No cost center"}`,
      detail: `${r.lines.length} item${r.lines.length === 1 ? "" : "s"} · ${money(r.total_est_cost)}${r.urgency === "High" ? " · High urgency" : ""}${r.requested_by_name ? ` · ${r.requested_by_name}` : ""}`,
      actions: approveButtons("purchase-requests", r.id),
    })),
    ...poToApprove.map((o): Task => ({
      key: `a${o.id}`, kind: "Approve", tone: "warning", title: `${o.code} · ${supplierName(o.supplier_id)}`,
      detail: `Purchase order · ${money(o.total)}`,
      actions: approveButtons("purchase-orders", o.id),
    })),
    ...readyToOrder.map((r): Task => ({
      key: `o${r.id}`, kind: "Order", tone: "info", title: `${r.code} approved`,
      detail: `${r.lines.length} item${r.lines.length === 1 ? "" : "s"} · ${money(r.total_est_cost)} · choose suppliers`,
      actions: <Link to={`/purchasing/orders/new/${r.id}`}><Button size="sm">Create orders</Button></Link>,
    })),
    ...dueToReceive.map((o): Task => ({
      key: `p${o.id}`, kind: "Receive", tone: "good", title: `${o.code} · ${supplierName(o.supplier_id)}`,
      detail: `Due ${daysLabel(daysUntil(o.expected_date!))} · ${o.lines.length} line${o.lines.length === 1 ? "" : "s"} · ${money(o.total)}`,
      actions: <Link to={`/purchasing/grn/${o.id}`}><Button size="sm">Receive</Button></Link>,
    })),
  ];
  const visible = showAll ? tasks : tasks.slice(0, SHOWN);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {stages.map((s) => {
          const hot = s.hot && s.n > 0;
          return (
            <button key={s.label} type="button" onClick={() => onOpen(s.tab)}
              className="flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left"
              style={{ borderColor: hot ? "var(--status-warning)" : "var(--border)", background: hot ? "var(--status-warning-bg)" : "var(--surface)" }}>
              <span className="font-display text-2xl font-semibold leading-none tabular-nums" style={{ color: hot ? "var(--status-warning)" : "var(--ink-900)" }}>{s.n}</span>
              <span className="text-[11.5px] font-bold" style={{ color: "var(--ink-500)" }}>{s.label}</span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Card>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-[13px] font-extrabold">Needs you</h2>
            <span className="text-[12px]" style={{ color: "var(--ink-400)" }}>{tasks.length} item{tasks.length === 1 ? "" : "s"}</span>
          </div>
          {error && <p className="mb-2 text-[13px]" style={{ color: "var(--status-critical)" }}>{error}</p>}
          {tasks.length === 0 ? (
            <EmptyState label="Nothing is waiting on you. New requests, deliveries and variances will appear here." />
          ) : (
            <div className="flex flex-col">
              {visible.map((t) => (
                <div key={t.key} className="flex flex-wrap items-center gap-3 border-t py-3 first:border-t-0 first:pt-0" style={{ borderColor: "var(--border)" }}>
                  <span className="w-[72px] shrink-0"><Badge tone={t.tone}>{t.kind}</Badge></span>
                  <div className="min-w-[180px] flex-1">
                    <div className="text-[13.5px] font-semibold">{t.title}</div>
                    <div className="text-[12.5px]" style={{ color: "var(--ink-500)" }}>{t.detail}</div>
                  </div>
                  <div className="flex gap-2">{t.actions}</div>
                </div>
              ))}
              {tasks.length > SHOWN && (
                <button type="button" className="mt-2 self-start text-[12.5px] font-semibold" style={{ color: "var(--brass-600)" }} onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "Show fewer" : `Show all ${tasks.length}`}
                </button>
              )}
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-[13px] font-extrabold">Start faster</h2>
          <div className="flex flex-col">
            {(templates ?? []).slice(0, 3).map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 border-t py-2.5 first:border-t-0 first:pt-0" style={{ borderColor: "var(--border)" }}>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold">{t.name}</div>
                  <div className="text-[12px]" style={{ color: "var(--ink-500)" }}>Template · {t.lines.length} items</div>
                </div>
                <Link to={`/purchasing/requests/new?template=${t.id}`}><Button size="sm" variant="secondary">Start</Button></Link>
              </div>
            ))}
            <div className="flex items-center justify-between gap-2 border-t py-2.5 first:border-t-0 first:pt-0" style={{ borderColor: "var(--border)" }}>
              <div className="text-[13px] font-semibold">Blank request</div>
              <Link to="/purchasing/requests/new"><Button size="sm" variant="secondary">New</Button></Link>
            </div>
            <div className="flex items-center justify-between gap-2 border-t py-2.5" style={{ borderColor: "var(--border)" }}>
              <div className="text-[13px] font-semibold">Shopping basket</div>
              <Button size="sm" variant="secondary" onClick={() => onOpen("Shopping Basket")}>Open</Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
