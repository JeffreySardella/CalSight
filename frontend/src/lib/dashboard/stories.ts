import type { ChartOptions, ChartType, Dimension, Measure } from "./types";

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
  options?: ChartOptions;
  filterOverrides?: {
    alcohol?: boolean;
    pedestrian?: boolean;
    counties?: string[];
    causes?: string[];
  };
  caption?: string;
};

export type StatCalloutBlock = {
  type: "stat-callout";
  value: string;
  label: string;
  context?: string;
};

/** Daily crash counts around a county's most recent first-rain day — a
 *  live chart off /api/first-rain, outside the /api/stats dimensions. */
export type FirstRainStoryBlock = {
  type: "first-rain";
  id: string;
  countySlug: string;
};

/** Holiday-period crash, death and DUI rates against ordinary days of the
 *  same month — a live table off /api/holidays, outside the /api/stats
 *  dimensions (nothing else in the schema carries day-of-month). */
export type HolidayStoryBlock = {
  type: "holidays";
  id: string;
  /** Omit for statewide; a slug narrows the whole table to one county. */
  countySlug?: string;
};

export type StoryBlock =
  | NarrativeBlock
  | ChartBlock
  | StatCalloutBlock
  | FirstRainStoryBlock
  | HolidayStoryBlock;

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
        value: "4.1x",
        label: "Rural vs urban deaths per crash",
        context: "In the five rural counties below, 24.4 people died per 1,000 crashes, against 6.0 in the five urban ones (2001 to 2025)",
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
        body: "The data shows the gap; it does not show why. Commonly cited reasons include higher rural speeds, longer distances to trauma care, and fewer controlled intersections, but none of those are measured here. What the data does rule out is volume: rural counties have far fewer crashes, yet each one is about four times as likely to kill.",
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
        value: "10 PM",
        label: "Peak hour for alcohol-involved crashes",
        context: "9 PM through midnight run nearly level, and 39% of alcohol-involved crashes fall between 10 PM and 3 AM. Saturday and Sunday are effectively tied as the worst days",
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
        body: "The regularity of DUI crash timing means checkpoints and rideshare incentives can be targeted. The data points to the 9 PM to 3 AM window on Friday and Saturday nights, which is why the weekend peak spills into early Saturday and Sunday mornings.",
      },
    ],
  },
  {
    id: "twenty-years",
    title: "Twenty Years of Progress?",
    subtitle: "Crashes fell for two decades. Deaths did not follow the same path",
    icon: "timeline",
    blocks: [
      {
        type: "narrative",
        heading: "Two decades of data, one complicated story",
        body: (ctx) => ctx.countyCount === 1
          ? `Since the early 2000s, ${ctx.countyNames[0]} County has seen shifts in road safety investment, vehicle technology, and awareness campaigns. But has it actually worked locally? The answer depends on which metric you examine and how you define success.`
          : ctx.isFiltered
          ? `Since the early 2000s, the ${ctx.countyCount} selected counties have seen major road safety investment while vehicle technology advanced. But has it actually worked? The answer depends on which metric you examine and how you define success.`
          : `Since the early 2000s, California has spent heavily on road safety, vehicle technology has advanced, and awareness campaigns have multiplied. But has it actually worked? The answer depends on which metric you examine and how you define success.`,
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
        value: "-31%",
        label: "Crashes, 2002 peak to 2020 low",
        context: "From 542,301 crashes in 2002 to 374,756 in 2020. Deaths moved differently: they peaked at 4,661 in 2022, then fell to 3,402 in 2025, a figure still rising as late death records arrive",
      },
      {
        type: "chart",
        id: "story-ty-ped",
        dimension: "year",
        measure: "count",
        chartType: "area",
        options: { trendLine: true },
        filterOverrides: { pedestrian: true },
        caption: "Pedestrian-involved crashes by year (the pedestrian flag starts in 2016)",
      },
      {
        type: "narrative",
        heading: "Progress is uneven",
        body: "Crashes fell for most of two decades, but deaths did not track them. From 2019 to 2022 crashes dropped while deaths climbed to their highest level since at least 2001, and only in 2025 did deaths fall below the 2019 level. Pedestrian deaths followed the same arc, rising from 984 in 2016 to 1,278 in 2022 before falling back. This data shows the pattern; it cannot say how much airbags, road design or enforcement contributed.",
      },
    ],
  },
  {
    id: "poverty-fatality",
    title: "The Poverty-Fatality Connection",
    subtitle: "Poorer counties tend to have deadlier crashes, though the link is moderate",
    icon: "landscape",
    blocks: [
      {
        type: "narrative",
        heading: "Where poverty and deadly crashes overlap",
        body: (ctx) => ctx.countyCount === 1
          ? `Statewide, counties with higher poverty rates tend to see deadlier crashes. The link is real but moderate, and it holds between counties, not individual people, so it says little about ${ctx.countyNames[0]} County on its own.`
          : ctx.isFiltered
          ? `Across California, counties with higher poverty rates tend to see deadlier crashes. The link is real but moderate, and it holds between counties, not individual people. Compare where the ${ctx.countyCount} selected counties fall below.`
          : `Traffic deaths are not spread evenly. Counties with higher poverty rates tend to see more deaths per crash, but the link is moderate (r = 0.49 across 58 counties), not the lockstep it is sometimes described as. It holds between counties, not individual people.`,
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
        value: "r = 0.49",
        label: "Poverty rate vs deaths per crash",
        context: "Across 58 counties, 2019 to 2023. The poorest quarter of counties had a median of 19.3 deaths per 1,000 crashes, 1.35 times the median county",
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
        heading: "A pattern, not a proven cause",
        body: "Plausible reasons include older roads, fewer sidewalks, longer emergency response times, higher-speed rural highways and older vehicles. None of those are measured here, and poverty overlaps heavily with rurality, which on its own predicts deadlier crashes. Treat this as a pattern worth investigating, not a proven cause.",
      },
    ],
  },
  {
    id: "ev-paradox",
    title: "EVs and Pedestrian Deaths",
    subtitle: "EV registrations quadrupled. Pedestrian deaths rose, then fell",
    icon: "timeline",
    blocks: [
      {
        type: "narrative",
        heading: "Testing a popular theory",
        body: (ctx) => ctx.countyCount === 1
          ? `A popular theory holds that quiet, heavy electric vehicles are making roads more dangerous for pedestrians. Statewide, the numbers do not bear it out so far. The charts below show how ${ctx.countyNames[0]} County's pedestrian crashes moved over the same years.`
          : ctx.isFiltered
          ? `A popular theory holds that quiet, heavy electric vehicles are making roads more dangerous for pedestrians. Statewide, the numbers do not bear it out so far. The charts below show how pedestrian crashes moved in the ${ctx.countyCount} selected counties.`
          : `Electric vehicles have spread fast in California, and a popular theory holds that quiet, heavy EVs endanger pedestrians. The statewide numbers do not bear that out so far: EV registrations climbed every year while pedestrian deaths rose, peaked in 2022, and then fell.`,
        isThesis: true,
      },
      {
        type: "chart",
        id: "story-ev-ped-year",
        dimension: "year",
        measure: "count",
        chartType: "area",
        filterOverrides: { pedestrian: true },
        caption: "Pedestrian-involved crashes by year (the pedestrian flag starts in 2016)",
      },
      {
        type: "stat-callout",
        value: "+338%",
        label: "EV registrations, 2019 to 2025",
        context: "From 423,017 to 1,854,887. Over the same years, pedestrian deaths went from 1,050 to a peak of 1,278 in 2022, then down to 958 in 2025",
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
        heading: "What this can and can't show",
        body: "Statewide totals cannot isolate an EV effect: pedestrian risk also moves with vehicle size, distraction, travel volume and where people walk. But the pattern here, EVs up every year while pedestrian deaths peaked in 2022 and fell, does not support a strong EV-driven rise. The 2025 figure is still provisional, since death records arrive months late.",
      },
    ],
  },
  {
    id: "wfh-dividend",
    title: "The WFH Safety Dividend",
    subtitle: "Morning rush-hour crashes fell about a quarter after 2020, statewide",
    icon: "timeline",
    blocks: [
      {
        type: "narrative",
        heading: "Empty commutes, safer roads?",
        body: (ctx) => ctx.countyCount === 1
          ? `The post-2020 shift to remote work thinned out rush-hour traffic. Statewide, 7 to 9 AM crashes fell 28% between 2019 and 2023. The charts below show how ${ctx.countyNames[0]} County's crash hours compare.`
          : ctx.isFiltered
          ? `The post-2020 shift to remote work thinned out rush-hour traffic. Statewide, 7 to 9 AM crashes fell 28% between 2019 and 2023. The charts below show how the ${ctx.countyCount} selected counties compare.`
          : `The post-2020 shift to remote work thinned out rush-hour traffic. Between 2019 and 2023, 7 to 9 AM crashes fell 28% statewide. The Bay Area's five tech-heavy counties fell 26%, no more than the state as a whole, so the drop was not confined to white-collar areas.`,
        isThesis: true,
      },
      {
        type: "chart",
        id: "story-wfh-hour-pre",
        dimension: "hour",
        measure: "count",
        chartType: "bar",
        caption: "Crashes by hour of day, all years. Note the morning and evening rush-hour peaks",
      },
      {
        type: "chart",
        id: "story-wfh-hour-post",
        dimension: "hour",
        measure: "count",
        chartType: "bar",
        filterOverrides: { counties: ["san-francisco", "santa-clara", "san-mateo", "alameda", "marin"] },
        caption: "Bay Area tech counties (San Francisco, Santa Clara, San Mateo, Alameda, Marin), all years",
      },
      {
        type: "stat-callout",
        value: "-28%",
        label: "7 to 9 AM crashes, 2019 to 2023",
        context: "Statewide, from 49,130 to 35,429. The five Bay Area tech counties fell 26%, about the same",
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
        heading: "Broad, and hard to credit to remote work alone",
        body: "The morning rush-hour drop was broad, not limited to counties with many remote-capable jobs. That makes it hard to credit remote work alone: 2020 also brought lockdowns, shifted travel times, and fewer trips overall. This data shows when crashes fell, not why.",
      },
    ],
  },
  {
    id: "young-drivers",
    title: "Young Drivers, Old Roads",
    subtitle: "Drivers aged 18 to 24 are over-represented among at-fault drivers",
    icon: "landscape",
    blocks: [
      {
        type: "narrative",
        heading: "Young drivers at fault",
        body: (ctx) => ctx.countyCount === 1
          ? `Statewide, drivers aged 18 to 24 show up among at-fault drivers far more often than their share of the population. The chart below shows the age mix of at-fault drivers in ${ctx.countyNames[0]} County.`
          : ctx.isFiltered
          ? `Statewide, drivers aged 18 to 24 show up among at-fault drivers far more often than their share of the population. The chart below shows the age mix of at-fault drivers in the ${ctx.countyCount} selected counties.`
          : `Drivers aged 18 to 24 were 23% of at-fault drivers with a recorded age, while that age group is about 9.5% of Californians. The comparison is rough: the population figure includes children too young to drive, and nearly half of crash records carry no driver age.`,
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
        caption: "Severity of all crashes",
      },
      {
        type: "stat-callout",
        value: "23%",
        label: "At-fault drivers aged 18 to 24",
        context: "Among at-fault drivers with a recorded age. The group is about 9.5% of Californians, but nearly half of crash records have no driver age",
      },
      {
        type: "chart",
        id: "story-yd-cause",
        dimension: "cause",
        measure: "count",
        chartType: "hbar",
        caption: "Primary crash causes, all drivers",
      },
      {
        type: "chart",
        id: "story-yd-hour",
        dimension: "hour",
        measure: "count",
        chartType: "bar",
        caption: "All crashes by hour of day",
      },
      {
        type: "narrative",
        heading: "Better training or better roads?",
        body: "Graduated licensing is the standard policy answer for new drivers; this data cannot measure its effect. Road designs that forgive errors, such as roundabouts instead of uncontrolled intersections, rumble strips on rural curves and better night lighting, help every driver, including the youngest.",
      },
    ],
  },
  {
    id: "seasonal",
    title: "The Deadly Second Half",
    subtitle: "Every year since 2001, the deadliest month has fallen between July and December",
    icon: "landscape",
    blocks: [
      {
        type: "narrative",
        heading: "The second half of the year",
        body: (ctx) => ctx.countyCount === 1
          ? `Statewide, the deadliest month for traffic deaths has fallen between July and December in every year since 2001. The charts below show how ${ctx.countyNames[0]} County's months compare.`
          : ctx.isFiltered
          ? `Statewide, the deadliest month for traffic deaths has fallen between July and December in every year since 2001. The charts below show how the ${ctx.countyCount} selected counties compare.`
          : `In every year since 2001, California's deadliest month for traffic deaths has fallen between July and December, never in the first half. October leads over the whole period, though not every year; November was the deadliest month more often. The swing is real but modest: July through October average about 10% more deaths per day than December through February.`,
        isThesis: true,
      },
      {
        type: "chart",
        id: "story-ss-killed",
        dimension: "month",
        measure: "killed",
        chartType: "area",
        caption: "Deaths by month, all years combined",
      },
      {
        type: "chart",
        id: "story-ss-count",
        dimension: "month",
        measure: "count",
        chartType: "area",
        caption: "Crashes by month, all years combined",
      },
      {
        type: "stat-callout",
        value: "+25%",
        label: "October vs February deaths",
        context: "Over 2001 to 2025. Part of that is the calendar, since February is short: per day, October runs 14% above February",
      },
      {
        type: "chart",
        id: "story-ss-ped",
        dimension: "month",
        measure: "count",
        chartType: "bar",
        filterOverrides: { pedestrian: true },
        caption: "Pedestrian-involved crashes by month (2016 onward)",
      },
      {
        type: "narrative",
        heading: "Why the second half?",
        body: "Longer evenings of driving, summer travel and holiday trips are the usual explanations, and in November the switch back to standard time moves sunset into the evening commute. This data cannot separate those effects. It does show the pattern is steady enough to plan around.",
      },
    ],
  },
  {
    id: "environmental-justice",
    title: "Environmental Justice on the Road",
    subtitle: "At the county level, pollution burden barely tracks how deadly crashes are",
    icon: "landscape",
    blocks: [
      {
        type: "narrative",
        heading: "Do polluted places have deadlier roads?",
        body: (ctx) => ctx.countyCount === 1
          ? `CalEnviroScreen scores communities on pollution, poverty and health burdens. Across California's 58 counties, those scores barely track how deadly crashes are. County averages also blur the neighborhood differences that matter most inside ${ctx.countyNames[0]} County.`
          : ctx.isFiltered
          ? `CalEnviroScreen scores communities on pollution, poverty and health burdens. Across California's 58 counties, those scores barely track how deadly crashes are, and county averages blur neighborhood differences inside the ${ctx.countyCount} selected counties.`
          : `California's CalEnviroScreen scores communities on pollution, poverty and health burdens. A natural question is whether the same places also have deadlier roads. At the county level the answer is barely: across 58 counties, the correlation between CalEnviroScreen score and deaths per crash is 0.14, close to none.`,
        isThesis: true,
      },
      {
        type: "chart",
        id: "story-ej-scatter",
        dimension: "county",
        measure: "count",
        chartType: "scatter",
        caption: "Crashes by county",
      },
      {
        type: "stat-callout",
        value: "r = 0.14",
        label: "CalEnviroScreen score vs deaths per crash",
        context: "Across 58 counties, 2019 to 2023. Close to no relationship at the county level",
      },
      {
        type: "chart",
        id: "story-ej-rate",
        dimension: "county",
        measure: "fatality_rate",
        chartType: "hbar",
        caption: "Deaths per 1,000 crashes by county",
      },
      {
        type: "narrative",
        heading: "What a neighborhood-level look could add",
        body: "The case that environmental and traffic burdens overlap is usually made neighborhood by neighborhood: freight corridors, missing crosswalks, lower car ownership. Those are census-tract stories, and county averages blur them. CalEnviroScreen is built for tracts, so a tract-level crash comparison is the honest next step before drawing a conclusion either way.",
      },
    ],
  },
  {
    id: "speed-enforcement",
    title: "Speeding and Drunk Driving Since 2016",
    subtitle: "Both fell, but this data cannot say enforcement did it",
    icon: "timeline",
    blocks: [
      {
        type: "narrative",
        heading: "Two long declines",
        body: (ctx) => ctx.countyCount === 1
          ? `Statewide, crashes with speeding as the primary factor fell 30% from 2016 to 2025, and deaths in alcohol-involved crashes fell 35%. The charts below show ${ctx.countyNames[0]} County's trends. This data records crashes, not patrols, checkpoints or cameras, so it cannot credit the drops to enforcement.`
          : ctx.isFiltered
          ? `Statewide, crashes with speeding as the primary factor fell 30% from 2016 to 2025, and deaths in alcohol-involved crashes fell 35%. The charts below show the ${ctx.countyCount} selected counties. This data records crashes, not patrols, checkpoints or cameras, so it cannot credit the drops to enforcement.`
          : `Speeding and drunk driving are two of the oldest targets of traffic enforcement. From 2016 to 2025, crashes with speeding as the primary factor fell 30%, and deaths in alcohol-involved crashes fell 35%, while alcohol-involved crashes themselves fell only 7%. This data records crashes, not patrols, checkpoints or cameras, so it cannot credit those drops to enforcement.`,
        isThesis: true,
      },
      {
        type: "chart",
        id: "story-se-speed",
        dimension: "year",
        measure: "count",
        chartType: "area",
        options: { trendLine: true },
        filterOverrides: { causes: ["speeding"] },
        caption: "Crashes with speeding as the primary factor, by year",
      },
      {
        type: "chart",
        id: "story-se-killed",
        dimension: "year",
        measure: "killed",
        chartType: "area",
        options: { trendLine: true },
        caption: "Traffic deaths by year",
      },
      {
        type: "stat-callout",
        value: "-30%",
        label: "Speeding crashes, 2016 to 2025",
        context: "From 163,095 to 114,480. Deaths in alcohol-involved crashes fell 35% over the same years, while alcohol-involved crashes fell only 7%",
      },
      {
        type: "chart",
        id: "story-se-alcohol",
        dimension: "year",
        measure: "count",
        chartType: "area",
        options: { trendLine: true },
        filterOverrides: { alcohol: true },
        caption: "Alcohol-involved crashes by year (the alcohol flag starts in 2016)",
      },
      {
        type: "narrative",
        heading: "What would settle it",
        body: "California's AB 645 speed camera pilot in six cities is the kind of controlled test that can answer what this data cannot: whether automated enforcement itself cuts crashes. Until results arrive, treat the declines above as trends, not proof.",
      },
    ],
  },
  {
    id: "first-storm",
    title: "The first storm",
    subtitle: "What happens on the day the rain comes back",
    icon: "rainy",
    blocks: [
      {
        type: "narrative",
        heading: "The day the rain comes back",
        body: "California's water year starts on October 1, usually deep in a dry spell. By then months of oil, rubber and dust have settled into the pavement, and drivers have gone just as long without a wet road. The first storm that breaks the spell lifts that film before it washes it away, and it meets a driving public that is out of practice.\n\nThe headline figure on the Water page — the median lift across every water year on record — is computed live from that data: crashes on the first rainy day of each water year, against the average of the 28 dry days before it. The charts below show what one of those days looks like in two counties.",
        isThesis: true,
      },
      { type: "first-rain", id: "story-first-rain", countySlug: "los-angeles" },
      { type: "first-rain", id: "story-first-rain-sacramento", countySlug: "sacramento" },
      {
        type: "narrative",
        heading: "What this does and doesn't say",
        body: "Rain here is a county-average from nClimGrid, so a storm that soaks one edge of a large county counts for all of it, and a light shower can cross the 0.10-inch line without wetting every road. Only the first qualifying storm of each water year is counted — later storms, and the days after the first one, are not. Smaller counties have small baselines, and a handful of crashes either way moves their percentages a lot; those are flagged. Above all, this is an association: crash counts rose on these days and rain is the obvious thing that changed, but the data cannot say it was the cause.",
      },
    ],
  },
  {
    id: "holidays-on-the-road",
    title: "Holidays on the road",
    subtitle: "Which holidays actually put more people in the ambulance, and which only feel that way",
    icon: "celebration",
    blocks: [
      {
        type: "narrative",
        heading: "The holiday you are told to fear",
        body: "Every year the same warnings go out before the same long weekends. They are rarely accompanied by a number, and almost never by the right comparison: a holiday in July is being measured against a January nobody drove in.\n\nThe table below makes the comparison the honest way. Each holiday period is set beside the ordinary days of its own month, in the same year — same season, same daylight, same weather — so what is left is the holiday itself rather than the time of year. Every figure is computed live; none of them are written into this page.",
        isThesis: true,
      },
      { type: "holidays", id: "story-holidays-statewide" },
      {
        type: "narrative",
        heading: "Volume and risk are two different questions",
        body: "A holiday can move crashes and deaths in opposite directions. Long weekends empty the commute and fill the highways, so the crash count can fall while the share of crashes involving alcohol climbs — the same evening, with fewer people driving and more of them drinking. Read the crash column and the DUI column as separate findings, not as one.\n\nThe periods themselves are of different lengths — a single Sunday for the Super Bowl, nine days from Christmas Eve to New Year's Day — which is why everything is expressed per day rather than as a total.",
      },
      { type: "holidays", id: "story-holidays-la", countySlug: "los-angeles" },
      {
        type: "narrative",
        heading: "What this cannot tell you",
        body: "These are counts of reported crashes, not of risk per mile. Nobody records how much more or less Californians drove on a given holiday, so a period with more crashes may simply have more traffic, and one with fewer may just be a weekend when people stayed home. The DUI figure is the share of crashes whose primary cause was coded as driving under the influence, which depends on what the attending officer recorded, not on a blood test.\n\nHalloween night runs from the evening of October 31 into the early hours of November 1, but this data resolves to whole days, so both are counted in full — daylight hours included. Fatality records also catch up months after crash records, so the most recent year shown is the last complete one, and even its death counts may still rise.",
      },
    ],
  },
];

export const STORY_IDS = DATA_STORIES.map((s) => s.id);

export function getStoryById(id: string): DataStory | undefined {
  return DATA_STORIES.find((s) => s.id === id);
}
