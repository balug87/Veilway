import * as THREE from "three";
import type { Road } from "@/lib/osm/types";
import type { FogOfWar } from "./fog";

function longestMid(road: Road) {
  let best = 0;
  let ax = road.points[0]!;
  let bx = road.points[Math.min(1, road.points.length - 1)]!;
  for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1]!;
    const b = road.points[i]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len > best) {
      best = len;
      ax = a;
      bx = b;
    }
  }
  return { x: (ax.x + bx.x) / 2, z: (ax.z + bx.z) / 2, len: best };
}

function drawSign(text: string) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const padX = 28;
  const font = "600 42px 'IBM Plex Sans', system-ui, sans-serif";
  ctx.font = font;
  const tw = Math.ceil(ctx.measureText(text).width);
  canvas.width = Math.min(1024, tw + padX * 2);
  canvas.height = 96;
  ctx.font = font;
  ctx.fillStyle = "#141518";
  roundRect(ctx, 4, 12, canvas.width - 8, 72, 10);
  ctx.fill();
  ctx.strokeStyle = "#c5cdd6";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#ece7dc";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, 48, canvas.width - 36);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });
  const spr = new THREE.Sprite(mat);
  const worldW = Math.max(4.2, Math.min(9.5, text.length * 0.38));
  spr.scale.set(worldW, worldW * (canvas.height / canvas.width), 1);
  return spr;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function makeStreetLabels(roads: Road[]) {
  const group = new THREE.Group();
  const seen = new Set<string>();
  const sprites: { sprite: THREE.Sprite; x: number; z: number }[] = [];
  const named = roads.filter((r) => r.name);
  named.sort((a, b) => b.points.length - a.points.length);
  for (const road of named) {
    const name = road.name!;
    if (seen.has(name) && sprites.length > 40) continue;
    const mid = longestMid(road);
    if (mid.len < 18 && seen.has(name)) continue;
    seen.add(name);
    const spr = drawSign(name);
    spr.position.set(mid.x, 4.1, mid.z);
    spr.visible = false;
    group.add(spr);
    sprites.push({ sprite: spr, x: mid.x, z: mid.z });
    if (sprites.length >= 90) break;
  }
  return { group, sprites };
}

export function updateLabels(
  sprites: { sprite: THREE.Sprite; x: number; z: number }[],
  fog: FogOfWar,
  cam: THREE.Camera,
) {
  for (const s of sprites) {
    const vis = fog.sample(s.x, s.z);
    const dx = cam.position.x - s.x;
    const dz = cam.position.z - s.z;
    const dist = Math.hypot(dx, dz);
    s.sprite.visible = vis > 0.34 && dist < 62;
    const mat = s.sprite.material;
    mat.opacity =
      Math.max(0, Math.min(1, (vis - 0.28) * 1.8)) * (dist < 38 ? 1 : Math.max(0, 1 - (dist - 38) / 24));
  }
}
