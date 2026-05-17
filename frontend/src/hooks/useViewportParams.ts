import { useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Map viewport encoded in the URL so a copied link reproduces the exact
 * camera. Three params: `lat`, `lng`, `zoom`. `lat`/`lng` are honored only as
 * a pair (a lone coordinate is meaningless); `zoom` stands alone.
 *
 * Leaflet owns the viewport after mount — the URL is a write-only mirror.
 * `initialViewport` is therefore read ONCE (frozen in a ref) and used only to
 * seed <MapContainer>. Later URL changes from writeViewport() are ignored by
 * Leaflet, which is what prevents a pan → setSearchParams → re-render loop.
 */

// Sanity bounds — mirror MapCanvas CA_BOUNDS / min-max zoom. Out-of-range
// params are dropped (not clamped) so a malformed link falls back cleanly to
// the default California view.
const LAT_MIN = 28, LAT_MAX = 46;
const LNG_MIN = -127, LNG_MAX = -112;
const ZOOM_MIN = 5, ZOOM_MAX = 18;

export type ViewportSeed = {
  center: [number, number] | null;
  zoom: number | null;
};

/** Parse `lat`/`lng`/`zoom` from URL params. Invalid pieces are dropped. */
export function parseViewport(searchParams: URLSearchParams): ViewportSeed {
  const latRaw = searchParams.get("lat");
  const lngRaw = searchParams.get("lng");
  const zoomRaw = searchParams.get("zoom");

  let center: [number, number] | null = null;
  if (latRaw != null && lngRaw != null) {
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (
      Number.isFinite(lat) && Number.isFinite(lng)
      && lat >= LAT_MIN && lat <= LAT_MAX
      && lng >= LNG_MIN && lng <= LNG_MAX
    ) {
      center = [lat, lng];
    }
  }

  let zoom: number | null = null;
  if (zoomRaw != null) {
    const z = Number(zoomRaw);
    if (Number.isFinite(z) && z >= ZOOM_MIN && z <= ZOOM_MAX) {
      zoom = z;
    }
  }

  return { center, zoom };
}

export function useViewportParams() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Frozen at first render — see module docstring. parseViewport always
  // returns an object, so the ref is populated exactly once.
  const initialRef = useRef<ViewportSeed | null>(null);
  if (initialRef.current === null) {
    initialRef.current = parseViewport(searchParams);
  }

  // Mirror the live viewport into the URL. `replace: true` keeps pan/zoom out
  // of browser history; lat/lng are not filter params so this never collides
  // with useFilterParams.
  const writeViewport = useCallback(
    (center: [number, number], zoom: number) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        params.set("lat", center[0].toFixed(4));
        params.set("lng", center[1].toFixed(4));
        params.set("zoom", String(Math.round(zoom)));
        return params;
      }, { replace: true });
    },
    [setSearchParams],
  );

  return { initialViewport: initialRef.current, writeViewport };
}
