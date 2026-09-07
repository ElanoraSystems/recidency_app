import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useCreate, useList } from "../api/hooks";
import { Icon } from "../components/icons";
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Spinner, StatTile, Table, Td, Th, statusTone } from "../components/ui";
import { fmtDate } from "../lib/date";
import type { InventoryItem, ItemMasterEntry, PurchaseOrder, PurchaseRequest, StaffMember, Supplier, UnitOfMeasureEntry } from "../types";

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

const TABS = ["Purchase Requests", "Purchase Orders", "Goods Received", "Shopping Basket", "Suppliers"] as const;

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
    </div>
  );
}

function RequestsTab() {
  const { data, isLoading } = useList<PurchaseRequest>("purchase-requests", "/purchasing/purchase-requests");
  const { data: staff } = useList<StaffMember>("staff", "/people/staff");
  const qc = useQueryClient();
  const decide = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) =>
      api.post(`/purchasing/purchase-requests/${id}/decision?approve=${approve}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchase-requests"] }),
  });
  const [showForm, setShowForm] = useState(false);
  const [convertPr, setConvertPr] = useState<PurchaseRequest | null>(null);
  const requesterName = (userId: string | null) => staff?.find((s) => s.user_id === userId)?.name ?? "—";

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setShowForm(true)}>+ New Request</Button>
      </div>

      {isLoading ? <Spinner /> : !data || data.length === 0 ? <EmptyState label="No purchase requests." /> : (
        <Table>
          <thead><tr><Th>Item</Th><Th>Qty</Th><Th>Requested by</Th><Th>Date</Th><Th>Urgency</Th><Th>Est. cost</Th><Th>Status</Th><Th>Action</Th></tr></thead>
          <tbody>
            {data.map((pr) => (
              <tr key={pr.id}>
                <Td className="font-medium">{pr.item}<div className="text-xs" style={{ color: "var(--ink-400)" }}>{pr.category}</div></Td>
                <Td>{pr.qty} {pr.unit}</Td>
                <Td>{requesterName(pr.requested_by)}</Td>
                <Td>{fmtDate(pr.request_date)}</Td>
                <Td><Badge tone={statusTone(pr.urgency)}>{pr.urgency}</Badge></Td>
                <Td>KWD {pr.est_cost.toFixed(2)}</Td>
                <Td><Badge tone={statusTone(pr.status)}>{pr.status}</Badge></Td>
                <Td>
                  {pr.status === "Pending Approval" && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => decide.mutate({ id: pr.id, approve: true })}>Approve</Button>
                      <Button size="sm" variant="danger" onClick={() => decide.mutate({ id: pr.id, approve: false })}>Reject</Button>
                    </div>
                  )}
                  {pr.status === "Approved" && (
                    <Button size="sm" variant="secondary" onClick={() => setConvertPr(pr)}>Create PO</Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {showForm && <NewRequestModal onClose={() => setShowForm(false)} />}
      {convertPr && <ConvertToPoModal pr={convertPr} onClose={() => setConvertPr(null)} />}
    </div>
  );
}

function NewRequestModal({ onClose }: { onClose: () => void }) {
  const { data: itemMaster } = useList<ItemMasterEntry>("item-master", "/item-master");
  const { data: uomsRaw } = useList<UnitOfMeasureEntry>("units-of-measure", "/units-of-measure");
  const uoms = [...(uomsRaw ?? [])].sort((a, b) => a.label.localeCompare(b.label));
  const create = useCreate<PurchaseRequest>("purchase-requests", "/purchasing/purchase-requests");
  const [itemRef, setItemRef] = useState("");
  const [form, setForm] = useState({ item: "", qty: 1, unit: "", category: "", urgency: "Medium", est_cost: 0 });

  useEffect(() => {
    if (uoms.length > 0 && !form.unit) setForm((s) => ({ ...s, unit: uoms[0].label }));
  }, [uoms, form.unit]);

  function onPickItem(id: string) {
    setItemRef(id);
    const im = itemMaster?.find((x) => x.id === id);
    if (im) {
      setForm((s) => ({
        ...s,
        item: im.name,
        unit: im.uom,
        category: im.stock_type === "food" ? "Kitchen" : "General",
        est_cost: im.last_price,
      }));
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await create.mutateAsync({ ...form, linked_inventory_id: itemRef || null } as never);
    onClose();
  }

  return (
    <Modal title="New purchase request" onClose={onClose}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-medium">Item (from Item Master)
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={itemRef} onChange={(e) => onPickItem(e.target.value)}>
            <option value="">— custom item, not in Item Master —</option>
            {itemMaster?.filter((im) => im.active).map((im) => <option key={im.id} value={im.id}>{im.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Item name
          <input required placeholder="e.g. Coffee Beans" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.item} onChange={(e) => setForm((s) => ({ ...s, item: e.target.value }))} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-medium">Quantity
            <input type="number" required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.qty} onChange={(e) => setForm((s) => ({ ...s, qty: Number(e.target.value) }))} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Unit
            <select required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.unit} onChange={(e) => setForm((s) => ({ ...s, unit: e.target.value }))}>
              {form.unit && !uoms.some((u) => u.label === form.unit) && <option value={form.unit}>{form.unit}</option>}
              {uoms.map((u) => <option key={u.id} value={u.label}>{u.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Category
            <input required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.category} onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Urgency
            <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.urgency} onChange={(e) => setForm((s) => ({ ...s, urgency: e.target.value }))}>
              {["Low", "Medium", "High"].map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Estimated cost (KWD)
            <input type="number" step="0.01" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.est_cost} onChange={(e) => setForm((s) => ({ ...s, est_cost: Number(e.target.value) }))} />
          </label>
        </div>
        <Button type="submit" disabled={create.isPending}>{create.isPending ? "Submitting..." : "Submit Request"}</Button>
      </form>
    </Modal>
  );
}

function ConvertToPoModal({ pr, onClose }: { pr: PurchaseRequest; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: suppliers } = useList<Supplier>("suppliers", "/suppliers");
  const [form, setForm] = useState({ supplier_id: "", price: pr.est_cost / pr.qty || 0, expected_date: "" });

  const convert = useMutation({
    mutationFn: async () =>
      api.post(`/purchasing/purchase-requests/${pr.id}/convert-to-po`, {
        supplier_id: form.supplier_id, price: form.price, expected_date: form.expected_date || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-requests"] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      onClose();
    },
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.supplier_id) return;
    await convert.mutateAsync();
  }

  return (
    <Modal title={`Create purchase order — ${pr.item}`} onClose={onClose}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="text-[13px]" style={{ color: "var(--ink-500)" }}>{pr.qty} {pr.unit} · {pr.category}</div>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Supplier
          <select required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.supplier_id} onChange={(e) => setForm((s) => ({ ...s, supplier_id: e.target.value }))}>
            <option value="">— choose a supplier —</option>
            {suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Price per unit (KWD)
          <input type="number" step="0.001" required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.price} onChange={(e) => setForm((s) => ({ ...s, price: Number(e.target.value) }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Expected delivery date
          <input type="date" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.expected_date} onChange={(e) => setForm((s) => ({ ...s, expected_date: e.target.value }))} />
        </label>
        <div className="text-[12.5px]" style={{ color: "var(--ink-400)" }}>
          Order total: KWD {(form.price * pr.qty).toFixed(2)}{form.price * pr.qty > 500 ? " — over KWD 500, will require Owner approval" : ""}
        </div>
        <Button type="submit" disabled={convert.isPending}>{convert.isPending ? "Creating..." : "Create Purchase Order"}</Button>
      </form>
    </Modal>
  );
}

function OrdersTab() {
  const { data, isLoading } = useList<PurchaseOrder>("purchase-orders", "/purchasing/purchase-orders");
  const { data: suppliers } = useList<Supplier>("suppliers", "/suppliers");
  const qc = useQueryClient();
  const [detail, setDetail] = useState<PurchaseOrder | null>(null);
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);
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
                    <Button size="sm" variant="secondary" onClick={() => setReceiving(po)}>Receive</Button>
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
                <Button onClick={() => { setReceiving(detail); setDetail(null); }}>Receive Goods (GRN)</Button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {receiving && <ReceiveGoodsModal po={receiving} onClose={() => setReceiving(null)} />}
    </div>
  );
}

function ReceiveGoodsModal({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: suppliers } = useList<Supplier>("suppliers", "/suppliers");
  const supplierName = suppliers?.find((s) => s.id === po.supplier_id)?.name ?? "—";
  const pending = po.lines.filter((l) => l.received_qty < l.qty);
  const [qtys, setQtys] = useState<Record<string, number>>(
    Object.fromEntries(pending.map((l) => [l.id, l.qty - l.received_qty]))
  );
  // Defaults to each line's ordered price — leave untouched for "received
  // exactly as ordered", or adjust if the actual invoice came in different.
  const [prices, setPrices] = useState<Record<string, number>>(
    Object.fromEntries(pending.map((l) => [l.id, l.price]))
  );

  const receive = useMutation({
    mutationFn: async () =>
      api.post("/purchasing/grns", {
        po_id: po.id,
        lines: pending
          .filter((l) => (qtys[l.id] ?? 0) > 0)
          .map((l) => ({
            po_line_id: l.id,
            received_qty: Math.min(qtys[l.id] ?? 0, l.qty - l.received_qty),
            actual_price: prices[l.id] ?? l.price,
          })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["grns"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["food-inventory"] });
      qc.invalidateQueries({ queryKey: ["expenses"] });
      onClose();
    },
  });

  return (
    <Modal title={`Receive goods — ${po.code}`} onClose={onClose} wide>
      <div className="flex flex-col gap-3 text-[13px]">
        <div className="flex items-center gap-2">
          <Badge>{supplierName}</Badge>
          <span style={{ color: "var(--ink-500)" }}>
            Enter the quantity actually received for each line — partial receipts are supported. Adjust the price
            only if the actual invoice differs from what was ordered.
          </span>
        </div>
        <Table>
          <thead><tr><Th>Item</Th><Th>Ordered</Th><Th>Already received</Th><Th>Pending</Th><Th>Receiving now</Th><Th>Actual price</Th></tr></thead>
          <tbody>
            {pending.map((l) => {
              const pendingQty = l.qty - l.received_qty;
              const adjusted = (prices[l.id] ?? l.price) !== l.price;
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
                </tr>
              );
            })}
          </tbody>
        </Table>
        <Button onClick={() => receive.mutate()} disabled={receive.isPending}>
          {receive.isPending ? "Posting..." : "Post Goods Receipt"}
        </Button>
      </div>
    </Modal>
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

interface BasketLine { itemId: string; name: string; qty: number; unit: string; category: string; estCost: number }

function ShoppingBasketTab() {
  const { data: inventory, isLoading } = useList<InventoryItem>("inventory", "/inventory");
  const { data: itemMaster } = useList<ItemMasterEntry>("item-master", "/item-master");
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const create = useCreate<PurchaseRequest>("purchase-requests", "/purchasing/purchase-requests");
  const [submitting, setSubmitting] = useState(false);

  const lowStock = inventory?.filter((i) => i.stock < i.min) ?? [];

  function addToBasket(item: InventoryItem) {
    if (basket.some((b) => b.itemId === item.id)) return;
    const qty = Math.max(item.max - item.stock, 1);
    setBasket((b) => [...b, { itemId: item.id, name: item.name, qty, unit: item.unit, category: item.category, estCost: qty * item.last_price }]);
  }

  function removeFromBasket(itemId: string) {
    setBasket((b) => b.filter((x) => x.itemId !== itemId));
  }

  function updateQty(itemId: string, qty: number) {
    setBasket((b) => b.map((x) => (x.itemId === itemId ? { ...x, qty } : x)));
  }

  async function submitBasket() {
    setSubmitting(true);
    try {
      for (const line of basket) {
        const linkedId = itemMaster?.find((im) => im.stock_id === line.itemId)?.id ?? null;
        await create.mutateAsync({
          item: line.name, qty: line.qty, unit: line.unit, category: line.category,
          urgency: "Medium", est_cost: line.estCost, linked_inventory_id: linkedId,
        } as never);
      }
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
        {lowStock.length === 0 ? <EmptyState label="Nothing below minimum stock right now." /> : (
          <div className="flex flex-col gap-2">
            {lowStock.map((i) => (
              <Card key={i.id} className="flex items-center justify-between !p-3">
                <div>
                  <div className="text-[13px] font-semibold">{i.name}</div>
                  <div className="text-xs" style={{ color: "var(--ink-400)" }}>{i.stock} {i.unit} left · min {i.min}</div>
                </div>
                <Button variant="secondary" onClick={() => addToBasket(i)} disabled={basket.some((b) => b.itemId === i.id)}>
                  {basket.some((b) => b.itemId === i.id) ? "In basket" : "Add"}
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
                <div key={b.itemId} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1 text-[13px] font-medium">{b.name}</div>
                  <input
                    type="number"
                    className="w-20 rounded-lg border px-2 py-1 text-sm"
                    style={{ borderColor: "var(--border-strong)" }}
                    value={b.qty}
                    onChange={(e) => updateQty(b.itemId, Number(e.target.value))}
                  />
                  <span className="text-xs" style={{ color: "var(--ink-400)" }}>{b.unit}</span>
                  <Button size="sm" variant="danger" onClick={() => removeFromBasket(b.itemId)}>Remove</Button>
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
  if (isLoading) return <Spinner />;
  if (!data || data.length === 0) return <EmptyState label="No suppliers yet." />;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((s) => (
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
            <div className="flex justify-between"><span style={{ color: "var(--ink-500)" }}>Partner since</span><span className="font-semibold">{s.since ?? "—"}</span></div>
          </div>
        </Card>
      ))}
    </div>
  );
}
