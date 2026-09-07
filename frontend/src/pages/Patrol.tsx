import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Html5QrcodeScanner } from "html5-qrcode";
import { api } from "../api/client";
import { useList } from "../api/hooks";
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, Table, Td, Th } from "../components/ui";
import type { Area, PatrolLogEntry } from "../types";

const TABS = ["Scan", "Patrol Log"] as const;

export function Patrol() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Scan");

  return (
    <div>
      <PageHeader
        title="Security Patrol"
        subtitle="Scan the QR code posted at each location during rounds — every check-in is timestamped automatically."
      />

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

      {tab === "Scan" ? <ScanTab /> : <PatrolLogTab />}
    </div>
  );
}

function QrScanner({ onDecoded }: { onDecoded: (text: string) => void }) {
  const elementId = "patrol-qr-reader";

  useEffect(() => {
    const scanner = new Html5QrcodeScanner(elementId, { fps: 10, qrbox: 250 }, false);
    let handled = false;
    scanner.render(
      (decodedText) => {
        if (handled) return;
        handled = true;
        scanner.clear().catch(() => {});
        onDecoded(decodedText);
      },
      () => { /* ignore per-frame decode misses — expected while aiming the camera */ },
    );
    return () => {
      handled = true;
      scanner.clear().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div id={elementId} />;
}

function ScanTab() {
  const [searchParams] = useSearchParams();
  const { data: areas } = useList<Area>("areas", "/areas");
  const qc = useQueryClient();
  const [pendingAreaId, setPendingAreaId] = useState<string | null>(searchParams.get("area"));
  const [confirmed, setConfirmed] = useState<{ areaName: string; at: string } | null>(null);
  const [scanKey, setScanKey] = useState(0);

  const scan = useMutation({
    mutationFn: async (areaId: string) => (await api.post("/patrol/scan", { area_id: areaId })).data,
    onSuccess: (data: { area_name: string | null; scanned_at: string }) => {
      setConfirmed({ areaName: data.area_name ?? "this location", at: new Date(data.scanned_at).toLocaleTimeString() });
      qc.invalidateQueries({ queryKey: ["patrol-log"] });
      setPendingAreaId(null);
    },
  });

  function handleDecoded(text: string) {
    let areaId: string | null = null;
    try {
      areaId = new URL(text).searchParams.get("area");
    } catch {
      areaId = text.trim() || null; // fall back for a raw id, in case a code isn't a full URL
    }
    if (areaId) setPendingAreaId(areaId);
  }

  const pendingArea = areas?.find((a) => a.id === pendingAreaId);

  if (confirmed) {
    return (
      <Card className="max-w-md">
        <div className="mb-2 text-[15px] font-semibold" style={{ color: "var(--status-good)" }}>✓ Checked in</div>
        <p className="mb-4 text-[13px]" style={{ color: "var(--ink-700)" }}>{confirmed.areaName} — {confirmed.at}</p>
        <Button onClick={() => { setConfirmed(null); setScanKey((k) => k + 1); }}>Scan Next Area</Button>
      </Card>
    );
  }

  if (pendingAreaId) {
    return (
      <Card className="max-w-md">
        <div className="mb-1.5 text-[13px]" style={{ color: "var(--ink-500)" }}>Confirm patrol check-in for</div>
        <div className="mb-4 text-[17px] font-semibold">{pendingArea?.name ?? "this location"}</div>
        {scan.isError && (
          <p className="mb-3 text-[12.5px]" style={{ color: "var(--status-critical)" }}>Could not check in — please try again.</p>
        )}
        <div className="flex gap-2">
          <Button onClick={() => scan.mutate(pendingAreaId)} disabled={scan.isPending}>
            {scan.isPending ? "Checking in..." : "Confirm Check-in"}
          </Button>
          <Button variant="ghost" onClick={() => { setPendingAreaId(null); setScanKey((k) => k + 1); }}>Cancel</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="max-w-md">
      <p className="mb-3 text-[13px]" style={{ color: "var(--ink-500)" }}>
        Point your camera at the QR code posted at this location.
      </p>
      <QrScanner key={scanKey} onDecoded={handleDecoded} />
    </Card>
  );
}

function PatrolLogTab() {
  const { data, isLoading } = useList<PatrolLogEntry>("patrol-log", "/patrol");

  if (isLoading) return <Spinner />;
  if (!data || data.length === 0) return <EmptyState label="No patrol scans logged yet." />;

  const today = new Date().toISOString().slice(0, 10);
  const todayCount = data.filter((p) => p.scanned_at.slice(0, 10) === today).length;

  return (
    <div>
      <div className="mb-4">
        <Badge tone="good">{todayCount} scan(s) today</Badge>
      </div>
      <Table>
        <thead><tr><Th>When</Th><Th>Area</Th><Th>Guard</Th><Th>Notes</Th></tr></thead>
        <tbody>
          {data.map((p) => (
            <tr key={p.id}>
              <Td className="whitespace-nowrap">{new Date(p.scanned_at).toLocaleString()}</Td>
              <Td className="font-medium">{p.area_name ?? "Unknown area"}</Td>
              <Td>{p.staff_name ?? "—"}</Td>
              <Td>{p.notes ?? "—"}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
