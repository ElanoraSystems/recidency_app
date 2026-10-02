import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useList, useUpdate } from "../api/hooks";
import { createDraftRequest } from "./Purchasing";
import { BalancesTab, CostOfSalesTab, LocationBreakdown, MovementsTab } from "../components/StockLedger";
import { Badge, Button, EmptyState, Modal, PageHeader, Spinner, StatTile, Table, Td, Th } from "../components/ui";
import { fmtDate } from "../lib/date";
import type { CostCenter, FoodInventoryItem, InventoryItem, ItemMasterEntry, ItemMasterTransaction, StockCountDetail, StockCountSummary, Supplier, UnitOfMeasureEntry } from "../types";

// Unified view over general (Inventory) and food (FoodInventory) stock rows
// for the Stock tab — the two tables have different shapes (stock/qty,
// last_price+avg_price/cost) that get normalized here for one shared table
// and detail view.
interface StockRow {
  id: string;
  kind: "general" | "food";
  name: string;
  category: string;
  sku: string | null;
  location: string | null;
  supplier_id: string | null;
  qty: number;
  unit: string;
  min: number;
  max: number;
  lastPrice: number | null;
  avgPrice: number;
  expiry: string | null;
  batch: string | null;
}

function toStockRows(stock?: InventoryItem[], foodInventory?: FoodInventoryItem[]): StockRow[] {
  const general: StockRow[] = (stock ?? []).map((i) => ({
    id: i.id, kind: "general", name: i.name, category: i.category, sku: i.sku, location: i.location,
    supplier_id: i.supplier_id, qty: i.stock, unit: i.unit, min: i.min, max: i.max,
    lastPrice: i.last_price, avgPrice: i.avg_price, expiry: i.expiry, batch: i.batch,
  }));
  const food: StockRow[] = (foodInventory ?? []).map((f) => ({
    id: f.id, kind: "food", name: f.name, category: f.category, sku: null, location: f.location,
    supplier_id: f.supplier_id, qty: f.qty, unit: f.unit, min: f.min, max: f.max,
    lastPrice: null, avgPrice: f.cost, expiry: f.expiry, batch: f.batch,
  }));
  return [...general, ...food];
}

const TABS = ["Stock", "Balances", "Movements", "Item Master", "Stock Count", "Cost of Sales"] as const;
const CATEGORIES = [
  "Food", "Dairy", "Meat", "Seafood", "Vegetables", "Frozen", "Bakery", "Dry Goods",
  "Beverages", "Cleaning Chemicals", "Toiletries", "Linen", "Kitchenware",
  "Crockery", "Glassware", "Maintenance Materials", "Electrical Items", "Plumbing Items",
  "Garden Supplies", "Pool Supplies", "Stationery", "Other",
];

