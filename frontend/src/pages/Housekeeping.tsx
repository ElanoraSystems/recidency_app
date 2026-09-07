import { useState } from "react";
import { useList } from "../api/hooks";
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Spinner, StatTile } from "../components/ui";
import { NewTaskModal } from "./Tasks";
import type { Area, StaffMember } from "../types";

interface Inspection { id: string; area_id: string; score: number; inspector: string; date: string; notes: string | null }

export function Housekeeping() {
  const { data: areas, isLoading } = useList<Area>("areas", "/areas");
  const { data: inspections } = useList<Inspection>("inspections", "/inspections");
  const { data: staff } = useList<StaffMember>("staff", "/people/staff");
  const [detail, setDetail] = useState<Area | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);

  const avgCompletion = areas?.length ? Math.round(areas.reduce((s, a) => s + a.completion, 0) / areas.length) : 0;
  const scoredAreas = areas?.filter((a) => a.last_score != null) ?? [];
  const avgScore = scoredAreas.length ? Math.round(scoredAreas.reduce((s, a) => s + (a.last_score ?? 0), 0) / scoredAreas.length) : 0;
  const staffName = (id: string | null) => staff?.find((s) => s.id === id)?.name ?? "Unassigned";

  return (
    <div>
      <PageHeader
        title="Housekeeping"
        subtitle="Area checklists, cleaning status and inspection scores."
        action={<Button onClick={() => setAssignOpen(true)}>+ Assign Cleaning Task</Button>}
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Overall Completion" icon="housekeeping" value={`${avgCompletion}%`} progress={avgCompletion} progressColor="var(--status-good)" />
        <StatTile label="Avg Inspection Score" icon="checkCircle" value={`${avgScore}%`} progress={avgScore} progressColor="var(--brass-500)" />
        <StatTile label="Areas Tracked" icon="grid" value={areas?.length ?? 0} sub="Across the residence" />
      </div>

      {isLoading ? <Spinner /> : !areas || areas.length === 0 ? <EmptyState label="No areas set up yet." /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {areas.map((a) => {
            return (
              <Card key={a.id} className="cursor-pointer" >
                <div onClick={() => setDetail(a)}>
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[14.5px] font-semibold">{a.name}</div>
                      <div className="text-xs" style={{ color: "var(--ink-500)" }}>{a.category}</div>
                    </div>
                    {a.last_score != null && (
                      <Badge tone={a.last_score >= 95 ? "good" : a.last_score >= 85 ? "warning" : "critical"}>{a.last_score}%</Badge>
                    )}
                  </div>
                  <div className="mb-1.5 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--surface-sunken)" }}>
                    <div className="h-full rounded-full" style={{ width: `${a.completion}%`, background: a.completion === 100 ? "var(--status-good)" : "var(--brass-500)" }} />
                  </div>
                  <div className="flex justify-between text-xs" style={{ color: "var(--ink-500)" }}>
                    <span>
                      {a.completion_tasks_total > 0
                        ? `${a.completion_tasks_done}/${a.completion_tasks_total} tasks done`
                        : "No housekeeping tasks this week"}
                    </span>
                    <span>{staffName(a.assignee_id).split(" ")[0]}</span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {detail && (
        <Modal title={detail.name} onClose={() => setDetail(null)}>
          <div className="flex flex-col gap-3 text-[13px]">
            <div className="flex items-center gap-2">
              <Badge>{detail.category}</Badge>
              {detail.last_score != null && (
                <Badge tone={detail.last_score >= 95 ? "good" : detail.last_score >= 85 ? "warning" : "critical"}>
                  Last score {detail.last_score}%
                </Badge>
              )}
            </div>
            {detail.checklist.length > 0 && (
              <div>
                <div className="mb-1.5 text-[11px] font-bold uppercase" style={{ color: "var(--ink-400)" }}>Cleaning checklist</div>
                <div className="flex flex-col gap-1.5">
                  {detail.checklist.map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--status-good)" }} />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="mb-1.5 text-[11px] font-bold uppercase" style={{ color: "var(--ink-400)" }}>Recent inspections</div>
              {inspections?.filter((i) => i.area_id === detail.id).length ? (
                <div className="flex flex-col gap-2">
                  {inspections.filter((i) => i.area_id === detail.id).map((i) => (
                    <div key={i.id} className="rounded-lg p-2" style={{ background: "var(--surface-sunken)" }}>
                      <div className="flex justify-between text-[12px] font-semibold">
                        <span>{i.inspector}</span><span>{i.score}%</span>
                      </div>
                      <div className="text-[12px]" style={{ color: "var(--ink-500)" }}>{i.date}{i.notes ? ` · ${i.notes}` : ""}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: "var(--ink-400)" }}>No inspections logged for this area yet.</div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {assignOpen && <NewTaskModal initial={{ category: "Housekeeping" }} onClose={() => setAssignOpen(false)} />}
    </div>
  );
}
