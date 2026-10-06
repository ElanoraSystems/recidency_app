import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useCreate, useList, useUpdate } from "../api/hooks";
import { Icon } from "../components/icons";
import { HistoryPanel, StatusBadge, WorkflowBar, errorText } from "../components/Workflow";
import { Badge, Button, Card, DateRangeFilter, EmptyState, Modal, PageHeader, Spinner, StatTile, Table, Td, Th, statusTone } from "../components/ui";
import { addDays, fmtDate, todayIso } from "../lib/date";
import type { CostCenter, CreditNote, FoodInventoryItem, InventoryItem, ItemMasterEntry, PoLine, PrTemplate, PurchaseOrder, PurchaseRequest, PurchaseRequestLine, Supplier, TxnStatus, PriceHistoryEntry } from "../types";

interface GrnLine { id: string; name: string; ordered_qty: number; received_qty: number; unit: string; ordered_price: number; price: number; line_total: number; variance: number; expiry: string | null; batch_label: string | null }
interface Grn {
  id: string; code: string; status: TxnStatus; po_id: string; po_code: string | null; supplier_id: string; supplier_name: string | null
  date: string; receiving_cost_center_id: string; receiving_cost_center: string; notes: string | null; total: number
  variance_total: number; has_variance: boolean; variance_note: string | null; supplier_invoice_no: string | null
  received_by_name: string | null; lines: GrnLine[]
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px]" style={{ color: "var(--ink-400)" }}>{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

const TABS = ["Purchase Requests", "Templates", "Purchase Orders", "Goods Received", "Shopping Basket", "Spend", "Price Comparison", "Suppliers", "Credit Notes"] as const;

export function Purchasing() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t === params.get("tab")) ?? "Purchase Requests";
  const setTab = (t: (typeof TABS)[number]) => setParams({ tab: t }, { replace: true });
  const { data: requests } = useList<PurchaseRequest>("purchase-requests", "/purchasing/purchase-requests");
  const { data: orders } = useList<PurchaseOrder>("purchase-orders", "/purchasing/purchase-orders");
  const { data: suppliers } = useList<Supplier>("suppliers", "/suppliers");

  const pending = requests?.filter((r) => r.status === "Submitted").length ?? 0;
  const openOrders = orders?.filter((o) => o.status !== "Fully Received" && o.status !== "Closed" && o.status !== "Rejected").length ?? 0;
  const unpaidTotal = orders?.filter((o) => o.payment_status === "Unpaid").reduce((s, o) => s + o.total, 0) ?? 0;

  return (
    <div>
      <PageHeader title="Purchasing" subtitle="Item Master → Request → Approve → Order → Receive (GRN) → Main Inventory." />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Awaiting Approval" icon="purchasing" value={pending} progressColor="var(--status-warning)" />
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
      {tab === "Templates" && <TemplatesTab />}
      {tab === "Purchase Orders" && <OrdersTab />}
      {tab === "Goods Received" && <GoodsReceivedTab />}
      {tab === "Shopping Basket" && <ShoppingBasketTab />}
      {tab === "Spend" && <SpendTab />}
      {tab === "Price Comparison" && <PriceComparisonTab />}
      {tab === "Suppliers" && <SuppliersTab />}
      {tab === "Credit Notes" && <CreditNotesTab />}
    </div>
  );
}

