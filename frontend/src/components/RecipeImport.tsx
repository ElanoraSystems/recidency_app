import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { Badge, Button, Modal } from "./ui";
import { errorText } from "./Workflow";

interface ImportReport {
  dry_run: boolean;
  created: string[];
  skipped_existing: string[];
  errors: { recipe: string; message: string }[];
  new_stock_items: { name: string; unit: string }[];
  matched_stock_items: string[];
  assumptions: string[];
}

// Owner-only: choose a recipes .json file, preview exactly what would be
// created (nothing is saved yet), then confirm.
export function RecipeImportButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Import recipes</Button>
      {open && <RecipeImportDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function RecipeImportDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<unknown>(null);
  const [fileName, setFileName] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [done, setDone] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(payload: unknown, dryRun: boolean) {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<ImportReport>("/kitchen/recipes/import", payload, { params: { dry_run: dryRun } });
      if (dryRun) setReport(data);
      else {
        setDone(data);
        for (const k of ["recipes", "food-inventory", "item-master"]) qc.invalidateQueries({ queryKey: [k] });
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setReport(null);
    setDone(null);
    setFileName(f.name);
    try {
      const parsed = JSON.parse(await f.text());
      setFile(parsed);
      await run(parsed, true);
    } catch {
      setFile(null);
      setError("That file is not valid JSON.");
    }
  }

  const shown = done ?? report;
  return (
    <Modal title="Import recipes" onClose={onClose} wide>
      <div className="flex flex-col gap-3 text-[13px]">
        <p style={{ color: "var(--ink-500)" }}>
          Choose a recipes file. You'll see what would be created first; nothing is saved until you confirm. Recipes that already
          exist by name are skipped, and missing ingredients are added to stock at zero quantity and cost.
        </p>
        <input type="file" accept=".json,application/json" onChange={onPick} disabled={busy} />
        {fileName && <div style={{ color: "var(--ink-400)" }}>{fileName}</div>}
        {busy && <div>Working…</div>}
        {error && <p style={{ color: "var(--status-critical)" }}>{error}</p>}

        {shown && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Badge tone="good">{shown.created.length} recipe{shown.created.length === 1 ? "" : "s"} {done ? "created" : "to create"}</Badge>
              <Badge>{shown.skipped_existing.length} already exist</Badge>
              <Badge tone={shown.errors.length ? "critical" : "neutral"}>{shown.errors.length} with problems</Badge>
              <Badge>{shown.new_stock_items.length} new stock items</Badge>
              <Badge>{shown.matched_stock_items.length} existing stock items matched</Badge>
            </div>
            {shown.errors.length > 0 && (
              <Section title="Problems (these are not imported)">
                {shown.errors.map((e) => <li key={e.recipe}><b>{e.recipe}</b>: {e.message}</li>)}
              </Section>
            )}
            {shown.new_stock_items.length > 0 && (
              <Section title="New stock items that will be created">
                <li>{shown.new_stock_items.map((s) => `${s.name} (${s.unit})`).join(", ")}</li>
              </Section>
            )}
            {shown.assumptions.length > 0 && (
              <Section title="Unit assumptions">{shown.assumptions.map((a) => <li key={a}>{a}</li>)}</Section>
            )}
            {shown.skipped_existing.length > 0 && (
              <Section title="Skipped (already in the app)"><li>{shown.skipped_existing.join(", ")}</li></Section>
            )}
            {shown.created.length > 0 && (
              <Section title={done ? "Created" : "Will be created"}><li>{shown.created.join(", ")}</li></Section>
            )}
          </div>
        )}

        <div className="flex gap-2">
          {report && !done && (
            <Button disabled={busy || report.created.length === 0} onClick={() => run(file, false)}>
              {busy ? "Importing…" : `Import ${report.created.length} recipe${report.created.length === 1 ? "" : "s"}`}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>{done ? "Close" : "Cancel"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>{title}</div>
      <ul className="list-disc pl-5" style={{ color: "var(--ink-700)" }}>{children}</ul>
    </div>
  );
}
