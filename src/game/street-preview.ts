import * as THREE from "three";
import { distPointSeg, hypot2 } from "@/lib/osm/project";
import type { Road, Vec2 } from "@/lib/osm/types";

const SNAP = 16;
const CONNECT = 14;
const AHEAD = 380;
const BEHIND = 380;

type Hit = {
  road: Road;
  seg: number;
  t: number;
  x: number;
  z: number;
};

function nearestAligned(roads: Road[], x: number, z: number, yaw: number): Hit | null {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  let best: Hit | null = null;
  let bestScore = Infinity;
  for (const road of roads) {
    const pts = road.points;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const hit = distPointSeg(x, z, a.x, a.z, b.x, b.z);
      if (hit.dist > road.width * 0.5 + SNAP) continue;
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const align = Math.abs(dx * fx + dz * fz);
      const score = hit.dist + (1 - align) * 5;
      if (score < bestScore) {
        bestScore = score;
        best = { road, seg: i, t: hit.t, x: hit.x, z: hit.z };
      }
    }
  }
  return best;
}

function walkRoad(road: Road, seg: number, t: number, alongPoly: boolean, maxDist: number): { points: Vec2[]; traveled: number } {
  const pts = road.points;
  const out: Vec2[] = [];
  let traveled = 0;
  if (alongPoly) {
    const a = pts[seg - 1]!;
    const b = pts[seg]!;
    const cx = a.x + (b.x - a.x) * t;
    const cz = a.z + (b.z - a.z) * t;
    traveled += hypot2(cx, cz, b.x, b.z);
    out.push({ x: b.x, z: b.z });
    for (let i = seg + 1; i < pts.length && traveled < maxDist; i++) {
      const p = pts[i]!;
      const prev = pts[i - 1]!;
      traveled += hypot2(prev.x, prev.z, p.x, p.z);
      out.push({ x: p.x, z: p.z });
    }
  } else {
    const a = pts[seg - 1]!;
    const b = pts[seg]!;
    const cx = a.x + (b.x - a.x) * t;
    const cz = a.z + (b.z - a.z) * t;
    traveled += hypot2(cx, cz, a.x, a.z);
    out.push({ x: a.x, z: a.z });
    for (let i = seg - 2; i >= 0 && traveled < maxDist; i--) {
      const p = pts[i]!;
      const nxt = pts[i + 1]!;
      traveled += hypot2(nxt.x, nxt.z, p.x, p.z);
      out.push({ x: p.x, z: p.z });
    }
  }
  return { points: out, traveled };
}

function continuation(
  roads: Road[],
  from: Vec2,
  dirx: number,
  dirz: number,
  name: string | null,
  visited: Set<string>,
): { road: Road; alongPoly: boolean } | null {
  let best: { road: Road; alongPoly: boolean; score: number } | null = null;
  const nlen = Math.hypot(dirx, dirz) || 1;
  const ndx = dirx / nlen;
  const ndz = dirz / nlen;
  const minDot = name ? 0.38 : 0.78;
  for (const road of roads) {
    if (visited.has(road.id) || road.points.length < 2) continue;
    if (name && road.name && road.name !== name) continue;
    if (name && !road.name) continue;
    const first = road.points[0]!;
    const second = road.points[1]!;
    const last = road.points[road.points.length - 1]!;
    const prev = road.points[road.points.length - 2]!;
    const tryEnd = (end: Vec2, next: Vec2, alongPoly: boolean) => {
      const d = hypot2(from.x, from.z, end.x, end.z);
      if (d > CONNECT) return;
      let ox = next.x - end.x;
      let oz = next.z - end.z;
      const ol = Math.hypot(ox, oz) || 1;
      ox /= ol;
      oz /= ol;
      const dot = ox * ndx + oz * ndz;
      if (dot < minDot) return;
      const score = d + (1 - dot) * 8;
      if (!best || score < best.score) best = { road, alongPoly, score };
    };
    tryEnd(first, second, true);
    tryEnd(last, prev, false);
  }
  return best;
}

export function distToPolyline(points: Vec2[], x: number, z: number) {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const d = distPointSeg(x, z, a.x, a.z, b.x, b.z).dist;
    if (d < best) best = d;
  }
  return best;
}

