import { create } from "zustand";
import type { WorldData } from "@/lib/osm/types";

export type Phase = "menu" | "loading" | "playing" | "paused" | "scored";
export type LightKind = "none" | "red" | "yellow" | "green";

export type Score = {
  points: number;
  shortestM: number;
  drivenM: number;
  efficiency: number;
  redLights: number;
  streetsFound: number;
  destLabel: string;
  source: WorldData["source"];
};

export type Hud = {
  speedKmh: number;
  street: string;
  destLabel: string;
  destDist: number;
  light: LightKind;
  headingDeg: number;
  revealed: number;
};

type Session = {
  phase: Phase;
  loadingText: string;
  error: string | null;
  hud: Hud;
  score: Score | null;
  setPhase: (phase: Phase) => void;
  setLoading: (text: string) => void;
  setError: (error: string | null) => void;
  setHud: (hud: Partial<Hud>) => void;
  setScore: (score: Score) => void;
  resetToMenu: () => void;
};

const idleHud: Hud = {
  speedKmh: 0,
  street: "",
  destLabel: "",
  destDist: 0,
  light: "none",
  headingDeg: 0,
  revealed: 0,
};

export const useSession = create<Session>((set) => ({
  phase: "menu",
  loadingText: "",
  error: null,
  hud: idleHud,
  score: null,
  setPhase: (phase) => set({ phase }),
  setLoading: (loadingText) => set({ phase: "loading", loadingText, error: null }),
  setError: (error) => set({ error, phase: "menu" }),
  setHud: (hud) => set((s) => ({ hud: { ...s.hud, ...hud } })),
  setScore: (score) => set({ score, phase: "scored" }),
  resetToMenu: () => set({ phase: "menu", error: null, score: null, hud: idleHud, loadingText: "" }),
}));
