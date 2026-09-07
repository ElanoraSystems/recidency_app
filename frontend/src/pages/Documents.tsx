import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useCreate, useList } from "../api/hooks";
import { Icon } from "../components/icons";
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Spinner, StatTile, Table, Td, Th, statusTone } from "../components/ui";
import { daysUntil, todayIso } from "../lib/date";
import type { DocumentItem } from "../types";

interface DocFile { id: string; filename: string; size_bytes: number; uploaded_at: string }

export const CATEGORIES = [
  "Staff Contracts", "IDs", "Vehicle Documents", "Property Documents",
  "Equipment Warranties", "Supplier Contracts", "Invoices", "Certificates", "Other",
];

export function DocumentsPage() {
  const { data, isLoading } = useList<DocumentItem>("documents", "/documents");
  const [addOpen, setAddOpen] = useState(false);
  const [active, setActive] = useState<DocumentItem | null>(null);
  const [category, setCategory] = useState("all");

  const categories = Array.from(new Set((data ?? []).map((d) => d.category)));
  const expiring = (data ?? []).filter((d) => d.expiry && daysUntil(d.expiry) <= 30).length;
  const filtered = (data ?? []).filter((d) => category === "all" || d.category === category);

  return (
    <div>
      <PageHeader
        title="Documents"
        subtitle="Centralized repository for contracts, IDs, warranties and more — with real file attachments."
        action={<Button onClick={() => setAddOpen(true)}>+ Upload Document</Button>}
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Total Documents" icon="documents" value={data?.length ?? 0} />
        <StatTile label="Expiring (30d)" icon="alertTriangle" value={expiring} progressColor="var(--status-warning)" />
        <StatTile label="Categories" icon="grid" value={categories.length} />
      </div>

      <div className="mb-4 flex items-center gap-3">
        <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
          value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="ml-auto text-[12.5px]" style={{ color: "var(--ink-500)" }}>{filtered.length} documents</span>
      </div>

      {isLoading ? <Spinner /> : filtered.length === 0 ? <EmptyState label="No documents yet." /> : (
        <Table>
          <thead><tr><Th>Document</Th><Th>Category</Th><Th>Linked To</Th><Th>Expiry</Th><Th>Files</Th></tr></thead>
          <tbody>
            {filtered.map((d) => {
              const expiringSoon = d.expiry ? daysUntil(d.expiry) <= 30 : false;
              return (
                <tr key={d.id} className="cursor-pointer" onClick={() => setActive(d)}>
                  <Td className="font-medium">{d.name}</Td>
                  <Td><Badge>{d.category}</Badge></Td>
                  <Td>{d.linked_to ?? "—"}</Td>
                  <Td>{d.expiry ? <Badge tone={expiringSoon ? (daysUntil(d.expiry) < 0 ? "critical" : "warning") : "good"}>{d.expiry}</Badge> : <Badge>No expiry</Badge>}</Td>
                  <Td>
                    <span className="flex items-center gap-1 text-xs" style={{ color: "var(--brass-600)" }}>
                      <Icon name="documents" className="h-3.5 w-3.5" />Manage
                    </span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {addOpen && <NewDocumentModal onClose={() => setAddOpen(false)} />}
      {active && <DocumentFilesModal doc={active} onClose={() => setActive(null)} />}
    </div>
  );
}

export function NewDocumentModal({ onClose, initial }: { onClose: () => void; initial?: Partial<{ category: string; linked_to: string }> }) {
  const create = useCreate<DocumentItem>("documents", "/documents");
  const [form, setForm] = useState({
    name: "", category: initial?.category ?? CATEGORIES[0], linked_to: initial?.linked_to ?? "", upload_date: todayIso(), expiry: "",
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await create.mutateAsync({ ...form, expiry: form.expiry || null } as never);
    onClose();
  }

  return (
    <Modal title="Add document" onClose={onClose}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-medium">Document name
          <input required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
            value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-medium">Category
            <select className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.category} onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Linked to
            <input className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.linked_to} onChange={(e) => setForm((s) => ({ ...s, linked_to: e.target.value }))} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-medium">Upload date
            <input type="date" required className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.upload_date} onChange={(e) => setForm((s) => ({ ...s, upload_date: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Expiry date (optional)
            <input type="date" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-strong)" }}
              value={form.expiry} onChange={(e) => setForm((s) => ({ ...s, expiry: e.target.value }))} />
          </label>
        </div>
        <Button type="submit" disabled={create.isPending}>{create.isPending ? "Saving..." : "Add document"}</Button>
      </form>
    </Modal>
  );
}

export function DocumentFilesModal({ doc, onClose }: { doc: DocumentItem; onClose: () => void }) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const { data: files, isLoading } = useQuery<DocFile[]>({
    queryKey: ["document-files", doc.id],
    queryFn: async () => (await api.get(`/documents/${doc.id}/files`)).data,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return api.post(`/documents/${doc.id}/files`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["document-files", doc.id] }),
  });

  function handleFiles(fileList: FileList | null) {
    const file = fileList?.[0];
    if (file) upload.mutate(file);
  }

  const [opening, setOpening] = useState<string | null>(null);
  async function openFile(file: DocFile, mode: "view" | "download") {
    // Plain <a href> navigation never carries the app's Bearer token (auth
    // lives only in localStorage, not a cookie), so the endpoint 401'd for
    // every click. Fetch it as an authenticated blob instead.
    setOpening(file.id);
    try {
      const res = await api.get(`/documents/files/${file.id}/download`, { responseType: "blob" });
      const blobUrl = URL.createObjectURL(res.data as Blob);
      if (mode === "view") {
        window.open(blobUrl, "_blank");
      } else {
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = file.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } finally {
      setOpening(null);
    }
  }

  return (
    <Modal title={doc.name} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{doc.category}</Badge>
          {doc.linked_to && <Badge tone="info">{doc.linked_to}</Badge>}
          {doc.expiry && <Badge tone={statusTone(daysUntil(doc.expiry) < 0 ? "overdue" : "good")}>Expires {doc.expiry}</Badge>}
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
          onClick={() => fileInputRef.current?.click()}
          className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors"
          style={{ borderColor: dragOver ? "var(--brass-500)" : "var(--border-strong)", background: dragOver ? "var(--brass-100)" : "var(--surface-sunken)" }}
        >
          <Icon name="upload" className="h-6 w-6" style={{ color: "var(--brass-600)" }} />
          <div className="text-[13px] font-semibold" style={{ color: "var(--ink-700)" }}>
            {upload.isPending ? "Uploading..." : "Click or drag a file here to upload"}
          </div>
          <div className="text-[11.5px]" style={{ color: "var(--ink-400)" }}>PDF, image, or any file — stored per this document</div>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>
            Attached files
          </div>
          {isLoading ? <Spinner /> : !files || files.length === 0 ? (
            <div className="text-[12.5px]" style={{ color: "var(--ink-400)" }}>No files uploaded yet.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {files.map((f) => (
                <Card key={f.id} className="flex items-center justify-between !p-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon name="documents" className="h-4 w-4 shrink-0" style={{ color: "var(--brass-600)" }} />
                    <span className="truncate text-[13px] font-medium">{f.filename}</span>
                    <span className="shrink-0 text-[11px]" style={{ color: "var(--ink-400)" }}>({Math.round(f.size_bytes / 1024)} KB)</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      type="button"
                      className="text-xs font-semibold disabled:opacity-50"
                      style={{ color: "var(--brass-600)" }}
                      disabled={opening === f.id}
                      onClick={() => openFile(f, "view")}
                    >
                      {opening === f.id ? "Opening..." : "View"}
                    </button>
                    <button
                      type="button"
                      className="text-xs font-semibold disabled:opacity-50"
                      style={{ color: "var(--brass-600)" }}
                      disabled={opening === f.id}
                      onClick={() => openFile(f, "download")}
                    >
                      Download
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
