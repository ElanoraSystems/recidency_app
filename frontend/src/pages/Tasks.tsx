import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { api } from "../api/client";
import { useCreate, useList } from "../api/hooks";
import { useAuth } from "../auth/AuthContext";
import { AttachmentsPanel } from "../components/AttachmentsPanel";
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Spinner, statusTone, Table, Td, Th } from "../components/ui";
import { daysLabel, daysUntil, todayIso } from "../lib/date";
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
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t === params.get("tab")) ?? "Board";
  // Keep the other URL filters (due, mine) when only the tab changes.
  const setTab = (t: (typeof TABS)[number]) => setParams((p) => { const n = new URLSearchParams(p); n.set("tab", t); return n; }, { replace: true });
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
  const [params] = useSearchParams();
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState("");
  const [due, setDue] = useState(params.get("due") ?? "");
  const [mineOnly, setMineOnly] = useState(params.get("mine") === "1");
  const [view, setView] = useState<"board" | "list">("board");
  const [expanded, setExpanded] = useState<string[]>([]);
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
  const today = todayIso();
  const isDone = (t: TaskItem) => t.status === "Completed" || t.status === "Verified";
  const isLate = (t: TaskItem) => !isDone(t) && t.due_date < today;
  const q = search.trim().toLowerCase();
  const filtered = (tasks ?? []).filter((t) =>
    (category === "all" || t.category === category) && (!assignee || t.assignee_id === assignee) && (!priority || t.priority === priority) &&
    (!mineOnly || (!!myProfile && t.assignee_id === myProfile.id)) &&
    (!q || t.title.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q)) &&
    (due === "" || (due === "today" && t.due_date === today) || (due === "week" && t.due_date >= today && daysUntil(t.due_date) <= 7)
      || (due === "overdue" && isLate(t)) || (due === "review" && t.status === "Completed")));
  const all = tasks ?? [];
  const summary = [
    { id: "", label: "Open", n: all.filter((t) => !isDone(t)).length, tone: "var(--ink-900)" },
    { id: "today", label: "Due today", n: all.filter((t) => t.due_date === today && !isDone(t)).length, tone: "var(--status-warning)" },
    { id: "overdue", label: "Overdue", n: all.filter(isLate).length, tone: "var(--status-critical)" },
    { id: "review", label: "Awaiting review", n: all.filter((t) => t.status === "Completed").length, tone: "var(--status-info)" },
  ];
  const nextStatus = (t: TaskItem) => STATUSES[Math.min(STATUSES.indexOf(t.status === "Overdue" ? "Pending" : t.status) + 1, STATUSES.length - 1)];
  const dueText = (t: TaskItem) => (isDone(t) ? t.due_date : `${daysLabel(daysUntil(t.due_date))} · ${t.due_date}`);
  const checklistDone = (t: TaskItem) => t.checklist.filter((c) => c.done).length;
  const repeats = (t: TaskItem) => !!t.recurrence && !["None", "One-time"].includes(t.recurrence);

  // One tap moves a task along without opening it.
  function quickAction(t: TaskItem) {
    if (t.status === "Completed") {
      return canReview(t) ? <Button size="sm" disabled={reviewTask.isPending} onClick={() => reviewTask.mutate({ id: t.id, approve: true })}>Verify</Button> : null;
    }
    if (t.status === "Verified") return null;
    const startable = t.status === "Pending" || t.status === "Overdue";
    return <Button size="sm" variant={startable ? "secondary" : "primary"} disabled={advance.isPending}
      onClick={() => advance.mutate({ id: t.id, status: startable ? "In Progress" : "Completed" })}>{startable ? "Start" : "Complete"}</Button>;
  }

  if (isLoading) return <Spinner />;

  const field = "rounded-lg border px-2.5 py-1.5 text-sm";
  const border = { borderColor: "var(--border-strong)" };

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {summary.map((x) => (
          <button key={x.label} type="button" onClick={() => setDue(x.id)} className="rounded-xl border px-4 py-3 text-left"
            style={{ borderColor: due === x.id ? "var(--brass-500)" : "var(--border)", background: due === x.id ? "var(--brass-100)" : "var(--surface)" }}>
            <div className="font-display text-2xl font-semibold tabular-nums" style={{ color: x.n > 0 ? x.tone : "var(--ink-400)" }}>{x.n}</div>
            <div className="text-[11.5px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>{x.label}</div>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className={`${field} min-w-[180px] flex-1 sm:max-w-xs`} style={border} placeholder="Search tasks…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className={field} style={border} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">All categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className={field} style={border} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Everyone</option>{staff?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className={field} style={border} value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">Any priority</option><option>High</option><option>Medium</option><option>Low</option>
        </select>
        <select className={field} style={border} value={due} onChange={(e) => setDue(e.target.value)}>
          <option value="">Any due date</option><option value="today">Due today</option><option value="week">Next 7 days</option><option value="overdue">Overdue</option><option value="review">Awaiting review</option>
        </select>
        {myProfile && (
          <label className="flex items-center gap-1.5 text-[13px] font-semibold"><input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />My tasks</label>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[12.5px]" style={{ color: "var(--ink-500)" }}>{filtered.length} of {all.length} tasks</span>
          <div className="flex rounded-lg p-0.5" style={{ background: "var(--surface-sunken)" }}>
            {(["board", "list"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} className="rounded-md px-3 py-1 text-[12.5px] font-bold capitalize"
                style={{ background: view === v ? "var(--surface)" : "transparent", color: view === v ? "var(--ink-900)" : "var(--ink-500)" }}>{v}</button>
            ))}
          </div>
        </div>
      </div>

      {view === "list" ? (
        filtered.length === 0 ? <EmptyState label="No tasks match these filters." /> : (
          <Table>
            <thead><tr><Th>Task</Th><Th>Category</Th><Th>Assigned to</Th><Th>Area</Th><Th>Priority</Th><Th>Due</Th><Th>Checklist</Th><Th>Status</Th><Th>{" "}</Th></tr></thead>
            <tbody>
              {[...filtered].sort((a, b) => Number(isDone(a)) - Number(isDone(b)) || a.due_date.localeCompare(b.due_date)).map((t) => (
                <tr key={t.id} className="cursor-pointer" onClick={() => setDetail(t)}>
                  <Td className="font-medium">{t.title}{repeats(t) && <div className="text-xs font-normal" style={{ color: "var(--ink-400)" }}>↻ {t.recurrence}</div>}</Td>
                  <Td>{t.category}</Td>
                  <Td>{staffName(t.assignee_id)}</Td>
                  <Td>{areaName(t.location_id)}</Td>
                  <Td><Badge tone={t.priority === "High" ? "critical" : t.priority === "Low" ? "good" : "warning"}>{t.priority}</Badge></Td>
                  <Td><span style={{ color: isLate(t) ? "var(--status-critical)" : undefined, fontWeight: isLate(t) ? 700 : 400 }}>{dueText(t)}</span></Td>
                  <Td className="tabular-nums">{t.checklist.length ? `${checklistDone(t)}/${t.checklist.length}` : "—"}</Td>
                  <Td><Badge tone={statusTone(isLate(t) && t.status === "Pending" ? "Overdue" : t.status)}>{isLate(t) && t.status === "Pending" ? "Overdue" : t.status}</Badge></Td>
                  <Td><div onClick={(e) => e.stopPropagation()}>{quickAction(t)}</div></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {STATUSES.map((status) => {
            // Open work by due date; finished work newest first, showing the latest few until asked for more.
            const finished = status === "Completed" || status === "Verified";
            const all = filtered.filter((t) => t.status === status).sort((a, b) => (finished ? b.due_date.localeCompare(a.due_date) : a.due_date.localeCompare(b.due_date)));
            const capped = finished && !expanded.includes(status) && all.length > 8;
            const items = capped ? all.slice(0, 8) : all;
            return (
              <div key={status} className="w-[270px] shrink-0">
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-[12.5px] font-semibold" style={{ color: "var(--ink-700)" }}>{status}</span>
                  <Badge tone={statusTone(status)}>{all.length}</Badge>
                </div>
                <div className="flex flex-col gap-2">
                  {items.map((t) => {
                    const timed = t.checklist.filter((c) => c.start_time && c.end_time);
                    const span = timed.length
                      ? `${timed.reduce((min, c) => (c.start_time! < min ? c.start_time! : min), timed[0].start_time!).slice(0, 5)}–`
                        + `${timed.reduce((max, c) => (c.end_time! > max ? c.end_time! : max), timed[0].end_time!).slice(0, 5)}`
                      : "";
                    const late = isLate(t);
                    const pct = t.checklist.length ? (checklistDone(t) / t.checklist.length) * 100 : 0;
                    return (
                      <Card key={t.id} className="!p-3 cursor-pointer">
                        <div onClick={() => setDetail(t)} className="flex flex-col gap-1.5" style={{ borderLeft: late ? "3px solid var(--status-critical)" : "3px solid transparent", paddingLeft: 8, marginLeft: -8 }}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="text-[13px] font-semibold leading-snug">{t.title}</div>
                            <span className="mt-1 h-2 w-2 shrink-0 rounded-full" title={`${t.priority} priority`}
                              style={{ background: t.priority === "High" ? "var(--status-critical)" : t.priority === "Low" ? "var(--status-good)" : "var(--status-warning)" }} />
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
                            <span className="rounded px-1.5 py-0.5 font-semibold" style={{ background: "var(--surface-sunken)", color: "var(--ink-700)" }}>{t.category}</span>
                            <span style={{ color: late ? "var(--status-critical)" : "var(--ink-500)", fontWeight: late || t.due_date === today ? 700 : 400 }}>{dueText(t)}{span && ` · ${span}`}</span>
                          </div>
                          {t.checklist.length > 0 && (
                            <div className="flex items-center gap-2 text-[11.5px]" style={{ color: "var(--ink-500)" }}>
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: "var(--surface-sunken)" }}>
                                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct === 100 ? "var(--status-good)" : "var(--brass-500)" }} />
                              </div>
                              <span className="tabular-nums">{checklistDone(t)}/{t.checklist.length}</span>
                            </div>
                          )}
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]" style={{ color: "var(--ink-500)" }}>
                            <span className="flex items-center gap-1"><span className="grid h-4 w-4 place-items-center rounded-full text-[9px] font-extrabold" style={{ background: "var(--brass-200)", color: "var(--brass-700)" }}>{staffName(t.assignee_id).charAt(0)}</span>{staffName(t.assignee_id).split(" ")[0]}</span>
                            {t.location_id && <span>{areaName(t.location_id)}</span>}
                            {repeats(t) && <span>↻ {t.recurrence}</span>}
                            {t.comments.length > 0 && <span>{t.comments.length} comment{t.comments.length === 1 ? "" : "s"}</span>}
                            {t.photos > 0 && <span>{t.photos} photo{t.photos === 1 ? "" : "s"}</span>}
                          </div>
                        </div>
                        {quickAction(t) && <div className="mt-2">{quickAction(t)}</div>}
                      </Card>
                    );
                  })}
                  {capped && (
                    <button type="button" className="px-1 text-left text-[12px] font-semibold" style={{ color: "var(--brass-600)" }} onClick={() => setExpanded((e) => [...e, status])}>
                      Show {all.length - items.length} older
                    </button>
                  )}
                  {items.length === 0 && <div className="px-1 text-[11.5px]" style={{ color: "var(--ink-300)" }}>None</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

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
              <Button onClick={() => advance.mutate({ id: detail.id, status: nextStatus(detail) })} disabled={advance.isPending}>
                Mark as {nextStatus(detail)}
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
