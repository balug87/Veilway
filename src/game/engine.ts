import * as THREE from "three";
import { currentStreetName, nearestOnRoads } from "@/lib/osm/pathfind";
import type { Building, Vec2, WorldData } from "@/lib/osm/types";
import { useSession, type LightKind, type Score } from "@/store/session";
import { EngineAudio } from "./audio";
import { makeCar } from "./car-mesh";
import { FogOfWar } from "./fog";
import { Input } from "./input";
import { makeStreetLabels, updateLabels } from "./labels";
import { collectStreetAhead, createStreetPreview, distToPolyline, updateStreetPreview, type StreetPreview } from "./street-preview";
import { buildWorld, setSignal } from "./world-mesh";

const FIXED = 1 / 60;
const MAX_SPEED = 13.8;
const ACCEL = 8.4;
const BRAKE = 18;
const REVERSE_MAX = -4.8;
const TURN_RATE = 2.2;
const CAR_RADIUS = 1.15;
const ARRIVE = 18;
const FOG_RADIUS = 54;
const CYCLE = 34;
const LIGHT_SEE = 88;

export type ControlsProbe = {
  getYaw: () => number;
  getSpeed: () => number;
  setSteer?: (v: number) => void;
  setKeys?: (codes: string[]) => void;
};

declare global {
  interface Window {
    __controlsTest?: ControlsProbe;
  }
}

function lightState(offset: number, t: number): Exclude<LightKind, "none"> {
  const p = ((t + offset) % CYCLE + CYCLE) % CYCLE;
  if (p < 13) return "green";
  if (p < 16.2) return "yellow";
  return "red";
}

export class GameEngine {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  readonly input: Input;
  private fog: FogOfWar;
  private audio = new EngineAudio();
  private carMesh: THREE.Group;
  private world: WorldData;
  private buildings: Building[];
  private lightGroups: THREE.Group[];
  private lampPos: THREE.Vector3[] = [];
  private curbLamps: THREE.PointLight[] = [];
  private labels: ReturnType<typeof makeStreetLabels>;
  private destMarker: THREE.Group;
  private preview: StreetPreview;
  private previewPts: Vec2[] = [];
  private previewAcc = 0;
  private previewKey = "";
  private playerLine: THREE.Line | null = null;
  private bestLine: THREE.Line | null = null;
  private clock = new THREE.Clock();
  private acc = 0;
  private running = false;
  private disposed = false;
  private yaw: number;
  private x: number;
  private z: number;
  private speed = 0;
  private driven = 0;
  private path: THREE.Vector3[] = [];
  private lastPath = new THREE.Vector3();
  private streets = new Set<string>();
  private reds = 0;
  private redFlagged = new Set<string>();
  private simTime = 0;
  private hudT = 0;
  private arrivedHold = 0;
  private finished = false;
  private camPos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private desiredCam = new THREE.Vector3();
  private minimap: HTMLCanvasElement | null;
  private onResize: () => void;
  private onKey: (e: KeyboardEvent) => void;

  constructor(canvas: HTMLCanvasElement, world: WorldData, minimap: HTMLCanvasElement | null) {
    this.world = world;
    this.buildings = world.buildings;
    this.minimap = minimap;
    this.x = world.start.x;
    this.z = world.start.z;
    this.yaw = world.start.yaw;
    this.lastPath.set(this.x, 0.2, this.z);
    this.path.push(this.lastPath.clone());

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0b0d);
    this.scene.fog = new THREE.Fog(0x0a0b0d, 150, 320);

    this.camera = new THREE.PerspectiveCamera(58, canvas.clientWidth / Math.max(1, canvas.clientHeight), 0.15, 340);
    this.camPos.set(this.x, 5.4, this.z + 12);
    this.camera.position.copy(this.camPos);

    this.scene.add(new THREE.HemisphereLight(0xc5cdd6, 0x1a1c20, 0.85));
    const moon = new THREE.DirectionalLight(0xe4e8ee, 0.8);
    moon.position.set(-40, 70, 20);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.near = 10;
    moon.shadow.camera.far = 160;
    moon.shadow.camera.left = -60;
    moon.shadow.camera.right = 60;
    moon.shadow.camera.top = 60;
    moon.shadow.camera.bottom = -60;
    this.scene.add(moon);

