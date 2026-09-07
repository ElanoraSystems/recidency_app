import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { api } from "../api/client";
import { useCreate, useList } from "../api/hooks";
import { BarChartH, catColor } from "../components/charts";
import { Icon } from "../components/icons";
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Spinner, StatTile, Table, Td, Th, statusTone } from "../components/ui";
import { daysUntil, todayIso } from "../lib/date";
import type { FoodInventoryItem, MealCategory, MealLogEntry, ProposedMenu, Recipe, RecipeIngredient, StockTransfer, UnitOfMeasureEntry, WasteLog, WasteReason, WeeklyMealPlan, WeeklyMealPlanEntry } from "../types";

const TABS = ["Meal Log", "Menu Proposals", "Staff Meal Plan", "Recipes", "Food Inventory", "Raw Material Transfer", "Waste Log"] as const;

// A plain <a href> won't carry the Bearer token — fetch as an authenticated
// blob and open that instead (same pattern used for Documents downloads).
async function downloadInvoicePdf(url: string) {
  const res = await api.get(url, { responseType: "blob" });
  const blobUrl = URL.createObjectURL(res.data as Blob);
  window.open(blobUrl, "_blank");
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

export function Kitchen() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Meal Log");
  const [modal, setModal] = useState(false);

  return (
    <div>
      <PageHeader
        title="Kitchen"
        subtitle="Recipes, food stock and meal production."
        action={
          tab === "Menu Proposals" ? <Button onClick={() => setModal(true)}>+ New Proposal</Button> :
          tab === "Recipes" ? <Button onClick={() => setModal(true)}>+ New Recipe</Button> :
          tab === "Meal Log" ? <Button onClick={() => setModal(true)}>+ Log Meal</Button> :
          tab === "Raw Material Transfer" ? <Button onClick={() => setModal(true)}>+ Raw Material Transfer</Button> :
          tab === "Waste Log" ? <Button onClick={() => setModal(true)}>+ Log Waste</Button> : undefined
        }
      />

      <div className="mb-5 flex flex-wrap gap-1 rounded-xl p-1" style={{ background: "var(--surface-sunken)", width: "fit-content" }}>
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

      {tab === "Recipes" && <RecipesTab modal={modal} setModal={setModal} />}
      {tab === "Food Inventory" && <FoodInventoryTab />}
      {tab === "Raw Material Transfer" && <RawMaterialTransferTab modal={modal} setModal={setModal} />}
      {tab === "Waste Log" && <WasteLogTab modal={modal} setModal={setModal} />}
      {tab === "Meal Log" && <MealLogTab modal={modal} setModal={setModal} />}
      {tab === "Menu Proposals" && <ProposalsTab modal={modal} setModal={setModal} />}
      {tab === "Staff Meal Plan" && <StaffMealPlanTab />}
    </div>
  );
}

