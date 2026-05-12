import { useMemo, useState } from "react";
import { CircleMarker, Popup, useMap, useMapEvents } from "react-leaflet";
import type { HeatmapPoint } from "../../hooks/useCrashHeatmap";
import type { PaletteKey } from "../../lib/choropleth/palettes";
import { useIsDark } from "../../context/ThemeContext";

interface CrashDotLayerProps {
  points: HeatmapPoint[];
  enabled: boolean;
  palette: PaletteKey;
}

const FATAL_COLORS: Record<PaletteKey, string> = {
  default: "#dc2626",
  warm: "#7c3aed",
  cool: "#dc2626",
  colorblind: "#e66100",
};

const INJURY_COLOR = "#f59e0b";
const PDO_COLOR = "#94a3b8";

function getColor(severity: string | null | undefined, palette: PaletteKey): string {
  if (severity === "Fatal") return FATAL_COLORS[palette];
  if (severity === "Injury") return INJURY_COLOR;
  return PDO_COLOR;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "Unknown date";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function formatCause(cause: string | null | undefined): string {
  if (!cause) return "Unknown";
  return cause.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const MIN_ZOOM = 11;

export default function CrashDotLayer({ points, enabled, palette }: CrashDotLayerProps) {
  const map = useMap();
  const isDark = useIsDark();
  const [zoom, setZoom] = useState(map.getZoom());
  const [center, setCenter] = useState(map.getCenter());

  useMapEvents({
    zoomend: () => { setZoom(map.getZoom()); setCenter(map.getCenter()); },
    moveend: () => setCenter(map.getCenter()),
  });

  const visible = useMemo(() => {
    if (!enabled || points.length === 0 || zoom < MIN_ZOOM) return [];
    try {
      const bounds = map.getBounds();
      return points
        .filter((p) => p.lat && p.lng && bounds.contains([p.lat, p.lng]))
        .slice(0, 800);
    } catch {
      return [];
    }
  }, [points, enabled, zoom, center.lat, center.lng, map]);

  if (visible.length === 0) return null;

  const borderColor = isDark ? "#1f2937" : "#fff";

  return (
    <>
      {visible.map((p, i) => {
        const color = getColor(p.severity, palette);
        return (
          <CircleMarker
            key={`${p.collision_id ?? i}-${p.lat}-${p.lng}`}
            center={[p.lat, p.lng]}
            radius={7}
            pane="crashDotPane"
            pathOptions={{
              color: borderColor,
              fillColor: color,
              fillOpacity: 0.9,
              weight: 2,
            }}
            eventHandlers={{
              click: () => {
                map.panTo([p.lat, p.lng], { animate: true, duration: 0.3 });
              },
            }}
          >
            <Popup offset={[0, -4]} maxWidth={300} className="crash-dot-popup">
              <div style={{ minWidth: 220, fontSize: 13, lineHeight: 1.6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ width: 12, height: 12, borderRadius: "50%", backgroundColor: color, display: "inline-block", border: `2px solid ${borderColor}`, flexShrink: 0 }} />
                  <strong style={{ fontSize: 16 }}>{p.severity ?? "Unknown"}</strong>
                  {p.hit_run && (
                    <span style={{ fontSize: 10, fontWeight: 700, background: "#fde8e8", color: "#b91c1c", padding: "2px 8px", borderRadius: 10 }}>
                      HIT & RUN
                    </span>
                  )}
                </div>

                <div style={{ color: "#6b7280", marginBottom: 8, fontSize: 12 }}>{formatDate(p.crash_datetime)}</div>

                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <tbody>
                    {p.primary_road && (
                      <tr>
                        <td style={{ color: "#9ca3af", paddingRight: 12, paddingBottom: 4, whiteSpace: "nowrap", verticalAlign: "top" }}>Road</td>
                        <td style={{ paddingBottom: 4 }}>{p.primary_road}</td>
                      </tr>
                    )}
                    <tr>
                      <td style={{ color: "#9ca3af", paddingRight: 12, paddingBottom: 4, whiteSpace: "nowrap" }}>Cause</td>
                      <td style={{ paddingBottom: 4 }}>{formatCause(p.canonical_cause)}</td>
                    </tr>
                    {p.weather && (
                      <tr>
                        <td style={{ color: "#9ca3af", paddingRight: 12, paddingBottom: 4 }}>Weather</td>
                        <td style={{ paddingBottom: 4 }}>{p.weather}</td>
                      </tr>
                    )}
                    {p.lighting && (
                      <tr>
                        <td style={{ color: "#9ca3af", paddingRight: 12, paddingBottom: 4 }}>Lighting</td>
                        <td style={{ paddingBottom: 4 }}>{p.lighting}</td>
                      </tr>
                    )}
                  </tbody>
                </table>

                {(p.number_killed || p.number_injured) ? (
                  <div style={{ display: "flex", gap: 16, marginTop: 8, paddingTop: 8, borderTop: "1px solid #e5e7eb" }}>
                    {p.number_killed ? <span style={{ color: FATAL_COLORS[palette], fontWeight: 700, fontSize: 13 }}>{p.number_killed} killed</span> : null}
                    {p.number_injured ? <span style={{ color: INJURY_COLOR, fontWeight: 700, fontSize: 13 }}>{p.number_injured} injured</span> : null}
                  </div>
                ) : null}

                {p.collision_id && (
                  <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 8 }}>
                    Collision #{p.collision_id} · {p.data_source?.toUpperCase()}
                  </div>
                )}
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}
