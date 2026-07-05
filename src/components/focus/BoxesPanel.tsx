// ───────────────────────────────────────────────────────────────────────────
// BoxesPanel — the explicit box list (a tab beside Tags, bottom-left of focus).
//
// One single-line row per box, in Z-ORDER: the front-most box (last in
// draft.boxes → drawn on top) is listed first, so re-ordering a box here (or in
// the viewport via moveBoxZ) keeps both views in sync. Object rows show
// `label · desc`; text rows show their literal `text`. Clicking a row selects
// that box (Cmd/Ctrl/Shift = additive multi-select) and populates the BoxPanel
// "prompt details" on the right — the row isn't editable; editing happens there.
//
// Rows are drag-reorderable to edit z-order: dragging a row and dropping it at a
// new slot calls moveBoxToIndex. Because the list is front-first (reversed vs the
// array), we convert the visual drop slot back to an array index. Delete / copy /
// paste / arrow-nudge come free from BoxLayer's focus-view keyboard (rows aren't
// inputs, so it stays active while the list holds focus).
// ───────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { PromptBox } from "../../types";
import { useSceneStore, useCurrentNodeLocked } from "../../state/sceneStore";
import { useUiStore } from "../../state/uiStore";
import { effectiveBoxColor } from "./swatches";

const EMPTY_BOXES: PromptBox[] = [];
const BOX_MIME = "application/x-ideoboard-box-reorder";

