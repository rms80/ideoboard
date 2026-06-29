// ───────────────────────────────────────────────────────────────────────────
// TagField — the reusable tag-aware text input used by ALL free-text prompt
// fields (and, from Milestone 5, box fields). Built on a real <input>/<textarea>
// so plain-text round-tripping and autocomplete stay rock-solid.
//
// The DATA MODEL is always PLAIN TEXT containing `#name` tokens — chips/previews
// are purely a render concern. Features:
//   • `#`-autocomplete (filtered by typed prefix; ↑/↓ navigate, Tab/Enter
//     complete, Esc dismiss).
//   • drag-and-drop of a tag (mime `application/x-ideoboard-tag`, data = bare
//     name) → appends `#name` (or calls `onDropTag`).
//   • resolved-body preview + amber "undefined: #x" flagging below the field,
//     plus a native title tooltip showing the fully-resolved text.
//   • right-click "Create tag from selection" via the shared ContextMenu.
//
// The prop contract is FROZEN — do not change it.
// ───────────────────────────────────────────────────────────────────────────
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  ChangeEvent,
  DragEvent as ReactDragEvent,
  FormEvent as ReactFormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  RefObject,
  SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import type { PromptTag } from "../../types";
import { extractTagRefs, findUndefinedRefs, isValidTagName, resolveText } from "../../services/tags";
import { newId } from "../../util/id";
import { useSceneStore } from "../../state/sceneStore";
import { useUiStore } from "../../state/uiStore";
import { Button, inputClass } from "./ui";
import { useContextMenu } from "./ContextMenu";

const TAG_MIME = "application/x-ideoboard-tag";
/** Tag-name char class (mirrors services/tags.ts). */
const NAME_CHAR = /[A-Za-z0-9_-]/;

export interface TagFieldProps {
  value: string;
  onChange: (value: string) => void;
  tags: PromptTag[]; // node tags for #autocomplete + tooltip resolution
  multiline?: boolean; // default false
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  onDropTag?: (tagName: string) => void; // optional override; default appends "#name"
}

type FieldEl = HTMLInputElement | HTMLTextAreaElement;

interface MenuState {
  matches: PromptTag[];
  start: number; // index of the '#' that begins the active token
  end: number; // caret index (end of the typed prefix)
  index: number; // highlighted match
}

/**
 * If the caret sits inside a `#name` token being typed, return the token's
 * start index (the '#') and the partial name typed so far; else null.
 */
function getActiveTagQuery(value: string, caret: number): { start: number; query: string } | null {
  let i = caret - 1;
  while (i >= 0) {
    const ch = value[i];
    if (NAME_CHAR.test(ch)) {
      i--;
      continue;
    }
    if (ch === "#") return { start: i, query: value.slice(i + 1, caret) };
    return null;
  }
  return null;
}

