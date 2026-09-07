import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Icon } from "../components/icons";

interface SearchResult {
  title: string;
  sub: string;
  route: string;
  icon: string;
}

async function runSearch(q: string): Promise<SearchResult[]> {
  const query = q.toLowerCase();
  const [staff, tasks, inventory, guests, documents, vehicles] = await Promise.all([
    api.get("/people/staff").then((r) => r.data).catch(() => []),
    api.get("/tasks").then((r) => r.data).catch(() => []),
    api.get("/inventory").then((r) => r.data).catch(() => []),
    api.get("/guests").then((r) => r.data).catch(() => []),
    api.get("/documents").then((r) => r.data).catch(() => []),
    api.get("/vehicles").then((r) => r.data).catch(() => []),
  ]);

  const out: SearchResult[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of staff as any[]) if (s.name.toLowerCase().includes(query) || s.position.toLowerCase().includes(query))
    out.push({ title: s.name, sub: `Staff · ${s.position}`, route: "/people", icon: "people" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const t of tasks as any[]) if (t.title.toLowerCase().includes(query))
    out.push({ title: t.title, sub: `Task · ${t.status}`, route: "/tasks", icon: "tasks" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const i of inventory as any[]) if (i.name.toLowerCase().includes(query))
    out.push({ title: i.name, sub: `Inventory · ${i.category}`, route: "/inventory", icon: "inventory" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const g of guests as any[]) if (g.name.toLowerCase().includes(query))
    out.push({ title: g.name, sub: `Guest · arriving ${g.arrival}`, route: "/guests", icon: "guests" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const d of documents as any[]) if (d.name.toLowerCase().includes(query))
    out.push({ title: d.name, sub: `Document · ${d.category}`, route: "/documents", icon: "documents" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const v of vehicles as any[]) if (v.name.toLowerCase().includes(query) || v.reg.toLowerCase().includes(query))
    out.push({ title: v.name, sub: `Vehicle · ${v.reg}`, route: "/vehicles", icon: "car" });

  return out.slice(0, 8);
}

export function GlobalSearch({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    const handle = setTimeout(() => {
      runSearch(query).then((r) => setResults(r));
    }, 220);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function go(route: string) {
    navigate(route);
    setQuery("");
    setResults(null);
    setOpen(false);
    onNavigate?.();
  }

  return (
    <div ref={boxRef} className={`relative ${mobile ? "w-full" : "w-full max-w-[420px]"}`}>
      <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-[15px] w-[15px] -translate-y-1/2" style={{ color: "var(--ink-400)" }} />
      <input
        type="search"
        placeholder="Search staff, tasks, inventory, guests…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        className="w-full rounded-[9px] border py-2 pl-8 pr-3 text-[13px] outline-none"
        style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--ink-900)" }}
      />
      {open && query.trim().length >= 2 && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[60vh] overflow-y-auto rounded-xl border py-1.5 shadow-lg"
          style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow-lg)" }}
        >
          {results === null ? (
            <div className="px-4 py-3 text-[13px]" style={{ color: "var(--ink-400)" }}>Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-[13px]" style={{ color: "var(--ink-400)" }}>No matches for "{query}"</div>
          ) : (
            results.map((r, i) => (
              <button
                key={i}
                onClick={() => go(r.route)}
                className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left hover:bg-[var(--surface-hover)]"
              >
                <Icon name={r.icon} className="h-4 w-4 shrink-0" style={{ color: "var(--brass-600)" }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold" style={{ color: "var(--ink-900)" }}>{r.title}</span>
                  <span className="block truncate text-[11.5px]" style={{ color: "var(--ink-400)" }}>{r.sub}</span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
