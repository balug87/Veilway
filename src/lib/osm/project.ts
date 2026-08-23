import type { LatLon, Vec2 } from "./types";

export const METERS_PER_DEG_LAT = 111_320;

export function metersPerDegLon(lat: number) {
  return METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

export function project(origin: LatLon, lat: number, lon: number): Vec2 {
  const x = (lon - origin.lon) * metersPerDegLon(origin.lat);
  const z = (origin.lat - lat) * METERS_PER_DEG_LAT;
  return { x, z };
}

export function unproject(origin: LatLon, x: number, z: number): LatLon {
  const lat = origin.lat - z / METERS_PER_DEG_LAT;
  const lon = origin.lon + x / metersPerDegLon(origin.lat);
  return { lat, lon };
}

export function bboxFromRadius(origin: LatLon, radiusM: number) {
  const dLat = radiusM / METERS_PER_DEG_LAT;
  const dLon = radiusM / metersPerDegLon(origin.lat);
  return {
    south: origin.lat - dLat,
    north: origin.lat + dLat,
    west: origin.lon - dLon,
    east: origin.lon + dLon,
  };
}

export function hypot2(ax: number, az: number, bx: number, bz: number) {
  return Math.hypot(ax - bx, az - bz);
}

export function distPointSeg(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { dist: number; t: number; x: number; z: number } {
  const abx = bx - ax;
  const abz = bz - az;
  const denom = abx * abx + abz * abz;
  const t = denom < 1e-8 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / denom));
  const x = ax + abx * t;
  const z = az + abz * t;
  return { dist: Math.hypot(px - x, pz - z), t, x, z };
}

export function hash01(n: number) {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

export function highwayWidth(highway: string) {
  switch (highway) {
    case "motorway":
    case "motorway_link":
      return 14;
    case "trunk":
    case "trunk_link":
      return 11;
    case "primary":
    case "primary_link":
      return 10;
    case "secondary":
    case "secondary_link":
      return 8.5;
    case "tertiary":
    case "tertiary_link":
      return 7.4;
    case "unclassified":
      return 6.6;
    case "residential":
      return 6.2;
    case "living_street":
      return 5.6;
    default:
      return 5.2;
  }
}

export const DRIVABLE = new Set([
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
  "unclassified",
  "residential",
  "living_street",
]);
