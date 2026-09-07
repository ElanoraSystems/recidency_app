import { useState } from "react";
import { useCreate, useList } from "../api/hooks";
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Spinner, Table, Td, Th } from "../components/ui";
import { daysLabel, daysUntil } from "../lib/date";
import type { Guest, StaffMember } from "../types";

interface FamilyMember { id: string; name: string; relation: string; dietary: string | null; allergies: string | null; preferences: string | null }

export function GuestsPage() {
  const { data: guests, isLoading } = useList<Guest>("guests", "/guests");
  const { data: family } = useList<FamilyMember>("family-members", "/family-members");
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<Guest | null>(null);

  const sorted = [...(guests ?? [])].sort((a, b) => a.arrival.localeCompare(b.arrival));

  return (
    <div>
      <PageHeader
        title="Guests"
        subtitle="Family profiles and guest bookings."
        action={<Button onClick={() => setAddOpen(true)}>+ New Guest Booking</Button>}
      />

      <Card className="mb-5">
        <h3 className="mb-3 text-[15px] font-semibold">Family profiles</h3>
        {!family || family.length === 0 ? <EmptyState label="No family profiles on file." /> : (
          <div className="grid gap-4 sm:grid-cols-2">
            {family.map((f) => (
              <div key={f.id} className="flex gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[13px] font-bold" style={{ background: "var(--brass-100)", color: "var(--brass-700)" }}>
                  {f.name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold">{f.name}</div>
                  <div className="mb-1 text-xs" style={{ color: "var(--ink-500)" }}>{f.relation}</div>
                  <div className="text-[12.5px]"><b>Dietary:</b> {f.dietary ?? "—"}</div>
                  <div className="text-[12.5px]"><b>Allergies:</b> {f.allergies ?? "None"}</div>
                  {f.preferences && <div className="mt-0.5 text-xs" style={{ color: "var(--ink-400)" }}>{f.preferences}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold">Guest bookings</h3>
          <span className="text-xs" style={{ color: "var(--ink-400)" }}>{guests?.length ?? 0} upcoming</span>
        </div>
        {isLoading ? <Spinner /> : !sorted || sorted.length === 0 ? <EmptyState label="No guest bookings yet." /> : (
          <Table>
            <thead><tr><Th>Guest</Th><Th>Arrival</Th><Th>Departure</Th><Th>Guests</Th><Th>Room</Th><Th>{" "}</Th></tr></thead>
            <tbody>
              {sorted.map((g) => (
                <tr key={g.id} className="cursor-pointer" onClick={() => setDetail(g)}>
                  <Td className="font-medium">{g.name}<div className="text-xs" style={{ color: "var(--ink-400)" }}>{g.dietary}</div></Td>
                  <Td>{g.arrival} {g.arrival_time ?? ""}</Td>
                  <Td>{g.departure} {g.departure_time ?? ""}</Td>
                  <Td>{g.count}</Td>
                  <Td>{g.room}</Td>
                  <Td><Badge tone="info">{daysLabel(daysUntil(g.arrival))}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {addOpen && <NewGuestModal onClose={() => setAddOpen(false)} />}
      {detail && <GuestDetailModal guest={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function GuestDetailModal({ guest, onClose }: { guest: Guest; onClose: () => void }) {
  const { data: staff } = useList<StaffMember>("staff", "/people/staff");
  const driverName = staff?.find((s) => s.id === guest.driver_id)?.name ?? "Unassigned";

  return (
    <Modal title={guest.name} onClose={onClose}>
      <div className="flex flex-col gap-3 text-[13px]">
        <div className="grid grid-cols-2 gap-2">
          <InfoRow label="Arrival" value={`${guest.arrival}${guest.arrival_time ? " · " + guest.arrival_time : ""}`} />
          <InfoRow label="Departure" value={`${guest.departure}${guest.departure_time ? " · " + guest.departure_time : ""}`} />
          <InfoRow label="Room(s)" value={guest.room ?? "—"} />
          <InfoRow label="Guests" value={String(guest.count)} />
          <InfoRow label="Dietary" value={guest.dietary ?? "—"} />
          <InfoRow label="Driver" value={driverName} />
        </div>
        <div>
          <div className="mb-1 text-[11px] font-bold uppercase" style={{ color: "var(--ink-400)" }}>Special requests</div>
          <p style={{ color: "var(--ink-700)" }}>{guest.requests || "None on file."}</p>
        </div>
        {guest.notes && (
          <div>
            <div className="mb-1 text-[11px] font-bold uppercase" style={{ color: "var(--ink-400)" }}>Notes</div>
            <p style={{ color: "var(--ink-500)" }}>{guest.notes}</p>
          </div>
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

function NewGuestModal({ onClose }: { onClose: () => void }) {
  const create = useCreate<Guest>("guests", "/guests");
  const [form, setForm] = useState({
    name: "", arrival: "", arrival_time: "16:00", departure: "", departure_time: "11:00",
    count: 2, room: "", dietary: "", requests: "",
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await create.mutateAsync(form as never);
    onClose();
  }

  return (
    <Modal title="New guest booking" onClose={onClose}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-medium">Guest name / party
          <input required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-medium">Arrival date
            <input type="date" required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.arrival} onChange={(e) => setForm((s) => ({ ...s, arrival: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Arrival time
            <input type="time" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.arrival_time} onChange={(e) => setForm((s) => ({ ...s, arrival_time: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Departure date
            <input type="date" required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.departure} onChange={(e) => setForm((s) => ({ ...s, departure: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Departure time
            <input type="time" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.departure_time} onChange={(e) => setForm((s) => ({ ...s, departure_time: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Number of guests
            <input type="number" required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.count} onChange={(e) => setForm((s) => ({ ...s, count: Number(e.target.value) }))} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Room
            <input className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.room} onChange={(e) => setForm((s) => ({ ...s, room: e.target.value }))} />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Dietary requirements
          <input className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.dietary} onChange={(e) => setForm((s) => ({ ...s, dietary: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Special requests
          <input className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.requests} onChange={(e) => setForm((s) => ({ ...s, requests: e.target.value }))} />
        </label>
        <Button type="submit" disabled={create.isPending}>{create.isPending ? "Saving..." : "Save Booking"}</Button>
      </form>
    </Modal>
  );
}
