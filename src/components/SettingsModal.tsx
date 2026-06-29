import { useEffect, useState } from "react";
import { useSettingsStore } from "../state/settingsStore";
import { RESOLUTIONS, RENDERING_SPEEDS } from "../types";
import { useUiStore } from "../state/uiStore";
import { Button, Field, inputClass, selectClass } from "./common/ui";

export function SettingsModal() {
  const open = useUiStore((s) => s.settingsOpen);
  const close = useUiStore((s) => s.closeSettings);

  const settings = useSettingsStore();
  const [apiKey, setApiKey] = useState(settings.apiKey);

  useEffect(() => {
    if (open) setApiKey(useSettingsStore.getState().apiKey);
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
    settings.setApiKey(apiKey.trim());
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
          <Field label="Ideogram API key">
            {/* username field helps password managers associate the secret */}
            <input
              type="text"
              name="username"
              autoComplete="username"
              value="ideogram"
              readOnly
              hidden
            />
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              className={inputClass}
              placeholder="Api-Key…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoFocus
            />
            <span className="text-xs text-ink-faint">
              Stored in this browser's localStorage and sent per-request through the proxy. The web
              platform has no app-readable secret store; your browser's password manager may offer to
              save it.
            </span>
          </Field>

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
