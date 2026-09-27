import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { api } from "../api/client";
import { useCreate, useList } from "../api/hooks";
import { useAuth } from "../auth/AuthContext";
import { AttachmentsPanel } from "../components/AttachmentsPanel";
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Spinner, statusTone, Table, Td, Th } from "../components/ui";
import { todayIso } from "../lib/date";
import type { Area, StaffMember, TaskCategory, TaskItem } from "../types";

interface TemplateItem { text: string; start_time: string | null; end_time: string | null }
interface TaskTemplate {
  id: string; title: string; category: string; recurrence: string; recurrence_interval_days: number | null; items: TemplateItem[];
  requires_verification: boolean;
}

const STATUSES = ["Pending", "In Progress", "Completed", "Verified", "Overdue"];
const TABS = ["Board", "Templates", "Productivity"] as const;

interface NewTaskInitial {
  title?: string; category?: string; assignee_id?: string;
  recurrence?: string; recurrence_interval_days?: number; checklist?: TemplateItem[];
  requires_verification?: boolean;
}

export function Tasks() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Board");
  const [newTaskFrom, setNewTaskFrom] = useState<NewTaskInitial | null>(null);
  const [templateModal, setTemplateModal] = useState<"add" | null>(null);

  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle="Centralized task management across every module — assign, track and verify."
        action={
          <div className="flex gap-2">
            {tab === "Templates" && <Button variant="secondary" onClick={() => setTemplateModal("add")}>+ Add Template</Button>}
            <Button onClick={() => setNewTaskFrom({})}>+ New Task</Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl p-1" style={{ background: "var(--surface-sunken)", width: "fit-content" }}>
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

      {tab === "Board" && <BoardView />}
      {tab === "Templates" && (
        <TemplatesView
          onUse={(t) => setNewTaskFrom({
            title: t.title, category: t.category, recurrence: t.recurrence,
            recurrence_interval_days: t.recurrence_interval_days ?? undefined,
            checklist: t.items,
            requires_verification: t.requires_verification,
          })}
        />
      )}
      {tab === "Productivity" && <ProductivityTab />}

      {newTaskFrom && <NewTaskModal initial={newTaskFrom} onClose={() => setNewTaskFrom(null)} />}
      {templateModal === "add" && <TemplateModal onClose={() => setTemplateModal(null)} />}
    </div>
  );
}

