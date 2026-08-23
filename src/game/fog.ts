import * as THREE from "three";
import type { Vec2 } from "@/lib/osm/types";

export class FogOfWar {
  readonly texture: THREE.CanvasTexture;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly originX: number;
  readonly originZ: number;
  readonly size: number;
  readonly uniforms: {
    uFogMap: { value: THREE.CanvasTexture };
    uLaneMap: { value: THREE.CanvasTexture };
    uFogOrigin: { value: THREE.Vector2 };
    uFogSize: { value: number };
  };
  private lastX = Infinity;
  private lastZ = Infinity;
  revealed = 0;
  private readonly res: number;
  private readonly pixels: Uint8ClampedArray;
  private readonly laneCanvas: HTMLCanvasElement;
  private readonly laneCtx: CanvasRenderingContext2D;
  private readonly laneTexture: THREE.CanvasTexture;

  constructor(originX: number, originZ: number, size: number, res = 512) {
    this.originX = originX;
    this.originZ = originZ;
    this.size = size;
    this.res = res;
    this.canvas = document.createElement("canvas");
    this.canvas.width = res;
    this.canvas.height = res;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, res, res);
    this.pixels = new Uint8ClampedArray(res * res);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.flipY = false;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;

    this.laneCanvas = document.createElement("canvas");
    this.laneCanvas.width = res;
    this.laneCanvas.height = res;
    this.laneCtx = this.laneCanvas.getContext("2d")!;
    this.laneTexture = new THREE.CanvasTexture(this.laneCanvas);
    this.laneTexture.flipY = false;
    this.laneTexture.magFilter = THREE.LinearFilter;
    this.laneTexture.minFilter = THREE.LinearFilter;
    this.laneTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.laneTexture.wrapT = THREE.ClampToEdgeWrapping;

    this.uniforms = {
      uFogMap: { value: this.texture },
      uLaneMap: { value: this.laneTexture },
      uFogOrigin: { value: new THREE.Vector2(originX, originZ) },
      uFogSize: { value: size },
    };
  }

  private toPx(x: number, z: number) {
    const u = (x - this.originX) / this.size + 0.5;
    const v = (z - this.originZ) / this.size + 0.5;
    return { cx: u * this.res, cy: v * this.res, u, v };
  }

  sample(x: number, z: number) {
    const u = (x - this.originX) / this.size + 0.5;
    const v = (z - this.originZ) / this.size + 0.5;
    if (u < 0 || v < 0 || u > 1 || v > 1) return 0;
    const px = Math.min(this.res - 1, Math.max(0, Math.floor(u * this.res)));
    const py = Math.min(this.res - 1, Math.max(0, Math.floor(v * this.res)));
    return this.pixels[py * this.res + px]! / 255;
  }

  stamp(x: number, z: number, radiusM: number) {
    if (Math.hypot(x - this.lastX, z - this.lastZ) < 1.6) return;
    this.lastX = x;
    this.lastZ = z;
    const { cx, cy } = this.toPx(x, z);
    const r = (radiusM / this.size) * this.res;
    const g = this.ctx.createRadialGradient(cx, cy, r * 0.22, cx, cy, r);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.55, "rgba(255,255,255,0.85)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    this.ctx.globalCompositeOperation = "lighter";
    this.ctx.fillStyle = g;
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
    this.ctx.fill();
    this.texture.needsUpdate = true;

    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.res - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.res - 1, Math.ceil(cy + r));
    const img = this.ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const i = ((yy - y0) * (x1 - x0 + 1) + (xx - x0)) * 4;
        this.pixels[yy * this.res + xx] = img.data[i] ?? 0;
      }
    }
    this.revealed = Math.min(1, this.revealed + ((radiusM * radiusM) / (this.size * this.size)) * 0.12);
  }

  setLane(points: Vec2[], widthM: number, punches?: { x: number; z: number; r: number }[]) {
    const ctx = this.laneCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.res, this.res);
    ctx.globalCompositeOperation = "source-over";
    this.strokeCorridor(ctx, points, widthM + 4, 1);
    if (punches) {
      ctx.globalCompositeOperation = "lighter";
      for (const p of punches) {
        const { cx, cy } = this.toPx(p.x, p.z);
        const r = Math.max(6, (p.r / this.size) * this.res);
        const g = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
        g.addColorStop(0, "rgba(255,255,255,1)");
        g.addColorStop(0.55, "rgba(255,255,255,0.55)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    this.laneTexture.needsUpdate = true;
  }

  /** Permanently reveal a road corridor in the explored-fog map. */
  revealCorridor(points: Vec2[], widthM: number) {
    if (points.length < 2) return;
    this.ctx.globalCompositeOperation = "lighter";
    this.strokeCorridor(this.ctx, points, widthM + 3.2, 1);
    this.texture.needsUpdate = true;
  }

  private strokeCorridor(ctx: CanvasRenderingContext2D, points: Vec2[], widthM: number, alpha: number) {
    if (points.length < 2) return;
    const w = Math.max(16, (widthM / this.size) * this.res);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = w;
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.beginPath();
    const p0 = this.toPx(points[0]!.x, points[0]!.z);
    ctx.moveTo(p0.cx, p0.cy);
    for (let i = 1; i < points.length; i++) {
      const p = this.toPx(points[i]!.x, points[i]!.z);
      ctx.lineTo(p.cx, p.cy);
    }
    ctx.stroke();
  }

  revealAll() {
    this.ctx.globalCompositeOperation = "source-over";
    this.ctx.fillStyle = "#fff";
    this.ctx.fillRect(0, 0, this.res, this.res);
    this.texture.needsUpdate = true;
    this.pixels.fill(255);
    this.revealed = 1;
    this.laneCtx.clearRect(0, 0, this.res, this.res);
    this.laneTexture.needsUpdate = true;
  }

  apply(material: THREE.Material) {
    const uniforms = this.uniforms;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uFogMap = uniforms.uFogMap;
      shader.uniforms.uLaneMap = uniforms.uLaneMap;
      shader.uniforms.uFogOrigin = uniforms.uFogOrigin;
      shader.uniforms.uFogSize = uniforms.uFogSize;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
varying vec3 vFogPos;`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
vFogPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
varying vec3 vFogPos;
uniform sampler2D uFogMap;
uniform sampler2D uLaneMap;
uniform vec2 uFogOrigin;
uniform float uFogSize;`,
        )
        .replace(
          "#include <dithering_fragment>",
          `vec2 fu = (vFogPos.xz - uFogOrigin) / uFogSize + 0.5;
float reveal = 0.0;
float lane = 0.0;
if (fu.x > 0.001 && fu.y > 0.001 && fu.x < 0.999 && fu.y < 0.999) {
  reveal = texture2D(uFogMap, fu).r;
  lane = texture2D(uLaneMap, fu).r;
}
reveal = max(reveal, lane);
vec3 fogC = vec3(0.035, 0.037, 0.04);
vec3 pavement = vec3(0.93, 0.90, 0.82);
vec3 shown = mix(gl_FragColor.rgb, pavement, clamp(lane * 1.15, 0.0, 1.0));
gl_FragColor.rgb = mix(fogC, shown, reveal);
#include <dithering_fragment>`,
        );
    };
    material.customProgramCacheKey = () => "veilway-fog-v4";
    material.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
    this.laneTexture.dispose();
  }
}
