import { distPointSeg, hypot2 } from "./project";
import type { Road, Vec2 } from "./types";

type Node = { x: number; z: number; edges: number[] };

const SAMPLE = 16;

function key(x: number, z: number) {
  return `${Math.round(x * 4)}_${Math.round(z * 4)}`;
}

export function buildRoadGraph(roads: Road[]) {
  const nodes: Node[] = [];
  const index = new Map<string, number>();

  const intern = (x: number, z: number) => {
    const k = key(x, z);
    const existing = index.get(k);
    if (existing !== undefined) return existing;
    const id = nodes.length;
    nodes.push({ x, z, edges: [] });
    index.set(k, id);
    return id;
  };

  const link = (a: number, b: number) => {
    if (a === b) return;
    const na = nodes[a];
    const nb = nodes[b];
    if (!na || !nb) return;
    if (!na.edges.includes(b)) na.edges.push(b);
    if (!nb.edges.includes(a)) nb.edges.push(a);
  };

  for (const road of roads) {
    const pts = road.points;
    if (pts.length < 2) continue;
    let prev = intern(pts[0]!.x, pts[0]!.z);
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const len = hypot2(a.x, a.z, b.x, b.z);
      if (len < 0.4) continue;
      acc += len;
      const steps = Math.max(1, Math.floor(len / SAMPLE));
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const id = intern(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
        link(prev, id);
        prev = id;
      }
    }
  }

  return nodes;
}

export function nearestOnRoads(roads: Road[], x: number, z: number) {
  let best = { dist: Infinity, x, z, yaw: 0, name: null as string | null, width: 6, roadId: "" };
  for (const road of roads) {
    const pts = road.points;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const hit = distPointSeg(x, z, a.x, a.z, b.x, b.z);
      if (hit.dist < best.dist) {
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const yaw = Math.atan2(-dx, -dz);
        best = {
          dist: hit.dist,
          x: hit.x,
          z: hit.z,
          yaw,
          name: road.name,
          width: road.width,
          roadId: road.id,
        };
      }
    }
  }
  return best;
}

export function currentStreetName(roads: Road[], x: number, z: number, yaw: number) {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  let bestName: string | null = null;
  let bestScore = Infinity;
  for (const road of roads) {
    const pts = road.points;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const hit = distPointSeg(x, z, a.x, a.z, b.x, b.z);
      if (hit.dist > road.width * 0.5 + 2.4) continue;
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const align = 1 - Math.abs(dx * fx + dz * fz);
      const score = hit.dist + align * 4;
      if (score < bestScore) {
        bestScore = score;
        bestName = road.name;
      }
    }
  }
  return bestName;
}

export function intersectionLabel(roads: Road[], x: number, z: number) {
  const names: string[] = [];
  for (const road of roads) {
    if (!road.name || names.includes(road.name)) continue;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!;
      const b = road.points[i]!;
      if (distPointSeg(x, z, a.x, a.z, b.x, b.z).dist < 10) {
        names.push(road.name);
        break;
      }
    }
  }
  if (names.length >= 2) return names[0] + " & " + names[1];
  return names[0] ?? "the far corner";
}

function nearestNode(nodes: Node[], x: number, z: number) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    const d = hypot2(n.x, n.z, x, z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function shortestPath(roads: Road[], from: Vec2, to: Vec2): { meters: number; path: Vec2[] } {
  const nodes = buildRoadGraph(roads);
  if (nodes.length < 2) {
    const meters = hypot2(from.x, from.z, to.x, to.z);
    return { meters, path: [from, to] };
  }
  const start = nearestNode(nodes, from.x, from.z);
  const goal = nearestNode(nodes, to.x, to.z);
  const dist = new Float64Array(nodes.length).fill(Infinity);
  const prev = new Int32Array(nodes.length).fill(-1);
  dist[start] = 0;
  const heap: { i: number; g: number }[] = [{ i: start, g: 0 }];
  const heuristic = (i: number) => {
    const n = nodes[i]!;
    const g = nodes[goal]!;
    return hypot2(n.x, n.z, g.x, g.z);
  };

  while (heap.length) {
    let minAt = 0;
    for (let i = 1; i < heap.length; i++) {
      if (heap[i]!.g + heuristic(heap[i]!.i) < heap[minAt]!.g + heuristic(heap[minAt]!.i)) minAt = i;
    }
    const cur = heap.splice(minAt, 1)[0]!;
    if (cur.g !== dist[cur.i]) continue;
    if (cur.i === goal) break;
    const node = nodes[cur.i]!;
    for (const e of node.edges) {
      const other = nodes[e]!;
      const ng = cur.g + hypot2(node.x, node.z, other.x, other.z);
      if (ng < dist[e]!) {
        dist[e] = ng;
        prev[e] = cur.i;
        heap.push({ i: e, g: ng });
      }
    }
  }

  if (!Number.isFinite(dist[goal]!)) {
    const meters = hypot2(from.x, from.z, to.x, to.z);
    return { meters, path: [from, to] };
  }

  const path: Vec2[] = [];
  for (let i = goal; i !== -1; i = prev[i]!) {
    const n = nodes[i]!;
    path.push({ x: n.x, z: n.z });
    if (i === start) break;
  }
  path.reverse();
  if (path.length === 0) path.push(from, to);
  path[0] = from;
  path[path.length - 1] = to;
  return { meters: dist[goal]!, path };
}

export function pickRandomDest(roads: Road[], origin: Vec2, minM: number, maxM: number) {
  const named: { x: number; z: number; name: string }[] = [];
  const unnamed: { x: number; z: number; name: string }[] = [];
  for (const road of roads) {
    for (let i = 0; i < road.points.length; i += 2) {
      const p = road.points[i]!;
      const d = hypot2(origin.x, origin.z, p.x, p.z);
      if (d < minM || d > maxM) continue;
      const item = { x: p.x, z: p.z, name: road.name ?? "Unnamed road" };
      if (road.name) named.push(item);
      else unnamed.push(item);
    }
  }
  const pool = named.length ? named : unnamed;
  if (!pool.length) {
    for (const road of roads) {
      for (const p of road.points) {
        const d = hypot2(origin.x, origin.z, p.x, p.z);
        if (d > 80) unnamed.push({ x: p.x, z: p.z, name: road.name ?? "Unnamed road" });
      }
    }
  }
  const use = named.length ? named : unnamed;
  if (!use.length) return null;
  return use[Math.floor(Math.random() * use.length)]!;
}
