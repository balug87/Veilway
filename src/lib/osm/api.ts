import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { nearestOnRoads, pickRandomDest, shortestPath } from "./pathfind";
import { parseOsmXml, parseOverpass } from "./parse";
import { bboxFromRadius, hypot2, project, unproject } from "./project";
import type { LatLon, PlaceHit, WorldData } from "./types";

const UA = "Veilway/1.0 (educational wayfinding trainer; https://grok.me)";

async function fetchText(url: string, init: RequestInit, timeoutMs: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { "user-agent": UA, ...(init.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const text = await fetchText(url, init, timeoutMs);
  return JSON.parse(text) as T;
}

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    street?: string;
    city?: string;
    town?: string;
    district?: string;
    state?: string;
    country?: string;
    osm_value?: string;
  };
};

function formatPlace(f: PhotonFeature): PlaceHit {
  const p = f.properties;
  const city = p.city ?? p.town ?? p.district ?? "";
  const bits = [p.name, p.street, city, p.state, p.country].filter(Boolean);
  const label = p.name ?? p.street ?? city ?? "Place";
  const context = bits.filter((b) => b !== label).join(", ");
  return { label, context, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] };
}

async function geocode(query: string): Promise<PlaceHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const data = await fetchJson<{ features?: PhotonFeature[] }>(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6`,
      {},
      8000,
    );
    return (data.features ?? []).map(formatPlace);
  } catch {
    const data = await fetchJson<
      Array<{ display_name: string; lat: string; lon: string; name?: string }>
    >(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`,
      {},
      9000,
    );
    return data.map((d) => ({
      label: d.name || d.display_name.split(",")[0] || "Place",
      context: d.display_name,
      lat: Number(d.lat),
      lon: Number(d.lon),
    }));
  }
}

async function reverseGeocode(lat: number, lon: number) {
  try {
    const data = await fetchJson<{ features?: PhotonFeature[] }>(
      `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}`,
      {},
      7000,
    );
    const f = data.features?.[0];
    if (!f) return "Destination";
    const p = f.properties;
    return p.street ? `${p.street}${p.name ? ` · ${p.name}` : ""}` : (p.name ?? "Destination");
  } catch {
    return "Destination";
  }
}

const OVERPASS_MIRRORS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
];

async function fetchStreets(origin: LatLon, radiusM: number) {
  const b = bboxFromRadius(origin, radiusM);
  const bbox = `${b.south},${b.west},${b.north},${b.east}`;
  const query = `[out:json][timeout:22];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street)$"](${bbox});
  way["building"](${bbox});
  node["highway"="traffic_signals"](${bbox});
);
out geom;`;
  const body = new URLSearchParams({ data: query }).toString();
  let lastErr: unknown;
  for (const url of OVERPASS_MIRRORS) {
    try {
      const json = await fetchJson<{ elements?: unknown[] }>(
        url,
        { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body },
        20000,
      );
      const parsed = parseOverpass(json, origin, radiusM * 2);
      if (parsed.roads.length >= 4) return parsed;
      lastErr = new Error("sparse overpass");
    } catch (err) {
      lastErr = err;
    }
  }

  const osmBbox = `${b.west},${b.south},${b.east},${b.north}`;
  const xml = await fetchText(
    `https://api.openstreetmap.org/api/0.6/map?bbox=${osmBbox}`,
    {},
    22000,
  );
  const parsed = parseOsmXml(xml, origin, radiusM * 2);
  if (parsed.roads.length < 4) {
    throw new Error(
      lastErr instanceof Error
        ? `Not enough streets here to drive. Try a denser neighborhood.`
        : "Not enough streets here to drive.",
    );
  }
  return parsed;
}

type OsrmRoute = { routes?: { distance: number; geometry: { coordinates: [number, number][] } }[] };

async function osrmRoute(a: LatLon, b: LatLon) {
  const url = `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`;
  const data = await fetchJson<OsrmRoute>(url, {}, 10000);
  const route = data.routes?.[0];
  if (!route) throw new Error("no route");
  return route;
}

