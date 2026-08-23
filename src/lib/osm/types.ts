export type LatLon = { lat: number; lon: number };

export type Vec2 = { x: number; z: number };

export type Road = {
  id: string;
  name: string | null;
  highway: string;
  width: number;
  points: Vec2[];
};

export type Building = {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
};

export type TrafficLight = {
  id: string;
  x: number;
  z: number;
  phaseOffset: number;
};

export type PlaceHit = {
  label: string;
  lat: number;
  lon: number;
  context: string;
};

export type WorldData = {
  origin: LatLon;
  extent: number;
  roads: Road[];
  buildings: Building[];
  lights: TrafficLight[];
  start: { x: number; z: number; yaw: number };
  dest: { x: number; z: number; label: string };
  shortestMeters: number;
  shortestPath: Vec2[];
  source: "osm" | "practice";
};

export type TripRequest = {
  startQuery: string;
  destMode: "random" | "address";
  destQuery: string;
  randomMeters: number;
};
