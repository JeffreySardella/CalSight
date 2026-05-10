import { useState, useCallback } from "react";
import FilterChip from "./FilterChip";

const WEATHER = [
  { value: "clear", label: "Clear" },
  { value: "cloudy", label: "Cloudy" },
  { value: "rain", label: "Rain" },
  { value: "fog", label: "Fog" },
  { value: "snow", label: "Snow" },
  { value: "wind", label: "Wind" },
];

const LIGHTING = [
  { value: "daylight", label: "Daylight" },
  { value: "dark_lit", label: "Dark (Street Lights)" },
  { value: "dark_unlit", label: "Dark (No Lights)" },
  { value: "dusk_dawn", label: "Dusk / Dawn" },
];

const COLLISION_TYPES = [
  { value: "rear_end", label: "Rear End" },
  { value: "broadside", label: "Broadside" },
  { value: "sideswipe", label: "Sideswipe" },
  { value: "hit_object", label: "Hit Object" },
  { value: "head_on", label: "Head On" },
];

const ROAD_TYPES = [
  { value: "highway", label: "Highway" },
  { value: "local", label: "Local Road" },
];

function toggleInSet(set: Set<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

export default function StepConditions() {
  const [weather, setWeather] = useState<Set<string>>(new Set());
  const [lighting, setLighting] = useState<Set<string>>(new Set());
  const [collisionType, setCollisionType] = useState<Set<string>>(new Set());
  const [roadType, setRoadType] = useState<string | null>(null);
  const [hitRun, setHitRun] = useState(false);

  const toggleWeather = useCallback((v: string) => {
    setWeather((prev) => toggleInSet(prev, v));
  }, []);

  const toggleLighting = useCallback((v: string) => {
    setLighting((prev) => toggleInSet(prev, v));
  }, []);

  const toggleCollisionType = useCallback((v: string) => {
    setCollisionType((prev) => toggleInSet(prev, v));
  }, []);

  const toggleRoadType = useCallback((v: string) => {
    setRoadType((prev) => (prev === v ? null : v));
  }, []);

  const allWeather = weather.size === 0;
  const allLighting = lighting.size === 0;
  const allCollisionTypes = collisionType.size === 0;

  return (
    <div className="space-y-6">
      {/* Weather */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-bold text-on-surface mb-1">What were the conditions?</h3>
          <p className="text-[11px] text-on-surface-variant leading-snug">
            Weather at the time of the crash as recorded by the reporting officer. Empty means all conditions.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterChip label="All Weather" active={allWeather} onClick={() => setWeather(new Set())} />
          {WEATHER.map((w) => (
            <FilterChip
              key={w.value}
              label={w.label}
              active={!allWeather && weather.has(w.value)}
              onClick={() => toggleWeather(w.value)}
            />
          ))}
        </div>
      </div>

      {/* Lighting */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-bold text-on-surface mb-1">What was the lighting?</h3>
          <p className="text-[11px] text-on-surface-variant leading-snug">
            Lighting conditions at the crash site. Dark crashes with no street lights have higher fatality rates.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterChip label="All Lighting" active={allLighting} onClick={() => setLighting(new Set())} />
          {LIGHTING.map((l) => (
            <FilterChip
              key={l.value}
              label={l.label}
              active={!allLighting && lighting.has(l.value)}
              onClick={() => toggleLighting(l.value)}
            />
          ))}
        </div>
      </div>

      {/* Collision Type */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-bold text-on-surface mb-1">What type of collision?</h3>
          <p className="text-[11px] text-on-surface-variant leading-snug">
            How the vehicles collided. Rear-end is the most common; head-on is the most deadly.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterChip label="All Types" active={allCollisionTypes} onClick={() => setCollisionType(new Set())} />
          {COLLISION_TYPES.map((ct) => (
            <FilterChip
              key={ct.value}
              label={ct.label}
              active={!allCollisionTypes && collisionType.has(ct.value)}
              onClick={() => toggleCollisionType(ct.value)}
            />
          ))}
        </div>
      </div>

      {/* Road Type */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-bold text-on-surface mb-1">Road type</h3>
          <p className="text-[11px] text-on-surface-variant leading-snug">
            Highway (freeways, expressways, state routes) vs local roads (city streets, rural roads). Leave unselected for all.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterChip label="All Roads" active={roadType === null} onClick={() => setRoadType(null)} />
          {ROAD_TYPES.map((rt) => (
            <FilterChip
              key={rt.value}
              label={rt.label}
              active={roadType === rt.value}
              onClick={() => toggleRoadType(rt.value)}
            />
          ))}
        </div>
      </div>

      {/* Hit-and-Run */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-bold text-on-surface mb-1">Hit-and-run?</h3>
          <p className="text-[11px] text-on-surface-variant leading-snug">
            Show only crashes where a driver fled the scene (misdemeanor or felony hit-and-run).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterChip
            label="Hit-and-Run Only"
            icon="warning"
            active={hitRun}
            onClick={() => setHitRun((prev) => !prev)}
          />
        </div>
      </div>
    </div>
  );
}
