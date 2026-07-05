// ───────────────────────────────────────────────────────────────────────────
// TagsPanel — the tag-fragment authoring list (bottom-left of the focus view).
//
// Each row is an editable single-line box whose content is `formatTagLine(tag)`
// (`#name body`); on edit we `parseTagLine` → update that tag's name+body while
// keeping its `id` stable. Rows support multi-select, copy/paste (typed
// clipboard, survives node switches), delete, and are draggable onto any
// TagField/box (mime `application/x-ideoboard-tag`, data = bare name).
// ───────────────────────────────────────────────────────────────────────────
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { PromptTag } from "../../types";
import { useSceneStore, useCurrentNodeLocked } from "../../state/sceneStore";
import { useUiStore } from "../../state/uiStore";
import { newId } from "../../util/id";
import { formatTagLine, isValidTagName, parseTagLine } from "../../services/tags";
import { Button } from "../common/ui";

const TAG_MIME = "application/x-ideoboard-tag";
// A SECOND mime set on the same drag so a tag row can be dropped back into this
// list to reorder it (carrying the tag id), while TAG_MIME (the bare name) still
// lets the same drag be dropped onto a prompt field/box to reference the tag.
const TAG_REORDER_MIME = "application/x-ideoboard-tag-reorder";
const EMPTY: PromptTag[] = [];

