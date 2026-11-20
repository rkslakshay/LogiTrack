import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { pointAlong, polylineKm, type LatLng } from "@/lib/geo";
import { emitStaff, emitUsers, EVENTS } from "@/lib/realtime";
import { logger } from "@/lib/logger";
import { getRoute, localRoute, parseGeometry } from "@/lib/routing";
import { changeDeliveryStatus } from "./services/deliveries";
import { getSettings } from "./services/settings";

const log = logger("simulator");

/** Counters for the diagnostics page (not broadcast to clients). */
export interface SimulatorHealth {
  ticks: number;
  failures: number;
  lastTickDurationMs: number | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

export interface SimulatorState {
  running: boolean;
  tickMs: number;
  speed: number;
  averageSpeedKmh: number;
  movingVehicles: number;
  lastTickAt: string | null;
  /** Demo mode only: true while the engine is idling because nobody is connected to watch. */
  waitingForViewers: boolean;
}

/**
 * Local GPS simulation engine.
 *
 * Every tick, each vehicle with a delivery in transit advances along that
 * delivery's route polyline by the distance it would cover at the configured
 * average speed, scaled by the simulation speed multiplier. Positions are saved
 * to the database and broadcast over Socket.IO. No hardware GPS is involved:
 * everything this engine emits is flagged `simulated: true`.
 */
export class GpsSimulator {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private lastTick = 0;
  private lastTickAt: Date | null = null;
  private movingVehicles = 0;
  private settings = { speed: 10, averageSpeedKmh: 40 };
  /** Deliveries whose geometry we already tried to upgrade to real road geometry. */
  private upgradeTried = new Set<string>();
  /** Optional gate consulted before each scheduled tick (see setGate). */
  private gate: (() => boolean) | null = null;
  private idle = false;
  /** Parsed route geometry and length per delivery, reused while the stored geometry is unchanged. */
  private lengths = new Map<string, { raw: string | null; geometry: LatLng[]; km: number }>();
  private stats: SimulatorHealth = { ticks: 0, failures: 0, lastTickDurationMs: null, lastError: null, lastErrorAt: null };

  constructor(private tickMs = 2000) {}

  /**
   * Demo environments install a gate so trips only advance while someone is
   * connected to watch: sample deliveries do not quietly finish overnight.
   * Normal deployments install no gate and the simulator always runs.
   */
  setGate(gate: (() => boolean) | null) {
    this.gate = gate;
  }

  /** Forget per-delivery state after the dataset is rebuilt. */
  reset() {
    this.upgradeTried.clear();
    this.lengths.clear();
    this.movingVehicles = 0;
    this.lastTick = Date.now();
  }

  get running() {
    return this.timer !== null;
  }

  state(): SimulatorState {
    return {
      running: this.running,
      tickMs: this.tickMs,
      speed: this.settings.speed,
      averageSpeedKmh: this.settings.averageSpeedKmh,
      movingVehicles: this.movingVehicles,
      lastTickAt: this.lastTickAt?.toISOString() ?? null,
      waitingForViewers: this.running && this.idle,
    };
  }

  private geometryOf(id: string, raw: string | null): LatLng[] {
    const cached = this.lengths.get(id);
    if (cached && cached.raw === raw) return cached.geometry;
    const geometry = parseGeometry(raw);
    this.lengths.set(id, { raw, geometry, km: polylineKm(geometry) });
    return geometry;
  }

  private lengthOf(id: string, raw: string | null, geometry: LatLng[]): number {
    const cached = this.lengths.get(id);
    return cached && cached.raw === raw && cached.geometry === geometry ? cached.km : polylineKm(geometry);
  }

  health(): SimulatorHealth {
    return { ...this.stats };
  }

  private recordFailure(err: unknown) {
    this.stats.failures++;
    this.stats.lastError = err instanceof Error ? err.message : String(err);
    this.stats.lastErrorAt = new Date().toISOString();
  }

  start(): SimulatorState {
    if (!this.timer) {
      this.lastTick = Date.now();
      this.timer = setInterval(() => {
        if (this.gate && !this.gate()) {
          // Idle: keep the clock current so the first tick after a pause is a normal-sized step.
          this.idle = true;
          this.lastTick = Date.now();
          return;
        }
        this.idle = false;
        void this.tick();
      }, this.tickMs);
      this.timer.unref?.();
      void this.refreshSettings().then(() => this.broadcastState());
      log.info("simulator.started", { tickMs: this.tickMs });
    }
    return this.state();
  }

  pause(): SimulatorState {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.movingVehicles = 0;
      this.broadcastState();
      log.info("simulator.paused");
    }
    return this.state();
  }

  private broadcastState() {
    emitStaff(EVENTS.simulator, this.state());
  }

  private async refreshSettings() {
    const s = await getSettings();
    this.settings = { speed: s.simulationSpeed, averageSpeedKmh: s.averageSpeedKmh };
    return s;
  }

