import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { FoodInventoryItem, Recipe, UnitOfMeasureEntry } from "../types";
import { Button } from "./ui";

export type IngredientPayload = {
  food_inventory_id: string | null;
  sub_recipe_id: string | null;
  qty: number;
  yield_pct: number;
  override_unit_id: string | null;
};

export interface IngredientAdderHandle {
  /** Adds the half-filled row, if there is one, and returns it (null when there was none). */
  commit: () => IngredientPayload | null;
}

const EMPTY = { food_inventory_id: "", sub_recipe_id: "", qty: 0, yield_pct: 100, override_unit_id: "" };

// The add-an-ingredient row shared by the new recipe page and the recipe page:
// a stock item or a sub-recipe, quantity, optional unit and yield %. Enter in
// the number fields adds it and puts focus back on the picker so several can
// be added in a row.
export const IngredientAdder = forwardRef<IngredientAdderHandle, {
  foodInventory?: FoodInventoryItem[];
  uoms: UnitOfMeasureEntry[];
  subRecipeOptions: Recipe[];
  onAdd: (ingredient: IngredientPayload) => void;
  disabled?: boolean;
  onPendingChange?: (pending: boolean) => void;
}>(function IngredientAdder({ foodInventory, uoms, subRecipeOptions, onAdd, disabled, onPendingChange }, ref) {
  const [source, setSource] = useState<"stock" | "sub_recipe">("stock");
  const [ing, setIng] = useState(EMPTY);
  const stockPickerRef = useRef<HTMLSelectElement>(null);
  const subRecipePickerRef = useRef<HTMLSelectElement>(null);

  const pending = source === "stock" ? !!ing.food_inventory_id : !!ing.sub_recipe_id;
  useEffect(() => onPendingChange?.(pending), [pending, onPendingChange]);

  const selectedStock = foodInventory?.find((f) => f.id === ing.food_inventory_id);
  // Mirrors app/services/units.py's family check - only offer an override
  // unit the backend will actually accept.
  const stockUom = uoms.find((u) => u.label === selectedStock?.unit);
  const compatibleUoms = stockUom
    ? uoms.filter((u) => u.label !== stockUom.label && (u.base_unit_id ?? u.id) === (stockUom.base_unit_id ?? stockUom.id))
    : [];

  function addIngredient(): IngredientPayload | null {
    if (!pending) return null;
    const payload: IngredientPayload = {
      food_inventory_id: source === "stock" ? ing.food_inventory_id : null,
      sub_recipe_id: source === "sub_recipe" ? ing.sub_recipe_id : null,
      qty: ing.qty,
      yield_pct: ing.yield_pct,
      override_unit_id: source === "stock" ? (ing.override_unit_id || null) : null,
    };
    onAdd(payload);
    setIng(EMPTY);
    (source === "stock" ? stockPickerRef : subRecipePickerRef).current?.focus();
    return payload;
  }
  useImperativeHandle(ref, () => ({ commit: addIngredient }));

  function handleQtyKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    addIngredient();
  }

  return (
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
        disabled={disabled || (source === "stock" ? !ing.food_inventory_id : !ing.sub_recipe_id)}>
        + Add
      </Button>
    </div>
  );
});
