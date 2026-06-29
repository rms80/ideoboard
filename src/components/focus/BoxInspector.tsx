// ───────────────────────────────────────────────────────────────────────────
// BoxInspector — a popover that edits the currently-inspected box. Rendered
// INSIDE the BoxLayer overlay so it shares the 0–1000 coordinate space and can
// anchor itself to the box (top-right of the box, flipping to the left side when
// the box hugs the right edge). Closing it (× / outside-click) keeps the box
// selected; deleting removes the box.
// ───────────────────────────────────────────────────────────────────────────
import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { BoxKind, PromptTag } from "../../types";
import { useSceneStore } from "../../state/sceneStore";
import { useUiStore } from "../../state/uiStore";
import { clamp } from "../../util/misc";
import { TagField } from "../common/TagField";
import { Field, IconButton, selectClass } from "../common/ui";

const EMPTY_TAGS: PromptTag[] = [];

export function BoxInspector() {
  const inspectorBoxId = useUiStore((s) => s.inspectorBoxId);
  const box = useSceneStore((s) => s.draft?.boxes.find((b) => b.id === inspectorBoxId) ?? null);
  const tags = useSceneStore((s) => s.draft?.tags ?? EMPTY_TAGS);
  const updateBox = useSceneStore((s) => s.updateBox);
  const removeBoxes = useSceneStore((s) => s.removeBoxes);
  const setInspectorBox = useUiStore((s) => s.setInspectorBox);

  const ref = useRef<HTMLDivElement | null>(null);

  // Outside-click closes the inspector (selection is preserved). Clicks on a box
  // are ignored here — the box's own handler re-targets the inspector.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (ref.current && ref.current.contains(t)) return;
      if (t.closest("[data-boxitem]")) return;
      setInspectorBox(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [setInspectorBox]);

  if (!box) return null;
  const id = box.id;

  // Anchor: to the right of the box, or flipped left when the box is far right.
  const placeLeft = box.bbox.xMax / 10 > 62;
  const top = clamp(box.bbox.yMin / 10, 0, 78);
  const style: CSSProperties = placeLeft
    ? { right: `${100 - box.bbox.xMin / 10}%`, top: `${top}%`, marginRight: 8 }
    : { left: `${box.bbox.xMax / 10}%`, top: `${top}%`, marginLeft: 8 };

  return (
    <div
      ref={ref}
      data-box-inspector
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute z-30 flex w-64 flex-col gap-2 rounded-md border border-border bg-surface-2 p-3 text-sm shadow-xl"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
          {box.kind === "text" ? "Text box" : "Object box"}
        </span>
        <IconButton aria-label="Close inspector" onClick={() => setInspectorBox(null)}>
          ✕
        </IconButton>
      </div>

      <Field label="Kind">
        <select
          className={selectClass}
          value={box.kind}
          onChange={(e) =>
            updateBox(id, (b) => {
              b.kind = e.target.value as BoxKind;
              if (b.kind === "text") b.text ??= "";
              else b.text = undefined;
            })
          }
        >
          <option value="text">text</option>
          <option value="obj">obj</option>
        </select>
      </Field>

      {box.kind === "text" && (
        <Field label="Text">
          <TagField
            tags={tags}
            ariaLabel="Box text"
            placeholder="Literal text…"
            value={box.text ?? ""}
            onChange={(v) => updateBox(id, (b) => void (b.text = v))}
          />
        </Field>
      )}

      <Field label="Description">
        <TagField
          multiline
          tags={tags}
          ariaLabel="Box description"
          placeholder="Sub-prompt / typographic spec…"
          value={box.desc}
          onChange={(v) => updateBox(id, (b) => void (b.desc = v))}
        />
      </Field>

      <Field label="Color">
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label="Box color"
            className="h-8 w-12 cursor-pointer rounded border border-border bg-surface-0"
            value={box.color ?? "#888888"}
            onChange={(e) => updateBox(id, (b) => void (b.color = e.target.value))}
          />
          {box.color && (
            <button
              type="button"
              className="text-xs text-ink-dim hover:text-ink"
              onClick={() => updateBox(id, (b) => void (b.color = undefined))}
            >
              clear
            </button>
          )}
        </div>
      </Field>

      <button
        type="button"
        className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-transparent px-2.5 py-1.5 text-sm font-medium text-danger transition hover:bg-danger/15"
        onClick={() => {
          removeBoxes([id]);
          setInspectorBox(null);
        }}
      >
        Delete box
      </button>
    </div>
  );
}
