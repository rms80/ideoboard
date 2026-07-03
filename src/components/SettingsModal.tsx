import { useEffect, useState } from "react";
import { useSettingsStore } from "../state/settingsStore";
import type { Provider } from "../state/settingsStore";
import { RESOLUTIONS, RENDERING_SPEEDS } from "../types";
import { useUiStore } from "../state/uiStore";
import { Button, Field, inputClass, selectClass } from "./common/ui";

// Provider tabs — the selected tab is the backend used for generation.
const PROVIDER_TABS: { id: Provider; label: string }[] = [
  { id: "fal", label: "Fal.ai" },
  { id: "ideogram", label: "Ideogram" },
];

export function SettingsModal() {
  const open = useUiStore((s) => s.settingsOpen);
  const close = useUiStore((s) => s.closeSettings);

  const settings = useSettingsStore();
  const [provider, setProvider] = useState<Provider>(settings.provider);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [falApiKey, setFalApiKey] = useState(settings.falApiKey);

  useEffect(() => {
    if (open) {
      const s = useSettingsStore.getState();
      setProvider(s.provider);
      setApiKey(s.apiKey);
      setFalApiKey(s.falApiKey);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    settings.setProvider(provider);
    settings.setApiKey(apiKey.trim());
    settings.setFalApiKey(falApiKey.trim());
    close();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <form
        onSubmit={save}
        className="w-full max-w-md rounded-xl border border-border bg-surface-1 p-5 shadow-2xl"
      >
        <h2 className="mb-4 text-lg font-semibold text-ink">Settings</h2>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
              API provider
            </span>

            {/* Nested tabs: the active tab is the backend used for generation. */}
            <div
              role="tablist"
              className="flex items-center gap-1 rounded-md border border-border bg-surface-0 p-1"
            >
              {PROVIDER_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={provider === t.id}
                  onClick={() => setProvider(t.id)}
                  className={`flex-1 rounded px-2 py-1 text-xs font-medium transition ${
                    provider === t.id
                      ? "bg-accent text-white"
                      : "text-ink-dim hover:bg-surface-2 hover:text-ink"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* One username hint (= provider) lets a password manager keep the two
                keys as distinct logins. */}
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={provider}
              readOnly
              hidden
            />

            {provider === "fal" ? (
              <label className="flex flex-col gap-1">
                <input
                  key="fal"
                  type="password"
                  name="fal-key"
                  autoComplete="current-password"
                  className={inputClass}
                  placeholder="Fal Api-Key…"
                  value={falApiKey}
                  onChange={(e) => setFalApiKey(e.target.value)}
                  autoFocus
                />
                <span className="text-xs text-ink-faint">
                  Called directly from your browser (no proxy) — get one at{" "}
                  <span className="text-ink-dim">fal.ai/dashboard/keys</span>. Stored in this
                  browser's localStorage.
                </span>
              </label>
            ) : (
              <label className="flex flex-col gap-1">
                <input
                  key="ideogram"
                  type="password"
                  name="ideogram-key"
                  autoComplete="current-password"
                  className={inputClass}
                  placeholder="Ideogram Api-Key…"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoFocus
                />
                <span className="text-xs text-ink-faint">
                  Relayed per-request through this app's proxy to Ideogram. Stored in this browser's
                  localStorage.
                </span>
              </label>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Default resolution">
              <select
                className={selectClass}
                value={settings.defaultResolution}
                onChange={(e) => settings.setDefaultResolution(e.target.value)}
              >
                {RESOLUTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Default speed">
              <select
                className={selectClass}
                value={settings.defaultRenderingSpeed}
                onChange={(e) => settings.setDefaultRenderingSpeed(e.target.value as never)}
              >
                {RENDERING_SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm text-ink-dim">
            <input
              type="checkbox"
              checked={settings.enableCopyrightDetection}
              onChange={(e) => settings.setEnableCopyrightDetection(e.target.checked)}
            />
            Enable copyright detection
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant="accent">
            Save
          </Button>
        </div>
      </form>
    </div>
  );
}