export const searchPlaces = createServerFn({ method: "POST" })
  .validator(z.object({ query: z.string().min(2).max(140) }))
  .handler(async ({ data }) => geocode(data.query));

export const buildTrip = createServerFn({ method: "POST" })
  .validator(
    z.object({
      startQuery: z.string().min(2).max(140),
      destMode: z.enum(["random", "address"]),
      destQuery: z.string().max(140).optional().default(""),
      randomMeters: z.number().min(200).max(1400),
    }),
  )
  .handler(async ({ data }): Promise<WorldData> => {
    const starts = await geocode(data.startQuery);
    const startHit = starts[0];
    if (!startHit) throw new Error("Could not find that starting place.");
    const origin: LatLon = { lat: startHit.lat, lon: startHit.lon };

    let destLatLon: LatLon | null = null;
    let destLabel: string | null = null;
    if (data.destMode === "address") {
      const q = data.destQuery.trim();
      if (q.length < 2) throw new Error("Enter a destination, or switch to a random one.");
      const dests = await geocode(q);
      const d = dests[0];
      if (!d) throw new Error("Could not find that destination.");
      destLatLon = { lat: d.lat, lon: d.lon };
      destLabel = d.label;
      const span = hypot2(
        0,
        0,
        project(origin, d.lat, d.lon).x,
        project(origin, d.lat, d.lon).z,
      );
      if (span > 1500) {
        throw new Error("That destination is farther than 1.5 km. Pick somewhere closer.");
      }
    }

    const cover = destLatLon
      ? Math.min(1500, hypot2(0, 0, project(origin, destLatLon.lat, destLatLon.lon).x, project(origin, destLatLon.lat, destLatLon.lon).z) + 220)
      : Math.min(1400, data.randomMeters + 260);
    const radius = Math.max(420, cover);
    const parsed = await fetchStreets(origin, radius);
    const startSnap = nearestOnRoads(parsed.roads, 0, 0);

    let destSnap = startSnap;
    if (destLatLon) {
      const p = project(origin, destLatLon.lat, destLatLon.lon);
      destSnap = nearestOnRoads(parsed.roads, p.x, p.z);
    } else {
      const picked = pickRandomDest(
        parsed.roads,
        startSnap,
        data.randomMeters * 0.62,
        data.randomMeters,
      );
      if (!picked) throw new Error("Could not place a destination in that radius. Try a larger distance.");
      destSnap = nearestOnRoads(parsed.roads, picked.x, picked.z);
      destLabel = destSnap.name ?? picked.name;
    }

    if (hypot2(startSnap.x, startSnap.z, destSnap.x, destSnap.z) < 90) {
      const picked = pickRandomDest(parsed.roads, startSnap, 220, Math.max(320, data.randomMeters));
      if (picked) destSnap = nearestOnRoads(parsed.roads, picked.x, picked.z);
    }

    const graphRoute = shortestPath(parsed.roads, startSnap, destSnap);
    let shortestMeters = graphRoute.meters;
    let shortestPathPts = graphRoute.path;
    try {
      const a = unproject(origin, startSnap.x, startSnap.z);
      const b = unproject(origin, destSnap.x, destSnap.z);
      const osrm = await osrmRoute(a, b);
      shortestMeters = osrm.distance;
      shortestPathPts = osrm.geometry.coordinates.map(([lon, lat]) => project(origin, lat, lon));
    } catch {
      // keep graph route
    }

    if (!destLabel || destLabel === "Unnamed road") {
      const ll = unproject(origin, destSnap.x, destSnap.z);
      destLabel = await reverseGeocode(ll.lat, ll.lon);
    }

    let yaw = startSnap.yaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    if (fx * (destSnap.x - startSnap.x) + fz * (destSnap.z - startSnap.z) < 0) yaw += Math.PI;

    return {
      origin,
      extent: radius * 2 + 40,
      roads: parsed.roads,
      buildings: parsed.buildings,
      lights: parsed.lights,
      start: { x: startSnap.x, z: startSnap.z, yaw },
      dest: { x: destSnap.x, z: destSnap.z, label: destLabel || "Destination" },
      shortestMeters,
      shortestPath: shortestPathPts,
      source: "osm",
    };
  });
