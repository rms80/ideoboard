import { useUiStore } from "../state/uiStore";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { LeftBar } from "./LeftBar";
import { RightBar } from "./RightBar";
import { FocusView } from "./focus/FocusView";
import { GraphView } from "./graph/GraphView";
import { SettingsModal } from "./SettingsModal";
import { Lightbox } from "./focus/Lightbox";
import { AppTooltips } from "./common/AppTooltips";

export function AppShell() {
  const viewMode = useUiStore((s) => s.viewMode);
  useKeyboardShortcuts();

  return (
    <div className="flex h-full flex-col">
      <main className="flex min-h-0 flex-1 flex-col">
        {viewMode === "focus" ? (
          // FocusView caps its own side columns with LeftBar/RightBar; the center
          // has no bar so the image viewport reaches the top of the page.
          <FocusView />
        ) : (
          // Graph mode has no side panels to sit above, so the two control
          // clusters span the full width as a single top bar.
          <>
            <div className="flex shrink-0">
              <div className="w-[300px] shrink-0">
                <LeftBar />
              </div>
              <div className="flex-1 border-b border-border bg-surface-3" />
              <div className="w-[300px] shrink-0">
                <RightBar />
              </div>
            </div>
            <GraphView />
          </>
        )}
      </main>
      <SettingsModal />
      <Lightbox />
      <AppTooltips />
    </div>
  );
}
