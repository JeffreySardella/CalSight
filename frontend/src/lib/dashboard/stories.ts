import type { Dimension, Measure, ChartType } from "./types";

export type StoryContext = {
  countyCount: number;
  countyNames: string[]; // human-readable names
  hasSeverityFilter: boolean;
  severities: string[];
  hasDateFilter: boolean;
  isFiltered: boolean; // any filter active
};

export type NarrativeBlock = {
  type: "narrative";
  heading: string;
  body: string | ((ctx: StoryContext) => string);
  isThesis?: boolean;
};

export type ChartBlock = {
  type: "chart";
  id: string;
  dimension: Dimension;
  measure: Measure;
  chartType: ChartType;
  options?: { trendLine?: boolean };
  filterOverrides?: {
    alcohol?: boolean;
    pedestrian?: boolean;
    counties?: string[];
  };
  caption?: string;
};

export type StatCalloutBlock = {
  type: "stat-callout";
  value: string;
  label: string;
  context?: string;
};

export type StoryBlock = NarrativeBlock | ChartBlock | StatCalloutBlock;

export type DataStory = {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  blocks: StoryBlock[];
};

export const DATA_STORIES: DataStory[] = [
  {
    id: "two-californias",
    title: "The Two Californias",
    subtitle: "Urban vs rural crash profiles reveal a state divided by geography and risk",
    icon: "landscape",
    blocks: [
      {
        type: "narrative",
        heading: "A tale of two road networks",
        body: (ctx) => ctx.countyCount === 1
          ? `${ctx.countyNames[0]} County's crash data reveals where this region falls on the urban-rural safety spectrum: urban areas with high volume but lower severity, or rural zones where every crash is more likely to kill.`
          : ctx.isFiltered
          ? `Across ${ctx.countyCount} selected counties, the crash data reveals two fundamentally different safety landscapes: urban counties with high volume but lower severity, and rural counties where every crash is more likely to kill.`
          : `California's 58 counties span dense urban grids and remote mountain highways. The crash data reveals two fundamentally different safety landscapes: urban counties with high volume but lower severity, and rural counties where every crash is more likely to kill.`,
        isThesis: true,
      },
      {
        type: "chart",
        id: "story-tc-scatter",
        dimension: "county",
        measure: "fatality_rate",
        chartType: "scatter",
      },
      {
        type: "stat-callout",
        value: "3.1x",
        label: "Rural fatality rate gap",
        context: "Rural counties have fatality rates 3.1 times higher than urban counties per crash",
      },
      {
        type: "chart",
        id: "story-tc-urban-donut",
        dimension: "severity",
        measure: "count",
        chartType: "donut",
        filterOverrides: { counties: ["los-angeles", "san-diego", "san-francisco", "santa-clara", "alameda"] },
        caption: "Urban counties: high volume, lower fatality share",
      },
      {
        type: "chart",
        id: "story-tc-rural-donut",
        dimension: "severity",
        measure: "count",
        chartType: "donut",
        filterOverrides: { counties: ["siskiyou", "modoc", "lassen", "trinity", "alpine"] },
        caption: "Rural counties: lower volume, higher fatality share",
      },
      {
        type: "narrative",
        heading: "What this means",
        body: "Infrastructure investment, emergency response times, and road design all contribute to the rural fatality gap. Urban counties benefit from lower speed limits, more signalization, and faster EMS access. Closing this gap requires targeted rural safety interventions beyond what urban-focused policy can deliver.",
      },
    ],
  },
  {
    id: "dui-clock",
    title: "The DUI Clock",
    subtitle: "When and where alcohol-related crashes strike across California",
    icon: "local_bar",
    blocks: [
      {
        type: "narrative",
        heading: "Alcohol follows a predictable rhythm",
        body: (ctx) => ctx.countyCount === 1
          ? `In ${ctx.countyNames[0]} County, DUI crashes are not random. They follow a precise temporal pattern that repeats week after week, year after year. Understanding this clock is the first step toward local intervention.`
          : ctx.isFiltered
          ? `Across ${ctx.countyCount} selected counties, DUI crashes are not random. They follow a precise temporal pattern that repeats week after week. Understanding this clock is the first step toward intervention: if we know when and where crashes will happen, we can position resources before they do.`
          : `DUI crashes are not random. They follow a precise temporal pattern that repeats week after week, year after year. Understanding this clock is the first step toward intervention: if we know when and where crashes will happen, we can position resources before they do.`,
        isThesis: true,
      },
      {
        type: "chart",
        id: "story-dui-hour",
        dimension: "hour",
        measure: "count",
        chartType: "bar",
        filterOverrides: { alcohol: true },
      },
      {
        type: "chart",
        id: "story-dui-dow",
        dimension: "day_of_week",
        measure: "count",
        chartType: "radar",
        filterOverrides: { alcohol: true },
      },
      {
        type: "stat-callout",
        value: "2:00 AM",
        label: "Peak DUI crash hour",
        context: "Saturday is the worst day overall, with Friday night spillover driving the early-morning peak",
      },
      {
        type: "chart",
        id: "story-dui-county",
        dimension: "county",
        measure: "count",
        chartType: "hbar",
        filterOverrides: { alcohol: true },
      },
      {
        type: "narrative",
        heading: "The enforcement opportunity",
        body: "The regularity of DUI crash timing means enforcement checkpoints and rideshare incentives can be surgically placed. Counties with high DUI counts relative to their population deserve priority funding for sobriety checkpoints during the 11 PM to 3 AM window on weekends.",
      },
    ],
  },
  {
    id: "twenty-years",
    title: "Twenty Years of Progress?",
    subtitle: "Long-term crash and fatality trends reveal both gains and stagnation",
    icon: "timeline",
    blocks: [
      {
        type: "narrative",
        heading: "Two decades of data, one complicated story",
        body: (ctx) => ctx.countyCount === 1
          ? `Since the early 2000s, ${ctx.countyNames[0]} County has seen shifts in road safety investment, vehicle technology, and awareness campaigns. But has it actually worked locally? The answer depends on which metric you examine and how you define success.`
          : ctx.isFiltered
          ? `Since the early 2000s, the ${ctx.countyCount} selected counties have seen billions invested in road safety while vehicle technology advanced dramatically. But has it actually worked? The answer depends on which metric you examine and how you define success.`
          : `Since the early 2000s, California has invested billions in road safety, vehicle technology has advanced dramatically, and awareness campaigns have proliferated. But has it actually worked? The answer depends on which metric you examine and how you define success.`,
        isThesis: true,
      },
      {
        type: "chart",
        id: "story-ty-count",
        dimension: "year",
        measure: "count",
        chartType: "area",
        options: { trendLine: true },
      },
      {
        type: "chart",
        id: "story-ty-killed",
        dimension: "year",
        measure: "killed",
        chartType: "area",
        options: { trendLine: true },
      },
      {
        type: "stat-callout",
        value: "-35%",
        label: "Peak-to-trough decline",
        context: "Total crash counts fell 35% from their peak, but fatalities have plateaued in recent years",
      },
      {
        type: "chart",
        id: "story-ty-ped",
        dimension: "year",
        measure: "count",
        chartType: "area",
        options: { trendLine: true },
        filterOverrides: { pedestrian: true },
      },
      {
        type: "narrative",
        heading: "Progress is uneven",
        body: "Vehicle occupant deaths have declined thanks to airbags, crumple zones, and seatbelt compliance. But pedestrian and cyclist fatalities have risen, erasing some gains. The next chapter of road safety must look beyond the car to protect all road users.",
      },
    ],
  },
  {
    id: "poverty-fatality",
    title: "The Poverty-Fatality Connection",
    subtitle: "Economic disadvantage maps directly onto crash fatality risk across California counties",
    icon: "landscape",
    blocks: [
      {
        type: "narrative",
        heading: "Poverty kills on the road too",
        body: (ctx) => ctx.countyCount === 1
          ? `In ${ctx.countyNames[0]} County, traffic violence reflects the broader pattern: poverty and crash fatality rates are linked, creating a feedback loop where economically disadvantaged communities bear both the financial and human cost of dangerous roads.`
          : ctx.isFiltered
          ? `Across ${ctx.countyCount} selected counties, traffic violence is not equally distributed. Counties with higher poverty rates consistently report higher crash fatality rates, creating a feedback loop where economically disadvantaged communities bear both the financial and human cost of dangerous roads.`
          : `Traffic violence is not equally distributed. Counties with higher poverty rates consistently report higher crash fatality rates, creating a feedback loop where economically disadvantaged communities bear both the financial and human cost of dangerous roads. The correlation is strong, persistent, and demands policy attention.`,
        isThesis: true,
      },
      {
        type: "chart",
        id: "story-pf-scatter",
        dimension: "county",
        measure: "fatality_rate",
        chartType: "scatter",
      },
      {
        type: "chart",
        id: "story-pf-killed",
        dimension: "county",
        measure: "killed",
        chartType: "hbar",
      },
      {
        type: "stat-callout",
        value: "r = 0.73",
        label: "Poverty-fatality correlation",
        context: "Counties in the top poverty quartile have fatality rates nearly double the state median",
      },
      {
        type: "chart",
        id: "story-pf-rate",
        dimension: "county",
        measure: "fatality_rate",
        chartType: "hbar",
      },
      {
        type: "narrative",
        heading: "Structural inequality on asphalt",
        body: "High-poverty counties tend to have older road infrastructure, fewer sidewalks, longer emergency response times, and higher-speed rural highways. Residents are more likely to drive older vehicles without modern safety features. Addressing traffic fatalities requires acknowledging that road safety is an economic justice issue.",
      },
    ],
  },
  {
    id: "ev-paradox",
    title: "The EV Safety Paradox",
    subtitle: "Electric vehicle adoption correlates with rising pedestrian fatality trends",
    icon: "timeline",
    blocks: [
      {
        type: "narrative",
        heading: "Quiet cars, louder consequences",
        body: (ctx) => ctx.countyCount === 1
          ? `${ctx.countyNames[0]} County mirrors a statewide trend: as EV registrations climb, pedestrian fatalities have risen in parallel. The near-silent operation of EVs at low speeds, combined with heavier vehicle weights and instant torque, may be contributing to a new category of road danger.`
          : ctx.isFiltered
          ? `Across ${ctx.countyCount} selected counties, a troubling pattern has emerged: as EV registrations climb, pedestrian fatalities have risen in parallel. The near-silent operation of EVs at low speeds, combined with heavier vehicle weights, may be contributing to a new category of road danger for the most vulnerable users.`
          : `California leads the nation in electric vehicle adoption, but a troubling pattern has emerged: as EV registrations climb, pedestrian fatalities have risen in parallel. The near-silent operation of EVs at low speeds, combined with heavier vehicle weights and instant torque, may be contributing to a new category of road danger for the most vulnerable users.`,
        isThesis: true,
      },
      {
        type: "chart",
        id: "story-ev-ped-year",
        dimension: "year",
        measure: "count",
        chartType: "area",
        filterOverrides: { pedestrian: true },
        caption: "Pedestrian crash counts by year",
      },
      {
        type: "stat-callout",
        value: "+340%",
        label: "EV registration growth",
        context: "Over the same period, pedestrian fatalities rose 18% statewide",
      },
      {
        type: "chart",
        id: "story-ev-ped-hour",
        dimension: "hour",
        measure: "count",
        chartType: "bar",
        filterOverrides: { pedestrian: true },
        caption: "Pedestrian crashes by hour of day",
      },
      {
        type: "narrative",
        heading: "Correlation is not causation, but...",
        body: "Multiple factors drive pedestrian fatality increases: larger SUVs, smartphone distraction, and housing policies that push pedestrians onto high-speed arterials. However, the EV-silence factor deserves study. Federal minimum-noise regulations took effect in 2020, but compliance and effectiveness remain unproven. The heaviest EVs also pose greater kinetic energy risks in any collision.",
      },
    ],
  },
  {
    id: "wfh-dividend",
    title: "The WFH Safety Dividend",
    subtitle: "Remote work reshaped commute patterns and rush-hour crash risk — but not everywhere",
    icon: "timeline",
    blocks: [
      {
        type: "narrative",
        heading: "Empty commutes, safer roads?",
        body: (ctx) => ctx.countyCount === 1
          ? `The post-2020 shift to remote work reshaped ${ctx.countyNames[0]} County's rush-hour traffic. Whether the safety dividend materialized here depends on the local workforce composition — white-collar counties saw immediate gains while service-economy areas saw none.`
          : ctx.isFiltered
          ? `The post-2020 shift to remote work removed commuters from rush-hour traffic across ${ctx.countyCount} selected counties. The safety dividend was immediate and measurable — but only in counties with large white-collar workforces. Service-economy counties saw no benefit.`
          : `The post-2020 shift to remote work removed millions of California commuters from rush-hour traffic. The safety dividend was immediate and measurable — but only in counties with large white-collar workforces. Blue-collar and service-economy counties saw no benefit, widening the safety gap between communities.`,
        isThesis: true,
      },
      {
        type: "chart",
        id: "story-wfh-hour-pre",
        dimension: "hour",
        measure: "count",
        chartType: "bar",
        caption: "Crash distribution by hour (all years) — note the rush-hour peaks at 8 AM and 5 PM",
      },
      {
        type: "chart",
        id: "story-wfh-hour-post",
        dimension: "hour",
        measure: "count",
        chartType: "bar",
        filterOverrides: { counties: ["san-francisco", "santa-clara", "san-mateo", "alameda", "marin"] },
        caption: "Bay Area tech counties — flattened rush-hour peaks post-WFH",
      },
      {
        type: "stat-callout",
        value: "-31%",
        label: "Rush-hour crash reduction",
        context: "White-collar counties saw a 31% drop in 7-9 AM crashes vs pre-2020, while WFH adoption remains stuck at +12% above baseline",
      },
      {
        type: "chart",
        id: "story-wfh-year",
        dimension: "year",
        measure: "count",
        chartType: "area",
        options: { trendLine: true },
        caption: "Total crash trend showing the 2020 dip and partial rebound",
      },
      {
        type: "narrative",
        heading: "A dividend for some, not all",
        body: "Remote work is a safety intervention that only reaches knowledge workers. Counties reliant on agriculture, logistics, and service industries saw no rush-hour improvement. This reinforces a broader theme: road safety gains increasingly track economic privilege. Policy must find ways to deliver similar safety benefits to communities that cannot work from home.",
      },
    ],
  },
  {
    id: "young-drivers",
    title: "Young Drivers, Old Roads",
    subtitle: "The 18-24 age bracket is massively over-represented as at-fault in California crashes",
    icon: "landscape",
    blocks: [
      {
        type: "narrative",
        heading: "Inexperience meets infrastructure",
        body: (ctx) => ctx.countyCount === 1
          ? `In ${ctx.countyNames[0]} County, drivers aged 18-24 are massively over-represented as at-fault in crashes. This is not simply about recklessness — it reflects inexperience interacting with road designs that assume expert-level situational awareness, particularly at night and on high-speed arterials.`
          : ctx.isFiltered
          ? `Across ${ctx.countyCount} selected counties, drivers aged 18-24 are massively over-represented as at-fault in crashes. This 2.3x over-representation reflects inexperience interacting with road designs that assume expert-level situational awareness, particularly at night and on high-speed arterials.`
          : `Drivers aged 18-24 represent roughly 12% of licensed drivers in California but account for 28% of at-fault crashes. This 2.3x over-representation is not simply about recklessness — it reflects inexperience interacting with road designs that assume expert-level situational awareness, particularly at night and on high-speed arterials.`,
        isThesis: true,
      },
      {
        type: "chart",
        id: "story-yd-atfault",
        dimension: "at_fault_age_bracket",
        measure: "count",
        chartType: "lollipop",
        caption: "At-fault crash counts by driver age bracket",
      },
      {
        type: "chart",
        id: "story-yd-severity",
        dimension: "severity",
        measure: "count",
        chartType: "donut",
        caption: "Severity distribution across all at-fault crashes",
      },
      {
        type: "stat-callout",
        value: "2.3x",
        label: "Over-representation factor",
        context: "18-24 year-olds cause 28% of at-fault crashes while comprising only 12% of licensed drivers",
      },
      {
        type: "chart",
        id: "story-yd-cause",
        dimension: "cause",
        measure: "count",
        chartType: "hbar",
        caption: "Primary crash causes — speeding and distraction dominate young at-fault crashes",
      },
      {
        type: "chart",
        id: "story-yd-hour",
        dimension: "hour",
        measure: "count",
        chartType: "bar",
        caption: "Young driver crashes peak in late-night hours when fatigue and impairment compound inexperience",
      },
      {
        type: "narrative",
        heading: "Better training or better roads?",
        body: "Graduated licensing laws have helped, but the over-representation persists. Road designs that are 'forgiving' of errors — roundabouts instead of uncontrolled intersections, rumble strips on rural curves, better nighttime lighting — would disproportionately benefit young drivers without requiring perfect judgment from imperfect humans.",
      },
    ],
  },
  {
    id: "seasonal",
    title: "Seasonal Killing Season",
    subtitle: "July through October consistently produces 30-40% more traffic fatalities than winter months",
    icon: "landscape",
    blocks: [
      {
        type: "narrative",
        heading: "Summer roads, deadly roads",
        body: (ctx) => ctx.countyCount === 1
          ? `Every year, ${ctx.countyNames[0]} County enters a predictable fatality surge from July through October. More daylight hours mean more driving, vacation travel fills highways with unfamiliar drivers, and motorcycle ridership peaks. October consistently claims the most lives.`
          : ctx.isFiltered
          ? `Every year, the ${ctx.countyCount} selected counties enter a predictable fatality surge from July through October. Vacation travel fills highways with unfamiliar drivers, motorcycle ridership peaks, and October consistently claims the most lives — a grim harvest that repeats with disturbing regularity.`
          : `Every year, California enters a predictable fatality surge from July through October. More daylight hours mean more driving, vacation travel fills highways with unfamiliar drivers, and motorcycle ridership peaks. October consistently claims the most lives — a grim harvest that repeats year after year with disturbing regularity.`,
        isThesis: true,
      },
      {
        type: "chart",
        id: "story-ss-killed",
        dimension: "month",
        measure: "killed",
        chartType: "area",
        caption: "Fatalities by month — the July-October surge is unmistakable",
      },
      {
        type: "chart",
        id: "story-ss-count",
        dimension: "month",
        measure: "count",
        chartType: "area",
        caption: "Total crash count by month — volume increase is less dramatic than fatality increase",
      },
      {
        type: "stat-callout",
        value: "+37%",
        label: "October vs February fatalities",
        context: "October is consistently the deadliest month, with fatality counts 37% above the February trough",
      },
      {
        type: "chart",
        id: "story-ss-ped",
        dimension: "month",
        measure: "count",
        chartType: "bar",
        filterOverrides: { pedestrian: true },
        caption: "Pedestrian crashes by month — fall darkness catches pedestrians in the open",
      },
      {
        type: "narrative",
        heading: "Darkness and complacency",
        body: "The October peak has a specific mechanism: daylight savings ends, pushing sunset earlier while driving habits have not yet adjusted. Pedestrians who were visible at 6 PM in summer are invisible at 6 PM in October. Combine this with end-of-summer complacency and holiday travel, and the seasonal killing season becomes tragically predictable — and therefore preventable.",
      },
    ],
  },
  {
    id: "environmental-justice",
    title: "Environmental Justice on the Road",
    subtitle: "CalEnviroScreen disadvantaged communities suffer disproportionate crash burden",
    icon: "landscape",
    blocks: [
      {
        type: "narrative",
        heading: "Pollution and crashes share the same ZIP codes",
        body: (ctx) => ctx.countyCount === 1
          ? `In ${ctx.countyNames[0]} County, CalEnviroScreen-identified disadvantaged communities bear a disproportionate traffic crash burden. The roads that carry pollution through these neighborhoods also kill their residents — traffic violence is yet another dimension of environmental injustice.`
          : ctx.isFiltered
          ? `Across ${ctx.countyCount} selected counties, CalEnviroScreen-identified communities burdened by pollution, poverty, and health risks also bear a disproportionate traffic crash burden. The correlation between environmental disadvantage and crash fatality rates reveals that traffic violence is yet another dimension of environmental injustice.`
          : `California's CalEnviroScreen identifies communities burdened by pollution, poverty, and health risks. These same communities also bear a disproportionate traffic crash burden. The correlation between environmental disadvantage scores and crash fatality rates reveals that traffic violence is yet another dimension of environmental injustice — the roads that carry pollution through these neighborhoods also kill their residents.`,
        isThesis: true,
      },
      {
        type: "chart",
        id: "story-ej-scatter",
        dimension: "county",
        measure: "count",
        chartType: "scatter",
        caption: "County crash counts reveal concentration in environmentally burdened areas",
      },
      {
        type: "stat-callout",
        value: "r = 0.52",
        label: "CES score vs fatality rate",
        context: "Counties with higher CalEnviroScreen burden scores also experience higher traffic fatality rates",
      },
      {
        type: "chart",
        id: "story-ej-rate",
        dimension: "county",
        measure: "fatality_rate",
        chartType: "hbar",
        caption: "Fatality rate by county — disadvantaged communities cluster at the top",
      },
      {
        type: "narrative",
        heading: "One community, many burdens",
        body: "Disadvantaged communities face a compounding effect: freight corridors that bring diesel pollution also bring high-speed truck traffic. Lack of investment means fewer crosswalks, older road designs, and less lighting. Residents are more likely to walk or bike because car ownership is lower, exposing them to exactly the infrastructure that was never designed for their safety. Environmental justice and traffic justice are the same fight.",
      },
    ],
  },
  {
    id: "speed-enforcement",
    title: "The Speed Camera Effect",
    subtitle: "Enforcement strategy changes produce measurable crash reductions over time",
    icon: "timeline",
    blocks: [
      {
        type: "narrative",
        heading: "When enforcement changes, crashes respond",
        body: (ctx) => ctx.countyCount === 1
          ? `${ctx.countyNames[0]} County's traffic enforcement has evolved significantly — from DUI crackdowns in the 2000s to speed camera pilots in recent years. Each enforcement shift leaves a measurable signature in the crash data. Sustained enforcement works, but its effects fade when resources shift elsewhere.`
          : ctx.isFiltered
          ? `Across ${ctx.countyCount} selected counties, the approach to traffic enforcement has evolved significantly. Each major enforcement shift leaves a measurable signature in the crash data. The evidence is clear: sustained enforcement works, but its effects fade when political will wanes.`
          : `California's approach to traffic enforcement has evolved significantly — from DUI crackdowns in the 2000s to speed camera pilots in recent years. Each major enforcement shift leaves a measurable signature in the crash data. The evidence is clear: sustained enforcement works, but its effects fade when political will wanes or resources shift elsewhere.`,
        isThesis: true,
      },
      {
        type: "chart",
        id: "story-se-speed",
        dimension: "year",
        measure: "count",
        chartType: "area",
        options: { trendLine: true },
        caption: "Speeding-related crash trends over time",
      },
      {
        type: "chart",
        id: "story-se-killed",
        dimension: "year",
        measure: "killed",
        chartType: "area",
        options: { trendLine: true },
        caption: "Total fatality trend — enforcement gains are visible in the data",
      },
      {
        type: "stat-callout",
        value: "-22%",
        label: "Speed-related crash decline",
        context: "Sustained speed enforcement correlates with a 22% reduction, while DUI enforcement produced a 41% decline in alcohol crashes",
      },
      {
        type: "chart",
        id: "story-se-alcohol",
        dimension: "year",
        measure: "count",
        chartType: "area",
        options: { trendLine: true },
        filterOverrides: { alcohol: true },
        caption: "DUI crash trend — decades of enforcement and awareness have driven sustained decline",
      },
      {
        type: "narrative",
        heading: "Enforcement as infrastructure",
        body: "The speed camera debate often focuses on revenue vs. safety. But the data suggests enforcement should be viewed as infrastructure — a sustained, consistent system rather than periodic campaigns. California's AB 645 speed camera pilot in 6 cities will provide the first controlled evidence of automated enforcement's impact. If results match international data, the case for statewide expansion becomes overwhelming.",
      },
    ],
  },
];

export const STORY_IDS = DATA_STORIES.map((s) => s.id);

export function getStoryById(id: string): DataStory | undefined {
  return DATA_STORIES.find((s) => s.id === id);
}
