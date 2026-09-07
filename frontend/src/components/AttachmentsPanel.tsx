import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { Icon } from "./icons";
import { Spinner } from "./ui";

export type AttachmentEntityType = "asset" | "maintenance_request" | "task" | "expense";

interface AttachedFile { id: string; filename: string; size_bytes: number; uploaded_at: string }

export function AttachmentsPanel({ entityType, entityId }: { entityType: AttachmentEntityType; entityId: string }) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const queryKey = ["attachments", entityType, entityId];

  const { data: files, isLoading } = useQuery<AttachedFile[]>({
    queryKey,
    queryFn: async () => (await api.get(`/attachments/${entityType}/${entityId}/files`)).data,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return api.post(`/attachments/${entityType}/${entityId}/files`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  function handleFiles(fileList: FileList | null) {
    const file = fileList?.[0];
    if (file) upload.mutate(file);
  }

  return (
    <div>
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-400)" }}>
        Photos & documents
      </div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => fileInputRef.current?.click()}
        className="mb-2 flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-dashed p-4 text-center transition-colors"
        style={{ borderColor: dragOver ? "var(--brass-500)" : "var(--border-strong)", background: dragOver ? "var(--brass-100)" : "var(--surface-sunken)" }}
      >
        <Icon name="upload" className="h-5 w-5" style={{ color: "var(--brass-600)" }} />
        <div className="text-[12.5px] font-semibold" style={{ color: "var(--ink-700)" }}>
          {upload.isPending ? "Uploading..." : "Click or drag a file here to upload"}
        </div>
        <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
      </div>
      {isLoading ? <Spinner /> : !files || files.length === 0 ? (
        <div className="text-[12px]" style={{ color: "var(--ink-400)" }}>No files uploaded yet.</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {files.map((f) => (
            <div key={f.id} className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[12.5px]" style={{ background: "var(--surface-sunken)" }}>
              <div className="flex min-w-0 items-center gap-1.5">
                <Icon name="documents" className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--brass-600)" }} />
                <span className="truncate font-medium">{f.filename}</span>
                <span className="shrink-0 text-[10.5px]" style={{ color: "var(--ink-400)" }}>({Math.round(f.size_bytes / 1024)} KB)</span>
              </div>
              <a href={`/api/v1/attachments/files/${f.id}/download`} target="_blank" rel="noreferrer"
                className="shrink-0 text-[11.5px] font-semibold" style={{ color: "var(--brass-600)" }}>
                Download
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
