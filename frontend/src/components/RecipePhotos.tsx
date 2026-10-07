import { useRef, useState } from "react";
import { api } from "../api/client";
import { errorText } from "./Workflow";
import { Button } from "./ui";

export const DIET_TAGS = ["Vegetarian", "Vegan", "Halal", "Spicy", "Contains alcohol"] as const;
const MAX_PHOTOS = 4;
const PLATE_HUE: Record<string, string> = {
  Breakfast: "#d8c28a", Lunch: "#b7c78a", Dinner: "#d9c9a4", Snacks: "#d7b8a6", "Special Meals": "#c9a46a", Events: "#a9b9a4",
};

// Pictures load straight into <img>, which cannot send a login token, so the
// server serves them by their unguessable id.
export const photoUrl = (id: string) => `${api.defaults.baseURL}/kitchen/recipe-photos/${id}`;

// The cover picture, or a plain plate when the dish has none yet.
export function RecipePlate({ cover, category, label = "No photo yet", className = "" }: { cover?: string; category: string; label?: string; className?: string }) {
  if (cover) return <img src={photoUrl(cover)} alt="" loading="lazy" className={`aspect-[4/3] w-full object-cover ${className}`} />;
  return (
    <div className={`plate-ph grid place-items-center ${className}`} style={{ "--a": PLATE_HUE[category] ?? "#d9c9a4" } as React.CSSProperties}>
      <span className="relative z-10 text-[11.5px] font-bold" style={{ color: "var(--ink-700)" }}>{label}</span>
    </div>
  );
}

// Centre-crop to 4:3, shrink to 1200 px wide and re-encode as JPEG, so a phone
// photo of several MB becomes roughly 150 KB before it is uploaded.
async function compress(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const ratio = 4 / 3;
  let sw = bitmap.width, sh = bitmap.height, sx = 0, sy = 0;
  if (sw / sh > ratio) { const w = sh * ratio; sx = (sw - w) / 2; sw = w; } else { const h = sw / ratio; sy = (sh - h) / 2; sh = h; }
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(1200, Math.round(sw));
  canvas.height = Math.round(canvas.width / ratio);
  canvas.getContext("2d")!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read that picture"))), "image/jpeg", 0.82));
}

// Up to four pictures: the first is the cover. Changes save immediately.
export function RecipePhotoManager({ recipeId, category, photoIds, onChange }: { recipeId: string; category: string; photoIds: string[]; onChange: (ids: string[]) => void }) {
  const [shown, setShown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const current = Math.min(shown, Math.max(0, photoIds.length - 1));

  async function run(task: () => Promise<string[]>) {
    setBusy(true);
    setError(null);
    try { onChange(await task()); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  const add = (file: File) => run(async () => {
    const form = new FormData();
    form.append("file", await compress(file), "photo.jpg");
    const ids = (await api.post<string[]>(`/kitchen/recipes/${recipeId}/photos`, form)).data;
    setShown(ids.length - 1);
    return ids;
  });

  return (
    <div className="flex max-w-md flex-col gap-2">
      <div className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)" }}>
        <RecipePlate cover={photoIds[current]} category={category} label="No photo yet. Add one below." />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {photoIds.map((id, i) => (
          <button key={id} type="button" onClick={() => setShown(i)} className="h-12 w-16 overflow-hidden rounded-md border-2"
            style={{ borderColor: i === current ? "var(--brass-500)" : "var(--border)" }}>
            <img src={photoUrl(id)} alt="" className="h-full w-full object-cover" />
          </button>
        ))}
        {photoIds.length < MAX_PHOTOS && (
          <>
            <input ref={input} type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) add(f); }} />
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? "Uploading..." : "+ Add photo"}
            </Button>
          </>
        )}
      </div>
      {photoIds.length > 0 && (
        <div className="flex gap-3 text-[12px] font-semibold">
          {current > 0 && (
            <button type="button" disabled={busy} style={{ color: "var(--brass-600)" }}
              onClick={() => run(async () => { const ids = (await api.post<string[]>(`/kitchen/recipes/${recipeId}/photos/${photoIds[current]}/cover`)).data; setShown(0); return ids; })}>
              Make cover
            </button>
          )}
          <button type="button" disabled={busy} style={{ color: "var(--status-critical)" }}
            onClick={() => window.confirm("Delete this photo?") && run(async () => (await api.delete<string[]>(`/kitchen/recipes/${recipeId}/photos/${photoIds[current]}`)).data)}>
            Delete photo
          </button>
        </div>
      )}
      {error && <p className="text-[12.5px]" style={{ color: "var(--status-critical)" }}>{error}</p>}
    </div>
  );
}
