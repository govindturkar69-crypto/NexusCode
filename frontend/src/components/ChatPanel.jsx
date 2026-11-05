import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { apiFetch, socketUrl } from "../api/client";
import { formatMessageTime, typingText } from "../projects/chat";
import Button from "./ui/Button";
import Card from "./ui/Card";
import Input from "./ui/Input";

// Matches the server-side limit
const MAX_CHAT_MESSAGE_LENGTH = 2000;
const TYPING_SEND_EVERY_MS = 2500;
const TYPING_SHOW_FOR_MS = 4000;
const NEAR_EDGE_PX = 40;

function ChatPanel({ projectId, canPost, currentUser, members, onActivity }) {
  const [messages, setMessages] = useState([]);
  // Cursor for older history; null once the oldest message is loaded
  const [olderCursor, setOlderCursor] = useState(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [online, setOnline] = useState([]);
  const [typing, setTyping] = useState([]);

  const socket = useRef(null);
  const log = useRef(null);
  const typingTimers = useRef({});
  const lastTypingSent = useRef(0);
  // How to adjust the scroll position after `messages` changes
  const stickToBottom = useRef(true);
  const heightBeforePrepend = useRef(null);

  const clearTyping = useCallback((username) => {
    clearTimeout(typingTimers.current[username]);
    delete typingTimers.current[username];
    setTyping((prev) => prev.filter((name) => name !== username));
  }, []);

  useEffect(() => {
    // The API returns newest first; the log shows the oldest at the top
    apiFetch(`/projects/${projectId}/messages`)
      .then((data) => {
        setMessages([...(data.messages ?? [])].reverse());
        setOlderCursor(data.next_cursor ?? null);
      })
      .catch((err) => setError(err.message));
  }, [projectId]);

  useEffect(() => {
    let ws = null;
    let cancelled = false;
    const timers = typingTimers.current;

    function handleFrame(frame) {
      if (frame.type === "presence") {
        setOnline(frame.users ?? []);
      } else if (frame.type === "typing") {
        setTyping((prev) => (prev.includes(frame.username) ? prev : [...prev, frame.username]));
        clearTimeout(timers[frame.username]);
        timers[frame.username] = setTimeout(() => clearTyping(frame.username), TYPING_SHOW_FOR_MS);
      } else if (frame.type === "error") {
        setError(frame.detail);
      } else if (frame.type === "activity") {
        onActivity?.(frame);
      } else if (frame.content !== undefined) {
        setError("");
        clearTyping(frame.username);
        setMessages((prev) => [...prev, frame]);
      }
    }

    // Get a single-use ticket, then connect (unless we unmounted meanwhile)
    socketUrl(`/ws/projects/${projectId}/chat`, projectId)
      .then((url) => {
        if (cancelled) return;
        ws = new WebSocket(url);
        socket.current = ws;
        ws.onmessage = (event) => handleFrame(JSON.parse(event.data));
        // The server refuses the socket if the ticket is invalid or we're no
        // longer a member, which shows up here as a close.
        ws.onclose = () => {
          setOnline([]);
          setError("Chat disconnected. Refresh the page to reconnect.");
        };
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't connect to chat. Refresh the page to try again.");
      });

    return () => {
      cancelled = true;
      Object.values(timers).forEach(clearTimeout);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, [projectId, clearTyping, onActivity]);

  // Keep the view steady: loading older messages must not make the log jump,
  // and new messages only scroll down if you were already at the bottom.
  useLayoutEffect(() => {
    const element = log.current;
    if (!element) return;
    if (heightBeforePrepend.current !== null) {
      element.scrollTop += element.scrollHeight - heightBeforePrepend.current;
      heightBeforePrepend.current = null;
    } else if (stickToBottom.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages]);

  const loadOlder = useCallback(() => {
    if (olderCursor === null || loadingOlder) return;
    setLoadingOlder(true);
    apiFetch(`/projects/${projectId}/messages?before=${olderCursor}`)
      .then((data) => {
        heightBeforePrepend.current = log.current?.scrollHeight ?? null;
        setMessages((prev) => [...[...(data.messages ?? [])].reverse(), ...prev]);
        setOlderCursor(data.next_cursor ?? null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingOlder(false));
  }, [projectId, olderCursor, loadingOlder]);

  function handleScroll() {
    const element = log.current;
    stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_EDGE_PX;
    if (element.scrollTop < NEAR_EDGE_PX) loadOlder();
  }

  function handleInput(event) {
    setInput(event.target.value);
    const now = Date.now();
    if (event.target.value && now - lastTypingSent.current >= TYPING_SEND_EVERY_MS && socket.current?.readyState === 1) {
      lastTypingSent.current = now;
      socket.current.send(JSON.stringify({ type: "typing" }));
    }
  }

  function sendMessage(event) {
    event.preventDefault();
    if (!input.trim()) return;
    if (socket.current?.readyState !== 1) {
      setError("Chat is not connected. Refresh the page to reconnect.");
      return;
    }
    // The server attaches our name from the ticket
    socket.current.send(JSON.stringify({ content: input }));
    stickToBottom.current = true;
    lastTypingSent.current = 0;
    setInput("");
  }

  const memberIds = new Set(members.map((m) => m.user_id));
  const isRemoved = (message) =>
    message.author_removed || (members.length > 0 && message.user_id != null && !memberIds.has(message.user_id));
  const typingLine = typingText(typing);

  return (
    <section className="stack">
      <h2 className="section-title">💬 Chat</h2>
      <Card className="grow stack">
        <p className="small muted" aria-live="polite" aria-label="Who is online">
          <span className="presence-dot" aria-hidden="true" />
          {online.length === 0 ? "Nobody online" : `Online: ${online.map((u) => u.username).join(", ")}`}
        </p>

        <div ref={log} onScroll={handleScroll} className="chat-log" role="log" aria-live="polite" aria-label="Chat messages">
          {olderCursor !== null && (
            <Button variant="link" onClick={loadOlder} disabled={loadingOlder}>
              {loadingOlder ? "Loading..." : "↑ Load older messages"}
            </Button>
          )}
          {messages.length === 0 && <p className="muted small">No messages yet. Say hello!</p>}
          {messages.map((message, index) => {
            const mine = currentUser != null && (message.user_id === currentUser.id || message.username === currentUser.username);
            return (
              <p key={message.id ?? index} className="small" style={{ marginBottom: "0.5rem" }}>
                <strong className={mine ? "text-success" : "text-accent"}>
                  {mine ? `${message.username} (you)` : message.username}
                </strong>
                {isRemoved(message) && <span className="badge badge--muted chat-removed">removed</span>}{" "}
                <time className="hint" dateTime={message.created_at}>{formatMessageTime(message.created_at)}</time>
                <br />
                {message.content}
              </p>
            );
          })}
        </div>

        <p className="hint" aria-live="polite" style={{ minHeight: "1.2em", margin: 0 }}>{typingLine}</p>

        {canPost ? (
          <form onSubmit={sendMessage} className="row">
            <Input
              label="Message"
              hideLabel
              placeholder="Type a message..."
              value={input}
              onChange={handleInput}
              maxLength={MAX_CHAT_MESSAGE_LENGTH}
              className="grow"
            />
            <Button type="submit">Send</Button>
          </form>
        ) : (
          <p className="hint">Viewers can read the chat but not post in it.</p>
        )}
        {error && <p role="alert" className="small text-danger">{error}</p>}
      </Card>
    </section>
  );
}

export default ChatPanel;
