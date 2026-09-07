import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { api } from "../api/client";
import { useCreate, useList, useUpdate } from "../api/hooks";
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Spinner, StatTile, Table, Td, Th, statusTone } from "../components/ui";
import { CATEGORIES as DOC_CATEGORIES, DocumentFilesModal, NewDocumentModal } from "./Documents";
import { NewTaskModal } from "./Tasks";
import { todayIso } from "../lib/date";
import type { DocumentItem, ShiftPattern, StaffMember } from "../types";

const POSITIONS = [
  "Residence Manager", "Chef", "Housekeeper", "Driver", "Gardener",
  "Maintenance Technician", "Accountant", "Other",
];
const ID_TYPES = ["Civil ID", "Passport", "Residency Permit (Iqama)", "Work Permit", "Other"];

interface RoleOption { id: string; key: string; label: string }
interface AttendanceRecord { id: string; staff_id: string; date: string; check_in: string | null; check_out: string | null; status: string }
interface LeaveRequestRecord { id: string; staff_id: string; type: string; from_date: string; to_date: string; days: number; status: string; reason: string | null; requested_on: string }
interface ShiftRecord { id: string; staff_id: string; pattern: Record<string, string> }

const TABS = ["Directory", "Attendance", "Leave Requests", "Shift Schedule", "Attendance Reports"] as const;
const DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "Mon" }, { key: "tue", label: "Tue" }, { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" }, { key: "fri", label: "Fri" }, { key: "sat", label: "Sat" }, { key: "sun", label: "Sun" },
];

export function People() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Directory");
  const { data: staff } = useList<StaffMember>("staff", "/people/staff");
  const [showForm, setShowForm] = useState(false);

  return (
    <div>
      <PageHeader
        title="People"
        subtitle="Employee profiles, attendance, roster and leave for the residence team."
        action={tab === "Directory" ? <Button onClick={() => setShowForm(true)}>+ Add Employee</Button> : undefined}
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

      {tab === "Directory" && <DirectoryTab staff={staff} showForm={showForm} onDoneAdding={() => setShowForm(false)} />}
      {tab === "Attendance" && <AttendanceTab staff={staff} />}
      {tab === "Leave Requests" && <LeaveTab staff={staff} />}
      {tab === "Shift Schedule" && <ShiftTab staff={staff} />}
      {tab === "Attendance Reports" && <AttendanceReportsTab staff={staff} />}
    </div>
  );
}

