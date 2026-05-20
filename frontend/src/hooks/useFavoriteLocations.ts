import { useCallback, useSyncExternalStore } from "react";
import { safeGetItem, safeSetItem } from "../lib/safeStorage";

export interface FavoriteLocation {
  name: string;
  lat: number;
  lng: number;
  county: string | null;
}

const STORAGE_KEY = "calsight-favorites";
const MAX_FAVORITES = 10;

let listeners: (() => void)[] = [];
function emit() {
  listeners.forEach((l) => l());
}

function readFavorites(): FavoriteLocation[] {
  try {
    const raw = safeGetItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeFavorites(favs: FavoriteLocation[]) {
  safeSetItem(STORAGE_KEY, JSON.stringify(favs.slice(0, MAX_FAVORITES)));
  emit();
}

let snapshot = readFavorites();
function getSnapshot() {
  const next = readFavorites();
  if (JSON.stringify(next) !== JSON.stringify(snapshot)) {
    snapshot = next;
  }
  return snapshot;
}

function subscribe(listener: () => void) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function useFavoriteLocations() {
  const favorites = useSyncExternalStore(subscribe, getSnapshot);

  const addFavorite = useCallback((fav: FavoriteLocation) => {
    const current = readFavorites();
    if (current.some((f) => f.lat === fav.lat && f.lng === fav.lng)) return;
    writeFavorites([fav, ...current]);
  }, []);

  const removeFavorite = useCallback((lat: number, lng: number) => {
    const current = readFavorites();
    writeFavorites(current.filter((f) => f.lat !== lat || f.lng !== lng));
  }, []);

  const isFavorite = useCallback(
    (lat: number, lng: number) => favorites.some((f) => f.lat === lat && f.lng === lng),
    [favorites],
  );

  return { favorites, addFavorite, removeFavorite, isFavorite };
}
