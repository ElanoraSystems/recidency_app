import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import logoMark from "../assets/logo-mark.png";
import { useAuth } from "../auth/AuthContext";
import { useTheme } from "../auth/ThemeContext";
import { Icon } from "../components/icons";
import { initials, roleLabel } from "../lib/roles";
import type { ApprovalItem } from "../types";
import { GlobalSearch } from "./GlobalSearch";
import { NAV } from "./nav";
import { NotificationBell } from "./NotificationBell";

const MOBILE_PRIMARY_MAX = 4;

export function Shell() {
  const { user, logout, hasModule } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);

  const visibleNav = NAV.filter((n) => hasModule(n.id));
  const activeNavItem = visibleNav.find((n) => (n.path === "/" ? location.pathname === "/" : location.pathname.startsWith(n.path)));

  const { data: approvals } = useQuery<ApprovalItem[]>({
    queryKey: ["approvals"],
    queryFn: async () => (await api.get("/approvals")).data,
    enabled: hasModule("approvals"),
    staleTime: 30_000,
  });

  const primaryMobile = visibleNav.slice(0, MOBILE_PRIMARY_MAX);
  const overflowMobile = visibleNav.slice(MOBILE_PRIMARY_MAX);

  return (
    <div className="flex min-h-screen">
      {/* ---- Sidebar: hidden on mobile, icon-only on tablet, full on desktop ---- */}
      <aside
        className="sticky top-0 z-40 hidden h-screen w-[76px] shrink-0 flex-col border-r md:flex lg:w-[236px]"
        style={{
          background: "linear-gradient(180deg, var(--rail-bg), var(--rail-bg-2))",
          borderColor: "var(--rail-border)",
          color: "var(--rail-text)",
        }}
      >
        <div className="flex items-center gap-2.5 px-4 pb-4 pt-[22px] lg:px-5">
          <div className="h-[34px] w-[34px] shrink-0 overflow-hidden rounded-[9px]">
            <img src={logoMark} alt="Butler Hadlaan House" className="h-full w-full object-cover" />
          </div>
          <div className="hidden lg:block">
            <div className="font-display text-[18px] font-semibold leading-tight" style={{ color: "var(--rail-text-active)" }}>
              Butler Hadlaan House
            </div>
            <div className="text-[10.5px] uppercase tracking-wider" style={{ color: "var(--rail-text-dim)" }}>
              {user?.user_type === "owner" ? "Owner Console" : roleLabel(user)}
            </div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 py-1.5 lg:px-3">
          {visibleNav.map((n) => {
            const badgeCount = n.id === "approvals" ? approvals?.length ?? 0 : 0;
            return (
              <NavLink
                key={n.id}
                to={n.path}
                end={n.path === "/"}
                title={n.label}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-lg py-2 pl-[9px] pr-2.5 text-[13px] font-semibold transition-colors lg:pr-3 ${
                    isActive ? "" : "hover:bg-white/5"
                  }`
                }
                style={({ isActive }) => ({
                  color: isActive ? "var(--rail-text-active)" : "var(--rail-text)",
                  background: isActive ? "rgba(199, 168, 98, 0.14)" : "transparent",
                  borderLeft: isActive ? "3px solid var(--rail-accent)" : "3px solid transparent",
                  justifyContent: "flex-start",
                })}
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      name={n.icon}
                      className="h-[17px] w-[17px] shrink-0"
                      style={{ opacity: isActive ? 1 : 0.8, color: isActive ? "var(--rail-accent)" : "inherit" }}
                    />
                    <span className="hidden flex-1 lg:inline">{n.label}</span>
                    {badgeCount > 0 && (
                      <span
                        className="hidden h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold lg:flex"
                        style={{
                          background: isActive ? "var(--rail-accent)" : "rgba(255,255,255,0.08)",
                          color: isActive ? "var(--rail-bg)" : "var(--rail-text-active)",
                        }}
                      >
                        {badgeCount}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t p-2.5 lg:p-3" style={{ borderColor: "var(--rail-border)" }}>
          <div className="mb-2 flex items-center gap-2.5 rounded-lg px-1 py-1">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
              style={{ background: "var(--rail-accent)", color: "var(--rail-bg)" }}
            >
              {user ? initials(user.name) : "?"}
            </div>
            <div className="hidden min-w-0 flex-1 lg:block">
              <div className="truncate text-[13px] font-semibold" style={{ color: "var(--rail-text-active)" }}>
                {user?.name}
              </div>
              <div className="truncate text-[11px]" style={{ color: "var(--rail-text-dim)" }}>
                {roleLabel(user)}
              </div>
            </div>
          </div>
          <button
            onClick={logout}
            title="Sign out"
            className="flex w-full items-center justify-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] hover:bg-white/5 lg:justify-start"
            style={{ color: "var(--rail-text-dim)" }}
          >
            <Icon name="logout" className="h-[15px] w-[15px]" />
            <span className="hidden lg:inline">Sign out</span>
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ---- Desktop/tablet topbar ---- */}
        <div
          className="sticky top-0 z-30 hidden items-center gap-3.5 border-b px-6 py-3 backdrop-blur md:flex"
          style={{ background: "color-mix(in srgb, var(--bg) 88%, transparent)", borderColor: "var(--border)" }}
        >
          <div className="shrink-0 font-display text-[19px] font-semibold" style={{ color: "var(--ink-900)" }}>
            {activeNavItem?.label ?? "Butler Hadlaan House"}
          </div>
          <GlobalSearch />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              onClick={toggleTheme}
              title="Toggle theme"
              className="flex h-9 w-9 items-center justify-center rounded-[9px] border"
              style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--ink-700)" }}
            >
              <Icon name={theme === "dark" ? "sun" : "moon"} className="h-[17px] w-[17px]" />
            </button>
            <NotificationBell />
            <button
              onClick={() => navigate("/settings")}
              title={roleLabel(user)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
              style={{ background: "var(--brass-100)", color: "var(--brass-700)" }}
            >
              {user ? initials(user.name) : "?"}
            </button>
          </div>
        </div>

        {/* ---- Mobile topbar ---- */}
        <div
          className="sticky top-0 z-30 flex items-center gap-2.5 border-b px-4 py-3 backdrop-blur md:hidden"
          style={{ background: "color-mix(in srgb, var(--bg) 92%, transparent)", borderColor: "var(--border)" }}
        >
          <div className="h-[30px] w-[30px] shrink-0 overflow-hidden rounded-[8px]">
            <img src={logoMark} alt="Butler Hadlaan House" className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0 flex-1 truncate font-display text-[17px] font-semibold" style={{ color: "var(--ink-900)" }}>
            {activeNavItem?.label ?? "Butler Hadlaan House"}
          </div>
          <button
            onClick={toggleTheme}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]"
            style={{ color: "var(--ink-700)" }}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} className="h-[17px] w-[17px]" />
          </button>
          <NotificationBell />
          <button
            onClick={() => navigate("/settings")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
            style={{ background: "var(--brass-100)", color: "var(--brass-700)" }}
          >
            {user ? initials(user.name) : "?"}
          </button>
        </div>

        <main className="min-w-0 flex-1 pb-24 md:pb-0">
          <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 md:px-8 md:py-8">
            <Outlet />
          </div>
        </main>
      </div>

      {/* ---- Mobile bottom nav ---- */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t px-1 pb-[env(safe-area-inset-bottom)] md:hidden"
        style={{ background: "var(--rail-bg)", borderColor: "var(--rail-border)" }}
      >
        {primaryMobile.map((n) => (
          <NavLink
            key={n.id}
            to={n.path}
            end={n.path === "/"}
            className="flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-bold"
          >
            {({ isActive }) => (
              <>
                <Icon name={n.icon} className="h-5 w-5" style={{ color: isActive ? "var(--rail-accent)" : "var(--rail-text-dim)" }} />
                <span style={{ color: isActive ? "var(--rail-accent)" : "var(--rail-text-dim)" }}>{n.label.split(" ")[0]}</span>
              </>
            )}
          </NavLink>
        ))}
        {overflowMobile.length > 0 && (
          <button onClick={() => setMoreOpen(true)} className="flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-bold">
            <Icon name="more" className="h-5 w-5" style={{ color: "var(--rail-text-dim)" }} />
            <span style={{ color: "var(--rail-text-dim)" }}>More</span>
          </button>
        )}
      </nav>

      {/* ---- Mobile "more" sheet ---- */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 flex items-end md:hidden" style={{ background: "rgba(0,0,0,0.4)" }} onClick={() => setMoreOpen(false)}>
          <div
            className="w-full rounded-t-2xl border-t p-4 pb-[calc(16px+env(safe-area-inset-bottom))]"
            style={{ background: "var(--surface)", borderColor: "var(--border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-base font-semibold" style={{ color: "var(--ink-900)" }}>All modules</h3>
              <button onClick={() => setMoreOpen(false)} style={{ color: "var(--ink-400)" }}>
                <Icon name="x" className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {visibleNav.map((n) => (
                <button
                  key={n.id}
                  onClick={() => { navigate(n.path); setMoreOpen(false); }}
                  className="flex flex-col items-center gap-1.5 rounded-xl px-2 py-3"
                  style={{ background: "var(--surface-sunken)" }}
                >
                  <Icon name={n.icon} className="h-5 w-5" style={{ color: "var(--brass-600)" }} />
                  <span className="text-center text-[10.5px] font-semibold leading-tight" style={{ color: "var(--ink-700)" }}>{n.label}</span>
                </button>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between border-t pt-4" style={{ borderColor: "var(--border)" }}>
              <div className="flex min-w-0 items-center gap-2.5">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
                  style={{ background: "var(--brass-100)", color: "var(--brass-700)" }}
                >
                  {user ? initials(user.name) : "?"}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold" style={{ color: "var(--ink-900)" }}>{user?.name}</div>
                  <div className="truncate text-[11px]" style={{ color: "var(--ink-400)" }}>{roleLabel(user)}</div>
                </div>
              </div>
              <button
                onClick={() => { setMoreOpen(false); logout(); }}
                className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] font-semibold"
                style={{ background: "var(--status-critical-bg)", color: "var(--status-critical)" }}
              >
                <Icon name="logout" className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
