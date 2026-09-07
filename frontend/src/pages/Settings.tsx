import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useCreate, useList } from "../api/hooks";
import { AttachmentsPanel } from "../components/AttachmentsPanel";
import { Icon } from "../components/icons";
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Spinner, StatTile, Table, Td, Th, statusTone } from "../components/ui";
import { NAV } from "../layout/nav";
import type { Area, AreaType, Asset, MealCategory, ResidenceSettingsInfo, ShiftPattern, StaffMember, TaskCategory, UnitOfMeasureEntry, WasteReason } from "../types";

interface RoleRow { id: string; key: string; label: string; modules: string[] }
interface FamilyAccountRow { id: string; name: string | null; email: string | null; relation: string; active: boolean; modules: string[] }

const TABS = [
  "Residence", "Residence Setup", "Asset Register", "Family Access", "Roles & Access", "Housekeeping Areas",
  "Area Types", "Shift Patterns", "Meal Categories", "Task Categories", "Waste Reasons", "Units of Measure",
  "Notification Preferences",
] as const;

export function Settings() {
  const { user } = useAuth();
  const isOwner = user?.user_type === "owner";
  const [tab, setTab] = useState<(typeof TABS)[number]>("Residence");
  const [modal, setModal] = useState<"area" | "asset" | "family" | null>(null);

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Configure the residence profile, layout, family access, roles and notification preferences."
        action={
          tab === "Residence Setup" && isOwner ? <Button onClick={() => setModal("area")}>+ Add Area</Button> :
          tab === "Asset Register" ? <Button onClick={() => setModal("asset")}>+ Add Asset</Button> :
          tab === "Family Access" && isOwner ? <Button onClick={() => setModal("family")}>+ Add Family Member</Button> : undefined
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

      {tab === "Residence" && <ResidenceTab isOwner={isOwner} />}
      {tab === "Residence Setup" && <ResidenceSetupTab isOwner={isOwner} modalOpen={modal === "area"} onCloseModal={() => setModal(null)} />}
      {tab === "Asset Register" && <AssetRegisterTab modalOpen={modal === "asset"} onCloseModal={() => setModal(null)} />}
      {tab === "Family Access" && <FamilyAccessTab isOwner={isOwner} modalOpen={modal === "family"} onCloseModal={() => setModal(null)} />}
      {tab === "Roles & Access" && <RolesTab isOwner={isOwner} />}
      {tab === "Housekeeping Areas" && <HousekeepingAreasTab />}
      {tab === "Area Types" && (
        <SimpleLabelListTab<AreaType>
          isOwner={isOwner} queryKey="area-types" endpoint="/area-types" itemNoun="area type"
          helperText="Define the Type options available when adding or editing a residence area in Residence Setup."
        />
      )}
      {tab === "Shift Patterns" && (
        <SimpleLabelListTab<ShiftPattern>
          isOwner={isOwner} queryKey="shift-patterns" endpoint="/shift-patterns" itemNoun="shift pattern"
          helperText="Define the shift values staff scheduling can pick from — e.g. '07:00-15:00' or 'Off'. This drives the dropdown in People > Shift Schedule."
        />
      )}
      {tab === "Meal Categories" && (
        <SimpleLabelListTab<MealCategory>
          isOwner={isOwner} queryKey="meal-categories" endpoint="/kitchen/meal-categories" itemNoun="meal category"
          helperText="Define the categories available when logging meals or proposing menus in the Kitchen module."
        />
      )}
      {tab === "Task Categories" && (
        <SimpleLabelListTab<TaskCategory>
          isOwner={isOwner} queryKey="task-categories" endpoint="/task-categories" itemNoun="task category"
          helperText="Define the categories available when creating a new task, on the Tasks board."
        />
      )}
      {tab === "Waste Reasons" && (
        <SimpleLabelListTab<WasteReason>
          isOwner={isOwner} queryKey="waste-reasons" endpoint="/kitchen/waste-reasons" itemNoun="waste reason"
          helperText="Define the reasons available when logging spoiled or wasted stock in Kitchen > Waste Log."
        />
      )}
      {tab === "Units of Measure" && <UnitsOfMeasureTab isOwner={isOwner} />}
      {tab === "Notification Preferences" && <NotificationPreferencesTab />}
    </div>
  );
}