export function InventoryPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t === params.get("tab")) ?? "Stock";
  const setTab = (t: (typeof TABS)[number]) => setParams({ tab: t }, { replace: true });
  const [modal, setModal] = useState(false);
  const { data: stock } = useList<InventoryItem>("inventory", "/inventory");
  const { data: foodInventory } = useList<FoodInventoryItem>("food-inventory", "/kitchen/food-inventory");
  const { data: itemMaster } = useList<ItemMasterEntry>("item-master", "/item-master");

  const lowCount =
    (stock?.filter((i) => i.stock < i.min).length ?? 0) + (foodInventory?.filter((f) => f.qty < f.min).length ?? 0);
  const totalValue =
    (stock?.reduce((s, i) => s + i.stock * i.avg_price, 0) ?? 0) +
    (foodInventory?.reduce((s, f) => s + f.qty * f.cost, 0) ?? 0);
  const belowReorder = (() => {
    if (!itemMaster) return 0;
    return itemMaster.filter((im) => {
      if (!im.active) return false;
      const row = im.stock_type === "food" ? foodInventory?.find((f) => f.id === im.stock_id) : stock?.find((i) => i.id === im.stock_id);
      return !!row && row.max > 0;
    }).length;
  })();

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Stock levels and the central item catalog for the residence."
        action={tab === "Item Master" ? <Button onClick={() => setModal(true)}>+ New Item</Button> : undefined}
      />

      {tab !== "Cost of Sales" && <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {tab === "Stock" || tab === "Balances" || tab === "Movements" ? (
          <>
            <StatTile label="Total Items" icon="inventory" value={(stock?.length ?? 0) + (foodInventory?.length ?? 0)} />
            <StatTile label="Below Minimum" icon="alertTriangle" value={lowCount} progressColor="var(--status-critical)" />
            <StatTile label="Estimated Value" icon="expenses" value={`KWD ${totalValue.toFixed(0)}`} />
          </>
        ) : tab === "Item Master" ? (
          <>
            <StatTile label="Master Items" icon="documents" value={itemMaster?.length ?? 0} />
            <StatTile label="At/Below Reorder" icon="alertTriangle" value={belowReorder} progressColor="var(--status-warning)" />
            <StatTile
              label="Food / General"
              icon="kitchen"
              value={`${itemMaster?.filter((i) => i.stock_type === "food").length ?? 0} / ${itemMaster?.filter((i) => i.stock_type === "general").length ?? 0}`}
            />
          </>
        ) : (
          <StockCountStats />
        )}
      </div>}

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

      {tab === "Stock" ? (
        <StockTab stock={stock} foodInventory={foodInventory} />
      ) : tab === "Balances" ? (
        <BalancesTab />
      ) : tab === "Movements" ? (
        <MovementsTab />
      ) : tab === "Cost of Sales" ? (
        <CostOfSalesTab />
      ) : tab === "Item Master" ? (
        <ItemMasterTab items={itemMaster} stock={stock} foodInventory={foodInventory} />
      ) : (
        <StockCountTab />
      )}

      {modal && tab === "Item Master" && <NewItemMasterModal onClose={() => setModal(false)} />}
    </div>
  );
}

