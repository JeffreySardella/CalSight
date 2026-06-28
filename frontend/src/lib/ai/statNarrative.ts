export type DistributionPoint = { id: string; name: string; value: number };

export type StatNarrative = {
  percentile: number;
  rank: number;
  total: number;
  paragraph: string;
};

export function statNarrative(args: {
  label: string;
  value: number;
  subjectId: string;
  distribution: DistributionPoint[];
  higherIsWorse?: boolean;
}): StatNarrative {
  const higherIsWorse = args.higherIsWorse ?? true;
  const total = args.distribution.length;
  // rank 1 = worst
  const sorted = [...args.distribution].sort((a, b) =>
    higherIsWorse ? b.value - a.value : a.value - b.value,
  );
  const idx = sorted.findIndex((d) => d.id === args.subjectId);
  const rank = idx >= 0 ? idx + 1 : total;

  const saferCount = args.distribution.filter((d) =>
    higherIsWorse ? d.value > args.value : d.value < args.value,
  ).length;
  const percentile = total > 1 ? Math.round((saferCount / (total - 0)) * 100) : 0;

  const paragraph =
    `${args.label} here ranks #${rank} of ${total} — ` +
    `safer than ${percentile}% of the group. ` +
    `This is an association in the data, not a cause.`;

  return { percentile, rank, total, paragraph };
}
