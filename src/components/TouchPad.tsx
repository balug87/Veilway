import { useRef } from "react";
import type { Input } from "@/game/input";

type Props = { input: Input | null; visible: boolean };

export function TouchPad({ input, visible }: Props) {
  const origin = useRef<{ x: number; y: number; id: number } | null>(null);
  const stick = useRef({ steer: 0, throttle: 0 });
  if (!visible) return null;

  const apply = (steer: number, throttle: number, brake: number) => {
    input?.setTouch(steer, throttle, brake);
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between p-4 sm:hidden">
      <div
        className="pointer-events-auto size-32 touch-none rounded-full border border-border bg-bg/50"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const r = e.currentTarget.getBoundingClientRect();
          origin.current = { x: r.left + r.width / 2, y: r.top + r.height / 2, id: e.pointerId };
        }}
        onPointerMove={(e) => {
          const o = origin.current;
          if (!o || e.pointerId !== o.id) return;
          const dx = (e.clientX - o.x) / 52;
          const dy = (e.clientY - o.y) / 52;
          const steer = Math.max(-1, Math.min(1, -dx));
          const throttle = Math.max(-1, Math.min(1, -dy));
          stick.current = { steer, throttle };
          apply(steer, throttle, 0);
        }}
        onPointerUp={() => {
          origin.current = null;
          stick.current = { steer: 0, throttle: 0 };
          apply(0, 0, 0);
        }}
        onPointerCancel={() => {
          origin.current = null;
          stick.current = { steer: 0, throttle: 0 };
          apply(0, 0, 0);
        }}
      />
      <button
        type="button"
        className="pointer-events-auto h-16 min-w-24 rounded-lg border border-border bg-bg/70 px-4 text-sm font-medium text-fg"
        onPointerDown={(e) => {
          e.preventDefault();
          apply(stick.current.steer, stick.current.throttle, 1);
        }}
        onPointerUp={() => apply(stick.current.steer, stick.current.throttle, 0)}
        onPointerCancel={() => apply(stick.current.steer, stick.current.throttle, 0)}
      >
        Brake
      </button>
    </div>
  );
}
