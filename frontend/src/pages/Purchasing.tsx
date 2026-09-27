import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useCreate, useList, useUpdate } from "../api/hooks";
import { Icon } from "../components/icons";
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Spinner, StatTile, Table, Td, Th, statusTone } from "../components/ui";
import { fmtDate, todayIso } from "../lib/date";
import type { CreditNote, FoodInventoryItem, InventoryItem, ItemMasterEntry, PoLine, PurchaseOrder, PurchaseRequest, PurchaseRequestLine, StaffMember, Supplier, UnitOfMeasureEntry } from "../types";

interface GrnLine { id: string; name: string; ordered_qty: number; received_qty: number; unit: string; ordered_price: number; price: number }
interface Grn { id: string; code: string; po_id: string; supplier_id: string; date: string; received_by_name: string | null; lines: GrnLine[] }

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px]" style={{ color: "var(--ink-400)" }}>{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

const TABS = ["Purchase Requests", "Purchase Orders", "Goods Received", "Shopping Basket", "Suppliers", "Credit Notes"] as const;

export function Purchasing() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Purchase Requests");
  const { data: requests } = useList<PurchaseRequest>("purchase-requests", "/purchasing/purchase-requests");
  const { data: orders } = useList<PurchaseOrder>("purchase-orders", "/purchasing/purchase-orders");
  const { data: suppliers } = useList<Supplier>("suppliers", "/suppliers");

  const pending = requests?.filter((r) => r.status === "Pending Approval").length ?? 0;
  const openOrders = orders?.filter((o) => o.status !== "Goods Received").length ?? 0;
  const unpaidTotal = orders?.filter((o) => o.payment_status === "Unpaid").reduce((s, o) => s + o.total, 0) ?? 0;

  return (
    <div>
      <PageHeader title="Purchasing" subtitle="Item Master → Request → Approve → Order → Receive (GRN) → Main Inventory." />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Pending Approval" icon="purchasing" value={pending} progressColor="var(--status-warning)" />
        <StatTile label="Open Orders" icon="clock" value={openOrders} />
        <StatTile label="Unpaid Orders" icon="expenses" value={`KWD ${unpaidTotal.toFixed(0)}`} />
        <StatTile label="Active Suppliers" icon="people" value={suppliers?.length ?? 0} />
      </div>

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

      {tab === "Purchase Requests" && <RequestsTab />}
      {tab === "Purchase Orders" && <OrdersTab />}
      {tab === "Goods Received" && <GoodsReceivedTab />}
      {tab === "Shopping Basket" && <ShoppingBasketTab />}
      {tab === "Suppliers" && <SuppliersTab />}
      {tab === "Credit Notes" && <CreditNotesTab />}
    </div>
  );
}