  /** One simulation step. Public so tests can drive the engine deterministically. */
  async tick(elapsedMs?: number): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    const started = Date.now();
    try {
      const now = Date.now();
      const dtMs = elapsedMs ?? Math.min(now - this.lastTick, this.tickMs * 3); // cap catch-up after a stall
      this.lastTick = now;
      const settings = await this.refreshSettings();
      const stepKm = settings.averageSpeedKmh * ((dtMs / 1000) * settings.simulationSpeed) / 3600;

      const candidates = await prisma.delivery.findMany({
        where: { pickedUpAt: { not: null }, status: { in: ["IN_TRANSIT", "DELAYED"] }, vehicleId: { not: null } },
        include: { driver: { select: { userId: true } } },
        orderBy: { pickedUpAt: "asc" },
      });
      // One leg at a time per vehicle: the delivery that was picked up first.
      const byVehicle = new Map<string, (typeof candidates)[number]>();
      for (const d of candidates) if (!byVehicle.has(d.vehicleId!)) byVehicle.set(d.vehicleId!, d);

      const writes: Prisma.PrismaPromise<unknown>[] = [];
      const moves: { payload: { vehicleId: string; deliveryId: string; lat: number; lng: number; heading: number; progress: number; at: string; simulated: true }; driverUserId?: string | null; arrived: boolean; code: string }[] = [];
      for (const d of byVehicle.values()) {
        let geometry = this.geometryOf(d.id, d.routeGeometry);
        const ends: LatLng[] = [[d.pickupLat, d.pickupLng], [d.destLat, d.destLng]];
        if (geometry.length < 2) {
          geometry = localRoute(ends).geometry;
          await prisma.delivery.update({ where: { id: d.id }, data: { routeGeometry: JSON.stringify(geometry), geometrySource: "local" } });
        } else if (d.geometrySource === "local" && process.env.ROUTING_PROVIDER === "osrm" && !this.upgradeTried.has(d.id)) {
          // Opportunistically replace the offline estimate with real road geometry (once per delivery).
          this.upgradeTried.add(d.id);
          const road = await getRoute(ends);
          if (road.source === "osrm") {
            geometry = road.geometry;
            await prisma.delivery.update({ where: { id: d.id }, data: { routeGeometry: JSON.stringify(geometry), geometrySource: "osrm" } });
          }
        }

        const totalKm = Math.max(this.lengthOf(d.id, d.routeGeometry, geometry), 0.05);
        const progress = Math.min(1, d.progress + stepKm / totalKm);
        const { point, heading } = pointAlong(geometry, progress);
        const at = new Date();
        writes.push(
          prisma.delivery.update({ where: { id: d.id }, data: { progress } }),
          prisma.vehicle.update({
            where: { id: d.vehicleId! },
            data: { lastLat: point[0], lastLng: point[1], lastHeading: heading, lastLocationAt: at },
          }),
        );
        moves.push({
          payload: { vehicleId: d.vehicleId!, deliveryId: d.id, lat: point[0], lng: point[1], heading, progress, at: at.toISOString(), simulated: true },
          driverUserId: d.driver?.userId,
          arrived: progress >= 1,
          code: d.code,
        });
      }

      // Forget cached geometry of deliveries that are no longer moving (cancelled, delivered elsewhere).
      for (const id of this.lengths.keys()) if (!candidates.some((c) => c.id === id)) this.lengths.delete(id);

      // All positions of this tick in ONE transaction: one SQLite commit instead of one per vehicle.
      if (writes.length) await prisma.$transaction(writes);
      for (const m of moves) {
        emitStaff(EVENTS.vehicleLocation, m.payload);
        emitUsers([m.driverUserId], EVENTS.vehicleLocation, m.payload);
      }
      if (settings.simulationAutoComplete) {
        for (const m of moves.filter((x) => x.arrived)) {
          try {
            await changeDeliveryStatus(null, m.payload.deliveryId, { status: "DELIVERED", note: "Arrived at destination (simulated GPS)" });
            this.lengths.delete(m.payload.deliveryId);
          } catch (err) {
            this.recordFailure(err);
            log.error("simulator.complete_failed", { delivery: m.code, err });
          }
        }
      }
      this.movingVehicles = byVehicle.size;
      this.lastTickAt = new Date();
      this.stats.ticks++;
      this.stats.lastTickDurationMs = Date.now() - started;
      return byVehicle.size;
    } catch (err) {
      this.recordFailure(err);
      log.error("simulator.tick_failed", { err });
      return 0;
    } finally {
      this.busy = false;
    }
  }
}

const g = globalThis as unknown as { __logitrackSimulator?: GpsSimulator };

/** Process-wide simulator instance (shared between server.ts and the API routes). */
export function getSimulator(): GpsSimulator {
  if (!g.__logitrackSimulator) g.__logitrackSimulator = new GpsSimulator();
  return g.__logitrackSimulator;
}
