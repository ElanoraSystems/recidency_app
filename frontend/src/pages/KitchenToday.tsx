import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useList } from "../api/hooks";
import { RecipePlate } from "../components/RecipePhotos";
import { requestShortItems, useNeeds } from "../components/RecipeCook";
import { Badge, Button, Card, Spinner } from "../components/ui";
import { addDays, daysUntil, todayIso } from "../lib/date";
import type { FoodInventoryItem, MealLogEntry, Recipe, WasteLog, WeeklyMealPlan } from "../types";

const SERVICES = [{ key: "breakfast", label: "Breakfast" }, { key: "lunch", label: "Lunch" }, { key: "dinner", label: "Dinner" }] as const;
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const dayKey = (iso: string) => DAY_KEYS[new Date(iso + "T00:00:00Z").getUTCDay()];

// The dishes planned for one date, from every weekly plan that covers it.
// Plans still in Draft only count when no submitted or approved plan has a
// dish for that day.
function plannedOn(plans: WeeklyMealPlan[], recipes: Recipe[], iso: string) {
  const covering = plans.filter((p) => p.week_start_date <= iso && iso < addDays(p.week_start_date, 7));
  const onDay = (list: WeeklyMealPlan[]) => list.flatMap((p) => p.entries).filter((e) => e.day_of_week === dayKey(iso));
  const firm = onDay(covering.filter((p) => p.status !== "Draft"));
  const entries = firm.length ? firm : onDay(covering);
  return entries.map((e) => ({ meal: e.meal_type, recipe: e.recipe_id ? recipes.find((r) => r.id === e.recipe_id) : undefined, name: e.custom_meal_name ?? "" }));
}

