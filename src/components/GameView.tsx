import { useEffect, useRef, useState } from "react";
import { GameEngine } from "@/game/engine";
import type { Input } from "@/game/input";
import type { WorldData } from "@/lib/osm/types";
import { Hud } from "./Hud";
import { ScoreCard } from "./ScoreCard";
import { TouchPad } from "./TouchPad";
import { useSession } from "@/store/session";

type Props = {
  world: WorldData;
  onAgain: () => void;
  onMenu: () => void;
};

export function GameView({ world, onAgain, onMenu }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [input, setInput] = useState<Input | null>(null);
  const phase = useSession((s) => s.phase);
  const score = useSession((s) => s.score);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const minimap = document.getElementById("veilway-minimap") as HTMLCanvasElement | null;
    const engine = new GameEngine(canvas, world, minimap);
    engineRef.current = engine;
    setInput(engine.input);
    engine.start();
    useSession.getState().setPhase("playing");
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [world]);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-bg">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" />
      <Hud />
      <TouchPad input={input} visible={phase === "playing"} />
      {phase === "scored" && score && <ScoreCard score={score} onAgain={onAgain} onMenu={onMenu} />}
    </div>
  );
}
