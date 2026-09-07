import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useCreate, useList } from "../api/hooks";
import { useAuth } from "../auth/AuthContext";
import { AttachmentsPanel } from "../components/AttachmentsPanel";
import { Icon } from "../components/icons";
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Spinner, StatTile, Table, Td, Th, statusTone } from "../components/ui";
import { daysLabel, daysUntil, todayIso } from "../lib/date";
import type { Area, Asset, MaintenanceRequest, PmScheduleItem, StaffMember } from "../types";

const MAINT_STATUSES = ["Reported", "Assigned", "In Progress", "Repaired", "Verified", "Closed"];
const TABS = ["Requests", "Preventive Schedule"] as const;

export function Maintenance() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Requests");
  const { data: requests } = useList<MaintenanceRequest>("maintenance-requests", "/maintenance-requests");
  const { data: assets } = useList<Asset>("assets", "/assets");
  const { data: pm } = useList<PmScheduleItem>("pm-schedule", "/pm-schedule");
  const [modal, setModal] = useState<"report" | null>(null);

  const open = requests?.filter((r) => r.status !== "Closed").length ?? 0;
  const pmOverdue = pm?.filter((p) => daysUntil(p.due_date) < 0).length ?? 0;
  const pmDue30 = pm?.filter((p) => daysUntil(p.due_date) >= 0 && daysUntil(p.due_date) <= 30).length ?? 0;

  return (
    <div>
      <PageHeader
        title="Maintenance"
        subtitle="Repair requests and preventive maintenance schedules."
        action={
          <Button onClick={() => setModal("report")}>
            <span className="flex items-center gap-1.5"><Icon name="maintenance" className="h-3.5 w-3.5" />Report Issue</span>
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Open Requests" icon="maintenance" value={open} progressColor="var(--status-warning)" />
        <StatTile label="Assets Tracked" icon="inventory" value={assets?.length ?? 0} sub="Managed in Settings → Asset Register" />
        <StatTile label="PM Overdue" icon="alertTriangle" value={pmOverdue} progressColor="var(--status-critical)" />
        <StatTile label="PM Due (30d)" icon="clock" value={pmDue30} />
      </div>

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

      {tab === "Requests" && <RequestsBoard requests={requests} />}
      {tab === "Preventive Schedule" && <PmView pm={pm} assets={assets} />}

      {modal === "report" && <ReportIssueModal onClose={() => setModal(null)} />}
    </div>
  );
}

function RequestsBoard({ requests }: { requests?: MaintenanceRequest[] }) {
  const { data: staff } = useList<StaffMember>("staff", "/people/staff");
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [detail, setDetail] = useState<MaintenanceRequest | null>(null);
  const advance = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      api.post(`/maintenance-requests/${id}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["maintenance-requests"] });
      qc.invalidateQueries({ queryKey: ["activity-log"] });
      setDetail(null);
    },
  });
  const assign = useMutation({
    mutationFn: async ({ id, assignee_id }: { id: string; assignee_id: string }) =>
      api.post(`/maintenance-requests/${id}/assign`, { assignee_id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["maintenance-requests"] });
      qc.invalidateQueries({ queryKey: ["activity-log"] });
    },
  });
  const confirmRepair = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) =>
      api.post(`/approvals/maintenance_confirmation/${id}/decision?approve=${approve}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["maintenance-requests"] });
      qc.invalidateQueries({ queryKey: ["activity-log"] });
      qc.invalidateQueries({ queryKey: ["approvals"] });
      setDetail(null);
    },
  });

  const staffName = (id: string | null) => staff?.find((s) => s.id === id)?.name ?? "Unassigned";
  const canConfirm = (req: MaintenanceRequest) => me?.user_type === "owner" || me?.id === req.reported_by;

  if (!requests) return <Spinner />;

  return (
    <>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {MAINT_STATUSES.map((status) => {
          const items = requests.filter((r) => r.status === status);
          return (
            <div key={status} className="w-[260px] shrink-0">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-[12.5px] font-semibold" style={{ color: "var(--ink-700)" }}>{status}</span>
                <Badge tone={statusTone(status)}>{items.length}</Badge>
              </div>
              <div className="flex flex-col gap-2">
                {items.map((r) => (
                  <Card key={r.id} className="cursor-pointer !p-3" >
                    <div onClick={() => setDetail(r)}>
                      <div className="text-[13px] font-semibold">{r.issue}</div>
                      <div className="mt-1 flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--ink-400)" }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusTone(r.priority) === "critical" ? "var(--status-critical)" : "var(--status-warning)" }} />
                        {r.priority} · {staffName(r.assignee_id).split(" ")[0]}
                      </div>
                    </div>
                  </Card>
                ))}
                {items.length === 0 && <div className="px-1 text-[11.5px]" style={{ color: "var(--ink-300)" }}>None</div>}
              </div>
            </div>
          );
        })}
      </div>

      {detail && (
        <Modal title={detail.issue} onClose={() => setDetail(null)}>
          <div className="flex flex-col gap-3 text-[13px]">
            <div className="grid grid-cols-2 gap-2">
              <InfoRow label="Priority" value={detail.priority} />
              <InfoRow label="Status" value={detail.status} />
              <InfoRow label="Reported" value={detail.reported_date} />
            </div>
            {detail.description && <p style={{ color: "var(--ink-700)" }}>{detail.description}</p>}
            <AttachmentsPanel entityType="maintenance_request" entityId={detail.id} />
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              Assign technician
              <select
                className="rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border-strong)" }}
                value={detail.assignee_id ?? ""}
                onChange={(e) => assign.mutate({ id: detail.id, assignee_id: e.target.value })}
              >
                <option value="">Unassigned</option>
                {staff?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            {detail.status === "Repaired" ? (
              canConfirm(detail) ? (
                <div className="flex gap-2">
                  <Button onClick={() => confirmRepair.mutate({ id: detail.id, approve: true })} disabled={confirmRepair.isPending}>
                    Confirm &amp; Verify
                  </Button>
                  <Button variant="ghost" onClick={() => confirmRepair.mutate({ id: detail.id, approve: false })} disabled={confirmRepair.isPending}>
                    Not satisfactory — reopen
                  </Button>
                </div>
              ) : (
                <div className="text-[12.5px]" style={{ color: "var(--ink-400)" }}>
                  Awaiting confirmation from the requester.
                </div>
              )
            ) : (
              MAINT_STATUSES.indexOf(detail.status) < MAINT_STATUSES.length - 1 && (
                <Button
                  onClick={() => advance.mutate({ id: detail.id, status: MAINT_STATUSES[MAINT_STATUSES.indexOf(detail.status) + 1] })}
                  disabled={advance.isPending}
                >
                  Mark as {MAINT_STATUSES[MAINT_STATUSES.indexOf(detail.status) + 1]}
                </Button>
              )
            )}
          </div>
        </Modal>
      )}
    </>
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

