import type { Dimension, Measure, ChartType } from "./types";

export type NarrativeBlock = {
  type: "narrative";
  heading: string;
  body: string;
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
  };
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
        body: "California's 58 counties span dense urban grids and remote mountain highways. The crash data reveals two fundamentally different safety landscapes: urban counties with high volume but lower severity, and rural counties where every crash is more likely to kill.",
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
      },
      {
        type: "chart",
        id: "story-tc-rural-donut",
        dimension: "severity",
        measure: "count",
        chartType: "donut",
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
        body: "DUI crashes are not random. They follow a precise temporal pattern that repeats week after week, year after year. Understanding this clock is the first step toward intervention: if we know when and where crashes will happen, we can position resources before they do.",
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
        body: "Since the early 2000s, California has invested billions in road safety, vehicle technology has advanced dramatically, and awareness campaigns have proliferated. But has it actually worked? The answer depends on which metric you examine and how you define success.",
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
];

export const STORY_IDS = DATA_STORIES.map((s) => s.id);

export function getStoryById(id: string): DataStory | undefined {
  return DATA_STORIES.find((s) => s.id === id);
}
