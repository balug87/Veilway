import * as THREE from "three";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import type { Building, Road, TrafficLight } from "@/lib/osm/types";
import type { FogOfWar } from "./fog";

function ribbon(points: { x: number; z: number }[], width: number, y: number) {
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
    const px = -dz * hw;
    const pz = dx * hw;
    const p = points[i]!;
    left.push(new THREE.Vector3(p.x + px, y, p.z + pz));
    right.push(new THREE.Vector3(p.x - px, y, p.z - pz));
  }
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  let dist = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = left[i]!;
    const b = right[i]!;
    const c = left[i + 1]!;
    const d = right[i + 1]!;
    const seg = Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.z - points[i]!.z);
    const v0 = dist / 8;
    const v1 = (dist + seg) / 8;
    dist += seg;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, b.x, b.y, b.z, d.x, d.y, d.z, c.x, c.y, c.z);
    for (let n = 0; n < 6; n++) normals.push(0, 1, 0);
    uvs.push(0, v0, 1, v0, 0, v1, 1, v0, 1, v1, 0, v1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  return geo;
}

export function buildWorld(opts: {
  roads: Road[];
  buildings: Building[];
  lights: TrafficLight[];
  extent: number;
  fog: FogOfWar;
}) {
  const group = new THREE.Group();
  const { fog } = opts;

  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x121316,
    roughness: 1,
    metalness: 0,
  });
  fog.apply(groundMat);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(opts.extent * 1.4, opts.extent * 1.4), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const majorGeos: THREE.BufferGeometry[] = [];
  const minorGeos: THREE.BufferGeometry[] = [];
  for (const road of opts.roads) {
    if (road.points.length < 2) continue;
    const geo = ribbon(road.points, road.width, 0.05);
    const major = /motorway|trunk|primary|secondary/.test(road.highway);
    (major ? majorGeos : minorGeos).push(geo);
  }

  const roadMatMajor = new THREE.MeshStandardMaterial({
    color: 0x2c2e33,
    roughness: 0.86,
    metalness: 0,
  });
  const roadMatMinor = new THREE.MeshStandardMaterial({
    color: 0x26282c,
    roughness: 0.9,
    metalness: 0,
  });
  fog.apply(roadMatMajor);
  fog.apply(roadMatMinor);

  if (majorGeos.length) {
    const merged = BufferGeometryUtils.mergeGeometries(majorGeos, false);
    if (merged) {
      const mesh = new THREE.Mesh(merged, roadMatMajor);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    for (const g of majorGeos) g.dispose();
  }
  if (minorGeos.length) {
    const merged = BufferGeometryUtils.mergeGeometries(minorGeos, false);
    if (merged) {
      const mesh = new THREE.Mesh(merged, roadMatMinor);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    for (const g of minorGeos) g.dispose();
  }

  const bGeos: THREE.BufferGeometry[] = [];
  for (const b of opts.buildings) {
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    const geo = new THREE.BoxGeometry(w, b.height, d);
    geo.translate((b.minX + b.maxX) / 2, b.height / 2, (b.minZ + b.maxZ) / 2);
    bGeos.push(geo);
  }
  const bMat = new THREE.MeshStandardMaterial({
    color: 0x2c3038,
    roughness: 0.78,
    metalness: 0.08,
  });
  fog.apply(bMat);
  if (bGeos.length) {
    const merged = BufferGeometryUtils.mergeGeometries(bGeos, false);
    if (merged) {
      const mesh = new THREE.Mesh(merged, bMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    for (const g of bGeos) g.dispose();
  }

  const lampGeo = new THREE.CylinderGeometry(0.08, 0.1, 5.2, 6);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6 });
  const lampHeadGeo = new THREE.SphereGeometry(0.18, 8, 6);
  const lampHeadMat = new THREE.MeshStandardMaterial({
    color: 0xddd6c8,
    emissive: 0xcfc6b4,
    emissiveIntensity: 0.55,
  });
  const lampPos: THREE.Vector3[] = [];
  let lampCount = 0;
  for (const road of opts.roads) {
    let acc = 0;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!;
      const b = road.points[i]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      acc += len;
      if (acc > 46 && lampCount < 180) {
        acc = 0;
        lampPos.push(new THREE.Vector3(a.x, 0, a.z));
        lampCount++;
      }
    }
  }
  if (lampPos.length) {
    const poles = new THREE.InstancedMesh(lampGeo, lampMat, lampPos.length);
    const heads = new THREE.InstancedMesh(lampHeadGeo, lampHeadMat, lampPos.length);
    const dummy = new THREE.Object3D();
    lampPos.forEach((p, i) => {
      dummy.position.set(p.x, 2.6, p.z);
      dummy.updateMatrix();
      poles.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p.x, 5.15, p.z);
      dummy.updateMatrix();
      heads.setMatrixAt(i, dummy.matrix);
    });
    group.add(poles, heads);
  }

  const lightGroups: THREE.Group[] = [];
  for (const tl of opts.lights) {
    const g = makeSignal();
    g.position.set(tl.x, 0, tl.z);
    group.add(g);
    lightGroups.push(g);
  }

  return { group, lightGroups };
}

function makeSignal() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.12, 4.6, 6),
    new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.55 }),
  );
  pole.position.y = 2.3;
  g.add(pole);
  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.95, 0.22),
    new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.4 }),
  );
  housing.position.set(0.28, 4.15, 0);
  g.add(housing);
  const mk = (y: number, color: number) => {
    const m = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.2,
    });
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.09, 12), m);
    mesh.position.set(0.4, y, 0);
    mesh.rotation.y = Math.PI / 2;
    g.add(mesh);
    return m;
  };
  g.userData.red = mk(4.42, 0xc45c4a);
  g.userData.yellow = mk(4.15, 0xc4a574);
  g.userData.green = mk(3.88, 0x7d9a78);
  return g;
}

export function setSignal(group: THREE.Group, state: "red" | "yellow" | "green") {
  const red = group.userData.red as THREE.MeshStandardMaterial;
  const yellow = group.userData.yellow as THREE.MeshStandardMaterial;
  const green = group.userData.green as THREE.MeshStandardMaterial;
  red.emissiveIntensity = state === "red" ? 3.2 : 0.12;
  yellow.emissiveIntensity = state === "yellow" ? 2.4 : 0.12;
  green.emissiveIntensity = state === "green" ? 2.8 : 0.12;
}
