import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useCreate, useList } from "../api/hooks";
import { Icon } from "../components/icons";
import { Badge, Button, Card, DateRangeFilter, EmptyState, Modal, PageHeader, Spinner, StatTile, Table, Td, Th, statusTone } from "../components/ui";
import { daysUntil, fmtDate, todayIso } from "../lib/date";
import { MealLogTab, TransferTab, WasteTab } from "./KitchenTransactions";
import type { FoodInventoryBatchEntry, FoodInventoryItem, MealCategory, ProposedMenu, Recipe, RecipeIngredient, UnitOfMeasureEntry, WeeklyMealPlan, WeeklyMealPlanEntry } from "../types";

const TABS = ["Meal Log", "Menu Proposals", "Staff Meal Plan", "Recipes", "Food Inventory", "Raw Material Transfer", "Waste Log"] as const;

// A generic "Could not save" for a real 4xx/5xx and for a dead dev
// server/network drop look identical to the user otherwise — worth telling
// apart so "it's not working" doesn't always mean "the request was rejected."
function saveErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    if (!err.response) return "Can't reach the server — check your connection and try again.";
    const detail = (err.response.data as { detail?: string } | undefined)?.detail;
    if (detail) return detail;
  }
  return "Could not save — please try again.";
}

export function Kitchen() {
  // The tab lives in the URL so returning from a transaction page lands on it.
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab") ?? "";
  const tab: (typeof TABS)[number] = (TABS as readonly string[]).includes(requested) ? (requested as (typeof TABS)[number]) : "Meal Log";
  const setTab = (t: (typeof TABS)[number]) => setParams({ tab: t });
  const [modal, setModal] = useState(false);

  return (
    <div>
      <PageHeader
        title="Kitchen"
        subtitle="Recipes, food stock and meal production."
        action={
          tab === "Menu Proposals" ? <Button onClick={() => setModal(true)}>+ New Proposal</Button> :
          tab === "Recipes" ? <Link to="/kitchen/recipes/new"><Button>+ New Recipe</Button></Link> :
          tab === "Meal Log" ? <Link to="/kitchen/meal-log/new"><Button>+ Log Meal</Button></Link> :
          tab === "Raw Material Transfer" ? <Link to="/kitchen/transfers/new"><Button>+ Raw Material Transfer</Button></Link> :
          tab === "Waste Log" ? <Link to="/kitchen/waste/new"><Button>+ Log Waste</Button></Link> : undefined
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

      {tab === "Recipes" && <RecipesTab />}
      {tab === "Food Inventory" && <FoodInventoryTab />}
      {tab === "Raw Material Transfer" && <TransferTab />}
      {tab === "Waste Log" && <WasteTab />}
      {tab === "Meal Log" && <MealLogTab />}
      {tab === "Menu Proposals" && <ProposalsTab modal={modal} setModal={setModal} />}
      {tab === "Staff Meal Plan" && <StaffMealPlanTab />}
    </div>
  );
}

function RecipesTab() {
  const { data, isLoading } = useList<Recipe>("recipes", "/kitchen/recipes");
  const [search, setSearch] = useState("");
  if (isLoading) return <Spinner />;
  const q = search.trim().toLowerCase();
  const shown = (data ?? []).filter((r) => !q || r.name.toLowerCase().includes(q));
  return (
    <div>
      <input
        className="mb-4 w-full max-w-sm rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
        placeholder="Search recipes by name…" value={search} onChange={(e) => setSearch(e.target.value)}
      />
      {!data || data.length === 0 ? <EmptyState label="No recipes yet." /> : shown.length === 0 ? <EmptyState label="No recipes match your search." /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((r) => (
            <Link key={r.id} to={`/kitchen/recipes/${r.id}`}>
              <Card className="cursor-pointer">
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
              </Card>
            </Link>
          ))}
        </div>
      )}
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

export function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: loaded, isLoading } = useQuery<Recipe>({
    queryKey: ["recipe", id],
    queryFn: async () => (await api.get(`/kitchen/recipes/${id}`)).data,
    enabled: !!id,
  });
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  useEffect(() => {
    if (loaded && !recipe) setRecipe(loaded);
  }, [loaded, recipe]);
  const { data: foodInventory } = useList<FoodInventoryItem>("food-inventory", "/kitchen/food-inventory");
  const { data: uomsRaw } = useList<UnitOfMeasureEntry>("units-of-measure", "/units-of-measure");
  const { data: allRecipes } = useList<Recipe>("recipes", "/kitchen/recipes");
  const uoms = [...(uomsRaw ?? [])].sort((a, b) => a.label.localeCompare(b.label));
  const [source, setSource] = useState<"stock" | "sub_recipe">("stock");
  const [ing, setIng] = useState<{ food_inventory_id: string; sub_recipe_id: string; qty: number; yield_pct: number; override_unit_id: string }>(
    { food_inventory_id: "", sub_recipe_id: "", qty: 0, yield_pct: 100, override_unit_id: "" }
  );
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // Lets Enter (in the qty/yield fields) add the ingredient and jump focus
  // straight back to the item picker, so adding several ingredients in a
  // row doesn't need a mouse trip back up to the dropdown each time.
  const stockPickerRef = useRef<HTMLSelectElement>(null);
  const subRecipePickerRef = useRef<HTMLSelectElement>(null);

  // raw_yield_g is never sent — the server derives it from the ingredient
  // list itself (see kitchen.py's _compute_raw_yield_g), so it can't drift
  // out of sync with what's actually in the recipe. prep_loss_pct and
  // portion_size_g are the two stored fields; "after-cook weight" and
  // "number of portions" are convenience alternate inputs that compute an
  // equivalent value for one of these and pass it in explicitly, rather
  // than going through recipe state — that state wouldn't be updated yet
  // by the time a same-tick mutate() call reads it.
  const save = useMutation({
    mutationFn: async (patch: {
      ingredients: IngredientPayload[]; prep_loss_pct?: number; portions?: number | null; portion_size_g?: number | null;
    }) =>
      (await api.patch<Recipe>(`/kitchen/recipes/${recipe!.id}`, {
        name: recipe!.name, category: recipe!.category, allergens: recipe!.allergens, notes: recipe!.notes,
        prep_loss_pct: patch.prep_loss_pct ?? recipe!.prep_loss_pct,
        // null size = derive it from yield / portions; only a custom or legacy size is stored.
        portions: "portions" in patch ? patch.portions : recipe!.portions,
        portion_size_g: "portion_size_g" in patch ? patch.portion_size_g : (recipe!.portion_size_custom ? recipe!.portion_size_g : null),
        cooking_method: recipe!.cooking_method, method: recipe!.method, ingredients: patch.ingredients,
      })).data,
    // Stays open and refreshes with the saved recipe — closing after every
    // single line item made it impossible to add more than one in a row.
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ["recipes"] });
      setRecipe(updated);
      setError(null);
      setSavedAt(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    },
    onError: (err: unknown) => setError(saveErrorMessage(err)),
  });

  if (isLoading || !recipe) return <Spinner />;

  // A recipe can't reference itself as a sub-recipe (the server also
  // blocks any transitive cycle) — filtering it out of the picker avoids
  // an obvious dead-end pick before that round-trip even happens.
  const subRecipeOptions = (allRecipes ?? []).filter((r) => r.id !== recipe.id).sort((a, b) => a.name.localeCompare(b.name));

  // An ingredient picked but not yet added would be lost on leaving; Save adds it.
  const pendingIngredient = source === "stock" ? !!ing.food_inventory_id : !!ing.sub_recipe_id;
  function saveAll() {
    if (pendingIngredient) addIngredient();
    else save.mutate({ ingredients: recipe!.ingredients.map(toPayload) });
  }

  function addIngredient() {
    if (source === "stock" && !ing.food_inventory_id) return;
    if (source === "sub_recipe" && !ing.sub_recipe_id) return;
    save.mutate({
      ingredients: [
        ...recipe!.ingredients.map(toPayload),
        {
          food_inventory_id: source === "stock" ? ing.food_inventory_id : null,
          sub_recipe_id: source === "sub_recipe" ? ing.sub_recipe_id : null,
          qty: ing.qty,
          yield_pct: ing.yield_pct,
          override_unit_id: source === "stock" ? (ing.override_unit_id || null) : null,
        },
      ],
    });
    setIng({ food_inventory_id: "", sub_recipe_id: "", qty: 0, yield_pct: 100, override_unit_id: "" });
    (source === "stock" ? stockPickerRef : subRecipePickerRef).current?.focus();
  }
  function handleQtyKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (source === "stock" ? ing.food_inventory_id : ing.sub_recipe_id) addIngredient();
  }
  function removeIngredient(idx: number) {
    save.mutate({ ingredients: recipe!.ingredients.filter((_, i) => i !== idx).map(toPayload) });
  }
  function commitPrepLoss(pct: number) {
    const clamped = Math.max(0, Math.min(100, pct));
    setRecipe((r) => (r ? { ...r, prep_loss_pct: clamped } : r));
    save.mutate({ ingredients: recipe!.ingredients.map(toPayload), prep_loss_pct: clamped });
  }
  function commitAfterCookWeight(weightG: number) {
    if (!recipe!.raw_yield_g || !weightG) return;
    const pct = Math.max(0, Math.min(100, Math.round((1 - weightG / recipe!.raw_yield_g) * 10000) / 100));
    setRecipe((r) => (r ? { ...r, prep_loss_pct: pct } : r));
    save.mutate({ ingredients: recipe!.ingredients.map(toPayload), prep_loss_pct: pct });
  }
  // A custom size is a stated serving weight; with a fixed portion count it
  // does not change the count (a recipe used as a sub-recipe may be portioned
  // differently). On a legacy recipe with no fixed count it still sets the count.
  function commitPortionSize(size: number) {
    if (!size) return;
    save.mutate({ ingredients: recipe!.ingredients.map(toPayload), portion_size_g: size });
  }
  function useAutoPortionSize() {
    save.mutate({ ingredients: recipe!.ingredients.map(toPayload), portion_size_g: null });
  }
  function commitNumberOfPortions(portions: number) {
    const n = Math.floor(portions);
    if (n < 1) return;
    // A legacy size no longer applies once the count is fixed.
    save.mutate({
      ingredients: recipe!.ingredients.map(toPayload), portions: n,
      ...(recipe!.portions == null ? { portion_size_g: null } : {}),
    });
  }
  const selectedStock = foodInventory?.find((f) => f.id === ing.food_inventory_id);
  // Mirrors app/services/units.py's family check — only offer an override
  // unit the backend will actually accept, instead of letting the user
  // pick e.g. "kg" for a "units"-tracked item and only finding out it's
  // rejected after hitting Add.
  const stockUom = uoms.find((u) => u.label === selectedStock?.unit);
  const compatibleUoms = stockUom
    ? uoms.filter((u) => u.label !== stockUom.label && (u.base_unit_id ?? u.id) === (stockUom.base_unit_id ?? stockUom.id))
    : [];

  return (
    <div>
      <Link
        to="/kitchen?tab=Recipes" className="mb-3 inline-block text-[13px] font-semibold" style={{ color: "var(--brass-600)" }}
        onClick={(e) => { if (pendingIngredient && !window.confirm("An ingredient is selected but not added yet. Leave without saving it?")) e.preventDefault(); }}
      >← Back to Kitchen</Link>
      <PageHeader
        title={recipe.name}
        action={
          <div className="flex items-center gap-3">
            <span className="text-[12px]" style={{ color: pendingIngredient ? "var(--status-warning)" : "var(--ink-400)" }}>
              {save.isPending ? "Saving..." : pendingIngredient ? "Unsaved ingredient" : savedAt ? `Saved ${savedAt}` : "No unsaved changes"}
            </span>
            <Button onClick={saveAll} disabled={save.isPending}>Save</Button>
          </div>
        }
      />
      <div className="flex flex-col gap-4 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{recipe.category}</Badge>
          <Badge>{recipe.cooking_method || "—"}</Badge>
          {recipe.allergens.length > 0 ? (
            recipe.allergens.map((a) => <Badge key={a} tone="warning">{a}</Badge>)
          ) : (
            <Badge tone="good">No allergens</Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Raw Yield" value={recipe.raw_yield_g} suffix="g"
            sub="Auto, from ingredients below"
          />
          <EditableTile
            label="Prep Loss (%)" value={recipe.prep_loss_pct}
            onCommit={commitPrepLoss}
          />
          <EditableTile
            label="After-Cook Weight" suffix="g" value={recipe.cost.final_yield_g}
            onCommit={commitAfterCookWeight}
            sub="Alternate to Prep Loss"
          />
          <StatTile label="Cost / Portion" value={`KWD ${recipe.cost.cost_per_portion.toFixed(3)}`} sub={`Recipe total KWD ${recipe.cost.total_cost.toFixed(3)}`} />
          <EditableTile
            label="Portion Size (g)" value={recipe.portion_size_g}
            onCommit={commitPortionSize}
            sub={recipe.portion_size_custom ? (recipe.portions != null ? "Custom size" : "Sets the number of portions") : "Auto: yield ÷ portions"}
            action={recipe.portion_size_custom && recipe.portions != null ? { label: "Use auto size", onClick: useAutoPortionSize } : undefined}
          />
          <EditableTile
            label="Number of Portions" value={recipe.cost.portions}
            onCommit={commitNumberOfPortions}
            sub={recipe.portions != null ? "Fixed count" : "Counted from portion size"}
          />
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
                <select ref={stockPickerRef} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
                  value={ing.food_inventory_id} onChange={(e) => setIng((s) => ({ ...s, food_inventory_id: e.target.value }))}>
                  <option value="">Select stock item…</option>
                  {foodInventory?.map((f) => <option key={f.id} value={f.id}>{f.name} (KWD {f.cost.toFixed(3)}/{f.unit})</option>)}
                </select>
              </label>
              <label className="flex w-20 flex-col gap-1 text-[13px] font-medium">Qty
                <input type="number" step="any" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
                  value={ing.qty} onChange={(e) => setIng((s) => ({ ...s, qty: Number(e.target.value) }))} onKeyDown={handleQtyKeyDown} />
              </label>
              <label className="flex w-24 flex-col gap-1 text-[13px] font-medium">Unit
                <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
                  value={ing.override_unit_id} onChange={(e) => setIng((s) => ({ ...s, override_unit_id: e.target.value }))}>
                  <option value="">{selectedStock?.unit ?? "unit"} (default)</option>
                  {compatibleUoms.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                </select>
              </label>
            </>
          ) : (
            <>
              <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-[13px] font-medium">Sub-recipe
                <select ref={subRecipePickerRef} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
                  value={ing.sub_recipe_id} onChange={(e) => setIng((s) => ({ ...s, sub_recipe_id: e.target.value }))}>
                  <option value="">Select recipe…</option>
                  {subRecipeOptions.map((r) => (
                    <option key={r.id} value={r.id}>{r.name} (KWD {r.cost.total_cost.toFixed(3)}/{r.cost.final_yield_g}g)</option>
                  ))}
                </select>
              </label>
              <label className="flex w-24 flex-col gap-1 text-[13px] font-medium">Qty (g)
                <input type="number" step="any" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
                  value={ing.qty} onChange={(e) => setIng((s) => ({ ...s, qty: Number(e.target.value) }))} onKeyDown={handleQtyKeyDown} />
              </label>
            </>
          )}
          <label className="flex w-20 flex-col gap-1 text-[13px] font-medium">Yield %
            <input type="number" min={1} max={100} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={ing.yield_pct} onChange={(e) => setIng((s) => ({ ...s, yield_pct: Number(e.target.value) }))} onKeyDown={handleQtyKeyDown} />
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
    </div>
  );
}