    this.fog = new FogOfWar(0, 0, world.extent, 512);
    const built = buildWorld({
      roads: world.roads,
      buildings: world.buildings,
      lights: world.lights,
      extent: world.extent,
      fog: this.fog,
    });
    this.scene.add(built.group);
    this.lightGroups = built.lightGroups;
    this.lampPos = built.lampPos;
    for (let i = 0; i < 4; i++) {
      const pl = new THREE.PointLight(0xffe2b0, 0, 22, 1.7);
      this.scene.add(pl);
      this.curbLamps.push(pl);
    }

    this.preview = createStreetPreview();
    this.scene.add(this.preview.group);

    this.labels = makeStreetLabels(world.roads);
    this.scene.add(this.labels.group);

    this.carMesh = makeCar();
    this.carMesh.position.set(this.x, 0, this.z);
    this.carMesh.rotation.y = this.yaw;
    this.scene.add(this.carMesh);

    const headL = new THREE.SpotLight(0xfff6e4, 48, 78, 0.48, 0.38, 0.85);
    headL.position.set(-0.5, 0.72, -1.6);
    headL.target.position.set(-0.5, 0.12, -24);
    const headR = headL.clone();
    headR.position.x = 0.5;
    headR.target.position.x = 0.5;
    this.carMesh.add(headL, headL.target, headR, headR.target);

    this.destMarker = this.makeDest();
    this.destMarker.position.set(world.dest.x, 0, world.dest.z);
    this.destMarker.visible = false;
    this.scene.add(this.destMarker);

    this.input = new Input(canvas);
    this.fog.stamp(this.x, this.z, FOG_RADIUS);
    this.refreshPreview();

    this.onResize = () => this.resize();
    this.onKey = (e) => {
      if (e.code === "Escape" || e.code === "KeyP") {
        const phase = useSession.getState().phase;
        if (phase === "playing") useSession.getState().setPhase("paused");
        else if (phase === "paused") useSession.getState().setPhase("playing");
      }
    };
    window.addEventListener("resize", this.onResize);
    window.addEventListener("keydown", this.onKey);

    window.__controlsTest = {
      getYaw: () => this.yaw,
      getSpeed: () => this.speed,
      setSteer: (v) => {
        this.input.injectSteer = v;
      },
      setKeys: (codes) => {
        this.input.keys = new Set(codes);
        this.input.injectSteer = null;
        this.input.injectThrottle = codes.includes("KeyW") || codes.includes("ArrowUp") ? 1 : this.input.injectThrottle;
      },
    };

