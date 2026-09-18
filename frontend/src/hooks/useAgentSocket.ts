/**
 * useAgentSocket — React hook for WebSocket connection to OpsPilot Worker.
 *
 * Manages the WebSocket lifecycle including:
 *   - Connection and reconnection
 *   - Sending chat messages and RPC calls to the agent
 *   - Streaming agent responses
 *   - Handling approval requests
 *   - Reconnection on disconnect
 *
 * Protocol:
 *   - Chat messages: plain strings sent over WebSocket
 *   - RPC calls: { type: "rpc", id, method, args }
 *   - Explicit approve/reject: { type: "approve" } / { type: "reject" }
 *
 * The WebSocket connects to the Worker's URL. The `partyserver` layer
 * (under the `agents` SDK) handles routing to the IncidentAgent
 * Durable Object instance.
 */

import { useState, useCallback, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  ts: number;
}

interface ProposedAction {
  type: string;
  description: string;
  requiresApproval: boolean;
}

export function useAgentSocket(initialUrl: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAwaitingApproval, setIsAwaitingApproval] = useState(false);
  const [proposedAction, setProposedAction] = useState<ProposedAction | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const rpcIdRef = useRef(0);

  /**
   * Connect to the OpsPilot Worker via WebSocket.
   * The WebSocket URL points to the Worker's address.
   * The `partyserver` layer (under `agents`) manages the Durable Object routing.
   */
  const connect = useCallback(
    (url: string) => {
      if (wsRef.current) {
        wsRef.current.close();
      }

      try {
        const ws = new WebSocket(url);

        ws.onopen = () => {
          setIsConnected(true);
          // Send initial handshake
          ws.send(JSON.stringify({ type: "connect" }));
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            switch (data.type) {
              case "message":
                // Full agent response
                setMessages((prev) => [
                  ...prev,
                  { role: "assistant", content: data.content, ts: Date.now() },
                ]);
                setIsLoading(false);
                break;

              case "stream":
                // Chunk of a streaming response
                setMessages((prev) => {
                  const last = prev[prev.length - 1];
                  if (last && last.role === "assistant") {
                    const updated = [...prev];
                    updated[updated.length - 1] = {
                      ...last,
                      content: last.content + data.content,
                    };
                    return updated;
                  }
                  return [...prev, { role: "assistant", content: data.content, ts: Date.now() }];
                });
                setIsLoading(true);
                break;

              case "state":
                // Initial state from the agent
                console.log("Agent state:", data.state);
                break;

              case "approval_request":
                setIsAwaitingApproval(true);
                setProposedAction(data.action);
                setIsLoading(false);
                break;

              case "rpc_response":
                // Response to an @callable() RPC call
                if (data.error) {
                  console.error("RPC error:", data.error);
                }
                setIsLoading(false);
                break;

              case "welcome":
                setMessages((prev) => [
                  ...prev,
                  { role: "system", content: data.message, ts: Date.now() },
                ]);
                break;

              default:
                console.log("Unknown message type:", data.type, data);
            }
          } catch (e) {
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: event.data, ts: Date.now() },
            ]);
          }
        };

        ws.onclose = () => {
          setIsConnected(false);
          setIsLoading(false);
          reconnectTimeoutRef.current = setTimeout(() => {
            if (initialUrl) {
              connect(initialUrl);
            }
          }, 3000);
        };

        ws.onerror = (error) => {
          console.error("WebSocket error:", error);
          setIsLoading(false);
        };

        wsRef.current = ws;
      } catch (error) {
        console.error("Failed to connect:", error);
      }
    },
    [initialUrl]
  );

  /**
   * Send a chat message to the agent as a plain string.
   * The agent's onMessage handler will interpret it as a chat message.
   */
  const sendMessage = useCallback(
    (content: string) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        console.error("Not connected");
        return;
      }

      setMessages((prev) => [
        ...prev,
        { role: "user", content, ts: Date.now() },
      ]);

      // Send as plain string — the agent's onMessage handles the protocol
      wsRef.current.send(content);
      setIsLoading(true);
    },
    []
  );

  /**
   * Invoke a callable method on the agent via RPC.
   * Used for approve/reject actions from the UI.
   */
  const callRpc = useCallback(
    (method: string, args: any[] = []) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        console.error("Not connected");
        return;
      }

      const id = `rpc-${++rpcIdRef.current}`;
      wsRef.current.send(
        JSON.stringify({ type: "rpc", id, method, args })
      );
      return id;
    },
    []
  );

  /**
   * Approve the proposed action via RPC.
   */
  const approve = useCallback(() => {
    callRpc("approveAction");
    setIsAwaitingApproval(false);
    setProposedAction(null);
  }, [callRpc]);

  /**
   * Reject the proposed action via RPC.
   */
  const reject = useCallback(() => {
    callRpc("rejectAction");
    setIsAwaitingApproval(false);
    setProposedAction(null);
  }, [callRpc]);

  /**
   * Disconnect the WebSocket.
   */
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    messages,
    isLoading,
    isAwaitingApproval,
    proposedAction,
    isConnected,
    sendMessage,
    approve,
    reject,
    connect,
    disconnect,
  };
}
