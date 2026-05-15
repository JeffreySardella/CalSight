import { useEffect, useRef, useState } from "react";

export interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type: string;
  address?: {
    county?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
  };
}

const CA_VIEWBOX = "-124.5,42.0,-114.1,32.5";
const DEBOUNCE_MS = 1000;

export function useNominatim(query: string, enabled: boolean) {
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!enabled || trimmed.length < 3) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const params = new URLSearchParams({
          q: trimmed,
          format: "json",
          bounded: "1",
          viewbox: CA_VIEWBOX,
          limit: "4",
          addressdetails: "1",
        });
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?${params}`,
          {
            signal: controller.signal,
            headers: { "User-Agent": "CalSight/1.0 (https://calsight.app)" },
          },
        );
        if (!res.ok) throw new Error(`Nominatim ${res.status}`);
        const data: NominatimResult[] = await res.json();
        setResults(data);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [query, enabled]);

  return { results, loading };
}
