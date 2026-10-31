/**
 * Inspector panel (UX1-T8, §6.4): selection → properties; empty → document
 * settings. Every edit routes through the editor store (one coalesced undo
 * step per gesture via the history commit).
 */
import { useEditorStore } from "../editor/store.ts";
import { referenceOf } from "../schematic/instances.ts";
import { symbolById } from "../symbols/index.ts";
import { Field } from "../ui/Field.tsx";

export function InspectorPanel(): React.ReactNode {
  const sel = useEditorStore((s) => s.sel);
  const doc = useEditorStore((s) => s.doc);
  const setDoc = useEditorStore((s) => s.setDoc);

  const ids = [...sel.symbols];
  if (ids.length === 0) {
    return (
      <div className="flex h-full flex-col gap-3 p-3 text-xs" data-testid="inspector-panel">
        <div className="text-2xs font-semibold uppercase tracking-wide text-faint">Document</div>
        <Field label="Title">
          <input
            aria-label="Document title"
            value={doc.title}
            onChange={(e) => setDoc({ ...doc, title: e.target.value, rev: doc.rev + 1 })}
            className="h-7 w-full rounded-md border border-line bg-panel px-2 text-xs text-fg focus:border-accent focus:outline-none"
          />
        </Field>
        <p className="text-muted">
          Select a symbol on the canvas to edit its reference and value. Grid is {doc.grid / 10}{" "}
          mil.
        </p>
      </div>
    );
  }

  const first = doc.symbols.find((s) => s.id === ids[0]);
  if (first === undefined) return null;
  const def = symbolById(first.defId);
  if (def === undefined) return null;

  const setField = (key: string, value: string): void => {
    const symbols = doc.symbols.map((s) =>
      sel.symbols.has(s.id) ? { ...s, fields: { ...s.fields, [key]: value } } : s,
    );
    setDoc({ ...doc, symbols, rev: doc.rev + 1 });
  };
  const setProp = (key: string, value: string): void => {
    const symbols = doc.symbols.map((s) =>
      sel.symbols.has(s.id) ? { ...s, props: { ...s.props, [key]: value } } : s,
    );
    setDoc({ ...doc, symbols, rev: doc.rev + 1 });
  };

  return (
    <div
      className="flex h-full flex-col gap-2 overflow-y-auto p-3 text-xs"
      data-testid="inspector-panel"
    >
      <div className="text-2xs font-semibold uppercase tracking-wide text-faint">
        {ids.length > 1 ? `${ids.length} symbols` : def.name}
      </div>
      <Field label="Reference">
        <input
          aria-label="Reference"
          value={referenceOf(first)}
          onChange={(e) => setField("reference", e.target.value)}
          className="h-7 w-full rounded-md border border-line bg-panel px-2 text-xs text-fg focus:border-accent focus:outline-none"
        />
      </Field>
      {(() => {
        const valueUnit = def.properties.find((p) => p.key === "value")?.unit;
        return (
          <Field label="Value" {...(valueUnit !== undefined ? { unit: valueUnit } : {})}>
            <input
              aria-label="Value"
              value={first.fields.value ?? ""}
              onChange={(e) => setField("value", e.target.value)}
              className="h-7 w-full rounded-md border border-line bg-panel px-2 font-mono text-xs text-fg focus:border-accent focus:outline-none"
            />
          </Field>
        );
      })()}
      {def.properties
        .filter((p) => p.key !== "value")
        .map((p) => (
          <Field key={p.key} label={p.label} {...(p.unit !== undefined ? { unit: p.unit } : {})}>
            {p.options === undefined ? (
              <input
                aria-label={p.label}
                value={first.props[p.key] ?? p.default}
                onChange={(e) => setProp(p.key, e.target.value)}
                className="h-7 w-full rounded-md border border-line bg-panel px-2 font-mono text-xs text-fg focus:border-accent focus:outline-none"
              />
            ) : (
              <select
                aria-label={p.label}
                value={first.props[p.key] ?? p.default}
                onChange={(e) => setProp(p.key, e.target.value)}
                className="h-7 w-full rounded-md border border-line bg-panel px-1 text-xs text-fg focus:border-accent focus:outline-none"
              >
                {p.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ))}
    </div>
  );
}
