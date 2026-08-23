import { hash01 } from "./project";
import { intersectionLabel, nearestOnRoads, pickRandomDest, shortestPath } from "./pathfind";
import type { Building, Road, TrafficLight, WorldData } from "./types";

const EW = ["Cedar", "Maple", "Pine", "Oak", "Elm"];
const NS = ["1st", "2nd", "3rd", "4th", "5th"];
const BLOCK = 72;
const N = 5;

export function makePracticeWorld(randomMeters = 420): WorldData {
  const roads: Road[] = [];
  const buildings: Building[] = [];
  const lights: TrafficLight[] = [];
  const originOffset = ((N - 1) * BLOCK) / 2;

  for (let i = 0; i < N; i++) {
    const z = i * BLOCK - originOffset;
    const pts = [];
    for (let j = 0; j < N; j++) pts.push({ x: j * BLOCK - originOffset, z });
    roads.push({
      id: `ew-${i}`,
      name: `${EW[i]} Street`,
      highway: i === 2 ? "secondary" : "residential",
      width: i === 2 ? 8.5 : 6.2,
      points: pts,
    });
  }
  for (let j = 0; j < N; j++) {
    const x = j * BLOCK - originOffset;
    const pts = [];
    for (let i = 0; i < N; i++) pts.push({ x, z: i * BLOCK - originOffset });
    roads.push({
      id: `ns-${j}`,
      name: `${NS[j]} Avenue`,
      highway: j === 2 ? "secondary" : "residential",
      width: j === 2 ? 8.5 : 6.2,
      points: pts,
    });
  }

  // A diagonal promenade so the grid isn't a perfect cheat-sheet
  roads.push({
    id: "promenade",
    name: "Harbor Promenade",
    highway: "tertiary",
    width: 7.4,
    points: [
      { x: -originOffset, z: originOffset },
      { x: originOffset, z: -originOffset },
    ],
  });

  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < N - 1; j++) {
      if (i === 2 && j === 2) continue; // park
      const cx = (j + 0.5) * BLOCK - originOffset;
      const cz = (i + 0.5) * BLOCK - originOffset;
      const inset = 11;
      const minX = cx - BLOCK / 2 + inset;
      const maxX = cx + BLOCK / 2 - inset;
      const minZ = cz - BLOCK / 2 + inset;
      const maxZ = cz + BLOCK / 2 - inset;
      const h = 7 + hash01(i * 17 + j) * 16;
      buildings.push({
        id: `blk-${i}-${j}`,
        minX,
        maxX,
        minZ,
        maxZ,
        height: h,
      });
    }
  }

  const intersections = [
    [1, 1],
    [1, 3],
    [2, 2],
    [3, 1],
    [3, 3],
  ];
  for (const [i, j] of intersections) {
    lights.push({
      id: `tl-${i}-${j}`,
      x: j * BLOCK - originOffset,
      z: i * BLOCK - originOffset,
      phaseOffset: hash01(i * 10 + j) * 40,
    });
  }

  const startRaw = { x: 1 * BLOCK - originOffset, z: 1 * BLOCK - originOffset };
  const startHit = nearestOnRoads(roads, startRaw.x, startRaw.z);
  const picked =
    pickRandomDest(roads, startHit, Math.max(180, randomMeters * 0.65), randomMeters + 40) ??
    nearestOnRoads(roads, originOffset, -originOffset);
  const destHit = nearestOnRoads(roads, picked.x, picked.z);
  let yaw = startHit.yaw;
  const toDestX = destHit.x - startHit.x;
  const toDestZ = destHit.z - startHit.z;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  if (fx * toDestX + fz * toDestZ < 0) yaw += Math.PI;

  const route = shortestPath(roads, startHit, destHit);
  const destName = intersectionLabel(roads, destHit.x, destHit.z);

  return {
    origin: { lat: 51.5117, lon: -0.1227 },
    extent: N * BLOCK + 80,
    roads,
    buildings,
    lights,
    start: { x: startHit.x, z: startHit.z, yaw },
    dest: { x: destHit.x, z: destHit.z, label: destName },
    shortestMeters: route.meters,
    shortestPath: route.path,
    source: "practice",
  };
}
