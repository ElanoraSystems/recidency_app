import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import logoMark from "../assets/logo-mark.png";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "../components/icons";
import { LiveDashboardCard } from "../components/LiveDashboardCard";
import { ResidenceBlueprint } from "../components/ResidenceBlueprint";

const BLUEPRINT_CYCLE_MS = 10_000;

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("owner@hadlaan.local");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [blueprintCycle, setBlueprintCycle] = useState(0);
  // On desktop the page opens as a full-screen animation with no login form —
  // clicking it reveals the split layout. Mobile skips the intro entirely
  // (screen space is too tight for a decorative first step before signing in).
  const [revealed, setRevealed] = useState(false);

  // The house sketch is a one-shot CSS animation — remounting it on an
  // interval is what makes it redraw itself instead of only playing once.
  useEffect(() => {
    const interval = setInterval(() => setBlueprintCycle((c) => c + 1), BLUEPRINT_CYCLE_MS);
    return () => clearInterval(interval);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate("/");
    } catch {
      setError("Invalid email or password.");
      setShake(true);
      setTimeout(() => setShake(false), 500);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Hero panel — full-screen intro on load; shrinks to a side panel once clicked */}
      <div
        role={revealed ? undefined : "button"}
        tabIndex={revealed ? undefined : 0}
        aria-label={revealed ? undefined : "Enter"}
        onClick={() => !revealed && setRevealed(true)}
        onKeyDown={(e) => !revealed && (e.key === "Enter" || e.key === " ") && setRevealed(true)}
        className="relative hidden shrink-0 flex-col overflow-hidden lg:flex"
        style={{
          width: revealed ? "42%" : "100%",
          transition: "width 850ms cubic-bezier(0.4, 0, 0.2, 1)",
          background: "linear-gradient(180deg, var(--rail-bg), var(--rail-bg-2))",
          color: "var(--rail-text)",
          cursor: revealed ? "default" : "pointer",
        }}
      >
        {/* Ambient drifting glow — evokes warm interior lighting, not a generic cosmic gradient */}
        <div
          className="login-orb"
          style={{
            top: "-10%", left: "-15%", width: "60%", height: "60%",
            background: "radial-gradient(circle, rgba(199,168,98,0.32), transparent 70%)",
            animation: "login-drift-a 22s ease-in-out infinite",
          }}
        />
        <div
          className="login-orb"
          style={{
            bottom: "-15%", right: "-10%", width: "55%", height: "55%",
            background: "radial-gradient(circle, rgba(138,109,52,0.28), transparent 70%)",
            animation: "login-drift-b 26s ease-in-out infinite",
          }}
        />
        <div
          className="login-orb"
          style={{
            top: "35%", left: "20%", width: "45%", height: "45%",
            background: "radial-gradient(circle, rgba(171,138,66,0.18), transparent 70%)",
            animation: "login-drift-c 30s ease-in-out infinite",
          }}
        />

        <LiveDashboardCard style={{ top: "15%", right: revealed ? "7%" : "10%", animationDelay: "650ms" }} />

        <div
          className="relative z-10 flex items-center gap-3 pt-14 transition-[padding] duration-700"
          style={{ paddingLeft: revealed ? "56px" : "clamp(24px, 6vw, 96px)" }}
        >
          <div className="login-anim-scale h-11 w-11 shrink-0 overflow-hidden rounded-[10px]">
            <img src={logoMark} alt="Butler Hadlaan House" className="h-full w-full object-cover" />
          </div>
          <div className="login-anim-scale" style={{ animationDelay: "80ms" }}>
            <div className="font-display text-lg font-semibold" style={{ color: "var(--rail-text-active)" }}>
              Butler Hadlaan House
            </div>
            <div className="text-[10.5px] uppercase tracking-wider" style={{ color: "var(--rail-text-dim)" }}>
              Private Residence Management
            </div>
          </div>
        </div>

        <div
          className="relative z-10 flex flex-1 flex-col justify-center transition-[padding] duration-700"
          style={{ paddingLeft: revealed ? "56px" : "clamp(24px, 6vw, 96px)", paddingRight: revealed ? "56px" : "clamp(24px, 6vw, 96px)" }}
        >
          <div
            className="login-anim-scale mx-auto mb-8 w-full transition-[max-width] duration-700"
            style={{ animationDelay: "120ms", maxWidth: revealed ? "480px" : "620px" }}
          >
            <ResidenceBlueprint key={blueprintCycle} />
          </div>
          <div className={revealed ? "" : "mx-auto max-w-xl text-center"}>
            <h1
              className="login-anim font-display text-[32px] font-semibold leading-[1.15]"
              style={{ color: "var(--rail-text-active)", animationDelay: "180ms" }}
            >
              Every corner of the residence, in one calm view.
            </h1>
            <p
              className={`login-anim mt-4 text-[15px] leading-relaxed ${revealed ? "max-w-sm" : "mx-auto max-w-lg"}`}
              style={{ color: "var(--rail-text-dim)", animationDelay: "340ms" }}
            >
              Staff, housekeeping, kitchen, inventory, maintenance, vehicles, guests and events —
              coordinated from a single private console.
            </p>
          </div>
        </div>

        {!revealed && (
          <div
            className="login-anim relative z-10 mb-10 flex items-center justify-center gap-2 self-center"
            style={{ animationDelay: "900ms" }}
          >
            <div
              className="login-float flex items-center gap-2 rounded-full border px-4 py-2 text-[12.5px] font-semibold"
              style={{ borderColor: "var(--rail-border)", color: "var(--rail-text-dim)", background: "rgba(245,244,238,0.04)" }}
            >
              Click anywhere to continue
              <Icon name="arrowRight" className="h-3.5 w-3.5" style={{ color: "var(--rail-accent)" }} />
            </div>
          </div>
        )}
      </div>

      {/* Right panel — the sign-in form. Hidden until revealed on desktop; always shown on mobile. */}
      <div
        className={`flex flex-1 items-center justify-center py-12 ${revealed ? "" : "lg:hidden"}`}
        style={{ background: "var(--bg)" }}
      >
        <div className="w-full max-w-sm px-6">
          <div className="login-anim-scale mb-6 flex flex-col items-center gap-3 lg:hidden">
            <div className="h-11 w-11 shrink-0 overflow-hidden rounded-[10px]">
              <img src={logoMark} alt="Butler Hadlaan House" className="h-full w-full object-cover" />
            </div>
            <div className="text-center">
              <div className="font-display text-xl font-semibold">Butler Hadlaan House</div>
              <div className="text-xs" style={{ color: "var(--ink-500)" }}>
                Private Residence Management
              </div>
            </div>
          </div>

          <div
            className="login-anim mb-1 text-[11px] font-bold uppercase tracking-wider"
            style={{ color: "var(--brass-600)", animationDelay: "100ms" }}
          >
            Sign in
          </div>
          <h2
            className="login-anim font-display text-2xl font-semibold"
            style={{ color: "var(--ink-900)", animationDelay: "160ms" }}
          >
            Welcome back
          </h2>

          <form onSubmit={onSubmit} className={`mt-5 flex flex-col gap-3 ${shake ? "login-shake" : ""}`}>
            <label className="login-anim flex flex-col gap-1 text-[13px] font-medium" style={{ animationDelay: "260ms" }}>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="login-input rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border-strong)" }}
                required
              />
            </label>
            <label className="login-anim flex flex-col gap-1 text-[13px] font-medium" style={{ animationDelay: "340ms" }}>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="login-input rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border-strong)" }}
                required
              />
            </label>
            {error && (
              <div className="text-[13px]" style={{ color: "var(--status-critical)" }}>
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={busy}
              className="login-anim login-cta mt-2 w-full rounded-lg py-2.5 text-center text-[13px] font-semibold text-white disabled:cursor-wait"
              style={{ animationDelay: "420ms" }}
            >
              {busy ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <div
            className="login-anim mt-5 rounded-lg p-3 text-[12px]"
            style={{ background: "var(--surface-sunken)", color: "var(--ink-500)", animationDelay: "500ms" }}
          >
            Local dev seed password for every account: <code>password123</code>. Try{" "}
            <code>aiko.t@residence.local</code> (Chef) or <code>ramon.v@residence.local</code> (Manager).
          </div>
        </div>
      </div>
    </div>
  );
}