    useSession.getState().setHud({
      destLabel: world.dest.label,
      street: nearestOnRoads(world.roads, this.x, this.z).name ?? "Unnamed road",
      destDist: Math.hypot(world.dest.x - this.x, world.dest.z - this.z),
    });
  }

  private makeDest() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 3.6, 6),
      new THREE.MeshStandardMaterial({ color: 0xc5cdd6, roughness: 0.4, metalness: 0.3 }),
    );
    pole.position.y = 1.8;
    g.add(pole);
    const beacon = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.55),
      new THREE.MeshStandardMaterial({
        color: 0xece7dc,
        emissive: 0xece7dc,
        emissiveIntensity: 1.4,
      }),
    );
    beacon.position.y = 3.8;
    g.add(beacon);
    g.userData.beacon = beacon;
    return g;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.audio.unlock();
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private resize() {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth;
    const h = Math.max(1, canvas.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  private frame() {
    if (this.disposed) return;
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const phase = useSession.getState().phase;
    if (phase === "paused" || phase === "scored") {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (phase !== "playing") return;

    this.acc += dt;
    let steps = 0;
    while (this.acc >= FIXED && steps < 5) {
      this.step(FIXED);
      this.acc -= FIXED;
      steps++;
    }
    this.visuals(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private refreshPreview() {
    const ahead = collectStreetAhead(this.world.roads, this.x, this.z, this.yaw);
    this.previewPts = ahead.points;
    updateStreetPreview(this.preview, ahead.points, ahead.width);
    const punches: { x: number; z: number; r: number }[] = [];
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    for (const light of this.world.lights) {
      const dx = light.x - this.x;
      const dz = light.z - this.z;
      const dist = Math.hypot(dx, dz);
      if (dist > LIGHT_SEE) continue;
      const aheadDot = (dx * fx + dz * fz) / Math.max(dist, 0.01);
      const onLane = this.previewPts.length > 1 && distToPolyline(this.previewPts, light.x, light.z) < 14;
      if ((aheadDot > 0.18 && onLane) || dist < 22) {
        punches.push({ x: light.x, z: light.z, r: dist < 28 ? 14 : 10 });
      }
    }
    this.fog.setLane(ahead.points, ahead.width, punches);
    const key = `${ahead.name ?? ""}:${ahead.points.length}:${ahead.points[0]?.x ?? 0}:${ahead.points[0]?.z ?? 0}`;
    if (key !== this.previewKey) {
      this.previewKey = key;
      this.fog.revealCorridor(ahead.points, ahead.width);
    }
    if (typeof window !== "undefined") {
      (window as Window & { __laneDebug?: { n: number; name: string | null } }).__laneDebug = {
        n: ahead.points.length,
        name: ahead.name,
      };
    }
  }

  private step(dt: number) {
    if (this.finished) return;
    this.simTime += dt;
    const a = this.input.sample();
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);

    const onRoad = nearestOnRoads(this.world.roads, this.x, this.z);
    const off = onRoad.dist > onRoad.width * 0.5 + 1.15;
    const maxSpeed = off ? 4.2 : MAX_SPEED;
    const drag = off ? 2.4 : 0.55;

    let cap = maxSpeed;
    let nearestLight: LightKind = "none";
    let nearestD = LIGHT_SEE;
    for (const light of this.world.lights) {
      const lx = light.x - this.x;
      const lz = light.z - this.z;
      const dist = Math.hypot(lx, lz);
      if (dist > LIGHT_SEE) continue;
      const ahead = (lx * fx + lz * fz) / Math.max(dist, 0.01);
      const state = lightState(light.phaseOffset, this.simTime);
      const onLane = this.previewPts.length > 1 && distToPolyline(this.previewPts, light.x, light.z) < 16;
      if (ahead > 0.35 && dist < nearestD && (onLane || dist < 28)) {
        nearestD = dist;
        nearestLight = state;
      }
      if (state === "red" && ahead > 0.5 && dist < 16 && dist > 3.2) {
        cap = Math.min(cap, Math.max(0, ((dist - 3.2) / 12.8) * 7));
      }
      if (state === "red" && dist < 4.6 && Math.abs(this.speed) > 3.4 && ahead > 0.15 && !this.redFlagged.has(light.id)) {
        this.redFlagged.add(light.id);
        this.reds += 1;
      }
    }

    if (a.brake > 0.1) {
      const sign = Math.sign(this.speed) || 1;
      this.speed -= sign * BRAKE * a.brake * dt;
      if (Math.sign(this.speed) !== sign) this.speed = 0;
    } else if (a.throttle > 0.05) {
      this.speed += a.throttle * ACCEL * dt;
    } else if (a.throttle < -0.05) {
      this.speed += a.throttle * ACCEL * 0.7 * dt;
    } else {
      this.speed *= Math.max(0, 1 - drag * dt * 1.8);
    }
    this.speed *= Math.max(0, 1 - drag * dt);
    this.speed = Math.max(REVERSE_MAX, Math.min(cap, this.speed));

    const speedFactor = Math.max(0, Math.min(1, Math.abs(this.speed) / 3.6)) * (1 - 0.32 * Math.min(1, Math.abs(this.speed) / MAX_SPEED));
    const reverse = this.speed >= 0 ? 1 : -1;
    this.yaw += a.steer * TURN_RATE * speedFactor * reverse * dt;

    const nfx = -Math.sin(this.yaw);
    const nfz = -Math.cos(this.yaw);
    let nx = this.x + nfx * this.speed * dt;
    let nz = this.z + nfz * this.speed * dt;
    const pushed = this.collide(nx, nz);
    nx = pushed.x;
    nz = pushed.z;
    const stepDist = Math.hypot(nx - this.x, nz - this.z);
    this.driven += stepDist;
    this.x = nx;
    this.z = nz;

    if (onRoad.name) this.streets.add(onRoad.name);

    if (Math.hypot(this.x - this.lastPath.x, this.z - this.lastPath.z) > 3.4) {
      this.lastPath.set(this.x, 0.2, this.z);
      this.path.push(this.lastPath.clone());
    }

    this.fog.stamp(this.x, this.z, FOG_RADIUS);
    this.previewAcc += dt;
    if (this.previewAcc > 0.1) {
      this.previewAcc = 0;
      this.refreshPreview();
    }

    const destDist = Math.hypot(this.world.dest.x - this.x, this.world.dest.z - this.z);
    if (destDist < ARRIVE) {
      this.arrivedHold += dt;
      if (this.arrivedHold > 0.35) this.finish();
    } else {
      this.arrivedHold = 0;
    }

    this.hudT += dt;
    if (this.hudT > 0.12) {
      this.hudT = 0;
      const heading = ((-this.yaw * 180) / Math.PI + 3600) % 360;
      useSession.getState().setHud({
        speedKmh: Math.abs(this.speed) * 3.6,
        street: currentStreetName(this.world.roads, this.x, this.z, this.yaw) ?? (off ? "Off the pavement" : "Unnamed road"),
        destLabel: this.world.dest.label,
        destDist,
        light: nearestLight,
        headingDeg: heading,
        revealed: this.fog.revealed,
      });
    }
  }

  private collide(x: number, z: number) {
    let px = x;
    let pz = z;
    for (const b of this.buildings) {
      const cx = Math.max(b.minX, Math.min(px, b.maxX));
      const cz = Math.max(b.minZ, Math.min(pz, b.maxZ));
      const dx = px - cx;
      const dz = pz - cz;
      const d = Math.hypot(dx, dz);
      if (d < CAR_RADIUS && d > 1e-5) {
        const push = (CAR_RADIUS - d) / d;
        px += dx * push;
        pz += dz * push;
        this.speed *= 0.55;
      } else if (d <= 1e-5) {
        const left = px - b.minX + CAR_RADIUS;
        const right = b.maxX - px + CAR_RADIUS;
        const top = pz - b.minZ + CAR_RADIUS;
        const bot = b.maxZ - pz + CAR_RADIUS;
        const m = Math.min(left, right, top, bot);
        if (m === left) px = b.minX - CAR_RADIUS;
        else if (m === right) px = b.maxX + CAR_RADIUS;
        else if (m === top) pz = b.minZ - CAR_RADIUS;
        else pz = b.maxZ + CAR_RADIUS;
        this.speed *= 0.4;
      }
    }
    const half = this.world.extent * 0.48;
    px = Math.max(-half, Math.min(half, px));
    pz = Math.max(-half, Math.min(half, pz));
    return { x: px, z: pz };
  }

  private visuals(dt: number) {
    this.carMesh.position.set(this.x, 0, this.z);
    this.carMesh.rotation.y = this.yaw;
    const wheels = this.carMesh.userData.wheels as THREE.Mesh[] | undefined;
    if (wheels) {
      const spin = (this.speed * dt) / 0.32;
      for (const w of wheels) w.rotation.x += spin;
    }
    const front = this.carMesh.userData.frontWheels as THREE.Mesh[] | undefined;
    const steer = this.input.sample().steer;
    if (front) {
      for (const w of front) w.rotation.y = steer * 0.38;
    }

    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    this.desiredCam.set(this.x - fx * 11.2, 5.15, this.z - fz * 11.2);
    const k = 1 - Math.exp(-4.2 * dt);
    this.camPos.lerp(this.desiredCam, k);
    this.camera.position.copy(this.camPos);
    this.look.set(this.x + fx * 4.5, 1.15, this.z + fz * 4.5);
    this.camera.lookAt(this.look);
    this.camera.fov = 56 + Math.min(10, Math.abs(this.speed) * 0.42);
    this.camera.updateProjectionMatrix();

    const lampRank = this.lampPos
      .map((p) => ({ p, d: Math.hypot(p.x - this.x, p.z - this.z) }))
      .filter((o) => o.d < 44)
      .sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.curbLamps.length; i++) {
      const pl = this.curbLamps[i]!;
      const hit = lampRank[i];
      if (!hit) {
        pl.intensity = 0;
        continue;
      }
      pl.position.set(hit.p.x, 5.05, hit.p.z);
      pl.intensity = 14 * (1 - hit.d / 44);
      pl.distance = 22;
    }

    for (let i = 0; i < this.world.lights.length; i++) {
      const tl = this.world.lights[i]!;
      const g = this.lightGroups[i];
      if (!g) continue;
      const state = lightState(tl.phaseOffset, this.simTime);
      setSignal(g, state);
      const dx = tl.x - this.x;
      const dz = tl.z - this.z;
      const dist = Math.hypot(dx, dz);
      const ahead = (dx * fx + dz * fz) / Math.max(dist, 0.01);
      const onLane = this.previewPts.length > 1 && distToPolyline(this.previewPts, tl.x, tl.z) < 14;
      const explored = this.fog.sample(tl.x, tl.z) > 0.28;
      const approaching = dist < LIGHT_SEE && ahead > 0.16 && (onLane || dist < 26);
      const show = approaching || explored || dist < 18;
      g.visible = show;
      const head = g.userData.head as THREE.Group | undefined;
      if (head && show) {
        head.rotation.y = Math.atan2(this.x - g.position.x, this.z - g.position.z) - Math.PI / 2;
      }
      const glow = g.userData.glow as THREE.Sprite | undefined;
      if (glow) {
        glow.visible = approaching || (explored && dist < 50);
        const s = Math.min(7.2, 2.1 + 32 / Math.max(8, dist));
        glow.scale.set(s, s, 1);
        glow.material.opacity = approaching ? (dist < 40 ? 0.95 : 0.7) : 0.45;
      }
    }

    const destVis = this.fog.sample(this.world.dest.x, this.world.dest.z);
    const destDist = Math.hypot(this.world.dest.x - this.x, this.world.dest.z - this.z);
    this.destMarker.visible = destVis > 0.2 || destDist < 70;
    const beacon = this.destMarker.userData.beacon as THREE.Mesh;
    beacon.rotation.y += dt * 0.8;
    beacon.position.y = 3.8 + Math.sin(this.simTime * 2.2) * 0.12;

    updateLabels(this.labels.sprites, this.fog, this.camera, this.previewPts);
    this.audio.update(this.speed, this.input.sample().throttle);
    this.drawMinimap();
  }

  private drawMinimap() {
    const canvas = this.minimap;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = "#0a0b0d";
    ctx.fillRect(0, 0, w, h);
    const scale = (w * 0.92) / this.world.extent;
    const sx = (x: number) => w / 2 + x * scale;
    const sz = (z: number) => h / 2 + z * scale;
    ctx.lineWidth = 1.4;
    for (const road of this.world.roads) {
      ctx.beginPath();
      let started = false;
      for (const p of road.points) {
        if (this.fog.sample(p.x, p.z) < 0.22) {
          started = false;
          continue;
        }
        if (!started) {
          ctx.moveTo(sx(p.x), sz(p.z));
          started = true;
        } else ctx.lineTo(sx(p.x), sz(p.z));
      }
      ctx.strokeStyle = "rgba(197,205,214,0.55)";
      ctx.stroke();
    }
    if (this.previewPts.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = "rgba(236,231,220,0.92)";
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.moveTo(sx(this.previewPts[0]!.x), sz(this.previewPts[0]!.z));
      for (let i = 1; i < this.previewPts.length; i++) {
        ctx.lineTo(sx(this.previewPts[i]!.x), sz(this.previewPts[i]!.z));
      }
      ctx.stroke();
    }
    if (this.fog.sample(this.world.dest.x, this.world.dest.z) > 0.2) {
      ctx.fillStyle = "#ece7dc";
      ctx.beginPath();
      ctx.arc(sx(this.world.dest.x), sz(this.world.dest.z), 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(sx(this.x), sz(this.z));
    ctx.rotate(-this.yaw);
    ctx.fillStyle = "#ece7dc";
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 5);
    ctx.lineTo(0, 3);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    this.speed = 0;
    this.fog.revealAll();
    this.destMarker.visible = true;
    this.preview.group.visible = false;
    for (const g of this.lightGroups) g.visible = true;
    this.drawRoutes();
    const shortest = Math.max(1, this.world.shortestMeters);
    const driven = Math.max(shortest * 0.15, this.driven);
    const efficiency = Math.max(0, Math.min(1, shortest / driven));
    const points = Math.max(0, Math.round(efficiency * 1000) - this.reds * 40);
    const score: Score = {
      points,
      shortestM: shortest,
      drivenM: driven,
      efficiency,
      redLights: this.reds,
      streetsFound: this.streets.size,
      destLabel: this.world.dest.label,
      source: this.world.source,
    };
    useSession.getState().setScore(score);
  }

  private drawRoutes() {
    const best = this.world.shortestPath.map((p) => new THREE.Vector3(p.x, 0.3, p.z));
    if (best.length > 1) {
      const g = new THREE.BufferGeometry().setFromPoints(best);
      this.bestLine = new THREE.Line(
        g,
        new THREE.LineDashedMaterial({ color: 0x7d9a78, dashSize: 2.2, gapSize: 1.4 }),
      );
      this.bestLine.computeLineDistances();
      this.scene.add(this.bestLine);
    }
    if (this.path.length > 1) {
      const g = new THREE.BufferGeometry().setFromPoints(this.path);
      this.playerLine = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xece7dc }));
      this.scene.add(this.playerLine);
    }
  }

  dispose() {
    this.disposed = true;
    this.running = false;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKey);
    this.input.dispose();
    this.audio.dispose();
    this.fog.dispose();
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
    this.renderer.dispose();
    if (window.__controlsTest) delete window.__controlsTest;
  }
}
