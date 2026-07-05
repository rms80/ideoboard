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
//   • optional `expandable`: focusing the field pops up a larger floating editor
//     (2× wide, ≥8 lines, ≥ the source's height) that IS the active editor while
//     open and collapses on Escape/blur (a plain "commit"). All the tag behaviour
//     above works inside the popup because it shares this component's handlers.
//
// The existing prop contract is FROZEN — do not change it (new props are additive).
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

// Popup editor geometry (px). LINE is the popup's line-height (leading-5); CHROME
// covers the textarea's border + vertical padding. The popup opens at least
// MIN_LINES tall and grows STEP_LINES at a time when the content overflows.
const LINE = 20;
const CHROME = 12;
const MIN_LINES = 8;
const STEP_LINES = 4;

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
  // Focusing the field opens a larger floating editor (see file header).
  expandable?: boolean;
  // Which edge of the popup pins to the source field: "left" (default) keeps the
  // left edges aligned and grows rightward; "right" keeps the right edges aligned
  // and grows leftward (use for fields living in the right-hand panel).
  expandAnchor?: "left" | "right";
}

type FieldEl = HTMLInputElement | HTMLTextAreaElement;

interface MenuState {
  matches: PromptTag[];
  start: number; // index of the '#' that begins the active token
  end: number; // caret index (end of the typed prefix)
  index: number; // highlighted match
}

interface PopupRect {
  top: number;
  left: number;
  width: number;
  baseH: number; // minimum height: max(8 lines, source height)
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
  const {
    value,
    onChange,
    tags,
    multiline = false,
    placeholder,
    className,
    ariaLabel,
    disabled,
    expandable = false,
    expandAnchor = "left",
  } = props;

  // The in-layout <input>/<textarea>: the anchor for the popup and the editor
  // when NOT expanded. `popupRef` is the floating editor; `activeField()` returns
  // whichever one is currently the live editor so all the tag logic below (caret,
  // autocomplete, context menu) transparently targets it.
  const sourceRef = useRef<FieldEl | null>(null);
  const popupRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingCaretRef = useRef<number | null>(null);
  const caretRef = useRef<{ start: number; end: number } | null>(null);
  const dismissedRef = useRef(false);

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [popupRect, setPopupRect] = useState<PopupRect | null>(null);
  const [popupH, setPopupH] = useState(0);
  // "Convert to tag" modal: captures the selection range + text to replace, then
  // prompts for a name. Null when closed.
  const [convert, setConvert] = useState<{ start: number; end: number; selected: string } | null>(
    null,
  );
  const [convertName, setConvertName] = useState("");

