import { Component, type ReactNode } from "react";

// Top-level guard: a render error in any screen shows a recoverable panel
// instead of white-screening the whole trading app.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[ui] render error:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32 }}>
          <div className="panel" style={{ maxWidth: 520, margin: "60px auto", padding: 24 }}>
            <div style={{ fontSize: "var(--fs-lg)", fontWeight: 600, marginBottom: 8 }}>Something broke on screen</div>
            <p style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)", lineHeight: 1.5, margin: 0 }}>
              The interface hit an unexpected error. Your positions and orders are unaffected — this is display-only. Reload to recover.
            </p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
