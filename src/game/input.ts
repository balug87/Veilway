export type Actions = {
  throttle: number;
  steer: number;
  brake: number;
};

const GAME_CODES = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "ShiftLeft",
  "ShiftRight",
]);

function radialDeadzone(x: number, y: number, dz = 0.16) {
  const m = Math.hypot(x, y);
  if (m < dz) return { x: 0, y: 0 };
  const scale = (m - dz) / (1 - dz) / m;
  return { x: x * scale, y: y * scale };
}

export class Input {
  keys = new Set<string>();
  touchSteer = 0;
  touchThrottle = 0;
  touchBrake = 0;
  injectSteer: number | null = null;
  injectThrottle: number | null = null;
  private usingTouch = false;
  private onKeyDown: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;
  private onBlur: () => void;

  constructor(_canvas: HTMLElement) {
    this.onKeyDown = (e) => {
      this.keys.add(e.code);
      this.usingTouch = false;
      if (GAME_CODES.has(e.code)) e.preventDefault();
    };
    this.onKeyUp = (e) => this.keys.delete(e.code);
    this.onBlur = () => this.keys.clear();
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("visibilitychange", this.onBlur);
  }

  setTouch(steer: number, throttle: number, brake: number) {
    this.usingTouch = true;
    this.touchSteer = steer;
    this.touchThrottle = throttle;
    this.touchBrake = brake;
  }

  sample(): Actions {
    let steer = 0;
    let throttle = 0;
    let brake = 0;

    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) steer += 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) steer -= 1;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) throttle += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) throttle -= 1;
    if (this.keys.has("Space") || this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")) brake = 1;

    const pads = typeof navigator !== "undefined" ? navigator.getGamepads?.() : [];
    if (pads) {
      for (const pad of pads) {
        if (!pad) continue;
        const stick = radialDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
        steer += -stick.x;
        throttle += -stick.y;
        if (pad.buttons[6]?.pressed || pad.buttons[7]?.pressed) brake = Math.max(brake, pad.buttons[7]?.value ?? 1);
      }
    }

    if (this.usingTouch) {
      steer += this.touchSteer;
      throttle += this.touchThrottle;
      brake = Math.max(brake, this.touchBrake);
    }

    if (this.injectSteer !== null) steer = this.injectSteer;
    if (this.injectThrottle !== null) throttle = this.injectThrottle;

    return {
      steer: Math.max(-1, Math.min(1, steer)),
      throttle: Math.max(-1, Math.min(1, throttle)),
      brake: Math.max(0, Math.min(1, brake)),
    };
  }

  dispose() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("visibilitychange", this.onBlur);
    this.keys.clear();
  }
}
