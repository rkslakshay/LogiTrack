import type { Server as IOServer } from "socket.io";

// The Socket.IO server is created in server.ts and published on globalThis so
// that services (which may be loaded by either tsx or the Next.js bundle) can
// broadcast without importing the server module.
const g = globalThis as unknown as { __logitrackIo?: IOServer };

export function setIo(io: IOServer) {
  g.__logitrackIo = io;
}

export function getIo(): IOServer | undefined {
  return g.__logitrackIo;
}

export const STAFF_ROOM = "staff";
export const userRoom = (userId: string) => `user:${userId}`;

/** Broadcast to every signed-in staff member (non-driver roles). */
export function emitStaff(event: string, payload: unknown) {
  g.__logitrackIo?.to(STAFF_ROOM).emit(event, payload);
}

export function emitUser(userId: string, event: string, payload: unknown) {
  g.__logitrackIo?.to(userRoom(userId)).emit(event, payload);
}

export function emitUsers(userIds: (string | null | undefined)[], event: string, payload: unknown) {
  for (const id of userIds) if (id) emitUser(id, event, payload);
}

// Event names (shared with the client).
export const EVENTS = {
  vehicleLocation: "vehicle:location",
  deliveryUpdated: "delivery:updated",
  notification: "notification:new",
  simulator: "simulator:state",
  demoReset: "demo:reset",
} as const;

/** Connection counters for the diagnostics page (process-wide, reset on restart). */
export interface RealtimeStats {
  connected: number;
  totalConnections: number;
  rejectedHandshakes: number;
  revokedDisconnects: number;
  lastConnectionAt: string | null;
}

const statsHolder = globalThis as unknown as { __logitrackRealtimeStats?: RealtimeStats };
export const realtimeStats: RealtimeStats = (statsHolder.__logitrackRealtimeStats ??= {
  connected: 0,
  totalConnections: 0,
  rejectedHandshakes: 0,
  revokedDisconnects: 0,
  lastConnectionAt: null,
});

export function realtimeStatus() {
  const io = g.__logitrackIo;
  return {
    available: !!io,
    connected: io ? io.of("/").sockets.size : 0,
    staffRoom: io ? (io.of("/").adapter.rooms.get(STAFF_ROOM)?.size ?? 0) : 0,
    totalConnections: realtimeStats.totalConnections,
    rejectedHandshakes: realtimeStats.rejectedHandshakes,
    revokedDisconnects: realtimeStats.revokedDisconnects,
    lastConnectionAt: realtimeStats.lastConnectionAt,
  };
}
