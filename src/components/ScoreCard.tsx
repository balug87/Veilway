import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Score } from "@/store/session";

function fmt(m: number) {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
}

type Props = {
  score: Score;
  onAgain: () => void;
  onMenu: () => void;
};

export function ScoreCard({ score, onAgain, onMenu }: Props) {
  const pct = Math.round(score.efficiency * 100);
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-bg/55 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 sm:p-8">
        <p className="text-xs tracking-[0.2em] text-muted uppercase">Trip complete</p>
        <p className="font-display mt-1 text-3xl text-fg">{score.destLabel}</p>
        <p className="font-display mt-5 text-6xl leading-none tracking-[-0.04em] text-fg tabular-nums">{score.points}</p>
        <p className="mt-1 text-sm text-muted">
          {pct}% of the shortest {score.source === "osm" ? "OSM driving route" : "street-graph route"}
        </p>
        <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
          <Stat label="Shortest" value={fmt(score.shortestM)} />
          <Stat label="Your drive" value={fmt(score.drivenM)} />
          <Stat label="Red lights run" value={String(score.redLights)} />
          <Stat label="Streets read" value={String(score.streetsFound)} />
        </dl>
        <p className="mt-4 text-xs text-subtle">
          The map is fully revealed. Cream is your path; the dashed line is the shortest legal drive.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1" onClick={onAgain}>
            <RotateCcw className="size-4" />
            Drive again
          </Button>
          <Button variant="secondary" className="flex-1" onClick={onMenu}>
            New city
          </Button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-bg px-3 py-2">
      <dt className="text-[11px] text-subtle">{label}</dt>
      <dd className="font-mono text-base tabular-nums text-fg">{value}</dd>
    </div>
  );
}
