import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useList } from "../api/hooks";
import { Button, Card, EmptyState, Modal, PageHeader, Spinner, Table, Td, Th } from "../components/ui";
import { NAV } from "../layout/nav";
import type { CostCenter, MealCategory, ResidenceSettingsInfo, TaskCategory, UnitOfMeasureEntry, WasteReason } from "../types";

interface RoleRow { id: string; key: string; label: string; modules: string[] }

const TABS = [
  "Residence", "Roles & Access",
  "Meal Categories", "Task Categories", "Waste Reasons", "Cost Centers", "Units of Measure",
  "Notification Preferences",
] as const;

export function Settings() {
  const { user } = useAuth();
  const isOwner = user?.user_type === "owner";
  const [tab, setTab] = useState<(typeof TABS)[number]>("Residence");

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Configure the residence profile, roles and notification preferences."
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
      {tab === "Roles & Access" && <RolesTab isOwner={isOwner} />}
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
      {tab === "Cost Centers" && (
        <SimpleLabelListTab<CostCenter>
          isOwner={isOwner} queryKey="cost-centers" endpoint="/kitchen/cost-centers" itemNoun="cost center"
          helperText="Define the cost centers available when logging a meal in the Kitchen module."
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