function ResidenceTab({ isOwner }: { isOwner: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<ResidenceSettingsInfo>({
    queryKey: ["residence"],
    queryFn: async () => (await api.get("/settings/residence")).data,
  });
  const [form, setForm] = useState<ResidenceSettingsInfo | null>(null);
  useEffect(() => { if (data && !form) setForm(data); }, [data, form]);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoError, setLogoError] = useState(false);

  useEffect(() => {
    if (!data?.logo_path) return;
    let revoked = false;
    let objectUrl: string | null = null;
    api.get("/settings/residence/logo", { responseType: "blob" }).then((res) => {
      if (revoked) return;
      objectUrl = URL.createObjectURL(res.data as Blob);
      setLogoUrl(objectUrl);
      setLogoError(false);
    }).catch(() => setLogoError(true));
    return () => { revoked = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [data?.logo_path]);

  const save = useMutation({
    mutationFn: async () => api.put("/settings/residence", {
      name: form!.name, location: form!.location, currency: form!.currency,
      timezone: form!.timezone, monthly_budget: form!.monthly_budget,
      address: form!.address, phone: form!.phone, terms_and_conditions: form!.terms_and_conditions,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["residence"] }),
  });

  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return api.post("/settings/residence/logo", body, { headers: { "Content-Type": "multipart/form-data" } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["residence"] }),
  });

  if (isLoading || !form) return <Spinner />;

  return (
    <Card className="max-w-[560px]">
      <div className="mb-4">
        <div className="mb-1.5 text-[13px] font-medium">Logo</div>
        <div className="flex items-center gap-3">
          {logoUrl && !logoError ? (
            <img src={logoUrl} alt="Residence logo" className="h-14 max-w-[160px] rounded-lg object-contain" style={{ background: "var(--surface-sunken)" }} />
          ) : (
            <div className="flex h-14 w-24 items-center justify-center rounded-lg text-[11px]" style={{ background: "var(--surface-sunken)", color: "var(--ink-400)" }}>No logo</div>
          )}
          {isOwner && (
            <label className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ background: "var(--surface-sunken)", color: "var(--ink-700)" }}>
              {uploadLogo.isPending ? "Uploading..." : "Upload logo"}
              <input type="file" accept="image/*" className="hidden" disabled={uploadLogo.isPending}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo.mutate(f); }} />
            </label>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-medium">Residence name
          <input disabled={!isOwner} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-60" style={{ borderColor: "var(--border-strong)" }}
            value={form.name} onChange={(e) => setForm((s) => s && ({ ...s, name: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Location
          <input disabled={!isOwner} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-60" style={{ borderColor: "var(--border-strong)" }}
            value={form.location ?? ""} onChange={(e) => setForm((s) => s && ({ ...s, location: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Currency
          <input disabled={!isOwner} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-60" style={{ borderColor: "var(--border-strong)" }}
            value={form.currency} onChange={(e) => setForm((s) => s && ({ ...s, currency: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Monthly budget (KWD)
          <input disabled={!isOwner} type="number" className="rounded-lg border px-3 py-2 text-sm disabled:opacity-60" style={{ borderColor: "var(--border-strong)" }}
            value={form.monthly_budget} onChange={(e) => setForm((s) => s && ({ ...s, monthly_budget: Number(e.target.value) }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Time zone
          <input disabled={!isOwner} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-60" style={{ borderColor: "var(--border-strong)" }}
            value={form.timezone} onChange={(e) => setForm((s) => s && ({ ...s, timezone: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Phone
          <input disabled={!isOwner} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-60" style={{ borderColor: "var(--border-strong)" }}
            value={form.phone ?? ""} onChange={(e) => setForm((s) => s && ({ ...s, phone: e.target.value }))} />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-[13px] font-medium">Address
          <input disabled={!isOwner} placeholder="Printed on generated PDFs" className="rounded-lg border px-3 py-2 text-sm disabled:opacity-60" style={{ borderColor: "var(--border-strong)" }}
            value={form.address ?? ""} onChange={(e) => setForm((s) => s && ({ ...s, address: e.target.value }))} />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-[13px] font-medium">Terms &amp; conditions
          <textarea disabled={!isOwner} placeholder="Printed on the footer of Purchase Order PDFs" rows={3}
            className="rounded-lg border px-3 py-2 text-sm disabled:opacity-60" style={{ borderColor: "var(--border-strong)" }}
            value={form.terms_and_conditions ?? ""} onChange={(e) => setForm((s) => s && ({ ...s, terms_and_conditions: e.target.value }))} />
        </label>
      </div>
      {isOwner ? (
        <Button className="mt-3.5" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving..." : "Save Changes"}</Button>
      ) : (
        <p className="mt-3 text-xs" style={{ color: "var(--ink-400)" }}>Only the Owner can edit residence settings.</p>
      )}
    </Card>
  );
}

function ResidenceSetupTab({ isOwner, modalOpen, onCloseModal }: { isOwner: boolean; modalOpen: boolean; onCloseModal: () => void }) {
  const { data: areas, isLoading } = useList<Area>("areas", "/areas");
  const { data: assets } = useList<Asset>("assets", "/assets");
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/areas/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["areas"] }),
  });
  const [editing, setEditing] = useState<Area | null>(null);
  const [managingAssets, setManagingAssets] = useState<Area | null>(null);

  if (isLoading) return <Spinner />;

  const buckets: Record<string, number> = {};
  for (const a of areas ?? []) buckets[a.category] = (buckets[a.category] ?? 0) + 1;

  return (
    <div>
      <p className="mb-3.5 text-[13px]" style={{ color: "var(--ink-500)" }}>
        Configure the residence&rsquo;s own rooms, kitchens, dining areas, offices and other facilities. This list
        is used across the app as the source of locations for the Asset Register and Housekeeping.
      </p>
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Total Areas" icon="building" value={areas?.length ?? 0} />
        <StatTile label="Area Types" icon="grid" value={Object.keys(buckets).length} />
        <StatTile label="Assets Assigned" icon="maintenance" value={assets?.length ?? 0} sub="Across all areas" />
      </div>
      {Object.keys(buckets).length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {Object.entries(buckets).map(([label, count]) => <Badge key={label}>{label} · {count}</Badge>)}
        </div>
      )}
      {!areas || areas.length === 0 ? <EmptyState label="No areas set up yet." /> : (
        <Table>
          <thead><tr><Th>Area name</Th><Th>Type</Th><Th>Assets here</Th><Th>{" "}</Th></tr></thead>
          <tbody>
            {areas.map((a) => {
              const assetCount = assets?.filter((x) => x.location_id === a.id).length ?? 0;
              return (
                <tr key={a.id}>
                  <Td className="font-medium">{a.name}</Td>
                  <Td><Badge>{a.category}</Badge></Td>
                  <Td>
                    <button className="font-semibold underline-offset-2 hover:underline" style={{ color: "var(--brass-600)" }} onClick={() => setManagingAssets(a)}>
                      {assetCount}
                    </button>
                  </Td>
                  <Td>
                    {isOwner && (
                      <div className="flex gap-2">
                        <button className="text-xs font-semibold" style={{ color: "var(--brass-600)" }} onClick={() => setEditing(a)}>Edit</button>
                        <button
                          className="text-xs font-semibold"
                          style={{ color: "var(--brass-600)" }}
                          onClick={async () => {
                            const res = await api.get(`/patrol/areas/${a.id}/qr-code`, { responseType: "blob" });
                            const blobUrl = URL.createObjectURL(res.data as Blob);
                            window.open(blobUrl, "_blank");
                            setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
                          }}
                        >
                          Print QR
                        </button>
                        <button className="text-xs font-semibold" style={{ color: "var(--status-critical)" }} onClick={() => remove.mutate(a.id)}>Remove</button>
                      </div>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {modalOpen && <AreaModal onClose={onCloseModal} />}
      {editing && <AreaModal area={editing} onClose={() => setEditing(null)} />}
      {managingAssets && <AreaAssetsModal area={managingAssets} onClose={() => setManagingAssets(null)} />}
    </div>
  );
}

function AreaAssetsModal({ area, onClose }: { area: Area; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: assets } = useList<Asset>("assets", "/assets");
  const [pickId, setPickId] = useState("");
  const setLocation = useMutation({
    mutationFn: async ({ assetId, locationId }: { assetId: string; locationId: string | null }) =>
      api.patch(`/assets/${assetId}`, { location_id: locationId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["assets"] }); setPickId(""); },
  });

  const assigned = (assets ?? []).filter((a) => a.location_id === area.id);
  const unassignedHere = (assets ?? []).filter((a) => a.location_id !== area.id);

  return (
    <Modal title={`${area.name} — assets`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {assigned.length === 0 ? (
          <p className="text-[12.5px]" style={{ color: "var(--ink-400)" }}>No assets assigned to this area yet.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {assigned.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg px-3 py-2 text-[13px]" style={{ background: "var(--surface-sunken)" }}>
                <span>{a.name} <span style={{ color: "var(--ink-400)" }}>· {a.category}</span></span>
                <button
                  type="button"
                  className="text-xs font-semibold"
                  style={{ color: "var(--status-critical)" }}
                  onClick={() => setLocation.mutate({ assetId: a.id, locationId: null })}
                  disabled={setLocation.isPending}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); if (pickId) setLocation.mutate({ assetId: pickId, locationId: area.id }); }}
        >
          <select className="flex-1 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={pickId} onChange={(e) => setPickId(e.target.value)}>
            <option value="">Select an existing asset…</option>
            {unassignedHere.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <Button type="submit" variant="secondary" disabled={setLocation.isPending || !pickId}>+ Assign</Button>
        </form>
        <p className="text-[12px]" style={{ color: "var(--ink-400)" }}>
          To register a brand-new asset, use Settings → Asset Register → Add Asset, then assign its location here or there.
        </p>
      </div>
    </Modal>
  );
}

function AreaModal({ area, onClose }: { area?: Area; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: areaTypesRaw } = useList<AreaType>("area-types", "/area-types");
  // The generic list endpoint always sorts descending, so re-sort A-Z here
  // rather than showing types in a confusing, effectively-random order.
  const areaTypes = [...(areaTypesRaw ?? [])].sort((a, b) => a.label.localeCompare(b.label));
  const [form, setForm] = useState({ name: area?.name ?? "", category: area?.category ?? "" });
  useEffect(() => {
    if (areaTypes.length > 0 && !form.category) {
      setForm((s) => ({ ...s, category: areaTypes[0].label }));
    }
  }, [areaTypes, form.category]);
  const save = useMutation({
    mutationFn: async () =>
      area ? api.patch(`/areas/${area.id}`, form) : api.post("/areas", { ...form, checklist: [], completion: 0 }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["areas"] }); onClose(); },
  });

  const knownLabels = new Set(areaTypes.map((t) => t.label));

  return (
    <Modal title={area ? "Edit area" : "Add residence area"} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-medium">Area name
          <input required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Type
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.category} onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))}>
            {form.category && !knownLabels.has(form.category) && <option value={form.category}>{form.category} (not in the list)</option>}
            {areaTypes.map((t) => <option key={t.id} value={t.label}>{t.label}</option>)}
          </select>
          <span className="text-[11.5px]" style={{ color: "var(--ink-400)" }}>Manage the available types in Settings → Area Types.</span>
        </label>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving..." : area ? "Save" : "Add Area"}</Button>
      </form>
    </Modal>
  );
}

function AssetRegisterTab({ modalOpen, onCloseModal }: { modalOpen: boolean; onCloseModal: () => void }) {
  const { data: assets, isLoading } = useList<Asset>("assets", "/assets");
  const { data: staff } = useList<StaffMember>("staff", "/people/staff");
  const { data: areas } = useList<Area>("areas", "/areas");
  const { user } = useAuth();
  const isOwner = user?.user_type === "owner";
  const qc = useQueryClient();
  const [detail, setDetail] = useState<Asset | null>(null);
  const [editing, setEditing] = useState<Asset | null>(null);
  const decide = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) =>
      api.post(`/assets/${id}/decision?approve=${approve}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/assets/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }),
  });

  if (isLoading) return <Spinner />;

  const staffName = (id: string | null) => staff?.find((s) => s.id === id)?.name ?? "—";
  const areaName = (id: string | null) => areas?.find((a) => a.id === id)?.name ?? "—";
  const pendingCount = (assets ?? []).filter((a) => a.approval_status === "Pending").length;

  return (
    <div>
      <p className="mb-3.5 text-[13px]" style={{ color: "var(--ink-500)" }}>
        Register the residence&rsquo;s physical assets — appliances, generators, furniture and more. Maintenance
        requests and preventive schedules reference this list; they don&rsquo;t manage it.
      </p>
      {pendingCount > 0 && isOwner && (
        <div className="mb-3 flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-[13px]" style={{ background: "var(--status-warning-bg)", color: "var(--status-warning)" }}>
          <Icon name="alertTriangle" className="h-4 w-4" />
          {pendingCount} asset{pendingCount > 1 ? "s" : ""} awaiting your approval.
        </div>
      )}
      {!assets || assets.length === 0 ? <EmptyState label="No assets registered yet." /> : (
        <Table>
          <thead>
            <tr><Th>Asset</Th><Th>Category</Th><Th>Status</Th><Th>Assigned To</Th><Th>Action</Th></tr>
          </thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.id}>
                <Td className="cursor-pointer font-medium" onClick={() => setDetail(a)}>
                  {a.name}<div className="text-xs" style={{ color: "var(--ink-400)" }}>{a.brand} {a.model}</div>
                </Td>
                <Td>{a.category}</Td>
                <Td><Badge tone={statusTone(a.status)}>{a.status}</Badge> <Badge tone={statusTone(a.approval_status)}>{a.approval_status}</Badge></Td>
                <Td>{staffName(a.assigned_to)}</Td>
                <Td onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-wrap gap-2">
                    {a.approval_status === "Pending" && isOwner && (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => decide.mutate({ id: a.id, approve: true })}>Approve</Button>
                        <Button size="sm" variant="danger" onClick={() => decide.mutate({ id: a.id, approve: false })}>Reject</Button>
                      </>
                    )}
                    {isOwner && (
                      <>
                        <button className="text-xs font-semibold" style={{ color: "var(--brass-600)" }} onClick={() => setEditing(a)}>Edit</button>
                        <button
                          className="text-xs font-semibold"
                          style={{ color: "var(--status-critical)" }}
                          onClick={() => { if (confirm(`Delete '${a.name}'? This can't be undone.`)) remove.mutate(a.id); }}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {detail && (
        <Modal title={detail.name} onClose={() => setDetail(null)} wide>
          <div className="flex flex-col gap-3 text-[13px]">
            <div className="grid grid-cols-2 gap-2">
              <InfoRow label="Category" value={detail.category} />
              <InfoRow label="Location" value={areaName(detail.location_id)} />
              <InfoRow label="Brand / model" value={[detail.brand, detail.model].filter(Boolean).join(" / ") || "—"} />
              <InfoRow label="Serial number" value={detail.serial ?? "—"} />
              <InfoRow label="Purchase date" value={detail.install_date ?? "—"} />
              <InfoRow label="Purchase cost" value={detail.purchase_cost != null ? `KWD ${detail.purchase_cost.toFixed(2)}` : "—"} />
              <InfoRow label="Supplier" value={detail.provider ?? "—"} />
              <InfoRow label="Warranty end" value={detail.warranty_end ?? "—"} />
              <InfoRow label="Status" value={detail.status} />
              <InfoRow label="Assigned to" value={staffName(detail.assigned_to)} />
              <InfoRow label="Last service" value={detail.last_service ?? "—"} />
              <InfoRow label="Next service" value={detail.next_service ?? "—"} />
            </div>
            <AttachmentsPanel entityType="asset" entityId={detail.id} />
          </div>
        </Modal>
      )}

      {modalOpen && <AssetModal onClose={onCloseModal} />}
      {editing && <AssetModal asset={editing} onClose={() => setEditing(null)} />}
    </div>
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

const ASSET_CATEGORIES = [
  "AC Units", "Kitchen Appliances", "Generators", "Pumps", "Electrical",
  "Laundry", "Garden Equipment", "Pool Equipment", "Furniture", "Electronics", "Other",
];
const ASSET_STATUSES = ["Active", "In Storage", "Under Repair", "Retired"];

function AssetModal({ asset, onClose }: { asset?: Asset; onClose: () => void }) {
  const create = useCreate<Asset>("assets", "/assets");
  const qc = useQueryClient();
  const { data: areas } = useList<Area>("areas", "/areas");
  const { data: staff } = useList<StaffMember>("staff", "/people/staff");
  const { user } = useAuth();
  const [form, setForm] = useState({
    name: asset?.name ?? "", category: asset?.category ?? ASSET_CATEGORIES[0], brand: asset?.brand ?? "", model: asset?.model ?? "", serial: asset?.serial ?? "",
    location_id: asset?.location_id ?? "", install_date: asset?.install_date ?? "", purchase_cost: asset?.purchase_cost ?? 0, provider: asset?.provider ?? "",
    warranty_end: asset?.warranty_end ?? "", status: asset?.status ?? "Active", assigned_to: asset?.assigned_to ?? "",
  });
  const update = useMutation({
    mutationFn: async () =>
      api.patch(`/assets/${asset!.id}`, {
        ...form,
        location_id: form.location_id || null,
        install_date: form.install_date || null,
        warranty_end: form.warranty_end || null,
        provider: form.provider || null,
        assigned_to: form.assigned_to || null,
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["assets"] }); onClose(); },
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (asset) { update.mutate(); return; }
    await create.mutateAsync({
      ...form,
      location_id: form.location_id || null,
      install_date: form.install_date || null,
      warranty_end: form.warranty_end || null,
      provider: form.provider || null,
      assigned_to: form.assigned_to || null,
    } as never);
    onClose();
  }

  return (
    <Modal title={asset ? "Edit asset" : "Add new asset"} onClose={onClose} wide>
      <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3">
        <label className="col-span-full flex flex-col gap-1 text-[13px] font-medium">Asset name
          <input required placeholder="e.g. Wine Fridge — Cellar" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Category
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.category} onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))}>
            {ASSET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Location / room
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.location_id} onChange={(e) => setForm((s) => ({ ...s, location_id: e.target.value }))}>
            <option value="">—</option>
            {areas?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Brand
          <input placeholder="e.g. Sub-Zero" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.brand} onChange={(e) => setForm((s) => ({ ...s, brand: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Model
          <input placeholder="e.g. BI-42" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.model} onChange={(e) => setForm((s) => ({ ...s, model: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Serial number
          <input placeholder="e.g. SZ-118820" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.serial} onChange={(e) => setForm((s) => ({ ...s, serial: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Purchase date
          <input type="date" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.install_date} onChange={(e) => setForm((s) => ({ ...s, install_date: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Purchase cost (KWD)
          <input type="number" step="0.01" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.purchase_cost} onChange={(e) => setForm((s) => ({ ...s, purchase_cost: Number(e.target.value) }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Supplier
          <input placeholder="e.g. Al Manar Home" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.provider} onChange={(e) => setForm((s) => ({ ...s, provider: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Warranty end date
          <input type="date" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.warranty_end} onChange={(e) => setForm((s) => ({ ...s, warranty_end: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Status
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.status} onChange={(e) => setForm((s) => ({ ...s, status: e.target.value }))}>
            {ASSET_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Assigned / responsible person
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.assigned_to} onChange={(e) => setForm((s) => ({ ...s, assigned_to: e.target.value }))}>
            <option value="">Unassigned</option>
            {staff?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <div className="col-span-full flex items-center gap-2 text-[12.5px]" style={{ color: "var(--ink-400)" }}>
          <Icon name="camera" className="h-4 w-4" />Photo / document attachment available from the asset row once created.
        </div>
        {!asset && user?.user_type !== "owner" && (
          <div className="col-span-full rounded-lg px-3 py-2 text-[12px]" style={{ background: "var(--status-warning-bg)", color: "var(--status-warning)" }}>
            This asset will be submitted for Owner/Manager approval before it appears as Active.
          </div>
        )}
        <div className="col-span-full">
          <Button type="submit" disabled={create.isPending || update.isPending}>
            {create.isPending || update.isPending ? "Saving..." : asset ? "Save" : "Add asset"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function FamilyAccessTab({ isOwner, modalOpen, onCloseModal }: { isOwner: boolean; modalOpen: boolean; onCloseModal: () => void }) {
  const { data: accounts, isLoading } = useQuery<FamilyAccountRow[]>({
    queryKey: ["family-accounts"],
    queryFn: async () => (await api.get("/settings/family-accounts")).data,
  });
  const { data: familyMembers } = useList<{ id: string; relation: string }>("family-members", "/family-members");
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => api.patch(`/settings/family-accounts/${id}/active?active=${active}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["family-accounts"] }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/settings/family-accounts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["family-accounts"] }),
  });
  const [editing, setEditing] = useState<FamilyAccountRow | null>(null);
  const [editingDetails, setEditingDetails] = useState<FamilyAccountRow | null>(null);
  const eligible = (familyMembers ?? []).filter((f) => f.relation !== "Residence Owner").length;
  const available = Math.max(eligible - (accounts?.length ?? 0), 0);

  if (isLoading) return <Spinner />;

  return (
    <div>
      <p className="mb-3.5 text-[13px]" style={{ color: "var(--ink-500)" }}>
        Create separate logins for family members, distinct from the Owner/Admin account and from staff accounts.
        Control exactly which modules each family member can see or use.
      </p>
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Family Accounts" icon="shield" value={accounts?.length ?? 0} />
        <StatTile label="Active" icon="checkCircle" value={accounts?.filter((a) => a.active).length ?? 0} />
        <StatTile label="Available to Add" icon="people" value={available} sub="From family profiles" />
      </div>
      {!accounts || accounts.length === 0 ? <EmptyState label="No family logins yet. Use 'Add Family Member' to create one." /> : (
        <Table>
          <thead><tr><Th>Family member</Th><Th>Relation</Th><Th>Modules</Th><Th>Status</Th><Th>{" "}</Th></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <Td className="font-medium">{a.name}</Td>
                <Td>{a.relation}</Td>
                <Td>{a.modules.length} of {NAV.length}</Td>
                <Td><Badge tone={a.active ? "good" : "neutral"}>{a.active ? "Active" : "Disabled"}</Badge></Td>
                <Td>
                  {isOwner && (
                    <div className="flex gap-2">
                      <button className="text-xs font-semibold" style={{ color: "var(--brass-600)" }} onClick={() => setEditingDetails(a)}>Edit</button>
                      <button className="text-xs font-semibold" style={{ color: "var(--brass-600)" }} onClick={() => setEditing(a)}>Access</button>
                      <button className="text-xs font-semibold" style={{ color: "var(--status-critical)" }} onClick={() => toggle.mutate({ id: a.id, active: !a.active })}>
                        {a.active ? "Disable" : "Enable"}
                      </button>
                      <button
                        className="text-xs font-semibold"
                        style={{ color: "var(--status-critical)" }}
                        disabled={remove.isPending}
                        onClick={() => { if (confirm(`Remove ${a.name ?? "this"}'s family login? This can't be undone.`)) remove.mutate(a.id); }}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {modalOpen && <NewFamilyAccountModal onClose={onCloseModal} />}
      {editing && <EditFamilyAccessModal account={editing} onClose={() => setEditing(null)} />}
      {editingDetails && <EditFamilyDetailsModal account={editingDetails} onClose={() => setEditingDetails(null)} />}
    </div>
  );
}

function EditFamilyDetailsModal({ account, onClose }: { account: FamilyAccountRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: account.name ?? "", email: account.email ?? "", relation: account.relation });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => api.patch(`/settings/family-accounts/${account.id}`, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["family-accounts"] }); onClose(); },
    onError: (err: unknown) => {
      const message = axios.isAxiosError(err) ? (err.response?.data as { detail?: string } | undefined)?.detail : undefined;
      setError(message ?? "Could not save changes — please try again.");
    },
  });

  return (
    <Modal title="Edit family login" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-medium">Name
          <input required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Email
          <input required type="email" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Relation
          <input required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.relation} onChange={(e) => setForm((s) => ({ ...s, relation: e.target.value }))} />
        </label>
        {error && (
          <div className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--status-critical-bg)", color: "var(--status-critical)" }}>
            {error}
          </div>
        )}
        <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving..." : "Save"}</Button>
      </form>
    </Modal>
  );
}

function NewFamilyAccountModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", email: "", relation: "", modules: ["dashboard"] as string[] });
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: async () => (await api.post("/settings/family-accounts", form)).data,
    onSuccess: (data) => {
      setTempPassword(data.temporary_password);
      qc.invalidateQueries({ queryKey: ["family-accounts"] });
    },
  });

  return (
    <Modal title="Add family member login" onClose={onClose}>
      {tempPassword ? (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg p-3 text-[13px]" style={{ background: "var(--status-good-bg)", color: "var(--status-good)" }}>
            Account created. Temporary password: <code>{tempPassword}</code>
          </div>
          <Button onClick={onClose}>Done</Button>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-medium">Name
            <input required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Email
            <input required type="email" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Relation
            <input required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.relation} onChange={(e) => setForm((s) => ({ ...s, relation: e.target.value }))} />
          </label>
          <div className="flex flex-col gap-1 text-[13px] font-medium">
            Module access
            <ModuleChips modules={form.modules} onChange={(modules) => setForm((s) => ({ ...s, modules }))} />
          </div>
          <Button type="submit" disabled={create.isPending}>{create.isPending ? "Creating..." : "Create Login"}</Button>
        </form>
      )}
    </Modal>
  );
}

function EditFamilyAccessModal({ account, onClose }: { account: FamilyAccountRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [modules, setModules] = useState(account.modules);
  const save = useMutation({
    mutationFn: async () => api.put(`/settings/family-accounts/${account.id}/modules`, modules),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["family-accounts"] }); onClose(); },
  });

  return (
    <Modal title={`${account.relation} — module access`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <ModuleChips modules={modules} onChange={setModules} />
        <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving..." : "Save Access"}</Button>
      </div>
    </Modal>
  );
}

function ModuleChips({ modules, onChange }: { modules: string[]; onChange: (m: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {NAV.filter((n) => n.id !== "settings").map((n) => {
        const active = modules.includes(n.id);
        const locked = n.id === "dashboard";
        return (
          <button
            type="button"
            key={n.id}
            disabled={locked}
            onClick={() => onChange(active ? modules.filter((m) => m !== n.id) : [...modules, n.id])}
            className="rounded-full px-2.5 py-1 text-[11px] font-semibold disabled:opacity-70"
            style={{ background: active ? "var(--brass-100)" : "var(--surface-sunken)", color: active ? "var(--brass-700)" : "var(--ink-400)" }}
          >
            {n.label}
          </button>
        );
      })}
    </div>
  );
}

function RolesTab({ isOwner }: { isOwner: boolean }) {
  const { data: roles, isLoading } = useQuery<RoleRow[]>({
    queryKey: ["roles"],
    queryFn: async () => (await api.get("/people/roles")).data,
  });
  const qc = useQueryClient();
  const [newLabel, setNewLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const setRoleModules = useMutation({
    mutationFn: async ({ roleId, modules }: { roleId: string; modules: string[] }) =>
      api.put(`/people/roles/${roleId}/modules`, modules),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["roles"] }),
  });
  const createRole = useMutation({
    mutationFn: async () => api.post("/people/roles", { label: newLabel.trim() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["roles"] }); setNewLabel(""); setError(null); },
    onError: (err: unknown) => {
      const message = axios.isAxiosError(err) ? (err.response?.data as { detail?: string } | undefined)?.detail : undefined;
      setError(message ?? "Could not create the role — please try again.");
    },
  });
  const deleteRole = useMutation({
    mutationFn: async (roleId: string) => api.delete(`/people/roles/${roleId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["roles"] }); setError(null); },
    onError: (err: unknown) => {
      const message = axios.isAxiosError(err) ? (err.response?.data as { detail?: string } | undefined)?.detail : undefined;
      setError(message ?? "Could not delete the role — please try again.");
    },
  });

  if (isLoading) return <Spinner />;

  function toggleModule(role: RoleRow, moduleId: string) {
    if (!isOwner) return;
    const modules = role.modules.includes(moduleId) ? role.modules.filter((m) => m !== moduleId) : [...role.modules, moduleId];
    setRoleModules.mutate({ roleId: role.id, modules });
  }

  return (
    <div>
      {isOwner && (
        <form
          className="mb-4 flex items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); if (newLabel.trim()) createRole.mutate(); }}
        >
          <input placeholder="Add a new role…" className="w-full max-w-xs rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
          <Button type="submit" variant="secondary" disabled={createRole.isPending || !newLabel.trim()}>+ Add Role</Button>
        </form>
      )}
      {error && (
        <div className="mb-4 rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--status-critical-bg)", color: "var(--status-critical)" }}>
          {error}
        </div>
      )}
      <div className="flex flex-col gap-3">
        {roles?.filter((r) => r.key !== "owner").map((role) => (
          <Card key={role.id}>
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium">{role.label}</span>
              {isOwner && (
                <button
                  className="text-xs font-semibold"
                  style={{ color: "var(--status-critical)" }}
                  disabled={deleteRole.isPending}
                  onClick={() => { if (confirm(`Delete the '${role.label}' role? This can't be undone.`)) deleteRole.mutate(role.id); }}
                >
                  Delete
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {NAV.map((n) => {
                const active = role.modules.includes(n.id);
                return (
                  <button
                    key={n.id}
                    disabled={!isOwner}
                    onClick={() => toggleModule(role, n.id)}
                    className="rounded-full px-2.5 py-1 text-[11px] font-semibold disabled:opacity-70"
                    style={{ background: active ? "var(--brass-100)" : "var(--surface-sunken)", color: active ? "var(--brass-700)" : "var(--ink-400)" }}
                  >
                    {n.label}
                  </button>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
      {!isOwner && <p className="mt-2 text-xs" style={{ color: "var(--ink-400)" }}>Only the Owner can edit role access.</p>}
    </div>
  );
}

function HousekeepingAreasTab() {
  const { data: areas, isLoading } = useList<Area>("areas", "/areas");
  const [editing, setEditing] = useState<Area | null>(null);
  if (isLoading) return <Spinner />;

  return (
    <div>
      <p className="mb-4 text-[13px]" style={{ color: "var(--ink-500)" }}>
        Manage each area&rsquo;s cleaning checklist here. To add, rename or remove an area itself, use{" "}
        <span className="font-semibold" style={{ color: "var(--ink-700)" }}>Residence Setup</span>.
      </p>
      {!areas || areas.length === 0 ? (
        <EmptyState label="No areas configured yet — add one in Residence Setup first." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {areas.map((a) => (
            <Card key={a.id} className="cursor-pointer">
              <div onClick={() => setEditing(a)}>
                <div className="mb-1 text-[13.5px] font-semibold">{a.name}</div>
                <div className="mb-2 text-xs" style={{ color: "var(--ink-500)" }}>{a.category}</div>
                <div className="flex flex-wrap gap-1.5">
                  {a.checklist.length === 0
                    ? <span className="text-xs" style={{ color: "var(--ink-300)" }}>No checklist set — click to add</span>
                    : a.checklist.map((c) => <Badge key={c}>{c}</Badge>)}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && <AreaChecklistModal area={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AreaChecklistModal({ area, onClose }: { area: Area; onClose: () => void }) {
  const qc = useQueryClient();
  const [checklist, setChecklist] = useState(area.checklist);
  const [newItem, setNewItem] = useState("");
  const save = useMutation({
    mutationFn: async (next: string[]) => api.patch(`/areas/${area.id}`, { checklist: next }),
    onSuccess: (_res, next) => { qc.invalidateQueries({ queryKey: ["areas"] }); setChecklist(next); },
  });

  function addItem() {
    const trimmed = newItem.trim();
    if (!trimmed) return;
    const next = [...checklist, trimmed];
    save.mutate(next);
    setNewItem("");
  }
  function removeItem(idx: number) {
    save.mutate(checklist.filter((_, i) => i !== idx));
  }

  return (
    <Modal title={`${area.name} — cleaning checklist`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {checklist.length === 0 ? (
          <p className="text-[12.5px]" style={{ color: "var(--ink-400)" }}>No checklist items yet — add the first one below.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {checklist.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between rounded-lg px-3 py-2 text-[13px]" style={{ background: "var(--surface-sunken)" }}>
                {item}
                <button
                  type="button"
                  className="text-xs font-semibold"
                  style={{ color: "var(--status-critical)" }}
                  onClick={() => removeItem(idx)}
                  disabled={save.isPending}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); addItem(); }}>
          <input placeholder="e.g. Vacuum carpets" className="flex-1 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={newItem} onChange={(e) => setNewItem(e.target.value)} />
          <Button type="submit" variant="secondary" disabled={save.isPending || !newItem.trim()}>+ Add</Button>
        </form>
      </div>
    </Modal>
  );
}

function NotificationPreferencesTab() {
  const qc = useQueryClient();
  const { data: prefs, isLoading } = useQuery<Record<string, boolean>>({
    queryKey: ["notification-prefs"],
    queryFn: async () => (await api.get("/settings/notification-prefs")).data,
  });
  const save = useMutation({
    mutationFn: async (next: Record<string, boolean>) => api.put("/settings/notification-prefs", next),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: ["notification-prefs"] });
      qc.setQueryData(["notification-prefs"], next);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["notification-prefs"] }),
  });

  function toggle(cat: string) {
    if (!prefs) return;
    save.mutate({ ...prefs, [cat]: !prefs[cat] });
  }

  if (isLoading || !prefs) return <Spinner />;

  return (
    <Card className="max-w-[560px]">
      <p className="mb-3 text-[12px]" style={{ color: "var(--ink-400)" }}>
        Controls which alerts appear in your notification bell. Saved to your account, so it applies wherever you sign in.
      </p>
      <div className="flex flex-col gap-1">
        {Object.keys(prefs).map((c) => (
          <label key={c} className="flex cursor-pointer items-center justify-between border-b py-2.5" style={{ borderColor: "var(--border)" }}>
            <span className="text-[13px] font-semibold">{c}</span>
            <input type="checkbox" checked={prefs[c] ?? true} onChange={() => toggle(c)} disabled={save.isPending} />
          </label>
        ))}
      </div>
    </Card>
  );
}

function UnitsOfMeasureTab({ isOwner }: { isOwner: boolean }) {
  const { data, isLoading } = useList<UnitOfMeasureEntry>("units-of-measure", "/units-of-measure");
  const qc = useQueryClient();
  const [modal, setModal] = useState<"add" | UnitOfMeasureEntry | null>(null);
  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/units-of-measure/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["units-of-measure"] }),
  });

  const byId = new Map((data ?? []).map((u) => [u.id, u]));
  const sorted = [...(data ?? [])].sort((a, b) => a.label.localeCompare(b.label));

  if (isLoading) return <Spinner />;

  return (
    <div>
      <p className="mb-3.5 text-[13px]" style={{ color: "var(--ink-500)" }}>
        Drives every unit dropdown in the app — Item Master, Purchase Requests, and Recipe ingredients. A unit with a
        base unit and factor (e.g. kg = 1000 × g) can be freely converted to/from that base elsewhere; a standalone
        unit (like "units" or "pack") can't be converted to anything, which is correct for non-measurable counts.
      </p>
      {isOwner && (
        <Button variant="secondary" className="mb-4" onClick={() => setModal("add")}>+ Add Unit</Button>
      )}
      {sorted.length === 0 ? <EmptyState label="No units configured yet." /> : (
        <Table>
          <thead><tr><Th>Unit</Th><Th>Base unit</Th><Th>Factor to base</Th><Th>{" "}</Th></tr></thead>
          <tbody>
            {sorted.map((u) => (
              <tr key={u.id}>
                <Td className="font-medium">{u.label}</Td>
                <Td>{u.base_unit_id ? (byId.get(u.base_unit_id)?.label ?? "—") : <span style={{ color: "var(--ink-400)" }}>— (its own base)</span>}</Td>
                <Td>{u.base_unit_id ? u.factor_to_base : "—"}</Td>
                <Td>
                  {isOwner && (
                    <div className="flex gap-2">
                      <button className="text-xs font-semibold" style={{ color: "var(--brass-600)" }} onClick={() => setModal(u)}>Edit</button>
                      <button
                        className="text-xs font-semibold" style={{ color: "var(--status-critical)" }}
                        onClick={() => confirm(`Delete unit "${u.label}"? Anything currently using it will fall back to plain text.`) && remove.mutate(u.id)}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {modal && (
        <UnitOfMeasureModal
          unit={modal === "add" ? undefined : modal}
          units={sorted}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function UnitOfMeasureModal({
  unit, units, onClose,
}: { unit?: UnitOfMeasureEntry; units: UnitOfMeasureEntry[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [label, setLabel] = useState(unit?.label ?? "");
  const [baseUnitId, setBaseUnitId] = useState(unit?.base_unit_id ?? "");
  const [factor, setFactor] = useState(unit?.factor_to_base ?? 1);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const payload = { label: label.trim(), base_unit_id: baseUnitId || null, factor_to_base: baseUnitId ? factor : 1 };
      return unit ? api.patch(`/units-of-measure/${unit.id}`, payload) : api.post("/units-of-measure", payload);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["units-of-measure"] }); onClose(); },
    onError: (err: unknown) => {
      const message = axios.isAxiosError(err) ? (err.response?.data as { detail?: string } | undefined)?.detail : undefined;
      setError(message ?? "Could not save — please try again.");
    },
  });

  // A unit can't be its own base, directly or (to keep this simple, since
  // only one level of nesting is supported) indirectly.
  const baseOptions = units.filter((u) => u.id !== unit?.id && !u.base_unit_id);

  return (
    <Modal title={unit ? "Edit unit" : "Add unit"} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-medium">Label
          <input required placeholder="e.g. tbsp" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Base unit (optional)
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={baseUnitId} onChange={(e) => setBaseUnitId(e.target.value)}>
            <option value="">— none, this is its own base —</option>
            {baseOptions.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </select>
        </label>
        {baseUnitId && (
          <label className="flex flex-col gap-1 text-[13px] font-medium">
            Factor to base (1 {label || "unit"} = ? {units.find((u) => u.id === baseUnitId)?.label})
            <input type="number" step="any" min={0} required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={factor} onChange={(e) => setFactor(Number(e.target.value))} />
          </label>
        )}
        <p className="text-[12px]" style={{ color: "var(--ink-400)" }}>
          Only base units (units with no base of their own) can be picked as a base here — this keeps conversion a
          single, unambiguous step rather than a chain.
        </p>
        {error && (
          <div className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--status-critical-bg)", color: "var(--status-critical)" }}>
            {error}
          </div>
        )}
        <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving..." : "Save"}</Button>
      </form>
    </Modal>
  );
}

function SimpleLabelListTab<T extends { id: string; label: string }>({
  isOwner, queryKey, endpoint, itemNoun, helperText,
}: {
  isOwner: boolean; queryKey: string; endpoint: string; itemNoun: string; helperText: string;
}) {
  const { data, isLoading } = useList<T>(queryKey, endpoint);
  const qc = useQueryClient();
  const [newLabel, setNewLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const create = useMutation({
    mutationFn: async () => api.post(endpoint, { label: newLabel.trim() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [queryKey] }); setNewLabel(""); },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`${endpoint}/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [queryKey] }),
  });
  const rename = useMutation({
    mutationFn: async ({ id, label }: { id: string; label: string }) => api.patch(`${endpoint}/${id}`, { label }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [queryKey] }); setEditingId(null); },
  });

  function startEdit(item: T) {
    setEditingId(item.id);
    setEditValue(item.label);
  }
  function saveEdit(item: T) {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === item.label) { setEditingId(null); return; }
    rename.mutate({ id: item.id, label: trimmed });
  }

  if (isLoading) return <Spinner />;

  return (
    <div>
      <p className="mb-3.5 text-[13px]" style={{ color: "var(--ink-500)" }}>{helperText}</p>
      {isOwner && (
        <form
          className="mb-4 flex items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); if (newLabel.trim()) create.mutate(); }}
        >
          <input placeholder={`Add a new ${itemNoun}…`} className="w-full max-w-xs rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
          <Button type="submit" variant="secondary" disabled={create.isPending || !newLabel.trim()}>+ Add</Button>
        </form>
      )}
      {!data || data.length === 0 ? <EmptyState label={`No ${itemNoun}s configured yet.`} /> : (
        <div className="flex flex-wrap gap-2">
          {[...data].sort((a, b) => a.label.localeCompare(b.label)).map((item) =>
            editingId === item.id ? (
              <div key={item.id} className="flex items-center gap-1.5 rounded-full py-1 pl-3 pr-1.5" style={{ background: "var(--surface-sunken)" }}>
                <input
                  autoFocus
                  className="w-32 border-b bg-transparent text-[12.5px] font-semibold outline-none"
                  style={{ borderColor: "var(--brass-500)" }}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEdit(item);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onBlur={() => saveEdit(item)}
                  disabled={rename.isPending}
                />
              </div>
            ) : (
              <div key={item.id} className="flex items-center gap-2 rounded-full py-1.5 pl-3 pr-2 text-[12.5px] font-semibold" style={{ background: "var(--surface-sunken)" }}>
                {isOwner ? (
                  <button type="button" onClick={() => startEdit(item)} className="hover:underline">{item.label}</button>
                ) : item.label}
                {isOwner && (
                  <button
                    type="button"
                    className="flex h-4 w-4 items-center justify-center rounded-full text-[13px] leading-none"
                    style={{ color: "var(--status-critical)" }}
                    onClick={() => remove.mutate(item.id)}
                    disabled={remove.isPending}
                  >
                    ×
                  </button>
                )}
              </div>
            )
          )}
        </div>
      )}
      {isOwner && data && data.length > 0 && (
        <p className="mt-3 text-[11.5px]" style={{ color: "var(--ink-400)" }}>Click a name to rename it.</p>
      )}
    </div>
  );
}