function RequestsTab() {
  const { data, isLoading } = useList<PurchaseRequest>("purchase-requests", "/purchasing/purchase-requests");
  const { data: staff } = useList<StaffMember>("staff", "/people/staff");
  const qc = useQueryClient();
  const [detail, setDetail] = useState<PurchaseRequest | null>(null);
  const decide = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) =>
      api.post(`/purchasing/purchase-requests/${id}/decision?approve=${approve}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchase-requests"] }),
  });
  const requesterName = (userId: string | null) => staff?.find((s) => s.user_id === userId)?.name ?? "—";

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Link to="/purchasing/requests/new"><Button>+ New Request</Button></Link>
      </div>

      {isLoading ? <Spinner /> : !data || data.length === 0 ? <EmptyState label="No purchase requests." /> : (
        <Table>
          <thead><tr><Th>Items</Th><Th>Requested by</Th><Th>Date</Th><Th>Urgency</Th><Th>Est. cost</Th><Th>Status</Th><Th>Action</Th></tr></thead>
          <tbody>
            {data.map((pr) => (
              <tr key={pr.id} className="cursor-pointer" onClick={() => setDetail(pr)}>
                <Td className="font-medium">
                  {pr.lines[0]?.item_name ?? "empty request"}
                  {pr.lines.length > 1 && <span style={{ color: "var(--ink-400)" }}> +{pr.lines.length - 1} more</span>}
                  <div className="text-xs" style={{ color: "var(--ink-400)" }}>{pr.lines.length} item(s)</div>
                </Td>
                <Td>{requesterName(pr.requested_by)}</Td>
                <Td>{fmtDate(pr.request_date)}</Td>
                <Td><Badge tone={statusTone(pr.urgency)}>{pr.urgency}</Badge></Td>
                <Td>KWD {pr.total_est_cost.toFixed(2)}</Td>
                <Td><Badge tone={statusTone(pr.status)}>{pr.status}</Badge></Td>
                <Td onClick={(e) => e.stopPropagation()}>
                  {pr.status === "Pending Approval" && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => decide.mutate({ id: pr.id, approve: true })}>Approve</Button>
                      <Button size="sm" variant="danger" onClick={() => decide.mutate({ id: pr.id, approve: false })}>Reject</Button>
                    </div>
                  )}
                  {pr.status === "Approved" && (
                    <Link to={`/purchasing/orders/new/${pr.id}`}><Button size="sm" variant="secondary">Create PO</Button></Link>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {detail && (
        <Modal title={`Request — ${detail.lines.length} item(s)`} onClose={() => setDetail(null)}>
          <Table>
            <thead><tr><Th>Item</Th><Th>Qty</Th><Th>Category</Th><Th>Est. cost</Th></tr></thead>
            <tbody>
              {detail.lines.map((l) => (
                <tr key={l.id}>
                  <Td className="font-medium">{l.item_name}</Td>
                  <Td>{l.qty} {l.unit}</Td>
                  <Td>{l.category}</Td>
                  <Td>KWD {l.est_cost.toFixed(2)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {detail.note && <p className="mt-3 text-[13px]" style={{ color: "var(--ink-500)" }}>{detail.note}</p>}
        </Modal>
      )}
    </div>
  );
}

interface RequestLine { itemRef: string; item: string; qty: number; unit: string; category: string; est_cost: number }

function newRequestLine(defaultUnit: string): RequestLine {
  return { itemRef: "", item: "", qty: 1, unit: defaultUnit, category: "", est_cost: 0 };
}

export function NewPurchaseRequestPage() {
  const navigate = useNavigate();
  const { data: itemMaster } = useList<ItemMasterEntry>("item-master", "/item-master");
  const { data: uomsRaw } = useList<UnitOfMeasureEntry>("units-of-measure", "/units-of-measure");
  const uoms = [...(uomsRaw ?? [])].sort((a, b) => a.label.localeCompare(b.label));
  const create = useCreate<PurchaseRequest>("purchase-requests", "/purchasing/purchase-requests");
  const [lines, setLines] = useState<RequestLine[]>([newRequestLine("")]);
  const [urgency, setUrgency] = useState("Medium");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (uoms.length === 0) return;
    setLines((ls) => ls.map((l) => (l.unit ? l : { ...l, unit: uoms[0].label })));
  }, [uoms]);

  function updateLine(i: number, patch: Partial<RequestLine>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function onPickItem(i: number, id: string) {
    const im = itemMaster?.find((x) => x.id === id);
    updateLine(i, {
      itemRef: id,
      ...(im ? { item: im.name, unit: im.uom, category: im.stock_type === "food" ? "Kitchen" : "General", est_cost: im.last_price } : {}),
    });
  }
  function addLine() {
    setLines((ls) => [...ls, newRequestLine(uoms[0]?.label ?? "")]);
  }
  function removeLine(i: number) {
    setLines((ls) => ls.filter((_, idx) => idx !== i));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await create.mutateAsync({
        urgency, note: note || null,
        lines: lines.map((l) => ({
          item_master_id: l.itemRef || null, item_name: l.item, qty: l.qty,
          unit: l.unit, category: l.category, est_cost: l.est_cost,
        })),
      } as never);
      navigate("/purchasing");
    } finally {
      setSubmitting(false);
    }
  }

  const totalEstCost = lines.reduce((s, l) => s + l.est_cost, 0);

  return (
    <div>
      <Link to="/purchasing" className="mb-3 inline-block text-[13px] font-semibold" style={{ color: "var(--brass-600)" }}>← Back to Purchasing</Link>
      <PageHeader title="New purchase request" subtitle="Add every item you need — the whole list becomes one request, approved and ordered together." />
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 max-w-xl rounded-xl border p-3" style={{ borderColor: "var(--border-strong)" }}>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Urgency
            <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={urgency} onChange={(e) => setUrgency(e.target.value)}>
              {["Low", "Medium", "High"].map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Note (optional)
            <input className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr><Th>Item (from Item Master)</Th><Th>Custom item name</Th><Th>Qty</Th><Th>Unit</Th><Th>Category</Th><Th>Est. cost (KWD)</Th><Th>{" "}</Th></tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={i}>
                  <Td>
                    <select className="w-40 rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-strong)" }}
                      value={line.itemRef} onChange={(e) => onPickItem(i, e.target.value)}>
                      <option value="">— custom item —</option>
                      {itemMaster?.filter((im) => im.active).map((im) => <option key={im.id} value={im.id}>{im.name}</option>)}
                    </select>
                  </Td>
                  <Td>
                    <input required={!line.itemRef} disabled={!!line.itemRef} placeholder="e.g. Coffee Beans"
                      className="w-40 rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-strong)" }}
                      value={line.item} onChange={(e) => updateLine(i, { item: e.target.value })} />
                  </Td>
                  <Td>
                    <input type="number" required className="w-20 rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-strong)" }}
                      value={line.qty} onChange={(e) => updateLine(i, { qty: Number(e.target.value) })} />
                  </Td>
                  <Td>
                    <select required className="w-24 rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-strong)" }}
                      value={line.unit} onChange={(e) => updateLine(i, { unit: e.target.value })}>
                      {line.unit && !uoms.some((u) => u.label === line.unit) && <option value={line.unit}>{line.unit}</option>}
                      {uoms.map((u) => <option key={u.id} value={u.label}>{u.label}</option>)}
                    </select>
                  </Td>
                  <Td>
                    <input required className="w-28 rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-strong)" }}
                      value={line.category} onChange={(e) => updateLine(i, { category: e.target.value })} />
                  </Td>
                  <Td>
                    <input type="number" step="0.01" className="w-24 rounded-lg border px-2 py-1.5 text-right text-sm" style={{ borderColor: "var(--border-strong)" }}
                      value={line.est_cost} onChange={(e) => updateLine(i, { est_cost: Number(e.target.value) })} />
                  </Td>
                  <Td>
                    {lines.length > 1 && (
                      <button type="button" className="text-xs font-semibold" style={{ color: "var(--status-critical)" }} onClick={() => removeLine(i)}>
                        Remove
                      </button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>

        <div className="flex items-center justify-between max-w-3xl">
          <Button type="button" variant="secondary" onClick={addLine}>+ Add another item</Button>
          <span className="text-[13px] font-semibold">Total est. cost: KWD {totalEstCost.toFixed(2)}</span>
        </div>
        <Button type="submit" disabled={submitting} className="self-start">
          {submitting ? "Submitting..." : `Submit Request (${lines.length} item${lines.length > 1 ? "s" : ""})`}
        </Button>
      </form>
    </div>
  );
}

const UNASSIGNED = "unassigned";

export function NewPurchaseOrderPage() {
  const { prId } = useParams<{ prId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: requests, isLoading } = useList<PurchaseRequest>("purchase-requests", "/purchasing/purchase-requests");
  const { data: suppliers } = useList<Supplier>("suppliers", "/suppliers");
  const { data: itemMaster } = useList<ItemMasterEntry>("item-master", "/item-master");
  const pr = requests?.find((r) => r.id === prId);

  // Auto-groups the PR's lines by each item's preferred supplier (Odoo's
  // own behavior for a multi-vendor request) — a line with no linked Item
  // Master row, or no preferred supplier set, falls into one bucket the
  // user assigns a supplier to manually.
  const groups = useMemo(() => {
    if (!pr) return [];
    const byKey = new Map<string, PurchaseRequestLine[]>();
    for (const line of pr.lines) {
      const im = line.item_master_id ? itemMaster?.find((x) => x.id === line.item_master_id) : undefined;
      const key = im?.preferred_supplier_id ?? UNASSIGNED;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(line);
    }
    return [...byKey.entries()].map(([key, lines]) => ({ key, resolvedSupplierId: key === UNASSIGNED ? "" : key, lines }));
  }, [pr, itemMaster]);

  // groupSupplier only holds a value once the user has actually picked one
  // (or changed a pre-resolved one) — the effective value for a group that
  // hasn't been touched yet is derived from its resolved preferred supplier
  // at read time, not synced into state, so it stays correct across
  // itemMaster's own load timing instead of racing it.
  const [groupSupplier, setGroupSupplier] = useState<Record<string, string>>({});
  const [expectedDates, setExpectedDates] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!pr) return;
    setPrices((s) => {
      const next = { ...s };
      for (const line of pr.lines) if (next[line.id] === undefined) next[line.id] = line.qty ? line.est_cost / line.qty : 0;
      return next;
    });
  }, [pr]);

  function effectiveSupplier(g: { key: string; resolvedSupplierId: string }): string {
    return groupSupplier[g.key] ?? g.resolvedSupplierId;
  }

  const convert = useMutation({
    mutationFn: async () =>
      api.post(`/purchasing/purchase-requests/${prId}/convert-to-po`, {
        groups: groups.map((g) => ({
          supplier_id: effectiveSupplier(g),
          expected_date: expectedDates[g.key] || null,
          lines: g.lines.map((l) => ({ pr_line_id: l.id, price: prices[l.id] ?? 0 })),
        })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-requests"] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      navigate("/purchasing");
    },
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (groups.some((g) => !effectiveSupplier(g))) return;
    await convert.mutateAsync();
  }

  if (isLoading) return <Spinner />;
  if (!pr) return <EmptyState label="Purchase request not found." />;

  const grandTotal = groups.reduce(
    (s, g) => s + g.lines.reduce((gs, l) => gs + (prices[l.id] ?? 0) * l.qty, 0), 0,
  );

  return (
    <div>
      <Link to="/purchasing" className="mb-3 inline-block text-[13px] font-semibold" style={{ color: "var(--brass-600)" }}>← Back to Purchasing</Link>
      <PageHeader
        title={`Create purchase order${groups.length > 1 ? "s" : ""} — ${pr.lines.length} item(s)`}
        subtitle={groups.length > 1 ? `Split into ${groups.length} orders by preferred supplier.` : undefined}
      />
      <form onSubmit={onSubmit} className="flex flex-col gap-4 max-w-3xl">
        {groups.map((g) => {
          const groupTotal = g.lines.reduce((s, l) => s + (prices[l.id] ?? 0) * l.qty, 0);
          return (
            <div key={g.key} className="flex flex-col gap-3 rounded-xl border p-3" style={{ borderColor: "var(--border-strong)" }}>
              <div className="flex items-center gap-3">
                <label className="flex flex-1 flex-col gap-1 text-[13px] font-medium">
                  {g.resolvedSupplierId ? "Supplier (preferred)" : "Supplier — none preferred, choose one"}
                  <select required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
                    value={effectiveSupplier(g)} onChange={(e) => setGroupSupplier((s) => ({ ...s, [g.key]: e.target.value }))}>
                    <option value="">— choose a supplier —</option>
                    {suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[13px] font-medium">Expected delivery
                  <input type="date" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
                    value={expectedDates[g.key] ?? ""} onChange={(e) => setExpectedDates((s) => ({ ...s, [g.key]: e.target.value }))} />
                </label>
              </div>
              <Table>
                <thead><tr><Th>Item</Th><Th>Qty</Th><Th>Price/unit (KWD)</Th><Th>Line total</Th></tr></thead>
                <tbody>
                  {g.lines.map((l) => (
                    <tr key={l.id}>
                      <Td className="font-medium">{l.item_name}</Td>
                      <Td>{l.qty} {l.unit}</Td>
                      <Td>
                        <input type="number" step="0.001" required
                          className="w-24 rounded-lg border px-2 py-1 text-right text-sm"
                          style={{ borderColor: "var(--border-strong)" }}
                          value={prices[l.id] ?? 0}
                          onChange={(e) => setPrices((s) => ({ ...s, [l.id]: Number(e.target.value) }))}
                        />
                      </Td>
                      <Td>KWD {((prices[l.id] ?? 0) * l.qty).toFixed(2)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="text-[12.5px]" style={{ color: "var(--ink-400)" }}>
                Order total: KWD {groupTotal.toFixed(2)}{groupTotal > 500 ? " — over KWD 500, will require Owner approval" : ""}
              </div>
            </div>
          );
        })}
        <div className="text-[13px] font-semibold">Grand total across {groups.length} order{groups.length > 1 ? "s" : ""}: KWD {grandTotal.toFixed(2)}</div>
        <Button type="submit" disabled={convert.isPending}>
          {convert.isPending ? "Creating..." : `Create ${groups.length} Purchase Order${groups.length > 1 ? "s" : ""}`}
        </Button>
      </form>
    </div>
  );
}

function OrdersTab() {
  const { data, isLoading } = useList<PurchaseOrder>("purchase-orders", "/purchasing/purchase-orders");
  const { data: suppliers } = useList<Supplier>("suppliers", "/suppliers");
  const qc = useQueryClient();
  const [detail, setDetail] = useState<PurchaseOrder | null>(null);
  const decide = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) =>
      api.post(`/purchasing/purchase-orders/${id}/decision?approve=${approve}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["purchase-orders"] }); setDetail(null); },
  });

  const supplierName = (id: string) => suppliers?.find((s) => s.id === id)?.name ?? "—";

  async function downloadPoPdf(po: PurchaseOrder) {
    // A plain <a href> won't carry the Bearer token — fetch as an
    // authenticated blob and open that instead (same pattern as Documents).
    const res = await api.get(`/purchasing/purchase-orders/${po.id}/pdf`, { responseType: "blob" });
    const blobUrl = URL.createObjectURL(res.data as Blob);
    window.open(blobUrl, "_blank");
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }

  if (isLoading) return <Spinner />;
  if (!data || data.length === 0) return <EmptyState label="No purchase orders." />;

  return (
    <div>
      <Table>
        <thead><tr><Th>PO</Th><Th>Supplier</Th><Th>Items</Th><Th>Ordered</Th><Th>Expected</Th><Th>Total</Th><Th>Status</Th><Th>Payment</Th><Th>{" "}</Th></tr></thead>
        <tbody>
          {data.map((po) => {
            const recv = po.lines.reduce((s, l) => s + l.received_qty, 0);
            const ord = po.lines.reduce((s, l) => s + l.qty, 0);
            return (
              <tr key={po.id} className="cursor-pointer" onClick={() => setDetail(po)}>
                <Td className="font-medium">{po.code}</Td>
                <Td>{supplierName(po.supplier_id)}</Td>
                <Td className="text-xs" style={{ color: "var(--ink-500)" }}>{po.lines.length} item(s) · {recv}/{ord} recv.</Td>
                <Td>{fmtDate(po.order_date)}</Td>
                <Td>{po.expected_date ? fmtDate(po.expected_date) : "—"}</Td>
                <Td>KWD {po.total.toFixed(2)}</Td>
                <Td><Badge tone={statusTone(po.status)}>{po.status}</Badge></Td>
                <Td><Badge tone={statusTone(po.payment_status)}>{po.payment_status}</Badge></Td>
                <Td onClick={(e) => e.stopPropagation()}>
                  {po.status === "Pending Approval" && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => decide.mutate({ id: po.id, approve: true })}>Approve</Button>
                      <Button size="sm" variant="danger" onClick={() => decide.mutate({ id: po.id, approve: false })}>Reject</Button>
                    </div>
                  )}
                  {(po.status === "Ordered" || po.status === "Partially Received") && (
                    <Link to={`/purchasing/grn/${po.id}`}><Button size="sm" variant="secondary">Receive</Button></Link>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>

      {detail && (
        <Modal title={detail.code} onClose={() => setDetail(null)}>
          <div className="flex flex-col gap-3 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{supplierName(detail.supplier_id)}</Badge>
              <Badge tone={statusTone(detail.status)}>{detail.status}</Badge>
              <Badge tone={statusTone(detail.payment_status)}>{detail.payment_status}</Badge>
            </div>
            <Table>
              <thead><tr><Th>Item</Th><Th>Ordered</Th><Th>Received</Th><Th>Pending</Th><Th>Price</Th></tr></thead>
              <tbody>
                {detail.lines.map((l) => (
                  <tr key={l.id}>
                    <Td className="font-medium">{l.name}</Td>
                    <Td>{l.qty} {l.unit}</Td>
                    <Td>{l.received_qty} {l.unit}</Td>
                    <Td>{l.qty - l.received_qty} {l.unit}</Td>
                    <Td>KWD {l.price.toFixed(3)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="grid grid-cols-2 gap-2">
              <InfoRow label="Order date" value={fmtDate(detail.order_date)} />
              <InfoRow label="Expected" value={detail.expected_date ? fmtDate(detail.expected_date) : "—"} />
              <InfoRow label="Total" value={`KWD ${detail.total.toFixed(2)}`} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => downloadPoPdf(detail)}>Download PDF</Button>
              {detail.status === "Pending Approval" && (
                <Button onClick={() => decide.mutate({ id: detail.id, approve: true })} disabled={decide.isPending}>Approve Order</Button>
              )}
              {(detail.status === "Ordered" || detail.status === "Partially Received") && (
                <Link to={`/purchasing/grn/${detail.id}`}><Button>Receive Goods (GRN)</Button></Link>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function ReceiveGoodsPage() {
  const { poId } = useParams<{ poId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: orders, isLoading } = useList<PurchaseOrder>("purchase-orders", "/purchasing/purchase-orders");
  const { data: suppliers } = useList<Supplier>("suppliers", "/suppliers");
  const { data: itemMaster } = useList<ItemMasterEntry>("item-master", "/item-master");
  const po = orders?.find((o) => o.id === poId);
  const supplierName = suppliers?.find((s) => s.id === po?.supplier_id)?.name ?? "—";
  const pending = po?.lines.filter((l) => l.received_qty < l.qty) ?? [];
  const [qtys, setQtys] = useState<Record<string, number>>({});
  // Defaults to each line's ordered price — leave untouched for "received
  // exactly as ordered", or adjust if the actual invoice came in different.
  const [prices, setPrices] = useState<Record<string, number>>({});
  // Food lines only — creates a new FEFO batch lot instead of blending into
  // one stock figure; optional, left blank means "no batch tracking for this receipt".
  const [expiries, setExpiries] = useState<Record<string, string>>({});
  const [batchLabels, setBatchLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!po || Object.keys(qtys).length > 0) return;
    setQtys(Object.fromEntries(pending.map((l) => [l.id, l.qty - l.received_qty])));
    setPrices(Object.fromEntries(pending.map((l) => [l.id, l.price])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [po]);

  function isFoodLine(l: PoLine): boolean {
    return itemMaster?.find((im) => im.id === l.item_master_id)?.stock_type === "food";
  }

  const receive = useMutation({
    mutationFn: async () =>
      api.post("/purchasing/grns", {
        po_id: poId,
        lines: pending
          .filter((l) => (qtys[l.id] ?? 0) > 0)
          .map((l) => ({
            po_line_id: l.id,
            received_qty: Math.min(qtys[l.id] ?? 0, l.qty - l.received_qty),
            actual_price: prices[l.id] ?? l.price,
            expiry: isFoodLine(l) ? (expiries[l.id] || null) : null,
            batch_label: isFoodLine(l) ? (batchLabels[l.id] || null) : null,
          })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["grns"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["food-inventory"] });
      qc.invalidateQueries({ queryKey: ["expenses"] });
      navigate("/purchasing");
    },
  });

  if (isLoading) return <Spinner />;
  if (!po) return <EmptyState label="Purchase order not found." />;

  return (
    <div>
      <Link to="/purchasing" className="mb-3 inline-block text-[13px] font-semibold" style={{ color: "var(--brass-600)" }}>← Back to Purchasing</Link>
      <PageHeader title={`Receive goods — ${po.code}`} />
      <div className="flex flex-col gap-3 text-[13px]">
        <div className="flex items-center gap-2">
          <Badge>{supplierName}</Badge>
          <span style={{ color: "var(--ink-500)" }}>
            Enter the quantity actually received for each line — partial receipts are supported. Adjust the price
            only if the actual invoice differs from what was ordered.
          </span>
        </div>
        <Table>
          <thead><tr><Th>Item</Th><Th>Ordered</Th><Th>Already received</Th><Th>Pending</Th><Th>Receiving now</Th><Th>Actual price</Th><Th>Expiry</Th><Th>Batch</Th></tr></thead>
          <tbody>
            {pending.map((l) => {
              const pendingQty = l.qty - l.received_qty;
              const adjusted = (prices[l.id] ?? l.price) !== l.price;
              const food = isFoodLine(l);
              return (
                <tr key={l.id}>
                  <Td className="font-medium">{l.name}</Td>
                  <Td>{l.qty} {l.unit}</Td>
                  <Td>{l.received_qty} {l.unit}</Td>
                  <Td>{pendingQty} {l.unit}</Td>
                  <Td>
                    <input
                      type="number" min={0} max={pendingQty} step="any"
                      className="w-20 rounded-lg border px-2 py-1 text-right text-sm"
                      style={{ borderColor: "var(--border-strong)" }}
                      value={qtys[l.id] ?? 0}
                      onChange={(e) => setQtys((s) => ({ ...s, [l.id]: Number(e.target.value) }))}
                    />
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number" min={0} step="any"
                        className="w-24 rounded-lg border px-2 py-1 text-right text-sm"
                        style={{ borderColor: adjusted ? "var(--status-warning)" : "var(--border-strong)" }}
                        value={prices[l.id] ?? l.price}
                        onChange={(e) => setPrices((s) => ({ ...s, [l.id]: Number(e.target.value) }))}
                      />
                      {adjusted && <Badge tone="warning">was KWD {l.price.toFixed(3)}</Badge>}
                    </div>
                  </Td>
                  <Td>
                    {food ? (
                      <input
                        type="date"
                        className="w-36 rounded-lg border px-2 py-1 text-sm"
                        style={{ borderColor: "var(--border-strong)" }}
                        value={expiries[l.id] ?? ""}
                        onChange={(e) => setExpiries((s) => ({ ...s, [l.id]: e.target.value }))}
                      />
                    ) : "—"}
                  </Td>
                  <Td>
                    {food ? (
                      <input
                        type="text" placeholder="Optional"
                        className="w-24 rounded-lg border px-2 py-1 text-sm"
                        style={{ borderColor: "var(--border-strong)" }}
                        value={batchLabels[l.id] ?? ""}
                        onChange={(e) => setBatchLabels((s) => ({ ...s, [l.id]: e.target.value }))}
                      />
                    ) : "—"}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        <Button onClick={() => receive.mutate()} disabled={receive.isPending}>
          {receive.isPending ? "Posting..." : "Post Goods Receipt"}
        </Button>
      </div>
    </div>
  );
}

function GoodsReceivedTab() {
  const { data: grns, isLoading } = useList<Grn>("grns", "/purchasing/grns");
  const { data: suppliers } = useList<Supplier>("suppliers", "/suppliers");
  const { data: orders } = useList<PurchaseOrder>("purchase-orders", "/purchasing/purchase-orders");
  const [detail, setDetail] = useState<Grn | null>(null);
  const supplierName = (id: string) => suppliers?.find((s) => s.id === id)?.name ?? "—";
  const poCode = (id: string) => orders?.find((o) => o.id === id)?.code ?? id.slice(0, 8);

  if (isLoading) return <Spinner />;
  if (!grns || grns.length === 0) return <EmptyState label="No goods received yet — receive an ordered PO to see it here." />;

  return (
    <div>
      <Table>
        <thead><tr><Th>GRN</Th><Th>PO</Th><Th>Supplier</Th><Th>Date</Th><Th>Received by</Th><Th>Lines</Th><Th>Value</Th></tr></thead>
        <tbody>
          {grns.map((g) => {
            const value = g.lines.reduce((s, l) => s + l.received_qty * l.price, 0);
            return (
              <tr key={g.id} className="cursor-pointer" onClick={() => setDetail(g)}>
                <Td className="font-medium">{g.code}</Td>
                <Td>{poCode(g.po_id)}</Td>
                <Td>{supplierName(g.supplier_id)}</Td>
                <Td>{fmtDate(g.date)}</Td>
                <Td>{g.received_by_name ?? "—"}</Td>
                <Td>{g.lines.length}</Td>
                <Td>KWD {value.toFixed(2)}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>

      {detail && (
        <Modal title={detail.code} onClose={() => setDetail(null)}>
          <div className="flex flex-col gap-3 text-[13px]">
            <div className="grid grid-cols-2 gap-2">
              <InfoRow label="Purchase order" value={poCode(detail.po_id)} />
              <InfoRow label="Supplier" value={supplierName(detail.supplier_id)} />
              <InfoRow label="Date" value={fmtDate(detail.date)} />
              <InfoRow label="Received by" value={detail.received_by_name ?? "—"} />
            </div>
            <Table>
              <thead><tr><Th>Item</Th><Th>Ordered</Th><Th>Received</Th><Th>Price</Th><Th>Line value</Th></tr></thead>
              <tbody>
                {detail.lines.map((l) => (
                  <tr key={l.id}>
                    <Td className="font-medium">{l.name}</Td>
                    <Td>{l.ordered_qty} {l.unit}</Td>
                    <Td>{l.received_qty} {l.unit}</Td>
                    <Td>
                      KWD {l.price.toFixed(3)}
                      {l.price !== l.ordered_price && (
                        <span className="ml-1.5 text-[11px]" style={{ color: "var(--status-warning)" }}>
                          (ordered KWD {l.ordered_price.toFixed(3)})
                        </span>
                      )}
                    </Td>
                    <Td>KWD {(l.received_qty * l.price).toFixed(3)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Modal>
      )}
    </div>
  );
}

interface BasketLine { itemMasterId: string; name: string; qty: number; unit: string; category: string; estCost: number }

function ShoppingBasketTab() {
  const { data: itemMaster, isLoading } = useList<ItemMasterEntry>("item-master", "/item-master");
  const { data: foodInventory } = useList<FoodInventoryItem>("food-inventory", "/kitchen/food-inventory");
  const { data: inventory } = useList<InventoryItem>("inventory", "/inventory");
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const create = useCreate<PurchaseRequest>("purchase-requests", "/purchasing/purchase-requests");
  const [submitting, setSubmitting] = useState(false);

  // Par level (min/max) and current qty both live on whichever stock table
  // stock_type points at — food_inventory or inventory — not on Item Master.
  function stockRecord(im: ItemMasterEntry): FoodInventoryItem | InventoryItem | undefined {
    return im.stock_type === "food"
      ? foodInventory?.find((f) => f.id === im.stock_id)
      : inventory?.find((i) => i.id === im.stock_id);
  }
  function currentStock(im: ItemMasterEntry): number {
    const rec = stockRecord(im);
    if (!rec) return 0;
    return "qty" in rec ? rec.qty : rec.stock;
  }

  const lowStock = (itemMaster ?? []).filter((im) => {
    const rec = stockRecord(im);
    return im.active && !!rec && rec.min > 0 && currentStock(im) < rec.min;
  });

  function addToBasket(im: ItemMasterEntry) {
    if (basket.some((b) => b.itemMasterId === im.id)) return;
    const rec = stockRecord(im);
    const stock = currentStock(im);
    const target = Math.max(rec?.max ?? 0, rec?.min ?? 0);
    const qty = Math.max(target - stock, 1);
    setBasket((b) => [
      ...b,
      { itemMasterId: im.id, name: im.name, qty, unit: im.uom, category: im.stock_type === "food" ? "Food" : "General", estCost: qty * im.last_price },
    ]);
  }

  function removeFromBasket(itemMasterId: string) {
    setBasket((b) => b.filter((x) => x.itemMasterId !== itemMasterId));
  }

  function updateQty(itemMasterId: string, qty: number) {
    setBasket((b) => b.map((x) => (x.itemMasterId === itemMasterId ? { ...x, qty } : x)));
  }

  async function submitBasket() {
    setSubmitting(true);
    try {
      await create.mutateAsync({
        urgency: "Medium", note: null,
        lines: basket.map((line) => ({
          item_master_id: line.itemMasterId, item_name: line.name, qty: line.qty,
          unit: line.unit, category: line.category, est_cost: line.estCost,
        })),
      } as never);
      setBasket([]);
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) return <Spinner />;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <h3 className="mb-2 text-[13px] font-semibold" style={{ color: "var(--ink-700)" }}>Low-stock items</h3>
        {lowStock.length === 0 ? <EmptyState label="Nothing below its par level right now." /> : (
          <div className="flex flex-col gap-2">
            {lowStock.map((im) => (
              <Card key={im.id} className="flex items-center justify-between !p-3">
                <div>
                  <div className="text-[13px] font-semibold">{im.name}</div>
                  <div className="text-xs" style={{ color: "var(--ink-400)" }}>{currentStock(im)} {im.uom} left · par {stockRecord(im)?.min ?? 0}</div>
                </div>
                <Button variant="secondary" onClick={() => addToBasket(im)} disabled={basket.some((b) => b.itemMasterId === im.id)}>
                  {basket.some((b) => b.itemMasterId === im.id) ? "In basket" : "Add"}
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-[13px] font-semibold" style={{ color: "var(--ink-700)" }}>Basket ({basket.length})</h3>
        {basket.length === 0 ? <EmptyState label="Add items from the low-stock list to build a batch of purchase requests." /> : (
          <Card>
            <div className="flex flex-col gap-3">
              {basket.map((b) => (
                <div key={b.itemMasterId} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1 text-[13px] font-medium">{b.name}</div>
                  <input
                    type="number"
                    className="w-20 rounded-lg border px-2 py-1 text-sm"
                    style={{ borderColor: "var(--border-strong)" }}
                    value={b.qty}
                    onChange={(e) => updateQty(b.itemMasterId, Number(e.target.value))}
                  />
                  <span className="text-xs" style={{ color: "var(--ink-400)" }}>{b.unit}</span>
                  <Button size="sm" variant="danger" onClick={() => removeFromBasket(b.itemMasterId)}>Remove</Button>
                </div>
              ))}
              <Button onClick={submitBasket} disabled={submitting}>
                {submitting ? "Submitting..." : `Submit ${basket.length} request${basket.length > 1 ? "s" : ""}`}
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function SuppliersTab() {
  const { data, isLoading } = useList<Supplier>("suppliers", "/suppliers");
  const { data: orders } = useList<PurchaseOrder>("purchase-orders", "/purchasing/purchase-orders");
  const qc = useQueryClient();
  const [modal, setModal] = useState<"add" | Supplier | null>(null);
  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/suppliers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["suppliers"] }),
  });

  if (isLoading) return <Spinner />;

  const spendBySupplier = new Map<string, { total: number; orders: number }>();
  for (const po of orders ?? []) {
    const row = spendBySupplier.get(po.supplier_id) ?? { total: 0, orders: 0 };
    row.total += po.total;
    row.orders += 1;
    spendBySupplier.set(po.supplier_id, row);
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setModal("add")}>+ Add Supplier</Button>
      </div>
      {!data || data.length === 0 ? <EmptyState label="No suppliers yet." /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((s) => {
            const spend = spendBySupplier.get(s.id);
            return (
              <Card key={s.id}>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="font-display text-[14.5px] font-semibold">{s.name}</div>
                  {s.rating != null && (
                    <Badge tone="good">
                      <Icon name="star" className="h-3 w-3" /> {s.rating}
                    </Badge>
                  )}
                </div>
                <div className="mb-2.5 text-xs" style={{ color: "var(--ink-500)" }}>{s.category}</div>
                <div className="flex flex-col gap-1 text-[13px]">
                  <div className="flex justify-between"><span style={{ color: "var(--ink-500)" }}>Contact</span><span className="font-semibold">{s.contact ?? "—"}</span></div>
                  <div className="flex justify-between"><span style={{ color: "var(--ink-500)" }}>Phone</span><span className="font-semibold">{s.phone ?? "—"}</span></div>
                  <div className="flex justify-between"><span style={{ color: "var(--ink-500)" }}>Email</span><span className="font-semibold">{s.email ?? "—"}</span></div>
                  <div className="flex justify-between"><span style={{ color: "var(--ink-500)" }}>Partner since</span><span className="font-semibold">{s.since ?? "—"}</span></div>
                  <div className="flex justify-between"><span style={{ color: "var(--ink-500)" }}>Total purchased</span><span className="font-semibold">KWD {(spend?.total ?? 0).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span style={{ color: "var(--ink-500)" }}>Orders placed</span><span className="font-semibold">{spend?.orders ?? 0}</span></div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setModal(s)}>Edit</Button>
                  <Button
                    size="sm" variant="danger"
                    onClick={() => confirm(`Delete "${s.name}"? This can't be undone.`) && remove.mutate(s.id)}
                    disabled={remove.isPending}
                  >
                    Delete
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {modal && <SupplierModal supplier={modal === "add" ? undefined : modal} onClose={() => setModal(null)} />}
    </div>
  );
}

function SupplierModal({ supplier, onClose }: { supplier?: Supplier; onClose: () => void }) {
  const create = useCreate<Supplier>("suppliers", "/suppliers");
  const update = useUpdate<Supplier>("suppliers", "/suppliers");
  const [form, setForm] = useState({
    name: supplier?.name ?? "", category: supplier?.category ?? "",
    contact: supplier?.contact ?? "", phone: supplier?.phone ?? "", email: supplier?.email ?? "",
    rating: supplier?.rating ?? 0, since: supplier?.since ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = {
      name: form.name, category: form.category,
      contact: form.contact || null, phone: form.phone || null, email: form.email || null,
      rating: form.rating || null, since: form.since || null,
    };
    try {
      if (supplier) await update.mutateAsync({ id: supplier.id, payload });
      else await create.mutateAsync(payload as never);
      onClose();
    } catch {
      setError("Could not save — check that the name isn't already used by another supplier.");
    }
  }

  return (
    <Modal title={supplier ? `Edit ${supplier.name}` : "Add supplier"} onClose={onClose}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-medium">Supplier name
          <input required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Category
          <input required placeholder="e.g. Fresh Produce, Cleaning Supplies" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.category} onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-medium">Contact person
            <input className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.contact} onChange={(e) => setForm((s) => ({ ...s, contact: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Phone
            <input className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.phone} onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Email
            <input type="email" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Rating (0–5)
            <input type="number" min={0} max={5} step={0.1} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.rating} onChange={(e) => setForm((s) => ({ ...s, rating: Number(e.target.value) }))} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Partner since
            <input placeholder="e.g. 2023" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.since} onChange={(e) => setForm((s) => ({ ...s, since: e.target.value }))} />
          </label>
        </div>
        {error && (
          <div className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--status-critical-bg)", color: "var(--status-critical)" }}>
            {error}
          </div>
        )}
        <Button type="submit" disabled={pending}>{pending ? "Saving..." : supplier ? "Save changes" : "Add Supplier"}</Button>
      </form>
    </Modal>
  );
}

function CreditNotesTab() {
  const { data, isLoading } = useList<CreditNote>("credit-notes", "/credit-notes");
  const { data: suppliers } = useList<Supplier>("suppliers", "/suppliers");
  const { data: orders } = useList<PurchaseOrder>("purchase-orders", "/purchasing/purchase-orders");
  const qc = useQueryClient();
  const [modal, setModal] = useState<"add" | CreditNote | null>(null);
  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/credit-notes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["credit-notes"] }),
  });
  const supplierName = (id: string) => suppliers?.find((s) => s.id === id)?.name ?? "—";
  const poCode = (id: string | null) => (id ? orders?.find((o) => o.id === id)?.code ?? "—" : "—");

  if (isLoading) return <Spinner />;

  return (
    <div>
      <p className="mb-3 text-[13px]" style={{ color: "var(--ink-500)" }}>
        Supplier-issued credits — returns, overcharges, damaged-goods refunds — tracked separately from the
        original PO/GRN, ready to reconcile against a future accounting sync.
      </p>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setModal("add")}>+ Add Credit Note</Button>
      </div>
      {!data || data.length === 0 ? <EmptyState label="No credit notes yet." /> : (
        <Table>
          <thead><tr><Th>Supplier</Th><Th>PO</Th><Th>Date</Th><Th>Reason</Th><Th>Amount</Th><Th>{" "}</Th></tr></thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.id}>
                <Td className="font-medium">{supplierName(c.supplier_id)}</Td>
                <Td>{poCode(c.po_id)}</Td>
                <Td>{fmtDate(c.date)}</Td>
                <Td>{c.reason}</Td>
                <Td>KWD {c.amount.toFixed(2)}</Td>
                <Td>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setModal(c)}>Edit</Button>
                    <Button
                      size="sm" variant="danger"
                      onClick={() => confirm(`Delete this credit note for ${supplierName(c.supplier_id)}? This can't be undone.`) && remove.mutate(c.id)}
                      disabled={remove.isPending}
                    >
                      Delete
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {modal && <CreditNoteModal creditNote={modal === "add" ? undefined : modal} onClose={() => setModal(null)} />}
    </div>
  );
}

function CreditNoteModal({ creditNote, onClose }: { creditNote?: CreditNote; onClose: () => void }) {
  const { data: suppliers } = useList<Supplier>("suppliers", "/suppliers");
  const { data: orders } = useList<PurchaseOrder>("purchase-orders", "/purchasing/purchase-orders");
  const create = useCreate<CreditNote>("credit-notes", "/credit-notes");
  const update = useUpdate<CreditNote>("credit-notes", "/credit-notes");
  const [form, setForm] = useState({
    supplier_id: creditNote?.supplier_id ?? "", po_id: creditNote?.po_id ?? "",
    date: creditNote?.date ?? todayIso(), reason: creditNote?.reason ?? "",
    amount: creditNote?.amount ?? 0, notes: creditNote?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;
  const ordersForSupplier = orders?.filter((o) => o.supplier_id === form.supplier_id) ?? [];

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = {
      supplier_id: form.supplier_id, po_id: form.po_id || null,
      date: form.date, reason: form.reason, amount: form.amount, notes: form.notes || null,
    };
    try {
      if (creditNote) await update.mutateAsync({ id: creditNote.id, payload });
      else await create.mutateAsync(payload as never);
      onClose();
    } catch {
      setError("Could not save — please try again.");
    }
  }

  return (
    <Modal title={creditNote ? "Edit credit note" : "Add credit note"} onClose={onClose}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-medium">Supplier
          <select required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.supplier_id} onChange={(e) => setForm((s) => ({ ...s, supplier_id: e.target.value, po_id: "" }))}>
            <option value="">Select a supplier…</option>
            {suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Related purchase order (optional)
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.po_id} onChange={(e) => setForm((s) => ({ ...s, po_id: e.target.value }))} disabled={!form.supplier_id}>
            <option value="">— not tied to a specific PO —</option>
            {ordersForSupplier.map((o) => <option key={o.id} value={o.id}>{o.code}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-medium">Date
            <input type="date" required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.date} onChange={(e) => setForm((s) => ({ ...s, date: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Amount (KWD)
            <input type="number" step="0.01" required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.amount} onChange={(e) => setForm((s) => ({ ...s, amount: Number(e.target.value) }))} />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Reason
          <input required placeholder="e.g. Damaged goods, overcharge, return" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.reason} onChange={(e) => setForm((s) => ({ ...s, reason: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Notes
          <textarea className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.notes} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} />
        </label>
        {error && (
          <div className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--status-critical-bg)", color: "var(--status-critical)" }}>
            {error}
          </div>
        )}
        <Button type="submit" disabled={pending}>{pending ? "Saving..." : creditNote ? "Save changes" : "Add Credit Note"}</Button>
      </form>
    </Modal>
  );
}
