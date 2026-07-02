import { PromptPanel } from "./PromptPanel";
import { TagsPanel } from "./TagsPanel";
import { ImageStage } from "./ImageStage";
import { ResultCycler } from "./ResultCycler";
import { StatusBar } from "./StatusBar";
import { BoxPanel } from "./BoxPanel";

// Three columns. Left: vertical split — PromptPanel sizes to its content at the
// top; TagsPanel grows to fill the remaining space below it. Center: ImageStage
// with StatusBar (node nav + result label) + ResultCycler controls. Right:
// BoxPanel — edits the selected box (clears when none is selected).
export function FocusView() {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[300px_1fr_300px] gap-0">
      {/* Left column */}
      <div className="flex min-h-0 flex-col border-r border-border bg-surface-1">
        <div className="min-h-0 shrink overflow-hidden">
          <PromptPanel />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden border-t border-border">
          <TagsPanel />
        </div>
      </div>

      {/* Center column. Tight top/bottom padding (pt-[3px] above the StatusBar,
          pb-[3px] below the ResultCycler). Both the StatusBar→ImageStage and
          ImageStage→ResultCycler gaps are halved to 6px via -mb-1.5 / -mt-1.5
          (gap-3 = 12px less 6px). */}
      <div className="flex min-h-0 flex-col gap-3 px-3 pb-[3px] pt-[3px]">
        <div className="-mb-1.5">
          <StatusBar />
        </div>
        <ImageStage />
        <div className="-mt-1.5">
          <ResultCycler />
        </div>
      </div>

      {/* Right column */}
      <BoxPanel />
    </div>
  );
}
