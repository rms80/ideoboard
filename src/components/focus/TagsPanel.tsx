// ───────────────────────────────────────────────────────────────────────────
// TagsPanel — the tag-fragment authoring list (bottom-left of the focus view).
//
// Each row is an editable single-line box whose content is `formatTagLine(tag)`
// (`#name body`); on edit we `parseTagLine` → update that tag's name+body while
// keeping its `id` stable. Rows support multi-select, copy/paste (typed
// clipboard, survives node switches), delete, and are draggable onto any
// TagField/box (mime `application/x-ideoboard-tag`, data = bare name).
// ───────────────────────────────────────────────────────────────────────────
import { useLayoutEffect, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import type { PromptTag } from "../../types";
import { useSceneStore } from "../../state/sceneStore";
import { useUiStore } from "../../state/uiStore";
import { newId } from "../../util/id";
import { formatTagLine, isValidTagName, parseTagLine } from "../../services/tags";
import { Button } from "../common/ui";

const TAG_MIME = "application/x-ideoboard-tag";
const EMPTY: PromptTag[] = [];

export function TagsPanel() {
  const tags = useSceneStore((s) => s.draft?.tags ?? EMPTY);
  const addTag = useSceneStore((s) => s.addTag);
  const addTags = useSceneStore((s) => s.addTags);
  const updateTag = useSceneStore((s) => s.updateTag);
  const removeTags = useSceneStore((s) => s.removeTags);

  const selectedTagIds = useUiStore((s) => s.selectedTagIds);
  const setSelectedTags = useUiStore((s) => s.setSelectedTags);
  const toggleTagSelection = useUiStore((s) => s.toggleTagSelection);
  const clearTagSelection = useUiStore((s) => s.clearTagSelection);
  const clipboard = useUiStore((s) => s.clipboard);
  const setClipboard = useUiStore((s) => s.setClipboard);

  const [focusId, setFocusId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Names appearing more than once → flagged on every offending row.
  const nameCount = new Map<string, number>();
  for (const t of tags) if (t.name) nameCount.set(t.name, (nameCount.get(t.name) ?? 0) + 1);

  const handleAdd = () => {
    const id = newId();
    addTag({ id, name: "", body: "" });
    setSelectedTags([id]);
    setFocusId(id);
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
        <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Tags</span>
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
          disabled={clipboard?.kind !== "tags"}
          onClick={handlePaste}
          title="Paste tags (Cmd/Ctrl+V)"
        >
          Paste
        </Button>
        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={handleAdd} title="Add tag">
          + Add
        </Button>
      </div>

      <div
        ref={panelRef}
        tabIndex={0}
        onKeyDown={onPanelKeyDown}
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5 outline-none"
      >
        {tags.length === 0 ? (
          <div className="px-2 py-3 text-xs leading-relaxed text-ink-faint">
            No tags yet. Add a reusable fragment (e.g. <span className="text-accent">#colors1 bright orange</span>)
            and reference it with <span className="text-accent">#colors1</span> in any prompt field.
          </div>
        ) : (
          tags.map((t) => {
            const invalid = !isValidTagName(t.name) || (nameCount.get(t.name) ?? 0) > 1;
            return (
              <TagRow
                key={t.id}
                tag={t}
                selected={selectedTagIds.includes(t.id)}
                invalid={invalid}
                autoFocus={t.id === focusId}
                onSelect={(additive) => handleSelect(t.id, additive)}
                onFocusPanel={() => panelRef.current?.focus()}
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
            );
          })
        )}
      </div>
    </div>
  );
}

interface TagRowProps {
  tag: PromptTag;
  selected: boolean;
  invalid: boolean;
  autoFocus: boolean;
  onSelect: (additive: boolean) => void;
  onFocusPanel: () => void;
  onCommit: (text: string) => void;
  onDelete: () => void;
}

function TagRow({
  tag,
  selected,
  invalid,
  autoFocus,
  onSelect,
  onFocusPanel,
  onCommit,
  onDelete,
}: TagRowProps) {
  // Local text keeps the caret stable while typing; we resync only when the
  // tag changes from OUTSIDE this row (undo/redo/paste) — detected by comparing
  // the formatted forms (our own edits already match, so no spurious resync).
  const [text, setText] = useState(() => formatTagLine(tag));
  useLayoutEffect(() => {
    const formatted = formatTagLine(tag);
    if (formatTagLine(parseTagLine(text)) !== formatted) setText(formatted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag.name, tag.body]);

  const onDragStart = (e: ReactDragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData(TAG_MIME, tag.name);
    e.dataTransfer.effectAllowed = "copy";
  };

  const onRowMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("input,button")) return; // let the field / delete handle it
    onSelect(e.metaKey || e.ctrlKey || e.shiftKey);
    onFocusPanel();
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onMouseDown={onRowMouseDown}
      className={`group flex items-center gap-1 rounded-md border px-1 py-0.5 ${
        selected ? "border-accent bg-accent-soft/40" : "border-transparent hover:bg-surface-2"
      }`}
    >
      <span
        className="cursor-grab select-none px-0.5 text-ink-faint"
        title="Drag onto a prompt field or box to reference this tag"
      >
        ⋮⋮
      </span>
      <input
        type="text"
        value={text}
        autoFocus={autoFocus}
        spellCheck={false}
        placeholder="#name body"
        onFocus={() => onSelect(false)}
        onChange={(e) => {
          const v = e.currentTarget.value;
          setText(v);
          onCommit(v);
        }}
        className={`min-w-0 flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-ink-faint ${
          invalid ? "text-danger" : "text-ink"
        }`}
      />
      <button
        type="button"
        title="Delete tag"
        onClick={onDelete}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-faint opacity-0 transition hover:bg-surface-3 hover:text-danger group-hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}
