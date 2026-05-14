import SimpleBarChart from "../charts/SimpleBarChart";
import SimpleLineChart from "../charts/SimpleLineChart";
import SimpleDonutChart from "../charts/SimpleDonutChart";
import type { ChartData } from "../../hooks/useAskAi";

const COLORS = ["#6b8fa3", "#c25560", "#b0a050", "#7ba088", "#b89a6b", "#8e7cc3", "#5a9eaf", "#d4845a"];

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
            data={data.map((d, i) => ({ label: d.label, value: d.value, color: COLORS[i % COLORS.length] }))}
            height={180}
            outerRadius={80}
            innerRadius={0}
            renderTooltip={(item) => <Tip label={item.label} value={item.value} />}
          />
        ) : (
          <SimpleBarChart
            data={data.map((d) => ({ label: d.label, value: d.value }))}
            height={180}
            defaultColor="#6b8fa3"
            radius={4}
            renderTooltip={(item) => <Tip label={item.label} value={item.value} />}
          />
        )}
      </div>
    </div>
  );
}
