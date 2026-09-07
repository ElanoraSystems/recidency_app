import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useList } from "../api/hooks";
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Spinner, StatTile, Table, Td, Th, statusTone } from "../components/ui";
import { todayIso } from "../lib/date";
import { routeForApproval } from "../lib/notifications";
import type { ActivityEntry, Area, Asset, ApprovalItem, PurchaseOrder, Recipe, ProposedMenu, Supplier } from "../types";

const TYPE_LABELS: Record<ApprovalItem["type"], string> = {
  purchase_request: "Purchase Request",
  purchase_order: "Purchase Order",
  proposed_menu: "Menu Proposal",
  asset: "New Asset",
  leave_request: "Leave Request",
  task_review: "Task Review",
  maintenance_confirmation: "Maintenance Confirmation",
  weekly_meal_plan: "Weekly Meal Plan",
  waste_log: "Kitchen Waste Log",
};

const REVIEW_LABELS: Record<ApprovalItem["type"], string> = {
  purchase_request: "View",
  purchase_order: "View",
  proposed_menu: "Review & Select",
  asset: "View",
  leave_request: "View",
  task_review: "View",
  maintenance_confirmation: "View",
  weekly_meal_plan: "View",
  waste_log: "View",
};

const TABS = ["Approval Inbox", "Activity Log"] as const;

export function Approvals() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Approval Inbox");
  const { data: pending } = useList<ApprovalItem>("approvals", "/approvals");
  const { data: activity } = useList<ActivityEntry>("activity-log", "/activity-log");

  const today = todayIso();
  const loggedToday = activity?.filter((a) => a.at.slice(0, 10) === today && /^Approved|^Received|^Logged/.test(a.action)).length ?? 0;

  return (
    <div>
      <PageHeader title="Approvals & Activity" subtitle="Everything awaiting your sign-off, and a complete audit trail of what happened across the residence." />

      <div className="mb-5 grid grid-cols-3 gap-4">
        <StatTile label="Pending Approvals" icon="inbox" value={pending?.length ?? 0} progressColor={pending?.length ? "var(--status-warning)" : undefined} />
        <StatTile label="Approved / Logged Today" icon="reports" value={loggedToday} />
        <StatTile label="Total Activity Entries" icon="reports" value={activity?.length ?? 0} />
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

      {tab === "Approval Inbox" ? <InboxView pending={pending} /> : <ActivityLogView activity={activity} />}
    </div>
  );
}

