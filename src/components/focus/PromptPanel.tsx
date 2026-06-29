import { useSceneStore, useCurrentNodeLocked } from "../../state/sceneStore";
import { RESOLUTIONS, RENDERING_SPEEDS } from "../../types";
import { Field, selectClass } from "../common/ui";
import { TagField } from "../common/TagField";

// Free-text fields use <TagField> (#-autocomplete, drag-drop, resolved preview);
// resolution/speed stay plain <select>s. All fields lock (read-only) once the
// node has a generated image — iterate by spawning a new node instead.
export function PromptPanel() {
  const draft = useSceneStore((s) => s.draft);
  const editDraft = useSceneStore((s) => s.editDraft);
  const locked = useCurrentNodeLocked();
  if (!draft) return null;

  const style = draft.style ?? {};
  const tags = draft.tags;

  return (
    <div className="flex flex-col gap-[3px] overflow-y-auto px-1 pt-1 pb-3">
      <Field>
        <TagField
          multiline
          disabled={locked}
          tags={tags}
          ariaLabel="Prompt"
          placeholder="Describe the image…"
          value={draft.highLevelDescription}
          onChange={(v) => editDraft((p) => void (p.highLevelDescription = v))}
        />
      </Field>

      <Field>
        <TagField
          disabled={locked}
          tags={tags}
          ariaLabel="Background"
          placeholder="Optional background description"
          value={draft.background ?? ""}
          onChange={(v) => editDraft((p) => void (p.background = v))}
        />
      </Field>

      <Field>
        <TagField
          disabled={locked}
          tags={tags}
          ariaLabel="Medium"
          placeholder="Medium"
          value={style.medium ?? ""}
          onChange={(v) =>
            editDraft((p) => {
              p.style ??= {};
              p.style.medium = v;
            })
          }
        />
      </Field>
      <Field>
        <TagField
          disabled={locked}
          tags={tags}
          ariaLabel="Art style"
          placeholder="Art style"
          value={style.artStyle ?? ""}
          onChange={(v) =>
            editDraft((p) => {
              p.style ??= {};
              p.style.artStyle = v;
            })
          }
        />
      </Field>
      <Field>
        <TagField
          disabled={locked}
          tags={tags}
          ariaLabel="Aesthetics"
          placeholder="Aesthetics"
          value={style.aesthetics ?? ""}
          onChange={(v) =>
            editDraft((p) => {
              p.style ??= {};
              p.style.aesthetics = v;
            })
          }
        />
      </Field>
      <Field>
        <TagField
          disabled={locked}
          tags={tags}
          ariaLabel="Lighting"
          placeholder="Lighting"
          value={style.lighting ?? ""}
          onChange={(v) =>
            editDraft((p) => {
              p.style ??= {};
              p.style.lighting = v;
            })
          }
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field>
          <select
            className={selectClass}
            disabled={locked}
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
        <Field>
          <select
            className={selectClass}
            disabled={locked}
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