function DirectoryTab({ staff, showForm, onDoneAdding }: { staff?: StaffMember[]; showForm: boolean; onDoneAdding: () => void }) {
  const [detail, setDetail] = useState<StaffMember | null>(null);

  return (
    <div>
      {!staff ? <Spinner /> : staff.length === 0 ? <EmptyState label="No staff yet." /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {staff.map((s) => (
            <Card key={s.id} className="cursor-pointer" >
              <div onClick={() => setDetail(s)}>
                <div className="mb-2.5 flex items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[13px] font-bold" style={{ background: "var(--brass-100)", color: "var(--brass-700)" }}>
                    {s.name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[14.5px] font-semibold">{s.name}</div>
                    <div className="truncate text-xs" style={{ color: "var(--ink-500)" }}>{s.position}</div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                  <Badge>{s.department}</Badge>
                </div>
                <div className="mt-3 border-t pt-2 text-xs" style={{ borderColor: "var(--border)", color: "var(--ink-400)" }}>
                  {s.phone ?? "No phone on file"}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showForm && <AddEmployeeModal onClose={onDoneAdding} />}
      {detail && <StaffProfileModal staff={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

interface DraftDoc { key: string; name: string; category: string; file: File | null }

function AddEmployeeModal({ onClose }: { onClose: () => void }) {
  const { data: roles } = useQuery<RoleOption[]>({ queryKey: ["roles"], queryFn: async () => (await api.get("/people/roles")).data });
  const { data: staff } = useList<StaffMember>("staff", "/people/staff");
  const qc = useQueryClient();
  const create = useCreate<StaffMember>("staff", "/people/staff");
  const [form, setForm] = useState({
    name: "", email: "", phone: "", position: POSITIONS[0], department: "", role_key: "housekeeper", supervisor_id: "",
    join_date: todayIso(), salary: 0, id_type: ID_TYPES[0], id_number: "", id_expiry: "", notes: "",
  });
  const [docs, setDocs] = useState<DraftDoc[]>([{ key: crypto.randomUUID(), name: "", category: DOC_CATEGORIES[1], file: null }]);
  const [uploading, setUploading] = useState(false);

  function addDocRow() {
    setDocs((s) => [...s, { key: crypto.randomUUID(), name: "", category: DOC_CATEGORIES[1], file: null }]);
  }
  function updateDocRow(key: string, patch: Partial<DraftDoc>) {
    setDocs((s) => s.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }
  function removeDocRow(key: string) {
    setDocs((s) => s.filter((d) => d.key !== key));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const staff = await create.mutateAsync({
      ...form,
      phone: form.phone || null,
      supervisor_id: form.supervisor_id || null,
      id_number: form.id_number || null,
      id_expiry: form.id_expiry || null,
      notes: form.notes || null,
    } as never);

    const readyDocs = docs.filter((d) => d.name.trim() && d.file);
    if (readyDocs.length > 0) {
      setUploading(true);
      for (const d of readyDocs) {
        const doc = (
          await api.post("/documents", { name: d.name, category: d.category, linked_to: staff.name, upload_date: todayIso(), expiry: null })
        ).data;
        const formData = new FormData();
        formData.append("file", d.file as File);
        await api.post(`/documents/${doc.id}/files`, formData, { headers: { "Content-Type": "multipart/form-data" } });
      }
      qc.invalidateQueries({ queryKey: ["documents"] });
      setUploading(false);
    }
    onClose();
  }

  return (
    <Modal title="Add staff member" onClose={onClose}>
      <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3">
        <label className="col-span-full flex flex-col gap-1 text-[13px] font-medium">Full name
          <input required placeholder="e.g. Grace Adeyemi" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Email
          <input required type="email" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Phone
          <input placeholder="+965 5xxx xxxx" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.phone} onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Position
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.position} onChange={(e) => setForm((s) => ({ ...s, position: e.target.value }))}>
            {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Department
          <input required placeholder="e.g. Housekeeping" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.department} onChange={(e) => setForm((s) => ({ ...s, department: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Role (module access)
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.role_key} onChange={(e) => setForm((s) => ({ ...s, role_key: e.target.value }))}>
            {roles?.filter((r) => r.key !== "owner").map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Supervisor
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.supervisor_id} onChange={(e) => setForm((s) => ({ ...s, supervisor_id: e.target.value }))}>
            <option value="">None — reviewed by Owner</option>
            {staff?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Joining date
          <input type="date" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.join_date} onChange={(e) => setForm((s) => ({ ...s, join_date: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Monthly salary (KWD)
          <input type="number" step="0.01" placeholder="280" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.salary} onChange={(e) => setForm((s) => ({ ...s, salary: Number(e.target.value) }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">ID type
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.id_type} onChange={(e) => setForm((s) => ({ ...s, id_type: e.target.value }))}>
            {ID_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">ID number
          <input className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.id_number} onChange={(e) => setForm((s) => ({ ...s, id_number: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">ID expiry
          <input type="date" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.id_expiry} onChange={(e) => setForm((s) => ({ ...s, id_expiry: e.target.value }))} />
        </label>
        <label className="col-span-full flex flex-col gap-1 text-[13px] font-medium">Notes
          <textarea placeholder="Optional notes" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.notes} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} />
        </label>

        <div className="col-span-full">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>
              Documents — Civil ID, Passport, Residency Permit, Work Permit, etc.
            </span>
            <button type="button" className="text-xs font-semibold" style={{ color: "var(--brass-600)" }} onClick={addDocRow}>+ Add another document</button>
          </div>
          <div className="flex flex-col gap-2">
            {docs.map((d) => (
              <div key={d.key} className="flex flex-wrap items-end gap-2 rounded-lg p-2.5" style={{ background: "var(--surface-sunken)" }}>
                <label className="flex min-w-[140px] flex-1 flex-col gap-1 text-[12.5px] font-medium">Document name
                  <input placeholder="e.g. Civil ID Card" className="rounded-lg border px-2.5 py-1.5 text-sm" style={{ borderColor: "var(--border-strong)" }}
                    value={d.name} onChange={(e) => updateDocRow(d.key, { name: e.target.value })} />
                </label>
                <label className="flex w-40 flex-col gap-1 text-[12.5px] font-medium">Category
                  <select className="rounded-lg border px-2.5 py-1.5 text-sm" style={{ borderColor: "var(--border-strong)" }}
                    value={d.category} onChange={(e) => updateDocRow(d.key, { category: e.target.value })}>
                    {DOC_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-[12.5px] font-medium">File
                  <input type="file" className="rounded-lg border px-2.5 py-1.5 text-sm" style={{ borderColor: "var(--border-strong)" }}
                    onChange={(e) => updateDocRow(d.key, { file: e.target.files?.[0] ?? null })} />
                </label>
                {docs.length > 1 && (
                  <button type="button" className="text-xs font-semibold" style={{ color: "var(--status-critical)" }} onClick={() => removeDocRow(d.key)}>
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="col-span-full">
          <Button type="submit" disabled={create.isPending || uploading}>
            {create.isPending ? "Saving..." : uploading ? "Uploading documents..." : "Add Staff"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function StaffProfileModal({ staff, onClose }: { staff: StaffMember; onClose: () => void }) {
  const { data: documents } = useList<DocumentItem>("documents", "/documents");
  const { data: allStaff } = useList<StaffMember>("staff", "/people/staff");
  const [taskOpen, setTaskOpen] = useState(false);
  const [docFormOpen, setDocFormOpen] = useState(false);
  const [activeDoc, setActiveDoc] = useState<DocumentItem | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [supervisorId, setSupervisorId] = useState(staff.supervisor_id ?? "");
  const updateStaff = useUpdate<StaffMember>("staff", "/people/staff");

  const staffDocs = (documents ?? []).filter((d) => d.linked_to === staff.name);
  const supervisorOptions = (allStaff ?? []).filter((s) => s.id !== staff.id);

  function saveSupervisor() {
    updateStaff.mutate({
      id: staff.id,
      payload: {
        name: staff.name, email: staff.email ?? "", phone: staff.phone, position: staff.position,
        department: staff.department, role_key: staff.role_key ?? "", supervisor_id: supervisorId || null,
        join_date: staff.join_date, id_type: staff.id_type, id_number: staff.id_number, id_expiry: staff.id_expiry,
        contract_type: staff.contract_type, contract_end: staff.contract_end, salary: staff.salary,
        salary_currency: staff.salary_currency, emergency_contact: staff.emergency_contact,
        responsibilities: staff.responsibilities, uniform: staff.uniform, notes: staff.notes,
        off_site_role: staff.off_site_role,
      } as never,
    });
  }

  return (
    <Modal title="Staff Profile" onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-[13px]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-base font-bold" style={{ background: "var(--brass-100)", color: "var(--brass-700)" }}>
              {staff.name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
            </div>
            <div>
              <div className="font-display text-lg font-semibold">{staff.name}</div>
              <div style={{ color: "var(--ink-500)" }}>{staff.position} · {staff.department}</div>
              <Badge tone={statusTone(staff.status)}>{staff.status}</Badge>
            </div>
          </div>
          <Button variant="secondary" onClick={() => setEditOpen(true)}>Edit</Button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <ProfileBlock title="Contact" rows={[["Phone", staff.phone ?? "—"], ["Email", staff.email ?? "—"], ["Joined", staff.join_date ?? "—"]]} />
          <ProfileBlock title="Identification" rows={[["Type", staff.id_type ?? "—"], ["Number", staff.id_number ?? "—"], ["Expiry", staff.id_expiry ?? "—"]]} />
          <ProfileBlock title="Contract" rows={[["Type", staff.contract_type ?? "—"], ["Ends", staff.contract_end ?? "—"], ["Salary", staff.salary != null ? `${staff.salary} ${staff.salary_currency} /mo` : "—"]]} />
          <ProfileBlock title="Emergency Contact" rows={[["Name", staff.emergency_contact.name ?? "—"], ["Relation", staff.emergency_contact.relation ?? "—"], ["Phone", staff.emergency_contact.phone ?? "—"]]} />
        </div>

        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>
            Supervisor — reviews this employee&rsquo;s completed tasks
          </div>
          <div className="flex items-center gap-2">
            <select className="flex-1 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)}>
              <option value="">None — reviewed by Owner</option>
              {supervisorOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {supervisorId !== (staff.supervisor_id ?? "") && (
              <Button variant="secondary" onClick={saveSupervisor} disabled={updateStaff.isPending}>Save</Button>
            )}
          </div>
        </div>

        {staff.responsibilities.length > 0 && (
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>Assigned responsibilities</div>
            <div className="flex flex-wrap gap-1.5">{staff.responsibilities.map((r) => <Badge key={r}>{r}</Badge>)}</div>
          </div>
        )}
        {staff.uniform.length > 0 && (
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>Uniform / PPE issued</div>
            <div className="flex flex-wrap gap-1.5">{staff.uniform.map((u) => <Badge key={u}>{u}</Badge>)}</div>
          </div>
        )}

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>
              Documents — Kuwait labour law compliance
            </span>
            <button className="text-xs font-semibold" style={{ color: "var(--brass-600)" }} onClick={() => setDocFormOpen(true)}>+ Add document</button>
          </div>
          {staffDocs.length === 0 ? (
            <div style={{ color: "var(--ink-400)" }}>No documents on file yet — add a Civil ID, Residency Permit, or Work Permit.</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {staffDocs.map((d) => {
                const expDays = d.expiry ? Math.ceil((new Date(d.expiry).getTime() - Date.now()) / 86400000) : null;
                return (
                  <div key={d.id} className="flex cursor-pointer items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--surface-sunken)" }} onClick={() => setActiveDoc(d)}>
                    <span className="font-medium">{d.name}</span>
                    {d.expiry ? (
                      <Badge tone={expDays != null && expDays < 0 ? "critical" : expDays != null && expDays <= 30 ? "warning" : "good"}>
                        {expDays != null && expDays < 0 ? "Expired" : `Expires ${d.expiry}`}
                      </Badge>
                    ) : <Badge>No expiry</Badge>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {staff.notes && (
          <div>
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>Notes</div>
            <p style={{ color: "var(--ink-500)" }}>{staff.notes}</p>
          </div>
        )}

        <Button onClick={() => setTaskOpen(true)}>+ Assign Task</Button>
      </div>

      {taskOpen && <NewTaskModal initial={{ assignee_id: staff.id }} onClose={() => setTaskOpen(false)} />}
      {docFormOpen && (
        <NewDocumentModal
          initial={{ category: DOC_CATEGORIES[1], linked_to: staff.name }}
          onClose={() => setDocFormOpen(false)}
        />
      )}
      {activeDoc && <DocumentFilesModal doc={activeDoc} onClose={() => setActiveDoc(null)} />}
      {editOpen && <EditStaffModal staff={staff} onClose={() => setEditOpen(false)} />}
    </Modal>
  );
}

function EditStaffModal({ staff, onClose }: { staff: StaffMember; onClose: () => void }) {
  const { data: roles } = useQuery<RoleOption[]>({ queryKey: ["roles"], queryFn: async () => (await api.get("/people/roles")).data });
  const { data: allStaff } = useList<StaffMember>("staff", "/people/staff");
  const updateStaff = useUpdate<StaffMember>("staff", "/people/staff");
  const [form, setForm] = useState({
    name: staff.name, email: staff.email ?? "", phone: staff.phone ?? "", position: staff.position,
    department: staff.department, role_key: staff.role_key ?? "housekeeper", supervisor_id: staff.supervisor_id ?? "",
    join_date: staff.join_date ?? "", salary: staff.salary ?? 0, id_type: staff.id_type ?? ID_TYPES[0],
    id_number: staff.id_number ?? "", id_expiry: staff.id_expiry ?? "", notes: staff.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await updateStaff.mutateAsync({
        id: staff.id,
        payload: {
          ...form,
          phone: form.phone || null,
          supervisor_id: form.supervisor_id || null,
          id_number: form.id_number || null,
          id_expiry: form.id_expiry || null,
          notes: form.notes || null,
          join_date: form.join_date || null,
          contract_type: staff.contract_type, contract_end: staff.contract_end, salary_currency: staff.salary_currency,
          emergency_contact: staff.emergency_contact, responsibilities: staff.responsibilities, uniform: staff.uniform,
          off_site_role: staff.off_site_role,
        } as never,
      });
      onClose();
    } catch (err) {
      const message = axios.isAxiosError(err) ? (err.response?.data as { detail?: string } | undefined)?.detail : undefined;
      setError(message ?? "Could not save changes — please try again.");
    }
  }

  return (
    <Modal title="Edit staff member" onClose={onClose}>
      <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3">
        <label className="col-span-full flex flex-col gap-1 text-[13px] font-medium">Full name
          <input required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Email
          <input required type="email" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Phone
          <input placeholder="+965 5xxx xxxx" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.phone} onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Position
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.position} onChange={(e) => setForm((s) => ({ ...s, position: e.target.value }))}>
            {!POSITIONS.includes(form.position) && <option value={form.position}>{form.position}</option>}
            {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Department
          <input required placeholder="e.g. Housekeeping" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.department} onChange={(e) => setForm((s) => ({ ...s, department: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Role (module access)
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.role_key} onChange={(e) => setForm((s) => ({ ...s, role_key: e.target.value }))}>
            {roles?.filter((r) => r.key !== "owner").map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Supervisor
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.supervisor_id} onChange={(e) => setForm((s) => ({ ...s, supervisor_id: e.target.value }))}>
            <option value="">None — reviewed by Owner</option>
            {allStaff?.filter((s) => s.id !== staff.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Joining date
          <input type="date" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.join_date} onChange={(e) => setForm((s) => ({ ...s, join_date: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Monthly salary (KWD)
          <input type="number" step="0.01" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.salary} onChange={(e) => setForm((s) => ({ ...s, salary: Number(e.target.value) }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">ID type
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.id_type} onChange={(e) => setForm((s) => ({ ...s, id_type: e.target.value }))}>
            {ID_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">ID number
          <input className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.id_number} onChange={(e) => setForm((s) => ({ ...s, id_number: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">ID expiry
          <input type="date" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.id_expiry} onChange={(e) => setForm((s) => ({ ...s, id_expiry: e.target.value }))} />
        </label>
        <label className="col-span-full flex flex-col gap-1 text-[13px] font-medium">Notes
          <textarea placeholder="Optional notes" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.notes} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} />
        </label>
        {error && (
          <div className="col-span-full rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--status-critical-bg)", color: "var(--status-critical)" }}>
            {error}
          </div>
        )}
        <div className="col-span-full">
          <Button type="submit" disabled={updateStaff.isPending}>{updateStaff.isPending ? "Saving..." : "Save changes"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function ProfileBlock({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>{title}</div>
      <div className="flex flex-col gap-1">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between">
            <span style={{ color: "var(--ink-500)" }}>{label}</span>
            <span className="font-semibold">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AttendanceTab({ staff }: { staff?: StaffMember[] }) {
  const { data: attendance } = useList<AttendanceRecord>("attendance", "/attendance");
  const qc = useQueryClient();
  const today = todayIso();
  const onsite = staff?.filter((s) => !s.off_site_role) ?? [];
  const todays = attendance?.filter((a) => a.date === today) ?? [];
  const present = todays.filter((a) => a.status === "Present").length;

  const checkIn = useMutation({
    mutationFn: async (staffId: string) => {
      const existing = todays.find((a) => a.staff_id === staffId);
      const time = new Date().toISOString().slice(11, 16);
      if (existing) return api.patch(`/attendance/${existing.id}`, { check_in: time, check_out: null, status: "Present" });
      return api.post("/attendance", { staff_id: staffId, date: today, check_in: time, check_out: null, status: "Present" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance"] }),
  });
  const checkOut = useMutation({
    mutationFn: async (recordId: string) => {
      const time = new Date().toISOString().slice(11, 16);
      return api.patch(`/attendance/${recordId}`, { check_out: time });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance"] }),
  });
  const markAbsent = useMutation({
    mutationFn: async (staffId: string) => {
      const existing = todays.find((a) => a.staff_id === staffId);
      if (existing) return api.patch(`/attendance/${existing.id}`, { check_in: null, check_out: null, status: "Absent" });
      return api.post("/attendance", { staff_id: staffId, date: today, check_in: null, check_out: null, status: "Absent" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance"] }),
  });

  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-4">
        <StatTile label="Present Today" icon="people" value={`${present}/${onsite.length}`} />
        <StatTile label="Checked Out" icon="clock" value={todays.filter((a) => a.check_out).length} />
        <StatTile label="On Roster" icon="checkCircle" value={onsite.length} />
      </div>
      <Table>
        <thead><tr><Th>Employee</Th><Th>Check-in</Th><Th>Check-out</Th><Th>Status</Th><Th>Action</Th></tr></thead>
        <tbody>
          {onsite.map((s) => {
            const record = todays.find((a) => a.staff_id === s.id);
            return (
              <tr key={s.id}>
                <Td className="font-medium">{s.name}</Td>
                <Td>{record?.check_in ?? "—"}</Td>
                <Td>{record?.check_out ?? "—"}</Td>
                <Td><Badge tone={statusTone(record?.status ?? "Absent")}>{record?.status ?? "Absent"}</Badge></Td>
                <Td>
                  <div className="flex gap-2">
                    {!record || record.status !== "Present" ? (
                      <button className="text-xs font-semibold" style={{ color: "var(--status-good)" }} onClick={() => checkIn.mutate(s.id)}>Check In</button>
                    ) : !record.check_out ? (
                      <button className="text-xs font-semibold" style={{ color: "var(--brass-600)" }} onClick={() => checkOut.mutate(record.id)}>Check Out</button>
                    ) : (
                      <span className="text-xs" style={{ color: "var(--ink-400)" }}>Shift complete</span>
                    )}
                    {(!record || record.status === "Present") && (
                      <button className="text-xs font-semibold" style={{ color: "var(--status-critical)" }} onClick={() => markAbsent.mutate(s.id)}>Mark Absent</button>
                    )}
                  </div>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}

function LeaveTab({ staff }: { staff?: StaffMember[] }) {
  const { data: leave, isLoading } = useList<LeaveRequestRecord>("leave-requests", "/leave-requests");
  const qc = useQueryClient();
  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => api.patch(`/leave-requests/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leave-requests"] }),
  });
  const staffName = (id: string) => staff?.find((s) => s.id === id)?.name ?? "—";

  if (isLoading) return <Spinner />;
  if (!leave || leave.length === 0) return <EmptyState label="No leave requests." />;

  return (
    <Table>
      <thead><tr><Th>Staff</Th><Th>Type</Th><Th>Dates</Th><Th>Days</Th><Th>Reason</Th><Th>Status</Th><Th>Action</Th></tr></thead>
      <tbody>
        {leave.map((l) => (
          <tr key={l.id}>
            <Td className="font-medium">{staffName(l.staff_id)}</Td>
            <Td>{l.type}</Td>
            <Td>{l.from_date} – {l.to_date}</Td>
            <Td>{l.days}</Td>
            <Td>{l.reason ?? "—"}</Td>
            <Td><Badge tone={statusTone(l.status)}>{l.status}</Badge></Td>
            <Td>
              {l.status === "Pending" && (
                <div className="flex gap-2">
                  <button className="text-xs font-semibold" style={{ color: "var(--status-good)" }} onClick={() => setStatus.mutate({ id: l.id, status: "Approved" })}>Approve</button>
                  <button className="text-xs font-semibold" style={{ color: "var(--status-critical)" }} onClick={() => setStatus.mutate({ id: l.id, status: "Rejected" })}>Reject</button>
                </div>
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function ShiftTab({ staff }: { staff?: StaffMember[] }) {
  const { data: shifts, isLoading } = useList<ShiftRecord>("shifts", "/shifts");
  const { data: patternsRaw } = useList<ShiftPattern>("shift-patterns", "/shift-patterns");
  // The generic list endpoint always sorts descending, so re-sort A-Z here
  // rather than showing patterns in a confusing, effectively-random order.
  const patterns = [...(patternsRaw ?? [])].sort((a, b) => a.label.localeCompare(b.label));
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ staffId: string; day: string; value: string } | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const existing = shifts?.find((s) => s.staff_id === editing.staffId);
      const pattern = { ...(existing?.pattern ?? {}), [editing.day]: editing.value };
      if (existing) return api.patch(`/shifts/${existing.id}`, { pattern });
      return api.post("/shifts", { staff_id: editing.staffId, pattern });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shifts"] }); setEditing(null); },
  });

  if (isLoading || !staff) return <Spinner />;

  const knownLabels = new Set(patterns.map((p) => p.label));

  return (
    <div>
      <Table>
        <thead><tr><Th>Employee</Th>{DAYS.map((d) => <Th key={d.key}>{d.label}</Th>)}</tr></thead>
        <tbody>
          {staff.filter((s) => !s.off_site_role).map((s) => {
            const shift = shifts?.find((x) => x.staff_id === s.id);
            return (
              <tr key={s.id}>
                <Td className="font-medium">{s.name}</Td>
                {DAYS.map((d) => (
                  <Td key={d.key} className="cursor-pointer text-[12.5px]" >
                    <span onClick={() => setEditing({ staffId: s.id, day: d.key, value: shift?.pattern[d.key] ?? "Off" })}>
                      {shift?.pattern[d.key] ?? "Off"}
                    </span>
                  </Td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </Table>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={() => setEditing(null)}>
          <div className="w-full max-w-xs rounded-2xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 text-[13px] font-semibold">Edit shift — {editing.day.toUpperCase()}</div>
            <select
              className="mb-1 w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border-strong)" }}
              value={editing.value}
              onChange={(e) => setEditing((s) => (s ? { ...s, value: e.target.value } : s))}
              autoFocus
            >
              {!knownLabels.has(editing.value) && <option value={editing.value}>{editing.value} (not in the list)</option>}
              {patterns.map((p) => <option key={p.id} value={p.label}>{p.label}</option>)}
            </select>
            <p className="mb-3 text-[11.5px]" style={{ color: "var(--ink-400)" }}>
              Manage the available shift values in Settings → Shift Patterns.
            </p>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving..." : "Save"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

const REPORT_VIEWS = ["Daily Report", "Monthly Report"] as const;

function hoursBetween(checkIn: string | null, checkOut: string | null): number | null {
  if (!checkIn || !checkOut) return null;
  const [h1, m1] = checkIn.split(":").map(Number);
  const [h2, m2] = checkOut.split(":").map(Number);
  return Math.round(((h2 * 60 + m2 - (h1 * 60 + m1)) / 6)) / 10;
}
function fmtHours(h: number | null): string {
  if (h == null) return "—";
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh}h${mm ? ` ${mm}m` : ""}`;
}

function AttendanceReportsTab({ staff }: { staff?: StaffMember[] }) {
  const [view, setView] = useState<(typeof REPORT_VIEWS)[number]>("Daily Report");
  const { data: attendance, isLoading } = useList<AttendanceRecord>("attendance", "/attendance");
  const onsite = staff?.filter((s) => !s.off_site_role) ?? [];

  if (isLoading || !attendance) return <Spinner />;

  return (
    <div>
      <div className="mb-4 flex gap-1 rounded-xl p-1" style={{ background: "var(--surface-sunken)", width: "fit-content" }}>
        {REPORT_VIEWS.map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className="rounded-lg px-3.5 py-1.5 text-[13px] font-semibold"
            style={{
              background: view === v ? "var(--surface)" : "transparent",
              color: view === v ? "var(--ink-900)" : "var(--ink-500)",
              boxShadow: view === v ? "var(--shadow-sm)" : "none",
            }}
          >
            {v}
          </button>
        ))}
      </div>
      {view === "Daily Report" ? <DailyReport onsite={onsite} attendance={attendance} /> : <MonthlyReport onsite={onsite} attendance={attendance} />}
    </div>
  );
}

function DailyReport({ onsite, attendance }: { onsite: StaffMember[]; attendance: AttendanceRecord[] }) {
  const [date, setDate] = useState(todayIso());
  const rows = onsite.map((s) => ({ staff: s, record: attendance.find((a) => a.staff_id === s.id && a.date === date) }));
  const present = rows.filter((r) => r.record?.status === "Present").length;
  const absent = rows.filter((r) => !r.record || r.record.status === "Absent").length;
  const totalHours = rows.reduce((s, r) => s + (hoursBetween(r.record?.check_in ?? null, r.record?.check_out ?? null) ?? 0), 0);

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <input type="date" max={todayIso()} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
          value={date} onChange={(e) => setDate(e.target.value)} />
        <span className="text-[12.5px]" style={{ color: "var(--ink-500)" }}>Daily attendance for {date}</span>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Present" icon="checkCircle" value={present} progressColor="var(--status-good)" />
        <StatTile label="Absent" icon="alertTriangle" value={absent} progressColor="var(--status-critical)" />
        <StatTile label="Total Staff" icon="people" value={onsite.length} />
        <StatTile label="Total Hours" icon="clock" value={fmtHours(totalHours)} />
      </div>
      <Table>
        <thead><tr><Th>Employee</Th><Th>Department</Th><Th>Check-in</Th><Th>Check-out</Th><Th>Status</Th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.staff.id}>
              <Td className="font-medium">{r.staff.name}</Td>
              <Td>{r.staff.department}</Td>
              <Td>{r.record?.check_in ?? "—"}</Td>
              <Td>{r.record?.check_out ?? "—"}</Td>
              <Td><Badge tone={statusTone(r.record?.status ?? "Absent")}>{r.record?.status ?? "Absent"}</Badge></Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function MonthlyReport({ onsite, attendance }: { onsite: StaffMember[]; attendance: AttendanceRecord[] }) {
  const dates = Array.from(new Set(attendance.map((a) => a.date))).sort();
  const rows = onsite.map((s) => {
    const records = attendance.filter((a) => a.staff_id === s.id);
    const present = records.filter((r) => r.status === "Present").length;
    const absent = records.filter((r) => r.status === "Absent").length;
    const hours = records.reduce((sum, r) => sum + (hoursBetween(r.check_in, r.check_out) ?? 0), 0);
    return { staff: s, present, absent, hours };
  });

  return (
    <div>
      <div className="mb-4 text-[12.5px]" style={{ color: "var(--ink-500)" }}>
        {dates.length > 0
          ? `Summary across every recorded attendance date · ${dates[0]} – ${dates[dates.length - 1]}`
          : "No attendance history recorded yet."}
      </div>
      <Table>
        <thead><tr><Th>Employee</Th><Th>Position</Th><Th>Present</Th><Th>Absent</Th><Th>Total Hours</Th><Th>Avg Hrs/Day</Th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.staff.id}>
              <Td className="font-medium">{r.staff.name}</Td>
              <Td>{r.staff.position}</Td>
              <Td>{r.present}</Td>
              <Td>{r.absent}</Td>
              <Td>{fmtHours(r.hours)}</Td>
              <Td>{fmtHours(r.present ? r.hours / r.present : 0)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
