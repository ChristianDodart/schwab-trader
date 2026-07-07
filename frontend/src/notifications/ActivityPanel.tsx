import type { AuditEvent } from "../types";
import { fmtTime, matchText } from "./format";
import { PS } from "./ui";

/** The "Activity" tab: the audit log (every fill, incl. market) with history search. */
export function ActivityPanel({ audit, q, onQ }: {
  audit: AuditEvent[];
  q: string;
  onQ: (q: string) => void;
}) {
  const shown = audit.filter((e) => matchText(q, e.message, e.symbol));
  return (
    <div style={PS.body} id="nt-panel-activity" role="tabpanel" aria-labelledby="nt-tab-activity" tabIndex={0}>
      <div style={PS.barRow}>
        <span style={PS.dim}>{audit.length} events — every fill (incl. market) is logged here, not pushed</span>
      </div>
      <input className="field" value={q} onChange={(e) => onQ(e.target.value)}
        placeholder="Filter by symbol or text" aria-label="Filter activity" style={PS.search} />
      {audit.length === 0 ? (
        <p style={PS.empty}>No activity yet.</p>
      ) : shown.length === 0 ? (
        <p style={PS.empty}>No matches for "{q}".</p>
      ) : (
        shown.map((e) => (
          <div key={e.id} style={PS.note}>
            <div style={{ flex: 1 }}>
              <div style={PS.noteMsg}>{e.message}</div>
              <div style={PS.noteTime}>
                {fmtTime(e.at || e.created_at)}
                {e.order_type ? ` · ${e.order_type.replace(/_/g, " ")}` : ""}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
