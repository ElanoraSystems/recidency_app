import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Badge, Button, Card } from "../components/ui";
import { createDraftRequest } from "../pages/Purchasing";
import type { KitchenNeeds, Recipe } from "../types";

// "1. Whisk the yolks" and "Whisk the yolks" both become the step text.
export function methodSteps(method: string | null): string[] {
  return (method ?? "").split("\n").map((s) => s.replace(/^\s*(step\s*)?\d+[.):-]?\s*/i, "").trim()).filter(Boolean);
}

export function useNeeds(items: { recipe_id: string; portions: number }[], costCenterId?: string) {
  return useQuery<KitchenNeeds>({
    queryKey: ["kitchen-needs", items, costCenterId ?? null],
    queryFn: async () => (await api.post("/kitchen/needs", { items, cost_center_id: costCenterId || null })).data,
    enabled: items.length > 0 && items.every((i) => i.portions > 0),
    staleTime: 30_000,
  });
}

// Turns the shortages of a needs result into a draft purchase request.
export async function requestShortItems(needs: KitchenNeeds): Promise<string | null> {
  const lines = needs.lines.filter((l) => l.short > 0 && l.item_master_id).map((l) => ({ item_master_id: l.item_master_id!, qty: Math.ceil(l.short * 100) / 100 }));
  return lines.length ? createDraftRequest(lines) : null;
}

