import { useSceneStore } from "../../state/sceneStore";
import { RESOLUTIONS, RENDERING_SPEEDS, type Medium } from "../../types";
import { Field, selectClass } from "../common/ui";
import { TagField } from "../common/TagField";

// Free-text fields use <TagField> (#-autocomplete, drag-drop, resolved preview);
// medium/resolution/speed stay plain <select>s.
export function PromptPanel() {
  const draft = useSceneStore((s) => s.draft);
  const editDraft = useSceneStore((s) => s.editDraft);
  if (!draft) return null;

  const style = draft.style ?? {};
  const tags = draft.tags;

  return (
    <div className="flex flex-col gap-3 overflow-y-auto p-3">
      <Field label="Prompt">
        <TagField
          multiline
          tags={tags}
          ariaLabel="Prompt"
          placeholder="Describe the image…"
          value={draft.highLevelDescription}
          onChange={(v) => editDraft((p) => void (p.highLevelDescription = v))}
        />
      </Field>

      <Field label="Background">
        <TagField
          tags={tags}
          ariaLabel="Background"
          placeholder="Optional background description"
          value={draft.background ?? ""}
          onChange={(v) => editDraft((p) => void (p.background = v))}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Medium">
          <select
            className={selectClass}
            value={style.medium ?? ""}
            onChange={(e) =>
              editDraft((p) => {
                p.style ??= {};
                p.style.medium = (e.target.value || undefined) as Medium | undefined;
              })
            }
          >
            <option value="">—</option>
            <option value="photograph">photograph</option>
            <option value="graphic_design">graphic_design</option>
          </select>
        </Field>
        <Field label="Art style">
          <TagField
            tags={tags}
            ariaLabel="Art style"
            value={style.artStyle ?? ""}
            onChange={(v) =>
              editDraft((p) => {
                p.style ??= {};
                p.style.artStyle = v;
              })
            }
          />
        </Field>
        <Field label="Aesthetics">
          <TagField
            tags={tags}
            ariaLabel="Aesthetics"
            value={style.aesthetics ?? ""}
            onChange={(v) =>
              editDraft((p) => {
                p.style ??= {};
                p.style.aesthetics = v;
              })
            }
          />
        </Field>
        <Field label="Lighting">
          <TagField
            tags={tags}
            ariaLabel="Lighting"
            value={style.lighting ?? ""}
            onChange={(v) =>
              editDraft((p) => {
                p.style ??= {};
                p.style.lighting = v;
              })
            }
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Resolution">
          <select
            className={selectClass}
            value={draft.resolution}
            onChange={(e) => editDraft((p) => void (p.resolution = e.target.value))}
          >
            {RESOLUTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Speed">
          <select
            className={selectClass}
            value={draft.renderingSpeed}
            onChange={(e) => editDraft((p) => void (p.renderingSpeed = e.target.value as never))}
          >
            {RENDERING_SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </div>
  );
}
