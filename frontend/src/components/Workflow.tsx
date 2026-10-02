import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { fmtDateTime } from "../lib/date";
import type { AuditEntry, TxnStatus } from "../types";
import { Badge, Button, Modal, Spinner, statusTone } from "./ui";

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}>{status}</Badge>;
}

export function errorText(err: unknown): string {
  if (axios.isAxiosError(err)) {
    if (!err.response) return "Can't reach the server - check your connection and try again.";
    const detail = (err.response.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === "string") return detail;
  }
  return "Something went wrong - please try again.";
}

type Action = "submit" | "approve" | "reject" | "close" | "reopen";

// Query keys that depend on a transaction's posting or status.
const REFRESH_KEYS = ["approvals", "stock-balances", "stock-movements", "food-inventory", "inventory", "purchase-orders"];

// closeFrom / shortCloseFrom / canReopen let documents without stock effect
// (a PO closes once Fully Received, and is never reopened) share this bar.
export function WorkflowBar({
  entityType, id, status, queryKeys, onChanged, closeFrom = "Approved", shortCloseFrom = [], canReopen = true,
}: {
  entityType: string;
  id: string;
  status: TxnStatus | string;
  queryKeys: string[];
  onChanged?: (status: string) => void;
  closeFrom?: string;
  shortCloseFrom?: string[];
  canReopen?: boolean;
}) {
  const { user } = useAuth();
  const isSuperUser = user?.user_type === "owner";
  const qc = useQueryClient();
  const [ask, setAsk] = useState<{ action: Action; title: string; required: boolean } | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: async ({ action, why }: { action: Action; why?: string }) =>
      (await api.post<{ status: string }>(`/transactions/${entityType}/${id}/${action}`, { reason: why || null })).data,
    onSuccess: (data) => {
      for (const key of [...queryKeys, ...REFRESH_KEYS]) qc.invalidateQueries({ queryKey: [key] });
      qc.invalidateQueries({ queryKey: ["transaction", entityType, id] });
      qc.invalidateQueries({ queryKey: ["transaction-history", entityType, id] });
      setAsk(null);
      setReason("");
      setError(null);
      onChanged?.(data.status);
    },
    onError: (err) => setError(errorText(err)),
  });

  function go(action: Action, title?: string, required = false) {
    setError(null);
    if (title) {
      setAsk({ action, title, required });
      return;
    }
    run.mutate({ action });
  }

  const busy = run.isPending;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {status === "Draft" && <Button type="button" onClick={() => go("submit")} disabled={busy}>Submit</Button>}
        {status === "Submitted" && (
          <>
            <Button type="button" onClick={() => go("approve")} disabled={busy}>Approve</Button>
            <Button type="button" variant="danger" onClick={() => go("reject", "Reject and return to Draft", true)} disabled={busy}>Reject</Button>
            {canReopen && <Button type="button" variant="secondary" onClick={() => go("reopen", "Reopen to edit", false)} disabled={busy}>Reopen</Button>}
          </>
        )}
        {status === closeFrom && (
          <>
            <Button type="button" onClick={() => go("close")} disabled={busy}>Close</Button>
            {isSuperUser && canReopen && (
              <Button type="button" variant="secondary" onClick={() => go("reopen", "Reopen to edit", true)} disabled={busy}>Reopen</Button>
            )}
          </>
        )}
        {isSuperUser && shortCloseFrom.includes(status) && (
          <Button type="button" variant="secondary" onClick={() => go("close", "Close before fully received", true)} disabled={busy}>Close early</Button>
        )}
        {status === "Closed" && canReopen && (
          isSuperUser ? (
            <Button type="button" variant="secondary" onClick={() => go("reopen", "Reopen a Closed transaction", true)} disabled={busy}>Reopen</Button>
          ) : (
            <span className="text-[12.5px]" style={{ color: "var(--ink-500)" }}>
              Closed - read-only. Only a Super User can reopen it.
            </span>
          )
        )}
        {status === "Closed" && !canReopen && (
          <span className="text-[12.5px]" style={{ color: "var(--ink-500)" }}>Closed - read-only.</span>
        )}
      </div>
      {error && !ask && <p className="mt-2 text-[13px]" style={{ color: "var(--status-critical)" }}>{error}</p>}

      {ask && (
        <Modal title={ask.title} onClose={() => { setAsk(null); setReason(""); setError(null); }}>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              // The bar can sit inside a page form; React bubbles submit through the modal portal.
              e.stopPropagation();
              run.mutate({ action: ask.action, why: reason });
            }}
          >
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              Reason{ask.required ? "" : " (optional)"}
              <textarea
                required={ask.required}
                rows={3}
                className="rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border-strong)" }}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {error && <p className="text-[13px]" style={{ color: "var(--status-critical)" }}>{error}</p>}
            <Button type="submit" disabled={busy}>{busy ? "Working..." : "Confirm"}</Button>
          </form>
        </Modal>
      )}
    </div>
  );
}

export function HistoryPanel({ entityType, id }: { entityType: string; id: string }) {
  const { data, isLoading } = useQuery<AuditEntry[]>({
    queryKey: ["transaction-history", entityType, id],
    queryFn: async () => (await api.get(`/transactions/${entityType}/${id}/history`)).data,
  });
  if (isLoading) return <Spinner />;
  if (!data || data.length === 0) return <p className="text-[12.5px]" style={{ color: "var(--ink-400)" }}>No history yet.</p>;
  return (
    <ol className="flex flex-col gap-2">
      {data.map((h) => (
        <li key={h.id} className="rounded-lg border px-3 py-2 text-[12.5px]" style={{ borderColor: "var(--border)" }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold capitalize">{h.action}</span>
            {h.from_status && h.to_status && h.from_status !== h.to_status && (
              <span style={{ color: "var(--ink-500)" }}>{h.from_status} to {h.to_status}</span>
            )}
            <span className="ml-auto" style={{ color: "var(--ink-400)" }}>
              {h.user_name ?? "System"} - {fmtDateTime(h.created_at)}
            </span>
          </div>
          {h.reason && <div className="mt-1" style={{ color: "var(--ink-600)" }}>Reason: {h.reason}</div>}
        </li>
      ))}
    </ol>
  );
}