function StockTab({ stock, foodInventory }: { stock?: InventoryItem[]; foodInventory?: FoodInventoryItem[] }) {
  const [detail, setDetail] = useState<StockRow | null>(null);
  if (!stock || !foodInventory) return <Spinner />;
  const rows = toStockRows(stock, foodInventory);
  if (rows.length === 0) return <EmptyState label="No inventory items yet. Add one from the Item Master tab — stock appears here automatically." />;
  return (
    <div>
      <p className="mb-3 text-[13px]" style={{ color: "var(--ink-500)" }}>
        Read-only stock levels. To add a new item, use the Item Master tab — it creates the catalog entry and the
        stock record together.
      </p>
      <Table>
        <thead><tr><Th>Item</Th><Th>Category</Th><Th>Location</Th><Th>Stock</Th><Th>Min / Max</Th><Th>Status</Th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const low = r.qty < r.min;
            return (
              <tr key={r.id} className="cursor-pointer" onClick={() => setDetail(r)}>
                <Td className="font-medium">{r.name}<div className="text-xs" style={{ color: "var(--ink-400)" }}>{r.sku ?? (r.kind === "food" ? "Food" : "")}</div></Td>
                <Td>{r.category}</Td>
                <Td>{r.location}</Td>
                <Td>{r.qty} {r.unit}</Td>
                <Td>{r.min} / {r.max}</Td>
                <Td><Badge tone={low ? "critical" : "good"}>{low ? "Low Stock" : "In Stock"}</Badge></Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      {detail && <StockDetailModal item={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function StockDetailModal({ item, onClose }: { item: StockRow; onClose: () => void }) {
  const { data: suppliers } = useList<Supplier>("suppliers", "/suppliers");
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const low = item.qty < item.min;
  const supplierName = suppliers?.find((s) => s.id === item.supplier_id)?.name ?? "—";

  async function onCreatePR() {
    setCreating(true);
    try {
      const id = await createDraftRequest([{
        item_master_id: null, item_name: item.name, qty: item.max - item.qty, unit: item.unit,
        category: item.category, est_unit_price: item.avgPrice,
      }]);
      onClose();
      navigate(`/purchasing/requests/${id}/edit`);
    } finally {
      setCreating(false);
    }
  }

  const pricingRows: [string, string][] = item.lastPrice !== null
    ? [["Last purchase price", `KWD ${item.lastPrice.toFixed(3)}`], ["Average price", `KWD ${item.avgPrice.toFixed(3)}`], ["Est. value", `KWD ${(item.qty * item.avgPrice).toFixed(2)}`]]
    : [["Average price", `KWD ${item.avgPrice.toFixed(3)}`], ["Est. value", `KWD ${(item.qty * item.avgPrice).toFixed(2)}`]];

  return (
    <Modal title={item.name} onClose={onClose}>
      <div className="flex flex-col gap-3 text-[13px]">
        <div className="flex items-center gap-2">
          <Badge>{item.category}</Badge>
          <Badge tone={low ? "critical" : "good"}>{low ? "Low Stock" : "In Stock"}</Badge>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ProfileBlock title="Stock" rows={[["SKU", item.sku ?? "—"], ["Current stock", `${item.qty} ${item.unit}`], ["Min / Max", `${item.min} / ${item.max} ${item.unit}`]]} />
          <ProfileBlock title="Sourcing" rows={[["Location", item.location ?? "—"], ["Supplier", supplierName], ["Batch", item.batch ?? "—"]]} />
          <ProfileBlock title="Pricing" rows={pricingRows} />
          <ProfileBlock title="Other" rows={[["Expiry", item.expiry ?? "N/A"]]} />
        </div>
        <LocationBreakdown stockId={item.id} />
        {low && (
          <Button onClick={onCreatePR} disabled={creating}>
            {creating ? "Creating..." : "Create Purchase Request"}
          </Button>
        )}
      </div>
    </Modal>
  );
}

function ProfileBlock({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>{title}</div>
      <div className="flex flex-col gap-1">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <span style={{ color: "var(--ink-500)" }}>{label}</span>
            <span className="text-right font-semibold">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ItemMasterTab({
  items, stock, foodInventory,
}: {
  items?: ItemMasterEntry[]; stock?: InventoryItem[]; foodInventory?: FoodInventoryItem[];
}) {
  const [editing, setEditing] = useState<ItemMasterEntry | null>(null);
  if (!items) return <Spinner />;
  if (items.length === 0) return <EmptyState label="No item master entries yet." />;

  function stockRowFor(im: ItemMasterEntry): StockRow | undefined {
    return toStockRows(stock, foodInventory).find((r) => r.id === im.stock_id);
  }

  return (
    <div>
      <p className="mb-3 text-[13px]" style={{ color: "var(--ink-500)" }}>
        The central catalog used everywhere an item is picked — recipes, purchase requests, purchase orders and goods receipts.
        Click a row to edit it. Par levels (min/max) live on the Stock tab — this is the catalog entry.
      </p>
      <Table>
        <thead><tr><Th>Item</Th><Th>Code</Th><Th>Category</Th><Th>UoM</Th><Th>Last Price</Th><Th>Avg Price</Th></tr></thead>
        <tbody>
          {items.map((im) => (
            <tr key={im.id} className="cursor-pointer" onClick={() => setEditing(im)}>
              <Td className="font-medium">{im.name}<div className="text-xs" style={{ color: "var(--ink-400)" }}>{im.stock_type === "food" ? "Food" : "General"}</div></Td>
              <Td>{im.code}</Td>
              <Td>{im.category}</Td>
              <Td>{im.uom}</Td>
              <Td>KWD {im.last_price.toFixed(3)}</Td>
              <Td>KWD {im.avg_price.toFixed(3)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {editing && <EditItemMasterModal item={editing} stockRow={stockRowFor(editing)} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EditItemMasterModal({
  item, stockRow, onClose,
}: {
  item: ItemMasterEntry; stockRow?: StockRow; onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: uomsRaw } = useList<UnitOfMeasureEntry>("units-of-measure", "/units-of-measure");
  const uoms = [...(uomsRaw ?? [])].sort((a, b) => a.label.localeCompare(b.label));
  const { data: suppliers } = useList<Supplier>("suppliers", "/suppliers");
  const update = useUpdate<ItemMasterEntry>("item-master", "/item-master");
  const [form, setForm] = useState({
    name: item.name, uom: item.uom, last_price: item.last_price,
    min: stockRow?.min ?? 0, max: stockRow?.max ?? 0, category: item.category,
    supplier_id: item.preferred_supplier_id ?? "", active: item.active,
  });

  // Category and par levels (min/max) live on Stock now, not Item Master —
  // this modal still edits them together since they're presented as one
  // form, it just PATCHes two different endpoints depending on stock_type.
  const updateStock = useMutation({
    mutationFn: async () => {
      const endpoint = item.stock_type === "food" ? `/kitchen/food-inventory/${item.stock_id}` : `/inventory/${item.stock_id}`;
      return api.patch(endpoint, { min: form.min, max: form.max, category: form.category });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [item.stock_type === "food" ? "food-inventory" : "inventory"] }),
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await Promise.all([
      update.mutateAsync({
        id: item.id,
        payload: {
          name: form.name, uom: form.uom, last_price: form.last_price,
          preferred_supplier_id: form.supplier_id || null, active: form.active,
        },
      }),
      updateStock.mutateAsync(),
    ]);
    onClose();
  }

  const { data: transactions } = useList<ItemMasterTransaction>(
    `item-master-transactions-${item.id}`, `/item-master/${item.id}/transactions`
  );

  return (
    <Modal title={`Edit ${item.name}`} onClose={onClose}>
      <p className="mb-3 text-[12px]" style={{ color: "var(--ink-400)" }}>
        Created {new Date(item.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
        {item.created_by_name ? ` by ${item.created_by_name}` : ""} · code {item.code}
      </p>
      <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3">
        <Field label="Item name" required value={form.name} onChange={(v) => setForm((s) => ({ ...s, name: v }))} />
        <label className="flex flex-col gap-1 text-[13px] font-medium">Category
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.category} onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Unit of measure
          <select required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.uom} onChange={(e) => setForm((s) => ({ ...s, uom: e.target.value }))}>
            {uoms.map((u) => <option key={u.id} value={u.label}>{u.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Supplier
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.supplier_id} onChange={(e) => setForm((s) => ({ ...s, supplier_id: e.target.value }))}>
            <option value="">—</option>
            {suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <Field label="Last price (KWD)" type="number" value={form.last_price} onChange={(v) => setForm((s) => ({ ...s, last_price: Number(v) }))} />
        <Field label="Minimum stock (par)" type="number" value={form.min} onChange={(v) => setForm((s) => ({ ...s, min: Number(v) }))} />
        <Field label="Maximum stock (par)" type="number" value={form.max} onChange={(v) => setForm((s) => ({ ...s, max: Number(v) }))} />
        <label className="flex items-center gap-2 text-[13px] font-medium">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm((s) => ({ ...s, active: e.target.checked }))} />
          Active
        </label>
        <div className="col-span-full">
          <Button type="submit" disabled={update.isPending || updateStock.isPending}>
            {update.isPending || updateStock.isPending ? "Saving..." : "Save changes"}
          </Button>
        </div>
      </form>

      <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <h4 className="mb-2 text-[13px] font-semibold">Related transactions</h4>
        {!transactions || transactions.length === 0 ? (
          <p className="text-[12px]" style={{ color: "var(--ink-400)" }}>No purchase requests, orders or receipts reference this item yet.</p>
        ) : (
          <Table>
            <thead><tr><Th>Type</Th><Th>Code</Th><Th>Date</Th><Th>Status</Th><Th>Qty</Th><Th>Amount</Th></tr></thead>
            <tbody>
              {transactions.map((t, i) => (
                <tr key={`${t.doc_type}-${t.code}-${i}`}>
                  <Td>{t.doc_type}</Td>
                  <Td className="font-medium">{t.code}</Td>
                  <Td>{fmtDate(t.date)}</Td>
                  <Td>{t.status}</Td>
                  <Td>{t.qty} {t.unit}</Td>
                  <Td>KWD {t.amount.toFixed(2)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </Modal>
  );
}

function NewItemMasterModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: uomsRaw } = useList<UnitOfMeasureEntry>("units-of-measure", "/units-of-measure");
  const uoms = [...(uomsRaw ?? [])].sort((a, b) => a.label.localeCompare(b.label));
  const { data: suppliers } = useList<Supplier>("suppliers", "/suppliers");
  const [form, setForm] = useState({
    name: "", category: CATEGORIES[0], uom: "", last_price: 0, min: 5, max: 10,
    stock_type: "general" as "general" | "food", supplier_id: "",
  });

  useEffect(() => {
    if (uoms.length > 0 && !form.uom) setForm((s) => ({ ...s, uom: uoms[0].label }));
  }, [uoms, form.uom]);

  // Item master rows point at a real stock record via stock_id, so creating
  // one here also creates its backing food_inventory / inventory row first —
  // otherwise a later GRN receipt would have nothing to increment. `code`
  // is never sent — the backend always generates it (see purchasing.py's
  // hand-written POST /item-master). Par levels (min/max) live on the stock
  // record, not item_master — see Stock tab.
  const createLinked = useMutation({
    mutationFn: async () => {
      const stockPayload =
        form.stock_type === "food"
          ? { name: form.name, category: form.category, qty: 0, unit: form.uom, cost: form.last_price, supplier_id: form.supplier_id || null, min: form.min, max: form.max }
          : {
              name: form.name, category: form.category, sku: `INV-${Date.now().toString(36).toUpperCase()}`,
              unit: form.uom, stock: 0, min: form.min, max: form.max,
              last_price: form.last_price, avg_price: form.last_price, supplier_id: form.supplier_id || null,
            };
      const stockEndpoint = form.stock_type === "food" ? "/kitchen/food-inventory" : "/inventory";
      const stock = (await api.post(stockEndpoint, stockPayload)).data as FoodInventoryItem | InventoryItem;
      return api.post("/item-master", {
        name: form.name, uom: form.uom, last_price: form.last_price,
        preferred_supplier_id: form.supplier_id || null, active: true,
        stock_type: form.stock_type, stock_id: stock.id,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["item-master"] });
      qc.invalidateQueries({ queryKey: [form.stock_type === "food" ? "food-inventory" : "inventory"] });
    },
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await createLinked.mutateAsync();
    onClose();
  }

  return (
    <Modal title="New item master entry" onClose={onClose}>
      <p className="mb-3 text-[12px]" style={{ color: "var(--ink-400)" }}>
        Creates both the catalog entry and its stock record together — the item code is generated automatically.
      </p>
      <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3">
        <Field label="Item name" required value={form.name} onChange={(v) => setForm((s) => ({ ...s, name: v }))} />
        <label className="flex flex-col gap-1 text-[13px] font-medium">Category
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.category} onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Unit of measure
          <select required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.uom} onChange={(e) => setForm((s) => ({ ...s, uom: e.target.value }))}>
            {uoms.map((u) => <option key={u.id} value={u.label}>{u.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Stock type
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.stock_type} onChange={(e) => setForm((s) => ({ ...s, stock_type: e.target.value as "general" | "food" }))}>
            <option value="general">General</option>
            <option value="food">Food</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Supplier
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.supplier_id} onChange={(e) => setForm((s) => ({ ...s, supplier_id: e.target.value }))}>
            <option value="">—</option>
            {suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <Field label="Last price (KWD)" type="number" value={form.last_price} onChange={(v) => setForm((s) => ({ ...s, last_price: Number(v) }))} />
        <Field label="Minimum stock (par)" type="number" value={form.min} onChange={(v) => setForm((s) => ({ ...s, min: Number(v) }))} />
        <Field label="Maximum stock (par)" type="number" value={form.max} onChange={(v) => setForm((s) => ({ ...s, max: Number(v) }))} />
        <div className="col-span-full">
          <Button type="submit" disabled={createLinked.isPending}>{createLinked.isPending ? "Saving..." : "Save item"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function Field({
  label, value, onChange, type = "text", required = false,
}: {
  label: string; value: string | number; onChange: (v: string) => void; type?: string; required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-[13px] font-medium">
      {label}
      <input
        type={type}
        required={required}
        className="rounded-lg border px-3 py-2 text-sm"
        style={{ borderColor: "var(--border-strong)" }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function StockCountStats() {
  const { data } = useList<StockCountSummary>("stock-counts", "/stock-counts");
  const drafts = data?.filter((c) => c.status === "Draft").length ?? 0;
  const lastSubmitted = data?.find((c) => c.status === "Submitted");
  return (
    <>
      <StatTile label="Total Counts" icon="documents" value={data?.length ?? 0} />
      <StatTile label="Open Drafts" icon="alertTriangle" value={drafts} progressColor="var(--status-warning)" />
      <StatTile
        label="Last Variance"
        icon="expenses"
        value={lastSubmitted ? `KWD ${lastSubmitted.variance_value.toFixed(2)}` : "—"}
        sub={lastSubmitted?.date}
      />
    </>
  );
}

function StockCountTab() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading } = useList<StockCountSummary>("stock-counts", "/stock-counts");
  const { data: costCenters } = useList<CostCenter>("cost-centers", "/kitchen/cost-centers");
  const [costCenterId, setCostCenterId] = useState("");
  const mainStoreId = costCenters?.find((c) => c.label === "Main Store")?.id ?? "";
  const create = useMutation({
    mutationFn: async () =>
      (await api.post("/stock-counts", { cost_center_id: costCenterId || mainStoreId || null })).data as StockCountDetail,
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["stock-counts"] });
      navigate(`/inventory/counts/${count.id}`);
    },
  });

  if (isLoading) return <Spinner />;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[13px]" style={{ color: "var(--ink-500)" }}>
          A physical count reconciles book stock against what's actually on the shelf — submitting posts the
          variance onto real stock.
        </p>
        <div className="flex items-center gap-2">
          <select
            value={costCenterId || mainStoreId} onChange={(e) => setCostCenterId(e.target.value)}
            className="rounded-lg border px-2.5 py-1.5 text-sm" style={{ borderColor: "var(--border-strong)" }}
          >
            {costCenters?.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? "Starting..." : "+ New Count"}
          </Button>
        </div>
      </div>
      {!data || data.length === 0 ? (
        <EmptyState label="No stock counts yet." />
      ) : (
        <Table>
          <thead><tr><Th>Date</Th><Th>Cost center</Th><Th>Status</Th><Th>Items</Th><Th>Variance Value</Th><Th>{" "}</Th></tr></thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.id} className="cursor-pointer" onClick={() => navigate(`/inventory/counts/${c.id}`)}>
                <Td>{c.date}</Td>
                <Td>{c.cost_center ?? "—"}</Td>
                <Td><Badge tone={c.status === "Draft" ? "warning" : "good"}>{c.status}</Badge></Td>
                <Td>{c.item_count}</Td>
                <Td style={c.variance_value < 0 ? { color: "var(--status-critical)", fontWeight: 600 } : undefined}>
                  KWD {c.variance_value.toFixed(2)}
                </Td>
                <Td>
                  <Link
                    to={`/inventory/counts/${c.id}`}
                    className="text-xs font-semibold"
                    style={{ color: "var(--brass-600)" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {c.status === "Draft" ? "Continue" : "View"}
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

export function StockCountEntryPage() {
  const { countId } = useParams<{ countId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: count, isLoading } = useQuery<StockCountDetail>({
    queryKey: ["stock-count", countId],
    queryFn: async () => (await api.get(`/stock-counts/${countId}`)).data,
    enabled: !!countId,
  });
  const [counted, setCounted] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!count || Object.keys(counted).length > 0) return;
    setCounted(Object.fromEntries(count.lines.map((l) => [l.id, l.counted_qty != null ? String(l.counted_qty) : ""])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  const saveLine = useMutation({
    mutationFn: async ({ lineId, value }: { lineId: string; value: string }) =>
      api.patch(`/stock-counts/${countId}/lines/${lineId}`, { counted_qty: value === "" ? null : Number(value) }),
  });

  const submit = useMutation({
    mutationFn: async () => api.post(`/stock-counts/${countId}/submit`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock-counts"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["food-inventory"] });
      navigate("/inventory");
    },
  });

  if (isLoading || !count) return <Spinner />;

  const varianceRows = count.lines
    .map((l) => ({ ...l, entered: counted[l.id] !== "" && counted[l.id] !== undefined ? Number(counted[l.id]) : null }))
    .filter((l) => l.entered !== null);
  const totalVarianceValue = varianceRows.reduce((s, l) => s + (l.entered! - l.book_qty) * l.unit_cost, 0);

  return (
    <div>
      <Link to="/inventory" className="mb-3 inline-block text-[13px] font-semibold" style={{ color: "var(--brass-600)" }}>← Back to Inventory</Link>
      <PageHeader
        title={`Stock count — ${count.cost_center ?? "Main Store"} — ${count.date}`}
        subtitle={count.status === "Submitted" ? "Submitted — read only." : "Enter the counted quantity for each item. Leave blank to skip an item."}
      />
      <Table>
        <thead><tr><Th>Item</Th><Th>Book Qty</Th><Th>Counted Qty</Th><Th>Variance</Th></tr></thead>
        <tbody>
          {count.lines.map((l) => {
            const value = counted[l.id] ?? "";
            const entered = value !== "" ? Number(value) : null;
            const variance = entered !== null ? entered - l.book_qty : null;
            return (
              <tr key={l.id}>
                <Td className="font-medium">{l.item_name}</Td>
                <Td>{l.book_qty} {l.uom}</Td>
                <Td>
                  <input
                    type="number" step="any"
                    className="w-24 rounded-lg border px-2 py-1 text-right text-sm"
                    style={{ borderColor: "var(--border-strong)" }}
                    value={value}
                    disabled={count.status !== "Draft"}
                    onChange={(e) => setCounted((s) => ({ ...s, [l.id]: e.target.value }))}
                    onBlur={(e) => count.status === "Draft" && saveLine.mutate({ lineId: l.id, value: e.target.value })}
                  />
                </Td>
                <Td>
                  {variance !== null ? (
                    <Badge tone={variance < 0 ? "critical" : variance > 0 ? "warning" : "good"}>
                      {variance > 0 ? "+" : ""}{variance} {l.uom}
                    </Badge>
                  ) : "—"}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      {count.status === "Draft" && (
        <div className="mt-4 flex items-center justify-between rounded-xl p-3" style={{ background: "var(--surface-sunken)" }}>
          <span className="text-[13px]">
            Variance value so far: <span className="font-semibold">KWD {totalVarianceValue.toFixed(2)}</span> across {varianceRows.length} counted item(s)
          </span>
          <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
            {submit.isPending ? "Submitting..." : "Submit Count"}
          </Button>
        </div>
      )}
    </div>
  );
}
