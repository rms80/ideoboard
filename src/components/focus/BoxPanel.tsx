// ───────────────────────────────────────────────────────────────────────────
// BoxPanel — the persistent right-side editor for the currently-selected box.
// It populates from the single selected box (uiStore.inspectorBoxId) and edits
// it in place. When no box (or more than one) is selected, the fields clear and
// disable. Replaces the old anchored BoxInspector popover.
// ───────────────────────────────────────────────────────────────────────────
import { useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import type { PromptTag } from "../../types";
import { useSceneStore, useCurrentNodeLocked } from "../../state/sceneStore";
import { useUiStore } from "../../state/uiStore";
import { newId } from "../../util/id";
import { TagField } from "../common/TagField";
import { Button, Field, inputClass } from "../common/ui";
import { SWATCHES, effectiveBoxColor } from "./swatches";

const EMPTY_TAGS: PromptTag[] = [];
const EMPTY_BOXES: { id: string }[] = [];

/** First focusable input/textarea inside a wrapper div (TagField has no ref prop). */
const fieldIn = (wrap: HTMLDivElement | null) =>
  wrap?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea") ?? null;

// One segment of the Kind pillbox (mirrors the Image/Prompts toggles): active =
// solid muted green, inactive = surface; segments are clipped into one block by
// the container, which carries the thin grey outline.
function KindBtn({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={`px-4 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "bg-[#3a8a5c] text-white"
          : "bg-surface-1 text-ink-dim hover:bg-surface-2 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export function BoxPanel() {
  const inspectorBoxId = useUiStore((s) => s.inspectorBoxId);
  const box = useSceneStore((s) => s.draft?.boxes.find((b) => b.id === inspectorBoxId) ?? null);
  const boxIds = useSceneStore((s) => s.draft?.boxes ?? EMPTY_BOXES);
  const tags = useSceneStore((s) => s.draft?.tags ?? EMPTY_TAGS);
  const updateBox = useSceneStore((s) => s.updateBox);
  const addBox = useSceneStore((s) => s.addBox);
  const removeBoxes = useSceneStore((s) => s.removeBoxes);
  const moveBoxZ = useSceneStore((s) => s.moveBoxZ);
  const discardDrawnBox = useSceneStore((s) => s.discardDrawnBox);
  const clearBoxSelection = useUiStore((s) => s.clearBoxSelection);
  const setSelectedBoxes = useUiStore((s) => s.setSelectedBoxes);
  const focusBoxField = useUiStore((s) => s.focusBoxField);
  const focusBoxNonce = useUiStore((s) => s.focusBoxNonce);
  const boxFocusTarget = useUiStore((s) => s.boxFocusTarget);
  const pendingBoxId = useUiStore((s) => s.pendingBoxId);
  const setPendingBox = useUiStore((s) => s.setPendingBox);
  const locked = useCurrentNodeLocked();

  const id = box?.id;
  const isText = box?.kind === "text";

  // Z-order = array order (last = on top). Move Up brings the box toward the front
  // (end), Move Down toward the back (start); disabled at the respective ends.
  const zIndex = box ? boxIds.findIndex((b) => b.id === box.id) : -1;
  const atTop = zIndex === boxIds.length - 1;
  const atBottom = zIndex <= 0;
  const toFront = boxIds.length - 1 - zIndex; // delta to reach the end (top)
  const toBack = -zIndex; // delta to reach the start (bottom)

  // A just-drawn, still-untouched box: backspace (in the empty auto-focused field)
  // or undo cancels it (delete + drop its undo entry), since the field has focus and
  // eats the event. `pendingBoxId` is cleared as soon as the user types anything.
  const isPending = !!box && box.id === pendingBoxId;
  const onFieldKeyDown = (e: ReactKeyboardEvent) => {
    if (!isPending || !id) return;
    const mod = e.metaKey || e.ctrlKey;
    const target = e.target as HTMLInputElement | HTMLTextAreaElement;
    const emptyField = !("value" in target) || target.value === "";
    const revert =
      ((e.key === "Backspace" || e.key === "Delete") && emptyField) ||
      (mod && e.key.toLowerCase() === "z");
    if (!revert) return;
    e.preventDefault();
    e.stopPropagation();
    discardDrawnBox(id);
    setPendingBox(null);
    clearBoxSelection();
  };

  // A focus request (BoxLayer/keyboard bumps focusBoxNonce + sets boxFocusTarget)
  // moves the caret into the right field. Wrapper refs keep TagField's prop
  // contract frozen; the Label is a plain input with its own ref.
  //   draw    → Text (text box) / Description (object box)
  //   primary → Text (text box) / Label (object box)   [the 'e' shortcut]
  //   desc    → Description (either kind)               [the 'd' shortcut]
  const descWrapRef = useRef<HTMLDivElement>(null);
  const textWrapRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const lastNonceRef = useRef(focusBoxNonce);
  useEffect(() => {
    if (focusBoxNonce === lastNonceRef.current) return; // skip mount / unrelated renders
    lastNonceRef.current = focusBoxNonce;
    let el: HTMLInputElement | HTMLTextAreaElement | null;
    if (boxFocusTarget === "desc") el = fieldIn(descWrapRef.current);
    else if (boxFocusTarget === "primary")
      el = isText ? fieldIn(textWrapRef.current) : labelRef.current;
    else el = isText ? fieldIn(textWrapRef.current) : fieldIn(descWrapRef.current);
    el?.focus();
  }, [focusBoxNonce, boxFocusTarget, isText]);

  // Tab is trapped between the two prompt fields (primary = Text/Label, and
  // Description) so it never descends into the color swatches or control buttons.
  // Skip if a child already handled it (e.g. TagField's autocomplete Tab-complete).
  const onPanelKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== "Tab" || e.defaultPrevented) return;
    const primary = isText ? fieldIn(textWrapRef.current) : labelRef.current;
    const desc = fieldIn(descWrapRef.current);
    if (!primary || !desc) return;
    const active = document.activeElement;
    if (active === primary) {
      e.preventDefault();
      desc.focus();
    } else if (active === desc) {
      e.preventDefault();
      primary.focus();
    }
  };

  // Duplicate the selected box: clone it (new id), nudge it slightly so it doesn't
  // sit exactly atop the original, select the copy, and drop the caret into its
  // Description. `box` is plain finalized state here, so structuredClone is safe.
  const duplicateBox = () => {
    if (!box) return;
    const OFF = 20; // normalized-coord offset (0–1000 space)
    const w = box.bbox.xMax - box.bbox.xMin;
    const h = box.bbox.yMax - box.bbox.yMin;
    const xMin = Math.max(0, Math.min(box.bbox.xMin + OFF, 1000 - w));
    const yMin = Math.max(0, Math.min(box.bbox.yMin + OFF, 1000 - h));
    const dup = {
      ...structuredClone(box),
      id: newId(),
      bbox: { xMin, yMin, xMax: xMin + w, yMax: yMin + h },
    };
    addBox(dup);
    setSelectedBoxes([dup.id]);
    focusBoxField("desc");
  };

  return (
    <div
      onKeyDown={onPanelKeyDown}
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-surface-1 p-3 text-sm"
    >
      {box && locked && (
        <p className="text-xs text-ink-faint">This node has an image — its prompt is locked.</p>
      )}

      {/* Kind: pillbox toggle (only one active, active = green), centered. */}
      <div className="flex justify-center">
        <div className="inline-flex overflow-hidden rounded-md border border-border">
          <KindBtn
            active={box?.kind === "text"}
            disabled={!box || locked}
            onClick={() =>
              id &&
              updateBox(id, (b) => {
                b.kind = "text";
                b.text ??= "";
              })
            }
          >
            Text
          </KindBtn>
          <KindBtn
            active={box?.kind === "obj"}
            disabled={!box || locked}
            onClick={() =>
              id &&
              updateBox(id, (b) => {
                b.kind = "obj";
                b.text = undefined;
              })
            }
          >
            Object
          </KindBtn>
        </div>
      </div>

      {isText && (
        <div ref={textWrapRef} onKeyDown={onFieldKeyDown}>
          <Field label="Text">
            <TagField
              tags={tags}
              disabled={locked}
              ariaLabel="Box text"
              placeholder="Literal text…"
              value={box?.text ?? ""}
              onChange={(v) => {
                if (!id) return;
                updateBox(id, (b) => void (b.text = v));
                if (v !== "" && pendingBoxId === id) setPendingBox(null);
              }}
            />
          </Field>
        </div>
      )}

      {box && !isText && (
        <Field label="Label">
          <input
            ref={labelRef}
            className={inputClass}
            disabled={locked}
            aria-label="Box label"
            placeholder="Optional label shown in the box"
            value={box.label ?? ""}
            onChange={(e) => id && updateBox(id, (b) => void (b.label = e.target.value))}
          />
        </Field>
      )}

      <div ref={descWrapRef} onKeyDown={onFieldKeyDown}>
        <Field label="Description">
          <TagField
            multiline
            tags={tags}
            ariaLabel="Box description"
            placeholder="Sub-prompt / typographic spec…"
            disabled={!box || locked}
            className="min-h-40"
            value={box?.desc ?? ""}
            onChange={(v) => {
              if (!id) return;
              updateBox(id, (b) => void (b.desc = v));
              if (v !== "" && pendingBoxId === id) setPendingBox(null);
            }}
          />
        </Field>
      </div>

      {/* Label intentionally blank (non-breaking space) so the row keeps the same
          vertical space as the other labelled fields, without the "Color" text. */}
      <Field label={" "}>
        <div className="flex items-center justify-center gap-px">
          {SWATCHES.map((c) => {
            // Match the box's EFFECTIVE color (explicit, else the kind default which
            // is itself a swatch) so one swatch is always selected for any box.
            const selected = !!box && effectiveBoxColor(box).toLowerCase() === c.toLowerCase();
            return (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                aria-pressed={selected}
                disabled={!box || locked}
                onClick={() => id && updateBox(id, (b) => void (b.color = c))}
                style={{ backgroundColor: c }}
                className={`h-4 w-4 rounded transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  selected
                    ? "ring-2 ring-inset ring-ink"
                    : "ring-1 ring-black/40 hover:ring-ink/60"
                }`}
              />
            );
          })}
        </div>
      </Field>

      {box && !locked && (
        <>
          <div className="mt-1 flex justify-center gap-1.5">
            <Button disabled={atTop} onClick={() => id && moveBoxZ(id, 1)} title="Bring forward">
              Up
            </Button>
            <Button disabled={atBottom} onClick={() => id && moveBoxZ(id, -1)} title="Send backward">
              Down
            </Button>
            <Button disabled={atTop} onClick={() => id && moveBoxZ(id, toFront)} title="Bring to front">
              Front
            </Button>
            <Button disabled={atBottom} onClick={() => id && moveBoxZ(id, toBack)} title="Send to back">
              Back
            </Button>
          </div>
          <div className="flex justify-center gap-1.5">
            <Button onClick={duplicateBox} title="Duplicate this box">
              Duplicate
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                removeBoxes([id!]);
                clearBoxSelection();
              }}
              title="Delete this box"
            >
              Delete
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