export function TagField(props: TagFieldProps): JSX.Element {
  const { value, onChange, tags, multiline = false, placeholder, className, ariaLabel, disabled } =
    props;

  const fieldRef = useRef<FieldEl | null>(null);
  const pendingCaretRef = useRef<number | null>(null);
  const dismissedRef = useRef(false);

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  // "Convert to tag" modal: captures the selection range + text to replace, then
  // prompts for a name. Null when closed.
  const [convert, setConvert] = useState<{ start: number; end: number; selected: string } | null>(
    null,
  );
  const [convertName, setConvertName] = useState("");

  const addTag = useSceneStore((s) => s.addTag);
  const setSelectedTags = useUiStore((s) => s.setSelectedTags);
  const requestTagEdit = useUiStore((s) => s.requestTagEdit);
  const { menu: ctxMenu, open: openCtx } = useContextMenu();

  // Close the Convert modal on Escape (only while it's open).
  useEffect(() => {
    if (!convert) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConvert(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [convert]);

  const submitConvert = (e: ReactFormEvent) => {
    e.preventDefault();
    if (!convert) return;
    const name = convertName.trim();
    if (!isValidTagName(name)) return;
    const id = newId();
    addTag({ id, name, body: convert.selected });
    setSelectedTags([id]);
    // Replace the selected text in the source field with the new "#name" reference.
    onChange(value.slice(0, convert.start) + "#" + name + value.slice(convert.end));
    setConvert(null);
  };

  // Re-apply caret after a controlled value swap (autocomplete completion).
  useLayoutEffect(() => {
    const pos = pendingCaretRef.current;
    if (pos != null && fieldRef.current) {
      fieldRef.current.focus();
      fieldRef.current.setSelectionRange(pos, pos);
      pendingCaretRef.current = null;
    }
  });

  // Anchor the autocomplete dropdown below the field (portal → escapes overflow).
  useLayoutEffect(() => {
    if (!menu) {
      setRect(null);
      return;
    }
    const update = () => {
      const el = fieldRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({ top: r.bottom + 2, left: r.left, width: r.width });
      }
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
    // Reposition when the field can move/grow (value change → textarea growth).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu !== null, value]);

  function refreshMenu() {
    const el = fieldRef.current;
    if (!el) return;
    if (dismissedRef.current) {
      setMenu(null);
      return;
    }
    const caret = el.selectionStart ?? el.value.length;
    const active = getActiveTagQuery(el.value, caret);
    if (!active) {
      setMenu(null);
      return;
    }
    const matches = tags.filter((t) => t.name && t.name.startsWith(active.query));
    if (matches.length === 0) {
      setMenu(null);
      return;
    }
    setMenu({ matches, start: active.start, end: caret, index: 0 });
  }

  function complete(tag: PromptTag) {
    const el = fieldRef.current;
    if (!el || !menu) return;
    const v = el.value;
    const before = v.slice(0, menu.start);
    const after = v.slice(menu.end);
    const insert = "#" + tag.name + " ";
    onChange(before + insert + after);
    pendingCaretRef.current = before.length + insert.length;
    setMenu(null);
  }

  const handleChange = (e: ChangeEvent<FieldEl>) => {
    dismissedRef.current = false;
    onChange(e.currentTarget.value);
    refreshMenu();
  };

  const handleSelect = (_e: SyntheticEvent<FieldEl>) => {
    refreshMenu();
  };

  const handleKeyDown = (e: ReactKeyboardEvent<FieldEl>) => {
    // Escape with no autocomplete open "commits" the field: edits are already live
    // in the draft (onChange writes through), so this just ends the editing session
    // by blurring. Stop propagation so it isn't also read as e.g. clear-selection.
    if (e.key === "Escape" && !menu) {
      e.preventDefault();
      e.stopPropagation();
      fieldRef.current?.blur();
      return;
    }
    if (!menu) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMenu({ ...menu, index: Math.min(menu.index + 1, menu.matches.length - 1) });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMenu({ ...menu, index: Math.max(menu.index - 1, 0) });
    } else if (e.key === "Enter" || e.key === "Tab") {
      // While the dropdown is open these complete — never submit/blur/newline.
      e.preventDefault();
      complete(menu.matches[menu.index]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      dismissedRef.current = true;
      setMenu(null);
    }
  };

  const handleDragOver = (e: ReactDragEvent<FieldEl>) => {
    if (Array.from(e.dataTransfer.types).includes(TAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    }
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (e: ReactDragEvent<FieldEl>) => {
    const name = e.dataTransfer.getData(TAG_MIME);
    if (!name) return;
    e.preventDefault();
    setDragOver(false);
    if (props.onDropTag) {
      props.onDropTag(name);
      return;
    }
    const sep = value.length === 0 || /\s$/.test(value) ? "" : " ";
    onChange(value + sep + "#" + name);
  };

  const handleContextMenu = (e: ReactMouseEvent<FieldEl>) => {
    const el = fieldRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const selected = el.value.slice(start, end).trim();
    openCtx(e, [
      {
        // Copy the selected text into a brand-new (unnamed) tag's body and drop
        // into its editor; the source field is left unchanged.
        label: "Copy to new tag",
        disabled: !selected,
        onSelect: () => {
          const id = newId();
          // Set the edit request BEFORE adding the tag so it's already in place on
          // the render where the new row first mounts (cross-store updates may not
          // batch). Seeds the row "# <selection>", caret just after the '#'.
          requestTagEdit(id, true);
          setSelectedTags([id]);
          addTag({ id, name: "", body: selected });
        },
      },
      {
        // Prompt for a name, create the tag, and replace the selection in the
        // source field with the "#name" reference.
        label: "Convert to tag…",
        disabled: !selected,
        onSelect: () => {
          setConvertName("");
          setConvert({ start, end, selected });
        },
      },
    ]);
  };

  const refs = extractTagRefs(value);
  const undefinedRefs = findUndefinedRefs(value, tags);
  const resolved = refs.length ? resolveText(value, tags) : "";

  const fieldClass = [
    inputClass,
    multiline ? "min-h-20 resize-y" : "",
    dragOver ? "ring-2 ring-accent ring-inset" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const shared = {
    value,
    placeholder,
    disabled,
    "aria-label": ariaLabel,
    title: refs.length ? resolved : undefined,
    className: fieldClass,
    spellCheck: false as const,
    onChange: handleChange,
    onSelect: handleSelect,
    onKeyDown: handleKeyDown,
    // Genuine focus-out closes the dropdown. Clicks ON the dropdown preventDefault
    // their mousedown, so they don't blur the field and aren't lost.
    onBlur: () => setMenu(null),
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
    onContextMenu: handleContextMenu,
  };

  return (
    <div className="relative flex flex-col gap-1">
      {multiline ? (
        <textarea ref={fieldRef as RefObject<HTMLTextAreaElement>} {...shared} />
      ) : (
        <input ref={fieldRef as RefObject<HTMLInputElement>} type="text" {...shared} />
      )}

      {undefinedRefs.length > 0 && (
        <div className="text-[11px] leading-tight text-amber-400">
          undefined: {undefinedRefs.map((n) => "#" + n).join(", ")}
        </div>
      )}

      {menu &&
        rect &&
        createPortal(
          <ul
            className="fixed z-50 max-h-56 overflow-auto rounded-md border border-border bg-surface-2 py-1 text-sm shadow-lg"
            style={{ top: rect.top, left: rect.left, minWidth: Math.max(rect.width, 160) }}
            // Keep the field focused so the click lands as a completion, not a blur.
            onMouseDown={(e) => e.preventDefault()}
          >
            {menu.matches.map((t, i) => (
              <li key={t.id}>
                <button
                  type="button"
                  className={`flex w-full items-baseline gap-2 px-3 py-1 text-left ${
                    i === menu.index ? "bg-accent-soft text-ink" : "text-ink-dim hover:bg-surface-3"
                  }`}
                  onMouseEnter={() => setMenu((m) => (m ? { ...m, index: i } : m))}
                  onClick={() => complete(t)}
                >
                  <span className="shrink-0 font-medium text-accent">#{t.name}</span>
                  <span className="truncate text-ink-faint">{t.body}</span>
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )}

      {convert &&
        createPortal(
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setConvert(null);
            }}
          >
            <form
              onSubmit={submitConvert}
              className="w-full max-w-sm rounded-xl border border-border bg-surface-1 p-5 shadow-2xl"
            >
              <h2 className="mb-3 text-lg font-semibold text-ink">Convert to tag</h2>
              {/* Live preview of the resulting tag line; updates as you type. */}
              <p className="mb-3 truncate text-sm" title={convert.selected}>
                <span className="font-medium text-accent">#{convertName.trim() || "tagname"}</span>{" "}
                <span className="text-ink-faint">{convert.selected}</span>
              </p>
              <input
                type="text"
                className={inputClass}
                autoFocus
                spellCheck={false}
                // Stop browsers / password managers from treating this lone field
                // as a credential input.
                autoComplete="off"
                name="tag-name"
                data-1p-ignore="true"
                data-lpignore="true"
                placeholder="name"
                value={convertName}
                onChange={(e) => setConvertName(e.target.value)}
              />
              {convertName.trim() !== "" && !isValidTagName(convertName.trim()) && (
                <p className="mt-1 text-xs text-danger">
                  Use only letters, numbers, “_” or “-”.
                </p>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setConvert(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="accent" disabled={!isValidTagName(convertName.trim())}>
                  Create
                </Button>
              </div>
            </form>
          </div>,
          document.body,
        )}

      {ctxMenu}
    </div>
  );
}