// A StatTile that's also a number input — saves on blur. The displayed
// value only ever reflects the server's own recipe state (never a bare
// local edit that might not have actually saved), so a local text buffer
// syncs from `value` on every prop change rather than being the source of
// truth itself.
function EditableTile({
  label, value, suffix, sub, onCommit, action,
}: {
  label: string; value: number; suffix?: string; sub?: string; onCommit: (v: number) => void;
  action?: { label: string; onClick: () => void };
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <Card className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>{label}</span>
      <div className="flex items-baseline gap-1">
        <input
          type="number" step="any"
          className="w-20 rounded-lg border px-2 py-0.5 font-display text-xl font-semibold"
          style={{ borderColor: "var(--border-strong)" }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => { const n = Number(text); if (!Number.isNaN(n)) onCommit(n); }}
        />
        {suffix && <span className="text-xs" style={{ color: "var(--ink-400)" }}>{suffix}</span>}
      </div>
      {sub && <span className="text-[11px]" style={{ color: "var(--ink-400)" }}>{sub}</span>}
      {action && (
        <button type="button" className="self-start text-[11px] font-semibold" style={{ color: "var(--brass-600)" }} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </Card>
  );
}

export function NewRecipePage() {
  const navigate = useNavigate();
  const create = useCreate<Recipe>("recipes", "/kitchen/recipes");
  const [form, setForm] = useState({
    name: "", category: "Dinner",
    allergens: "", method: "", notes: "",
    // Deliberately empty: the chef states how many portions the recipe makes.
    portions: "", customSize: false, portion_size_g: "",
  });
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { customSize, portion_size_g, portions, ...rest } = form;
      const created = await create.mutateAsync({
        ...rest,
        portions: Number(portions),
        portion_size_g: customSize ? Number(portion_size_g) : null,
        allergens: form.allergens ? form.allergens.split(",").map((s) => s.trim()).filter(Boolean) : [],
        ingredients: [],
      } as never);
      navigate(`/kitchen/recipes/${created.id}`);
    } catch (err: unknown) {
      setError(saveErrorMessage(err));
    }
  }

  return (
    <div>
      <Link to="/kitchen" className="mb-3 inline-block text-[13px] font-semibold" style={{ color: "var(--brass-600)" }}>← Back to Kitchen</Link>
      <PageHeader title="New recipe" />
      <form onSubmit={onSubmit} className="flex flex-col gap-3 max-w-2xl">
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
          <label className="flex flex-col gap-1 text-[13px] font-medium">Allergens
            <input placeholder="e.g. Fish, Dairy" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.allergens} onChange={(e) => setForm((s) => ({ ...s, allergens: e.target.value }))} />
          </label>
        </div>
        <div className="flex flex-col gap-2 rounded-xl border p-3" style={{ borderColor: "var(--border-strong)" }}>
          <label className="flex max-w-xs flex-col gap-1 text-[13px] font-medium">Number of portions *
            <input
              required type="number" min={1} step={1} placeholder="e.g. 10"
              className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.portions} onChange={(e) => setForm((s) => ({ ...s, portions: e.target.value }))}
            />
            <span className="text-[11.5px] font-normal" style={{ color: "var(--ink-400)" }}>
              How many servings this recipe makes. Cost per portion and Log Meal scaling are based on this.
            </span>
          </label>
          <label className="flex items-center gap-2 text-[13px] font-medium">
            <input type="checkbox" checked={form.customSize} onChange={(e) => setForm((s) => ({ ...s, customSize: e.target.checked }))} />
            Use a custom portion size
          </label>
          {form.customSize && (
            <label className="flex max-w-xs flex-col gap-1 text-[13px] font-medium">Portion size (g) *
              <input
                required type="number" min={1} step="any" placeholder="e.g. 150"
                className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
                value={form.portion_size_g} onChange={(e) => setForm((s) => ({ ...s, portion_size_g: e.target.value }))}
              />
              <span className="text-[11.5px] font-normal" style={{ color: "var(--ink-400)" }}>
                Leave the box unticked to work the portion weight out from the finished yield.
              </span>
            </label>
          )}
        </div>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Preparation method
          <textarea placeholder="Mise en place & preparation steps" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.method} onChange={(e) => setForm((s) => ({ ...s, method: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Notes / chef instructions
          <textarea placeholder="Optional notes for kitchen staff" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.notes} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} />
        </label>
        <p className="text-[12px]" style={{ color: "var(--ink-400)" }}>
          On the next screen: add raw material line items (item, qty, unit, cost, yield) — raw yield is calculated
          automatically from those quantities. Then set preparation loss (or the after-cook weight directly); portion size can be
          adjusted there too.
        </p>
        {error && (
          <div className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--status-critical-bg)", color: "var(--status-critical)" }}>
            {error}
          </div>
        )}
        <Button type="submit" disabled={create.isPending}>{create.isPending ? "Saving..." : "Save Recipe & Add Ingredients"}</Button>
      </form>
    </div>
  );
}

