import { useRef, useState } from "react";
import type { ColumnPrefs } from "./columns";
import { IconSettings, IconClose, IconGrip, IconArrowUp, IconArrowDown } from "./Icon";

/** A "⚙ Columns" button + popover to reorder, remove, add, and reset the columns
 * for one view. Generic over any ColumnPrefs + a label lookup. */
export function ColumnManager({
  prefs,
  labelOf,
  align = "left",
}: {
  prefs: ColumnPrefs;
  labelOf: (id: string) => string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [toAdd, setToAdd] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Closing via ✕ or Escape puts keyboard focus back on the "⚙ Columns" trigger
  // (otherwise it falls to <body> when the popover unmounts).
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const doAdd = () => {
    if (toAdd) {
      prefs.add(toAdd);
      setToAdd("");
    }
  };

  return (
    <span style={S.wrap}>
      <button ref={triggerRef} className="btn btn-ghost btn-sm" onClick={() => setOpen((o) => !o)}
        title="customize columns" aria-expanded={open}>
        <IconSettings /> Columns
      </button>
      {open && (
        <div style={{ ...S.pop, left: align === "left" ? 0 : undefined, right: align === "right" ? 0 : undefined }}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}>
          <div style={S.head}>
            <span style={S.title}>Columns</span>
            <button className="btn btn-ghost btn-sm" style={S.reset} onClick={prefs.reset} title="restore default layout">Reset</button>
            <button className="btn btn-ghost btn-sm" style={S.close} onClick={close} aria-label="close column manager"><IconClose /></button>
          </div>

          <div style={S.list}>
            {prefs.ids.map((id, i) => (
              <div
                key={id}
                style={{ ...S.item, ...(overId === id && dragId && dragId !== id ? S.itemOver : null), opacity: dragId === id ? 0.4 : 1 }}
                draggable
                onDragStart={(e) => { setDragId(id); e.dataTransfer.effectAllowed = "move"; }}
                onDragOver={(e) => { e.preventDefault(); if (dragId && dragId !== id) setOverId(id); }}
                onDragLeave={() => setOverId((o) => (o === id ? null : o))}
                onDrop={(e) => { e.preventDefault(); if (dragId && dragId !== id) prefs.reorder(dragId, i); setDragId(null); setOverId(null); }}
                onDragEnd={() => { setDragId(null); setOverId(null); }}
              >
                <span style={S.grip} title="drag to reorder"><IconGrip /></span>
                <span style={S.itemLabel}>{labelOf(id)}</span>
                <button className="btn btn-ghost btn-sm" style={S.mv} disabled={i === 0} onClick={() => prefs.move(id, -1)} title="move up" aria-label={`move ${labelOf(id)} up`}><IconArrowUp /></button>
                <button className="btn btn-ghost btn-sm" style={S.mv} disabled={i === prefs.ids.length - 1} onClick={() => prefs.move(id, 1)} title="move down" aria-label={`move ${labelOf(id)} down`}><IconArrowDown /></button>
                <button className="btn btn-ghost btn-sm" style={S.rm} onClick={() => prefs.remove(id)} title="remove" aria-label={`remove ${labelOf(id)}`}><IconClose /></button>
              </div>
            ))}
            {prefs.ids.length === 0 && <div style={S.empty}>No columns — add one below.</div>}
          </div>

          <div style={S.addRow}>
            <select className="field" style={S.select} value={toAdd} onChange={(e) => setToAdd(e.target.value)}>
              <option value="">Add a column…</option>
              {prefs.available.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            <button className="btn btn-primary btn-sm" onClick={doAdd} disabled={!toAdd}>Add</button>
          </div>
        </div>
      )}
    </span>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { position: "relative", display: "inline-block" },
  pop: { position: "absolute", top: "calc(100% + 6px)", width: 260, background: "var(--pop)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-pop)", zIndex: "var(--z-popover)", padding: 10 },
  head: { display: "flex", alignItems: "center", gap: 8, paddingBottom: 8, borderBottom: "1px solid var(--border-hairline)" },
  title: { fontSize: "var(--fs-sm)", fontWeight: 700, flex: 1, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-dim)" },
  reset: { color: "var(--accent-quiet)" },
  close: { color: "var(--text-faint)" },
  list: { maxHeight: 320, overflowY: "auto", padding: "6px 0" },
  item: { display: "flex", alignItems: "center", gap: 4, padding: "3px 2px", borderRadius: "var(--r-sm)", cursor: "grab" },
  itemOver: { boxShadow: "inset 0 2px 0 var(--accent)", background: "var(--panel-2)" },
  grip: { color: "var(--text-faint)", fontSize: 13, cursor: "grab", userSelect: "none" },
  itemLabel: { flex: 1, fontSize: "var(--fs-sm)", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  mv: { padding: "1px 6px", lineHeight: 1.4 },
  rm: { color: "var(--neg-strong)", borderColor: "#5a2a3c", padding: "1px 7px" },
  empty: { color: "var(--text-faint)", fontSize: "var(--fs-xs)", padding: "6px 2px" },
  addRow: { display: "flex", gap: 6, paddingTop: 8, borderTop: "1px solid var(--border-hairline)" },
  select: { flex: 1, minWidth: 0 },
};