// Cook from a recipe: scale it, see whether there is enough stock, follow the
// steps full screen, or print a one-page card. Nothing here edits the recipe.
export function RecipeCook({ recipe }: { recipe: Recipe }) {
  const base = recipe.cost.portions;
  const [portions, setPortions] = useState(base);
  const [cooking, setCooking] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { data: needs } = useNeeds([{ recipe_id: recipe.id, portions }]);
  const factor = portions / base;
  const steps = methodSteps(recipe.method);
  const stockOf = (foodId: string | null) => (foodId ? needs?.lines.find((l) => l.food_inventory_id === foodId) : undefined);
  const short = needs?.lines.filter((l) => l.short > 0) ?? [];
  const scaled = (n: number) => +(n * factor).toFixed(3);

  async function addShort() {
    if (!needs) return;
    setBusy(true);
    try {
      const id = await requestShortItems(needs);
      if (id) navigate(`/purchasing/requests/${id}/edit`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold">Cook from this recipe</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setCooking(true)} disabled={steps.length === 0}>Cook mode</Button>
          <Link to={`/kitchen/meal-log/new?recipe=${recipe.id}&portions=${portions}`}><Button size="sm" variant="secondary">Log as served</Button></Link>
          <Button size="sm" variant="secondary" onClick={() => window.print()}>Print card</Button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3 text-[13px]">
        <span className="font-semibold">Scale to</span>
        <div className="flex items-center overflow-hidden rounded-lg border" style={{ borderColor: "var(--border-strong)" }}>
          <button type="button" className="px-3 py-1.5 font-bold" style={{ background: "var(--surface-sunken)" }} onClick={() => setPortions((p) => Math.max(1, p - 1))}>−</button>
          <input type="number" min={1} className="w-16 border-x px-2 py-1.5 text-center font-semibold" style={{ borderColor: "var(--border-strong)", background: "var(--surface)" }}
            value={portions} onChange={(e) => setPortions(Math.max(1, Math.floor(Number(e.target.value)) || 1))} />
          <button type="button" className="px-3 py-1.5 font-bold" style={{ background: "var(--surface-sunken)" }} onClick={() => setPortions((p) => p + 1)}>+</button>
        </div>
        <span style={{ color: "var(--ink-500)" }}>portions{portions !== base && <> (recipe makes {base}) · <button type="button" className="font-semibold" style={{ color: "var(--brass-600)" }} onClick={() => setPortions(base)}>Reset</button></>}</span>
        <span className="ml-auto font-semibold tabular-nums">KWD {(recipe.cost.total_cost * factor).toFixed(3)} · {recipe.cost.cost_per_portion.toFixed(3)} each</span>
      </div>

      {needs && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-[13px]"
          style={{ background: short.length === 0 ? "var(--status-good-bg)" : "var(--status-warning-bg)" }}>
          {short.length === 0 ? (
            <b style={{ color: "var(--status-good)" }}>Enough stock for {portions} portions</b>
          ) : (
            <>
              <b style={{ color: "var(--status-warning)" }}>Enough for {needs.max_portions ?? 0} of {portions} portions</b>
              <span style={{ color: "var(--ink-700)" }}>Short: {short.slice(0, 4).map((l) => `${l.name} ${l.short} ${l.unit}`).join(", ")}{short.length > 4 ? ` and ${short.length - 4} more` : ""}</span>
              <button type="button" disabled={busy} className="ml-auto font-bold" style={{ color: "var(--brass-700)" }} onClick={addShort}>
                {busy ? "Creating…" : "Add to purchase request"}
              </button>
            </>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--ink-400)" }}><th className="pb-1.5">Ingredient</th><th className="pb-1.5 text-right">Quantity</th><th className="pb-1.5 text-right">KWD</th><th className="pb-1.5 pl-4">In stock</th></tr></thead>
          <tbody>
            {recipe.ingredients.map((i, idx) => {
              const st = stockOf(i.food_inventory_id);
              return (
                <tr key={idx} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="py-1.5 font-medium">{i.name}</td>
                  <td className="py-1.5 text-right tabular-nums">{scaled(i.qty)} {i.unit}</td>
                  <td className="py-1.5 text-right tabular-nums">{i.line_cost > 0 ? scaled(i.line_cost).toFixed(3) : <Badge tone="warning">No price</Badge>}</td>
                  <td className="py-1.5 pl-4">
                    {i.sub_recipe_id ? <span style={{ color: "var(--ink-400)" }}>Prepared</span>
                      : !st ? "—"
                      : st.short > 0 ? <Badge tone="critical">Short {st.short} {st.unit}</Badge> : <Badge tone="good">Enough</Badge>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {steps.length > 0 && (
        <ol className="mt-4 flex flex-col gap-2 text-[13px]">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-extrabold" style={{ background: "var(--brass-100)", color: "var(--brass-700)" }}>{i + 1}</span>
              <span className="pt-0.5">{s}</span>
            </li>
          ))}
        </ol>
      )}

      {cooking && <CookMode recipe={recipe} portions={portions} factor={factor} steps={steps} onClose={() => setCooking(false)} />}

      {/* Shown only when printing: a one-page kitchen card. */}
      <div className="print-card">
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>{recipe.name}</h1>
        <p>{recipe.category} · {portions} portions{recipe.allergens.length > 0 && ` · Contains: ${recipe.allergens.join(", ")}`}</p>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 12 }}>Ingredients</h2>
        <ul>{recipe.ingredients.map((i, idx) => <li key={idx}>{scaled(i.qty)} {i.unit} {i.name}</li>)}</ul>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 12 }}>Method</h2>
        <ol>{steps.map((s, i) => <li key={i} style={{ marginBottom: 6 }}>{s}</li>)}</ol>
        {recipe.notes && <p style={{ marginTop: 12 }}>Notes: {recipe.notes}</p>}
      </div>
    </Card>
  );
}

// One step at a time in large type, with the screen kept awake.
function CookMode({ recipe, portions, factor, steps, onClose }: { recipe: Recipe; portions: number; factor: number; steps: string[]; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [showIngredients, setShowIngredients] = useState(false);
  const [done, setDone] = useState<Set<number>>(new Set());

  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen").then((l) => { lock = l; }).catch(() => {});
    return () => { lock?.release().catch(() => {}); };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "var(--bg)" }}>
      <div className="flex items-center justify-between gap-3 border-b px-5 py-3" style={{ borderColor: "var(--border)" }}>
        <div>
          <div className="font-display text-lg font-semibold">{recipe.name}</div>
          <div className="text-[12px]" style={{ color: "var(--ink-500)" }}>{portions} portions · step {step + 1} of {steps.length}</div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowIngredients((v) => !v)}>{showIngredients ? "Show step" : "Ingredients"}</Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
      <div className="flex flex-1 items-center overflow-y-auto px-6 py-6">
        {showIngredients ? (
          <ul className="mx-auto flex w-full max-w-2xl flex-col gap-2 text-[20px]">
            {recipe.ingredients.map((i, idx) => (
              <li key={idx}>
                <label className="flex cursor-pointer items-center gap-3">
                  <input type="checkbox" className="h-5 w-5" checked={done.has(idx)}
                    onChange={() => setDone((d) => { const n = new Set(d); if (n.has(idx)) n.delete(idx); else n.add(idx); return n; })} />
                  <span style={{ textDecoration: done.has(idx) ? "line-through" : "none", color: done.has(idx) ? "var(--ink-400)" : undefined }}>
                    <b>{+(i.qty * factor).toFixed(3)} {i.unit}</b> {i.name}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mx-auto max-w-2xl text-[28px] font-semibold leading-snug">{steps[step]}</p>
        )}
      </div>
      <div className="flex gap-3 border-t px-5 py-4" style={{ borderColor: "var(--border)" }}>
        <Button variant="secondary" className="flex-1 !py-4 !text-lg" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>Previous</Button>
        <Button className="flex-1 !py-4 !text-lg" onClick={() => (step === steps.length - 1 ? onClose() : setStep((s) => s + 1))}>{step === steps.length - 1 ? "Finish" : "Next step"}</Button>
      </div>
    </div>
  );
}
