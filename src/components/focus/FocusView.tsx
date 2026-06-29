import { PromptPanel } from "./PromptPanel";
import { TagsPanel } from "./TagsPanel";
import { ImageStage } from "./ImageStage";
import { ResultCycler } from "./ResultCycler";
import { Breadcrumb } from "./Breadcrumb";

// Two columns. Left: vertical split — PromptPanel (top ~60%) over TagsPanel
// (bottom ~40%). Right: ImageStage with Breadcrumb + ResultCycler controls.
export function FocusView() {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[360px_1fr] gap-0">
      {/* Left column */}
      <div className="flex min-h-0 flex-col border-r border-border bg-surface-1">
        <div className="min-h-0 flex-[3] overflow-hidden">
          <PromptPanel />
        </div>
        <div className="min-h-0 flex-[2] overflow-hidden border-t border-border">
          <TagsPanel />
        </div>
      </div>

      {/* Right column */}
      <div className="flex min-h-0 flex-col gap-3 p-3">
        <Breadcrumb />
        <ImageStage />
        <ResultCycler />
      </div>
    </div>
  );
}
