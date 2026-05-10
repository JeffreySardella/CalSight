import { CircleMarker, Popup } from "react-leaflet";
import type { Hospital, School } from "../../hooks/useMapOverlays";

interface OverlayMarkersProps {
  hospitals: Hospital[];
  schools: School[];
  showHospitals: boolean;
  showSchools: boolean;
}

export default function OverlayMarkers({ hospitals, schools, showHospitals, showSchools }: OverlayMarkersProps) {
  return (
    <>
      {showHospitals && hospitals.filter(h => h.latitude && h.longitude).map((h) => (
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
      {showSchools && schools.filter(s => s.latitude && s.longitude).map((s) => (
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