function BoardView() {
  const { data: tasks, isLoading } = useList<TaskItem>("tasks", "/tasks");
  const { data: staff } = useList<StaffMember>("staff", "/people/staff");
  const { data: areas } = useList<Area>("areas", "/areas");
  const { user: me } = useAuth();
  const [category, setCategory] = useState("all");
  const [detail, setDetail] = useState<TaskItem | null>(null);
  const qc = useQueryClient();

  const advance = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      api.patch(`/tasks/${id}/status?status_value=${encodeURIComponent(status)}`),
    // A status change can move a Housekeeping task in/out of "done", which
    // recomputes its area's completion % server-side — refresh areas too so
    // the Housekeeping cards and Dashboard tile don't show stale numbers.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["areas"] });
      qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
      setDetail(null);
    },
  });
  const reviewTask = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) =>
      api.post(`/approvals/task_review/${id}/decision?approve=${approve}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: ["areas"] });
      qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
      setDetail(null);
    },
  });
  const deleteTask = useMutation({
    mutationFn: async (id: string) => api.delete(`/tasks/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["areas"] });
      qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
      setDetail(null);
    },
  });
  const myProfile = staff?.find((s) => s.user_id === me?.id);
  const canReview = (task: TaskItem) =>
    me?.user_type === "owner" ||
    (!!myProfile && staff?.find((s) => s.id === task.assignee_id)?.supervisor_id === myProfile.id);
  const toggleItem = useMutation({
    mutationFn: async ({ taskId, itemId, done }: { taskId: string; itemId: string; done: boolean }) =>
      api.patch(`/tasks/${taskId}/checklist/${itemId}?done=${done}`),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ["tasks"] }); setDetail(res.data); },
  });
  const [comment, setComment] = useState("");
  const addComment = useMutation({
    mutationFn: async ({ taskId, text }: { taskId: string; text: string }) =>
      api.post(`/tasks/${taskId}/comments?text=${encodeURIComponent(text)}`),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ["tasks"] }); setDetail(res.data); setComment(""); },
  });

  const staffName = (id: string | null) => staff?.find((s) => s.id === id)?.name ?? "Unassigned";
  const areaName = (id: string | null) => areas?.find((a) => a.id === id)?.name ?? "—";
  const categories = Array.from(new Set(tasks?.map((t) => t.category) ?? []));
  const filtered = tasks?.filter((t) => category === "all" || t.category === category) ?? [];

  if (isLoading) return <Spinner />;

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
          value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="ml-auto text-[12.5px]" style={{ color: "var(--ink-500)" }}>{filtered.length} tasks</span>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {STATUSES.map((status) => {
          const items = filtered.filter((t) => t.status === status);
          return (
            <div key={status} className="w-[240px] shrink-0">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-[12.5px] font-semibold" style={{ color: "var(--ink-700)" }}>{status}</span>
                <Badge tone={statusTone(status)}>{items.length}</Badge>
              </div>
              <div className="flex flex-col gap-2">
                {items.map((t) => {
                  const timed = t.checklist.filter((c) => c.start_time && c.end_time);
                  const span = timed.length
                    ? `${timed.reduce((min, c) => (c.start_time! < min ? c.start_time! : min), timed[0].start_time!).slice(0, 5)}–`
                      + `${timed.reduce((max, c) => (c.end_time! > max ? c.end_time! : max), timed[0].end_time!).slice(0, 5)}`
                    : "";
                  return (
                    <Card key={t.id} className="!p-3 cursor-pointer" >
                      <div onClick={() => setDetail(t)}>
                        <div className="text-[13px] font-semibold">{t.title}</div>
                        <div className="mt-1 flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--ink-400)" }}>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.priority === "High" ? "var(--status-critical)" : t.priority === "Low" ? "var(--status-good)" : "var(--status-warning)" }} />
                          {t.priority} · {t.due_date}{span && ` · ${span}`}
                        </div>
                        <div className="mt-1.5 text-[11.5px]" style={{ color: "var(--ink-400)" }}>{staffName(t.assignee_id).split(" ")[0]}</div>
                      </div>
                    </Card>
                  );
                })}
                {items.length === 0 && <div className="px-1 text-[11.5px]" style={{ color: "var(--ink-300)" }}>None</div>}
              </div>
            </div>
          );
        })}
      </div>

      {detail && (
        <Modal
          title={
            <div className="flex flex-col gap-1.5">
              <span>{detail.title}</span>
              <Badge tone={statusTone(detail.status)}>{detail.status}</Badge>
            </div>
          }
          onClose={() => setDetail(null)}
          wide
        >
          <div className="flex flex-col gap-3 text-[13px]">
            <div className="grid grid-cols-2 gap-2">
              <InfoRow label="Category" value={detail.category} />
              <InfoRow label="Location" value={areaName(detail.location_id)} />
              <InfoRow label="Priority" value={detail.priority} />
              <InfoRow label="Recurrence" value={detail.recurrence} />
              <InfoRow label="Assigned to" value={staffName(detail.assignee_id)} />
              <InfoRow label="Due" value={detail.due_date} />
              <InfoRow label="Verified" value={detail.verified ? "Yes" : "No"} />
            </div>

            {detail.description && <p style={{ color: "var(--ink-700)" }}>{detail.description}</p>}

            <AttachmentsPanel entityType="task" entityId={detail.id} />

            {detail.checklist.length > 0 && (
              <div>
                <div className="mb-1.5 text-[11px] font-bold uppercase" style={{ color: "var(--ink-400)" }}>Checklist</div>
                <div className="flex flex-col gap-1.5">
                  {detail.checklist.map((c) => (
                    <label key={c.id} className="flex items-center gap-2">
                      <input type="checkbox" checked={c.done} onChange={(e) => toggleItem.mutate({ taskId: detail.id, itemId: c.id, done: e.target.checked })} />
                      <span style={{ textDecoration: c.done ? "line-through" : "none", color: c.done ? "var(--ink-400)" : "var(--ink-900)" }}>{c.text}</span>
                      {c.start_time && c.end_time && (
                        <span className="text-[11px]" style={{ color: "var(--ink-400)" }}>{c.start_time.slice(0, 5)}–{c.end_time.slice(0, 5)}</span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="mb-1.5 text-[11px] font-bold uppercase" style={{ color: "var(--ink-400)" }}>Comments</div>
              <div className="flex flex-col gap-2">
                {detail.comments.length === 0 ? (
                  <div className="text-[12.5px]" style={{ color: "var(--ink-400)" }}>No comments yet.</div>
                ) : detail.comments.map((c) => (
                  <div key={c.id} className="rounded-lg p-2" style={{ background: "var(--surface-sunken)" }}>
                    <div className="text-[12px] font-bold">{c.author_name} <span className="font-normal" style={{ color: "var(--ink-400)" }}>· {c.at}</span></div>
                    <div className="text-[12.5px]">{c.text}</div>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <input className="flex-1 rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-strong)" }}
                  placeholder="Add a comment…" value={comment} onChange={(e) => setComment(e.target.value)} />
                <Button variant="secondary" onClick={() => comment.trim() && addComment.mutate({ taskId: detail.id, text: comment })}>Post</Button>
              </div>
            </div>

            {detail.status === "Completed" ? (
              canReview(detail) ? (
                <div className="flex gap-2">
                  <Button onClick={() => reviewTask.mutate({ id: detail.id, approve: true })} disabled={reviewTask.isPending}>
                    Approve &amp; Verify
                  </Button>
                  <Button variant="ghost" onClick={() => reviewTask.mutate({ id: detail.id, approve: false })} disabled={reviewTask.isPending}>
                    Send back for rework
                  </Button>
                </div>
              ) : (
                <div className="text-[12.5px]" style={{ color: "var(--ink-400)" }}>
                  Awaiting review from {(() => {
                    const supervisorId = staff?.find((s) => s.id === detail.assignee_id)?.supervisor_id;
                    return supervisorId ? staffName(supervisorId) : "the Owner";
                  })()}.
                </div>
              )
            ) : detail.status !== "Verified" && (
              <Button onClick={() => advance.mutate({ id: detail.id, status: STATUSES[Math.min(STATUSES.indexOf(detail.status) + 1, STATUSES.length - 1)] })} disabled={advance.isPending}>
                Mark as {STATUSES[Math.min(STATUSES.indexOf(detail.status) + 1, STATUSES.length - 1)]}
              </Button>
            )}

            <button
              type="button"
              className="self-start text-xs font-semibold"
              style={{ color: "var(--status-critical)" }}
              disabled={deleteTask.isPending}
              onClick={() => confirm(`Delete the "${detail.title}" task? This can't be undone.`) && deleteTask.mutate(detail.id)}
            >
              {deleteTask.isPending ? "Deleting..." : "Delete task"}
            </button>
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

function TemplatesView({ onUse }: { onUse: (t: TaskTemplate) => void }) {
  const { data, isLoading } = useList<TaskTemplate>("task-templates", "/task-templates");
  const qc = useQueryClient();
  const [editing, setEditing] = useState<TaskTemplate | null>(null);
  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/task-templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task-templates"] }),
  });

  if (isLoading) return <Spinner />;
  if (!data || data.length === 0) return <EmptyState label="No task templates yet. Use “+ Add Template” above to create one." />;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {data.map((t) => (
          <Card key={t.id}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[14.5px] font-semibold">{t.title}</h3>
              <Badge>{t.recurrence === "Custom" && t.recurrence_interval_days ? `Every ${t.recurrence_interval_days}d` : t.recurrence}</Badge>
            </div>
            <div className="mb-2.5 text-xs" style={{ color: "var(--ink-500)" }}>{t.category}</div>
            <div className="flex flex-col gap-1">
              {t.items.map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--ink-700)" }}>
                  <span className="h-1 w-1 rounded-full" style={{ background: "var(--ink-300)" }} />
                  {item.text}
                  {item.start_time && item.end_time && (
                    <span className="text-[11px]" style={{ color: "var(--ink-400)" }}>{item.start_time.slice(0, 5)}–{item.end_time.slice(0, 5)}</span>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => onUse(t)}>Use template</Button>
              <Button variant="ghost" onClick={() => setEditing(t)}>Edit</Button>
              <Button
                variant="danger"
                onClick={() => confirm(`Delete the "${t.title}" template? This can't be undone.`) && remove.mutate(t.id)}
                disabled={remove.isPending}
              >
                Delete
              </Button>
            </div>
          </Card>
        ))}
      </div>
      {editing && <TemplateModal template={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ProductivityTab() {
  const { data: tasks, isLoading } = useList<TaskItem>("tasks", "/tasks");
  const { data: staff } = useList<StaffMember>("staff", "/people/staff");

  if (isLoading) return <Spinner />;
  if (!tasks || tasks.length === 0) return <EmptyState label="No tasks logged yet." />;

  const byStaff = new Map<string, { total: number; done: number; verified: number }>();
  for (const t of tasks) {
    if (!t.assignee_id) continue;
    const row = byStaff.get(t.assignee_id) ?? { total: 0, done: 0, verified: 0 };
    row.total += 1;
    if (t.status === "Completed" || t.status === "Verified") row.done += 1;
    if (t.status === "Verified") row.verified += 1;
    byStaff.set(t.assignee_id, row);
  }
  const rows = Array.from(byStaff.entries())
    .map(([staffId, r]) => ({
      staffId, name: staff?.find((s) => s.id === staffId)?.name ?? "Unknown",
      ...r, rate: r.total ? Math.round((r.done / r.total) * 100) : 0,
    }))
    .sort((a, b) => b.done - a.done);

  return (
    <div>
      <p className="mb-3 text-[13px]" style={{ color: "var(--ink-500)" }}>
        Tasks each staff member has finished — a task counts as Done once its status reaches Completed or Verified.
      </p>
      <Table>
        <thead><tr><Th>Staff</Th><Th>Assigned</Th><Th>Done</Th><Th>Verified</Th><Th>Completion Rate</Th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.staffId}>
              <Td className="font-medium">{r.name}</Td>
              <Td>{r.total}</Td>
              <Td>{r.done}</Td>
              <Td>{r.verified}</Td>
              <Td>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-24 rounded-full" style={{ background: "var(--surface-sunken)" }}>
                    <div className="h-1.5 rounded-full" style={{ width: `${r.rate}%`, background: "var(--status-good)" }} />
                  </div>
                  {r.rate}%
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function TemplateModal({ template, onClose }: { template?: TaskTemplate; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: taskCategoriesRaw } = useList<TaskCategory>("task-categories", "/task-categories");
  const taskCategories = [...(taskCategoriesRaw ?? [])].sort((a, b) => a.label.localeCompare(b.label));
  const [form, setForm] = useState({
    title: template?.title ?? "",
    category: template?.category ?? "",
    recurrence: template?.recurrence ?? "One-time",
    recurrence_interval_days: template?.recurrence_interval_days ?? 7,
    items: template?.items && template.items.length > 0
      ? template.items.map((i) => ({ text: i.text, start_time: i.start_time ?? "", end_time: i.end_time ?? "" }))
      : [{ text: "", start_time: "", end_time: "" }],
    requires_verification: template?.requires_verification ?? true,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!template && taskCategories.length > 0 && !form.category) {
      setForm((s) => ({ ...s, category: taskCategories[0].label }));
    }
  }, [taskCategories, form.category, template]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        title: form.title,
        category: form.category,
        recurrence: form.recurrence,
        recurrence_interval_days: form.recurrence === "Custom" ? form.recurrence_interval_days : null,
        items: form.items
          .filter((i) => i.text.trim())
          .map((i) => ({ text: i.text.trim(), start_time: i.start_time || null, end_time: i.end_time || null })),
        requires_verification: form.requires_verification,
      };
      return template ? api.patch(`/task-templates/${template.id}`, payload) : api.post("/task-templates", payload);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["task-templates"] }); onClose(); },
  });

  function updateItem(i: number, patch: Partial<{ text: string; start_time: string; end_time: string }>) {
    setForm((s) => ({ ...s, items: s.items.map((item, idx) => (idx === i ? { ...item, ...patch } : item)) }));
  }
  function addItem() {
    setForm((s) => ({ ...s, items: [...s.items, { text: "", start_time: "", end_time: "" }] }));
  }
  function removeItem(i: number) {
    setForm((s) => ({ ...s, items: s.items.filter((_, idx) => idx !== i) }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    for (const item of form.items) {
      if (item.start_time && item.end_time && item.start_time >= item.end_time) {
        setError(`'${item.text || "Untitled item"}': end time must be after start time.`);
        return;
      }
    }
    save.mutate();
  }

  return (
    <Modal title={template ? "Edit template" : "Add template"} onClose={onClose} wide>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-medium">Template title
          <input required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.title} onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-medium">Category
            <select required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.category} onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))}>
              {form.category && !taskCategories.some((c) => c.label === form.category) && (
                <option value={form.category}>{form.category}</option>
              )}
              {taskCategories.map((c) => <option key={c.id} value={c.label}>{c.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Recurrence
            <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.recurrence} onChange={(e) => setForm((s) => ({ ...s, recurrence: e.target.value }))}>
              {["One-time", "Daily", "Weekly", "Monthly", "Custom"].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          {form.recurrence === "Custom" && (
            <label className="flex flex-col gap-1 text-[13px] font-medium">Repeat every (days)
              <input type="number" min={1} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
                value={form.recurrence_interval_days} onChange={(e) => setForm((s) => ({ ...s, recurrence_interval_days: Number(e.target.value) }))} />
            </label>
          )}
        </div>
        <label className="flex items-center gap-2 text-[13px] font-medium">
          <input type="checkbox" checked={form.requires_verification}
            onChange={(e) => setForm((s) => ({ ...s, requires_verification: e.target.checked }))} />
          Tasks from this template require supervisor verification
        </label>
        <div>
          <div className="mb-1.5 text-[13px] font-medium">Checklist items</div>
          <p className="mb-1.5 text-[12px]" style={{ color: "var(--ink-400)" }}>
            Start / end time are optional per item — set both to block out a scheduled slot for that specific activity.
          </p>
          <div className="flex flex-col gap-1.5">
            {form.items.map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <input placeholder="e.g. Wipe down surfaces" className="flex-1 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
                  value={item.text} onChange={(e) => updateItem(i, { text: e.target.value })} />
                <input type="time" className="w-32 rounded-lg border px-2 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
                  value={item.start_time} onChange={(e) => updateItem(i, { start_time: e.target.value })} />
                <input type="time" className="w-32 rounded-lg border px-2 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
                  value={item.end_time} onChange={(e) => updateItem(i, { end_time: e.target.value })} />
                <button type="button" onClick={() => removeItem(i)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px]" style={{ color: "var(--status-critical)" }}>×</button>
              </div>
            ))}
          </div>
          <Button type="button" variant="ghost" className="mt-1.5" onClick={addItem}>+ Add checklist item</Button>
        </div>
        {error && (
          <div className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--status-critical-bg)", color: "var(--status-critical)" }}>
            {error}
          </div>
        )}
        <Button type="submit" disabled={save.isPending || !form.title.trim() || !form.category}>
          {save.isPending ? "Saving..." : template ? "Save changes" : "Create Template"}
        </Button>
      </form>
    </Modal>
  );
}

export function NewTaskModal({ initial, onClose }: { initial: NewTaskInitial; onClose: () => void }) {
  const qc = useQueryClient();
  const create = useCreate<TaskItem>("tasks", "/tasks");
  const { data: staff } = useList<StaffMember>("staff", "/people/staff");
  const { data: areas } = useList<Area>("areas", "/areas");
  const { data: taskCategoriesRaw } = useList<TaskCategory>("task-categories", "/task-categories");
  const taskCategories = [...(taskCategoriesRaw ?? [])].sort((a, b) => a.label.localeCompare(b.label));
  const [form, setForm] = useState({
    title: initial.title ?? "", category: initial.category ?? "", description: "", assignee_id: initial.assignee_id ?? "", location_id: "",
    priority: "Medium", due_date: todayIso(),
    recurrence: initial.recurrence ?? "One-time",
    recurrence_interval_days: initial.recurrence_interval_days ?? 7,
    requires_verification: initial.requires_verification ?? true,
  });
  const [checklist, setChecklist] = useState(
    (initial.checklist ?? []).map((c) => ({ text: c.text, start_time: c.start_time ?? "", end_time: c.end_time ?? "" }))
  );
  const [conflictError, setConflictError] = useState<string | null>(null);

  useEffect(() => {
    if (taskCategories.length > 0 && !form.category) {
      setForm((s) => ({ ...s, category: taskCategories[0].label }));
    }
  }, [taskCategories, form.category]);

  function updateChecklistItem(i: number, patch: Partial<{ text: string; start_time: string; end_time: string }>) {
    setChecklist((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function addChecklistItem() {
    setChecklist((cs) => [...cs, { text: "", start_time: "", end_time: "" }]);
  }
  function removeChecklistItem(i: number) {
    setChecklist((cs) => cs.filter((_, idx) => idx !== i));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setConflictError(null);
    for (const item of checklist) {
      if (item.start_time && item.end_time && item.start_time >= item.end_time) {
        setConflictError(`'${item.text || "Untitled item"}': end time must be after start time.`);
        return;
      }
    }
    try {
      await create.mutateAsync({
        ...form,
        description: form.description || null,
        assignee_id: form.assignee_id || null,
        location_id: form.location_id || null,
        recurrence_interval_days: form.recurrence === "Custom" ? form.recurrence_interval_days : null,
        checklist: checklist
          .filter((c) => c.text.trim())
          .map((c) => ({ text: c.text.trim(), done: false, start_time: c.start_time || null, end_time: c.end_time || null })),
      } as never);
      qc.invalidateQueries({ queryKey: ["areas"] });
      qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
      onClose();
    } catch (err) {
      const message = axios.isAxiosError(err) ? (err.response?.data as { detail?: string } | undefined)?.detail : undefined;
      setConflictError(message ?? "Could not create the task — please try again.");
    }
  }

  return (
    <Modal title="New task" onClose={onClose} wide>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-medium">Task title
          <input required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.title} onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-medium">Category
            <select required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.category} onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))}>
              {form.category && !taskCategories.some((c) => c.label === form.category) && (
                <option value={form.category}>{form.category}</option>
              )}
              {taskCategories.map((c) => <option key={c.id} value={c.label}>{c.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Assigned to
            <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.assignee_id} onChange={(e) => setForm((s) => ({ ...s, assignee_id: e.target.value }))}>
              <option value="">Unassigned</option>
              {staff?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
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
          <label className="flex flex-col gap-1 text-[13px] font-medium">Due date
            <input type="date" required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.due_date} onChange={(e) => setForm((s) => ({ ...s, due_date: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Recurrence
            <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.recurrence} onChange={(e) => setForm((s) => ({ ...s, recurrence: e.target.value }))}>
              {["One-time", "Daily", "Weekly", "Monthly", "Custom"].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          {form.recurrence === "Custom" && (
            <label className="flex flex-col gap-1 text-[13px] font-medium">Repeat every (days)
              <input type="number" min={1} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
                value={form.recurrence_interval_days} onChange={(e) => setForm((s) => ({ ...s, recurrence_interval_days: Number(e.target.value) }))} />
            </label>
          )}
        </div>
        <label className="flex items-center gap-2 text-[13px] font-medium">
          <input type="checkbox" checked={form.requires_verification}
            onChange={(e) => setForm((s) => ({ ...s, requires_verification: e.target.checked }))} />
          Requires supervisor verification
        </label>
        {!form.requires_verification && (
          <p className="text-[12px]" style={{ color: "var(--ink-400)" }}>
            Marking this task Completed is final — it skips the Approvals review step.
          </p>
        )}
        {form.recurrence !== "One-time" && (
          <p className="text-[12px]" style={{ color: "var(--ink-400)" }}>
            Once this task is fully verified, the next occurrence is created automatically on its next due date.
          </p>
        )}
        <label className="flex flex-col gap-1 text-[13px] font-medium">Description
          <textarea placeholder="Optional details" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.description} onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))} />
        </label>
        <div>
          <div className="mb-1.5 text-[13px] font-medium">Checklist items</div>
          <p className="mb-1.5 text-[12px]" style={{ color: "var(--ink-400)" }}>
            Start / end time are optional per item — set both to block out a scheduled slot for that activity. The
            assigned staff member can&rsquo;t be double-booked into an overlapping slot on the same day.
          </p>
          <div className="flex flex-col gap-1.5">
            {checklist.map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <input placeholder="e.g. Wipe down surfaces" className="flex-1 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
                  value={item.text} onChange={(e) => updateChecklistItem(i, { text: e.target.value })} />
                <input type="time" className="w-32 rounded-lg border px-2 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
                  value={item.start_time} onChange={(e) => updateChecklistItem(i, { start_time: e.target.value })} />
                <input type="time" className="w-32 rounded-lg border px-2 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
                  value={item.end_time} onChange={(e) => updateChecklistItem(i, { end_time: e.target.value })} />
                <button type="button" onClick={() => removeChecklistItem(i)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px]" style={{ color: "var(--status-critical)" }}>×</button>
              </div>
            ))}
          </div>
          <Button type="button" variant="ghost" className="mt-1.5" onClick={addChecklistItem}>+ Add checklist item</Button>
        </div>
        {conflictError && (
          <div className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--status-critical-bg)", color: "var(--status-critical)" }}>
            {conflictError}
          </div>
        )}
        <Button type="submit" disabled={create.isPending}>{create.isPending ? "Creating..." : "Create Task"}</Button>
      </form>
    </Modal>
  );
}
