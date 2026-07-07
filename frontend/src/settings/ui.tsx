// Shared bits for the Settings section components: the label/control row and the
// style fragments every section leans on. Split out of Settings.tsx (W27-4) so each
// section file stays self-contained without re-declaring the common look.

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={SS.field}>
      <span style={SS.fieldLabel}>{label}</span>
      {children}
    </div>
  );
}

export const SS: Record<string, React.CSSProperties> = {
  field: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", fontSize: "var(--fs-md)" },
  fieldLabel: { color: "var(--text-muted)" },
  input: { width: 150, textAlign: "right" },
  credInput: { width: 280, textAlign: "left" },
  credStatus: { fontSize: "var(--fs-sm)", color: "var(--text-muted)", margin: "0 0 10px" },
  toggle: { display: "flex", gap: 8, alignItems: "center", fontSize: "var(--fs-md)", color: "var(--text-muted)" },
  note: { color: "var(--text-faint)", fontSize: "var(--fs-sm)", marginTop: 16 },
};