function PmView({ pm, assets }: { pm?: PmScheduleItem[]; assets?: Asset[] }) {
  const qc = useQueryClient();
  const assetName = (id: string) => assets?.find((a) => a.id === id)?.name ?? "—";

  const logService = useMutation({
    mutationFn: async (p: PmScheduleItem) => api.post(`/pm-schedule/${p.id}/log-service`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-schedule"] });
      qc.invalidateQueries({ queryKey: ["assets"] });
      qc.invalidateQueries({ queryKey: ["activity-log"] });
    },
  });

  if (!pm) return <Spinner />;
  if (pm.length === 0) return <EmptyState label="No preventive maintenance scheduled." />;
  return (
    <Table>
      <thead><tr><Th>Asset</Th><Th>Task</Th><Th>Frequency</Th><Th>Due</Th><Th>{" "}</Th></tr></thead>
      <tbody>
        {pm.map((p) => (
          <tr key={p.id}>
            <Td className="font-medium">{assetName(p.asset_id)}</Td>
            <Td>{p.task}</Td>
            <Td>{p.frequency}</Td>
            <Td><Badge tone={daysUntil(p.due_date) < 0 ? "critical" : daysUntil(p.due_date) <= 14 ? "warning" : "good"}>{daysLabel(daysUntil(p.due_date))}</Badge></Td>
            <Td>
              <Button size="sm" variant="secondary" disabled={logService.isPending} onClick={() => logService.mutate(p)}>
                {logService.isPending ? "Logging..." : "Log Service"}
              </Button>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function ReportIssueModal({ onClose }: { onClose: () => void }) {
  const create = useCreate<MaintenanceRequest>("maintenance-requests", "/maintenance-requests");
  const { data: areas } = useList<Area>("areas", "/areas");
  const [form, setForm] = useState({ issue: "", location_id: "", description: "", priority: "Medium" });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await create.mutateAsync({
      ...form,
      location_id: form.location_id || null,
      reported_date: todayIso(),
      status: "Reported",
    } as never);
    onClose();
  }

  return (
    <Modal title="Report a maintenance issue" onClose={onClose}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-medium">Issue
          <input required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.issue} onChange={(e) => setForm((s) => ({ ...s, issue: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Location
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.location_id} onChange={(e) => setForm((s) => ({ ...s, location_id: e.target.value }))}>
            <option value="">—</option>
            {areas?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Priority
          <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.priority} onChange={(e) => setForm((s) => ({ ...s, priority: e.target.value }))}>
            {["Low", "Medium", "High"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">Description
          <textarea className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.description} onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))} />
        </label>
        <div className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--ink-400)" }}>
          <Icon name="camera" className="h-4 w-4" />Photo attachment available from the request card once created.
        </div>
        <Button type="submit" disabled={create.isPending}>{create.isPending ? "Submitting..." : "Submit report"}</Button>
      </form>
    </Modal>
  );
}
