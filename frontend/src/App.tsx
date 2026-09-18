/**
 * OpsPilot Chat UI — React frontend for the agent.
 *
 * Connects to the Worker over WebSocket and streams agent responses.
 * Shows investigation steps as they complete and provides approve/reject
 * buttons for human-in-the-loop approval.
 *
 * Demo instructions:
 *   1. Start `npm run dev` (Worker) and `npm run frontend` (UI)
 *   2. Open the UI and click "Connect"
 *   3. Type "checkout-service is slow" and send
 *   4. Watch the agent stream a response via Workers AI
 *   5. After the response, the agent will ask for approval
 *   6. Click Approve or Reject to complete the loop
 */

import React, { useState, useRef } from "react";
import { useAgentSocket } from "./hooks/useAgentSocket";
import { ApprovalCard } from "./components/Approval";

export function App() {
  const [input, setInput] = useState("");
  const [wsUrl, setWsUrl] = useState("");

  const {
    messages,
    isLoading,
    isAwaitingApproval,
    proposedAction,
    sendMessage,
    approve,
    reject,
    connect,
    disconnect,
  } = useAgentSocket(wsUrl);

  const handleConnect = () => {
    // Connect to the Worker. The `partyserver` layer routes
    // the WebSocket to the IncidentAgent Durable Object.
    // VITE_WORKER_URL=wss://ops-pilot.<your-subdomain>.workers.dev for prod,
    // falls back to local dev.
    const workerUrl =
      (import.meta as any).env?.VITE_WORKER_URL || "ws://localhost:8787";
    const url = workerUrl;
    setWsUrl(url);
    connect(url);
  };

  const handleSend = () => {
    if (input.trim() && !isLoading) {
      sendMessage(input.trim());
      setInput("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>🔴 OpsPilot</h1>
        <p style={styles.subtitle}>AI Incident Response Copilot</p>
        <button
          onClick={isConnected ? disconnect : handleConnect}
          style={isConnected ? styles.disconnectBtn : styles.connectBtn}
        >
          {isConnected ? "Disconnect" : "Connect"}
        </button>
      </header>

      <div style={styles.messageList}>
        {messages.map((msg, i) => (
          <div key={i} style={msg.role === "user" ? styles.userMsg : styles.assistantMsg}>
            <strong>{msg.role === "user" ? "You" : msg.role === "tool" ? "🔧" : "OpsPilot"}:</strong>{" "}
            {msg.content}
          </div>
        ))}

        {isLoading && (
          <div style={styles.typing}>
            <span>OpsPilot is investigating...</span>
          </div>
        )}

        {isAwaitingApproval && proposedAction && (
          <ApprovalCard action={proposedAction} onApprove={approve} onReject={reject} />
        )}
      </div>

      <div style={styles.inputArea}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isConnected ? "Report an incident..." : "Connect first"}
          disabled={!isConnected}
          style={styles.input}
        />
        <button onClick={handleSend} disabled={!isConnected || isLoading} style={styles.sendBtn}>
          Send
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    maxWidth: "800px",
    margin: "0 auto",
    borderLeft: "1px solid #1e293b",
    borderRight: "1px solid #1e293b",
    background: "#0f172a",
  },
  header: {
    padding: "16px 20px",
    borderBottom: "1px solid #1e293b",
    display: "flex",
    alignItems: "center",
    gap: "16px",
  },
  title: { fontSize: "20px", color: "#f87171", margin: 0 },
  subtitle: { fontSize: "13px", color: "#64748b", margin: 0 },
  connectBtn: {
    padding: "6px 16px",
    background: "#22c55e",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    marginLeft: "auto",
  },
  disconnectBtn: {
    padding: "6px 16px",
    background: "#ef4444",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    marginLeft: "auto",
  },
  messageList: {
    flex: 1,
    overflowY: "auto",
    padding: "16px 20px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  userMsg: {
    alignSelf: "flex-end",
    background: "#1e40af",
    padding: "8px 16px",
    borderRadius: "8px",
    maxWidth: "70%",
    color: "#fff",
  },
  assistantMsg: {
    alignSelf: "flex-start",
    background: "#1e293b",
    padding: "8px 16px",
    borderRadius: "8px",
    maxWidth: "70%",
    color: "#e2e8f0",
  },
  typing: {
    alignSelf: "flex-start",
    background: "#1e293b",
    padding: "8px 16px",
    borderRadius: "8px",
    color: "#64748b",
    fontStyle: "italic",
  },
  inputArea: {
    display: "flex",
    gap: "8px",
    padding: "12px 20px",
    borderTop: "1px solid #1e293b",
  },
  input: {
    flex: 1,
    padding: "10px 14px",
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: "8px",
    color: "#e2e8f0",
    fontSize: "14px",
    outline: "none",
  },
  sendBtn: {
    padding: "10px 20px",
    background: "#3b82f6",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
  },
};
