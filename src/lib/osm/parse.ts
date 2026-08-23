import { DRIVABLE, hash01, highwayWidth, project } from "./project";
import type { Building, LatLon, Road, TrafficLight } from "./types";

type OsmNode = { id: number; lat: number; lon: number; tags?: Record<string, string> };
type OsmWay = {
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  nodes?: number[];
};

export type ParsedMap = {
  roads: Road[];
  buildings: Building[];
  lights: TrafficLight[];
};

export function parseOverpass(json: { elements?: unknown[] }, origin: LatLon, extent: number): ParsedMap {
  const elements = (json.elements ?? []) as Array<OsmNode & OsmWay & { type: string }>;
  const nodeById = new Map<number, OsmNode>();
  for (const el of elements) {
    if (el.type === "node" && typeof el.lat === "number") {
      nodeById.set(el.id, el);
    }
  }
  const roads: Road[] = [];
  const buildings: Building[] = [];
  const lights: TrafficLight[] = [];
  const half = extent * 0.52;

  for (const el of elements) {
    if (el.type === "node" && el.tags?.highway === "traffic_signals") {
      const p = project(origin, el.lat, el.lon);
      if (Math.abs(p.x) > half || Math.abs(p.z) > half) continue;
      lights.push({ id: `n${el.id}`, x: p.x, z: p.z, phaseOffset: hash01(el.id) * 48 });
    }
    if (el.type !== "way" || !el.tags) continue;
    const pts = wayPoints(el, nodeById, origin);
    if (pts.length < 2) continue;
    const hw = el.tags.highway;
    if (hw && DRIVABLE.has(hw)) {
      roads.push({
        id: `w${el.id}`,
        name: el.tags.name ?? el.tags.ref ?? null,
        highway: hw,
        width: highwayWidth(hw),
        points: pts,
      });
    }
    if (el.tags.building && el.tags.building !== "no") {
      let minX = Infinity,
        maxX = -Infinity,
        minZ = Infinity,
        maxZ = -Infinity;
      for (const p of pts) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }
      const pad = 0.6;
      minX += pad;
      maxX -= pad;
      minZ += pad;
      maxZ -= pad;
      if (maxX - minX < 2.4 || maxZ - minZ < 2.4) continue;
      if (Math.abs((minX + maxX) / 2) > half || Math.abs((minZ + maxZ) / 2) > half) continue;
      const levels = Number.parseFloat(el.tags["building:levels"] ?? "");
      const heightTag = Number.parseFloat(el.tags.height ?? "");
      const height = Number.isFinite(heightTag)
        ? heightTag
        : Number.isFinite(levels)
          ? Math.max(3.2, levels * 3.1)
          : 8 + hash01(el.id) * 14;
      buildings.push({ id: `b${el.id}`, minX, maxX, minZ, maxZ, height: Math.min(height, 48) });
    }
  }

  buildings.sort((a, b) => b.maxX - b.minX + (b.maxZ - b.minZ) - (a.maxX - a.minX + (a.maxZ - a.minZ)));
  return {
    roads,
    buildings: buildings.slice(0, 520),
    lights: lights.slice(0, 80),
  };
}

function wayPoints(
  way: OsmWay,
  nodeById: Map<number, OsmNode>,
  origin: LatLon,
) {
  if (way.geometry && way.geometry.length) {
    return way.geometry.map((g) => project(origin, g.lat, g.lon));
  }
  if (way.nodes) {
    const pts = [];
    for (const id of way.nodes) {
      const n = nodeById.get(id);
      if (n) pts.push(project(origin, n.lat, n.lon));
    }
    return pts;
  }
  return [];
}

export function parseOsmXml(xml: string, origin: LatLon, extent: number): ParsedMap {
  const nodeRe = /<node\b([^>]*)\/?>/g;
  const nodeById = new Map<number, OsmNode>();
  let m: RegExpExecArray | null;
  while ((m = nodeRe.exec(xml))) {
    const attrs = m[1] ?? "";
    const id = Number(attr(attrs, "id"));
    const lat = Number(attr(attrs, "lat"));
    const lon = Number(attr(attrs, "lon"));
    if (!Number.isFinite(id) || !Number.isFinite(lat)) continue;
    nodeById.set(id, { id, lat, lon });
  }

  const wayRe = /<way\b([^>]*)>([\s\S]*?)<\/way>/g;
  const fake = { elements: [] as Array<Record<string, unknown>> };
  while ((m = wayRe.exec(xml))) {
    const id = Number(attr(m[1] ?? "", "id"));
    const body = m[2] ?? "";
    const nodes: number[] = [];
    const ndRe = /<nd\s+ref="(\d+)"/g;
    let n: RegExpExecArray | null;
    while ((n = ndRe.exec(body))) nodes.push(Number(n[1]));
    const tags: Record<string, string> = {};
    const tagRe = /<tag\s+k="([^"]*)"\s+v="([^"]*)"/g;
    while ((n = tagRe.exec(body))) tags[decodeXml(n[1] ?? "")] = decodeXml(n[2] ?? "");
    fake.elements.push({ type: "way", id, tags, nodes });
  }

  const standalone = /<node\b([^>]*)>([\s\S]*?)<\/node>/g;
  while ((m = standalone.exec(xml))) {
    const attrs = m[1] ?? "";
    const id = Number(attr(attrs, "id"));
    const lat = Number(attr(attrs, "lat"));
    const lon = Number(attr(attrs, "lon"));
    const tags: Record<string, string> = {};
    const tagRe = /<tag\s+k="([^"]*)"\s+v="([^"]*)"/g;
    let n: RegExpExecArray | null;
    while ((n = tagRe.exec(m[2] ?? ""))) tags[decodeXml(n[1] ?? "")] = decodeXml(n[2] ?? "");
    if (tags.highway === "traffic_signals") {
      fake.elements.push({ type: "node", id, lat, lon, tags });
    }
    const existing = nodeById.get(id);
    if (existing) existing.tags = tags;
  }

  return parseOverpass(fake as { elements?: unknown[] }, origin, extent);
}

function attr(s: string, name: string) {
  const m = s.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m?.[1] ?? "";
}

function decodeXml(s: string) {
  return s.replace(/&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (entity, name: string) => {
    const key = name.toLowerCase();
    if (key === "amp") return "&";
    if (key === "lt") return "<";
    if (key === "gt") return ">";
    if (key === "quot") return '"';
    if (key === "apos") return "'";
    if (key.startsWith("#x")) return String.fromCharCode(Number.parseInt(key.slice(2), 16));
    if (key.startsWith("#")) return String.fromCharCode(Number.parseInt(key.slice(1), 10));
    return entity;
  });
}
