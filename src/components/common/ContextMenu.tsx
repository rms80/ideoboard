// ───────────────────────────────────────────────────────────────────────────
// ContextMenu — a tiny reusable right-click menu. Render `menu` once in your
// tree and call `open(e, items)` from an `onContextMenu` handler. Closes on
// outside click / Escape / scroll / item select. Dark themed, portaled to body.
// ───────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

export function useContextMenu(): {
  menu: ReactNode;
  open: (e: ReactMouseEvent, items: MenuItem[]) => void;
} {
  const [state, setState] = useState<MenuState | null>(null);

  const open = useCallback((e: ReactMouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    setState({ x: e.clientX, y: e.clientY, items });
  }, []);

  const close = useCallback(() => setState(null), []);

  useEffect(() => {
    if (!state) return;
    const onDown = () => close();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") close();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onDown);
    window.addEventListener("scroll", onDown, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onDown);
      window.removeEventListener("scroll", onDown, true);
    };
  }, [state, close]);

  const menu: ReactNode = state
    ? createPortal(
        <div
          className="fixed z-[60] min-w-44 overflow-hidden rounded-md border border-border bg-surface-2 py-1 text-sm shadow-lg"
          style={{ top: state.y, left: state.x }}
          // Don't let the menu's own mousedown bubble to the outside-click closer.
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {state.items.map((item, i) => (
            <button
              key={i}
              type="button"
              disabled={item.disabled}
              className="block w-full px-3 py-1.5 text-left text-ink transition hover:bg-surface-3 disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent"
              onClick={() => {
                if (item.disabled) return;
                item.onSelect();
                close();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )
    : null;

  return { menu, open };
}
