import { useMemo, useState, useEffect } from "react";
import { CircleMarker, Popup, useMap, useMapEvents } from "react-leaflet";
import type { Hospital, School } from "../../hooks/useMapOverlays";

interface OverlayMarkersProps {
  hospitals: Hospital[];
  schools: School[];
  showHospitals: boolean;
  showSchools: boolean;
}

function useVisibleItems<T extends { latitude: number | null; longitude: number | null }>(
  items: T[],
  enabled: boolean,
  maxItems = 500,
): T[] {
  const map = useMap();
  const [boundsKey, setBoundsKey] = useState(0);

  useMapEvents({
    moveend: () => setBoundsKey((k) => k + 1),
    zoomend: () => setBoundsKey((k) => k + 1),
  });

  return useMemo(() => {
    if (!enabled || items.length === 0) return [];
    let bounds: ReturnType<typeof map.getBounds> | null = null;
    try { bounds = map.getBounds(); } catch { /* not ready */ }
    if (!bounds) return items.filter((i) => i.latitude && i.longitude).slice(0, maxItems);
    const visible = items.filter((item) => {
      if (!item.latitude || !item.longitude) return false;
      return bounds!.contains([item.latitude, item.longitude]);
    });
    return visible.slice(0, maxItems);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, enabled, boundsKey, maxItems]);
}

export default function OverlayMarkers({ hospitals, schools, showHospitals, showSchools }: OverlayMarkersProps) {
  const visibleHospitals = useVisibleItems(hospitals, showHospitals, 560);
  const visibleSchools = useVisibleItems(schools, showSchools, 500);

  return (
    <>
      {visibleHospitals.map((h) => (
        <CircleMarker
          key={h.facility_id}
          center={[h.latitude!, h.longitude!]}
          radius={4}
          pathOptions={{ color: "#ef4444", fillColor: "#ef4444", fillOpacity: 0.8, weight: 1 }}
        >
          <Popup>
            <div className="text-xs">
              <p className="font-bold">{h.facility_name}</p>
              <p>{h.city}</p>
              {h.trauma_center && <p className="text-error font-semibold">{h.trauma_center}</p>}
            </div>
          </Popup>
        </CircleMarker>
      ))}
      {visibleSchools.map((s) => (
        <CircleMarker
          key={s.cds_code}
          center={[s.latitude!, s.longitude!]}
          radius={3}
          pathOptions={{ color: "#3b82f6", fillColor: "#3b82f6", fillOpacity: 0.6, weight: 1 }}
        >
          <Popup>
            <div className="text-xs">
              <p className="font-bold">{s.school_name}</p>
              <p>{s.city} — {s.school_type}</p>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </>
  );
}
