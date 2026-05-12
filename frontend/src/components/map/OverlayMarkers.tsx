import { useMemo, useState } from "react";
import { Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { Hospital, School } from "../../hooks/useMapOverlays";

interface OverlayMarkersProps {
  hospitals: Hospital[];
  schools: School[];
  showHospitals: boolean;
  showSchools: boolean;
}

const hospitalIcon = L.divIcon({
  className: "",
  html: `<div style="width:24px;height:24px;display:flex;align-items:center;justify-content:center;background:#dc2626;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3)">
    <span style="color:#fff;font-weight:900;font-size:13px;line-height:1">H</span>
  </div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

const schoolIcon = L.divIcon({
  className: "",
  html: `<div style="width:22px;height:22px;display:flex;align-items:center;justify-content:center;background:#2563eb;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3)">
    <span style="color:#fff;font-weight:900;font-size:11px;line-height:1">S</span>
  </div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function useViewportItems<T extends { latitude: number | null; longitude: number | null }>(
  items: T[],
  enabled: boolean,
  maxItems: number,
): T[] {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  const [center, setCenter] = useState(map.getCenter());

  useMapEvents({
    zoomend: () => { setZoom(map.getZoom()); setCenter(map.getCenter()); },
    moveend: () => setCenter(map.getCenter()),
  });

  return useMemo(() => {
    if (!enabled || items.length === 0) return [];
    const valid = items.filter((i) => i.latitude != null && i.longitude != null);
    if (valid.length <= maxItems) return valid;
    try {
      const bounds = map.getBounds();
      return valid.filter((item) =>
        bounds.contains([item.latitude!, item.longitude!])
      ).slice(0, maxItems);
    } catch {
      return valid.slice(0, maxItems);
    }
  }, [items, enabled, maxItems, zoom, center.lat, center.lng, map]);
}

export default function OverlayMarkers({ hospitals, schools, showHospitals, showSchools }: OverlayMarkersProps) {
  const visibleHospitals = useViewportItems(hospitals, showHospitals, 560);
  const visibleSchools = useViewportItems(schools, showSchools, 500);

  return (
    <>
      {visibleHospitals.map((h) => (
        <Marker
          key={h.facility_id}
          position={[h.latitude!, h.longitude!]}
          icon={hospitalIcon}
        >
          <Popup>
            <div style={{ fontSize: 12, minWidth: 180 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: "#dc2626", display: "inline-block" }} />
                <strong>Hospital</strong>
              </div>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>{h.facility_name}</div>
              <div style={{ color: "#666" }}>{h.city}</div>
              {h.trauma_center && <div style={{ color: "#dc2626", fontWeight: 600, marginTop: 4 }}>{h.trauma_center}</div>}
            </div>
          </Popup>
        </Marker>
      ))}
      {visibleSchools.map((s) => (
        <Marker
          key={s.cds_code}
          position={[s.latitude!, s.longitude!]}
          icon={schoolIcon}
        >
          <Popup>
            <div style={{ fontSize: 12, minWidth: 180 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: "#2563eb", display: "inline-block" }} />
                <strong>School</strong>
              </div>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>{s.school_name}</div>
              <div style={{ color: "#666" }}>{s.city} — {s.school_type}</div>
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  );
}