function FoodInventoryTab() {
  const { data, isLoading } = useList<FoodInventoryItem>("food-inventory", "/kitchen/food-inventory");
  const [batchesFor, setBatchesFor] = useState<FoodInventoryItem | null>(null);
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
            <tr key={f.id} className="cursor-pointer" onClick={() => setBatchesFor(f)}>
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
      {batchesFor && <FoodBatchesModal item={batchesFor} onClose={() => setBatchesFor(null)} />}
    </div>
  );
}

function FoodBatchesModal({ item, onClose }: { item: FoodInventoryItem; onClose: () => void }) {
  const { data: batches, isLoading } = useQuery<FoodInventoryBatchEntry[]>({
    queryKey: ["food-inventory-batches", item.id],
    queryFn: async () => (await api.get(`/kitchen/food-inventory/${item.id}/batches`)).data,
  });

  return (
    <Modal title={`${item.name} — batches`} onClose={onClose}>
      {isLoading ? (
        <Spinner />
      ) : !batches || batches.length === 0 ? (
        <EmptyState label="No batches on record — this item's stock predates FEFO tracking or was set directly." />
      ) : (
        <Table>
          <thead><tr><Th>Batch</Th><Th>Qty</Th><Th>Expiry</Th><Th>Cost/unit</Th><Th>Received</Th></tr></thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id}>
                <Td>{b.batch_label ?? "—"}</Td>
                <Td>{b.qty} {item.unit}</Td>
                <Td>{b.expiry ?? "—"}</Td>
                <Td>KWD {b.cost.toFixed(3)}</Td>
                <Td>{b.received_date}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Modal>
  );
}

const OCCASION_TYPES = ["Breakfast", "Lunch", "Dinner", "Special Dinner", "Events"];

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
                      {recipeName(o.recipe_id)}{o.portions ? ` × ${o.portions}` : ""}
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
              return (
                <div key={i} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--surface-sunken)" }}>
                  <div>
                    <span className="font-medium">{r ? r.name : "Recipe not on file"}</span>
                    <span className="ml-1" style={{ color: "var(--ink-400)" }}>
                      {o.portions ? `· ${o.portions} portions` : ""}{o.note ? ` — ${o.note}` : ""}
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
  // recipe id -> portions needed; a recipe is an option when it has an entry.
  const [portionsByRecipe, setPortionsByRecipe] = useState<Record<string, number>>({});
  useEffect(() => {
    if (mealCategories.length > 0 && !form.category) {
      setForm((s) => ({ ...s, category: mealCategories[0].label }));
    }
  }, [mealCategories, form.category]);

  function toggleOption(r: Recipe) {
    setPortionsByRecipe((s) => {
      if (r.id in s) {
        const { [r.id]: _removed, ...rest } = s;
        return rest;
      }
      return { ...s, [r.id]: Math.max(1, r.cost.portions) };
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await create.mutateAsync({
      ...form,
      options: Object.entries(portionsByRecipe).map(([recipe_id, portions]) => ({ recipe_id, note: null, selected: false, portions })),
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
              <div key={r.id}>
                <div className="flex items-center gap-2 text-[13px] font-normal">
                  <label className="flex flex-1 items-center gap-2">
                    <input type="checkbox" checked={r.id in portionsByRecipe} onChange={() => toggleOption(r)} />
                    {r.name}
                  </label>
                  {r.id in portionsByRecipe && (
                    <label className="flex items-center gap-1.5 text-[12px]">
                      Portions
                      <input
                        type="number" min={1} className="w-20 rounded-lg border px-2 py-1 text-right text-sm" style={{ borderColor: "var(--border-strong)" }}
                        value={portionsByRecipe[r.id]}
                        onChange={(e) => setPortionsByRecipe((s) => ({ ...s, [r.id]: Math.max(1, Math.floor(Number(e.target.value) || 1)) }))}
                      />
                    </label>
                  )}
                </div>
              </div>
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
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["weekly-meal-plans"] });
      qc.invalidateQueries({ queryKey: ["approvals"] });
      // The submitted week moves to History; clear the entry screen and
      // point the picker at the following week so the next one can start.
      const submitted = plans?.find((p) => p.id === id);
      if (submitted) {
        const next = new Date(submitted.week_start_date + "T00:00:00");
        next.setDate(next.getDate() + 7);
        setNewWeekDate(next.toISOString().slice(0, 10));
      }
      setSelectedId(null);
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
        {filtered.filter((p) => p.status === "Draft").map((p) => (
          <button
            key={p.id}
            onClick={() => setSelectedId(p.id)}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold"
            style={{
              borderColor: selectedId === p.id ? "var(--brass-600)" : "var(--border-strong)",
              background: selectedId === p.id ? "var(--brass-50)" : "var(--surface)",
            }}
          >
            Draft — week of {p.week_start_date}
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
              <div className="text-[14px] font-semibold">
                {selected.code && <span className="mr-2" style={{ color: "var(--ink-500)" }}>{selected.code}</span>}
                Week of {selected.week_start_date} — {selected.occasion_type}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--ink-500)" }}>
                <Badge tone={statusTone(selected.status)}>{selected.status}</Badge>
                {selected.created_by_name && <span>Created by {selected.created_by_name}</span>}
                {selected.approved_by_name && <span>· Approved by {selected.approved_by_name}</span>}
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

      <PlanHistory plans={filtered.filter((p) => p.status !== "Draft")} selectedId={selectedId} onView={setSelectedId} />

      {editingCell && selected && (
        <PlanCellModal planId={selected.id} cell={editingCell} recipes={recipes} onClose={() => setEditingCell(null)} />
      )}
    </div>
  );
}

// Submitted and approved plans leave the working area and live here, so the
// tab stays one working draft plus one searchable table.
function PlanHistory({ plans, selectedId, onView }: { plans: WeeklyMealPlan[]; selectedId: string | null; onView: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const q = search.trim().toLowerCase();
  const rows = plans.filter((p) =>
    (!status || p.status === status) &&
    (!dateFrom || p.week_start_date >= dateFrom) &&
    (!dateTo || p.week_start_date <= dateTo) &&
    (!q || [p.code, p.occasion_type, p.created_by_name, p.approved_by_name].some((v) => v?.toLowerCase().includes(q)))
  );
  const field = "rounded-lg border px-2.5 py-1.5 text-sm";
  const border = { borderColor: "var(--border-strong)" };

  return (
    <div className="mt-6">
      <h3 className="mb-2 text-[13px] font-semibold" style={{ color: "var(--ink-700)" }}>Pending approval &amp; history</h3>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input className={field} style={border} placeholder="Search reference, creator, approver…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className={field} style={border} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="Submitted">Submitted</option>
          <option value="Approved">Approved</option>
        </select>
        <DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} />
      </div>
      {rows.length === 0 ? <EmptyState label="No submitted or approved meal plans match." /> : (
        <Table>
          <thead>
            <tr><Th>Week of</Th><Th>Meal plan ref</Th><Th>Cost center / department</Th><Th>Status</Th><Th>Created by</Th><Th>Approved by</Th><Th>{" "}</Th></tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} style={selectedId === p.id ? { background: "var(--brass-50)" } : undefined}>
                <Td>{fmtDate(p.week_start_date)}</Td>
                <Td className="font-medium">{p.code ?? "—"}</Td>
                <Td>{p.occasion_type}</Td>
                <Td><Badge tone={statusTone(p.status)}>{p.status}</Badge></Td>
                <Td>{p.created_by_name ?? "—"}</Td>
                <Td>{p.approved_by_name ?? "—"}</Td>
                <Td>
                  <button className="text-xs font-semibold" style={{ color: "var(--brass-600)" }}
                    onClick={() => { onView(p.id); window.scrollTo({ top: 0, behavior: "smooth" }); }}>View</button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
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
