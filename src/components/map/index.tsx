"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LeafletMapProps } from "./leaflet-map";

export type { MapLine, MapMarker } from "./leaflet-map";

// Leaflet touches `window`, so the map is only ever rendered in the browser.
const LeafletMap = dynamic(() => import("./leaflet-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center gap-2 bg-neutral-soft text-[13px] text-ink-3">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      Loading map…
    </div>
  ),
});

export function MapView({ height, className, ...props }: LeafletMapProps & { height?: number | string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-md border border-line", className)} style={height === "auto" ? undefined : { height: height ?? 360 }}>
      <LeafletMap {...props} />
    </div>
  );
}

/** Colours shared by route maps and their legends. */
export const MAP_COLORS = { pickup: "#7c3aed", dropoff: "#15803d", start: "#0b1b33", route: "#2563eb", done: "#94a3b8" } as const;

/** Honest labelling: every position in this product comes from the simulator. */
export function SimulatedBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-sm bg-warning-soft px-1.5 py-0.5 text-xs font-medium text-warning", className)}>
      <span className="size-1.5 rounded-full bg-warning" aria-hidden />
      Simulated GPS data
    </span>
  );
}
