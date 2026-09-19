import { memo, useMemo, useCallback } from "react";
import { Marker, Popup, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import type { Hospital, School } from "../../hooks/useMapOverlays";
import {
  coverageCaveat,
  schoolCrashColor,
  schoolRampEdges,
  yearsLabel,
  type SchoolCrashCountsResponse,
} from "../../lib/map/schoolCrashRamp";

function useCenterOnClick() {
  const map = useMap();
  return useCallback(() => {
    if (window.innerWidth >= 768) return;
    setTimeout(() => {
      const popup = document.querySelector(".leaflet-popup");
      if (!popup) return;
      const rect = popup.getBoundingClientRect();
      const mapRect = map.getContainer().getBoundingClientRect();
      const popupCenterY = rect.top + rect.height / 2;
      const mapCenterY = mapRect.top + mapRect.height / 2;
      const dy = popupCenterY - mapCenterY;
      const popupCenterX = rect.left + rect.width / 2;
      const mapCenterX = mapRect.left + mapRect.width / 2;
      const dx = popupCenterX - mapCenterX;
      map.panBy([dx, dy], { animate: true, duration: 0.3 });
    }, 100);
  }, [map]);
}

interface OverlayMarkersProps {
  hospitals: Hospital[];
  schools: School[];
  showHospitals: boolean;
  showSchools: boolean;
  /** Crashes within 500 ft per school, for the marker ramp. Undefined while
   *  loading, or when the matview hasn't been populated yet — either way the
   *  markers fall back to the flat no-data color. */
  schoolCrashCounts?: SchoolCrashCountsResponse;
}

const hospitalIcon = L.divIcon({
  className: "",
  html: `<div style="width:24px;height:24px;display:flex;align-items:center;justify-content:center;background:#dc2626;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3)">
    <span style="color:#fff;font-weight:900;font-size:13px;line-height:1">H</span>
  </div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

// One divIcon per ramp color rather than per school — Leaflet keeps the
// instance alive for every marker, and 10K schools x a fresh icon object was
// the difference between a smooth pan and a stutter.
const schoolIconCache = new Map<string, L.DivIcon>();

function schoolIcon(color: string): L.DivIcon {
  const hit = schoolIconCache.get(color);
  if (hit) return hit;
  const icon = L.divIcon({
    className: "",
    html: `<div style="width:22px;height:22px;display:flex;align-items:center;justify-content:center;background:${color};border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3)">
    <span style="font-size:12px;line-height:1">\u{1F393}</span>
  </div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
  schoolIconCache.set(color, icon);
  return icon;
}

function createClusterIcon(color: string) {
  return (cluster: { getChildCount(): number }) => {
    const count = cluster.getChildCount();
    const size = count < 50 ? 36 : count < 200 ? 44 : 52;
    return L.divIcon({
      html: `<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:${color};border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);color:#fff;font-weight:700;font-size:${size < 40 ? 12 : 14}px">${count}</div>`,
      className: "",
      iconSize: L.point(size, size),
    });
  };
}

const hospitalClusterIcon = createClusterIcon("#dc2626");
const schoolClusterIcon = createClusterIcon("#eab308");

export default memo(function OverlayMarkers({
  hospitals,
  schools,
  showHospitals,
  showSchools,
  schoolCrashCounts,
}: OverlayMarkersProps) {
  const centerOnClick = useCenterOnClick();

  const countsByCds = useMemo(
    () => new Map((schoolCrashCounts?.schools ?? []).map((c) => [c.cds_code, c])),
    [schoolCrashCounts],
  );
  const rampEdges = useMemo(
    () => schoolRampEdges(schoolCrashCounts?.schools ?? []),
    [schoolCrashCounts],
  );
  const coverageByCounty = useMemo(
    () => new Map((schoolCrashCounts?.coverage ?? []).map((c) => [c.county_code, c])),
    [schoolCrashCounts],
  );
  const yearsText = yearsLabel(schoolCrashCounts?.years ?? []);

  const validHospitals = useMemo(
    () => hospitals.filter((h) => h.latitude != null && h.longitude != null),
    [hospitals],
  );
  const validSchools = useMemo(
    () => schools.filter((s) => s.latitude != null && s.longitude != null),
    [schools],
  );

  return (
    <>
      {showHospitals && validHospitals.length > 0 && (
        <MarkerClusterGroup
          chunkedLoading
          maxClusterRadius={50}
          disableClusteringAtZoom={13}
          iconCreateFunction={hospitalClusterIcon}
        >
          {validHospitals.map((h) => (
            <Marker
              key={h.facility_id}
              position={[h.latitude!, h.longitude!]}
              icon={hospitalIcon}
              eventHandlers={{ click: centerOnClick }}
            >
              <Popup>
                <div style={{ fontSize: 12, minWidth: 180 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: "#dc2626", display: "inline-block" }} />
                    <strong>Hospital</strong>
                  </div>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{h.facility_name}</div>
                  <div style={{ color: "rgb(var(--on-surface-variant))" }}>{h.city}</div>
                  {h.trauma_center && <div style={{ color: "#dc2626", fontWeight: 600, marginTop: 4 }}>{h.trauma_center}</div>}
                </div>
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
      )}
      {showSchools && validSchools.length > 0 && (
        <MarkerClusterGroup
          chunkedLoading
          maxClusterRadius={60}
          disableClusteringAtZoom={14}
          iconCreateFunction={schoolClusterIcon}
        >
          {validSchools.map((s) => {
            const counts = countsByCds.get(s.cds_code);
            const color = schoolCrashColor(counts?.crashes, rampEdges);
            const caveat = coverageCaveat(coverageByCounty.get(s.county_code));
            return (
              <Marker
                key={s.cds_code}
                position={[s.latitude!, s.longitude!]}
                icon={schoolIcon(color)}
                eventHandlers={{ click: centerOnClick }}
              >
                <Popup>
                  <div style={{ fontSize: 12, minWidth: 180, maxWidth: 240 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <span style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: color, display: "inline-block" }} />
                      <strong>School</strong>
                    </div>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>{s.school_name}</div>
                    <div style={{ color: "rgb(var(--on-surface-variant))" }}>{s.city} — {s.school_type}</div>
                    <div style={{ marginTop: 6, borderTop: "1px solid rgb(var(--outline-variant))", paddingTop: 6 }}>
                      <div style={{ fontWeight: 600, marginBottom: 2 }}>
                        Within 500 ft ({yearsText})
                      </div>
                      <div>{counts?.crashes ?? 0} crashes</div>
                      <div>
                        {counts?.killed ?? 0} killed, {counts?.injured ?? 0} injured,{" "}
                        {counts?.severe_injured ?? 0} seriously injured
                      </div>
                      {caveat && (
                        <div style={{ marginTop: 6, color: "rgb(var(--on-surface-variant))", lineHeight: 1.35 }}>
                          {caveat}
                        </div>
                      )}
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MarkerClusterGroup>
      )}
    </>
  );
});
