/**
 * Library palette (UX1-T7, master §9.6/§6.3): search-as-you-type, category
 * tree, favorites + recents, preview card. Clicking a symbol arms placement
 * (ghost follows the cursor on the canvas; Enter/re-click places and re-arms).
 */
import { useMemo, useState } from "react";
import { useEditorStore } from "../editor/store.ts";
import { LIBRARY_CATEGORIES, SYMBOL_LIBRARY, searchLibrary, symbolById } from "../symbols/index.ts";

const FAV_KEY = "studio.library.favorites";
const RECENT_KEY = "studio.library.recents";

function readIds(key: string): string[] {
  try {
    const raw = globalThis.localStorage.getItem(key);
    return raw === null ? [] : (JSON.parse(raw) as string[]);
  } catch {
    return [];
  }
}

function writeId(key: string, id: string): void {
  try {
    const ids = readIds(key).filter((x) => x !== id);
    ids.unshift(id);
    globalThis.localStorage.setItem(key, JSON.stringify(ids.slice(0, 8)));
  } catch {
    // storage unavailable — favorites/recents are best-effort
  }
}

export function LibraryPanel(): React.ReactNode {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>(() => readIds(FAV_KEY));
  const [recents] = useState<string[]>(() => readIds(RECENT_KEY));

  const startPlace = useEditorStore((s) => s.startPlace);

  const results = useMemo(() => {
    const base = query.trim() === "" ? SYMBOL_LIBRARY : searchLibrary(query);
    return category === null ? base : base.filter((d) => d.category === category);
  }, [query, category]);

  const preview = previewId !== null ? symbolById(previewId) : undefined;

  const arm = (id: string): void => {
    setPreviewId(id);
    writeId(RECENT_KEY, id);
    startPlace(id);
  };

  const toggleFavorite = (id: string): void => {
    const next = favorites.includes(id) ? favorites.filter((f) => f !== id) : [id, ...favorites];
    setFavorites(next);
    try {
      globalThis.localStorage.setItem(FAV_KEY, JSON.stringify(next.slice(0, 8)));
    } catch {
      // best-effort
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="library-panel">
      <div className="border-b border-line p-2">
        <input
          aria-label="Search symbols"
          data-testid="library-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search (name, keyword, value)"
          className="h-7 w-full rounded-md border border-line bg-panel px-2 text-xs text-fg placeholder:text-faint focus:border-accent focus:outline-none"
        />
        <div className="mt-2 flex flex-wrap gap-1">
          <CatChip label="All" active={category === null} onClick={() => setCategory(null)} />
          {LIBRARY_CATEGORIES.map((c) => (
            <CatChip key={c} label={c} active={category === c} onClick={() => setCategory(c)} />
          ))}
        </div>
      </div>

      {(favorites.length > 0 || recents.length > 0) && (
        <div className="border-b border-line px-2 py-1.5">
          {favorites.length > 0 && <Row title="Favorites" ids={favorites} onPick={arm} />}
          {recents.length > 0 && <Row title="Recent" ids={recents} onPick={arm} />}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="library-list">
        {results.map((d) => (
          <button
            key={d.id}
            type="button"
            data-testid={`library-item-${d.id}`}
            onClick={() => arm(d.id)}
            onDoubleClick={() => toggleFavorite(d.id)}
            className={`flex w-full items-center justify-between border-b border-line/50 px-2 py-1.5 text-left text-xs hover:bg-elevated ${
              previewId === d.id ? "bg-elevated" : ""
            }`}
          >
            <span className="text-fg">{d.name}</span>
            <span className="flex items-center gap-1">
              {favorites.includes(d.id) && <span aria-hidden="true">★</span>}
              <span className="text-2xs text-faint">{d.category}</span>
            </span>
          </button>
        ))}
      </div>

      {preview !== undefined && (
        <div className="border-t border-line p-2 text-2xs" data-testid="library-preview">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs text-fg">{preview.name}</span>
            <button
              type="button"
              className="text-faint hover:text-fg"
              onClick={() => toggleFavorite(preview.id)}
            >
              {favorites.includes(preview.id) ? "★" : "☆"}
            </button>
          </div>
          <div className="text-muted">
            SPICE {preview.spice.prefix}-prefix · pins:{" "}
            {preview.pins.map((p) => p.name || p.num).join(", ") || "—"}
          </div>
          {preview.spice.template !== undefined && (
            <div className="mt-1 truncate font-mono text-faint">
              {preview.spice.template.split("\n")[0]}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CatChip({
  label,
  active,
  onClick,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}): React.ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2 py-0.5 text-2xs ${
        active ? "border-accent bg-accent-soft text-fg" : "border-line text-muted hover:text-fg"
      }`}
    >
      {label}
    </button>
  );
}

function Row({
  title,
  ids,
  onPick,
}: {
  readonly title: string;
  readonly ids: readonly string[];
  readonly onPick: (id: string) => void;
}): React.ReactNode {
  return (
    <div className="flex items-center gap-1 py-0.5">
      <span className="w-14 shrink-0 text-2xs text-faint">{title}</span>
      <div className="flex flex-wrap gap-1">
        {ids.map((id) => {
          const d = symbolById(id);
          return d === undefined ? null : (
            <CatChip key={id} label={d.name} active={false} onClick={() => onPick(id)} />
          );
        })}
      </div>
    </div>
  );
}
