import { createContext, useCallback, useContext, useRef, useState } from "react";
import { IconClose } from "./Icon";

// Themed, non-blocking replacement for native alert(). One provider wraps the
// app; any component calls const toast = useToast(); toast("message", "error").
type ToastKind = "error" | "success" | "info";
type ToastAction = { label: string; onClick: () => void };
type ToastItem = { id: number; kind: ToastKind; msg: string; action?: ToastAction };
type Push = (msg: string, kind?: ToastKind, action?: ToastAction) => void;

const Ctx = createContext<Push>(() => {});
export const useToast = (): Push => useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback<Push>((msg, kind = "error", action) => {
    const id = ++idRef.current;
    setItems((t) => [...t, { id, kind, msg, action }]);
    // give undo-able toasts a little longer to act on
    setTimeout(() => dismiss(id), action ? 7000 : kind === "error" ? 8000 : 4000);
  }, [dismiss]);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toast-host" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
            <span style={{ flex: 1, lineHeight: 1.4 }}>{t.msg}</span>
            {t.action && (
              <button
                onClick={() => { t.action!.onClick(); dismiss(t.id); }}
                style={{ background: "none", border: "none", color: "var(--accent-quiet)", cursor: "pointer", fontSize: "var(--fs-sm)", fontWeight: 600, padding: 0, whiteSpace: "nowrap" }}
              >
                {t.action.label}
              </button>
            )}
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: "var(--fs-sm)", padding: 0, lineHeight: 1 }}
            >
              <IconClose />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
