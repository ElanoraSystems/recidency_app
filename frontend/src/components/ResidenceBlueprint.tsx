interface Opening {
  label: string;
  cx: number;
  cy: number;
  delay: number;
  labelPos: { top: string; left: string; transform: string; textAlign?: "left" | "right" | "center" };
}

// viewBox is 760x340 — a wide, symmetric manor facade (central pavilion +
// two wings) rather than a single small house, befitting the residence this
// app manages. Label positions below are expressed as % of that box so they
// track the SVG exactly regardless of rendered size.
const OPENINGS: Opening[] = [
  {
    label: "Purchasing",
    cx: 287, cy: 157, delay: 1500,
    labelPos: { top: "42%", left: "37.8%", transform: "translate(-50%, -145%)", textAlign: "center" },
  },
  {
    label: "Maintenance",
    cx: 473, cy: 157, delay: 1650,
    labelPos: { top: "42%", left: "62.2%", transform: "translate(-50%, -145%)", textAlign: "center" },
  },
  {
    label: "Kitchen",
    cx: 278, cy: 260, delay: 1800,
    labelPos: { top: "94%", left: "36.6%", transform: "translate(-50%, 0)", textAlign: "center" },
  },
  {
    label: "Housekeeping",
    cx: 482, cy: 260, delay: 1950,
    labelPos: { top: "94%", left: "63.4%", transform: "translate(-50%, 0)", textAlign: "center" },
  },
  {
    label: "Guests & Events",
    cx: 52, cy: 268, delay: 2100,
    labelPos: { top: "97%", left: "7%", transform: "translate(-8%, 0)", textAlign: "left" },
  },
];

export function ResidenceBlueprint() {
  return (
    <div className="relative w-full" style={{ aspectRatio: "760 / 340" }}>
      <svg viewBox="0 0 760 340" className="absolute inset-0 h-full w-full" aria-hidden="true">
        {/* ground + garden walls, gate posts either end */}
        <path className="login-draw" pathLength={1} d="M15,300 L745,300" style={{ animationDelay: "220ms" }} />
        <path className="login-draw" pathLength={1} d="M15,300 L15,282 M745,300 L745,282" style={{ animationDelay: "300ms" }} />

        {/* left wing (single storey) */}
        <path className="login-draw" pathLength={1} d="M70,300 L70,200 L230,200 L230,300" style={{ animationDelay: "420ms" }} />
        {/* right wing (single storey) */}
        <path className="login-draw" pathLength={1} d="M530,300 L530,200 L690,200 L690,300" style={{ animationDelay: "420ms" }} />

        {/* central pavilion (two storey) */}
        <path className="login-draw" pathLength={1} d="M230,300 L230,110 L530,110 L530,300" style={{ animationDelay: "650ms" }} />
        {/* central pediment roof, overhanging the pavilion */}
        <path className="login-draw" pathLength={1} d="M208,110 L380,48 L552,110" style={{ animationDelay: "1000ms" }} />
        {/* chimney on the roof slope */}
        <path className="login-draw" pathLength={1} d="M486,86 L486,44 M486,44 L502,44 L502,70" style={{ animationDelay: "1200ms" }} />

        {/* grand arched entrance with flanking pilasters */}
        <path className="login-draw" pathLength={1} d="M345,300 L345,235 A35,32 0 0 1 415,235 L415,300" style={{ animationDelay: "1300ms" }} />
        <path className="login-draw" pathLength={1} d="M328,300 L328,190 M328,190 L336,190 L336,300 M424,300 L424,190 M424,190 L432,190 L432,300" style={{ animationDelay: "1400ms" }} />

        {/* wing windows — decorative, part of the architecture, not a module */}
        <rect className="login-draw" pathLength={1} x={128} y={232} width={32} height={36} rx={2} style={{ animationDelay: "1500ms" }} />
        <rect className="login-draw" pathLength={1} x={600} y={232} width={32} height={36} rx={2} style={{ animationDelay: "1500ms" }} />

        {/* windows — outline draws in, then the glass wakes up */}
        <rect className="login-draw" pathLength={1} x={270} y={140} width={34} height={34} rx={2} style={{ animationDelay: "1550ms" }} />
        <rect className="login-draw" pathLength={1} x={456} y={140} width={34} height={34} rx={2} style={{ animationDelay: "1600ms" }} />
        <rect className="login-draw" pathLength={1} x={260} y={240} width={36} height={40} rx={2} style={{ animationDelay: "1650ms" }} />
        <rect className="login-draw" pathLength={1} x={464} y={240} width={36} height={40} rx={2} style={{ animationDelay: "1700ms" }} />

        {/* garden lamp post, for the "Guests & Events" opening */}
        <path className="login-draw" pathLength={1} d="M52,300 L52,222" style={{ animationDelay: "1750ms" }} />
        <circle className="login-draw" pathLength={1} cx={52} cy={214} r={8} style={{ animationDelay: "1850ms" }} />

        {/* symmetric trees, either side of the grounds */}
        <path className="login-draw" pathLength={1} d="M715,300 L715,276" style={{ animationDelay: "1300ms" }} />
        <circle className="login-draw" pathLength={1} cx={715} cy={258} r={20} style={{ animationDelay: "1400ms" }} />

        {/* the glow — each window/lamp lights up in sequence */}
        {OPENINGS.map((o) => {
          const isLamp = o.label === "Guests & Events";
          return isLamp ? (
            <circle
              key={o.label}
              className="login-window"
              cx={o.cx}
              cy={o.cy}
              r={5}
              style={{ animationDelay: `${o.delay}ms, ${o.delay + 900}ms`, animationDuration: "0.9s, 3.2s", "--glow-peak": 0.85 } as never}
            />
          ) : (
            <rect
              key={o.label}
              className="login-window"
              x={o.cx - 14}
              y={o.cy - 14}
              width={28}
              height={28}
              rx={1.5}
              style={{ animationDelay: `${o.delay}ms, ${o.delay + 900}ms`, animationDuration: "0.9s, 3.4s", "--glow-peak": 0.5 } as never}
            />
          );
        })}
      </svg>

      {OPENINGS.map((o) => (
        <div
          key={o.label}
          className="login-label"
          style={{
            top: o.labelPos.top,
            left: o.labelPos.left,
            transform: o.labelPos.transform,
            textAlign: o.labelPos.textAlign,
            animationDelay: `${o.delay + 250}ms`,
          }}
        >
          {o.label}
        </div>
      ))}
    </div>
  );
}
