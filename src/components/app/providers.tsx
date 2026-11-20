"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { SessionUser } from "@/lib/auth";
import { can as canRole, type Permission } from "@/lib/permissions";

// --- Session ------------------------------------------------------------------

const UserContext = createContext<SessionUser | null>(null);

export function useUser(): SessionUser {
  const user = useContext(UserContext);
  if (!user) throw new Error("useUser must be used inside <AppProviders>");
  return user;
}

/** Client-side permission check. Hides controls only; the API enforces access. */
export function useCan() {
  const user = useUser();
  return useMemo(() => (permission: Permission) => canRole(user.role, permission), [user.role]);
}

// --- Demo mode ----------------------------------------------------------------

export interface DemoInfo {
  enabled: boolean;
  /** ISO timestamp of the last demo-data generation. */
  seededAt: string | null;
}
const DemoContext = createContext<DemoInfo>({ enabled: false, seededAt: null });

export function useDemo(): DemoInfo {
  return useContext(DemoContext);
}

// --- Realtime -----------------------------------------------------------------

interface Realtime {
  socket: Socket | null;
  connected: boolean;
}
const SocketContext = createContext<Realtime>({ socket: null, connected: false });

export function useRealtime() {
  return useContext(SocketContext);
}

/** Subscribes to a Socket.IO event for the lifetime of the component. */
export function useSocketEvent<T = unknown>(event: string, handler: (payload: T) => void) {
  const { socket } = useRealtime();
  const saved = useRef(handler);
  useEffect(() => {
    saved.current = handler;
  });
  useEffect(() => {
    if (!socket) return;
    const listener = (payload: T) => saved.current(payload);
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
  }, [socket, event]);
}

export function AppProviders({ user, demo, children }: { user: SessionUser; demo: DemoInfo; children: React.ReactNode }) {
  const [realtime, setRealtime] = useState<Realtime>({ socket: null, connected: false });

  useEffect(() => {
    // The session cookie authenticates the socket (same origin).
    const socket = io({ path: "/socket.io", transports: ["websocket", "polling"], withCredentials: true });
    socket.on("connect", () => setRealtime({ socket, connected: true }));
    socket.on("disconnect", () => setRealtime({ socket, connected: false }));
    return () => {
      socket.close();
    };
  }, [user.id]);

  return (
    <UserContext.Provider value={user}>
      <DemoContext.Provider value={demo}>
        <SocketContext.Provider value={realtime}>{children}</SocketContext.Provider>
      </DemoContext.Provider>
    </UserContext.Provider>
  );
}
