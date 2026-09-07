import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useCreate, useList } from "../api/hooks";
import { Icon } from "../components/icons";
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Spinner } from "../components/ui";
import { fmtDate, todayIso } from "../lib/date";
import type { EventItem, StaffMember, TaskItem } from "../types";

const EVENT_TYPES = ["Birthday", "Family Gathering", "Dinner Party", "Celebration", "Wedding / Function", "VIP Visit", "Other"];

export function EventsPage() {
  const { data, isLoading } = useList<EventItem>("events", "/events");
  const { data: staff } = useList<StaffMember>("staff", "/people/staff");
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<EventItem | null>(null);
  const staffName = (id: string) => staff?.find((s) => s.id === id)?.name ?? id;

  const sorted = [...(data ?? [])].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div>
      <PageHeader
        title="Events"
        subtitle="Plan celebrations and generate the operational tasks they require."
        action={<Button onClick={() => setAddOpen(true)}>+ New Event</Button>}
      />

      {isLoading ? <Spinner /> : sorted.length === 0 ? <EmptyState label="No events planned yet." /> : (
        <div className="grid gap-4 sm:grid-cols-2">
          {sorted.map((e) => (
            <Card key={e.id} className="cursor-pointer" >
              <div onClick={() => setDetail(e)}>
                <div className="mb-2 flex items-center justify-between">
                  <Badge>{e.type}</Badge>
                  <Badge tone={e.tasks_generated ? "good" : "neutral"}>{e.tasks_generated ? "Tasks generated" : "Not planned"}</Badge>
                </div>
                <div className="mb-1 text-[15px] font-semibold">{e.name}</div>
                <div className="mb-2.5 text-xs" style={{ color: "var(--ink-500)" }}>
                  {fmtDate(e.date)}{e.time ? ` · ${e.time}` : ""}{e.location ? ` · ${e.location}` : ""}
                </div>
                <div className="flex items-center gap-2 text-xs" style={{ color: "var(--ink-500)" }}>
                  <Icon name="guests" className="h-3.5 w-3.5" />{e.guests_count} guests expected
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {addOpen && <NewEventModal onClose={() => setAddOpen(false)} />}
      {detail && <EventDetailModal event={detail} staffName={staffName} onClose={() => setDetail(null)} />}
    </div>
  );
}

function EventDetailModal({ event, staffName, onClose }: { event: EventItem; staffName: (id: string) => string; onClose: () => void }) {
  const qc = useQueryClient();
  const createTask = useCreate<TaskItem>("tasks", "/tasks");
  const generate = useMutation({
    mutationFn: async () => {
      const dueDate = event.date;
      const jobs = [
        { category: "Kitchen", title: `Prepare menu for ${event.name}` },
        { category: "Housekeeping", title: `Prepare & set up ${event.location ?? "venue"} for ${event.name}` },
        { category: "Purchasing", title: `Purchase supplies for ${event.name}` },
        { category: "Maintenance", title: `Pre-event maintenance check — ${event.location ?? "venue"}` },
      ];
      for (const job of jobs) {
        await createTask.mutateAsync({
          title: job.title, category: job.category, priority: "High",
          due_date: dueDate, recurrence: "One-time", checklist: [],
        } as never);
      }
      return api.patch(`/events/${event.id}`, { tasks_generated: true });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
    },
  });

  return (
    <Modal title={event.name} onClose={onClose} wide>
      <div className="flex flex-col gap-3 text-[13px]">
        <Badge>{event.type}</Badge>
        <div className="grid grid-cols-2 gap-2">
          <InfoRow label="Date" value={fmtDate(event.date)} />
          <InfoRow label="Time" value={event.time ?? "—"} />
          <InfoRow label="Location" value={event.location ?? "—"} />
          <InfoRow label="Expected guests" value={String(event.guests_count)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="mb-1 text-[11px] font-bold uppercase" style={{ color: "var(--ink-400)" }}>Menu</div>
            <p style={{ color: "var(--ink-700)" }}>{event.menu || "TBC"}</p>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-bold uppercase" style={{ color: "var(--ink-400)" }}>Shopping</div>
            <p style={{ color: "var(--ink-700)" }}>{event.shopping || "TBC"}</p>
          </div>
        </div>
        {event.staff_needed.length > 0 && (
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase" style={{ color: "var(--ink-400)" }}>Staff required</div>
            <div className="flex flex-wrap gap-1.5">
              {event.staff_needed.map((id) => <Badge key={id}>{staffName(id)}</Badge>)}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="mb-1 text-[11px] font-bold uppercase" style={{ color: "var(--ink-400)" }}>Cleaning</div>
            <p style={{ color: "var(--ink-500)" }}>{event.cleaning || "TBC"}</p>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-bold uppercase" style={{ color: "var(--ink-400)" }}>Maintenance</div>
            <p style={{ color: "var(--ink-500)" }}>{event.maintenance || "TBC"}</p>
          </div>
        </div>
        {event.notes && (
          <div>
            <div className="mb-1 text-[11px] font-bold uppercase" style={{ color: "var(--ink-400)" }}>Notes</div>
            <p style={{ color: "var(--ink-500)" }}>{event.notes}</p>
          </div>
        )}

        {event.tasks_generated ? (
          <div className="flex items-center gap-1.5 self-start rounded-full px-3 py-1.5 text-xs font-semibold" style={{ background: "var(--status-good-bg)", color: "var(--status-good)" }}>
            <Icon name="checkCircle" className="h-3.5 w-3.5" />Tasks already generated
          </div>
        ) : (
          <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
            {generate.isPending ? "Generating..." : "Generate Operational Tasks"}
          </Button>
        )}
      </div>
    </Modal>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px]" style={{ color: "var(--ink-400)" }}>{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function NewEventModal({ onClose }: { onClose: () => void }) {
  const create = useCreate<EventItem>("events", "/events");
  const [form, setForm] = useState({
    name: "", type: EVENT_TYPES[0], date: todayIso(), time: "19:00", location: "", guests_count: 12, menu: "",
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await create.mutateAsync({
      ...form, shopping: "TBC", cleaning: "TBC", maintenance: "TBC", notes: "",
      staff_needed: [], tasks_generated: false,
    } as never);
    onClose();
  }

  return (
    <Modal title="New event" onClose={onClose}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-medium">Event name
          <input required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-medium">Type
            <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.type} onChange={(e) => setForm((s) => ({ ...s, type: e.target.value }))}>
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Date
            <input type="date" required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.date} onChange={(e) => setForm((s) => ({ ...s, date: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Time
            <input type="time" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.time} onChange={(e) => setForm((s) => ({ ...s, time: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Location
            <input className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.location} onChange={(e) => setForm((s) => ({ ...s, location: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Expected guests
            <input type="number" required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.guests_count} onChange={(e) => setForm((s) => ({ ...s, guests_count: Number(e.target.value) }))} />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Menu notes
          <input className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.menu} onChange={(e) => setForm((s) => ({ ...s, menu: e.target.value }))} />
        </label>
        <Button type="submit" disabled={create.isPending}>{create.isPending ? "Saving..." : "Save Event"}</Button>
      </form>
    </Modal>
  );
}