export function collectStreetAhead(
  roads: Road[],
  x: number,
  z: number,
  yaw: number,
): { points: Vec2[]; width: number; name: string | null } {
  const hit = nearestAligned(roads, x, z, yaw);
  if (!hit) return { points: [], width: 6, name: null };

  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const a = hit.road.points[hit.seg - 1]!;
  const b = hit.road.points[hit.seg]!;
  const alongPoly = (b.x - a.x) * fx + (b.z - a.z) * fz >= 0;
  const visited = new Set<string>([hit.road.id]);

  const back = walkRoad(hit.road, hit.seg, hit.t, !alongPoly, BEHIND);
  const fwd = walkRoad(hit.road, hit.seg, hit.t, alongPoly, AHEAD);
  const points: Vec2[] = [...back.points.slice().reverse(), { x: hit.x, z: hit.z }, ...fwd.points];

  let traveled = fwd.traveled;
  while (traveled < AHEAD) {
    const last = points[points.length - 1]!;
    const prev = points[points.length - 2] ?? { x: hit.x, z: hit.z };
    const nxt = continuation(roads, last, last.x - prev.x, last.z - prev.z, hit.road.name, visited);
    if (!nxt) break;
    visited.add(nxt.road.id);
    const startSeg = nxt.alongPoly ? 1 : nxt.road.points.length - 1;
    const startT = nxt.alongPoly ? 0 : 1;
    const w = walkRoad(nxt.road, startSeg, startT, nxt.alongPoly, AHEAD - traveled);
    for (const p of w.points) points.push(p);
    traveled += Math.max(w.traveled, 0.01);
    if (w.points.length === 0) break;
  }

  const cleaned: Vec2[] = [];
  for (const p of points) {
    const last = cleaned[cleaned.length - 1];
    if (last && hypot2(last.x, last.z, p.x, p.z) < 0.35) continue;
    cleaned.push(p);
  }
  return { points: cleaned, width: hit.road.width, name: hit.road.name };
}

function offsetPoly(points: Vec2[], side: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(points.length - 1, i + 1)]!;
    let dx = next.x - prev.x;
    let dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const p = points[i]!;
    out.push({ x: p.x - dz * side, z: p.z + dx * side });
  }
  return out;
}

function ribbon(points: Vec2[], width: number, y: number) {
  const hw = width / 2;
  const left: THREE.Vector3[] = [];
  const right: THREE.Vector3[] = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(points.length - 1, i + 1)]!;
    let dx = next.x - prev.x;
    let dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const p = points[i]!;
    left.push(new THREE.Vector3(p.x - dz * hw, y, p.z + dx * hw));
    right.push(new THREE.Vector3(p.x + dz * hw, y, p.z - dx * hw));
  }
  const positions: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = left[i]!;
    const b = right[i]!;
    const c = left[i + 1]!;
    const d = right[i + 1]!;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, b.x, b.y, b.z, d.x, d.y, d.z, c.x, c.y, c.z);
    for (let n = 0; n < 6; n++) normals.push(0, 1, 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return geo;
}

function swapGeo(mesh: THREE.Mesh, geo: THREE.BufferGeometry) {
  const old = mesh.geometry;
  mesh.geometry = geo;
  old.dispose();
}

export type StreetPreview = {
  group: THREE.Group;
  fill: THREE.Mesh;
  glow: THREE.Mesh;
  center: THREE.Mesh;
  edgeL: THREE.Mesh;
  edgeR: THREE.Mesh;
};

export function createStreetPreview(): StreetPreview {
  const group = new THREE.Group();
  const fillMat = new THREE.MeshBasicMaterial({
    color: 0xf4efe4,
    fog: false,
    toneMapped: false,
    transparent: false,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xfff6e8,
    fog: false,
    toneMapped: false,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const centerMat = new THREE.MeshBasicMaterial({
    color: 0xfffbf2,
    fog: false,
    toneMapped: false,
    depthWrite: false,
  });
  const edgeMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    fog: false,
    toneMapped: false,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const fill = new THREE.Mesh(new THREE.BufferGeometry(), fillMat);
  const glow = new THREE.Mesh(new THREE.BufferGeometry(), glowMat);
  const center = new THREE.Mesh(new THREE.BufferGeometry(), centerMat);
  const edgeL = new THREE.Mesh(new THREE.BufferGeometry(), edgeMat);
  const edgeR = new THREE.Mesh(new THREE.BufferGeometry(), edgeMat.clone());
  fill.renderOrder = 2;
  glow.renderOrder = 3;
  center.renderOrder = 4;
  edgeL.renderOrder = 5;
  edgeR.renderOrder = 5;
  group.add(fill, glow, center, edgeL, edgeR);
  group.visible = false;
  return { group, fill, glow, center, edgeL, edgeR };
}

export function updateStreetPreview(preview: StreetPreview, points: Vec2[], width: number) {
  if (points.length < 2) {
    preview.group.visible = false;
    return;
  }
  preview.group.visible = true;
  const w = Math.max(5.2, width * 1.25);
  swapGeo(preview.fill, ribbon(points, w, 0.16));
  swapGeo(preview.glow, ribbon(points, w + 1.6, 0.14));
  swapGeo(preview.center, ribbon(points, 0.28, 0.21));
  const half = w * 0.5;
  swapGeo(preview.edgeL, ribbon(offsetPoly(points, half), 0.85, 0.22));
  swapGeo(preview.edgeR, ribbon(offsetPoly(points, -half), 0.85, 0.22));
}
