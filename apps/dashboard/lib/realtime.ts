import { getCurrentToken, getWsUrl } from "./api";

export type RealtimeState = "connecting" | "live" | "retrying" | "offline";

export function connectRealtime(
  onEvent: (message: { event: string; payload: any }) => void,
  onState: (state: RealtimeState) => void,
  token: string | (() => string | undefined) = getCurrentToken,
) {
  let socket: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let attempt = 0;
  const clear = () => {
    if (retryTimer) clearTimeout(retryTimer);
    if (heartbeat) clearInterval(heartbeat);
    retryTimer = heartbeat = null;
  };
  const open = () => {
    if (stopped || !navigator.onLine) {
      onState("offline");
      return;
    }
    const credential = typeof token === "function" ? token() : token;
    clear();
    if (!credential) { onState("offline"); return; }
    onState(attempt ? "retrying" : "connecting");
    socket = new WebSocket(getWsUrl(credential));
    socket.onopen = () => {
      attempt = 0;
      onState("live");
      heartbeat = setInterval(
        () => socket?.readyState === WebSocket.OPEN && socket.send("ping"),
        15_000,
      );
    };
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (!["pong", "connected"].includes(message.event)) onEvent(message);
      } catch {
        /* ignore malformed events */
      }
    };
    socket.onerror = () => socket?.close();
    socket.onclose = () => {
      clear();
      if (stopped) return;
      attempt += 1;
      onState(navigator.onLine ? "retrying" : "offline");
      retryTimer = setTimeout(
        open,
        Math.min(1000 * 2 ** Math.min(attempt, 4), 12_000),
      );
    };
  };
  const online = () => {
    attempt = 0;
    socket?.close();
    open();
  };
  const offline = () => {
    onState("offline");
    socket?.close();
  };
  window.addEventListener("online", online);
  window.addEventListener("offline", offline);
  open();
  return () => {
    stopped = true;
    clear();
    socket?.close();
    window.removeEventListener("online", online);
    window.removeEventListener("offline", offline);
  };
}
