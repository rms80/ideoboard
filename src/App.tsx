import { useEffect, useState } from "react";
import { loadInitial, flushAutosave } from "./services/persistence";
import { AppShell } from "./components/AppShell";

export function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    loadInitial()
      .then(() => active && setReady(true))
      .catch((err) => {
        console.error("Failed to load:", err);
        if (active) setReady(true);
      });
    const onUnload = () => flushAutosave();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      active = false;
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-ink-faint">Loading…</div>
    );
  }
  return <AppShell />;
}
