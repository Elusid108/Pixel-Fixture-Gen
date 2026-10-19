import { events as createPointerEvents } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import { create } from 'zustand';

/**
 * Touch support for the 3D views and the compact (phone and tablet) shell.
 *
 * Every pick in the app tells a click from an orbit drag with `e.delta > 4` (pixels between
 * pointer-down and click). A fingertip moves more than that on a plain tap, so taps were read
 * as drags. The canvas event manager below treats a touch or pen tap that stays within
 * TOUCH_SLOP as a still click (delta 0), and drops the click a browser may send after a pinch.
 */

/** How far a finger may wander and still count as a tap, CSS px. */
export const TOUCH_SLOP = 12;

/** Below this width the app uses the compact shell: top bar, view, bottom tab bar, sheets. */
export const COMPACT_QUERY = '(max-width: 980px)';

/** On-screen stand-ins for modifier keys a phone doesn't have. */
interface TouchMods {
  /** Acts as a held Shift on canvas taps and drags (lift a hub, flip a strip, add to a selection). */
  shift: boolean;
  toggleShift(): void;
}
export const useTouchMods = create<TouchMods>((set, get) => ({
  shift: false,
  toggleShift: () => {
    const shift = !get().shift;
    set({ shift });
    // Systems that watch the Shift key itself (pixel-chain anchor lifts) see it held too.
    pressKey('Shift', shift ? 'keydown' : 'keyup');
  },
}));

/** Send a key to the window's key handlers, for on-screen Enter / Esc / Shift. */
export function pressKey(key: string, type: 'keydown' | 'keyup' = 'keydown') {
  window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true, shiftKey: key === 'Shift' && type === 'keydown' }));
}

/** The same event, read as if Shift were held. */
function withShift<E extends Event>(e: E): E {
  return new Proxy(e, {
    get(target, prop) {
      if (prop === 'shiftKey') return true;
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

type Store = Parameters<typeof createPointerEvents>[0];
type Handler = (e: Event) => void;

/** r3f's pointer events, with touch-sized taps and the on-screen Shift. Pass as `<Canvas events>`. */
export function touchFriendlyEvents(store: Store): ReturnType<typeof createPointerEvents> {
  const base = createPointerEvents(store);
  const h = base.handlers as unknown as Record<string, Handler>;
  const touches = new Set<number>();
  let multi = false;
  let down: { x: number; y: number; touch: boolean } | null = null;
  const mod = <E extends Event>(e: E): E => (useTouchMods.getState().shift ? withShift(e) : e);

  /** A touch tap inside the slop counts as a click that never moved. */
  const settle = (e: MouseEvent) => {
    if (!down?.touch) return true;
    if (multi) return false;
    if (Math.hypot(e.offsetX - down.x, e.offsetY - down.y) <= TOUCH_SLOP) store.getState().internal.initialClick = [e.offsetX, e.offsetY];
    return true;
  };

  const handlers: Record<string, Handler> = {
    ...h,
    onPointerDown: (ev) => {
      const e = ev as PointerEvent;
      if (e.pointerType === 'touch') {
        touches.add(e.pointerId);
        multi = touches.size > 1;
      }
      down = { x: e.offsetX, y: e.offsetY, touch: e.pointerType === 'touch' || e.pointerType === 'pen' };
      h.onPointerDown(mod(e));
    },
    onPointerUp: (ev) => {
      touches.delete((ev as PointerEvent).pointerId);
      h.onPointerUp(ev);
    },
    onPointerCancel: (ev) => {
      touches.delete((ev as PointerEvent).pointerId);
      h.onPointerCancel(ev);
    },
    onPointerMove: (ev) => h.onPointerMove(mod(ev)),
    onClick: (ev) => {
      if (settle(ev as MouseEvent)) h.onClick(mod(ev));
    },
    onDoubleClick: (ev) => {
      if (settle(ev as MouseEvent)) h.onDoubleClick(mod(ev));
    },
  };
  return { ...base, handlers: handlers as unknown as typeof base.handlers };
}

/** True below the compact breakpoint. */
export function useCompact(): boolean {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia?.(COMPACT_QUERY).matches;
  const [compact, setCompact] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia?.(COMPACT_QUERY);
    if (!mq) return;
    const on = () => setCompact(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return compact;
}

/**
 * Keep the page itself from pinch- or double-tap-zooming (iOS Safari ignores touch-action for
 * its own gesture events). The 3D canvas still gets its two-finger zoom through pointer events.
 */
export function usePageZoomGuard() {
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', stop);
    document.addEventListener('gesturechange', stop);
    return () => {
      document.removeEventListener('gesturestart', stop);
      document.removeEventListener('gesturechange', stop);
    };
  }, []);
}
