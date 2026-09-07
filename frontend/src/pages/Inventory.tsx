import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useCreate, useList } from "../api/hooks";
import { Badge, Button, EmptyState, Modal, PageHeader, Spinner, StatTile, Table, Td, Th } from "../components/ui";
import type { FoodInventoryItem, InventoryItem, ItemMasterEntry, PurchaseRequest, Supplier, UnitOfMeasureEntry } from "../types";

const TABS = ["Stock", "Item Master"] as const;
const CATEGORIES = [
  "Food", "Beverages", "Cleaning Chemicals", "Toiletries", "Linen", "Kitchenware",
  "Crockery", "Glassware", "Maintenance Materials", "Electrical Items", "Plumbing Items",
  "Garden Supplies", "Pool Supplies", "Stationery", "Other",
];

export function InventoryPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Stock");
  const [modal, setModal] = useState(false);
  const { data: stock } = useList<InventoryItem>("inventory", "/inventory");
  const { data: itemMaster } = useList<ItemMasterEntry>("item-master", "/item-master");

  const lowCount = stock?.filter((i) => i.stock < i.min).length ?? 0;
  const totalValue = stock?.reduce((s, i) => s + i.stock * i.avg_price, 0) ?? 0;
  const belowReorder = itemMaster?.filter((im) => im.active && im.reorder_level > 0).length ?? 0;

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Stock levels and the central item catalog for the residence."
        action={tab === "Item Master" ? <Button onClick={() => setModal(true)}>+ New Item</Button> : undefined}
      />

      <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {tab === "Stock" ? (
          <>
            <StatTile label="Total Items" icon="inventory" value={stock?.length ?? 0} />
            <StatTile label="Below Minimum" icon="alertTriangle" value={lowCount} progressColor="var(--status-critical)" />
            <StatTile label="Estimated Value" icon="expenses" value={`KWD ${totalValue.toFixed(0)}`} />
          </>
        ) : (
          <>
            <StatTile label="Master Items" icon="documents" value={itemMaster?.length ?? 0} />
            <StatTile label="At/Below Reorder" icon="alertTriangle" value={belowReorder} progressColor="var(--status-warning)" />
            <StatTile
              label="Food / General"
              icon="kitchen"
              value={`${itemMaster?.filter((i) => i.stock_type === "food").length ?? 0} / ${itemMaster?.filter((i) => i.stock_type === "general").length ?? 0}`}
            />
          </>
        )}
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

      {tab === "Stock" ? <StockTab stock={stock} /> : <ItemMasterTab items={itemMaster} />}

      {modal && tab === "Item Master" && <NewItemMasterModal onClose={() => setModal(false)} />}
    </div>
  );
}

