import { memo, useMemo, useState } from "react";
import { CircleMarker, Popup, useMap, useMapEvents } from "react-leaflet";
import type { HeatmapPoint } from "../../hooks/useCrashHeatmap";
import type { PaletteKey } from "../../lib/choropleth/palettes";
import { useIsDark } from "../../context/ThemeContext";
import { useLiteMode } from "../../context/LiteModeContext";
import { useDesignTokens } from "../../hooks/useDesignTokens";
import { getMapSeverityColors } from "../../lib/theme/tokens";

interface CrashDotLayerProps {
  points: HeatmapPoint[];
  enabled: boolean;
  palette: PaletteKey;
}

interface DotColors { fatal: string; injury: string; pdo: string }

function getColor(severity: string | null | undefined, colors: DotColors): string {
  if (severity === "Fatal") return colors.fatal;
  if (severity === "Injury") return colors.injury;
  return colors.pdo;
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

const MIN_ZOOM = 14;

export default memo(function CrashDotLayer({ points, enabled, palette }: CrashDotLayerProps) {
  const map = useMap();
  const isDark = useIsDark();
  const { isLite } = useLiteMode();
  const tokens = useDesignTokens();
  // Severity colors follow the map palette selected in the Layers panel, so
  // e.g. the colorblind-safe palette reaches the dots (see getMapSeverityColors).
  const dotColors: DotColors = getMapSeverityColors(palette, isDark, tokens.severity);
  const [zoom, setZoom] = useState(map.getZoom());
  const [center, setCenter] = useState(map.getCenter());
  const maxDots = isLite ? 400 : 800;

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
        .slice(0, maxDots);
    } catch {
      return [];
    }
  }, [points, enabled, zoom, center.lat, center.lng, map, maxDots]);

  if (visible.length === 0) return null;

  const borderColor = isDark ? "#1f2937" : "#fff";

  return (
    <>
      {visible.map((p, i) => {
        const color = getColor(p.severity, dotColors);
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
              },
            }}
          >
            <Popup offset={[0, -4]} maxWidth={Math.min(260, window.innerWidth - 40)} autoPan={false}>
              <div style={{ minWidth: 180, maxWidth: 240, fontSize: 12, lineHeight: 1.5 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: getColor(p.severity, dotColors), display: "inline-block", border: `2px solid ${borderColor}`, flexShrink: 0 }} />
                  <strong style={{ fontSize: 14 }}>{p.severity ?? "Unknown"}</strong>
                  {p.hit_run && (
                    <span style={{ fontSize: 10, fontWeight: 700, background: "rgb(var(--error-container))", color: "rgb(var(--on-error-container))", padding: "2px 8px", borderRadius: 10 }}>
                      HIT & RUN
                    </span>
                  )}
                </div>

                <div style={{ color: "rgb(var(--on-surface-variant))", marginBottom: 8, fontSize: 12 }}>{formatDate(p.crash_datetime)}</div>

                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <tbody>
                    {p.primary_road && (
                      <tr>
                        <td style={{ color: "rgb(var(--on-surface-variant))", paddingRight: 12, paddingBottom: 4, whiteSpace: "nowrap", verticalAlign: "top" }}>Road</td>
                        <td style={{ paddingBottom: 4 }}>{p.primary_road}</td>
                      </tr>
                    )}
                    <tr>
                      <td style={{ color: "rgb(var(--on-surface-variant))", paddingRight: 12, paddingBottom: 4, whiteSpace: "nowrap" }}>Cause</td>
                      <td style={{ paddingBottom: 4 }}>{formatCause(p.canonical_cause)}</td>
                    </tr>
                    {p.weather && (
                      <tr>
                        <td style={{ color: "rgb(var(--on-surface-variant))", paddingRight: 12, paddingBottom: 4 }}>Weather</td>
                        <td style={{ paddingBottom: 4 }}>{p.weather}</td>
                      </tr>
                    )}
                    {p.lighting && (
                      <tr>
                        <td style={{ color: "rgb(var(--on-surface-variant))", paddingRight: 12, paddingBottom: 4 }}>Lighting</td>
                        <td style={{ paddingBottom: 4 }}>{p.lighting}</td>
                      </tr>
                    )}
                  </tbody>
                </table>

                {(p.number_killed || p.number_injured) ? (
                  <div style={{ display: "flex", gap: 16, marginTop: 8, paddingTop: 8, borderTop: "1px solid rgb(var(--outline-variant))" }}>
                    {p.number_killed ? <span style={{ color: dotColors.fatal, fontWeight: 700, fontSize: 12 }}>{p.number_killed} killed</span> : null}
                    {p.number_injured ? <span style={{ color: "rgb(var(--tertiary))", fontWeight: 700, fontSize: 12 }}>{p.number_injured} injured</span> : null}
                  </div>
                ) : null}

                {p.collision_id && (
                  <div style={{ fontSize: 10, color: "rgb(var(--on-surface-variant))", marginTop: 8 }}>
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
});
