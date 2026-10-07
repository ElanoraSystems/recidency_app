import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useList } from "../api/hooks";
import { StatusBadge, WorkflowBar, HistoryPanel, errorText } from "../components/Workflow";
import { RecipePlate } from "../components/RecipePhotos";
import { useNeeds } from "../components/RecipeCook";
import { Button, DateRangeFilter, EmptyState, PageHeader, Spinner, Table, Td, Th } from "../components/ui";
import { addDays, fmtDate, todayIso } from "../lib/date";
import type {
  CostCenter, FoodInventoryItem, MealCategory, MealLogEntry, Recipe, StockBalances, StockTransfer, TxnStatus,
  WasteLog, WasteReason,
} from "../types";

const fieldCls = "rounded-lg border px-3 py-2 text-sm";
const cellCls = "w-full rounded-lg border px-2 py-1.5 text-sm";
const borderStyle = { borderColor: "var(--border-strong)" };
const kwd = (n: number) => `KWD ${n.toFixed(3)}`;
const STATUS_FILTERS: TxnStatus[] = ["Draft", "Submitted", "Approved", "Closed"];

// A plain <a href> won't carry the Bearer token - fetch as an authenticated
// blob and open that instead.
async function openPdf(url: string) {
  const res = await api.get(url, { responseType: "blob" });
  const blobUrl = URL.createObjectURL(res.data as Blob);
  window.open(blobUrl, "_blank");
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

function useCostCenters() {
  const { data } = useList<CostCenter>("cost-centers", "/kitchen/cost-centers");
  const sorted = [...(data ?? [])].sort((a, b) => a.label.localeCompare(b.label));
  return { list: sorted, mainStoreId: sorted.find((c) => c.label === "Main Store")?.id ?? "" };
}

const sortByName = <T extends { name: string }>(xs: T[] | undefined) =>
  [...(xs ?? [])].sort((a, b) => a.name.localeCompare(b.name));

// ------------------------------------------------------------ list pieces --
function RowActions({
  entityType, id, status, viewTo, invoiceUrl, queryKey,
}: { entityType: string; id: string; status: TxnStatus; viewTo: string; invoiceUrl: string; queryKey: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const close = useMutation({
    mutationFn: async () => api.post(`/transactions/${entityType}/${id}/close`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [queryKey] });
      qc.invalidateQueries({ queryKey: ["approvals"] });
    },
  });
  const canEdit = status !== "Closed" || user?.user_type === "owner";
  const linkCls = "text-xs font-semibold";
  const linkStyle = { color: "var(--brass-600)" };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1" onClick={(e) => e.stopPropagation()}>
      <Link to={viewTo} className={linkCls} style={linkStyle}>View</Link>
      <button type="button" className={linkCls} style={linkStyle} onClick={() => openPdf(invoiceUrl)}>Invoice</button>
      {canEdit ? (
        <Link to={viewTo} className={linkCls} style={linkStyle}>Edit</Link>
      ) : (
        <span className={linkCls} style={{ color: "var(--ink-400)" }} title="Closed - Super User authorization required">Edit (locked)</span>
      )}
      {status === "Approved" && (
        <button type="button" className={linkCls} style={linkStyle} disabled={close.isPending} onClick={() => close.mutate()}>
          Close
        </button>
      )}
    </div>
  );
}

function StatusSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-lg border px-2.5 py-1.5 text-sm" style={borderStyle}>
      <option value="">All statuses</option>
      {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

function CostCenterSelect({
  value, onChange, list, placeholder,
}: { value: string; onChange: (v: string) => void; list: CostCenter[]; placeholder: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-lg border px-2.5 py-1.5 text-sm" style={borderStyle}>
      <option value="">{placeholder}</option>
      {list.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
    </select>
  );
}

// ----------------------------------------------------------- Meal Log tab --
export function MealLogTab() {
  const { data, isLoading } = useList<MealLogEntry>("meal-log", "/kitchen/meal-log");
  const { list: costCenters } = useCostCenters();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [ccFilter, setCcFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const navigate = useNavigate();
  if (isLoading) return <Spinner />;

  const rows = (data ?? []).filter((m) =>
    (!dateFrom || m.date >= dateFrom) && (!dateTo || m.date <= dateTo) &&
    (!ccFilter || m.cost_center_id === ccFilter) && (!statusFilter || m.status === statusFilter));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} />
        <CostCenterSelect value={ccFilter} onChange={setCcFilter} list={costCenters} placeholder="All cost centers" />
        <StatusSelect value={statusFilter} onChange={setStatusFilter} />
      </div>
      {rows.length === 0 ? <EmptyState label="No meal transactions match these filters." /> : (
        <Table>
          <thead><tr><Th>Date</Th><Th>Txn #</Th><Th>Cost Center</Th><Th>Total Price</Th><Th>Status</Th><Th>{" "}</Th></tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className="cursor-pointer" onClick={() => navigate(`/kitchen/meal-log/${m.id}`)}>
                <Td>{fmtDate(m.date)}</Td>
                <Td className="font-medium">{m.code}<div className="text-xs" style={{ color: "var(--ink-400)" }}>{m.lines.length} dish(es)</div></Td>
                <Td className="font-semibold">{m.cost_center}</Td>
                <Td className="font-semibold">{kwd(m.total)}</Td>
                <Td><StatusBadge status={m.status} /></Td>
                <Td>
                  <RowActions entityType="meal_log" id={m.id} status={m.status} viewTo={`/kitchen/meal-log/${m.id}`}
                    invoiceUrl={`/kitchen/meal-log/${m.id}/invoice-pdf`} queryKey="meal-log" />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

// ------------------------------------------------------ Transfer list tab --
export function TransferTab() {
  const { data, isLoading } = useList<StockTransfer>("stock-transfers", "/kitchen/stock-transfers");
  const { list: costCenters } = useCostCenters();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [ccFilter, setCcFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const navigate = useNavigate();
  if (isLoading) return <Spinner />;

  const rows = (data ?? []).filter((t) =>
    (!dateFrom || t.date >= dateFrom) && (!dateTo || t.date <= dateTo) &&
    (!ccFilter || t.from_cost_center_id === ccFilter || t.to_cost_center_id === ccFilter) &&
    (!statusFilter || t.status === statusFilter));

  return (
    <div>
      <p className="mb-4 text-[13px]" style={{ color: "var(--ink-500)" }}>
        Move raw materials from one cost center to another without a recipe. Stock leaves the From location and arrives at
        the To location when submitted; company-wide stock does not change.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} />
        <CostCenterSelect value={ccFilter} onChange={setCcFilter} list={costCenters} placeholder="From or To: any" />
        <StatusSelect value={statusFilter} onChange={setStatusFilter} />
      </div>
      {rows.length === 0 ? <EmptyState label="No raw material transfers match these filters." /> : (
        <Table>
          <thead><tr><Th>Date</Th><Th>Txn #</Th><Th>From</Th><Th>To</Th><Th>Total Cost</Th><Th>Status</Th><Th>{" "}</Th></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="cursor-pointer" onClick={() => navigate(`/kitchen/transfers/${t.id}`)}>
                <Td>{fmtDate(t.date)}</Td>
                <Td className="font-medium">{t.code}<div className="text-xs" style={{ color: "var(--ink-400)" }}>{t.lines.length} item(s)</div></Td>
                <Td>{t.from_cost_center}</Td>
                <Td>{t.to_cost_center ?? "-"}</Td>
                <Td className="font-semibold">{kwd(t.total)}</Td>
                <Td><StatusBadge status={t.status} /></Td>
                <Td>
                  <RowActions entityType="stock_transfer" id={t.id} status={t.status} viewTo={`/kitchen/transfers/${t.id}`}
                    invoiceUrl={`/kitchen/stock-transfers/${t.id}/invoice-pdf`} queryKey="stock-transfers" />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

// -------------------------------------------------------- Waste list tab --
export function WasteTab() {
  const { data, isLoading } = useList<WasteLog>("waste-log", "/kitchen/waste-log");
  const { list: costCenters } = useCostCenters();
  const { data: reasonsRaw } = useList<WasteReason>("waste-reasons", "/kitchen/waste-reasons");
  const reasons = [...(reasonsRaw ?? [])].sort((a, b) => a.label.localeCompare(b.label));
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [ccFilter, setCcFilter] = useState("");
  const [reasonFilter, setReasonFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const navigate = useNavigate();
  if (isLoading) return <Spinner />;

  const rows = (data ?? []).filter((w) =>
    (!dateFrom || w.date >= dateFrom) && (!dateTo || w.date <= dateTo) &&
    (!ccFilter || w.cost_center_id === ccFilter) && (!reasonFilter || w.reason === reasonFilter) &&
    (!statusFilter || w.status === statusFilter));

  // Waste over the last seven days, grouped by reason.
  const since = addDays(todayIso(), -6);
  const byReason = new Map<string, number>();
  for (const w of data ?? []) if (w.date >= since) byReason.set(w.reason, (byReason.get(w.reason) ?? 0) + w.total);
  const reasonRows = [...byReason].sort((a, b) => b[1] - a[1]);
  const topReason = reasonRows[0]?.[1] ?? 0;

  return (
    <div>
      {reasonRows.length > 0 && (
        <div className="mb-4 max-w-xl rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <div className="mb-2 flex items-center justify-between text-[13px]"><b>Waste in the last 7 days</b><span style={{ color: "var(--ink-500)" }}>KWD {reasonRows.reduce((s, r) => s + r[1], 0).toFixed(3)}</span></div>
          <div className="flex flex-col gap-1.5">
            {reasonRows.map(([reason, value]) => (
              <div key={reason} className="grid grid-cols-[110px_minmax(0,1fr)_70px] items-center gap-2 text-[12.5px]">
                <span className="truncate">{reason}</span>
                <span className="h-2.5 overflow-hidden rounded-full" style={{ background: "var(--surface-sunken)" }}><span className="block h-full rounded-full" style={{ width: `${(value / topReason) * 100}%`, background: "var(--brass-500)" }} /></span>
                <span className="text-right font-bold tabular-nums">{value.toFixed(3)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="mb-4 text-[13px]" style={{ color: "var(--ink-500)" }}>
        Log spoiled or wasted stock. Stock is deducted from the selected cost center when the entry is submitted.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} />
        <CostCenterSelect value={ccFilter} onChange={setCcFilter} list={costCenters} placeholder="All cost centers" />
        <select value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)} className="rounded-lg border px-2.5 py-1.5 text-sm" style={borderStyle}>
          <option value="">All reasons</option>
          {reasons.map((r) => <option key={r.id} value={r.label}>{r.label}</option>)}
        </select>
        <StatusSelect value={statusFilter} onChange={setStatusFilter} />
      </div>
      {rows.length === 0 ? <EmptyState label="No waste logs match these filters." /> : (
        <Table>
          <thead><tr><Th>Date</Th><Th>Txn #</Th><Th>Cost Center</Th><Th>Reason</Th><Th>Total Cost</Th><Th>Status</Th><Th>{" "}</Th></tr></thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.id} className="cursor-pointer" onClick={() => navigate(`/kitchen/waste/${w.id}`)}>
                <Td>{fmtDate(w.date)}</Td>
                <Td className="font-medium">{w.code}<div className="text-xs" style={{ color: "var(--ink-400)" }}>{w.lines.length} item(s)</div></Td>
                <Td className="font-semibold">{w.cost_center}</Td>
                <Td>{w.reason}</Td>
                <Td className="font-semibold">{kwd(w.total)}</Td>
                <Td><StatusBadge status={w.status} /></Td>
                <Td>
                  <div onClick={(e) => e.stopPropagation()}>
                    <Link to={`/kitchen/waste/${w.id}`} className="text-xs font-semibold" style={{ color: "var(--brass-600)" }}>View / Edit</Link>
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

// ------------------------------------------------------------ page chrome --
function PageShell({
  tab, title, subtitle, children,
}: { tab: string; title: string; subtitle: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <Link to={`/kitchen?tab=${encodeURIComponent(tab)}`} className="mb-3 inline-block text-[13px] font-semibold" style={{ color: "var(--brass-600)" }}>
        ← Back to Kitchen
      </Link>
      <PageHeader title={title} />
      <div className="-mt-3 mb-4 text-[13px]" style={{ color: "var(--ink-500)" }}>{subtitle}</div>
      {children}
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`flex flex-col gap-1 text-[13px] font-medium ${className}`}>{label}{children}</label>;
}

function Stamps({ doc }: { doc: { logged_by_name: string | null; submitted_by_name: string | null; approved_by_name: string | null; closed_by_name: string | null } }) {
  const parts = [
    doc.logged_by_name && `Created by ${doc.logged_by_name}`,
    doc.submitted_by_name && `Submitted by ${doc.submitted_by_name}`,
    doc.approved_by_name && `Approved by ${doc.approved_by_name}`,
    doc.closed_by_name && `Closed by ${doc.closed_by_name}`,
  ].filter(Boolean);
  return <p className="text-[12.5px]" style={{ color: "var(--ink-500)" }}>{parts.join(" · ")}</p>;
}

function ErrorNote({ message }: { message: string | null }) {
  return message ? <p className="text-[13px]" style={{ color: "var(--status-critical)" }}>{message}</p> : null;
}

function useRouteError(): string | null {
  const location = useLocation();
  return (location.state as { error?: string } | null)?.error ?? null;
}

// -------------------------------------------------------- Meal Log page ---
interface MealLineForm { key: string; recipe_id: string; dish: string; qty: number; unit_cost: number }
interface MealForm { date: string; cost_center_id: string; category: string; notes: string; lines: MealLineForm[] }

const newMealLine = (): MealLineForm => ({ key: crypto.randomUUID(), recipe_id: "", dish: "", qty: 1, unit_cost: 0 });

export function MealLogPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const routeError = useRouteError();
  const { list: costCenters, mainStoreId } = useCostCenters();
  const { data: recipes } = useList<Recipe>("recipes", "/kitchen/recipes");
  const { data: categoriesRaw } = useList<MealCategory>("meal-categories", "/kitchen/meal-categories");
  const categories = [...(categoriesRaw ?? [])].sort((a, b) => a.label.localeCompare(b.label));
  const { data: doc, isLoading } = useQuery<MealLogEntry>({
    queryKey: ["transaction", "meal_log", id],
    queryFn: async () => (await api.get(`/kitchen/meal-log/${id}`)).data,
    enabled: !!id,
  });
  const [edits, setEdits] = useState<Partial<MealForm> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tileSearch, setTileSearch] = useState("");
  // "Log served" links arrive with the planned dishes, a meal category and a portion count.
  const [search] = useSearchParams();
  const linked = search.getAll("recipe");
  const linkedPortions = Math.max(1, Math.floor(Number(search.get("portions"))) || 1);

  const baseline: MealForm = doc
    ? {
        date: doc.date, cost_center_id: doc.cost_center_id, category: doc.category ?? "", notes: doc.notes ?? "",
        lines: doc.lines.map((l) => ({ key: l.id, recipe_id: l.recipe_id ?? "", dish: l.dish, qty: l.qty, unit_cost: l.unit_cost })),
      }
    : {
        date: todayIso(), cost_center_id: mainStoreId, category: search.get("category") ?? "", notes: "",
        lines: linked.length ? linked.map((rid) => ({ ...newMealLine(), recipe_id: rid, qty: linkedPortions })) : [newMealLine()],
      };
  const form: MealForm = { ...baseline, ...(edits ?? {}) };
  const editable = isNew || doc?.status === "Draft";
  const patch = (p: Partial<MealForm>) => setEdits((e) => ({ ...(e ?? {}), ...p }));
  const updateLine = (key: string, p: Partial<MealLineForm>) =>
    patch({ lines: form.lines.map((l) => (l.key === key ? { ...l, ...p } : l)) });
  const recipeCost = (rid: string) => recipes?.find((r) => r.id === rid)?.cost.cost_per_portion ?? 0;
  const lineCost = (l: MealLineForm) => l.qty * (l.recipe_id ? recipeCost(l.recipe_id) : l.unit_cost);
  const total = form.lines.reduce((s, l) => s + lineCost(l), 0);

  // Tapping a dish adds it, or adds a portion if it is already on the meal.
  const addDish = (rid: string) => {
    const existing = form.lines.find((l) => l.recipe_id === rid);
    const kept = form.lines.filter((l) => l.recipe_id || l.dish.trim());
    patch({ lines: existing ? form.lines.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l)) : [...kept, { ...newMealLine(), recipe_id: rid }] });
  };
  const tiles = (recipes ?? [])
    .filter((r) => !tileSearch.trim() || r.name.toLowerCase().includes(tileSearch.trim().toLowerCase()))
    .sort((a, b) => Number(b.photo_ids.length > 0) - Number(a.photo_ids.length > 0) || a.name.localeCompare(b.name))
    .slice(0, 12);
  // Meals can still be logged below zero stock; this only says what would run short at the cost center.
  const needItems = form.lines.filter((l) => l.recipe_id && l.qty > 0).map((l) => ({ recipe_id: l.recipe_id, portions: l.qty }));
  const { data: stockCheck } = useNeeds(editable ? needItems : [], form.cost_center_id || undefined);
  const runningShort = stockCheck?.lines.filter((l) => l.short > 0) ?? [];

  const payload = () => ({
    date: form.date, cost_center_id: form.cost_center_id, category: form.category || null, notes: form.notes || null,
    lines: form.lines.map((l) => ({
      recipe_id: l.recipe_id || null, dish: l.recipe_id ? null : l.dish, qty: l.qty,
      unit_cost: l.recipe_id ? null : l.unit_cost,
    })),
  });

  async function save(andSubmit: boolean) {
    setError(null);
    setBusy(true);
    let docId = id;
    try {
      if (isNew) docId = ((await api.post<MealLogEntry>("/kitchen/meal-log", payload())).data).id;
      else await api.put(`/kitchen/meal-log/${id}`, payload());
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
      return;
    }
    qc.invalidateQueries({ queryKey: ["meal-log"] });
    qc.invalidateQueries({ queryKey: ["transaction", "meal_log", docId] });
    if (andSubmit) {
      try {
        await api.post(`/transactions/meal_log/${docId}/submit`, {});
        for (const k of ["approvals", "stock-balances", "stock-movements", "food-inventory"]) qc.invalidateQueries({ queryKey: [k] });
      } catch (err) {
        setBusy(false);
        setEdits(null);
        navigate(`/kitchen/meal-log/${docId}`, { replace: true, state: { error: `Saved as Draft, but could not submit: ${errorText(err)}` } });
        return;
      }
    }
    setBusy(false);
    setEdits(null);
    navigate(andSubmit ? "/kitchen?tab=Meal%20Log" : `/kitchen/meal-log/${docId}`, { replace: !isNew || andSubmit });
  }

  async function removeDraft() {
    if (!window.confirm("Delete this draft?")) return;
    await api.delete(`/kitchen/meal-log/${id}`);
    qc.invalidateQueries({ queryKey: ["meal-log"] });
    navigate("/kitchen?tab=Meal%20Log");
  }

  if (id && isLoading) return <Spinner />;
  if (id && !doc) return <EmptyState label="Meal transaction not found." />;
  const ccLabel = costCenters.find((c) => c.id === form.cost_center_id)?.label;

  return (
    <PageShell
      tab="Meal Log"
      title={isNew ? "New meal transaction" : (doc?.cost_center ?? "Meal transaction")}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          {doc && <><span className="font-semibold">{doc.code}</span><StatusBadge status={doc.status} /></>}
          {isNew && "Cost center is the transaction title and the stock location ingredients are drawn from."}
        </span>
      }
    >
      <ErrorNote message={error ?? routeError} />
      <form className="mt-2 flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save(false); }}>
        <fieldset disabled={!editable} className="grid max-w-3xl grid-cols-1 gap-3 rounded-xl border p-3 sm:grid-cols-4" style={borderStyle}>
          <Field label="Cost center (stock location)" className="sm:col-span-2">
            <select required className={fieldCls} style={borderStyle} value={form.cost_center_id} onChange={(e) => patch({ cost_center_id: e.target.value })}>
              <option value="">- Select -</option>
              {costCenters.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Date">
            <input type="date" required className={fieldCls} style={borderStyle} value={form.date} onChange={(e) => patch({ date: e.target.value })} />
          </Field>
          <Field label="Meal category">
            <select className={fieldCls} style={borderStyle} value={form.category} onChange={(e) => patch({ category: e.target.value })}>
              <option value="">-</option>
              {categories.map((c) => <option key={c.id} value={c.label}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Notes" className="sm:col-span-4">
            <input className={fieldCls} style={borderStyle} value={form.notes} onChange={(e) => patch({ notes: e.target.value })} />
          </Field>
        </fieldset>

        {editable && (
          <div className="flex max-w-4xl flex-col gap-2">
            <input className={`${fieldCls} max-w-sm`} style={borderStyle} placeholder="Search dishes…" value={tileSearch} onChange={(e) => setTileSearch(e.target.value)} />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {tiles.map((r) => {
                const qty = form.lines.filter((l) => l.recipe_id === r.id).reduce((s, l) => s + l.qty, 0);
                return (
                  <button key={r.id} type="button" onClick={() => addDish(r.id)} className="relative overflow-hidden rounded-lg border text-left"
                    style={{ borderColor: qty > 0 ? "var(--brass-500)" : "var(--border)", background: "var(--surface)", outline: qty > 0 ? "2px solid var(--brass-500)" : "none" }}>
                    <RecipePlate cover={r.photo_ids[0]} category={r.category} label="" />
                    <div className="px-2 py-1.5">
                      <div className="truncate text-[12.5px] font-bold">{r.name}</div>
                      <div className="text-[11px]" style={{ color: "var(--ink-500)" }}>{r.cost.unpriced ? "Needs price" : kwd(r.cost.cost_per_portion)}</div>
                    </div>
                    {qty > 0 && <span className="absolute right-1.5 top-1.5 rounded-full px-2 py-0.5 text-[12px] font-extrabold" style={{ background: "var(--brass-500)", color: "#1c1607" }}>{qty}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <Table>
            <thead><tr><Th>Item / Dish</Th><Th>Quantity</Th><Th>Unit</Th><Th>Unit Cost</Th><Th>Total Line Cost</Th><Th>{" "}</Th></tr></thead>
            <tbody>
              {editable ? form.lines.map((l) => (
                <tr key={l.key}>
                  <Td>
                    <div className="flex min-w-[260px] flex-col gap-1">
                      <select className={cellCls} style={borderStyle} value={l.recipe_id} onChange={(e) => updateLine(l.key, { recipe_id: e.target.value })}>
                        <option value="">- Custom / off-menu dish -</option>
                        {recipes?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                      {!l.recipe_id && (
                        <input required placeholder="Dish name" className={cellCls} style={borderStyle} value={l.dish} onChange={(e) => updateLine(l.key, { dish: e.target.value })} />
                      )}
                    </div>
                  </Td>
                  <Td><input type="number" min={1} required className={`${cellCls} w-24`} style={borderStyle} value={l.qty} onChange={(e) => updateLine(l.key, { qty: Number(e.target.value) })} /></Td>
                  <Td>portion</Td>
                  <Td>
                    {l.recipe_id ? kwd(recipeCost(l.recipe_id)) : (
                      <input type="number" min={0} step="0.001" className={`${cellCls} w-28`} style={borderStyle} value={l.unit_cost} onChange={(e) => updateLine(l.key, { unit_cost: Number(e.target.value) })} />
                    )}
                  </Td>
                  <Td className="font-semibold">{kwd(lineCost(l))}</Td>
                  <Td>
                    {form.lines.length > 1 && (
                      <button type="button" className="text-xs font-semibold" style={{ color: "var(--status-critical)" }}
                        onClick={() => patch({ lines: form.lines.filter((x) => x.key !== l.key) })}>Remove</button>
                    )}
                  </Td>
                </tr>
              )) : doc?.lines.map((l) => (
                <tr key={l.id}>
                  <Td className="font-medium">{l.dish}</Td>
                  <Td>{l.qty}</Td>
                  <Td>{l.unit}</Td>
                  <Td>{kwd(l.unit_cost)}</Td>
                  <Td className="font-semibold">{kwd(l.line_cost)}</Td>
                  <Td>{" "}</Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <Td colSpan={4} className="text-right font-semibold">Total</Td>
                <Td className="font-bold">{kwd(editable ? total : doc?.total ?? 0)}</Td>
                <Td>{" "}</Td>
              </tr>
            </tfoot>
          </Table>
        </div>

        {editable && runningShort.length > 0 && (
          <div className="max-w-3xl rounded-lg px-3 py-2 text-[13px]" style={{ background: "var(--status-warning-bg)", color: "var(--ink-700)" }}>
            <b style={{ color: "var(--status-warning)" }}>Stock will run short{ccLabel ? ` at ${ccLabel}` : ""}: </b>
            {runningShort.slice(0, 5).map((l) => `${l.name} ${l.short} ${l.unit}`).join(", ")}{runningShort.length > 5 ? ` and ${runningShort.length - 5} more` : ""}.
            The meal can still be logged; the shortfall is recorded and covered by the next receipt.
          </div>
        )}

        {editable ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => patch({ lines: [...form.lines, newMealLine()] })}>+ Add custom dish</Button>
            <span className="flex-1" />
            {!isNew && <Button type="button" variant="danger" onClick={removeDraft} disabled={busy}>Delete draft</Button>}
            <Button type="submit" variant="secondary" disabled={busy}>{isNew ? "Save draft" : "Save changes"}</Button>
            <Button type="button" disabled={busy} onClick={() => save(true)}>{busy ? "Working..." : "Save & submit"}</Button>
          </div>
        ) : doc && (
          <div className="flex flex-col gap-3">
            <WorkflowBar entityType="meal_log" id={doc.id} status={doc.status} queryKeys={["meal-log"]} />
            <div className="flex gap-3">
              <Button type="button" variant="secondary" onClick={() => openPdf(`/kitchen/meal-log/${doc.id}/invoice-pdf`)}>View invoice</Button>
            </div>
          </div>
        )}
        {!editable && ccLabel && <p className="text-[12px]" style={{ color: "var(--ink-400)" }}>Stock was drawn from {ccLabel}.</p>}
      </form>

      {doc && (
        <div className="mt-6 max-w-3xl">
          <Stamps doc={doc} />
          <h3 className="mb-2 mt-4 text-[13px] font-semibold">History</h3>
          <HistoryPanel entityType="meal_log" id={doc.id} />
        </div>
      )}
    </PageShell>
  );
}

// ----------------------------------------- shared raw-material line editor --
interface ItemLineForm { key: string; food_inventory_id: string; qty: number }
const newItemLine = (): ItemLineForm => ({ key: crypto.randomUUID(), food_inventory_id: "", qty: 1 });

function useAvailable(ccId: string) {
  const { data } = useQuery<StockBalances>({
    queryKey: ["stock-balances", "location", ccId],
    queryFn: async () => (await api.get(`/stock/balances?stock_type=food&cost_center_id=${ccId}`)).data,
    enabled: !!ccId,
  });
  const map: Record<string, number> = {};
  for (const item of data?.items ?? []) map[item.stock_id] = item.by_location[ccId] ?? 0;
  return map;
}

function ItemLinesEditor({
  lines, onChange, items, available, locationLabel,
}: {
  lines: ItemLineForm[]; onChange: (l: ItemLineForm[]) => void; items: FoodInventoryItem[];
  available: Record<string, number>; locationLabel: string | undefined;
}) {
  const update = (key: string, p: Partial<ItemLineForm>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...p } : l)));
  return (
    <div>
      <div className="overflow-x-auto">
        <Table>
          <thead><tr><Th>Item / Raw Material</Th><Th>Available{locationLabel ? ` at ${locationLabel}` : ""}</Th><Th>Quantity</Th><Th>Unit</Th><Th>Unit Cost</Th><Th>Total Cost</Th><Th>{" "}</Th></tr></thead>
          <tbody>
            {lines.map((l) => {
              const item = items.find((i) => i.id === l.food_inventory_id);
              const avail = l.food_inventory_id ? available[l.food_inventory_id] ?? 0 : null;
              const short = avail !== null && l.qty > avail + 0.0005;
              return (
                <tr key={l.key}>
                  <Td>
                    <select required className={`${cellCls} min-w-[220px]`} style={borderStyle} value={l.food_inventory_id} onChange={(e) => update(l.key, { food_inventory_id: e.target.value })}>
                      <option value="">- Select item -</option>
                      {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                  </Td>
                  <Td>{avail === null ? "-" : <span style={{ color: short ? "var(--status-critical)" : undefined }}>{avail} {item?.unit}</span>}</Td>
                  <Td><input type="number" min={0.001} step="any" required className={`${cellCls} w-28`} style={borderStyle} value={l.qty} onChange={(e) => update(l.key, { qty: Number(e.target.value) })} /></Td>
                  <Td>{item?.unit ?? "-"}</Td>
                  <Td>{item ? kwd(item.cost) : "-"}</Td>
                  <Td className="font-semibold">{item ? kwd(item.cost * l.qty) : "-"}</Td>
                  <Td>
                    {lines.length > 1 && (
                      <button type="button" className="text-xs font-semibold" style={{ color: "var(--status-critical)" }} onClick={() => onChange(lines.filter((x) => x.key !== l.key))}>Remove</button>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <Td colSpan={5} className="text-right font-semibold">Estimated total</Td>
              <Td className="font-bold">{kwd(lines.reduce((s, l) => s + (items.find((i) => i.id === l.food_inventory_id)?.cost ?? 0) * l.qty, 0))}</Td>
              <Td>{" "}</Td>
            </tr>
          </tfoot>
        </Table>
      </div>
      <div className="mt-3"><Button type="button" variant="secondary" onClick={() => onChange([...lines, newItemLine()])}>+ Add item</Button></div>
    </div>
  );
}

function ReadOnlyItemLines({ lines, total }: { lines: { id: string; ingredient_name: string; qty: number; unit: string; unit_cost: number; line_cost: number }[]; total: number }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <thead><tr><Th>Item / Raw Material</Th><Th>Quantity</Th><Th>Unit</Th><Th>Unit Cost</Th><Th>Total Cost</Th></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <Td className="font-medium">{l.ingredient_name}</Td><Td>{l.qty}</Td><Td>{l.unit}</Td>
              <Td>{kwd(l.unit_cost)}</Td><Td className="font-semibold">{kwd(l.line_cost)}</Td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><Td colSpan={4} className="text-right font-semibold">Total</Td><Td className="font-bold">{kwd(total)}</Td></tr></tfoot>
      </Table>
    </div>
  );
}

// -------------------------------------------------------- Transfer page ---
interface TransferForm { date: string; from: string; to: string; reason: string; notes: string; lines: ItemLineForm[] }

export function TransferPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const routeError = useRouteError();
  const { list: costCenters, mainStoreId } = useCostCenters();
  const { data: foodRaw } = useList<FoodInventoryItem>("food-inventory", "/kitchen/food-inventory");
  const items = sortByName(foodRaw);
  const { data: doc, isLoading } = useQuery<StockTransfer>({
    queryKey: ["transaction", "stock_transfer", id],
    queryFn: async () => (await api.get(`/kitchen/stock-transfers/${id}`)).data,
    enabled: !!id,
  });
  const [edits, setEdits] = useState<Partial<TransferForm> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const baseline: TransferForm = doc
    ? {
        date: doc.date, from: doc.from_cost_center_id, to: doc.to_cost_center_id ?? "", reason: doc.reason, notes: doc.notes ?? "",
        lines: doc.lines.map((l) => ({ key: l.id, food_inventory_id: l.food_inventory_id ?? "", qty: l.qty })),
      }
    : { date: todayIso(), from: mainStoreId, to: "", reason: "Transfer", notes: "", lines: [newItemLine()] };
  const form: TransferForm = { ...baseline, ...(edits ?? {}) };
  const editable = isNew || doc?.status === "Draft";
  const patch = (p: Partial<TransferForm>) => setEdits((e) => ({ ...(e ?? {}), ...p }));
  const available = useAvailable(form.from);
  const fromLabel = costCenters.find((c) => c.id === form.from)?.label;

  const payload = () => ({
    date: form.date, from_cost_center_id: form.from, to_cost_center_id: form.to, reason: form.reason || "Transfer",
    notes: form.notes || null, lines: form.lines.map((l) => ({ food_inventory_id: l.food_inventory_id, qty: l.qty })),
  });

  async function save(andSubmit: boolean) {
    setError(null);
    setBusy(true);
    let docId = id;
    try {
      if (isNew) docId = ((await api.post<StockTransfer>("/kitchen/stock-transfers", payload())).data).id;
      else await api.put(`/kitchen/stock-transfers/${id}`, payload());
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
      return;
    }
    qc.invalidateQueries({ queryKey: ["stock-transfers"] });
    qc.invalidateQueries({ queryKey: ["transaction", "stock_transfer", docId] });
    if (andSubmit) {
      try {
        await api.post(`/transactions/stock_transfer/${docId}/submit`, {});
        for (const k of ["approvals", "stock-balances", "stock-movements", "food-inventory"]) qc.invalidateQueries({ queryKey: [k] });
      } catch (err) {
        setBusy(false);
        setEdits(null);
        navigate(`/kitchen/transfers/${docId}`, { replace: true, state: { error: `Saved as Draft, but could not submit: ${errorText(err)}` } });
        return;
      }
    }
    setBusy(false);
    setEdits(null);
    navigate(andSubmit ? "/kitchen?tab=Raw%20Material%20Transfer" : `/kitchen/transfers/${docId}`, { replace: !isNew || andSubmit });
  }

  async function removeDraft() {
    if (!window.confirm("Delete this draft?")) return;
    await api.delete(`/kitchen/stock-transfers/${id}`);
    qc.invalidateQueries({ queryKey: ["stock-transfers"] });
    navigate("/kitchen?tab=Raw%20Material%20Transfer");
  }

  if (id && isLoading) return <Spinner />;
  if (id && !doc) return <EmptyState label="Transfer not found." />;

  return (
    <PageShell
      tab="Raw Material Transfer"
      title={isNew ? "New raw material transfer" : (doc ? `${doc.from_cost_center} to ${doc.to_cost_center ?? "-"}` : "Transfer")}
      subtitle={<span className="flex flex-wrap items-center gap-2">{doc ? <><span className="font-semibold">{doc.code}</span><StatusBadge status={doc.status} /></> : "Moves stock between locations; company stock is unchanged."}</span>}
    >
      <ErrorNote message={error ?? routeError} />
      <form className="mt-2 flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save(false); }}>
        <fieldset disabled={!editable} className="grid max-w-3xl grid-cols-1 gap-3 rounded-xl border p-3 sm:grid-cols-4" style={borderStyle}>
          <Field label="From cost center">
            <select required className={fieldCls} style={borderStyle} value={form.from} onChange={(e) => patch({ from: e.target.value })}>
              <option value="">- Select -</option>
              {costCenters.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="To cost center">
            <select required className={fieldCls} style={borderStyle} value={form.to} onChange={(e) => patch({ to: e.target.value })}>
              <option value="">- Select -</option>
              {costCenters.filter((c) => c.id !== form.from).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Date"><input type="date" required className={fieldCls} style={borderStyle} value={form.date} onChange={(e) => patch({ date: e.target.value })} /></Field>
          <Field label="Reason"><input required className={fieldCls} style={borderStyle} value={form.reason} onChange={(e) => patch({ reason: e.target.value })} /></Field>
          <Field label="Notes" className="sm:col-span-4"><input className={fieldCls} style={borderStyle} value={form.notes} onChange={(e) => patch({ notes: e.target.value })} /></Field>
        </fieldset>

        {editable ? (
          <ItemLinesEditor lines={form.lines} onChange={(lines) => patch({ lines })} items={items} available={available} locationLabel={fromLabel} />
        ) : doc && <ReadOnlyItemLines lines={doc.lines} total={doc.total} />}

        {editable ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex-1" />
            {!isNew && <Button type="button" variant="danger" onClick={removeDraft} disabled={busy}>Delete draft</Button>}
            <Button type="submit" variant="secondary" disabled={busy}>{isNew ? "Save draft" : "Save changes"}</Button>
            <Button type="button" disabled={busy} onClick={() => save(true)}>{busy ? "Working..." : "Save & submit"}</Button>
          </div>
        ) : doc && (
          <div className="flex flex-col gap-3">
            <WorkflowBar entityType="stock_transfer" id={doc.id} status={doc.status} queryKeys={["stock-transfers"]} />
            <div><Button type="button" variant="secondary" onClick={() => openPdf(`/kitchen/stock-transfers/${doc.id}/invoice-pdf`)}>View invoice</Button></div>
          </div>
        )}
      </form>

      {doc && (
        <div className="mt-6 max-w-3xl">
          <Stamps doc={doc} />
          <h3 className="mb-2 mt-4 text-[13px] font-semibold">History</h3>
          <HistoryPanel entityType="stock_transfer" id={doc.id} />
        </div>
      )}
    </PageShell>
  );
}

// ----------------------------------------------------------- Waste page ---
interface WasteForm { date: string; cost_center_id: string; reason: string; notes: string; lines: ItemLineForm[] }

export function WastePage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const routeError = useRouteError();
  const { list: costCenters, mainStoreId } = useCostCenters();
  const { data: reasonsRaw } = useList<WasteReason>("waste-reasons", "/kitchen/waste-reasons");
  const reasons = [...(reasonsRaw ?? [])].sort((a, b) => a.label.localeCompare(b.label));
  const { data: foodRaw } = useList<FoodInventoryItem>("food-inventory", "/kitchen/food-inventory");
  const items = sortByName(foodRaw);
  const { data: doc, isLoading } = useQuery<WasteLog>({
    queryKey: ["transaction", "waste_log", id],
    queryFn: async () => (await api.get(`/kitchen/waste-log/${id}`)).data,
    enabled: !!id,
  });
  const [edits, setEdits] = useState<Partial<WasteForm> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const baseline: WasteForm = doc
    ? {
        date: doc.date, cost_center_id: doc.cost_center_id, reason: doc.reason, notes: doc.notes ?? "",
        lines: doc.lines.map((l) => ({ key: l.id, food_inventory_id: l.food_inventory_id ?? "", qty: l.qty })),
      }
    : { date: todayIso(), cost_center_id: mainStoreId, reason: reasons[0]?.label ?? "", notes: "", lines: [newItemLine()] };
  const form: WasteForm = { ...baseline, ...(edits ?? {}) };
  const editable = isNew || doc?.status === "Draft";
  const patch = (p: Partial<WasteForm>) => setEdits((e) => ({ ...(e ?? {}), ...p }));
  const available = useAvailable(form.cost_center_id);
  const ccLabel = costCenters.find((c) => c.id === form.cost_center_id)?.label;

  const payload = () => ({
    date: form.date, cost_center_id: form.cost_center_id, reason: form.reason, notes: form.notes || null,
    lines: form.lines.map((l) => ({ food_inventory_id: l.food_inventory_id, qty: l.qty })),
  });

  async function save(andSubmit: boolean) {
    setError(null);
    setBusy(true);
    let docId = id;
    try {
      if (isNew) docId = ((await api.post<WasteLog>("/kitchen/waste-log", payload())).data).id;
      else await api.put(`/kitchen/waste-log/${id}`, payload());
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
      return;
    }
    qc.invalidateQueries({ queryKey: ["waste-log"] });
    qc.invalidateQueries({ queryKey: ["transaction", "waste_log", docId] });
    if (andSubmit) {
      try {
        await api.post(`/transactions/waste_log/${docId}/submit`, {});
        for (const k of ["approvals", "stock-balances", "stock-movements", "food-inventory"]) qc.invalidateQueries({ queryKey: [k] });
      } catch (err) {
        setBusy(false);
        setEdits(null);
        navigate(`/kitchen/waste/${docId}`, { replace: true, state: { error: `Saved as Draft, but could not submit: ${errorText(err)}` } });
        return;
      }
    }
    setBusy(false);
    setEdits(null);
    navigate(andSubmit ? "/kitchen?tab=Waste%20Log" : `/kitchen/waste/${docId}`, { replace: !isNew || andSubmit });
  }

  async function removeDraft() {
    if (!window.confirm("Delete this draft?")) return;
    await api.delete(`/kitchen/waste-log/${id}`);
    qc.invalidateQueries({ queryKey: ["waste-log"] });
    navigate("/kitchen?tab=Waste%20Log");
  }

  if (id && isLoading) return <Spinner />;
  if (id && !doc) return <EmptyState label="Waste log not found." />;

  return (
    <PageShell
      tab="Waste Log"
      title={isNew ? "New waste log" : (doc?.cost_center ?? "Waste log")}
      subtitle={<span className="flex flex-wrap items-center gap-2">{doc ? <><span className="font-semibold">{doc.code}</span><StatusBadge status={doc.status} /></> : "Stock is deducted from the selected cost center when submitted."}</span>}
    >
      <ErrorNote message={error ?? routeError} />
      <form className="mt-2 flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save(false); }}>
        <fieldset disabled={!editable} className="grid max-w-3xl grid-cols-1 gap-3 rounded-xl border p-3 sm:grid-cols-4" style={borderStyle}>
          <Field label="Cost center (stock location)" className="sm:col-span-2">
            <select required className={fieldCls} style={borderStyle} value={form.cost_center_id} onChange={(e) => patch({ cost_center_id: e.target.value })}>
              <option value="">- Select -</option>
              {costCenters.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Date"><input type="date" required className={fieldCls} style={borderStyle} value={form.date} onChange={(e) => patch({ date: e.target.value })} /></Field>
          <Field label="Reason">
            <select required className={fieldCls} style={borderStyle} value={form.reason} onChange={(e) => patch({ reason: e.target.value })}>
              {form.reason && !reasons.some((r) => r.label === form.reason) && <option value={form.reason}>{form.reason}</option>}
              <option value="">- Select -</option>
              {reasons.map((r) => <option key={r.id} value={r.label}>{r.label}</option>)}
            </select>
          </Field>
          <Field label="Notes" className="sm:col-span-4"><input className={fieldCls} style={borderStyle} value={form.notes} onChange={(e) => patch({ notes: e.target.value })} /></Field>
        </fieldset>

        {editable ? (
          <ItemLinesEditor lines={form.lines} onChange={(lines) => patch({ lines })} items={items} available={available} locationLabel={ccLabel} />
        ) : doc && <ReadOnlyItemLines lines={doc.lines} total={doc.total} />}

        {editable ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex-1" />
            {!isNew && <Button type="button" variant="danger" onClick={removeDraft} disabled={busy}>Delete draft</Button>}
            <Button type="submit" variant="secondary" disabled={busy}>{isNew ? "Save draft" : "Save changes"}</Button>
            <Button type="button" disabled={busy} onClick={() => save(true)}>{busy ? "Working..." : "Save & submit"}</Button>
          </div>
        ) : doc && <WorkflowBar entityType="waste_log" id={doc.id} status={doc.status} queryKeys={["waste-log"]} />}
      </form>

      {doc && (
        <div className="mt-6 max-w-3xl">
          <Stamps doc={doc} />
          <h3 className="mb-2 mt-4 text-[13px] font-semibold">History</h3>
          <HistoryPanel entityType="waste_log" id={doc.id} />
        </div>
      )}
    </PageShell>
  );
}
