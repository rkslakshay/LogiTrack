"use client";

import "leaflet/dist/leaflet.css";
import * as React from "react";
import L from "leaflet";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { LatLng } from "@/lib/geo";
import { INDIA_CENTER } from "@/lib/locations";

export interface MapMarker {
  id: string;
  position: LatLng;
  kind: "vehicle" | "pin";
  /** Fill colour of the marker. */
  color: string;
  /** Vehicles: registration label under the dot. Pins: 1-2 characters inside the dot. */
  label?: string;
  heading?: number;
  selected?: boolean;
  popup?: React.ReactNode;
  title?: string;
}

export interface MapLine {
  id: string;
  points: LatLng[];
  color: string;
  dashed?: boolean;
  weight?: number;
  opacity?: number;
}

export interface LeafletMapProps {
  markers?: MapMarker[];
  lines?: MapLine[];
  /** Change this value to re-fit the view to all markers and lines. */
  fitKey?: string | number;
  /** Pan/zoom to a point; `key` forces a re-focus on the same point. */
  focus?: { position: LatLng; zoom?: number; key: string | number } | null;
  onMapClick?: (position: LatLng) => void;
  onMarkerClick?: (id: string) => void;
  className?: string;
  /** Cursor hint while the map is used to pick a location. */
  picking?: boolean;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const ARROW = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2 4.5 20.3l.7.7L12 18l6.8 3 .7-.7z"/></svg>';

// Leaflet replaces a marker's DOM whenever it is handed a new icon object. Icons are therefore
// cached by what they look like, so a vehicle that only changed position keeps its element
// (and its CSS transition) and nothing is rebuilt.
const iconCache = new Map<string, L.DivIcon>();
function cached(key: string, create: () => L.DivIcon): L.DivIcon {
  let icon = iconCache.get(key);
  if (!icon) {
    if (iconCache.size > 600) iconCache.clear();
    icon = create();
    iconCache.set(key, icon);
  }
  return icon;
}

function vehicleIcon(input: MapMarker) {
  // Headings are snapped to 10 degrees: invisible at marker size, and it keeps the cache small.
  const marker = { ...input, heading: Math.round((input.heading ?? 0) / 10) * 10 };
  return cached(`v|${marker.color}|${marker.label ?? ""}|${marker.heading}|${marker.selected ? 1 : 0}`, () => buildVehicleIcon(marker));
}

function buildVehicleIcon(marker: MapMarker) {
  return L.divIcon({
    className: "lt-marker",
    iconSize: [96, 48],
    iconAnchor: [48, 13],
    popupAnchor: [0, -14],
    html:
      `<div class="lt-vehicle${marker.selected ? " is-selected" : ""}">` +
      `<div class="lt-vehicle-dot" style="background:${marker.color}"><span style="display:grid;transform:rotate(${Math.round(marker.heading ?? 0)}deg)">${ARROW}</span></div>` +
      (marker.label ? `<div class="lt-vehicle-label">${escapeHtml(marker.label)}</div>` : "") +
      `</div>`,
  });
}

function pinIcon(marker: MapMarker) {
  return cached(`p|${marker.color}|${marker.label ?? ""}`, () => buildPinIcon(marker));
}

function buildPinIcon(marker: MapMarker) {
  return L.divIcon({
    className: "lt-marker",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -12],
    html: `<div class="lt-pin" style="background:${marker.color}">${escapeHtml(marker.label ?? "")}</div>`,
  });
}

function FitBounds({ markers, lines, fitKey }: { markers: MapMarker[]; lines: MapLine[]; fitKey?: string | number }) {
  const map = useMap();
  const latest = React.useRef({ markers, lines });
  React.useEffect(() => {
    latest.current = { markers, lines };
  });
  React.useEffect(() => {
    const points: LatLng[] = [...latest.current.markers.map((m) => m.position), ...latest.current.lines.flatMap((l) => l.points)];
    if (points.length === 0) return;
    if (points.length === 1) map.setView(points[0], 12);
    else map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 14 });
  }, [map, fitKey]);
  return null;
}

function Focus({ focus }: { focus: LeafletMapProps["focus"] }) {
  const map = useMap();
  const key = focus?.key;
  const saved = React.useRef(focus);
  React.useEffect(() => {
    saved.current = focus;
  });
  React.useEffect(() => {
    const f = saved.current;
    if (f) map.flyTo(f.position, f.zoom ?? Math.max(map.getZoom(), 11), { duration: 0.6 });
  }, [map, key]);
  return null;
}

function ClickHandler({ onMapClick }: { onMapClick: (position: LatLng) => void }) {
  useMapEvents({ click: (e) => onMapClick([e.latlng.lat, e.latlng.lng]) });
  return null;
}

/** Leaflet needs a size recalculation when its container is resized (dialogs, tabs, responsive layout). */
function ResizeWatcher() {
  const map = useMap();
  React.useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);
  return null;
}

export default function LeafletMap({ markers = [], lines = [], fitKey, focus, onMapClick, onMarkerClick, className, picking }: LeafletMapProps) {
  return (
    <MapContainer
      center={INDIA_CENTER}
      zoom={5}
      minZoom={4}
      scrollWheelZoom
      className={className}
      style={{ height: "100%", width: "100%", cursor: picking ? "crosshair" : undefined }}
    >
      {/* OpenStreetMap standard tiles: free for light use, attribution required. */}
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} />
      <ResizeWatcher />
      <FitBounds markers={markers} lines={lines} fitKey={fitKey} />
      <Focus focus={focus} />
      {onMapClick && <ClickHandler onMapClick={onMapClick} />}
      {lines.map((line) => (
        <Polyline
          key={line.id}
          positions={line.points}
          pathOptions={{ color: line.color, weight: line.weight ?? 4, opacity: line.opacity ?? 0.85, dashArray: line.dashed ? "6 8" : undefined, lineCap: "round" }}
        />
      ))}
      {markers.map((marker) => (
        <Marker
          key={marker.id}
          position={marker.position}
          icon={marker.kind === "vehicle" ? vehicleIcon(marker) : pinIcon(marker)}
          zIndexOffset={marker.selected ? 1000 : marker.kind === "vehicle" ? 500 : 0}
          title={marker.title}
          eventHandlers={onMarkerClick ? { click: () => onMarkerClick(marker.id) } : undefined}
        >
          {marker.popup && <Popup>{marker.popup}</Popup>}
        </Marker>
      ))}
    </MapContainer>
  );
}
