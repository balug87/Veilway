import { Compass, MapPin, Navigation } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { searchPlaces } from "@/lib/osm/api";
import type { PlaceHit } from "@/lib/osm/types";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Covent Garden, London",
  "Gion, Kyoto",
  "Jordaan, Amsterdam",
  "Trastevere, Rome",
  "The Castro, San Francisco",
];

type Props = {
  busy: boolean;
  error: string | null;
  onStart: (opts: {
    startQuery: string;
    destMode: "random" | "address";
    destQuery: string;
    randomMeters: number;
  }) => void;
  onPractice: () => void;
};

export function StartMenu({ busy, error, onStart, onPractice }: Props) {
  const [startQuery, setStartQuery] = useState("Covent Garden, London");
  const [destMode, setDestMode] = useState<"random" | "address">("random");
  const [destQuery, setDestQuery] = useState("");
  const [meters, setMeters] = useState(550);
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [openHits, setOpenHits] = useState(false);

  useEffect(() => {
    const q = startQuery.trim();
    if (q.length < 3) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      void searchPlaces(q)
        .then(setHits)
        .catch(() => setHits([]));
    }, 280);
    return () => clearTimeout(t);
  }, [startQuery]);

  return (
    <div className="flex min-h-dvh w-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:p-8">
        <p className="text-xs font-medium tracking-[0.22em] text-muted uppercase">Night wayfinding</p>
        <h1 className="font-display mt-2 text-4xl leading-tight tracking-[-0.03em] text-fg sm:text-5xl">Veilway</h1>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">
          Drive a real city through fog. The street you are on stays lit ahead so you can stay on the pavement;
          signals glow as you approach. Street names are your map.
        </p>

        <form
          className="mt-7 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            onStart({ startQuery, destMode, destQuery, randomMeters: meters });
          }}
        >
          <div className="relative space-y-2">
            <Label htmlFor="origin">Start from</Label>
            <div className="relative">
              <MapPin className="pointer-events-none absolute top-3.5 left-3 size-4 text-subtle" />
              <Input
                id="origin"
                value={startQuery}
                autoComplete="off"
                placeholder="Neighborhood or city"
                className="pl-10"
                onChange={(e) => {
                  setStartQuery(e.target.value);
                  setOpenHits(true);
                }}
                onFocus={() => setOpenHits(true)}
              />
            </div>
            {openHits && hits.length > 0 && (
              <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-bg py-1">
                {hits.map((h) => (
                  <li key={`${h.lat},${h.lon},${h.label}`}>
                    <button
                      type="button"
                      className="flex w-full flex-col px-3 py-2 text-left hover:bg-surface-2"
                      onClick={() => {
                        setStartQuery(h.context ? `${h.label}, ${h.context}` : h.label);
                        setOpenHits(false);
                      }}
                    >
                      <span className="text-sm text-fg">{h.label}</span>
                      <span className="text-xs text-subtle">{h.context}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStartQuery(s)}
                  className="rounded-full border border-border px-2.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-fg"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <Label>Destination</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDestMode("random")}
                className={cn(
                  "h-11 rounded-md border text-sm",
                  destMode === "random"
                    ? "border-fg bg-fg text-bg"
                    : "border-border bg-transparent text-muted hover:bg-surface-2",
                )}
              >
                Random nearby
              </button>
              <button
                type="button"
                onClick={() => setDestMode("address")}
                className={cn(
                  "h-11 rounded-md border text-sm",
                  destMode === "address"
                    ? "border-fg bg-fg text-bg"
                    : "border-border bg-transparent text-muted hover:bg-surface-2",
                )}
              >
                Named place
              </button>
            </div>
            {destMode === "random" ? (
              <div>
                <div className="mb-1 flex justify-between text-xs text-muted">
                  <span>Search radius</span>
                  <span className="font-mono tabular-nums text-fg">{meters} m</span>
                </div>
                <Slider min={250} max={1200} step={50} value={[meters]} onValueChange={(v) => setMeters(v[0] ?? 550)} />
              </div>
            ) : (
              <Input
                value={destQuery}
                placeholder="Street or landmark nearby"
                onChange={(e) => setDestQuery(e.target.value)}
              />
            )}
          </div>

          {error && (
            <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" className="flex-1" disabled={busy} data-testid="start-drive">
              <Navigation className="size-4" />
              Start drive
            </Button>
            <Button type="button" variant="secondary" onClick={onPractice} disabled={busy} data-testid="practice">
              <Compass className="size-4" />
              Practice district
            </Button>
          </div>
        </form>

        <p className="mt-6 text-xs leading-relaxed text-subtle">
          W accelerate · S reverse · A / D steer · Space brake. Stay on the lit street; signals glow as they come
          into range. Street names are the map — there is no turn-by-turn.
        </p>
      </div>
    </div>
  );
}
