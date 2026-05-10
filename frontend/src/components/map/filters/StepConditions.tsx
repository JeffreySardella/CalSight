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

interface ConditionCounts {
  weather?: Record<string, number>;
  lighting?: Record<string, number>;
  collisionType?: Record<string, number>;
  roadType?: Record<string, number>;
  hitRun?: number;
}

interface StepConditionsProps {
  weather: Set<string>;
  lighting: Set<string>;
  collisionType: Set<string>;
  roadType: string | null;
  hitRun: boolean;
  onToggleWeather: (v: string) => void;
  onClearWeather: () => void;
  onToggleLighting: (v: string) => void;
  onClearLighting: () => void;
  onToggleCollisionType: (v: string) => void;
  onClearCollisionType: () => void;
  onSetRoadType: (v: string | null) => void;
  onToggleHitRun: () => void;
  conditionCounts?: ConditionCounts;
  loading?: boolean;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

export default function StepConditions({
  weather,
  lighting,
  collisionType,
  roadType,
  hitRun,
  onToggleWeather,
  onClearWeather,
  onToggleLighting,
  onClearLighting,
  onToggleCollisionType,
  onClearCollisionType,
  onSetRoadType,
  onToggleHitRun,
  conditionCounts,
  loading,
}: StepConditionsProps) {
  const allWeather = weather.size === 0;
  const allLighting = lighting.size === 0;
  const allCollisionTypes = collisionType.size === 0;

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="space-y-3">
            <div className="h-4 bg-surface-container-high rounded w-48" />
            <div className="h-3 bg-surface-container-high rounded w-64" />
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: i === 4 ? 3 : i === 5 ? 1 : 5 }, (_, j) => (
                <div key={j} className="h-8 bg-surface-container-high rounded-full w-20" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

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
          <FilterChip label="All Weather" active={allWeather} onClick={onClearWeather} />
          {WEATHER.map((w) => {
            const count = conditionCounts?.weather?.[w.value];
            return (
              <FilterChip
                key={w.value}
                label={count != null ? `${w.label} (${fmt(count)})` : w.label}
                active={!allWeather && weather.has(w.value)}
                onClick={() => onToggleWeather(w.value)}
                disabled={count === 0}
              />
            );
          })}
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
          <FilterChip label="All Lighting" active={allLighting} onClick={onClearLighting} />
          {LIGHTING.map((l) => {
            const count = conditionCounts?.lighting?.[l.value];
            return (
              <FilterChip
                key={l.value}
                label={count != null ? `${l.label} (${fmt(count)})` : l.label}
                active={!allLighting && lighting.has(l.value)}
                onClick={() => onToggleLighting(l.value)}
                disabled={count === 0}
              />
            );
          })}
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
          <FilterChip label="All Types" active={allCollisionTypes} onClick={onClearCollisionType} />
          {COLLISION_TYPES.map((ct) => {
            const count = conditionCounts?.collisionType?.[ct.value];
            return (
              <FilterChip
                key={ct.value}
                label={count != null ? `${ct.label} (${fmt(count)})` : ct.label}
                active={!allCollisionTypes && collisionType.has(ct.value)}
                onClick={() => onToggleCollisionType(ct.value)}
                disabled={count === 0}
              />
            );
          })}
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
          <FilterChip label="All Roads" active={roadType === null} onClick={() => onSetRoadType(null)} />
          {ROAD_TYPES.map((rt) => {
            const count = conditionCounts?.roadType?.[rt.value];
            return (
              <FilterChip
                key={rt.value}
                label={count != null ? `${rt.label} (${fmt(count)})` : rt.label}
                active={roadType === rt.value}
                disabled={count === 0}
                onClick={() => onSetRoadType(roadType === rt.value ? null : rt.value)}
              />
            );
          })}
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
            label={conditionCounts?.hitRun != null ? `Hit-and-Run Only (${fmt(conditionCounts.hitRun)})` : "Hit-and-Run Only"}
            icon="warning"
            active={hitRun}
            disabled={conditionCounts?.hitRun === 0}
            onClick={onToggleHitRun}
          />
        </div>
      </div>
    </div>
  );
}
