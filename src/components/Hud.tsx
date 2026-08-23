import { Pause, Play } from "lucide-react";
import { useSession } from "@/store/session";
import { cn } from "@/lib/utils";

const LIGHT_LABEL = { none: "", red: "Red", yellow: "Amber", green: "Green" } as const;
const LIGHT_COLOR = {
  none: "",
  red: "bg-danger",
  yellow: "bg-warn",
  green: "bg-ok",
} as const;

export function Hud() {
  const hud = useSession((s) => s.hud);
  const phase = useSession((s) => s.phase);
  const setPhase = useSession((s) => s.setPhase);
  const paused = phase === "paused";

  return (
    <div className="pointer-events-none absolute inset-0 z-10 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="max-w-[70%] rounded-lg border border-border bg-bg/80 px-3 py-2 backdrop-blur-sm">
          <p className="text-[10px] tracking-[0.18em] text-subtle uppercase">Find</p>
          <p className="font-display text-lg leading-tight text-fg">{hud.destLabel || "Destination"}</p>
          <p className="mt-1 text-xs text-muted">
            Now on <span className="text-fg">{hud.street || "—"}</span>
            <span className="mx-1.5 text-subtle">·</span>
            <span className="font-mono tabular-nums">{Math.round(hud.destDist)} m</span>
          </p>
        </div>
        <div className="flex items-start gap-2">
          <div className="rounded-lg border border-border bg-bg/80 px-3 py-2 text-right backdrop-blur-sm">
            <p className="font-mono text-2xl leading-none tabular-nums text-fg">{Math.round(hud.speedKmh)}</p>
            <p className="mt-0.5 text-[10px] tracking-widest text-subtle uppercase">km/h</p>
          </div>
          <button
            type="button"
            className="pointer-events-auto flex size-11 items-center justify-center rounded-md border border-border bg-bg/80 text-fg backdrop-blur-sm"
            onClick={() => setPhase(paused ? "playing" : "paused")}
            aria-label={paused ? "Resume" : "Pause"}
          >
            {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
          </button>
        </div>
      </div>

      <div className="absolute top-1/2 right-3 hidden -translate-y-1/2 sm:block">
        <CompassRose heading={hud.headingDeg} />
      </div>

      {hud.light !== "none" && (
        <div className="absolute top-24 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-bg/80 px-3 py-1.5 text-xs text-fg backdrop-blur-sm">
          <span className={cn("size-2.5 rounded-full", LIGHT_COLOR[hud.light])} />
          {LIGHT_LABEL[hud.light]} ahead
        </div>
      )}

      {paused && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-bg/60 backdrop-blur-[2px]">
          <div className="rounded-xl border border-border bg-surface p-6 text-center">
            <p className="font-display text-2xl text-fg">Paused</p>
            <p className="mt-1 text-sm text-muted">Esc or P to resume</p>
            <button
              type="button"
              className="mt-4 h-11 rounded-md bg-fg px-5 text-sm font-medium text-bg"
              onClick={() => setPhase("playing")}
            >
              Resume
            </button>
          </div>
        </div>
      )}

      <div className="absolute right-3 bottom-3 overflow-hidden rounded-lg border border-border bg-bg/80 p-1 backdrop-blur-sm sm:bottom-4 sm:right-4">
        <canvas id="veilway-minimap" width={148} height={148} className="block size-28 sm:size-36" />
      </div>
    </div>
  );
}

function CompassRose({ heading }: { heading: number }) {
  return (
    <div className="relative size-14 rounded-full border border-border bg-bg/80 backdrop-blur-sm">
      <div className="absolute inset-0 transition-transform duration-150" style={{ transform: `rotate(${-heading}deg)` }}>
        <span className="absolute top-1 left-1/2 -translate-x-1/2 text-[10px] font-semibold text-fg">N</span>
        <span className="absolute top-1.5 left-1/2 h-3 w-px -translate-x-1/2 bg-danger" />
      </div>
    </div>
  );
}
