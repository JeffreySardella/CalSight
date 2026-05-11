import { useMemo } from "react";
import { CircleMarker, Popup, useMap } from "react-leaflet";
import type { Hospital, School } from "../../hooks/useMapOverlays";

interface OverlayMarkersProps {
  hospitals: Hospital[];
  schools: School[];
  showHospitals: boolean;
  showSchools: boolean;
}

function useViewportItems<T extends { latitude: number | null; longitude: number | null }>(
  items: T[],
  enabled: boolean,
  maxItems: number,
): T[] {
  const map = useMap();
  const zoom = map.getZoom();
  const center = map.getCenter();

  return useMemo(() => {
    if (!enabled || items.length === 0) return [];
    const valid = items.filter((i) => i.latitude != null && i.longitude != null);
    if (valid.length <= maxItems) return valid;
    try {
      const bounds = map.getBounds();
      const visible = valid.filter((item) =>
        bounds.contains([item.latitude!, item.longitude!])
      );
      return visible.slice(0, maxItems);
    } catch {
      return valid.slice(0, maxItems);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, enabled, maxItems, zoom, center.lat, center.lng]);
}

export default function OverlayMarkers({ hospitals, schools, showHospitals, showSchools }: OverlayMarkersProps) {
  const visibleHospitals = useViewportItems(hospitals, showHospitals, 560);
  const visibleSchools = useViewportItems(schools, showSchools, 500);

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
