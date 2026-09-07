import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useCreate, useList } from "../api/hooks";
import { Icon } from "../components/icons";
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Spinner, Table, Td, Th } from "../components/ui";
import { daysLabel, daysUntil } from "../lib/date";
import type { StaffMember, Vehicle } from "../types";

interface VehicleHistoryEntry { id: string; vehicle_id: string; date: string; type: string; description: string; cost: number }

export function VehiclesPage() {
  const { data: vehicles, isLoading } = useList<Vehicle>("vehicles", "/vehicles");
  const { data: staff } = useList<StaffMember>("staff", "/people/staff");
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<Vehicle | null>(null);
  const staffName = (id: string | null) => staff?.find((s) => s.id === id)?.name ?? "Unassigned";

  return (
    <div>
      <PageHeader
        title="Vehicles"
        subtitle="Fleet status, service history and document reminders."
        action={<Button onClick={() => setAddOpen(true)}>+ Add Vehicle</Button>}
      />

      {isLoading ? <Spinner /> : !vehicles || vehicles.length === 0 ? <EmptyState label="No vehicles in the fleet yet." /> : (
        <div className="grid gap-4 sm:grid-cols-2">
          {vehicles.map((v) => {
            const insD = v.insurance_expiry ? daysUntil(v.insurance_expiry) : null;
            const regD = v.reg_expiry ? daysUntil(v.reg_expiry) : null;
            const svcD = v.next_service ? daysUntil(v.next_service) : null;
            return (
              <Card key={v.id} className="cursor-pointer" >
                <div onClick={() => setDetail(v)}>
                  <div className="mb-3 flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--brass-100)", color: "var(--brass-700)" }}>
                        <Icon name="car" className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="text-[15px] font-semibold">{v.name}</div>
                        <div className="text-xs" style={{ color: "var(--ink-500)" }}>{v.reg} · {staffName(v.driver_id)}</div>
                      </div>
                    </div>
                    {v.tyre_status === "Needs Replacement" && <Badge tone="warning">Tyres</Badge>}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <MiniStat label="Insurance" value={insD != null ? daysLabel(insD) : "—"} tone={insD == null ? "neutral" : insD < 15 ? "critical" : insD < 30 ? "warning" : "good"} />
                    <MiniStat label="Registration" value={regD != null ? daysLabel(regD) : "—"} tone={regD == null ? "neutral" : regD < 15 ? "critical" : regD < 30 ? "warning" : "good"} />
                    <MiniStat label="Next Service" value={svcD != null ? daysLabel(svcD) : "—"} tone={svcD == null ? "neutral" : svcD < 0 ? "critical" : svcD < 14 ? "warning" : "good"} />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {addOpen && <NewVehicleModal staff={staff} onClose={() => setAddOpen(false)} />}
      {detail && <VehicleDetailModal vehicle={detail} staffName={staffName} onClose={() => setDetail(null)} />}
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone: "critical" | "warning" | "good" | "neutral" }) {
  const color = tone === "neutral" ? "var(--ink-500)" : `var(--status-${tone})`;
  return (
    <div className="rounded-lg p-2" style={{ background: "var(--surface-sunken)" }}>
      <div className="text-[11px]" style={{ color: "var(--ink-400)" }}>{label}</div>
      <div className="text-[12.5px] font-bold" style={{ color }}>{value}</div>
    </div>
  );
}

function VehicleDetailModal({ vehicle, staffName, onClose }: { vehicle: Vehicle; staffName: (id: string | null) => string; onClose: () => void }) {
  const { data: history, isLoading } = useList<VehicleHistoryEntry>("vehicle-history", "/vehicle-history");
  const qc = useQueryClient();
  const logService = useMutation({
    mutationFn: async () => api.post(`/vehicles/${vehicle.id}/log-service`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      qc.invalidateQueries({ queryKey: ["vehicle-history"] });
      qc.invalidateQueries({ queryKey: ["activity-log"] });
    },
  });
  const vehicleHistory = history?.filter((h) => h.vehicle_id === vehicle.id) ?? [];

  return (
    <Modal title={vehicle.name} onClose={onClose} wide>
      <div className="flex flex-col gap-3 text-[13px]">
        <div className="grid grid-cols-2 gap-2">
          <InfoRow label="Registration" value={vehicle.reg} />
          <InfoRow label="Driver" value={staffName(vehicle.driver_id)} />
          <InfoRow label="Mileage" value={`${vehicle.mileage.toLocaleString()} km`} />
          <InfoRow label="Color" value={vehicle.color ?? "—"} />
          <InfoRow label="Fuel" value={vehicle.fuel_type ?? "—"} />
          <InfoRow label="Tyres" value={vehicle.tyre_status ?? "—"} />
        </div>
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase" style={{ color: "var(--ink-400)" }}>Service &amp; repair history</div>
          {isLoading ? <Spinner /> : vehicleHistory.length === 0 ? (
            <div style={{ color: "var(--ink-400)" }}>No history logged yet.</div>
          ) : (
            <Table>
              <thead><tr><Th>Date</Th><Th>Type</Th><Th>Description</Th><Th>Cost</Th></tr></thead>
              <tbody>
                {vehicleHistory.map((h) => (
                  <tr key={h.id}>
                    <Td>{h.date}</Td>
                    <Td><Badge>{h.type}</Badge></Td>
                    <Td>{h.description}</Td>
                    <Td>KWD {h.cost.toFixed(2)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
        <Button onClick={() => logService.mutate()} disabled={logService.isPending}>
          {logService.isPending ? "Logging..." : "Log Service Completed"}
        </Button>
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

function NewVehicleModal({ staff, onClose }: { staff?: StaffMember[]; onClose: () => void }) {
  const create = useCreate<Vehicle>("vehicles", "/vehicles");
  const drivers = staff?.filter((s) => s.position === "Driver") ?? [];
  const [form, setForm] = useState({
    name: "", reg: "", driver_id: "", color: "", fuel_type: "Petrol", mileage: 0,
    insurance_expiry: "", reg_expiry: "", next_service: "",
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await create.mutateAsync({
      ...form,
      driver_id: form.driver_id || null,
      insurance_expiry: form.insurance_expiry || null,
      reg_expiry: form.reg_expiry || null,
      next_service: form.next_service || null,
    } as never);
    onClose();
  }

  return (
    <Modal title="Add vehicle" onClose={onClose}>
      <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-medium">Vehicle name
          <input required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Registration plate
          <input required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.reg} onChange={(e) => setForm((s) => ({ ...s, reg: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Assigned driver
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.driver_id} onChange={(e) => setForm((s) => ({ ...s, driver_id: e.target.value }))}>
            <option value="">Unassigned</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Color
          <input className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.color} onChange={(e) => setForm((s) => ({ ...s, color: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Fuel type
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.fuel_type} onChange={(e) => setForm((s) => ({ ...s, fuel_type: e.target.value }))}>
            {["Petrol", "Diesel", "Hybrid", "Electric"].map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Current mileage (km)
          <input type="number" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.mileage} onChange={(e) => setForm((s) => ({ ...s, mileage: Number(e.target.value) }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Insurance expiry
          <input type="date" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.insurance_expiry} onChange={(e) => setForm((s) => ({ ...s, insurance_expiry: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Registration expiry
          <input type="date" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.reg_expiry} onChange={(e) => setForm((s) => ({ ...s, reg_expiry: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Next service due
          <input type="date" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.next_service} onChange={(e) => setForm((s) => ({ ...s, next_service: e.target.value }))} />
        </label>
        <div className="col-span-full">
          <Button type="submit" disabled={create.isPending}>{create.isPending ? "Saving..." : "Add Vehicle"}</Button>
        </div>
      </form>
    </Modal>
  );
}
