// ───────────────────────────────────────────────────────────────────────────
// LeftListPanel — the bottom-left tabbed list. Two tabs, TAGS and BOXES, share
// one header strip; only the active panel mounts. The tab strip is handed to the
// active panel so it renders inline where that panel's own title used to sit
// (each panel keeps its own trailing actions after the header spacer). Tab state
// is local — the underlying tag/box data + selection all live in the stores, so
// switching tabs loses nothing.
// ───────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { TagsPanel } from "./TagsPanel";
import { BoxesPanel } from "./BoxesPanel";

type LeftTab = "tags" | "boxes";
const TABS: { id: LeftTab; label: string; title: string }[] = [
  {
    id: "tags",
    label: "Tags",
    title:
      "Tags are reusable prompt fragments. Type #name in any prompt textbox and it's replaced with the tag's prompt fragment.",
  },
  {
    id: "boxes",
    label: "Boxes",
    title:
      "Boxes are regions drawn on the image — text or object — listed in z-order (front-most first). Drag to reorder; click to edit.",
  },
];

export function LeftListPanel() {
  const [tab, setTab] = useState<LeftTab>("tags");

  const tabs = (
    <div role="tablist" className="flex items-center gap-1">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          title={t.title}
          aria-selected={tab === t.id}
          onClick={() => setTab(t.id)}
          className={`rounded px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide transition ${
            tab === t.id ? "bg-surface-2 text-ink" : "text-ink-faint hover:text-ink"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  return tab === "tags" ? <TagsPanel tabs={tabs} /> : <BoxesPanel tabs={tabs} />;
}