export function BoxesPanel({ tabs }: { tabs?: ReactNode }) {
  const boxes = useSceneStore((s) => s.draft?.boxes ?? EMPTY_BOXES);
  const selectedBoxIds = useUiStore((s) => s.selectedBoxIds);
  const setSelectedBoxes = useUiStore((s) => s.setSelectedBoxes);
  const toggleBoxSelection = useUiStore((s) => s.toggleBoxSelection);
  const removeBoxes = useSceneStore((s) => s.removeBoxes);
  const moveBoxToIndex = useSceneStore((s) => s.moveBoxToIndex);
  const locked = useCurrentNodeLocked();

  // Front-most first: the last box in the array is drawn on top, so it heads the
  // list (a Photoshop/Figma-style layer order).
  const ordered = [...boxes].reverse();
  const n = ordered.length;

  // Drag-reorder state. `dragFrom` is the dragged row's visual index; `dropSlot`
  // is the insertion gap (0..n) the cursor is over. Both cleared when the drag ends.
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropSlot, setDropSlot] = useState<number | null>(null);

  const handleSelect = (id: string, additive: boolean) => {
    if (additive) toggleBoxSelection(id, true);
    else setSelectedBoxes([id]);
  };

  // A drop at slot `s` is a no-op if it lands on either side of the dragged row.
  const isNoop = (s: number) => dragFrom != null && (s === dragFrom || s === dragFrom + 1);

  const endDrag = () => {
    setDragFrom(null);
    setDropSlot(null);
  };

  const performDrop = () => {
    if (dragFrom == null || dropSlot == null || isNoop(dropSlot)) return endDrag();
    // Final VISUAL index of the dragged row after removal, then convert front-first
    // visual index → array index (array is the reverse of the visual order).
    const oNew = dropSlot > dragFrom ? dropSlot - 1 : dropSlot;
    const arrayIndex = n - 1 - oNew;
    moveBoxToIndex(ordered[dragFrom].id, arrayIndex);
    endDrag();
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        {tabs ?? (
          <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Boxes</span>
        )}
        <div className="flex-1" />
        <span className="pr-1 text-[10px] text-ink-faint">
          {boxes.length} {boxes.length === 1 ? "box" : "boxes"}
        </span>
      </div>

      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        // Dropping in the empty area below the rows appends to the end (back-most).
        onDragOver={(e) => {
          if (dragFrom == null || e.target !== e.currentTarget) return;
          e.preventDefault();
          setDropSlot(n);
        }}
        onDrop={(e) => {
          if (dragFrom == null) return;
          e.preventDefault();
          performDrop();
        }}
      >
        {ordered.length === 0 ? (
          <div className="px-2 py-3 text-xs leading-relaxed text-ink-faint">
            No boxes yet. Draw one on the image to add a{" "}
            <span className="text-accent">text</span> or <span className="text-accent">object</span>{" "}
            region.
          </div>
        ) : (
          ordered.map((b, i) => (
            <div key={b.id}>
              {/* Insertion indicator above this row. */}
              {dropSlot === i && !isNoop(i) && <DropLine />}
              <BoxRow
                box={b}
                selected={selectedBoxIds.includes(b.id)}
                locked={locked}
                dragging={dragFrom === i}
                onSelect={(additive) => handleSelect(b.id, additive)}
                onDelete={() => {
                  removeBoxes([b.id]);
                  setSelectedBoxes(selectedBoxIds.filter((id) => id !== b.id));
                }}
                onDragStart={(e) => {
                  e.dataTransfer.setData(BOX_MIME, b.id);
                  e.dataTransfer.effectAllowed = "move";
                  setDragFrom(i);
                }}
                onDragEnd={endDrag}
                onDragOver={(e) => {
                  if (dragFrom == null) return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                  const r = e.currentTarget.getBoundingClientRect();
                  setDropSlot(e.clientY < r.top + r.height / 2 ? i : i + 1);
                }}
                onDrop={(e) => {
                  if (dragFrom == null) return;
                  e.preventDefault();
                  e.stopPropagation();
                  performDrop();
                }}
              />
              {/* Trailing indicator only after the final row (below-last drop). */}
              {i === n - 1 && dropSlot === n && !isNoop(n) && <DropLine />}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function DropLine() {
  return <div className="pointer-events-none h-0.5 bg-accent" aria-hidden="true" />;
}

interface BoxRowProps {
  box: PromptBox;
  selected: boolean;
  locked: boolean;
  dragging: boolean;
  onSelect: (additive: boolean) => void;
  onDelete: () => void;
  onDragStart: (e: ReactDragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onDragOver: (e: ReactDragEvent<HTMLDivElement>) => void;
  onDrop: (e: ReactDragEvent<HTMLDivElement>) => void;
}

function BoxRow({
  box,
  selected,
  locked,
  dragging,
  onSelect,
  onDelete,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: BoxRowProps) {
  const isText = box.kind === "text";
  const label = isText ? "" : (box.label ?? "").trim();
  const body = ((isText ? box.text : box.desc) ?? "").trim();
  const empty = !label && !body;
  const color = effectiveBoxColor(box);

  const onMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return; // let the delete button handle it
    onSelect(e.metaKey || e.ctrlKey || e.shiftKey);
  };

  return (
    <div
      draggable={!locked}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onMouseDown={onMouseDown}
      className={`group relative flex items-center gap-1 border py-0.5 pl-[2px] pr-1 ${
        locked ? "cursor-pointer" : "cursor-grab"
      } ${dragging ? "opacity-40" : ""} ${
        selected ? "border-accent bg-accent-soft/40" : "border-transparent hover:bg-surface-2"
      }`}
    >
      {/* Drag affordance (the whole row is draggable; this just signals it). */}
      <span
        className={`select-none text-ink-faint ${locked ? "opacity-0" : ""}`}
        aria-hidden="true"
      >
        ⋮⋮
      </span>
      {/* Effective color + kind cue: a solid filled chip for object boxes, a dashed
          hollow one for text boxes (mirrors their outline style in the viewport). */}
      <span
        className={`h-2.5 w-2.5 shrink-0 rounded-[2px] border ${
          isText ? "border-dashed" : "border-solid"
        }`}
        style={{ borderColor: color, backgroundColor: isText ? "transparent" : color }}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate text-[10px] leading-tight">
        {empty ? (
          <span className="italic text-ink-faint">
            {isText ? "Empty text box" : "Untitled object"}
          </span>
        ) : (
          <>
            {label && <span className="font-medium text-ink">{label}</span>}
            {label && body && <span className="text-ink-faint"> · </span>}
            {body && <span className={label ? "text-ink-dim" : "text-ink"}>{body}</span>}
          </>
        )}
      </span>
      {!locked && (
        <button
          type="button"
          title="Delete box"
          onClick={onDelete}
          className="absolute inset-y-0 right-0 flex w-5 items-center justify-center bg-surface-2 text-ink-faint opacity-0 transition hover:bg-surface-3 hover:text-danger group-hover:opacity-100"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3 w-3"
            aria-hidden="true"
          >
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
          </svg>
        </button>
      )}
    </div>
  );
}
