import { useUiStore } from "../state/uiStore";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { TopBar } from "./TopBar";
import { FocusView } from "./focus/FocusView";
import { GraphView } from "./graph/GraphView";
import { SettingsModal } from "./SettingsModal";

export function AppShell() {
  const viewMode = useUiStore((s) => s.viewMode);
  useKeyboardShortcuts();

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="flex min-h-0 flex-1 flex-col">
        {viewMode === "focus" ? <FocusView /> : <GraphView />}
      </main>
      <SettingsModal />
    </div>
  );
}