function RecipesTab({ modal, setModal }: { modal: boolean; setModal: (v: boolean) => void }) {
  const { data, isLoading } = useList<Recipe>("recipes", "/kitchen/recipes");
  const [detail, setDetail] = useState<Recipe | null>(null);
  if (isLoading) return <Spinner />;
  return (
    <div>
      {!data || data.length === 0 ? <EmptyState label="No recipes yet." /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((r) => (
            <Card key={r.id} className="cursor-pointer" >
              <div onClick={() => setDetail(r)}>
                <div className="mb-1 flex items-start justify-between gap-2">
                  <div className="font-display text-base font-semibold">{r.name}</div>
                  <Badge>{r.category}</Badge>
                </div>
                {r.allergens.length > 0 && (
                  <div className="mb-2 text-xs" style={{ color: "var(--status-serious)" }}>
                    Allergens: {r.allergens.join(", ")}
                  </div>
                )}
                <div className="mb-2 text-xs" style={{ color: "var(--ink-500)" }}>
                  {r.ingredients.length} ingredients · {r.cost.portions} portions
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="font-display text-xl font-semibold">KWD {r.cost.cost_per_portion.toFixed(3)}</span>
                  <span className="text-xs" style={{ color: "var(--ink-400)" }}>/ portion</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {modal && <NewRecipeModal onClose={() => setModal(false)} />}
      {detail && <RecipeDetailModal recipe={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

type IngredientPayload = {
  food_inventory_id: string | null;
  sub_recipe_id: string | null;
  qty: number;
  yield_pct: number;
  override_unit_id: string | null;
};

function toPayload(i: RecipeIngredient): IngredientPayload {
  return {
    food_inventory_id: i.food_inventory_id,
    sub_recipe_id: i.sub_recipe_id,
    qty: i.qty,
    yield_pct: i.yield_pct,
    override_unit_id: i.override_unit_id,
  };
}

function RecipeDetailModal({ recipe: initialRecipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const qc = useQueryClient();
  const [recipe, setRecipe] = useState(initialRecipe);
  const { data: foodInventory } = useList<FoodInventoryItem>("food-inventory", "/kitchen/food-inventory");
  const { data: uomsRaw } = useList<UnitOfMeasureEntry>("units-of-measure", "/units-of-measure");
  const { data: allRecipes } = useList<Recipe>("recipes", "/kitchen/recipes");
  const uoms = [...(uomsRaw ?? [])].sort((a, b) => a.label.localeCompare(b.label));
  // A recipe can't reference itself as a sub-recipe (the server also
  // blocks any transitive cycle) — filtering it out of the picker avoids
  // an obvious dead-end pick before that round-trip even happens.
  const subRecipeOptions = (allRecipes ?? []).filter((r) => r.id !== recipe.id).sort((a, b) => a.name.localeCompare(b.name));
  const [source, setSource] = useState<"stock" | "sub_recipe">("stock");
  const [ing, setIng] = useState<{ food_inventory_id: string; sub_recipe_id: string; qty: number; yield_pct: number; override_unit_id: string }>(
    { food_inventory_id: "", sub_recipe_id: "", qty: 0, yield_pct: 100, override_unit_id: "" }
  );
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async (ingredients: IngredientPayload[]) =>
      (await api.patch<Recipe>(`/kitchen/recipes/${recipe.id}`, {
        name: recipe.name, category: recipe.category, allergens: recipe.allergens, notes: recipe.notes,
        prep_loss_pct: recipe.prep_loss_pct, raw_yield_g: recipe.raw_yield_g, portion_size_g: recipe.portion_size_g,
        cooking_method: recipe.cooking_method, method: recipe.method, ingredients,
      })).data,
    // Stays open and refreshes with the saved recipe — closing after every
    // single line item made it impossible to add more than one in a row.
    onSuccess: (updated) => { qc.invalidateQueries({ queryKey: ["recipes"] }); setRecipe(updated); setError(null); },
    onError: (err: unknown) => {
      const message = axios.isAxiosError(err) ? (err.response?.data as { detail?: string } | undefined)?.detail : undefined;
      setError(message ?? "Could not save — please try again.");
    },
  });

  function addIngredient() {
    if (source === "stock" && !ing.food_inventory_id) return;
    if (source === "sub_recipe" && !ing.sub_recipe_id) return;
    save.mutate([
      ...recipe.ingredients.map(toPayload),
      {
        food_inventory_id: source === "stock" ? ing.food_inventory_id : null,
        sub_recipe_id: source === "sub_recipe" ? ing.sub_recipe_id : null,
        qty: ing.qty,
        yield_pct: ing.yield_pct,
        override_unit_id: source === "stock" ? (ing.override_unit_id || null) : null,
      },
    ]);
    setIng({ food_inventory_id: "", sub_recipe_id: "", qty: 0, yield_pct: 100, override_unit_id: "" });
  }
  function removeIngredient(idx: number) {
    save.mutate(recipe.ingredients.filter((_, i) => i !== idx).map(toPayload));
  }
  const selectedStock = foodInventory?.find((f) => f.id === ing.food_inventory_id);

  return (
    <Modal title={recipe.name} onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{recipe.category}</Badge>
          <Badge>{recipe.cooking_method || "—"}</Badge>
          <Badge>{recipe.portion_size_g} g plated</Badge>
          {recipe.allergens.length > 0 ? (
            recipe.allergens.map((a) => <Badge key={a} tone="warning">{a}</Badge>)
          ) : (
            <Badge tone="good">No allergens</Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Raw Yield" value={recipe.raw_yield_g} suffix="g" />
          <StatTile label="Prep Loss" value={`${recipe.prep_loss_pct}%`} progressColor="var(--status-warning)" />
          <StatTile label="Usable Yield" value={recipe.cost.final_yield_g} suffix="g" sub={`${recipe.cost.portions} portions`} progressColor="var(--status-good)" />
          <StatTile label="Cost / Portion" value={`KWD ${recipe.cost.cost_per_portion.toFixed(3)}`} sub={`Recipe total KWD ${recipe.cost.total_cost.toFixed(3)}`} />
        </div>

        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>Ingredients / line items</div>
          <Table>
            <thead><tr><Th>Ingredient</Th><Th>Qty</Th><Th>Unit</Th><Th>Cost/unit</Th><Th>Yield %</Th><Th>Line cost</Th><Th>{" "}</Th></tr></thead>
            <tbody>
              {recipe.ingredients.length === 0 ? (
                <tr><Td colSpan={7} className="text-center" style={{ color: "var(--ink-400)" }}>No ingredients added yet — add the first one below.</Td></tr>
              ) : recipe.ingredients.map((i, idx) => (
                <tr key={idx}>
                  <Td className="font-medium">
                    {i.name}
                    {i.sub_recipe_id && <span className="ml-2"><Badge tone="info">Sub-recipe</Badge></span>}
                  </Td>
                  <Td>{i.qty}</Td>
                  <Td>{i.unit}</Td>
                  <Td>KWD {i.cost_per_unit.toFixed(3)}</Td>
                  <Td>{i.yield_pct}%</Td>
                  <Td>KWD {i.line_cost.toFixed(3)}</Td>
                  <Td>
                    <button className="text-xs font-semibold" style={{ color: "var(--status-critical)" }} onClick={() => removeIngredient(idx)} disabled={save.isPending}>
                      Remove
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex w-40 flex-col gap-1 text-[13px] font-medium">Ingredient type
            <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={source} onChange={(e) => setSource(e.target.value as "stock" | "sub_recipe")}>
              <option value="stock">Stock item</option>
              <option value="sub_recipe">Sub-recipe</option>
            </select>
          </label>
          {source === "stock" ? (
            <>
              <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-[13px] font-medium">Stock item
                <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
                  value={ing.food_inventory_id} onChange={(e) => setIng((s) => ({ ...s, food_inventory_id: e.target.value }))}>
                  <option value="">Select stock item…</option>
                  {foodInventory?.map((f) => <option key={f.id} value={f.id}>{f.name} (KWD {f.cost.toFixed(3)}/{f.unit})</option>)}
                </select>
              </label>
              <label className="flex w-20 flex-col gap-1 text-[13px] font-medium">Qty
                <input type="number" step="any" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
                  value={ing.qty} onChange={(e) => setIng((s) => ({ ...s, qty: Number(e.target.value) }))} />
              </label>
              <label className="flex w-24 flex-col gap-1 text-[13px] font-medium">Unit
                <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
                  value={ing.override_unit_id} onChange={(e) => setIng((s) => ({ ...s, override_unit_id: e.target.value }))}>
                  <option value="">{selectedStock?.unit ?? "unit"} (default)</option>
                  {uoms.filter((u) => u.label !== selectedStock?.unit).map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                </select>
              </label>
            </>
          ) : (
            <>
              <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-[13px] font-medium">Sub-recipe
                <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
                  value={ing.sub_recipe_id} onChange={(e) => setIng((s) => ({ ...s, sub_recipe_id: e.target.value }))}>
                  <option value="">Select recipe…</option>
                  {subRecipeOptions.map((r) => (
                    <option key={r.id} value={r.id}>{r.name} (KWD {r.cost.total_cost.toFixed(3)}/{r.cost.final_yield_g}g)</option>
                  ))}
                </select>
              </label>
              <label className="flex w-24 flex-col gap-1 text-[13px] font-medium">Qty (g)
                <input type="number" step="any" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
                  value={ing.qty} onChange={(e) => setIng((s) => ({ ...s, qty: Number(e.target.value) }))} />
              </label>
            </>
          )}
          <label className="flex w-20 flex-col gap-1 text-[13px] font-medium">Yield %
            <input type="number" min={1} max={100} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={ing.yield_pct} onChange={(e) => setIng((s) => ({ ...s, yield_pct: Number(e.target.value) }))} />
          </label>
          <Button variant="secondary" onClick={addIngredient}
            disabled={save.isPending || (source === "stock" ? !ing.food_inventory_id : !ing.sub_recipe_id)}>
            + Add
          </Button>
        </div>
        {error && (
          <div className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--status-critical-bg)", color: "var(--status-critical)" }}>
            {error}
          </div>
        )}
        <p className="text-[12px]" style={{ color: "var(--ink-400)" }}>
          Every ingredient links to a real stock item — cost per unit always reflects that item's current (moving-average)
          cost, so this recipe's costing stays accurate automatically as purchase prices change. Yield % is per ingredient —
          e.g. 90% for an onion after peeling — and grosses up its line cost to the as-purchased quantity actually needed.
          Cost per portion also reflects the recipe's overall {recipe.prep_loss_pct}% preparation loss —
          {" "}{recipe.raw_yield_g}g raw yields {recipe.cost.final_yield_g}g usable, portioned at {recipe.portion_size_g}g,
          spread across {recipe.cost.portions} actual servings. A sub-recipe can also be used as an ingredient (always
          measured in grams of its finished yield) — its cost and stock consumption both recurse through its own
          ingredients automatically, all the way down.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>Preparation method</div>
            <p style={{ lineHeight: 1.7 }}>{recipe.method || "—"}</p>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>Cooking method</div>
            <p style={{ lineHeight: 1.7 }}>{recipe.cooking_method || "—"}</p>
          </div>
        </div>

        {recipe.notes && (
          <div>
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>Notes / chef instructions</div>
            <p style={{ color: "var(--ink-500)" }}>{recipe.notes}</p>
          </div>
        )}

        <div className="text-[12px]" style={{ color: "var(--ink-400)" }}>
          Ingredients deduct from inventory automatically when this dish is logged as served.
        </div>
      </div>
    </Modal>
  );
}

function NewRecipeModal({ onClose }: { onClose: () => void }) {
  const create = useCreate<Recipe>("recipes", "/kitchen/recipes");
  const [form, setForm] = useState({
    name: "", category: "Dinner", portion_size_g: 250, raw_yield_g: 1000, prep_loss_pct: 8,
    cooking_method: "", allergens: "", method: "", notes: "",
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await create.mutateAsync({
      ...form,
      allergens: form.allergens ? form.allergens.split(",").map((s) => s.trim()).filter(Boolean) : [],
      ingredients: [],
    } as never);
    onClose();
  }

  return (
    <Modal title="New recipe" onClose={onClose} wide>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-medium">Recipe name
          <input required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-medium">Category
            <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.category} onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))}>
              {["Breakfast", "Lunch", "Dinner", "Snacks", "Special Meals", "Events"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Portion size (g/ml)
            <input type="number" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.portion_size_g} onChange={(e) => setForm((s) => ({ ...s, portion_size_g: Number(e.target.value) }))} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Raw yield before prep (g/ml)
            <input type="number" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.raw_yield_g} onChange={(e) => setForm((s) => ({ ...s, raw_yield_g: Number(e.target.value) }))} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Preparation loss (%)
            <input type="number" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.prep_loss_pct} onChange={(e) => setForm((s) => ({ ...s, prep_loss_pct: Number(e.target.value) }))} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Cooking method
            <input className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.cooking_method} onChange={(e) => setForm((s) => ({ ...s, cooking_method: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Allergens
            <input placeholder="e.g. Fish, Dairy" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.allergens} onChange={(e) => setForm((s) => ({ ...s, allergens: e.target.value }))} />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Preparation method
          <textarea placeholder="Mise en place & preparation steps" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.method} onChange={(e) => setForm((s) => ({ ...s, method: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Notes / chef instructions
          <textarea placeholder="Optional notes for kitchen staff" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.notes} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} />
        </label>
        <p className="text-[12px]" style={{ color: "var(--ink-400)" }}>Add ingredient line items after saving, from the recipe detail view, to complete costing.</p>
        <Button type="submit" disabled={create.isPending}>{create.isPending ? "Saving..." : "Save Recipe"}</Button>
      </form>
    </Modal>
  );
}

function FoodInventoryTab() {
  const { data, isLoading } = useList<FoodInventoryItem>("food-inventory", "/kitchen/food-inventory");
  if (isLoading) return <Spinner />;
  if (!data || data.length === 0) return <EmptyState label="No food stock yet." />;

  const expSoon = data.filter((f) => f.expiry && daysUntil(f.expiry) <= 3).length;
  const value = data.reduce((s, f) => s + f.qty * f.cost, 0);

  return (
    <div>
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Food Items" icon="kitchen" value={data.length} sub="Tracked batches" />
        <StatTile label="Expiring Soon" icon="alertTriangle" value={expSoon} progressColor="var(--status-critical)" sub="Within 3 days" />
        <StatTile label="Inventory Value" icon="expenses" value={`KWD ${value.toFixed(0)}`} sub="At cost" />
      </div>
      <Table>
      <thead>
        <tr><Th>Item</Th><Th>Category</Th><Th>Qty</Th><Th>Location</Th><Th>Batch</Th><Th>Expiry</Th><Th>Cost/unit</Th></tr>
      </thead>
      <tbody>
        {data.map((f) => {
          const du = f.expiry ? daysUntil(f.expiry) : null;
          return (
            <tr key={f.id}>
              <Td className="font-medium">{f.name}</Td>
              <Td>{f.category}</Td>
              <Td>{f.qty} {f.unit}</Td>
              <Td>{f.location ?? "—"}</Td>
              <Td>{f.batch ?? "—"}</Td>
              <Td>
                {f.expiry ? (
                  <Badge tone={du != null && du < 0 ? "critical" : du != null && du <= 3 ? "warning" : "good"}>
                    {du != null && du < 0 ? "Expired" : f.expiry}
                  </Badge>
                ) : "—"}
              </Td>
              <Td>KWD {f.cost.toFixed(3)}</Td>
            </tr>
          );
        })}
      </tbody>
      </Table>
    </div>
  );
}

function RawMaterialTransferTab({ modal, setModal }: { modal: boolean; setModal: (v: boolean) => void }) {
  const { data: foodInventory } = useList<FoodInventoryItem>("food-inventory", "/kitchen/food-inventory");
  const { data: transfers, isLoading } = useList<StockTransfer>("stock-transfers", "/kitchen/stock-transfers");
  if (isLoading) return <Spinner />;

  return (
    <div>
      <p className="mb-4 text-[13px]" style={{ color: "var(--ink-500)" }}>
        Log raw materials pulled directly from stock, without going through a recipe or the Meal Log — for urgent
        situations with no time to build a recipe first. Each transfer deducts food inventory immediately.
      </p>
      {!transfers || transfers.length === 0 ? (
        <EmptyState label="No raw material transfers logged yet." />
      ) : (
        <div className="flex flex-col gap-2">
          {transfers.map((t) => (
            <Card key={t.id} className="!p-3">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-semibold">{t.reason}</span>
                <span className="text-[11.5px]" style={{ color: "var(--ink-400)" }}>
                  {t.date}{t.logged_by_name ? ` · ${t.logged_by_name}` : ""}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {t.lines.map((l) => (
                  <Badge key={l.id}>{l.ingredient_name} — {l.qty} {l.unit}</Badge>
                ))}
              </div>
              {t.notes && <p className="mt-1.5 text-[12px]" style={{ color: "var(--ink-500)" }}>{t.notes}</p>}
              <button className="mt-1.5 text-xs font-semibold" style={{ color: "var(--brass-600)" }}
                onClick={() => downloadInvoicePdf(`/kitchen/stock-transfers/${t.id}/invoice-pdf`)}>
                Invoice
              </button>
            </Card>
          ))}
        </div>
      )}

      {modal && foodInventory && <NewStockTransferModal foodInventory={foodInventory} onClose={() => setModal(false)} />}
    </div>
  );
}

function NewStockTransferModal({ foodInventory, onClose }: { foodInventory: FoodInventoryItem[]; onClose: () => void }) {
  const create = useCreate<StockTransfer>("stock-transfers", "/kitchen/stock-transfers");
  const qc = useQueryClient();
  const [date, setDate] = useState(todayIso());
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<{ key: string; food_inventory_id: string; qty: number }[]>([
    { key: crypto.randomUUID(), food_inventory_id: "", qty: 1 },
  ]);
  const [error, setError] = useState<string | null>(null);

  function addLine() {
    setLines((s) => [...s, { key: crypto.randomUUID(), food_inventory_id: "", qty: 1 }]);
  }
  function updateLine(key: string, patch: Partial<{ food_inventory_id: string; qty: number }>) {
    setLines((s) => s.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    setLines((s) => s.filter((l) => l.key !== key));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const ready = lines.filter((l) => l.food_inventory_id && l.qty > 0);
    if (ready.length === 0) {
      setError("Add at least one raw material with a quantity.");
      return;
    }
    try {
      await create.mutateAsync({
        date, reason, notes: notes || null,
        lines: ready.map((l) => ({ food_inventory_id: l.food_inventory_id, qty: l.qty })),
      } as never);
      qc.invalidateQueries({ queryKey: ["food-inventory"] });
      onClose();
    } catch {
      setError("Could not log the transfer — please try again.");
    }
  }

  return (
    <Modal title="Log a raw material transfer" onClose={onClose}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-medium">Date
            <input type="date" required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Reason
            <input required placeholder="e.g. Impromptu family lunch" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>Raw materials used</span>
            <button type="button" className="text-xs font-semibold" style={{ color: "var(--brass-600)" }} onClick={addLine}>+ Add another item</button>
          </div>
          <div className="flex flex-col gap-2">
            {lines.map((line) => {
              const item = foodInventory.find((f) => f.id === line.food_inventory_id);
              return (
                <div key={line.key} className="flex items-center gap-2">
                  <select className="flex-1 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
                    value={line.food_inventory_id} onChange={(e) => updateLine(line.key, { food_inventory_id: e.target.value })}>
                    <option value="">Select stock item…</option>
                    {foodInventory.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.qty} {f.unit} in stock)</option>)}
                  </select>
                  <input type="number" min={0} step="0.01" className="w-24 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
                    value={line.qty} onChange={(e) => updateLine(line.key, { qty: Number(e.target.value) })} />
                  <span className="w-10 text-[12.5px]" style={{ color: "var(--ink-400)" }}>{item?.unit ?? ""}</span>
                  {lines.length > 1 && (
                    <button type="button" className="text-xs font-semibold" style={{ color: "var(--status-critical)" }} onClick={() => removeLine(line.key)}>Remove</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <label className="flex flex-col gap-1 text-[13px] font-medium">Notes
          <input placeholder="Optional details" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <p className="text-[12px]" style={{ color: "var(--ink-400)" }}>
          Deducts the selected quantities from food inventory immediately — no recipe required.
        </p>
        {error && (
          <div className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--status-critical-bg)", color: "var(--status-critical)" }}>
            {error}
          </div>
        )}
        <Button type="submit" disabled={create.isPending}>{create.isPending ? "Logging..." : "Log Transfer"}</Button>
      </form>
    </Modal>
  );
}

function WasteLogTab({ modal, setModal }: { modal: boolean; setModal: (v: boolean) => void }) {
  const { data: foodInventory } = useList<FoodInventoryItem>("food-inventory", "/kitchen/food-inventory");
  const { data: wasteLogs, isLoading } = useList<WasteLog>("waste-log", "/kitchen/waste-log");
  if (isLoading) return <Spinner />;

  return (
    <div>
      <p className="mb-4 text-[13px]" style={{ color: "var(--ink-500)" }}>
        Log spoiled or wasted stock as it happens. Each entry deducts food inventory immediately and goes to a
        supervisor for review — reviewing doesn't change the stock, it's a sign-off on the record.
      </p>
      {!wasteLogs || wasteLogs.length === 0 ? (
        <EmptyState label="No waste logged yet." />
      ) : (
        <div className="flex flex-col gap-3">
          {wasteLogs.map((w) => {
            const total = w.lines.reduce((s, l) => s + l.line_cost, 0);
            return (
              <Card key={w.id} className="!p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold">{w.reason}</span>
                    <Badge tone={statusTone(w.status)}>{w.status}</Badge>
                  </div>
                  <span className="text-[11.5px]" style={{ color: "var(--ink-400)" }}>
                    {w.date}{w.logged_by_name ? ` · ${w.logged_by_name}` : ""}
                  </span>
                </div>
                <Table>
                  <thead><tr><Th>Item</Th><Th>Qty</Th><Th>Unit</Th><Th>Unit Cost</Th><Th>Line Total</Th></tr></thead>
                  <tbody>
                    {w.lines.map((l) => (
                      <tr key={l.id}>
                        <Td className="font-medium">{l.ingredient_name}</Td>
                        <Td>{l.qty}</Td>
                        <Td>{l.unit}</Td>
                        <Td>KWD {l.unit_cost.toFixed(3)}</Td>
                        <Td className="font-semibold">KWD {l.line_cost.toFixed(3)}</Td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <Td colSpan={4} className="text-right font-semibold">Total</Td>
                      <Td className="font-bold">KWD {total.toFixed(3)}</Td>
                    </tr>
                  </tfoot>
                </Table>
                {w.notes && <p className="mt-2 text-[12px]" style={{ color: "var(--ink-500)" }}>{w.notes}</p>}
                {w.reviewed_by_name && (
                  <p className="mt-1 text-[11.5px]" style={{ color: "var(--ink-400)" }}>Reviewed by {w.reviewed_by_name}</p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {modal && foodInventory && <NewWasteLogModal foodInventory={foodInventory} onClose={() => setModal(false)} />}
    </div>
  );
}

function NewWasteLogModal({ foodInventory, onClose }: { foodInventory: FoodInventoryItem[]; onClose: () => void }) {
  const create = useCreate<WasteLog>("waste-log", "/kitchen/waste-log");
  const qc = useQueryClient();
  const { data: reasonsRaw } = useList<WasteReason>("waste-reasons", "/kitchen/waste-reasons");
  const reasons = [...(reasonsRaw ?? [])].sort((a, b) => a.label.localeCompare(b.label));
  const [date, setDate] = useState(todayIso());
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<{ key: string; food_inventory_id: string; qty: number }[]>([
    { key: crypto.randomUUID(), food_inventory_id: "", qty: 1 },
  ]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (reasons.length > 0 && !reason) setReason(reasons[0].label);
  }, [reasons, reason]);

  function addLine() {
    setLines((s) => [...s, { key: crypto.randomUUID(), food_inventory_id: "", qty: 1 }]);
  }
  function updateLine(key: string, patch: Partial<{ food_inventory_id: string; qty: number }>) {
    setLines((s) => s.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    setLines((s) => s.filter((l) => l.key !== key));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const ready = lines.filter((l) => l.food_inventory_id && l.qty > 0);
    if (ready.length === 0) {
      setError("Add at least one wasted item with a quantity.");
      return;
    }
    try {
      await create.mutateAsync({
        date, reason, notes: notes || null,
        lines: ready.map((l) => ({ food_inventory_id: l.food_inventory_id, qty: l.qty })),
      } as never);
      qc.invalidateQueries({ queryKey: ["food-inventory"] });
      qc.invalidateQueries({ queryKey: ["approvals"] });
      onClose();
    } catch {
      setError("Could not log the waste — please try again.");
    }
  }

  return (
    <Modal title="Log kitchen waste" onClose={onClose} wide>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-medium">Date
            <input type="date" required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Reason
            <select required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={reason} onChange={(e) => setReason(e.target.value)}>
              {reason && !reasons.some((r) => r.label === reason) && <option value={reason}>{reason}</option>}
              {reasons.map((r) => <option key={r.id} value={r.label}>{r.label}</option>)}
            </select>
          </label>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>Wasted items</span>
            <button type="button" className="text-xs font-semibold" style={{ color: "var(--brass-600)" }} onClick={addLine}>+ Add line item</button>
          </div>
          <Table>
            <thead><tr><Th>Item</Th><Th>Qty</Th><Th>Unit</Th><Th>Unit Cost</Th><Th>Line Total</Th><Th>{" "}</Th></tr></thead>
            <tbody>
              {lines.map((line) => {
                const item = foodInventory.find((f) => f.id === line.food_inventory_id);
                const unitCost = item?.cost ?? 0;
                const lineTotal = unitCost * line.qty;
                return (
                  <tr key={line.key}>
                    <Td>
                      <select className="w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-strong)" }}
                        value={line.food_inventory_id} onChange={(e) => updateLine(line.key, { food_inventory_id: e.target.value })}>
                        <option value="">Select stock item…</option>
                        {foodInventory.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.qty} {f.unit} in stock)</option>)}
                      </select>
                    </Td>
                    <Td>
                      <input type="number" min={0} step="0.01" className="w-20 rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-strong)" }}
                        value={line.qty} onChange={(e) => updateLine(line.key, { qty: Number(e.target.value) })} />
                    </Td>
                    <Td>{item?.unit ?? "—"}</Td>
                    <Td>KWD {unitCost.toFixed(3)}</Td>
                    <Td className="font-semibold">KWD {lineTotal.toFixed(3)}</Td>
                    <Td>
                      {lines.length > 1 && (
                        <button type="button" className="text-xs font-semibold" style={{ color: "var(--status-critical)" }} onClick={() => removeLine(line.key)}>Remove</button>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <Td colSpan={4} className="text-right font-semibold">Total</Td>
                <Td className="font-bold">
                  KWD {lines.reduce((s, l) => s + (foodInventory.find((f) => f.id === l.food_inventory_id)?.cost ?? 0) * l.qty, 0).toFixed(3)}
                </Td>
                <Td>{" "}</Td>
              </tr>
            </tfoot>
          </Table>
        </div>

        <label className="flex flex-col gap-1 text-[13px] font-medium">Notes
          <input placeholder="Optional details" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <p className="text-[12px]" style={{ color: "var(--ink-400)" }}>
          Deducts the selected quantities from food inventory immediately, then goes to your supervisor (or the Owner) for review.
        </p>
        {error && (
          <div className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--status-critical-bg)", color: "var(--status-critical)" }}>
            {error}
          </div>
        )}
        <Button type="submit" disabled={create.isPending}>{create.isPending ? "Logging..." : "Log Waste"}</Button>
      </form>
    </Modal>
  );
}

function MealLogTab({ modal, setModal }: { modal: boolean; setModal: (v: boolean) => void }) {
  const { data: mealLog, isLoading } = useList<MealLogEntry>("meal-log", "/kitchen/meal-log");
  const { data: mealCategoriesRaw } = useList<MealCategory>("meal-categories", "/kitchen/meal-categories");
  // The generic list endpoint always sorts descending, so re-sort A-Z here
  // rather than showing categories in a confusing, effectively-random order.
  const mealCategories = [...(mealCategoriesRaw ?? [])].sort((a, b) => a.label.localeCompare(b.label));

  if (isLoading) return <Spinner />;

  const today = todayIso();
  const monthPrefix = today.slice(0, 7);
  const todayLogs = (mealLog ?? []).filter((m) => m.date === today);
  const monthLogs = (mealLog ?? []).filter((m) => m.date.slice(0, 7) === monthPrefix);
  const todayValue = todayLogs.reduce((s, m) => s + m.qty * m.unit_cost, 0);
  const monthValue = monthLogs.reduce((s, m) => s + m.qty * m.unit_cost, 0);
  const todayServed = todayLogs.reduce((s, m) => s + m.qty, 0);
  const monthServed = monthLogs.reduce((s, m) => s + m.qty, 0);
  const avgCost = monthServed ? monthValue / monthServed : 0;

  const byCat: Record<string, number> = {};
  for (const m of monthLogs) byCat[m.category] = (byCat[m.category] ?? 0) + m.qty * m.unit_cost;
  const catKeys = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);
  const catRows = catKeys.map((c, i) => ({ label: c, value: byCat[c], color: catColor(i) }));

  const sorted = [...(mealLog ?? [])].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Today's Consumption Value" icon="scale" value={`KWD ${todayValue.toFixed(2)}`} sub={`${todayServed} meals served today`} />
        <StatTile label="This Month's Consumption Value" icon="scale" value={`KWD ${monthValue.toFixed(2)}`} sub={`${monthServed} meals served this month`} />
        <StatTile label="Meals Served Today" icon="kitchen" value={todayServed} sub={`${todayLogs.length} entries logged`} />
        <StatTile label="Avg Recipe Cost / Meal" icon="expenses" value={`KWD ${avgCost.toFixed(3)}`} sub="Month to date" />
      </div>
      <p className="mb-4 text-[12px]" style={{ color: "var(--ink-400)" }}>
        Consumption value is the recipe-costed value of meals served — useful for tracking usage and portion control, but it is not the residence's food expense (that's purchases, tracked under Purchasing).
      </p>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 text-[15px] font-semibold">Consumption value by category — this month</h3>
          {catRows.length === 0 ? <EmptyState label="No meals logged this month yet." /> : <BarChartH rows={catRows} fmt={(v) => `KWD ${v.toFixed(2)}`} />}
        </Card>
        <Card>
          <h3 className="mb-3 text-[15px] font-semibold">Meal categories tracked</h3>
          <div className="flex flex-wrap gap-2">
            {mealCategories.length === 0 ? (
              <span className="text-xs" style={{ color: "var(--ink-400)" }}>None configured — add some in Settings → Meal Categories.</span>
            ) : mealCategories.map((c) => <Badge key={c.id}>{c.label}</Badge>)}
          </div>
        </Card>
      </div>

      {!mealLog || mealLog.length === 0 ? (
        <EmptyState label="No meals logged yet." />
      ) : (
        <Table>
          <thead>
            <tr><Th>Date</Th><Th>Category</Th><Th>Dish</Th><Th>Portions</Th><Th>Unit Cost</Th><Th>Total Cost</Th><Th>Notes</Th><Th>{" "}</Th></tr>
          </thead>
          <tbody>
            {sorted.map((m) => (
              <tr key={m.id}>
                <Td>{m.date}</Td>
                <Td><Badge>{m.category}</Badge></Td>
                <Td className="font-medium">{m.dish}{!m.recipe_id && <Badge tone="warning">No recipe</Badge>}</Td>
                <Td>{m.qty}</Td>
                <Td>KWD {m.unit_cost.toFixed(3)}</Td>
                <Td className="font-semibold">KWD {(m.qty * m.unit_cost).toFixed(3)}</Td>
                <Td>{m.notes ?? "—"}</Td>
                <Td>
                  <button className="text-xs font-semibold" style={{ color: "var(--brass-600)" }}
                    onClick={() => downloadInvoicePdf(`/kitchen/meal-log/${m.id}/invoice-pdf`)}>
                    Invoice
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {modal && <LogMealModal onClose={() => setModal(false)} />}
    </div>
  );
}

const OCCASION_TYPES = ["Breakfast", "Lunch", "Dinner", "Special Dinner", "Events"];

function LogMealModal({ onClose }: { onClose: () => void }) {
  const { data: recipes } = useList<Recipe>("recipes", "/kitchen/recipes");
  const { data: mealCategoriesRaw } = useList<MealCategory>("meal-categories", "/kitchen/meal-categories");
  const mealCategories = [...(mealCategoriesRaw ?? [])].sort((a, b) => a.label.localeCompare(b.label));
  const logMeal = useCreate<MealLogEntry>("meal-log", "/kitchen/meal-log");
  const qc = useQueryClient();
  const [form, setForm] = useState({
    date: todayIso(), category: "", dish: "", recipe_id: "", qty: 1, notes: "", produced_for: "",
  });
  useEffect(() => {
    if (mealCategories.length > 0 && !form.category) {
      setForm((s) => ({ ...s, category: mealCategories[0].label }));
    }
  }, [mealCategories, form.category]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const recipe = recipes?.find((r) => r.id === form.recipe_id);
    await logMeal.mutateAsync({
      ...form,
      dish: recipe?.name ?? (form.dish || "Custom dish"),
      recipe_id: form.recipe_id || null,
      notes: form.notes || null,
      produced_for: form.produced_for || null,
    } as never);
    if (form.recipe_id) qc.invalidateQueries({ queryKey: ["food-inventory"] });
    onClose();
  }

  return (
    <Modal title="Log a meal" onClose={onClose}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-medium">Meal category
            <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.category} onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))}>
              {mealCategories.map((c) => <option key={c.id} value={c.label}>{c.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Dish / recipe
            <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.recipe_id} onChange={(e) => setForm((s) => ({ ...s, recipe_id: e.target.value }))}>
              <option value="">— Custom / off-menu dish —</option>
              {recipes?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
        </div>
        {!form.recipe_id && (
          <label className="flex flex-col gap-1 text-[13px] font-medium">Custom dish name
            <input placeholder="e.g. Fruit & pastry tray" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.dish} onChange={(e) => setForm((s) => ({ ...s, dish: e.target.value }))} />
          </label>
        )}
        <label className="flex flex-col gap-1 text-[13px] font-medium">Quantity (portions)
          <input type="number" min={1} required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.qty} onChange={(e) => setForm((s) => ({ ...s, qty: Number(e.target.value) }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Produced for
          <input placeholder="e.g. Villa Security Team, Al Sabah family dinner — 12 guests" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.produced_for} onChange={(e) => setForm((s) => ({ ...s, produced_for: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Notes
          <input placeholder="e.g. Family lunch, external order, event tray" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.notes} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} />
        </label>
        <p className="text-[12px]" style={{ color: "var(--ink-400)" }}>
          Selecting a recipe pulls its actual usable-yield cost per portion automatically, and deducts the ingredients used from food inventory. "Produced for" is optional and appears on the invoice PDF.
        </p>
        <Button type="submit" disabled={logMeal.isPending}>{logMeal.isPending ? "Logging..." : "Log Meal"}</Button>
      </form>
    </Modal>
  );
}

function ProposalsTab({ modal, setModal }: { modal: boolean; setModal: (v: boolean) => void }) {
  const { data, isLoading } = useList<ProposedMenu>("proposed-menus", "/kitchen/proposed-menus");
  const { data: recipes } = useList<Recipe>("recipes", "/kitchen/recipes");
  const [detail, setDetail] = useState<ProposedMenu | null>(null);
  const recipeName = (id: string) => recipes?.find((r) => r.id === id)?.name ?? "—";

  return (
    <div>
      {isLoading ? <Spinner /> : !data || data.length === 0 ? <EmptyState label="No menu proposals yet." /> : (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.map((m) => (
            <Card key={m.id} className="cursor-pointer" >
              <div onClick={() => setDetail(m)}>
                <div className="mb-1 flex items-start justify-between gap-2">
                  <div className="font-display text-base font-semibold">{m.occasion}</div>
                  <Badge tone={statusTone(m.status)}>{m.status}</Badge>
                </div>
                <div className="mb-2 text-xs" style={{ color: "var(--ink-500)" }}>{m.occasion_type} · {m.category} · for {m.for_date}</div>
                <div className="mb-1 flex flex-col gap-1">
                  {m.options.map((o, i) => (
                    <div key={i} className="flex items-center gap-2 text-[13px]">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: o.selected ? "var(--status-good)" : "var(--border-strong)" }} />
                      {recipeName(o.recipe_id)}
                      {o.note && <span style={{ color: "var(--ink-400)" }}>— {o.note}</span>}
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-xs" style={{ color: "var(--ink-400)" }}>Proposed by {m.created_by_name ?? "—"}</div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {modal && <NewProposalModal onClose={() => setModal(false)} />}
      {detail && <ProposalDetailModal proposal={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function ProposalDetailModal({ proposal, onClose }: { proposal: ProposedMenu; onClose: () => void }) {
  const { data: recipes } = useList<Recipe>("recipes", "/kitchen/recipes");
  const qc = useQueryClient();
  const decide = useMutation({
    mutationFn: async ({ approve }: { approve: boolean }) =>
      api.post(`/kitchen/proposed-menus/${proposal.id}/decision?approve=${approve}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["proposed-menus"] }); onClose(); },
  });
  const recipe = (id: string) => recipes?.find((r) => r.id === id);

  return (
    <Modal title={proposal.occasion} onClose={onClose} wide>
      <div className="flex flex-col gap-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{proposal.occasion_type}</Badge>
          <Badge>{proposal.category}</Badge>
          <Badge tone={statusTone(proposal.status)}>{proposal.status}</Badge>
        </div>
        <div style={{ color: "var(--ink-500)" }}>For {proposal.for_date} · Proposed by {proposal.created_by_name ?? "—"}</div>
        {proposal.notes && <p style={{ color: "var(--ink-700)" }}>{proposal.notes}</p>}
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>Dish options</div>
          <div className="flex flex-col gap-1.5">
            {proposal.options.map((o, i) => {
              const r = recipe(o.recipe_id);
              const cost = r ? r.cost.cost_per_portion : null;
              return (
                <div key={i} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--surface-sunken)" }}>
                  <div>
                    <span className="font-medium">{r ? r.name : "Recipe not on file"}</span>
                    <span className="ml-1" style={{ color: "var(--ink-400)" }}>
                      {o.note ? `— ${o.note}` : ""}{cost != null ? ` · KWD ${cost.toFixed(3)}/portion` : ""}
                    </span>
                  </div>
                  {o.selected && <Badge tone="good">Selected</Badge>}
                </div>
              );
            })}
          </div>
        </div>
        {proposal.status === "Approved" ? (
          <div className="flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-[13px]" style={{ background: "var(--status-good-bg)", color: "var(--status-good)" }}>
            <Icon name="checkCircle" className="h-4 w-4" />Approved by the Owner — ready for kitchen production.
          </div>
        ) : (
          <p style={{ color: "var(--ink-400)" }}>Awaiting Owner review and approval.</p>
        )}
        {proposal.status === "Proposed" && (
          <div className="flex gap-2">
            <Button onClick={() => decide.mutate({ approve: true })} disabled={decide.isPending}>Approve Selected</Button>
            <Button variant="ghost" onClick={() => decide.mutate({ approve: false })} disabled={decide.isPending}>Reject</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function NewProposalModal({ onClose }: { onClose: () => void }) {
  const { data: recipes } = useList<Recipe>("recipes", "/kitchen/recipes");
  const { data: mealCategoriesRaw } = useList<MealCategory>("meal-categories", "/kitchen/meal-categories");
  const mealCategories = [...(mealCategoriesRaw ?? [])].sort((a, b) => a.label.localeCompare(b.label));
  const create = useCreate<ProposedMenu>("proposed-menus", "/kitchen/proposed-menus");
  const [form, setForm] = useState({ occasion: "", occasion_type: "Lunch", for_date: todayIso(), category: "", notes: "" });
  const [optionIds, setOptionIds] = useState<string[]>([]);
  useEffect(() => {
    if (mealCategories.length > 0 && !form.category) {
      setForm((s) => ({ ...s, category: mealCategories[0].label }));
    }
  }, [mealCategories, form.category]);

  function toggleOption(id: string) {
    setOptionIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await create.mutateAsync({
      ...form,
      options: optionIds.map((recipe_id) => ({ recipe_id, note: null, selected: false })),
    } as never);
    onClose();
  }

  return (
    <Modal title="New menu proposal" onClose={onClose} wide>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-medium">Occasion
          <input required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.occasion} onChange={(e) => setForm((s) => ({ ...s, occasion: e.target.value }))} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-medium">Occasion type
            <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.occasion_type} onChange={(e) => setForm((s) => ({ ...s, occasion_type: e.target.value }))}>
              {OCCASION_TYPES.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Category
            <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.category} onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))}>
              {mealCategories.map((c) => <option key={c.id} value={c.label}>{c.label}</option>)}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1 text-[13px] font-medium">For date
          <input type="date" required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.for_date} onChange={(e) => setForm((s) => ({ ...s, for_date: e.target.value }))} />
        </label>
        <div className="flex flex-col gap-1 text-[13px] font-medium">
          Recipe options
          <div className="flex flex-col gap-1.5 rounded-lg border p-2" style={{ borderColor: "var(--border-strong)" }}>
            {recipes?.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-[13px] font-normal">
                <input type="checkbox" checked={optionIds.includes(r.id)} onChange={() => toggleOption(r.id)} />
                {r.name}
              </label>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Notes
          <textarea className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.notes} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} />
        </label>
        <Button type="submit" disabled={create.isPending}>{create.isPending ? "Submitting..." : "Submit proposal"}</Button>
      </form>
    </Modal>
  );
}

const STAFF_OCCASION_TYPES = ["Staff Meals – Office", "Staff Meals – Residence"] as const;
const PLAN_DAYS: { key: string; label: string }[] = [
  { key: "sun", label: "Sun" }, { key: "mon", label: "Mon" }, { key: "tue", label: "Tue" }, { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" }, { key: "fri", label: "Fri" }, { key: "sat", label: "Sat" },
];
const PLAN_MEALS: { key: WeeklyMealPlanEntry["meal_type"]; label: string }[] = [
  { key: "breakfast", label: "Breakfast" }, { key: "lunch", label: "Lunch" }, { key: "dinner", label: "Dinner" },
];

function upcomingSunday(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return d.toISOString().slice(0, 10);
}

function StaffMealPlanTab() {
  const [occasionType, setOccasionType] = useState<(typeof STAFF_OCCASION_TYPES)[number]>(STAFF_OCCASION_TYPES[0]);
  const { data: plans, isLoading } = useList<WeeklyMealPlan>("weekly-meal-plans", "/kitchen/weekly-meal-plans");
  const { data: recipes } = useList<Recipe>("recipes", "/kitchen/recipes");
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newWeekDate, setNewWeekDate] = useState(upcomingSunday());
  const [editingCell, setEditingCell] = useState<{ day: string; meal: WeeklyMealPlanEntry["meal_type"]; entry: WeeklyMealPlanEntry | null } | null>(null);

  const createPlan = useMutation({
    mutationFn: async () =>
      (await api.post<WeeklyMealPlan>("/kitchen/weekly-meal-plans", { occasion_type: occasionType, week_start_date: newWeekDate })).data,
    onSuccess: (plan) => { qc.invalidateQueries({ queryKey: ["weekly-meal-plans"] }); setSelectedId(plan.id); },
  });
  const submitPlan = useMutation({
    mutationFn: async (id: string) => api.post(`/kitchen/weekly-meal-plans/${id}/submit`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["weekly-meal-plans"] });
      qc.invalidateQueries({ queryKey: ["approvals"] });
    },
  });
  const deletePlan = useMutation({
    mutationFn: async (id: string) => api.delete(`/kitchen/weekly-meal-plans/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["weekly-meal-plans"] }); setSelectedId(null); },
  });

  if (isLoading) return <Spinner />;

  const filtered = (plans ?? []).filter((p) => p.occasion_type === occasionType);
  const selected = filtered.find((p) => p.id === selectedId) ?? null;

  function handleNewWeek() {
    const dup = filtered.find((p) => p.week_start_date === newWeekDate);
    if (dup) { setSelectedId(dup.id); return; }
    createPlan.mutate();
  }

  return (
    <div>
      <p className="mb-3 text-[12px]" style={{ color: "var(--ink-400)" }}>
        Plan a full week of staff meals, then submit it in one go for approval — separate from the residence's own Weekly Menu.
      </p>
      <div className="mb-4 flex gap-1 rounded-xl p-1" style={{ background: "var(--surface-sunken)", width: "fit-content" }}>
        {STAFF_OCCASION_TYPES.map((o) => (
          <button
            key={o}
            onClick={() => { setOccasionType(o); setSelectedId(null); }}
            className="rounded-lg px-3.5 py-1.5 text-[13px] font-semibold"
            style={{
              background: occasionType === o ? "var(--surface)" : "transparent",
              color: occasionType === o ? "var(--ink-900)" : "var(--ink-500)",
              boxShadow: occasionType === o ? "var(--shadow-sm)" : "none",
            }}
          >
            {o}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {filtered.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelectedId(p.id)}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold"
            style={{
              borderColor: selectedId === p.id ? "var(--brass-600)" : "var(--border-strong)",
              background: selectedId === p.id ? "var(--brass-50)" : "var(--surface)",
            }}
          >
            Week of {p.week_start_date} <Badge tone={statusTone(p.status)}>{p.status}</Badge>
          </button>
        ))}
        <div className="flex items-center gap-1.5">
          <input type="date" className="rounded-lg border px-2 py-1.5 text-[12.5px]" style={{ borderColor: "var(--border-strong)" }}
            value={newWeekDate} onChange={(e) => setNewWeekDate(e.target.value)} />
          <Button variant="secondary" onClick={handleNewWeek} disabled={createPlan.isPending}>+ New Week</Button>
        </div>
      </div>

      {!selected ? (
        <EmptyState label="Pick a week above, or start a new one." />
      ) : (
        <>
          <Card className="mb-3 flex flex-wrap items-center justify-between gap-2 !p-3">
            <div>
              <div className="text-[14px] font-semibold">Week of {selected.week_start_date} — {selected.occasion_type}</div>
              <div className="mt-1 flex items-center gap-2 text-xs" style={{ color: "var(--ink-500)" }}>
                <Badge tone={statusTone(selected.status)}>{selected.status}</Badge>
                {selected.created_by_name && <span>Started by {selected.created_by_name}</span>}
              </div>
            </div>
            {selected.status === "Draft" && (
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={() => { if (confirm("Delete this draft week? This can't be undone.")) deletePlan.mutate(selected.id); }}
                  disabled={deletePlan.isPending}
                >
                  {deletePlan.isPending ? "Deleting..." : "Delete Draft"}
                </Button>
                <Button onClick={() => submitPlan.mutate(selected.id)} disabled={submitPlan.isPending || selected.entries.length === 0}>
                  {submitPlan.isPending ? "Submitting..." : "Submit Week for Approval"}
                </Button>
              </div>
            )}
          </Card>

          <Table>
            <thead><tr><Th>{" "}</Th>{PLAN_DAYS.map((d) => <Th key={d.key}>{d.label}</Th>)}</tr></thead>
            <tbody>
              {PLAN_MEALS.map((m) => (
                <tr key={m.key}>
                  <Td className="font-medium">{m.label}</Td>
                  {PLAN_DAYS.map((d) => {
                    const entry = selected.entries.find((e) => e.day_of_week === d.key && e.meal_type === m.key) ?? null;
                    const label = entry ? (entry.recipe_id ? recipes?.find((r) => r.id === entry.recipe_id)?.name ?? "Recipe" : entry.custom_meal_name) : "—";
                    const editable = selected.status === "Draft";
                    return (
                      <Td
                        key={d.key}
                        className={`max-w-[150px] truncate text-[12.5px] ${editable ? "cursor-pointer" : ""}`}
                        onClick={() => editable && setEditingCell({ day: d.key, meal: m.key, entry })}
                      >
                        {label}
                      </Td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}

      {editingCell && selected && (
        <PlanCellModal planId={selected.id} cell={editingCell} recipes={recipes} onClose={() => setEditingCell(null)} />
      )}
    </div>
  );
}

function PlanCellModal({
  planId, cell, recipes, onClose,
}: {
  planId: string;
  cell: { day: string; meal: WeeklyMealPlanEntry["meal_type"]; entry: WeeklyMealPlanEntry | null };
  recipes?: Recipe[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [recipeId, setRecipeId] = useState(cell.entry?.recipe_id ?? "");
  const [customName, setCustomName] = useState(cell.entry?.custom_meal_name ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () =>
      api.put(`/kitchen/weekly-meal-plans/${planId}/cell`, {
        day_of_week: cell.day,
        meal_type: cell.meal,
        recipe_id: recipeId || null,
        custom_meal_name: recipeId ? null : (customName || null),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["weekly-meal-plans"] }); onClose(); },
    onError: () => setError("Pick a recipe or type a custom meal name."),
  });

  const dayLabel = PLAN_DAYS.find((d) => d.key === cell.day)?.label ?? cell.day;
  const mealLabel = PLAN_MEALS.find((m) => m.key === cell.meal)?.label ?? cell.meal;

  return (
    <Modal title={`${mealLabel} — ${dayLabel}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-medium">Recipe
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={recipeId} onChange={(e) => setRecipeId(e.target.value)}>
            <option value="">— Custom / no matching recipe —</option>
            {recipes?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        {!recipeId && (
          <label className="flex flex-col gap-1 text-[13px] font-medium">Custom meal name
            <input placeholder="e.g. Chicken biryani" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={customName} onChange={(e) => setCustomName(e.target.value)} autoFocus />
          </label>
        )}
        {error && (
          <div className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--status-critical-bg)", color: "var(--status-critical)" }}>
            {error}
          </div>
        )}
        <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving..." : "Save"}</Button>
      </div>
    </Modal>
  );
}
