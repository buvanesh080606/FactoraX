import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, getAccessToken } from "../api/client";
import type { NotificationItem } from "../types/erp";
import { useAuth } from "./AuthContext";

interface NotificationContextValue {
  notifications: NotificationItem[];
  unreadCount: number;
  wsConnected: boolean;
  refresh: () => Promise<void>;
  markRead: (id: number) => Promise<void>;
  markAllRead: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api.get("/auth/notifications/");
      setNotifications(res.data.results ?? []);
      setUnreadCount(res.data.unread_count ?? 0);
    } catch {
      // ignore transient network failure
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      setWsConnected(false);
      return;
    }

    refresh();

    // Connect live WebSocket for instant cross-role notifications
    const token = getAccessToken();
    if (token) {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${proto}//${window.location.host}/ws/notifications/?token=${encodeURIComponent(token)}`;
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        ws.onopen = () => setWsConnected(true);
        ws.onclose = () => setWsConnected(false);
        ws.onerror = () => setWsConnected(false);
        ws.onmessage = (evt) => {
          try {
            const msg = JSON.parse(evt.data);
            if (msg.type === "notification") {
              setNotifications((prev) => [msg, ...prev.filter((n) => n.id !== msg.id)].slice(0, 50));
              setUnreadCount((c) => c + 1);
            }
          } catch {
            // ignore malformed message
          }
        };
      } catch {
        setWsConnected(false);
      }
    }

    // Fallback polling every 30s if WS drops
    const timer = window.setInterval(refresh, 30000);
    return () => {
      window.clearInterval(timer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [user, refresh]);

  const markRead = async (id: number) => {
    await api.post(`/auth/notifications/${id}/read/`);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
    setUnreadCount((c) => Math.max(0, c - 1));
  };

  const markAllRead = async () => {
    await api.post("/auth/notifications/read-all/");
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
  };

  return (
    <NotificationContext.Provider
      value={{ notifications, unreadCount, wsConnected, refresh, markRead, markAllRead }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used inside NotificationProvider");
  return ctx;
}