// Saved item lists for purchase requests. Opening one starts a new request
// with its items and empty quantities; editing happens on that page.
function TemplatesTab() {
  const { data, isLoading } = useList<PrTemplate>("pr-templates", "/purchasing/pr-templates");
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/purchasing/pr-templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pr-templates"] }),
  });
  if (isLoading) return <Spinner />;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px]" style={{ color: "var(--ink-500)" }}>
          A template is a saved list of items. Open one to make a request: enter quantities only, and just the items with a quantity are requested.
          Change a template's items on that page and press "Update template".
        </p>
        <Link to="/purchasing/requests/new"><Button>+ New template</Button></Link>
      </div>
      {!data?.length ? (
        <EmptyState label="No templates yet. Start a new request, add your usual items, name it and press “Save as new template”." />
      ) : (
        <Table>
          <thead><tr><Th>Template</Th><Th>Items</Th><Th>{" "}</Th></tr></thead>
          <tbody>
            {data.map((t) => (
              <tr key={t.id}>
                <Td className="font-semibold">{t.name}</Td>
                <Td>
                  <span className="font-semibold">{t.lines.length}</span>
                  <span className="ml-2 text-[12px]" style={{ color: "var(--ink-400)" }}>
                    {t.lines.slice(0, 4).map((l) => l.item_name).join(", ")}{t.lines.length > 4 ? "…" : ""}
                  </span>
                </Td>
                <Td>
                  <div className="flex gap-3">
                    <Link to={`/purchasing/requests/new?template=${t.id}`} className="text-xs font-semibold" style={{ color: "var(--brass-600)" }}>Create request / edit</Link>
                    <button className="text-xs font-semibold" style={{ color: "var(--status-critical)" }}
                      onClick={() => window.confirm(`Delete the template "${t.name}"?`) && remove.mutate(t.id)}>Delete</button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

const PR_STATUS_FILTERS = ["Draft", "Submitted", "Approved", "Closed", "Rejected"] as const;

function RequestsTab() {
  const { data, isLoading } = useList<PurchaseRequest>("purchase-requests", "/purchasing/purchase-requests");
  const qc = useQueryClient();
  // Keep only the id so the open detail follows refetches (status changes).
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = data?.find((pr) => pr.id === detailId) ?? null;
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const decide = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) =>
      api.post(`/purchasing/purchase-requests/${id}/decision?approve=${approve}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-requests"] });
      qc.invalidateQueries({ queryKey: ["approvals"] });
    },
  });
  const filtered = data?.filter((pr) =>
    (!dateFrom || pr.request_date >= dateFrom) &&
    (!dateTo || pr.request_date <= dateTo) &&
    (!statusFilter || pr.status === statusFilter)
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border px-2.5 py-1.5 text-sm" style={{ borderColor: "var(--border-strong)" }}>
            <option value="">All statuses</option>
            {PR_STATUS_FILTERS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <Link to="/purchasing/requests/new"><Button>+ New Request</Button></Link>
      </div>

      {isLoading ? <Spinner /> : !filtered || filtered.length === 0 ? <EmptyState label="No purchase requests match these filters." /> : (
        <Table>
          <thead><tr><Th>PR #</Th><Th>Requested by</Th><Th>Date</Th><Th>Needed by</Th><Th>Total amount</Th><Th>Status</Th><Th>Action</Th></tr></thead>
          <tbody>
            {filtered.map((pr) => (
              <tr key={pr.id} className="cursor-pointer" onClick={() => setDetailId(pr.id)}>
                <Td className="font-medium">
                  {pr.code}
                  <div className="text-xs" style={{ color: "var(--ink-400)" }}>
                    {pr.lines.length} item(s){pr.po_codes.length > 0 && ` · ${pr.po_codes.join(", ")}`}
                  </div>
                </Td>
                <Td>{pr.requested_by_name ?? "—"}</Td>
                <Td>{fmtDate(pr.request_date)}</Td>
                <Td>{pr.required_delivery_date ? fmtDate(pr.required_delivery_date) : "—"}</Td>
                <Td>KWD {pr.total_est_cost.toFixed(2)}</Td>
                <Td><StatusBadge status={pr.status} /></Td>
                <Td onClick={(e) => e.stopPropagation()}>
                  {pr.status === "Draft" && (
                    <Link to={`/purchasing/requests/${pr.id}/edit`}><Button size="sm" variant="secondary">Edit</Button></Link>
                  )}
                  {pr.status === "Submitted" && (
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
        <Modal title={`${detail.code} — ${detail.lines.length} item(s)`} onClose={() => setDetailId(null)}>
          <div className="flex flex-col gap-3 text-[13px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={detail.status} />
                <Badge tone={statusTone(detail.urgency)}>{detail.urgency} urgency</Badge>
                <Badge>{detail.cost_center ?? "No cost center"}</Badge>
              </div>
              <div className="flex items-center gap-2">
                {detail.status === "Draft" && (
                  <Link to={`/purchasing/requests/${detail.id}/edit`}><Button variant="secondary">Edit</Button></Link>
                )}
                {detail.status === "Approved" && (
                  <Link to={`/purchasing/orders/new/${detail.id}`}><Button variant="secondary">Create PO</Button></Link>
                )}
              </div>
            </div>
            <WorkflowBar entityType="purchase_request" id={detail.id} status={detail.status} queryKeys={["purchase-requests"]} />
            <div className="grid grid-cols-2 gap-2">
              <InfoRow label="Requested by" value={detail.requested_by_name ?? "—"} />
              <InfoRow label="Approved by" value={detail.approved_by_name ?? "—"} />
              <InfoRow label="Request date" value={fmtDate(detail.request_date)} />
              <InfoRow label="Required delivery" value={detail.required_delivery_date ? fmtDate(detail.required_delivery_date) : "—"} />
              {detail.po_codes.length > 0 && <InfoRow label="Purchase orders" value={detail.po_codes.join(", ")} />}
              <InfoRow label="Total" value={`KWD ${detail.total_est_cost.toFixed(2)}`} />
            </div>
            <Table>
              <thead><tr><Th>Item</Th><Th>Qty</Th><Th>Unit price</Th><Th>Line cost</Th></tr></thead>
              <tbody>
                {detail.lines.map((l) => (
                  <tr key={l.id}>
                    <Td className="font-medium">
                      {l.item_name}
                      {l.description && <div className="text-[11.5px] font-normal" style={{ color: "var(--ink-500)" }}>{l.description}</div>}
                    </Td>
                    <Td>{l.qty} {l.unit}</Td>
                    <Td>KWD {l.est_unit_price.toFixed(3)}</Td>
                    <Td>KWD {l.est_cost.toFixed(2)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {detail.note && <p style={{ color: "var(--ink-500)" }}>{detail.note}</p>}
            <div>
              <div className="mb-1 text-[12px] font-semibold uppercase" style={{ color: "var(--ink-500)" }}>History</div>
              <HistoryPanel entityType="purchase_request" id={detail.id} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// A line is a catalog item plus a quantity and an optional description. The
// name, unit and price come from the Item Master and cannot be edited here.
interface RequestLine { key: string; itemRef: string; qty: number; description: string; legacyName?: string }
interface RequestForm { urgency: string; costCenter: string; note: string; deliveryDate: string; lines: RequestLine[] }

const newRequestLine = (): RequestLine => ({ key: crypto.randomUUID(), itemRef: "", qty: 1, description: "" });

const inDays = (n: number) => addDays(todayIso(), n);

// Creates a Draft pre-filled from stock shortcuts (basket, low-stock) and
// opens it in the editor, where the buyer confirms the delivery date.
export async function createDraftRequest(lines: { item_master_id: string; qty: number }[]): Promise<string> {
  const { data } = await api.post<PurchaseRequest>("/purchasing/purchase-requests", {
    urgency: "Medium", note: null, cost_center: "Main Store", required_delivery_date: inDays(7), submit: false, lines,
  });
  return data.id;
}

export function NewPurchaseRequestPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: itemMaster } = useList<ItemMasterEntry>("item-master", "/item-master");
  const { data: costCentersRaw } = useList<CostCenter>("cost-centers", "/kitchen/cost-centers");
  const costCenters = [...(costCentersRaw ?? [])].sort((a, b) => a.label.localeCompare(b.label));
  const { data: doc, isLoading } = useQuery<PurchaseRequest>({
    queryKey: ["purchase-request", id],
    queryFn: async () => (await api.get(`/purchasing/purchase-requests/${id}`)).data,
    enabled: !!id,
  });
  const { data: templates } = useList<PrTemplate>("pr-templates", "/purchasing/pr-templates");
  const [searchParams] = useSearchParams();
  const [templateId, setTemplateId] = useState("");
  const [tplName, setTplName] = useState("");
  const [edits, setEdits] = useState<Partial<RequestForm> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const baseline: RequestForm = doc
    ? {
        urgency: doc.urgency, costCenter: doc.cost_center ?? "", note: doc.note ?? "", deliveryDate: doc.required_delivery_date ?? "",
        lines: doc.lines.map((l) => ({
          key: l.id, itemRef: l.item_master_id ?? "", qty: l.qty, description: l.description ?? "",
          legacyName: l.item_master_id ? undefined : l.item_name,
        })),
      }
    : { urgency: "Medium", costCenter: "", note: "", deliveryDate: "", lines: [newRequestLine()] };
  const form: RequestForm = { ...baseline, ...(edits ?? {}) };
  const patch = (p: Partial<RequestForm>) => setEdits((e) => ({ ...(e ?? {}), ...p }));
  const updateLine = (key: string, p: Partial<RequestLine>) =>
    patch({ lines: form.lines.map((l) => (l.key === key ? { ...l, ...p } : l)) });
  const addLine = () => patch({ lines: [...form.lines, newRequestLine()] });
  const removeLine = (key: string) => patch({ lines: form.lines.filter((l) => l.key !== key) });
  const editable = isNew || doc?.status === "Draft";

  // Indicative price: the item's last purchase price (average cost if it has
  // never been bought). Read-only; the supplier price is set on the PO.
  const master = (l: RequestLine) => itemMaster?.find((im) => im.id === l.itemRef);
  const priceOf = (l: RequestLine) => {
    const im = master(l);
    return im ? (im.last_price > 0 ? im.last_price : im.avg_price) : 0;
  };
  const total = form.lines.reduce((s, l) => s + l.qty * priceOf(l), 0);
  const requested = form.lines.filter((l) => l.qty > 0).length;

  // Enter adds the next item instead of submitting; only the buttons submit.
  function onKeyDown(e: React.KeyboardEvent<HTMLFormElement>) {
    const el = e.target as HTMLElement;
    if (e.key !== "Enter" || el.tagName === "BUTTON" || el.tagName === "TEXTAREA") return;
    e.preventDefault();
    if (editable && !templateId && el.closest("tbody")) addLine();
  }

  // A template is just a saved item list. Loading one lists every item with an
  // empty quantity; only the lines given a quantity become the request.
  function loadTemplate(tid: string) {
    setTemplateId(tid);
    const t = templates?.find((x) => x.id === tid);
    if (!t) return setTplName("");
    setTplName(t.name);
    patch({ lines: t.lines.map((l) => ({ key: crypto.randomUUID(), itemRef: l.item_master_id, qty: 0, description: l.description ?? "" })) });
  }

  // Arriving from the Templates tab (?template=id) opens that template once.
  const wanted = isNew ? searchParams.get("template") : null;
  useEffect(() => {
    if (wanted && !templateId && templates?.some((t) => t.id === wanted)) loadTemplate(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, templates]);

  async function saveTemplate(asNew: boolean) {
    setError(null);
    const lines = form.lines.filter((l) => l.itemRef).map((l) => ({ item_master_id: l.itemRef, description: l.description || null }));
    if (!tplName.trim()) return setError("Give the template a name.");
    if (!lines.length) return setError("Add at least one item to save as a template.");
    try {
      const body = { name: tplName.trim(), lines };
      const { data } = templateId && !asNew
        ? await api.put<PrTemplate>(`/purchasing/pr-templates/${templateId}`, body)
        : await api.post<PrTemplate>("/purchasing/pr-templates", body);
      qc.invalidateQueries({ queryKey: ["pr-templates"] });
      setTemplateId(data.id);
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function deleteTemplate() {
    if (!templateId || !window.confirm(`Delete the template "${tplName}"?`)) return;
    try {
      await api.delete(`/purchasing/pr-templates/${templateId}`);
      qc.invalidateQueries({ queryKey: ["pr-templates"] });
      setTemplateId("");
      setTplName("");
      navigate("/purchasing/requests/new", { replace: true });
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function save(submit: boolean) {
    setError(null);
    if (!form.deliveryDate) return setError("Choose the required delivery date.");
    if (!form.costCenter) return setError("Choose a cost center.");
    const lines = form.lines.filter((l) => l.qty > 0); // lines left without a quantity are not requested
    if (!lines.length) return setError("Enter a quantity for at least one item.");
    if (lines.some((l) => !l.itemRef)) return setError("Every line with a quantity needs an item from the Item Master.");
    const payload = {
      urgency: form.urgency, note: form.note || null, cost_center: form.costCenter, required_delivery_date: form.deliveryDate, submit,
      lines: lines.map((l) => ({ item_master_id: l.itemRef, qty: l.qty, description: l.description || null })),
    };
    setBusy(true);
    try {
      if (isNew) await api.post("/purchasing/purchase-requests", payload);
      else await api.put(`/purchasing/purchase-requests/${id}`, payload);
      for (const k of ["purchase-requests", "purchase-request", "approvals"]) qc.invalidateQueries({ queryKey: [k] });
      navigate("/purchasing");
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  if (!isNew && isLoading) return <Spinner />;
  if (!isNew && !doc) return <EmptyState label="Purchase request not found." />;
  const border = { borderColor: "var(--border-strong)" };

  return (
    <div>
      <Link to="/purchasing" className="mb-3 inline-block text-[13px] font-semibold" style={{ color: "var(--brass-600)" }}>← Back to Purchasing</Link>
      <PageHeader
        title={isNew ? "New purchase request" : `${doc?.code} — edit`}
        subtitle="Choose each item from the Item Master, add a quantity and any details. Prices are indicative (last purchase price); the supplier price is set on the purchase order. Press Enter in a line to add the next item. Or start from a saved template: enter quantities only, and just the items with a quantity are requested."
      />
      {!editable && <p className="mb-3 text-[13px]" style={{ color: "var(--status-critical)" }}>This request is {doc?.status} and can no longer be edited.</p>}
      <form onSubmit={(e) => e.preventDefault()} onKeyDown={onKeyDown} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3" style={{ borderColor: "var(--border-strong)", background: "var(--surface)" }}>
          <span className="text-[12px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>Estimated PR value</span>
          <span className="text-xl font-bold">KWD {total.toFixed(2)}</span>
        </div>
        <fieldset disabled={!editable} className="flex min-w-0 flex-col gap-4">
          <div className="grid max-w-3xl grid-cols-2 gap-3 rounded-xl border p-3 sm:grid-cols-4" style={border}>
            <label className="flex flex-col gap-1 text-[13px] font-medium">Required delivery date *
              <input type="date" required min={todayIso()} className="rounded-lg border px-3 py-2 text-sm" style={border}
                value={form.deliveryDate} onChange={(e) => patch({ deliveryDate: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium">Cost center *
              <select required className="rounded-lg border px-3 py-2 text-sm" style={border}
                value={form.costCenter} onChange={(e) => patch({ costCenter: e.target.value })}>
                <option value="">— Select —</option>
                {costCenters.map((c) => <option key={c.id} value={c.label}>{c.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium">Urgency
              <select className="rounded-lg border px-3 py-2 text-sm" style={border}
                value={form.urgency} onChange={(e) => patch({ urgency: e.target.value })}>
                {["Low", "Medium", "High"].map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium">Note (optional)
              <input className="rounded-lg border px-3 py-2 text-sm" style={border} value={form.note} onChange={(e) => patch({ note: e.target.value })} />
            </label>
          </div>

          <div className="flex max-w-3xl flex-wrap items-end gap-3 rounded-xl border p-3" style={border}>
            <label className="flex flex-col gap-1 text-[13px] font-medium">Template
              <select className="rounded-lg border px-3 py-2 text-sm" style={border} value={templateId}
                onChange={(e) => loadTemplate(e.target.value)}>
                <option value="">— No template —</option>
                {templates?.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.lines.length} items)</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium">Template name
              <input className="rounded-lg border px-3 py-2 text-sm" style={border} maxLength={100} placeholder="e.g. Weekly kitchen order"
                value={tplName} onChange={(e) => setTplName(e.target.value)} />
            </label>
            {templateId && <Button type="button" variant="secondary" onClick={() => saveTemplate(false)}>Update template</Button>}
            <Button type="button" variant="secondary" onClick={() => saveTemplate(true)}>Save as new template</Button>
            {templateId && (
              <button type="button" className="pb-2 text-xs font-semibold" style={{ color: "var(--status-critical)" }} onClick={deleteTemplate}>Delete template</button>
            )}
          </div>

          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr><Th>Item (Item Master)</Th><Th>Description</Th><Th>Qty</Th><Th>Unit</Th><Th>Indicative price (KWD)</Th><Th>Line cost (KWD)</Th><Th>{" "}</Th></tr>
              </thead>
              <tbody>
                {form.lines.map((line) => (
                  <tr key={line.key}>
                    <Td>
                      <select required className="w-48 rounded-lg border px-2 py-1.5 text-sm" style={border}
                        value={line.itemRef} onChange={(e) => updateLine(line.key, { itemRef: e.target.value, legacyName: undefined })}>
                        <option value="">{line.legacyName ? `Choose an item (was: ${line.legacyName})` : "— Select an item —"}</option>
                        {itemMaster?.filter((im) => im.active).map((im) => <option key={im.id} value={im.id}>{im.name}</option>)}
                      </select>
                    </Td>
                    <Td>
                      <input maxLength={300} placeholder="Brand, size, specification…" className="w-56 rounded-lg border px-2 py-1.5 text-sm" style={border}
                        value={line.description} onChange={(e) => updateLine(line.key, { description: e.target.value })} />
                    </Td>
                    <Td>
                      <input type="number" min={0} step="any" className="w-20 rounded-lg border px-2 py-1.5 text-sm" style={border}
                        placeholder="Qty" value={line.qty || ""} onChange={(e) => updateLine(line.key, { qty: Number(e.target.value) })} />
                    </Td>
                    <Td>{master(line)?.uom ?? "—"}</Td>
                    <Td style={{ color: "var(--ink-500)" }}>{master(line) ? priceOf(line).toFixed(3) : "—"}</Td>
                    <Td className="font-semibold">{(line.qty * priceOf(line)).toFixed(2)}</Td>
                    <Td>
                      {form.lines.length > 1 && (
                        <button type="button" className="text-xs font-semibold" style={{ color: "var(--status-critical)" }} onClick={() => removeLine(line.key)}>
                          Remove
                        </button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <div>
            <Button type="button" variant="secondary" onClick={addLine}>+ Add another item</Button>
          </div>
        </fieldset>

        {error && <p className="text-[13px]" style={{ color: "var(--status-critical)" }}>{error}</p>}
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => save(false)}>Save draft</Button>
            <Button type="button" disabled={busy} onClick={() => save(true)}>
              {busy ? "Working..." : `Submit request (${requested} item${requested === 1 ? "" : "s"})`}
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}

const UNASSIGNED = "unassigned";

// "Last 3 purchases" comparison under a PO line: supplier, date and unit
// price, with the cheapest marked and the difference against today's price.
function PriceHistory({ entries, current }: { entries: PriceHistoryEntry[]; current: number }) {
  if (entries.length === 0) {
    return <div className="text-[11.5px] font-normal" style={{ color: "var(--ink-400)" }}>No previous purchases</div>;
  }
  const lowest = Math.min(...entries.map((e) => e.unit_price));
  return (
    <div className="mt-1 flex flex-col gap-0.5 text-[11.5px] font-normal" style={{ color: "var(--ink-500)" }}>
      <div className="font-semibold uppercase tracking-wide" style={{ color: "var(--ink-400)" }}>Last {entries.length} purchase{entries.length > 1 ? "s" : ""}</div>
      {entries.map((e, i) => {
        const diff = current - e.unit_price;
        return (
          <div key={`${e.po_code}-${i}`}>
            {e.supplier_name} · {fmtDate(e.date)} · <b>KWD {e.unit_price.toFixed(3)}</b>
            {e.unit_price === lowest && entries.length > 1 && <span style={{ color: "var(--status-good)" }}> · lowest</span>}
            {Math.abs(diff) > 0.0005 && (
              <span style={{ color: diff > 0 ? "var(--status-critical)" : "var(--status-good)" }}> ({diff > 0 ? "+" : ""}{diff.toFixed(3)} now)</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function NewPurchaseOrderPage() {
  const { prId } = useParams<{ prId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: requests, isLoading } = useList<PurchaseRequest>("purchase-requests", "/purchasing/purchase-requests");
  const { data: suppliers } = useList<Supplier>("suppliers", "/suppliers");
  const { data: itemMaster } = useList<ItemMasterEntry>("item-master", "/item-master");
  const pr = requests?.find((r) => r.id === prId);

  // Every line starts with its item's preferred supplier (none for custom
  // items) and can be changed per line. Lines are then grouped by chosen
  // supplier: one purchase order per supplier, each linked back to this PR.
  const [lineSupplier, setLineSupplier] = useState<Record<string, string>>({});
  const [expectedDates, setExpectedDates] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<Record<string, number>>({});
  const supplierOf = (l: PurchaseRequestLine): string =>
    lineSupplier[l.id] ?? (l.item_master_id ? itemMaster?.find((x) => x.id === l.item_master_id)?.preferred_supplier_id : null) ?? "";
  const supplierLabel = (id: string) => suppliers?.find((s) => s.id === id)?.name ?? "—";
  const groups = (() => {
    const byKey = new Map<string, PurchaseRequestLine[]>();
    for (const line of pr?.lines ?? []) {
      const key = supplierOf(line) || UNASSIGNED;
      byKey.set(key, [...(byKey.get(key) ?? []), line]);
    }
    return [...byKey.entries()]
      .map(([key, lines]) => ({ key, supplierId: key === UNASSIGNED ? "" : key, lines }))
      .sort((x, y) => (x.supplierId ? supplierLabel(x.supplierId) : "\uffff").localeCompare(y.supplierId ? supplierLabel(y.supplierId) : "\uffff"));
  })();
  const unassigned = groups.some((g) => !g.supplierId);

  // Last three purchases per catalog item (preferring different suppliers).
  const itemIds = [...new Set((pr?.lines ?? []).map((l) => l.item_master_id).filter((x): x is string => !!x))];
  const { data: history } = useQuery<Record<string, PriceHistoryEntry[]>>({
    queryKey: ["price-history", itemIds],
    queryFn: async () => (await api.get("/purchasing/price-history", { params: { item_ids: itemIds }, paramsSerializer: { indexes: null } })).data,
    enabled: itemIds.length > 0,
  });
  const historyOf = (l: PurchaseRequestLine) => (l.item_master_id ? history?.[l.item_master_id] ?? [] : []);
  // Until edited, a line's price is the most recent purchase price, falling
  // back to the request's own estimate.
  const priceOf = (l: PurchaseRequestLine) => prices[l.id] ?? historyOf(l)[0]?.unit_price ?? l.est_unit_price;

  const convert = useMutation({
    mutationFn: async () =>
      api.post(`/purchasing/purchase-requests/${prId}/convert-to-po`, {
        groups: groups.map((g) => ({
          supplier_id: g.supplierId,
          expected_date: expectedDates[g.key] || null,
          lines: g.lines.map((l) => ({ pr_line_id: l.id, price: priceOf(l) })),
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
    if (unassigned) return;
    await convert.mutateAsync();
  }

  if (isLoading) return <Spinner />;
  if (!pr) return <EmptyState label="Purchase request not found." />;

  const grandTotal = groups.reduce(
    (s, g) => s + g.lines.reduce((gs, l) => gs + priceOf(l) * l.qty, 0), 0,
  );

  return (
    <div>
      <Link to="/purchasing" className="mb-3 inline-block text-[13px] font-semibold" style={{ color: "var(--brass-600)" }}>← Back to Purchasing</Link>
      <PageHeader
        title={`Create purchase order${groups.length > 1 ? "s" : ""} — ${pr.lines.length} item(s)`}
        subtitle={groups.length > 1 ? `Split into ${groups.length} orders by supplier.` : undefined}
      />
      <form onSubmit={onSubmit} className="flex flex-col gap-4 max-w-3xl">
        <p className="text-[13px]" style={{ color: "var(--ink-500)" }}>
          {pr.code}: {pr.lines.length} item{pr.lines.length > 1 ? "s" : ""} → {groups.length} purchase order{groups.length > 1 ? "s" : ""}, one per supplier.
          Change a line's supplier and it moves to that supplier's order. Every order stays linked to {pr.code}.
        </p>
        {groups.map((g) => {
          const groupTotal = g.lines.reduce((s, l) => s + priceOf(l) * l.qty, 0);
          return (
            <div key={g.key} className="flex flex-col gap-3 rounded-xl border p-3" style={{ borderColor: g.supplierId ? "var(--border-strong)" : "var(--status-warning)" }}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-[14px] font-semibold">
                  {g.supplierId ? supplierLabel(g.supplierId) : "No supplier yet — choose one for each line"}
                  <span className="ml-2 text-[12px] font-normal" style={{ color: "var(--ink-400)" }}>{g.lines.length} item(s)</span>
                </div>
                {g.supplierId && (
                  <label className="flex items-center gap-2 text-[12.5px] font-medium">Expected delivery
                    <input type="date" className="rounded-lg border px-2 py-1 text-sm" style={{ borderColor: "var(--border-strong)" }}
                      value={expectedDates[g.key] ?? ""} onChange={(e) => setExpectedDates((s) => ({ ...s, [g.key]: e.target.value }))} />
                  </label>
                )}
              </div>
              <Table>
                <thead><tr><Th>Item</Th><Th>Qty</Th><Th>Supplier</Th><Th>Price/unit (KWD)</Th><Th>Line total</Th></tr></thead>
                <tbody>
                  {g.lines.map((l) => (
                    <tr key={l.id}>
                      <Td className="font-medium">
                        {l.item_name}
                        {l.description && <div className="text-[11.5px] font-normal" style={{ color: "var(--ink-500)" }}>{l.description}</div>}
                        <PriceHistory entries={historyOf(l)} current={priceOf(l)} />
                      </Td>
                      <Td>{l.qty} {l.unit}</Td>
                      <Td>
                        <select required className="w-40 rounded-lg border px-2 py-1 text-sm" style={{ borderColor: "var(--border-strong)" }}
                          value={supplierOf(l)} onChange={(e) => setLineSupplier((s) => ({ ...s, [l.id]: e.target.value }))}>
                          <option value="">— choose —</option>
                          {suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </Td>
                      <Td>
                        <input type="number" step="0.001" required
                          className="w-24 rounded-lg border px-2 py-1 text-right text-sm"
                          style={{ borderColor: "var(--border-strong)" }}
                          value={priceOf(l)}
                          onChange={(e) => setPrices((s) => ({ ...s, [l.id]: Number(e.target.value) }))}
                        />
                      </Td>
                      <Td>KWD {(priceOf(l) * l.qty).toFixed(2)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="text-[12.5px]" style={{ color: "var(--ink-400)" }}>
                Order total: KWD {groupTotal.toFixed(2)} — goes for approval once created
              </div>
            </div>
          );
        })}
        <div className="text-[13px] font-semibold">Grand total across {groups.length} order{groups.length > 1 ? "s" : ""}: KWD {grandTotal.toFixed(2)}</div>
        <Button type="submit" disabled={convert.isPending || unassigned}>
          {convert.isPending ? "Creating..." : `Create ${groups.length} Purchase Order${groups.length > 1 ? "s" : ""}`}
        </Button>
      </form>
    </div>
  );
}

function OrdersTab() {
  const { data, isLoading } = useList<PurchaseOrder>("purchase-orders", "/purchasing/purchase-orders");
  const { data: suppliers } = useList<Supplier>("suppliers", "/suppliers");
  const { data: grns } = useList<Grn>("grns", "/purchasing/grns");
  const qc = useQueryClient();
  // Keep only the id so the open detail follows refetches (status changes).
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = data?.find((po) => po.id === detailId) ?? null;
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const decide = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) =>
      api.post(`/purchasing/purchase-orders/${id}/decision?approve=${approve}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["approvals"] });
    },
  });

  const supplierName = (id: string) => suppliers?.find((s) => s.id === id)?.name ?? "—";
  const statusOptions = [...new Set((data ?? []).map((po) => po.status))].sort();
  const filtered = data?.filter((po) =>
    (!dateFrom || po.order_date >= dateFrom) &&
    (!dateTo || po.order_date <= dateTo) &&
    (!statusFilter || po.status === statusFilter) &&
    (!supplierFilter || po.supplier_id === supplierFilter)
  );

  async function downloadPoPdf(po: PurchaseOrder) {
    // A plain <a href> won't carry the Bearer token — fetch as an
    // authenticated blob and open that instead (same pattern as Documents).
    const res = await api.get(`/purchasing/purchase-orders/${po.id}/pdf`, { responseType: "blob" });
    const blobUrl = URL.createObjectURL(res.data as Blob);
    window.open(blobUrl, "_blank");
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }

  if (isLoading) return <Spinner />;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border px-2.5 py-1.5 text-sm" style={{ borderColor: "var(--border-strong)" }}>
          <option value="">All statuses</option>
          {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}
          className="rounded-lg border px-2.5 py-1.5 text-sm" style={{ borderColor: "var(--border-strong)" }}>
          <option value="">All suppliers</option>
          {suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {!filtered || filtered.length === 0 ? <EmptyState label="No purchase orders match these filters." /> : (
      <Table>
        <thead><tr><Th>PO</Th><Th>Supplier</Th><Th>Cost center</Th><Th>Items</Th><Th>Ordered</Th><Th>Expected</Th><Th>Total</Th><Th>Status</Th><Th>Payment</Th><Th>{" "}</Th></tr></thead>
        <tbody>
          {filtered.map((po) => {
            const recv = po.lines.reduce((s, l) => s + l.received_qty, 0);
            const ord = po.lines.reduce((s, l) => s + l.qty, 0);
            return (
              <tr key={po.id} className="cursor-pointer" onClick={() => setDetailId(po.id)}>
                <Td className="font-medium">{po.code}</Td>
                <Td>{supplierName(po.supplier_id)}</Td>
                <Td>{po.cost_center ?? "—"}</Td>
                <Td className="text-xs" style={{ color: "var(--ink-500)" }}>{po.lines.length} item(s) · {recv}/{ord} recv.</Td>
                <Td>{fmtDate(po.order_date)}</Td>
                <Td>{po.expected_date ? fmtDate(po.expected_date) : "—"}</Td>
                <Td>KWD {po.total.toFixed(2)}</Td>
                <Td><StatusBadge status={po.status} /></Td>
                <Td><Badge tone={statusTone(po.payment_status)}>{po.payment_status}</Badge></Td>
                <Td onClick={(e) => e.stopPropagation()}>
                  {po.status === "Submitted" && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => decide.mutate({ id: po.id, approve: true })}>Approve</Button>
                      <Button size="sm" variant="danger" onClick={() => decide.mutate({ id: po.id, approve: false })}>Reject</Button>
                    </div>
                  )}
                  {(po.status === "Approved" || po.status === "Partially Received") && (
                    <Link to={`/purchasing/grn/${po.id}`}><Button size="sm" variant="secondary">Receive</Button></Link>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      )}

      {detail && (
        <Modal title={detail.code} onClose={() => setDetailId(null)}>
          <div className="flex flex-col gap-3 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{supplierName(detail.supplier_id)}</Badge>
              <StatusBadge status={detail.status} />
              <Badge tone={statusTone(detail.payment_status)}>{detail.payment_status}</Badge>
            </div>
            <WorkflowBar
              entityType="purchase_order" id={detail.id} status={detail.status} queryKeys={["purchase-orders"]}
              closeFrom="Fully Received" shortCloseFrom={["Approved", "Partially Received"]} canReopen={false}
            />
            <Table>
              <thead><tr><Th>Item</Th><Th>Ordered</Th><Th>Received</Th><Th>Remaining</Th><Th>Receipt status</Th><Th>Price</Th></tr></thead>
              <tbody>
                {detail.lines.map((l) => {
                  const remaining = l.qty - l.received_qty;
                  const receipt = l.received_qty <= 0 ? "Not Received" : remaining > 0.0005 ? "Partially Received" : "Fully Received";
                  return (
                    <tr key={l.id}>
                      <Td className="font-medium">
                        {l.name}
                        {l.description && <div className="text-[11.5px] font-normal" style={{ color: "var(--ink-500)" }}>{l.description}</div>}
                      </Td>
                      <Td>{l.qty} {l.unit}</Td>
                      <Td>{l.received_qty} {l.unit}</Td>
                      <Td>{Math.max(0, remaining)} {l.unit}</Td>
                      <Td><StatusBadge status={receipt} /></Td>
                      <Td>KWD {l.price.toFixed(3)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            {(() => {
              const mine = (grns ?? []).filter((g) => g.po_id === detail.id);
              return mine.length === 0 ? null : (
                <div>
                  <div className="mb-1 text-[12px] font-semibold uppercase" style={{ color: "var(--ink-500)" }}>Goods receipts</div>
                  {mine.map((g) => (
                    <div key={g.id} className="flex items-center justify-between py-0.5">
                      <span>{g.code} · {fmtDate(g.date)} · {g.receiving_cost_center}</span>
                      <StatusBadge status={g.status} />
                    </div>
                  ))}
                </div>
              );
            })()}
            <div className="grid grid-cols-2 gap-2">
              <InfoRow label="Order date" value={fmtDate(detail.order_date)} />
              <InfoRow label="Expected" value={detail.expected_date ? fmtDate(detail.expected_date) : "—"} />
              <InfoRow label="Total" value={`KWD ${detail.total.toFixed(2)}`} />
              <InfoRow label="Source request" value={detail.source_pr_code ?? "Direct order"} />
              <InfoRow label="Cost center" value={detail.cost_center ?? "—"} />
              {detail.received_value > 0 && <InfoRow label="Invoiced so far" value={`KWD ${detail.received_value.toFixed(2)}`} />}
              {Math.abs(detail.price_variance) > 0.004 && (
                <InfoRow label="Price variance vs order" value={`${detail.price_variance > 0 ? "+" : ""}KWD ${detail.price_variance.toFixed(2)}`} />
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => downloadPoPdf(detail)}>Download PDF</Button>
              {(detail.status === "Approved" || detail.status === "Partially Received") && (
                <Link to={`/purchasing/grn/${detail.id}`}><Button>Receive Goods (GRN)</Button></Link>
              )}
            </div>
            <div>
              <div className="mb-1 text-[12px] font-semibold uppercase" style={{ color: "var(--ink-500)" }}>History</div>
              <HistoryPanel entityType="purchase_order" id={detail.id} />
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
  // Stock is registered at the receiving cost center — mandatory, no default.
  const { data: costCenters } = useList<CostCenter>("cost-centers", "/kitchen/cost-centers");
  const [chosenCostCenter, setChosenCostCenter] = useState("");
  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [varianceNote, setVarianceNote] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");

  useEffect(() => {
    if (!po || Object.keys(qtys).length > 0) return;
    setQtys(Object.fromEntries(pending.map((l) => [l.id, l.qty - l.received_qty])));
    setPrices(Object.fromEntries(pending.map((l) => [l.id, l.price])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [po]);

  function isFoodLine(l: PoLine): boolean {
    return itemMaster?.find((im) => im.id === l.item_master_id)?.stock_type === "food";
  }

  // Defaults to the cost center the order was raised for; goods can still be
  // received into a different one.
  const costCenterId = chosenCostCenter || po?.cost_center_id || "";
  const receivingLines = pending.filter((l) => (qtys[l.id] ?? 0) > 0);
  const hasVariance = receivingLines.some((l) => Math.abs((prices[l.id] ?? l.price) - l.price) > 0.0005);
  const varianceValue = receivingLines.reduce((sum, l) => sum + (qtys[l.id] ?? 0) * ((prices[l.id] ?? l.price) - l.price), 0);

  const receive = useMutation({
    mutationFn: async (submit: boolean) =>
      api.post("/purchasing/grns", {
        po_id: poId,
        receiving_cost_center_id: costCenterId,
        date,
        notes: notes || null,
        variance_note: hasVariance ? varianceNote : null,
        supplier_invoice_no: invoiceNo || null,
        submit,
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
      qc.invalidateQueries({ queryKey: ["stock-balances"] });
      qc.invalidateQueries({ queryKey: ["stock-movements"] });
      navigate("/purchasing?tab=Goods%20Received");
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
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 font-medium">
            Receiving cost center *
            <select
              required value={costCenterId} onChange={(e) => setChosenCostCenter(e.target.value)}
              className="rounded-lg border px-2.5 py-1.5 text-sm" style={{ borderColor: "var(--border-strong)" }}
            >
              <option value="">Select where stock is received…</option>
              {costCenters?.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 font-medium">
            Receipt date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border px-2.5 py-1.5 text-sm" style={{ borderColor: "var(--border-strong)" }} />
          </label>
          <label className="flex flex-col gap-1 font-medium">
            Supplier invoice no.
            <input type="text" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="Optional" maxLength={60}
              className="w-40 rounded-lg border px-2.5 py-1.5 text-sm" style={{ borderColor: "var(--border-strong)" }} />
          </label>
          <label className="flex min-w-[200px] flex-1 flex-col gap-1 font-medium">
            Notes
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional"
              className="rounded-lg border px-2.5 py-1.5 text-sm" style={{ borderColor: "var(--border-strong)" }} />
          </label>
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
        {hasVariance && (
          <div className="flex flex-col gap-1.5 rounded-xl border p-3" style={{ borderColor: "var(--status-warning)" }}>
            <div className="font-semibold">
              Price differs from the order: {varianceValue >= 0 ? "+" : ""}KWD {varianceValue.toFixed(2)} in total
            </div>
            <label className="flex flex-col gap-1 font-medium">Reason for the price difference *
              <input
                type="text" value={varianceNote} onChange={(e) => setVarianceNote(e.target.value)}
                placeholder="e.g. supplier raised the price, invoice attached"
                className="rounded-lg border px-2.5 py-1.5 text-sm" style={{ borderColor: "var(--border-strong)" }}
              />
            </label>
            <span className="text-[12px]" style={{ color: "var(--ink-500)" }}>
              The receipt is then sent to an approver. The purchase order itself keeps the ordered prices.
            </span>
          </div>
        )}
        {receive.isError && <p style={{ color: "var(--status-critical)" }}>{errorText(receive.error)}</p>}
        <div className="flex gap-2">
          <Button onClick={() => receive.mutate(true)} disabled={receive.isPending || !costCenterId || (hasVariance && !varianceNote.trim())}>
            {receive.isPending ? "Posting..." : "Receive & Submit"}
          </Button>
          <Button variant="secondary" onClick={() => receive.mutate(false)} disabled={receive.isPending || !costCenterId}>
            Save draft
          </Button>
        </div>
      </div>
    </div>
  );
}

function GoodsReceivedTab() {
  const { data: grns, isLoading } = useList<Grn>("grns", "/purchasing/grns");
  const { data: suppliers } = useList<Supplier>("suppliers", "/suppliers");
  const { data: orders } = useList<PurchaseOrder>("purchase-orders", "/purchasing/purchase-orders");
  // Keep only the id so the open detail follows the refetched GRN (status changes).
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = grns?.find((g) => g.id === detailId) ?? null;
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [varianceOnly, setVarianceOnly] = useState(false);
  const [search, setSearch] = useState("");
  const supplierName = (id: string) => suppliers?.find((s) => s.id === id)?.name ?? "—";
  const poCode = (id: string) => orders?.find((o) => o.id === id)?.code ?? id.slice(0, 8);
  const filtered = grns?.filter((g) =>
    (!dateFrom || g.date >= dateFrom) &&
    (!dateTo || g.date <= dateTo) &&
    (!supplierFilter || g.supplier_id === supplierFilter) &&
    (!varianceOnly || g.has_variance) &&
    (!search.trim() || [g.code, g.supplier_invoice_no, g.po_code].some((v) => v?.toLowerCase().includes(search.trim().toLowerCase())))
  );
  // Receipts value by the cost center that received them (drafts excluded).
  const spendByCostCenter = new Map<string, number>();
  for (const g of filtered ?? []) {
    if (g.status !== "Draft") spendByCostCenter.set(g.receiving_cost_center, (spendByCostCenter.get(g.receiving_cost_center) ?? 0) + g.total);
  }

  if (isLoading) return <Spinner />;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} />
        <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}
          className="rounded-lg border px-2.5 py-1.5 text-sm" style={{ borderColor: "var(--border-strong)" }}>
          <option value="">All suppliers</option>
          {suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input
          className="rounded-lg border px-2.5 py-1.5 text-sm" style={{ borderColor: "var(--border-strong)" }}
          placeholder="Search GRN, PO or invoice no…" value={search} onChange={(e) => setSearch(e.target.value)}
        />
        <label className="flex items-center gap-1.5 text-[13px]">
          <input type="checkbox" checked={varianceOnly} onChange={(e) => setVarianceOnly(e.target.checked)} />
          Price variance only
        </label>
      </div>
      {spendByCostCenter.size > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {[...spendByCostCenter.entries()].sort().map(([cc, total]) => (
            <Badge key={cc}>{cc}: KWD {total.toFixed(2)}</Badge>
          ))}
        </div>
      )}

      {!filtered || filtered.length === 0 ? <EmptyState label="No goods received match these filters." /> : (
      <Table>
        <thead><tr><Th>GRN</Th><Th>Date</Th><Th>PO</Th><Th>Supplier</Th><Th>Invoice no.</Th><Th>Cost center</Th><Th>Lines</Th><Th>Value</Th><Th>Price variance</Th><Th>Status</Th></tr></thead>
        <tbody>
          {filtered.map((g) => (
            <tr key={g.id} className="cursor-pointer" onClick={() => setDetailId(g.id)}>
              <Td className="font-medium">{g.code}</Td>
              <Td>{fmtDate(g.date)}</Td>
              <Td>{g.po_code ?? poCode(g.po_id)}</Td>
              <Td>{supplierName(g.supplier_id)}</Td>
              <Td>{g.supplier_invoice_no ?? "—"}</Td>
              <Td>{g.receiving_cost_center}</Td>
              <Td>{g.lines.length}</Td>
              <Td>KWD {g.total.toFixed(2)}</Td>
              <Td>
                {g.has_variance
                  ? <span style={{ color: "var(--status-warning)", fontWeight: 600 }}>{g.variance_total > 0 ? "+" : ""}{g.variance_total.toFixed(2)}</span>
                  : "—"}
              </Td>
              <Td><StatusBadge status={g.status} /></Td>
            </tr>
          ))}
        </tbody>
      </Table>
      )}

      {detail && (
        <Modal title={detail.code} onClose={() => setDetailId(null)}>
          <div className="flex flex-col gap-3 text-[13px]">
            <div className="flex items-center justify-between gap-2">
              <StatusBadge status={detail.status} />
              <WorkflowBar entityType="grn" id={detail.id} status={detail.status} queryKeys={["grns", "purchase-orders"]} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <InfoRow label="Purchase order" value={detail.po_code ?? poCode(detail.po_id)} />
              <InfoRow label="Supplier" value={supplierName(detail.supplier_id)} />
              <InfoRow label="Supplier invoice no." value={detail.supplier_invoice_no ?? "—"} />
              <InfoRow label="Receiving cost center" value={detail.receiving_cost_center} />
              <InfoRow label="Date" value={fmtDate(detail.date)} />
              <InfoRow label="Received by" value={detail.received_by_name ?? "—"} />
              <InfoRow label="Total" value={`KWD ${detail.total.toFixed(3)}`} />
              {detail.has_variance && <InfoRow label="Price variance" value={`${detail.variance_total > 0 ? "+" : ""}KWD ${detail.variance_total.toFixed(3)}`} />}
            </div>
            {detail.has_variance && (
              <p className="rounded-lg px-3 py-2" style={{ background: "var(--status-warning-bg)" }}>
                Invoiced at a different price from the order. Reason: {detail.variance_note ?? "none recorded"}
              </p>
            )}
            <Table>
              <thead><tr><Th>Item</Th><Th>Ordered</Th><Th>Received</Th><Th>Price</Th><Th>Line value</Th><Th>Batch</Th><Th>Expiry</Th></tr></thead>
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
                    <Td>KWD {l.line_total.toFixed(3)}</Td>
                    <Td>{l.batch_label ?? "—"}</Td>
                    <Td>{l.expiry ? fmtDate(l.expiry) : "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div>
              <div className="mb-1 text-[12px] font-semibold uppercase" style={{ color: "var(--ink-500)" }}>History</div>
              <HistoryPanel entityType="grn" id={detail.id} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

interface SpendRowData { key: string; label: string; unit: string | null; qty: number | null; grn_count: number; value: number; price_variance: number }

// What was bought, from goods receipts at the invoiced price: monthly spend,
// supplier-wise spend, spend per cost center or per item, for any period.
function SpendTab() {
  const { data: suppliers } = useList<Supplier>("suppliers", "/suppliers");
  const { data: costCenters } = useList<CostCenter>("cost-centers", "/kitchen/cost-centers");
  const [f, setF] = useState({ from: "", to: "", group: "month", supplier: "", cc: "" });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const { data, isLoading } = useQuery<{ rows: SpendRowData[]; total_value: number; total_variance: number; note: string }>({
    queryKey: ["purchase-spend", f],
    queryFn: async () =>
      (await api.get("/purchasing/spend", {
        params: { group_by: f.group, date_from: f.from || undefined, date_to: f.to || undefined, supplier_id: f.supplier || undefined, cost_center_id: f.cc || undefined },
      })).data,
  });
  const field = "rounded-lg border px-2.5 py-1.5 text-sm";
  const border = { borderColor: "var(--border-strong)" };
  const money = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <DateRangeFilter from={f.from} to={f.to} onFromChange={set("from")} onToChange={set("to")} />
        <select className={field} style={border} value={f.group} onChange={(e) => set("group")(e.target.value)}>
          <option value="month">By month</option>
          <option value="supplier">By supplier</option>
          <option value="cost_center">By cost center</option>
          <option value="item">By item</option>
        </select>
        <select className={field} style={border} value={f.supplier} onChange={(e) => set("supplier")(e.target.value)}>
          <option value="">All suppliers</option>
          {suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className={field} style={border} value={f.cc} onChange={(e) => set("cc")(e.target.value)}>
          <option value="">All cost centers</option>
          {costCenters?.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>
      {isLoading || !data ? <Spinner /> : data.rows.length === 0 ? <EmptyState label="No goods received in this period." /> : (
        <Table>
          <thead>
            <tr>
              <Th>{{ month: "Month", supplier: "Supplier", cost_center: "Cost center", item: "Item" }[f.group]}</Th>
              {f.group === "item" && <Th>Quantity</Th>}
              <Th>Receipts</Th><Th>Spend (KWD)</Th><Th>Price variance</Th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.key}>
                <Td className="font-medium">{r.label}</Td>
                {f.group === "item" && <Td>{r.qty} {r.unit}</Td>}
                <Td>{r.grn_count}</Td>
                <Td className="font-semibold">{money(r.value)}</Td>
                <Td style={Math.abs(r.price_variance) > 0.004 ? { color: "var(--status-warning)" } : undefined}>
                  {Math.abs(r.price_variance) > 0.004 ? `${r.price_variance > 0 ? "+" : ""}${money(r.price_variance)}` : "—"}
                </Td>
              </tr>
            ))}
            <tr>
              <Td className="font-semibold">Total</Td>
              {f.group === "item" && <Td>{" "}</Td>}
              <Td>{" "}</Td>
              <Td className="font-bold">{money(data.total_value)}</Td>
              <Td className="font-semibold">{Math.abs(data.total_variance) > 0.004 ? money(data.total_variance) : "—"}</Td>
            </tr>
          </tbody>
        </Table>
      )}
      <p className="mt-1.5 text-[12px]" style={{ color: "var(--ink-400)" }}>{data?.note}</p>
    </div>
  );
}

interface PriceCell { latest_price: number; latest_date: string; avg_price: number; min_price: number; max_price: number; purchases: number; total_qty: number }
interface ComparisonData {
  suppliers: { id: string; name: string }[];
  items: { item_master_id: string; name: string; unit: string; cells: Record<string, PriceCell>; cheapest_supplier_id: string | null }[];
}

// Supplier A vs B vs C for the same item, from the purchase orders already
// placed. Read only: it changes nothing and creates nothing.
function PriceComparisonTab() {
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [multiOnly, setMultiOnly] = useState(false);
  const { data, isLoading } = useQuery<ComparisonData>({
    queryKey: ["price-comparison", dateFrom, dateTo],
    queryFn: async () => (await api.get("/purchasing/price-comparison", { params: { date_from: dateFrom || undefined, date_to: dateTo || undefined } })).data,
  });
  if (isLoading || !data) return <Spinner />;

  const q = search.trim().toLowerCase();
  const items = data.items.filter((i) => (!q || i.name.toLowerCase().includes(q)) && (!multiOnly || Object.keys(i.cells).length > 1));
  const field = "rounded-lg border px-2.5 py-1.5 text-sm";

  return (
    <div>
      <p className="mb-3 text-[12.5px]" style={{ color: "var(--ink-500)" }}>
        What each supplier charged for the same item on purchase orders placed with them. The big number is the latest price; below it
        the average and number of orders. The lowest latest price is highlighted. This screen only reads existing orders.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input className={field} style={{ borderColor: "var(--border-strong)" }} placeholder="Search item, e.g. Chicken Breast" value={search} onChange={(e) => setSearch(e.target.value)} />
        <DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} />
        <label className="flex items-center gap-1.5 text-[13px]">
          <input type="checkbox" checked={multiOnly} onChange={(e) => setMultiOnly(e.target.checked)} />
          Items bought from 2+ suppliers only
        </label>
      </div>
      {items.length === 0 ? <EmptyState label="No items match - purchase orders with at least one supplier are needed to compare." /> : (
        <Table>
          <thead>
            <tr>
              <Th>Item</Th>
              {data.suppliers.map((sp) => <Th key={sp.id}>{sp.name}</Th>)}
              <Th>Spread</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => {
              const latest = Object.values(i.cells).map((c) => c.latest_price);
              const spread = latest.length > 1 ? Math.max(...latest) - Math.min(...latest) : 0;
              return (
                <tr key={i.item_master_id}>
                  <Td className="font-medium">{i.name}<div className="text-[11.5px] font-normal" style={{ color: "var(--ink-400)" }}>per {i.unit}</div></Td>
                  {data.suppliers.map((sp) => {
                    const c = i.cells[sp.id];
                    const best = i.cheapest_supplier_id === sp.id;
                    return (
                      <Td key={sp.id} style={best ? { background: "var(--status-good-bg)" } : undefined}>
                        {c ? (
                          <>
                            <div className="text-[15px] font-semibold">
                              {c.latest_price.toFixed(3)}
                              {best && <span className="ml-1.5 text-[10.5px] font-bold uppercase" style={{ color: "var(--status-good)" }}>lowest</span>}
                            </div>
                            <div className="text-[11.5px]" style={{ color: "var(--ink-500)" }}>
                              avg {c.avg_price.toFixed(3)} · {c.purchases} order{c.purchases > 1 ? "s" : ""}
                            </div>
                            <div className="text-[11px]" style={{ color: "var(--ink-400)" }}>last {fmtDate(c.latest_date)}</div>
                          </>
                        ) : <span style={{ color: "var(--ink-300)" }}>—</span>}
                      </Td>
                    );
                  })}
                  <Td>{spread > 0.0005 ? `${spread.toFixed(3)} (${((spread / Math.min(...latest)) * 100).toFixed(0)}%)` : "—"}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
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
  const qc = useQueryClient();
  const navigate = useNavigate();
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
      const id = await createDraftRequest(basket.map((line) => ({ item_master_id: line.itemMasterId, qty: line.qty })));
      setBasket([]);
      qc.invalidateQueries({ queryKey: ["purchase-requests"] });
      navigate(`/purchasing/requests/${id}/edit`);
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
                {submitting ? "Creating..." : "Create purchase request"}
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
