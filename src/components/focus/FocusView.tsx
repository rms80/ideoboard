import { PromptPanel } from "./PromptPanel";
import { TagsPanel } from "./TagsPanel";
import { ImageStage } from "./ImageStage";
import { ResultCycler } from "./ResultCycler";
import { StatusBar } from "./StatusBar";
import { BoxPanel } from "./BoxPanel";
import { LeftBar } from "../LeftBar";
import { RightBar } from "../RightBar";

// Three columns. The two half-top-bars cap the side columns (LeftBar over the
// left panel, RightBar over the right panel); the center has no bar so the image
// viewport reaches the top of the page. Left: vertical split — PromptPanel sizes
// to its content at the top; TagsPanel grows to fill the remaining space below
// it. Center: ImageStage with StatusBar (node nav + result label) + ResultCycler
// controls. Right: BoxPanel — edits the selected box (clears when none selected).
export function FocusView() {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[300px_1fr_300px] gap-0">
      {/* Left column */}
      <div className="flex min-h-0 flex-col border-r border-border bg-surface-1">
        <LeftBar />
        <div className="min-h-0 shrink overflow-hidden">
          <PromptPanel />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden border-t border-border">
          <TagsPanel />
        </div>
      </div>

      {/* Center column. Tight top/bottom padding (pt-[3px] above the StatusBar,
          pb-[6px] below the ResultCycler). The StatusBar→ImageStage gap is 3px
          (-mb-[9px]) and the ImageStage→ResultCycler gap is 6px (-mt-1.5), both
          off the gap-3 (12px) base. */}
      <div className="flex min-h-0 flex-col gap-3 px-3 pb-[6px] pt-[3px]">
        <div className="-mb-[9px]">
          <StatusBar />
        </div>
        <ImageStage />
        <div className="-mt-1.5">
          <ResultCycler />
        </div>
      </div>

      {/* Right column */}
      <div className="flex min-h-0 flex-col border-l border-border">
        <RightBar />
        <BoxPanel />
      </div>
    </div>
  );
}