  const activeField = (): FieldEl | null => (expanded ? popupRef.current : sourceRef.current);

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
    const el = activeField();
    if (pos != null && el) {
      el.focus();
      el.setSelectionRange(pos, pos);
      pendingCaretRef.current = null;
    }
  });

  // Anchor the autocomplete dropdown below the ACTIVE field (portal → escapes
  // overflow). When expanded this tracks the popup textarea.
  useLayoutEffect(() => {
    if (!menu) {
      setRect(null);
      return;
    }
    const update = () => {
      const el = activeField();
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
  }, [menu !== null, value, expanded, popupH]);

  // ── Popup editor ──────────────────────────────────────────────────────────
  // Measure the source field and open the popup pinned to it.
  const measure = (): PopupRect | null => {
    const el = sourceRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const width = Math.round(r.width * 2);
    let left = expandAnchor === "right" ? Math.round(r.right - width) : Math.round(r.left);
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    const baseH = Math.max(MIN_LINES * LINE + CHROME, Math.round(r.height));
    return { top: Math.round(r.top), left, width, baseH };
  };

  const openPopup = () => {
    const pr = measure();
    if (!pr) return;
    const el = sourceRef.current;
    caretRef.current = el
      ? { start: el.selectionStart ?? el.value.length, end: el.selectionEnd ?? el.value.length }
      : null;
    setPopupRect(pr);
    setPopupH(pr.baseH);
    setExpanded(true);
  };

  const onSourceFocus = () => {
    if (!expandable || disabled || expanded) return;
    openPopup();
  };

  const onPopupBlur = () => {
    setMenu(null);
    setExpanded(false);
  };

  // Move focus into the popup (restoring the source's caret) the moment it opens.
  useLayoutEffect(() => {
    if (!expanded) return;
    const el = popupRef.current;
    if (!el) return;
    el.focus();
    const c = caretRef.current;
    caretRef.current = null;
    const len = el.value.length;
    const start = c ? Math.min(c.start, len) : len;
    const end = c ? Math.min(c.end, len) : len;
    el.setSelectionRange(start, end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  // Keep the popup pinned to the (possibly scrolling / resizing) source field.
  useLayoutEffect(() => {
    if (!expanded) return;
    const reposition = () => {
      const pr = measure();
      if (pr) setPopupRect((cur) => (cur ? { ...cur, top: pr.top, left: pr.left, width: pr.width } : pr));
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, expandAnchor]);

  // Grow the popup STEP_LINES at a time whenever its content overflows, capped at
  // the viewport bottom (past which the textarea just scrolls internally).
  useLayoutEffect(() => {
    if (!expanded || !popupRect) return;
    const el = popupRef.current;
    if (!el) return;
    if (el.scrollHeight > el.clientHeight + 2) {
      const cap = Math.max(popupRect.baseH, window.innerHeight - popupRect.top - 16);
      setPopupH((h) => Math.min(h + STEP_LINES * LINE, cap));
    }
  }, [expanded, value, popupH, popupRect]);

  function refreshMenu() {
    const el = activeField();
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
    const el = activeField();
    if (!el || !menu) return;
    const v = el.value;
    const before = v.slice(0, menu.start);
    const after = v.slice(menu.end);
    const insert = "#" + tag.name + " ";
    onChange(before + insert + after);
    pendingCaretRef.current = before.length + insert.length;
    setMenu(null);
  }

  // Tab / Shift-Tab moves between this panel's fields. The popup is portaled to
  // <body>, so native Tab order would jump into the browser chrome; instead focus
  // the previous/next field ([data-fieldnav]) within the same panel group
  // ([data-field-group]), wrapping around. Focusing a sibling source field reopens
  // ITS popup, so tabbing walks the popups in visual order. Returns false (→ let
  // the browser handle Tab) when there's no group or only a single field.
  const focusFieldBy = (dir: 1 | -1): boolean => {
    const src = sourceRef.current;
    const group = src?.closest("[data-field-group]");
    if (!src || !group) return false;
    const fields = Array.from(group.querySelectorAll<HTMLElement>("[data-fieldnav]"));
    const idx = fields.indexOf(src);
    if (idx === -1 || fields.length < 2) return false;
    fields[(idx + dir + fields.length) % fields.length].focus();
    return true;
  };

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
    // by blurring (which, for an expandable field, also closes the popup). Stop
    // propagation so it isn't also read as e.g. clear-selection.
    if (e.key === "Escape" && !menu) {
      e.preventDefault();
      e.stopPropagation();
      activeField()?.blur();
      return;
    }
    // Cycle between the panel's fields instead of tabbing into the browser chrome.
    if (e.key === "Tab" && !menu) {
      if (focusFieldBy(e.shiftKey ? -1 : 1)) e.preventDefault();
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
    const el = activeField();
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

  // Handlers shared by the source field and the popup textarea (the two are
  // never focused at once). onFocus/onBlur are attached per-element below.
  const shared = {
    value,
    placeholder,
    disabled,
    "aria-label": ariaLabel,
    title: refs.length ? resolved : undefined,
    spellCheck: false as const,
    onChange: handleChange,
    onSelect: handleSelect,
    onKeyDown: handleKeyDown,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
    onContextMenu: handleContextMenu,
  };

  const popupClass =
    "w-full resize-none overflow-y-auto rounded-md rounded-tr-none border border-accent bg-surface-0 px-2 py-1 text-xs leading-5 text-ink outline-none placeholder:text-ink-faint shadow-2xl";

  return (
    <div className="relative flex flex-col gap-1">
      {multiline ? (
        <textarea
          ref={sourceRef as RefObject<HTMLTextAreaElement>}
          {...shared}
          data-fieldnav=""
          className={fieldClass}
          onFocus={onSourceFocus}
          // Genuine focus-out closes the dropdown. Clicks ON the dropdown
          // preventDefault their mousedown, so they don't blur / aren't lost.
          onBlur={() => setMenu(null)}
        />
      ) : (
        <input
          ref={sourceRef as RefObject<HTMLInputElement>}
          type="text"
          {...shared}
          data-fieldnav=""
          className={fieldClass}
          onFocus={onSourceFocus}
          onBlur={() => setMenu(null)}
        />
      )}

      {undefinedRefs.length > 0 && (
        <div className="text-[11px] leading-tight text-amber-400">
          undefined: {undefinedRefs.map((n) => "#" + n).join(", ")}
        </div>
      )}

      {expanded &&
        popupRect &&
        createPortal(
          <div
            className="fixed z-40"
            style={{ top: popupRect.top, left: popupRect.left, width: popupRect.width }}
          >
            {/* Field's hint text as a label tab, attached to the popup's top-right
                corner (rounded top, flat bottom, sharing the popup's accent border)
                so it reads as part of the box. Absolutely positioned + open at the
                bottom so the textarea below stays pixel-aligned with the source. */}
            {placeholder && (
              <div className="pointer-events-none absolute bottom-full right-0 max-w-full truncate rounded-t border border-b-0 border-accent bg-surface-2 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-dim">
                {placeholder}
              </div>
            )}
            <textarea
              ref={popupRef}
              {...shared}
              className={popupClass}
              style={{ height: popupH }}
              onBlur={onPopupBlur}
            />
            {/* Faint hint for how to dismiss the popup. pointer-events-none so it
                never blocks selecting text in the corner beneath it. */}
            <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-surface-0/80 px-1 text-[10px] leading-none text-ink-faint">
              escape/tab to close
            </div>
          </div>,
          document.body,
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
