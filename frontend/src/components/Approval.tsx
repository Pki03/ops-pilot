/**
 * ApprovalCard — UI component for human-in-the-loop approval.
 *
 * Displays the proposed action and provides approve/reject buttons.
 * This is the safety gate — no state-changing action happens without
 * explicit human consent.
 *
 * Design note on why a separate component:
 *   The approval card needs to be visually distinct from chat messages
 *   to make it clear that a decision is required. It also handles
 *   keyboard shortcuts (A to approve, R to reject) for power users.
 */

import React, { useEffect } from "react";

interface ProposedAction {
  type: string;
  description: string;
  requiresApproval: boolean;
}

interface ApprovalCardProps {
  action: ProposedAction;
  onApprove: () => void;
  onReject: () => void;
}

export function ApprovalCard({ action, onApprove, onReject }: ApprovalCardProps) {
  // Keyboard shortcuts for approval
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "a" || e.key === "A") {
        onApprove();
      } else if (e.key === "r" || e.key === "R") {
        onReject();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onApprove, onReject]);

  return (
    <div style={styles.card}>
      <div style={styles.icon}>⚠️</div>
      <div style={styles.content}>
        <h3 style={styles.title}>Human Approval Required</h3>
        <p style={styles.action}>
          <strong>Action:</strong> {action.description}
        </p>
        <p style={styles.type}>
          <strong>Type:</strong> {action.type}
        </p>
        <p style={styles.hint}>
          Press <kbd style={styles.kbd}>A</kbd> to approve or{" "}
          <kbd style={styles.kbd}>R</kbd> to reject
        </p>
      </div>
      <div style={styles.buttons}>
        <button onClick={onApprove} style={styles.approveBtn}>
          ✅ Approve
        </button>
        <button onClick={onReject} style={styles.rejectBtn}>
          ❌ Reject
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: "#1e3a5f",
    border: "1px solid #f59e0b",
    borderRadius: "8px",
    padding: "16px",
    margin: "8px 0",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  icon: { fontSize: "24px" },
  content: { display: "flex", flexDirection: "column", gap: "4px" },
  title: { fontSize: "16px", color: "#f59e0b" },
  action: { fontSize: "14px", color: "#e2e8f0" },
  type: { fontSize: "12px", color: "#64748b" },
  hint: { fontSize: "12px", color: "#64748b" },
  kbd: {
    background: "#334155",
    padding: "2px 6px",
    borderRadius: "4px",
    fontSize: "11px",
    fontFamily: "monospace",
  },
  buttons: {
    display: "flex",
    gap: "8px",
  },
  approveBtn: {
    padding: "8px 20px",
    background: "#22c55e",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontWeight: "bold",
  },
  rejectBtn: {
    padding: "8px 20px",
    background: "#ef4444",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontWeight: "bold",
  },
};