function StockTab({ stock }: { stock?: InventoryItem[] }) {
  const [detail, setDetail] = useState<InventoryItem | null>(null);
  if (!stock) return <Spinner />;
  if (stock.length === 0) return <EmptyState label="No inventory items yet. Add one from the Item Master tab — stock appears here automatically." />;
  return (
    <div>
      <p className="mb-3 text-[13px]" style={{ color: "var(--ink-500)" }}>
        Read-only stock levels. To add a new item, use the Item Master tab — it creates the catalog entry and the
        stock record together.
      </p>
      <Table>
        <thead><tr><Th>Item</Th><Th>Category</Th><Th>Location</Th><Th>Stock</Th><Th>Min / Max</Th><Th>Status</Th></tr></thead>
        <tbody>
          {stock.map((i) => {
            const low = i.stock < i.min;
            return (
              <tr key={i.id} className="cursor-pointer" onClick={() => setDetail(i)}>
                <Td className="font-medium">{i.name}<div className="text-xs" style={{ color: "var(--ink-400)" }}>{i.sku}</div></Td>
                <Td>{i.category}</Td>
                <Td>{i.location}</Td>
                <Td>{i.stock} {i.unit}</Td>
                <Td>{i.min} / {i.max}</Td>
                <Td><Badge tone={low ? "critical" : "good"}>{low ? "Low Stock" : "In Stock"}</Badge></Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      {detail && <InventoryDetailModal item={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function InventoryDetailModal({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const { data: suppliers } = useList<Supplier>("suppliers", "/suppliers");
  const createPR = useCreate<PurchaseRequest>("purchase-requests", "/purchasing/purchase-requests");
  const low = item.stock < item.min;
  const supplierName = suppliers?.find((s) => s.id === item.supplier_id)?.name ?? "—";

  async function onCreatePR() {
    await createPR.mutateAsync({
      item: item.name, qty: item.max - item.stock, unit: item.unit, category: item.category,
      urgency: "High", est_cost: Math.round((item.max - item.stock) * item.last_price * 100) / 100,
    } as never);
    onClose();
  }

  return (
    <Modal title={item.name} onClose={onClose}>
      <div className="flex flex-col gap-3 text-[13px]">
        <div className="flex items-center gap-2">
          <Badge>{item.category}</Badge>
          <Badge tone={low ? "critical" : "good"}>{low ? "Low Stock" : "In Stock"}</Badge>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ProfileBlock title="Stock" rows={[["SKU", item.sku], ["Current stock", `${item.stock} ${item.unit}`], ["Min / Max", `${item.min} / ${item.max} ${item.unit}`]]} />
          <ProfileBlock title="Sourcing" rows={[["Location", item.location ?? "—"], ["Supplier", supplierName], ["Batch", item.batch ?? "—"]]} />
          <ProfileBlock title="Pricing" rows={[["Last purchase price", `KWD ${item.last_price.toFixed(3)}`], ["Average price", `KWD ${item.avg_price.toFixed(3)}`], ["Est. value", `KWD ${(item.stock * item.avg_price).toFixed(2)}`]]} />
          <ProfileBlock title="Other" rows={[["Expiry", item.expiry ?? "N/A"]]} />
        </div>
        {low && (
          <Button onClick={onCreatePR} disabled={createPR.isPending}>
            {createPR.isPending ? "Creating..." : "Create Purchase Request"}
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

function ItemMasterTab({ items }: { items?: ItemMasterEntry[] }) {
  if (!items) return <Spinner />;
  if (items.length === 0) return <EmptyState label="No item master entries yet." />;
  return (
    <div>
      <p className="mb-3 text-[13px]" style={{ color: "var(--ink-500)" }}>
        The central catalog used everywhere an item is picked — recipes, purchase requests, purchase orders and goods receipts.
      </p>
      <Table>
        <thead><tr><Th>Item</Th><Th>Code</Th><Th>UoM</Th><Th>Last Price</Th><Th>Min / Reorder</Th><Th>Status</Th></tr></thead>
        <tbody>
          {items.map((im) => (
            <tr key={im.id}>
              <Td className="font-medium">{im.name}<div className="text-xs" style={{ color: "var(--ink-400)" }}>{im.stock_type === "food" ? "Food" : "General"}</div></Td>
              <Td>{im.code}</Td>
              <Td>{im.uom}</Td>
              <Td>KWD {im.last_price.toFixed(3)}</Td>
              <Td>{im.min_stock} / {im.reorder_level}</Td>
              <Td><Badge tone={!im.active ? "neutral" : "good"}>{!im.active ? "Inactive" : "OK"}</Badge></Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function NewItemMasterModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: uomsRaw } = useList<UnitOfMeasureEntry>("units-of-measure", "/units-of-measure");
  const uoms = [...(uomsRaw ?? [])].sort((a, b) => a.label.localeCompare(b.label));
  const { data: suppliers } = useList<Supplier>("suppliers", "/suppliers");
  const [form, setForm] = useState({
    name: "", category: CATEGORIES[0], uom: "", last_price: 0, min_stock: 5, reorder_level: 10,
    stock_type: "general" as "general" | "food", supplier_id: "",
  });

  useEffect(() => {
    if (uoms.length > 0 && !form.uom) setForm((s) => ({ ...s, uom: uoms[0].label }));
  }, [uoms, form.uom]);

  // Item master rows point at a real stock record via stock_id, so creating
  // one here also creates its backing food_inventory / inventory row first —
  // otherwise a later GRN receipt would have nothing to increment. `code`
  // is never sent — the backend always generates it (see purchasing.py's
  // hand-written POST /item-master).
  const createLinked = useMutation({
    mutationFn: async () => {
      const stockPayload =
        form.stock_type === "food"
          ? { name: form.name, category: form.category, qty: 0, unit: form.uom, cost: form.last_price, supplier_id: form.supplier_id || null }
          : {
              name: form.name, category: form.category, sku: `INV-${Date.now().toString(36).toUpperCase()}`,
              unit: form.uom, stock: 0, min: form.min_stock, max: form.reorder_level * 2,
              last_price: form.last_price, avg_price: form.last_price, supplier_id: form.supplier_id || null,
            };
      const stockEndpoint = form.stock_type === "food" ? "/kitchen/food-inventory" : "/inventory";
      const stock = (await api.post(stockEndpoint, stockPayload)).data as FoodInventoryItem | InventoryItem;
      return api.post("/item-master", {
        name: form.name, uom: form.uom, last_price: form.last_price,
        preferred_supplier_id: form.supplier_id || null,
        min_stock: form.min_stock, reorder_level: form.reorder_level, active: true,
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
        <Field label="Minimum stock" type="number" value={form.min_stock} onChange={(v) => setForm((s) => ({ ...s, min_stock: Number(v) }))} />
        <Field label="Reorder level" type="number" value={form.reorder_level} onChange={(v) => setForm((s) => ({ ...s, reorder_level: Number(v) }))} />
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
