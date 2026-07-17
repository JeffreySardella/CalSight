import { memo, useMemo } from "react";
import { Marker, Popup } from "react-leaflet";
import L from "leaflet";
import { Link } from "react-router-dom";
import { WATER_PAGE_PUBLIC } from "../../config";
import { useLayersState } from "../../hooks/useLayersState";
import { formatAcreFeet, useReservoirConditions } from "../../hooks/useWaterData";
import { markerSizePx, reservoirIconHtml } from "../../lib/map/reservoirMarkers";

/**
 * Opt-in map layer plotting the major reservoirs as capacity-sized gauge
 * markers (percent of capacity as both fill level and printed number).
 * Gated behind WATER_PAGE_PUBLIC while the Water page is soft-launched —
 * the popup links to /water and would advertise it.
 *
 * Data comes from the same /api/water/reservoirs query the Water page and
 * MapPage's error card use, so React Query dedupes the fetch. The explicit
 * fetch-error surface lives in MapPage (error-card convention) — this
 * component only draws what it has.
 */
export default memo(function ReservoirLayer() {
  const { otherLayers } = useLayersState();
  const enabled = WATER_PAGE_PUBLIC && otherLayers.reservoirs;
  const { data: reservoirs } = useReservoirConditions(enabled);

  const placeable = useMemo(
    () => (reservoirs ?? []).filter((r) => r.lat != null && r.lon != null),
    [reservoirs],
  );

  const maxCapacity = useMemo(
    () => placeable.reduce((m, r) => Math.max(m, r.capacity_af), 0),
    [placeable],
  );

  const icons = useMemo(() => {
    const map = new Map<string, L.DivIcon>();
    for (const r of placeable) {
      const size = markerSizePx(r.capacity_af, maxCapacity);
      map.set(
        r.station_id,
        L.divIcon({
          className: "",
          html: reservoirIconHtml(r, size),
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        }),
      );
    }
    return map;
  }, [placeable, maxCapacity]);

  if (!enabled || placeable.length === 0) return null;

  return (
    <>
      {placeable.map((r) => (
        <Marker
          key={r.station_id}
          position={[r.lat as number, r.lon as number]}
          icon={icons.get(r.station_id)}
        >
          <Popup>
            <div className="text-xs leading-snug min-w-[180px]">
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <span className="font-semibold">{r.name}</span>
                <span className="text-[10px] uppercase tracking-widest opacity-60">
                  {r.station_id}
                </span>
              </div>
              <div>
                {Math.round(r.pct_of_capacity)}% of capacity —{" "}
                {formatAcreFeet(r.storage_af)} of {formatAcreFeet(r.capacity_af)} acre-feet
              </div>
              {r.pct_of_average !== null && (
                <div>{Math.round(r.pct_of_average)}% of average for today</div>
              )}
              <div className="opacity-60 mt-0.5">as of {r.latest_date}</div>
              <Link
                to="/water"
                className="inline-block mt-1.5 font-semibold text-primary hover:opacity-80 transition-opacity"
              >
                Water conditions →
              </Link>
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  );
});