function InboxView({ pending }: { pending?: ApprovalItem[] }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ApprovalItem | null>(null);
  const decide = useMutation({
    mutationFn: async ({ type, id, approve }: { type: string; id: string; approve: boolean }) =>
      api.post(`/approvals/${type}/${id}/decision?approve=${approve}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: ["activity-log"] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["assets"] });
      qc.invalidateQueries({ queryKey: ["proposed-menus"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["maintenance-requests"] });
      qc.invalidateQueries({ queryKey: ["weekly-meal-plans"] });
      qc.invalidateQueries({ queryKey: ["waste-log"] });
      setDetail(null);
    },
  });

  function onReview(item: ApprovalItem) {
    if (item.type === "purchase_order" || item.type === "asset" || item.type === "proposed_menu") {
      setDetail(item);
    } else {
      navigate(routeForApproval(item.type));
    }
  }

  if (!pending) return <Spinner />;
  if (pending.length === 0) return <EmptyState label="Nothing awaiting approval — all purchase requests, orders, menu proposals, assets and leave requests are up to date." />;

  return (
    <div className="flex flex-col gap-3">
      {pending.map((item) => (
        <Card key={`${item.type}-${item.id}`} className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="mb-0.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--brass-600)" }}>
              {TYPE_LABELS[item.type]}
            </div>
            <div className="font-medium">{item.title}</div>
            <div className="text-xs" style={{ color: "var(--ink-500)" }}>{item.sub}</div>
            {item.date && <div className="mt-0.5 text-[11px]" style={{ color: "var(--ink-400)" }}>{item.date}</div>}
          </div>
          <div className="flex gap-2">
            <button
              className="rounded-lg px-3 py-1.5 text-xs font-semibold"
              style={{ background: "var(--surface-sunken)", color: "var(--ink-700)" }}
              onClick={() => onReview(item)}
            >
              {REVIEW_LABELS[item.type]}
            </button>
            <button
              className="rounded-lg px-3 py-1.5 text-xs font-semibold"
              style={{ background: "var(--status-good-bg)", color: "var(--status-good)" }}
              onClick={() => decide.mutate({ type: item.type, id: item.id, approve: true })}
            >
              Approve
            </button>
            <button
              className="rounded-lg px-3 py-1.5 text-xs font-semibold"
              style={{ background: "var(--status-critical-bg)", color: "var(--status-critical)" }}
              onClick={() => decide.mutate({ type: item.type, id: item.id, approve: false })}
            >
              Reject
            </button>
          </div>
        </Card>
      ))}

      {detail?.type === "purchase_order" && (
        <PoDetailModal item={detail} decide={decide} onClose={() => setDetail(null)} />
      )}
      {detail?.type === "asset" && (
        <AssetDetailModal item={detail} decide={decide} onClose={() => setDetail(null)} />
      )}
      {detail?.type === "proposed_menu" && (
        <ProposalDetailModal item={detail} decide={decide} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}

type DecideMutation = ReturnType<typeof useMutation<unknown, Error, { type: string; id: string; approve: boolean }>>;

function PoDetailModal({ item, decide, onClose }: { item: ApprovalItem; decide: DecideMutation; onClose: () => void }) {
  const { data: orders } = useList<PurchaseOrder>("purchase-orders", "/purchasing/purchase-orders");
  const { data: suppliers } = useList<Supplier>("suppliers", "/suppliers");
  const order = orders?.find((o) => o.id === item.id);

  if (!order) return <Modal title={item.title} onClose={onClose} wide><Spinner /></Modal>;
  const supplierName = suppliers?.find((s) => s.id === order.supplier_id)?.name ?? "—";

  return (
    <Modal title={order.code} onClose={onClose} wide>
      <div className="flex flex-col gap-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{supplierName}</Badge>
          <Badge tone={statusTone(order.status)}>{order.status}</Badge>
          <Badge tone={statusTone(order.payment_status)}>{order.payment_status}</Badge>
        </div>
        <Table>
          <thead><tr><Th>Item</Th><Th>Ordered</Th><Th>Received</Th><Th>Pending</Th><Th>Price</Th></tr></thead>
          <tbody>
            {order.lines.map((l) => (
              <tr key={l.id}>
                <Td className="font-medium">{l.name}</Td>
                <Td>{l.qty} {l.unit}</Td>
                <Td>{l.received_qty} {l.unit}</Td>
                <Td>{l.qty - l.received_qty} {l.unit}</Td>
                <Td>KWD {l.price.toFixed(3)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="grid grid-cols-2 gap-2">
          <InfoRow label="Order date" value={order.order_date} />
          <InfoRow label="Expected" value={order.expected_date ?? "—"} />
          <InfoRow label="Total" value={`KWD ${order.total.toFixed(2)}`} />
        </div>
        <div>
          <Button
            variant="secondary"
            onClick={async () => {
              const res = await api.get(`/purchasing/purchase-orders/${order.id}/pdf`, { responseType: "blob" });
              const blobUrl = URL.createObjectURL(res.data as Blob);
              window.open(blobUrl, "_blank");
              setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
            }}
          >
            Download PDF
          </Button>
        </div>
        {order.status === "Pending Approval" && (
          <div className="flex gap-2">
            <Button onClick={() => decide.mutate({ type: "purchase_order", id: order.id, approve: true })} disabled={decide.isPending}>
              Approve Order
            </Button>
            <Button variant="ghost" onClick={() => decide.mutate({ type: "purchase_order", id: order.id, approve: false })} disabled={decide.isPending}>
              Reject
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function AssetDetailModal({ item, decide, onClose }: { item: ApprovalItem; decide: DecideMutation; onClose: () => void }) {
  const { data: assets } = useList<Asset>("assets", "/assets");
  const { data: areas } = useList<Area>("areas", "/areas");
  const asset = assets?.find((a) => a.id === item.id);

  if (!asset) return <Modal title={item.title} onClose={onClose} wide><Spinner /></Modal>;
  const areaName = areas?.find((a) => a.id === asset.location_id)?.name ?? "—";

  return (
    <Modal title={asset.name} onClose={onClose} wide>
      <div className="flex flex-col gap-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{asset.category}</Badge>
          <Badge tone={statusTone(asset.approval_status)}>{asset.approval_status}</Badge>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <InfoRow label="Location" value={areaName} />
          <InfoRow label="Brand / model" value={[asset.brand, asset.model].filter(Boolean).join(" / ") || "—"} />
          <InfoRow label="Serial number" value={asset.serial ?? "—"} />
          <InfoRow label="Purchase cost" value={asset.purchase_cost != null ? `KWD ${asset.purchase_cost.toFixed(2)}` : "—"} />
          <InfoRow label="Supplier" value={asset.provider ?? "—"} />
          <InfoRow label="Warranty end" value={asset.warranty_end ?? "—"} />
        </div>
        {asset.approval_status === "Pending" && (
          <div className="flex gap-2">
            <Button onClick={() => decide.mutate({ type: "asset", id: asset.id, approve: true })} disabled={decide.isPending}>
              Approve Asset
            </Button>
            <Button variant="ghost" onClick={() => decide.mutate({ type: "asset", id: asset.id, approve: false })} disabled={decide.isPending}>
              Reject
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ProposalDetailModal({ item, decide, onClose }: { item: ApprovalItem; decide: DecideMutation; onClose: () => void }) {
  const { data: menus } = useList<ProposedMenu>("proposed-menus", "/kitchen/proposed-menus");
  const { data: recipes } = useList<Recipe>("recipes", "/kitchen/recipes");
  const menu = menus?.find((m) => m.id === item.id);

  if (!menu) return <Modal title={item.title} onClose={onClose} wide><Spinner /></Modal>;
  const recipeName = (id: string) => recipes?.find((r) => r.id === id)?.name ?? "Recipe not on file";

  return (
    <Modal title={menu.occasion} onClose={onClose} wide>
      <div className="flex flex-col gap-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{menu.occasion_type}</Badge>
          <Badge>{menu.category}</Badge>
          <Badge tone={statusTone(menu.status)}>{menu.status}</Badge>
        </div>
        <div style={{ color: "var(--ink-500)" }}>For {menu.for_date}</div>
        {menu.notes && <p style={{ color: "var(--ink-700)" }}>{menu.notes}</p>}
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>Dish options</div>
          <div className="flex flex-col gap-1.5">
            {menu.options.map((o, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--surface-sunken)" }}>
                <div>
                  <span className="font-medium">{recipeName(o.recipe_id)}</span>
                  {o.note && <span className="ml-1" style={{ color: "var(--ink-400)" }}>— {o.note}</span>}
                </div>
                {o.selected && <Badge tone="good">Selected</Badge>}
              </div>
            ))}
          </div>
        </div>
        {menu.status === "Proposed" && (
          <div className="flex gap-2">
            <Button onClick={() => decide.mutate({ type: "proposed_menu", id: menu.id, approve: true })} disabled={decide.isPending}>
              Approve Selected
            </Button>
            <Button variant="ghost" onClick={() => decide.mutate({ type: "proposed_menu", id: menu.id, approve: false })} disabled={decide.isPending}>
              Reject
            </Button>
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

function ActivityLogView({ activity }: { activity?: ActivityEntry[] }) {
  if (!activity) return <Spinner />;
  if (activity.length === 0) return <EmptyState label="No activity recorded yet." />;
  return (
    <div>
      <Table>
        <thead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Detail</Th></tr></thead>
        <tbody>
          {activity.slice(0, 150).map((a) => (
            <tr key={a.id}>
              <Td className="whitespace-nowrap">{new Date(a.at).toLocaleString()}</Td>
              <Td className="font-medium">{a.actor}<div className="text-xs" style={{ color: "var(--ink-400)" }}>{a.role}</div></Td>
              <Td className="font-semibold">{a.action}</Td>
              <Td>{a.detail}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="mt-2 text-[12px]" style={{ color: "var(--ink-400)" }}>
        Showing the {Math.min(activity.length, 150)} most recent of {activity.length} logged actions — a permanent, chronological audit trail for the residence.
      </div>
    </div>
  );
}
