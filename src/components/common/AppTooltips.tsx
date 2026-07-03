// ───────────────────────────────────────────────────────────────────────────
// AppTooltips — a single global tooltip renderer. Mounted once (in AppShell), it
// watches for hover over ANY element carrying a `title` attribute, suppresses the
// browser's native tooltip (which has a fixed, sluggish delay we can't change),
// and shows our own after DELAY ms — roughly half the native delay, so tooltips
// across the app feel about twice as fast. No per-component changes needed: it
// reads the existing `title`s and stashes each into `data-apptip` while hovered
// (restored on leave) so accessibility/markup is preserved.
// ───────────────────────────────────────────────────────────────────────────
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Native title delay is ~500ms; 250ms shows the tooltip about 2× as fast.
const DELAY = 250;

interface Tip {
  text: string;
  cx: number; // horizontal center of the anchor
  below: number; // preferred top (just under the anchor)
  above: number; // fallback bottom edge (just above the anchor) when it'd overflow
}

export function AppTooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const hoveredRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // Put the borrowed `title` back so the DOM/vdom stay consistent.
    const restore = (el: HTMLElement | null) => {
      if (el && el.dataset.apptip !== undefined) {
        el.setAttribute("title", el.dataset.apptip);
        delete el.dataset.apptip;
      }
    };
    const hide = () => {
      clearTimer();
      restore(hoveredRef.current);
      hoveredRef.current = null;
      setTip(null);
    };

    const onOver = (e: PointerEvent) => {
      const start = e.target as Element | null;
      const el = start?.closest?.("[title], [data-apptip]") as HTMLElement | null;
      if (!el) return;
      // Resolve tip text; on first sight, stash the title and strip it so the
      // native tooltip never fires.
      let text = el.dataset.apptip;
      if (text === undefined) {
        const t = el.getAttribute("title");
        if (!t) return; // present but empty → nothing to show
        text = t;
        el.dataset.apptip = t;
        el.removeAttribute("title");
      }
      if (el === hoveredRef.current) return; // same anchor — leave the timer running
      clearTimer();
      restore(hoveredRef.current);
      hoveredRef.current = el;
      const tipText = text;
      timerRef.current = window.setTimeout(() => {
        if (!el.isConnected) {
          hide();
          return;
        }
        const r = el.getBoundingClientRect();
        setTip({ text: tipText, cx: r.left + r.width / 2, below: r.bottom + 6, above: r.top - 6 });
      }, DELAY);
    };

    const onOut = (e: PointerEvent) => {
      const el = hoveredRef.current;
      if (!el) return;
      const to = e.relatedTarget as Node | null;
      if (to && el.contains(to)) return; // still within the same anchor
      hide();
    };

    // Any click / scroll / key interaction dismisses immediately.
    window.addEventListener("pointerover", onOver, true);
    window.addEventListener("pointerout", onOut, true);
    window.addEventListener("pointerdown", hide, true);
    window.addEventListener("wheel", hide, true);
    window.addEventListener("keydown", hide, true);
    return () => {
      window.removeEventListener("pointerover", onOver, true);
      window.removeEventListener("pointerout", onOut, true);
      window.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("wheel", hide, true);
      window.removeEventListener("keydown", hide, true);
      restore(hoveredRef.current);
      clearTimer();
    };
  }, []);

  // Position after measuring: center on the anchor, clamp into the viewport, and
  // flip above the anchor if it would overflow the bottom. Runs before paint so
  // there's no visible jump.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!tip || !el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(4, Math.min(tip.cx - w / 2, window.innerWidth - w - 4));
    let top = tip.below;
    if (top + h > window.innerHeight - 4) top = tip.above - h;
    top = Math.max(4, top);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none fixed left-0 top-0 z-[100] max-w-xs whitespace-normal break-words rounded border border-border bg-surface-2 px-2 py-1 text-xs leading-snug text-ink shadow-lg"
    >
      {tip.text}
    </div>,
    document.body,
  );
}
