import SimpleBarChart from "../charts/SimpleBarChart";
import SimpleLineChart from "../charts/SimpleLineChart";
import SimpleDonutChart from "../charts/SimpleDonutChart";
import type { ChartData } from "../../hooks/useAskAi";

const COLORS_LIGHT = ["#4a7a8c", "#994444", "#6b6b2e", "#3d7a5c", "#8a6d3b", "#5b4fa0", "#2d7d8a", "#b45309"];
const COLORS_DARK = ["#6b8fa3", "#c28a8a", "#b0a050", "#7ba088", "#b89a6b", "#8e7cc3", "#6baab5", "#c27862"];

function useColors() {
  const isDark = document.documentElement.classList.contains("dark");
  return isDark ? COLORS_DARK : COLORS_LIGHT;
}

interface Props {
  chart: ChartData;
}

function Tip({ label, value }: { label: string; value: number }) {
  return (
    <>
      <p className="font-bold text-on-surface">{label}</p>
      <p className="text-on-surface-variant">{value.toLocaleString()} crashes</p>
    </>
  );
}

export default function InlineChart({ chart }: Props) {
  const { type, title, data } = chart;
  const colors = useColors();

  if (!data || data.length === 0) return null;

  return (
    <div className="my-3 p-3 md:p-4 bg-surface-container rounded-lg overflow-x-auto">
      {title && (
        <p className="text-[10px] md:text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">{title}</p>
      )}
      <div className="min-w-[300px]" role="img" aria-label={title || "Data chart"}>
        {type === "line" ? (
          <SimpleLineChart
            data={data}
            height={180}
            showDots={data.length <= 12}
            renderTooltip={(item) => <Tip label={item.label} value={item.value} />}
          />
        ) : type === "pie" ? (
          <SimpleDonutChart
            data={data.map((d, i) => ({ label: d.label, value: d.value, color: colors[i % colors.length] }))}
            height={180}
            outerRadius={80}
            innerRadius={0}
            renderTooltip={(item) => <Tip label={item.label} value={item.value} />}
          />
        ) : (
          <SimpleBarChart
            data={data.map((d) => ({ label: d.label, value: d.value }))}
            height={180}
            defaultColor={colors[0]}
            radius={4}
            renderTooltip={(item) => <Tip label={item.label} value={item.value} />}
          />
        )}
      </div>
    </div>
  );
}
