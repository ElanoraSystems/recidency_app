import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useCreate, useList } from "../api/hooks";
import { Badge, Button, EmptyState, Modal, PageHeader, Spinner, StatTile, Table, Td, Th } from "../components/ui";
import { daysLabel, daysUntil, todayIso } from "../lib/date";
import type { StaffMember } from "../types";

interface GardenTask {
  id: string;
  title: string;
  zone: string;
  frequency: string;
  last_done: string | null;
  next_due: string;
  assignee_id: string | null;
}

interface PoolLogEntry {
  id: string;
  date: string;
  ph: number;
  chlorine: number;
  temp: number;
  filter_cleaned: boolean;
  notes: string | null;
}

const TABS = ["Garden", "Pool"] as const;

export function GardenPoolPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Garden");
  const [modal, setModal] = useState(false);

  return (
    <div>
      <PageHeader
        title="Garden & Pool"
        subtitle="Recurring grounds-keeping tasks and pool chemical readings."
        action={<Button onClick={() => setModal(true)}>{tab === "Garden" ? "+ Add Task" : "+ Log Reading"}</Button>}
      />

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

      {tab === "Garden" ? <GardenTab /> : <PoolTab />}

      {modal && tab === "Garden" && <NewGardenTaskModal onClose={() => setModal(false)} />}
      {modal && tab === "Pool" && <LogPoolModal onClose={() => setModal(false)} />}
    </div>
  );
}

function GardenTab() {
  const { data, isLoading } = useList<GardenTask>("garden-tasks", "/garden-tasks");
  const qc = useQueryClient();
  const markDone = useMutation({
    mutationFn: async (t: GardenTask) => {
      const days = t.frequency === "Weekly" ? 7 : t.frequency === "Daily" ? 1 : 30;
      const next = new Date();
      next.setDate(next.getDate() + days);
      return api.patch(`/garden-tasks/${t.id}`, { last_done: todayIso(), next_due: next.toISOString().slice(0, 10) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["garden-tasks"] }),
  });

  if (isLoading) return <Spinner />;
  if (!data || data.length === 0) return <EmptyState label="No garden tasks scheduled." />;
  return (
    <Table>
      <thead><tr><Th>Task</Th><Th>Zone</Th><Th>Frequency</Th><Th>Last Done</Th><Th>Next Due</Th><Th>{" "}</Th></tr></thead>
      <tbody>
        {data.map((t) => {
          const due = daysUntil(t.next_due);
          return (
            <tr key={t.id}>
              <Td className="font-medium">{t.title}</Td>
              <Td>{t.zone}</Td>
              <Td>{t.frequency}</Td>
              <Td>{t.last_done ?? "—"}</Td>
              <Td><Badge tone={due < 0 ? "critical" : due <= 2 ? "warning" : "good"}>{daysLabel(due)}</Badge></Td>
              <Td>
                <button className="text-xs font-semibold" style={{ color: "var(--brass-600)" }} onClick={() => markDone.mutate(t)} disabled={markDone.isPending}>
                  Mark Done
                </button>
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function PoolTab() {
  const { data, isLoading } = useList<PoolLogEntry>("pool-log", "/pool-log");
  if (isLoading) return <Spinner />;
  if (!data || data.length === 0) return <EmptyState label="No pool readings logged yet." />;
  const latest = data[0];
  const phOk = latest.ph >= 7.2 && latest.ph <= 7.6;
  const clOk = latest.chlorine >= 1.5 && latest.chlorine <= 3;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="pH Level" icon="drop" value={latest.ph} sub={phOk ? "Within range" : "Needs adjustment"} progressColor={phOk ? "var(--status-good)" : "var(--status-warning)"} />
        <StatTile label="Chlorine (ppm)" icon="thermo" value={latest.chlorine} sub={clOk ? "Within range" : "Needs adjustment"} progressColor={clOk ? "var(--status-good)" : "var(--status-warning)"} />
        <StatTile label="Water Temp" icon="thermo" value={latest.temp} suffix="°C" />
      </div>
      <Table>
        <thead><tr><Th>Date</Th><Th>pH</Th><Th>Chlorine</Th><Th>Temp</Th><Th>Filter Cleaned</Th><Th>Notes</Th></tr></thead>
        <tbody>
          {data.map((p) => (
            <tr key={p.id}>
              <Td>{p.date}</Td>
              <Td>{p.ph}</Td>
              <Td>{p.chlorine}</Td>
              <Td>{p.temp}°C</Td>
              <Td>{p.filter_cleaned ? "Yes" : "No"}</Td>
              <Td>{p.notes ?? "—"}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function NewGardenTaskModal({ onClose }: { onClose: () => void }) {
  const create = useCreate<GardenTask>("garden-tasks", "/garden-tasks");
  const { data: staff } = useList<StaffMember>("staff", "/people/staff");
  const [form, setForm] = useState({ title: "", zone: "", frequency: "Weekly", next_due: todayIso(), assignee_id: "" });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await create.mutateAsync({ ...form, assignee_id: form.assignee_id || null } as never);
    onClose();
  }

  return (
    <Modal title="Add garden task" onClose={onClose}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-medium">Task
          <input required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.title} onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Zone
          <input required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.zone} onChange={(e) => setForm((s) => ({ ...s, zone: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Frequency
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.frequency} onChange={(e) => setForm((s) => ({ ...s, frequency: e.target.value }))}>
            {["Daily", "Weekly", "Monthly"].map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Assigned to
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.assignee_id} onChange={(e) => setForm((s) => ({ ...s, assignee_id: e.target.value }))}>
            <option value="">Unassigned</option>
            {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Next due
          <input type="date" required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.next_due} onChange={(e) => setForm((s) => ({ ...s, next_due: e.target.value }))} />
        </label>
        <Button type="submit" disabled={create.isPending}>{create.isPending ? "Saving..." : "Add task"}</Button>
      </form>
    </Modal>
  );
}

function LogPoolModal({ onClose }: { onClose: () => void }) {
  const create = useCreate<PoolLogEntry>("pool-log", "/pool-log");
  const [form, setForm] = useState({ date: todayIso(), ph: 7.4, chlorine: 2.0, temp: 28, filter_cleaned: false, notes: "" });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await create.mutateAsync(form as never);
    onClose();
  }

  return (
    <Modal title="Log pool reading" onClose={onClose}>
      <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-medium">Date
          <input type="date" required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.date} onChange={(e) => setForm((s) => ({ ...s, date: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">pH
          <input type="number" step="0.1" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.ph} onChange={(e) => setForm((s) => ({ ...s, ph: Number(e.target.value) }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Chlorine
          <input type="number" step="0.1" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.chlorine} onChange={(e) => setForm((s) => ({ ...s, chlorine: Number(e.target.value) }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Temperature (°C)
          <input type="number" step="0.5" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.temp} onChange={(e) => setForm((s) => ({ ...s, temp: Number(e.target.value) }))} />
        </label>
        <label className="col-span-full flex items-center gap-2 text-[13px] font-medium">
          <input type="checkbox" checked={form.filter_cleaned} onChange={(e) => setForm((s) => ({ ...s, filter_cleaned: e.target.checked }))} />
          Filter cleaned today
        </label>
        <label className="col-span-full flex flex-col gap-1 text-[13px] font-medium">Notes
          <textarea className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.notes} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} />
        </label>
        <div className="col-span-full">
          <Button type="submit" disabled={create.isPending}>{create.isPending ? "Saving..." : "Log reading"}</Button>
        </div>
      </form>
    </Modal>
  );
}
