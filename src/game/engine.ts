import * as THREE from "three";
import { currentStreetName, nearestOnRoads } from "@/lib/osm/pathfind";
import type { Building, WorldData } from "@/lib/osm/types";
import { useSession, type LightKind, type Score } from "@/store/session";
import { EngineAudio } from "./audio";
import { makeCar } from "./car-mesh";
import { FogOfWar } from "./fog";
import { Input } from "./input";
import { makeStreetLabels, updateLabels } from "./labels";
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
  private labels: ReturnType<typeof makeStreetLabels>;
  private destMarker: THREE.Group;
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
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0b0d);
    this.scene.fog = new THREE.FogExp2(0x0c0d10, 0.018);

    this.camera = new THREE.PerspectiveCamera(58, canvas.clientWidth / Math.max(1, canvas.clientHeight), 0.15, 280);
    this.camPos.set(this.x, 5.4, this.z + 12);
    this.camera.position.copy(this.camPos);

    this.scene.add(new THREE.HemisphereLight(0xb8c4ce, 0x1a1c20, 0.55));
    const moon = new THREE.DirectionalLight(0xd5dbe3, 0.55);
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

    this.labels = makeStreetLabels(world.roads);
    this.scene.add(this.labels.group);

    this.carMesh = makeCar();
    this.carMesh.position.set(this.x, 0, this.z);
    this.carMesh.rotation.y = this.yaw;
    this.scene.add(this.carMesh);

    const headL = new THREE.SpotLight(0xfff2d8, 18, 42, 0.42, 0.45, 1.1);
    headL.position.set(-0.5, 0.7, -1.6);
    headL.target.position.set(-0.5, 0.2, -12);
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
    let nearestD = 22;
    for (const light of this.world.lights) {
      const lx = light.x - this.x;
      const lz = light.z - this.z;
      const dist = Math.hypot(lx, lz);
      if (dist > 22) continue;
      const ahead = (lx * fx + lz * fz) / Math.max(dist, 0.01);
      const state = lightState(light.phaseOffset, this.simTime);
      if (ahead > 0.45 && dist < nearestD) {
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

    for (let i = 0; i < this.world.lights.length; i++) {
      const tl = this.world.lights[i]!;
      const g = this.lightGroups[i];
      if (!g) continue;
      setSignal(g, lightState(tl.phaseOffset, this.simTime));
    }

    const destVis = this.fog.sample(this.world.dest.x, this.world.dest.z);
    const destDist = Math.hypot(this.world.dest.x - this.x, this.world.dest.z - this.z);
    this.destMarker.visible = destVis > 0.2 || destDist < 70;
    const beacon = this.destMarker.userData.beacon as THREE.Mesh;
    beacon.rotation.y += dt * 0.8;
    beacon.position.y = 3.8 + Math.sin(this.simTime * 2.2) * 0.12;

    updateLabels(this.labels.sprites, this.fog, this.camera);
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
