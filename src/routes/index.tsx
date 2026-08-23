import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { GameView } from "@/components/GameView";
import { LoadingScreen } from "@/components/LoadingScreen";
import { StartMenu } from "@/components/StartMenu";
import { buildTrip } from "@/lib/osm/api";
import { makePracticeWorld } from "@/lib/osm/synthetic";
import type { WorldData } from "@/lib/osm/types";
import { useSession } from "@/store/session";

export const Route = createFileRoute("/")({ component: Home });

type OsmOpts = {
  startQuery: string;
  destMode: "random" | "address";
  destQuery: string;
  randomMeters: number;
};

function Home() {
  const phase = useSession((s) => s.phase);
  const loadingText = useSession((s) => s.loadingText);
  const error = useSession((s) => s.error);
  const setLoading = useSession((s) => s.setLoading);
  const setError = useSession((s) => s.setError);
  const setPhase = useSession((s) => s.setPhase);
  const resetToMenu = useSession((s) => s.resetToMenu);
  const [world, setWorld] = useState<WorldData | null>(null);
  const [ticket, setTicket] = useState(0);
  const lastOsm = useRef<OsmOpts | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("qa") === "1") startPractice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function playWorld(next: WorldData) {
    setWorld(next);
    setTicket((n) => n + 1);
    setPhase("playing");
  }

  function startPractice() {
    lastOsm.current = null;
    setLoading("Laying out the practice district…");
    playWorld(makePracticeWorld(420));
  }

  async function startOsm(opts: OsmOpts) {
    lastOsm.current = opts;
    setLoading("Finding that neighborhood…");
    try {
      setLoading("Downloading streets from OpenStreetMap…");
      const next = await buildTrip({
        startQuery: opts.startQuery,
        destMode: opts.destMode,
        destQuery: opts.destQuery,
        randomMeters: opts.randomMeters,
      });
      playWorld(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not build that map.";
      setError(message.replace(/^.*?Error:\s*/, ""));
    }
  }

  function driveAgain() {
    if (lastOsm.current) void startOsm(lastOsm.current);
    else startPractice();
  }

  return (
    <main className="min-h-dvh bg-bg text-fg">
      {phase === "menu" && (
        <StartMenu busy={false} error={error} onStart={(o) => void startOsm(o)} onPractice={startPractice} />
      )}
      {phase === "loading" && <LoadingScreen text={loadingText} />}
      {world && (phase === "playing" || phase === "paused" || phase === "scored") ? (
        <GameView key={ticket} world={world} onAgain={driveAgain} onMenu={resetToMenu} />
      ) : null}
    </main>
  );
}
