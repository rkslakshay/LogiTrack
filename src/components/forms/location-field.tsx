"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";
import { PLACES, placeLabel } from "@/lib/locations";
import { MapView } from "@/components/map";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Select } from "@/components/ui/input";

export interface LocationValue {
  address: string;
  lat: string;
  lng: string;
}

const CUSTOM = "__custom__";

/**
 * Location input without a paid geocoder: choose a known place from the built-in
 * gazetteer, or switch to "custom" and click the map / type coordinates.
 */
export function LocationField({
  id, label, value, onChange, error, color,
}: {
  id: string;
  label: string;
  value: LocationValue;
  onChange: (value: LocationValue) => void;
  error?: string;
  color: string;
}) {
  const matched = PLACES.find((p) => placeLabel(p) === value.address && String(p.lat) === value.lat && String(p.lng) === value.lng);
  const [custom, setCustom] = useState(!matched && value.address !== "");
  const selectValue = custom ? CUSTOM : (matched?.id ?? "");
  const lat = Number(value.lat);
  const lng = Number(value.lng);
  const hasPoint = value.lat !== "" && value.lng !== "" && Number.isFinite(lat) && Number.isFinite(lng);

  return (
    <div>
      <Label htmlFor={id} required>
        {label}
      </Label>
      <Select
        id={id}
        value={selectValue}
        aria-invalid={!!error}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true);
            return;
          }
          setCustom(false);
          const place = PLACES.find((p) => p.id === e.target.value);
          onChange(place ? { address: placeLabel(place), lat: String(place.lat), lng: String(place.lng) } : { address: "", lat: "", lng: "" });
        }}
      >
        <option value="">Select a location…</option>
        {PLACES.map((p) => (
          <option key={p.id} value={p.id}>
            {placeLabel(p)}
          </option>
        ))}
        <option value={CUSTOM}>Custom location (pick on map)…</option>
      </Select>

      {custom && (
        <div className="mt-2 space-y-2 rounded-md border border-line bg-canvas/60 p-2.5">
          <Input value={value.address} onChange={(e) => onChange({ ...value, address: e.target.value })} placeholder="Address or landmark" aria-label={`${label} address`} />
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" step="0.00001" value={value.lat} onChange={(e) => onChange({ ...value, lat: e.target.value })} placeholder="Latitude" aria-label={`${label} latitude`} />
            <Input type="number" step="0.00001" value={value.lng} onChange={(e) => onChange({ ...value, lng: e.target.value })} placeholder="Longitude" aria-label={`${label} longitude`} />
          </div>
          <MapView
            height={180}
            picking
            fitKey={hasPoint ? "point" : "empty"}
            markers={hasPoint ? [{ id: "point", kind: "pin", position: [lat, lng], color, label: "" }] : []}
            onMapClick={([la, ln]) => onChange({ address: value.address || `Pinned location (${la.toFixed(4)}, ${ln.toFixed(4)})`, lat: la.toFixed(5), lng: ln.toFixed(5) })}
          />
          <p className="flex items-center gap-1 text-xs text-ink-3">
            <MapPin className="size-3.5" aria-hidden />
            Click the map to drop a pin, or type the coordinates.
            <Button variant="link" size="sm" className="ml-auto h-auto p-0 text-xs" onClick={() => { setCustom(false); onChange({ address: "", lat: "", lng: "" }); }}>
              Use a known place
            </Button>
          </p>
        </div>
      )}
      <FieldError>{error}</FieldError>
    </div>
  );
}