// What is on today, what is logged, and what needs attention before service.
export function KitchenToday({ onOpen }: { onOpen: (tab: string) => void }) {
  const { data: recipes, isLoading } = useList<Recipe>("recipes", "/kitchen/recipes");
  const { data: plans } = useList<WeeklyMealPlan>("weekly-meal-plans", "/kitchen/weekly-meal-plans");
  const { data: meals } = useList<MealLogEntry>("meal-log", "/kitchen/meal-log");
  const { data: food } = useList<FoodInventoryItem>("food-inventory", "/kitchen/food-inventory");
  const { data: waste } = useList<WasteLog>("waste-log", "/kitchen/waste-log");
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const today = todayIso();
  const all = recipes ?? [];
  const todays = plannedOn(plans ?? [], all, today);
  const tomorrows = plannedOn(plans ?? [], all, addDays(today, 1));
  // One batch of each dish planned for today and tomorrow.
  const planned = [...new Map([...todays, ...tomorrows].filter((p) => p.recipe).map((p) => [p.recipe!.id, p.recipe!])).values()];
  const { data: needs } = useNeeds(planned.map((r) => ({ recipe_id: r.id, portions: r.cost.portions })));

  if (isLoading) return <Spinner />;

  const loggedToday = (meals ?? []).filter((m) => m.date === today);
  const servedBy = (label: string) => loggedToday.filter((m) => (m.category ?? "").toLowerCase() === label.toLowerCase()).reduce((s, m) => s + m.lines.reduce((n, l) => n + l.qty, 0), 0);
  const mealsServed = loggedToday.reduce((s, m) => s + m.lines.reduce((n, l) => n + l.qty, 0), 0);
  const consumption = loggedToday.reduce((s, m) => s + m.total, 0);
  const wasteToday = (waste ?? []).filter((w) => w.date === today).reduce((s, w) => s + w.total, 0);

  const short = needs?.lines.filter((l) => l.short > 0) ?? [];
  const expiring = (food ?? []).filter((f) => f.qty > 0 && f.expiry && daysUntil(f.expiry) <= 3).sort((a, b) => a.expiry!.localeCompare(b.expiry!));
  const usedIn = (foodId: string) => all.filter((r) => r.ingredients.some((i) => i.food_inventory_id === foodId)).slice(0, 2).map((r) => r.name);
  const unpriced = all.filter((r) => r.cost.unpriced).length;
  const headsUp = (short.length > 0 ? 1 : 0) + Math.min(expiring.length, 4) + (unpriced > 0 ? 1 : 0);

  async function orderShort() {
    if (!needs) return;
    setBusy(true);
    try {
      const id = await requestShortItems(needs);
      if (id) navigate(`/purchasing/requests/${id}/edit`);
    } finally {
      setBusy(false);
    }
  }
  const logLink = (label: string, dishes: { recipe?: Recipe }[]) => {
    const params = new URLSearchParams({ category: label });
    dishes.forEach((d) => d.recipe && params.append("recipe", d.recipe.id));
    return `/kitchen/meal-log/new?${params}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {SERVICES.map((s) => {
          const dishes = todays.filter((p) => p.meal === s.key);
          const cover = dishes.find((d) => d.recipe?.photo_ids[0])?.recipe;
          const served = servedBy(s.label);
          return (
            <div key={s.key} className="flex flex-col overflow-hidden rounded-xl border" style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow-sm)" }}>
              <RecipePlate cover={cover?.photo_ids[0]} category={cover?.category ?? "Dinner"} label={dishes.length ? "No photo yet" : "Nothing planned"} className="!aspect-[16/9]" />
              <div className="flex flex-col gap-1 p-3">
                <div className="text-[10.5px] font-extrabold uppercase tracking-wider" style={{ color: "var(--brass-600)" }}>{s.label}</div>
                <div className="text-[14px] font-bold leading-tight">{dishes.length ? dishes.map((d) => d.recipe?.name ?? d.name).join(", ") : "No dish planned"}</div>
                <div className="text-[12px]" style={{ color: "var(--ink-500)" }}>{served > 0 ? `${served} portion${served === 1 ? "" : "s"} logged today` : "Not logged yet"}</div>
                <div className="pt-1.5">
                  <Link to={logLink(s.label, dishes)}><Button size="sm" variant={served > 0 ? "secondary" : "primary"}>{dishes.length ? "Log served" : "Log a meal"}</Button></Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <div className="mb-3 flex items-center justify-between"><h2 className="text-[13px] font-extrabold">Heads-up</h2><span className="text-[12px]" style={{ color: "var(--ink-400)" }}>{headsUp} item{headsUp === 1 ? "" : "s"}</span></div>
          {headsUp === 0 ? (
            <p className="text-[13px]" style={{ color: "var(--ink-500)" }}>Nothing needs attention. Short ingredients, stock about to expire and recipes with missing prices will appear here.</p>
          ) : (
            <div className="flex flex-col text-[13px]">
              {short.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 border-t py-2.5 first:border-t-0 first:pt-0" style={{ borderColor: "var(--border)" }}>
                  <span className="w-[76px] shrink-0"><Badge tone="critical">Short</Badge></span>
                  <div className="min-w-[180px] flex-1">
                    <div className="font-semibold">{short.slice(0, 3).map((l) => l.name).join(", ")}{short.length > 3 ? ` and ${short.length - 3} more` : ""}</div>
                    <div style={{ color: "var(--ink-500)" }}>Not enough for today's and tomorrow's dishes (one batch each)</div>
                  </div>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={orderShort}>{busy ? "Creating…" : "Add to order"}</Button>
                </div>
              )}
              {expiring.slice(0, 4).map((f) => (
                <div key={f.id} className="flex flex-wrap items-center gap-3 border-t py-2.5" style={{ borderColor: "var(--border)" }}>
                  <span className="w-[76px] shrink-0"><Badge tone={daysUntil(f.expiry!) < 0 ? "critical" : "warning"}>{daysUntil(f.expiry!) < 0 ? "Expired" : "Expiring"}</Badge></span>
                  <div className="min-w-[180px] flex-1">
                    <div className="font-semibold">{f.name} · {f.qty} {f.unit}</div>
                    <div style={{ color: "var(--ink-500)" }}>{daysUntil(f.expiry!) < 0 ? "Past its date" : `${daysUntil(f.expiry!)} day(s) left`}{usedIn(f.id).length > 0 && ` · used in ${usedIn(f.id).join(", ")}`}</div>
                  </div>
                </div>
              ))}
              {unpriced > 0 && (
                <div className="flex flex-wrap items-center gap-3 border-t py-2.5" style={{ borderColor: "var(--border)" }}>
                  <span className="w-[76px] shrink-0"><Badge tone="info">Unpriced</Badge></span>
                  <div className="min-w-[180px] flex-1">
                    <div className="font-semibold">{unpriced} recipe{unpriced === 1 ? "" : "s"} show a cost that is too low</div>
                    <div style={{ color: "var(--ink-500)" }}>Some ingredients have no price yet</div>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => onOpen("Recipes")}>See recipes</Button>
                </div>
              )}
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="mb-3 text-[13px] font-extrabold">Today so far</h2>
            <div className="grid grid-cols-2 gap-y-2 text-[13px]">
              <span style={{ color: "var(--ink-500)" }}>Meals served</span><b className="text-right tabular-nums">{mealsServed}</b>
              <span style={{ color: "var(--ink-500)" }}>Consumption value</span><b className="text-right tabular-nums">KWD {consumption.toFixed(3)}</b>
              <span style={{ color: "var(--ink-500)" }}>Waste logged</span><b className="text-right tabular-nums">KWD {wasteToday.toFixed(3)}</b>
              <span style={{ color: "var(--ink-500)" }}>Average per meal</span><b className="text-right tabular-nums">KWD {(mealsServed ? consumption / mealsServed : 0).toFixed(3)}</b>
            </div>
          </Card>
          {needs && needs.prep.length > 0 && (
            <Card>
              <h2 className="mb-2 text-[13px] font-extrabold">Prepare ahead</h2>
              <p className="mb-2 text-[12px]" style={{ color: "var(--ink-500)" }}>Sub-recipes the planned dishes use, for one batch of each dish.</p>
              <div className="flex flex-col gap-1 text-[13px]">
                {needs.prep.map((p) => (
                  <Link key={p.recipe_id} to={`/kitchen/recipes/${p.recipe_id}`} className="flex justify-between gap-3">
                    <span className="font-semibold">{p.name}</span><span className="tabular-nums" style={{ color: "var(--ink-500)" }}>{p.grams} g</span>
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