export function TagsPanel({ tabs }: { tabs?: ReactNode }) {
  const tags = useSceneStore((s) => s.draft?.tags ?? EMPTY);
  const addTag = useSceneStore((s) => s.addTag);
  const addTags = useSceneStore((s) => s.addTags);
  const updateTag = useSceneStore((s) => s.updateTag);
  const removeTags = useSceneStore((s) => s.removeTags);
  const moveTagToIndex = useSceneStore((s) => s.moveTagToIndex);

  const selectedTagIds = useUiStore((s) => s.selectedTagIds);
  const setSelectedTags = useUiStore((s) => s.setSelectedTags);
  const toggleTagSelection = useUiStore((s) => s.toggleTagSelection);
  const clearTagSelection = useUiStore((s) => s.clearTagSelection);
  const clipboard = useUiStore((s) => s.clipboard);
  const setClipboard = useUiStore((s) => s.setClipboard);
  const tagEditRequest = useUiStore((s) => s.tagEditRequest);
  const clearTagEditRequest = useUiStore((s) => s.clearTagEditRequest);
  const requestTagEdit = useUiStore((s) => s.requestTagEdit);
  const locked = useCurrentNodeLocked();

  const panelRef = useRef<HTMLDivElement | null>(null);

  // Drag-reorder state (the tags list is in array order, so a row's visual index
  // IS its array index). `dragFrom` is the dragged row's index; `dropSlot` is the
  // insertion gap (0..n) under the cursor. Both cleared when the drag ends.
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropSlot, setDropSlot] = useState<number | null>(null);
  const isNoop = (s: number) => dragFrom != null && (s === dragFrom || s === dragFrom + 1);
  const endDrag = () => {
    setDragFrom(null);
    setDropSlot(null);
  };
  const performDrop = () => {
    if (dragFrom == null || dropSlot == null || isNoop(dropSlot)) return endDrag();
    // Final index of the dragged tag after it's removed from its old slot.
    moveTagToIndex(tags[dragFrom].id, dropSlot > dragFrom ? dropSlot - 1 : dropSlot);
    endDrag();
  };

  // An external "create tag from selection" request seeds + focuses the new row.
  // It's read DIRECTLY into the row's props below (not copied into local state)
  // so the row mounts already seeded on the render it first appears. Clear it
  // ONLY once the requested tag actually exists in the list — i.e. its seeded row
  // has rendered/mounted (child effects run before this parent effect) — so the
  // request is never consumed before the row that needs it has mounted.
  useEffect(() => {
    if (tagEditRequest && tags.some((t) => t.id === tagEditRequest.id)) {
      clearTagEditRequest();
    }
  }, [tagEditRequest, tags, clearTagEditRequest]);

  // Names appearing more than once → flagged on every offending row.
  const nameCount = new Map<string, number>();
  for (const t of tags) if (t.name) nameCount.set(t.name, (nameCount.get(t.name) ?? 0) + 1);

  const handleAdd = () => {
    const id = newId();
    // Seed the new row "#" with the caret right after it (same flow as "create
    // tag from selection", just with an empty body). Request BEFORE addTag so
    // it's in place on the render the new row first mounts.
    requestTagEdit(id, true);
    setSelectedTags([id]);
    addTag({ id, name: "", body: "" });
  };

  const handleCopy = () => {
    const items = tags.filter((t) => selectedTagIds.includes(t.id)).map((t) => ({ ...t }));
    if (items.length) setClipboard({ kind: "tags", items });
  };

  const handlePaste = () => {
    if (clipboard?.kind === "tags") {
      addTags(clipboard.items.map((t) => ({ ...t, id: newId() })));
    }
  };

  const handleDelete = () => {
    if (selectedTagIds.length) {
      removeTags(selectedTagIds);
      clearTagSelection();
    }
  };

  const handleSelect = (id: string, additive: boolean) => {
    if (additive) toggleTagSelection(id, true);
    else setSelectedTags([id]);
  };

  // Keyboard ops fire only when the panel (not a text box) holds focus.
  const onPanelKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const ae = document.activeElement;
    const editing = ae != null && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA");
    if (editing) return; // never hijack typing
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Delete" || e.key === "Backspace") {
      if (selectedTagIds.length) {
        e.preventDefault();
        handleDelete();
      }
    } else if (mod && (e.key === "c" || e.key === "C")) {
      if (selectedTagIds.length) {
        e.preventDefault();
        handleCopy();
      }
    } else if (mod && (e.key === "v" || e.key === "V")) {
      e.preventDefault();
      handlePaste();
    }
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        {tabs ?? (
          <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Tags</span>
        )}
        <div className="flex-1" />
        <Button
          variant="ghost"
          className="px-2 py-1 text-xs"
          disabled={selectedTagIds.length === 0}
          onClick={handleCopy}
          title="Copy selected (Cmd/Ctrl+C)"
        >
          Copy
        </Button>
        <Button
          variant="ghost"
          className="px-2 py-1 text-xs"
          disabled={clipboard?.kind !== "tags" || locked}
          onClick={handlePaste}
          title="Paste tags (Cmd/Ctrl+V)"
        >
          Paste
        </Button>
        <Button
          variant="ghost"
          className="px-2 py-1 text-xs"
          disabled={locked}
          onClick={handleAdd}
          title="Add tag"
        >
          + Add
        </Button>
      </div>

      <div
        ref={panelRef}
        tabIndex={0}
        onKeyDown={onPanelKeyDown}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto outline-none"
        // Dropping in the empty area below the rows appends to the end.
        onDragOver={(e) => {
          if (dragFrom == null || e.target !== e.currentTarget) return;
          e.preventDefault();
          setDropSlot(tags.length);
        }}
        onDrop={(e) => {
          if (dragFrom == null) return;
          e.preventDefault();
          performDrop();
        }}
      >
        {tags.length === 0 ? (
          <div className="px-2 py-3 text-xs leading-relaxed text-ink-faint">
            No tags yet. Add a reusable fragment (e.g. <span className="text-accent">#colors1 bright orange</span>)
            and reference it with <span className="text-accent">#colors1</span> in any prompt field.
          </div>
        ) : (
          tags.map((t, i) => {
            const invalid = !isValidTagName(t.name) || (nameCount.get(t.name) ?? 0) > 1;
            return (
              <div key={t.id}>
                {dropSlot === i && !isNoop(i) && <DropLine />}
                <TagRow
                  tag={t}
                  selected={selectedTagIds.includes(t.id)}
                  invalid={invalid}
                  locked={locked}
                  dragging={dragFrom === i}
                  reordering={dragFrom != null}
                  autoFocus={tagEditRequest?.id === t.id}
                  seedHash={!!tagEditRequest?.seedHash && tagEditRequest.id === t.id}
                  onSelect={(additive) => handleSelect(t.id, additive)}
                  onFocusPanel={() => panelRef.current?.focus()}
                  onReorderStart={() => setDragFrom(i)}
                  onReorderEnd={endDrag}
                  onReorderOver={(slot) => setDropSlot(slot)}
                  onReorderDrop={performDrop}
                  rowIndex={i}
                  onCommit={(text) => {
                    const parsed = parseTagLine(text);
                    updateTag(t.id, (tag) => {
                      tag.name = parsed.name;
                      tag.body = parsed.body;
                    });
                  }}
                  onDelete={() => {
                    removeTags([t.id]);
                    setSelectedTags(selectedTagIds.filter((id) => id !== t.id));
                  }}
                />
                {i === tags.length - 1 && dropSlot === tags.length && !isNoop(tags.length) && (
                  <DropLine />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function DropLine() {
  return <div className="pointer-events-none h-0.5 bg-accent" aria-hidden="true" />;
}

interface TagRowProps {
  tag: PromptTag;
  selected: boolean;
  invalid: boolean;
  locked: boolean;
  autoFocus: boolean;
  // Seed the editor with "# " + body and drop the caret right after the '#'
  // (a freshly created "tag from selection"), instead of the plain formatted line.
  seedHash: boolean;
  // Drag-reorder: `dragging` = this row is the one being dragged; `reordering` = a
  // reorder drag is in flight (so this row acts as a drop target). rowIndex is the
  // row's position; the callbacks report the drag lifecycle to the parent list.
  dragging: boolean;
  reordering: boolean;
  rowIndex: number;
  onReorderStart: () => void;
  onReorderEnd: () => void;
  onReorderOver: (slot: number) => void;
  onReorderDrop: () => void;
  onSelect: (additive: boolean) => void;
  onFocusPanel: () => void;
  onCommit: (text: string) => void;
  onDelete: () => void;
}

function TagRow({
  tag,
  selected,
  invalid,
  locked,
  autoFocus,
  seedHash,
  dragging,
  reordering,
  rowIndex,
  onReorderStart,
  onReorderEnd,
  onReorderOver,
  onReorderDrop,
  onSelect,
  onFocusPanel,
  onCommit,
  onDelete,
}: TagRowProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Local text keeps the caret stable while typing; we resync only when the
  // tag changes from OUTSIDE this row (undo/redo/paste) — detected by comparing
  // the formatted forms (our own edits already match, so no spurious resync).
  const [text, setText] = useState(() =>
    seedHash ? "#" + (tag.body ? " " + tag.body : "") : formatTagLine(tag),
  );
  // True while the row still shows its un-typed "# <body>" seed: the resync must
  // NOT overwrite that with the plain formatted line (the seed intentionally
  // diverges from formatTagLine). A ref that stays true until the first edit — not
  // a one-shot — so StrictMode's double-invoked mount effect also skips it.
  const seededRef = useRef(seedHash);
  useLayoutEffect(() => {
    if (seededRef.current) return;
    const formatted = formatTagLine(tag);
    if (formatTagLine(parseTagLine(text)) !== formatted) setText(formatted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag.name, tag.body]);

  // Seeded rows: focus and put the caret just after the '#' so the user can type
  // the name. (autoFocus alone would land the caret at the end of the line.)
  useLayoutEffect(() => {
    if (!seedHash) return;
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(1, 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Blur any focused text field (its edit is already live via onChange, so this
  // just commits + drops the caret) and clear any text selection. Browsers may
  // otherwise leave the row's input focused with text selected after a drag.
  const clearActiveEdit = () => {
    const ae = document.activeElement;
    if (ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement) ae.blur();
    window.getSelection?.()?.removeAllRanges();
  };

  const onDragStart = (e: ReactDragEvent<HTMLDivElement>) => {
    // Carry BOTH the name (→ reference onto a field/box) and the id (→ reorder
    // within this list). copyMove lets each drop target pick its own effect.
    e.dataTransfer.setData(TAG_MIME, tag.name);
    e.dataTransfer.setData(TAG_REORDER_MIME, tag.id);
    e.dataTransfer.effectAllowed = "copyMove";
    clearActiveEdit(); // entering a drag: commit/clear any active text edit
    onReorderStart();
  };

  // On drop/cancel, re-clear so the release can't (re)start an edit or selection.
  const onDragEnd = () => {
    clearActiveEdit();
    onReorderEnd();
  };

  // Reorder drop target: while a reorder drag is in flight, hovering this row sets
  // the insertion slot to its top or bottom half; dropping commits via the parent.
  const onRowDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!reordering) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    const r = rowRef.current?.getBoundingClientRect();
    if (!r) return;
    onReorderOver(e.clientY < r.top + r.height / 2 ? rowIndex : rowIndex + 1);
  };
  const onRowDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!reordering) return;
    e.preventDefault();
    e.stopPropagation();
    onReorderDrop();
  };

  const onRowMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // Drag vs. text-select for THIS press, decided here and applied imperatively
    // so it's in effect before the browser starts the drag: a press on the
    // ALREADY-focused input selects text (row not draggable); any other press
    // (grabber, row, or an unfocused input) starts a tag drag.
    const onFocusedInput =
      target === inputRef.current && document.activeElement === inputRef.current;
    if (rowRef.current) rowRef.current.draggable = !locked && !onFocusedInput;

    if (target.closest("input,button")) return; // let the field / delete handle it
    onSelect(e.metaKey || e.ctrlKey || e.shiftKey);
    onFocusPanel();
  };

  return (
    <div
      ref={rowRef}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onRowDragOver}
      onDrop={onRowDrop}
      onMouseDown={onRowMouseDown}
      className={`group relative flex items-center border py-0.5 ${
        dragging ? "opacity-40" : ""
      } ${selected ? "border-accent bg-accent-soft/40" : "border-transparent hover:bg-surface-2"}`}
    >
      <span
        className={`select-none pl-[2px] pr-1 text-ink-faint ${locked ? "" : "cursor-grab"}`}
        title="Drag to reorder, or onto a prompt field/box to reference this tag"
      >
        ⋮⋮
      </span>
      <input
        ref={inputRef}
        type="text"
        value={text}
        autoFocus={autoFocus}
        spellCheck={false}
        disabled={locked}
        placeholder="#name body"
        onFocus={() => onSelect(false)}
        onChange={(e) => {
          const v = e.currentTarget.value;
          seededRef.current = false; // user is editing → resume normal resync
          setText(v);
          onCommit(v);
        }}
        onKeyDown={(e) => {
          // Escape commits the current edit (it's already live via onChange) by
          // ending the session — blur. Stop it bubbling to selection / global
          // Escape handlers so it doesn't also clear the selection, etc.
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.blur();
          }
        }}
        className={`min-w-0 flex-1 bg-transparent pr-1 py-0.5 text-[10px] outline-none placeholder:text-ink-faint disabled:opacity-60 ${
          invalid ? "text-danger" : "text-ink"
        }`}
      />
      {/* Drawn on top of the input (absolute, flush right) so the text entry keeps
          the row's full width; appears on row hover. */}
      {!locked && (
        <button
          type="button"
          title="Delete tag"
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
