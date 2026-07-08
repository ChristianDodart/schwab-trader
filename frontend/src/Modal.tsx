import { useEffect, useRef } from "react";

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// On-brand modal shell: overlay + panel, Escape to close, focus-in on open, and a
// Tab focus-trap. Reused by the bulk review + the unsaved-changes confirm.
export function Modal({
  title,
  onClose,
  children,
  width,
  labelledBy,
}: {
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
  labelledBy?: string; // id of a visible heading — used instead of aria-label to avoid double-announce
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "Tab" && ref.current) {
      const list = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!list.length) return;
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };

  // Only close on a click that BOTH starts and ends on the overlay itself. Without the
  // mousedown-origin check, dragging out of the panel (e.g. holding a number-stepper
  // arrow) and releasing on the overlay would register as a click and close the modal.
  const downOnOverlay = useRef(false);

  return (
    <div className="modal-overlay"
      onMouseDown={(e) => { downOnOverlay.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && downOnOverlay.current) onClose(); }}>
      <div
        className="modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : title}
        aria-labelledby={labelledBy}
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        style={width ? { width: `min(${width}px, calc(100vw - 32px))` } : undefined}
      >
        {children}
      </div>
    </div>
  );
}

// Simple yes/no confirm (replaces native confirm()).
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal labelledBy="confirm-dialog-title" onClose={onCancel} width={420}>
      <div style={{ padding: 20 }}>
        <div id="confirm-dialog-title" style={{ fontSize: "var(--fs-lg)", fontWeight: 600, marginBottom: 8 }}>{title}</div>
        <p style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)", lineHeight: 1.5, margin: 0 }}>{message}</p>
        <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
          <button className="btn btn-secondary" onClick={onCancel}>{cancelLabel}</button>
          <button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </Modal>
  );
}
