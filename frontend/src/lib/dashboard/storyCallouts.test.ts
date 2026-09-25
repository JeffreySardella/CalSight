import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  calEnviroScreenCallout, duiClockCallout, evCallout, povertyCallout, seasonalCallout,
  speedEnforcementCallout, twentyYearsCallout, twoCaliforniasCallout, wfhCallout,
  youngDriversCallout,
} from "./storyCallouts";
import { DATA_STORIES, type StatCalloutBlock } from "./stories";

// Fixed "today": 2026 is the partial year, and 2025's deaths are provisional.
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 24));
});
afterAll(() => {
  vi.useRealTimers();
});

describe("twoCaliforniasCallout", () => {
  it("compares deaths per 1,000 crashes over full years, leaving out the partial year", () => {
    const rural = [
      { year: 2024, crash_count: 1000, total_killed: 20 },
      { year: 2025, crash_count: 1000, total_killed: 30 },
      { year: 2026, crash_count: 1000, total_killed: 900 },
    ];
    const urban = [
      { year: 2024, crash_count: 10_000, total_killed: 50 },
      { year: 2025, crash_count: 10_000, total_killed: 50 },
    ];
    const f = twoCaliforniasCallout(rural, urban);
    expect(f.value).toBe("5.0x");
    expect(f.context).toContain("25.0 people died per 1,000 crashes, against 5.0");
    expect(f.context).toContain("(2024 to 2025)");
  });

  it("throws on empty data so the reader shows no figure rather than NaN", () => {
    expect(() => twoCaliforniasCallout([], [])).toThrow();
  });
});

describe("duiClockCallout", () => {
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, crash_count: hour === 22 ? 50 : 10 }));
  it("names the peak hour and the 10 PM to 3 AM share", () => {
    // Window = 50 + 4 × 10 = 90 of 50 + 23 × 10 = 280.
    const f = duiClockCallout(hours, [
      { day_of_week: 5, crash_count: 1000 },
      { day_of_week: 6, crash_count: 1005 },
      { day_of_week: 0, crash_count: 400 },
    ]);
    expect(f.value).toBe("10 PM");
    expect(f.context).toContain("32% of alcohol-involved crashes");
    expect(f.context).toContain("Saturday and Sunday are effectively tied");
  });

  it("ranks the days when they are not within 1%", () => {
    const f = duiClockCallout(hours, [
      { day_of_week: 4, crash_count: 800 },
      { day_of_week: 5, crash_count: 1000 },
    ]);
    expect(f.context).toContain("Saturday is the worst day, ahead of Friday");
  });

  it("labels midnight and noon on the 12-hour clock", () => {
    const at = (peak: number) =>
      duiClockCallout(hours.map((h) => ({ ...h, crash_count: h.hour === peak ? 99 : 1 })), [
        { day_of_week: 0, crash_count: 1 }, { day_of_week: 1, crash_count: 2 },
      ]).value;
    expect(at(0)).toBe("12 AM");
    expect(at(12)).toBe("12 PM");
  });
});

describe("twentyYearsCallout", () => {
  const years = [
    { year: 2001, crash_count: 500, total_killed: 40 },
    { year: 2002, crash_count: 600, total_killed: 42 },
    { year: 2020, crash_count: 300, total_killed: 45 },
    { year: 2022, crash_count: 400, total_killed: 50 },
    { year: 2025, crash_count: 420, total_killed: 35 },
    { year: 2026, crash_count: 100, total_killed: 5 },
  ];
  it("measures from the crash peak to the lowest later full year", () => {
    const f = twentyYearsCallout(years);
    expect(f.label).toBe("Crashes, 2002 peak to 2020 low");
    expect(f.value).toBe("-50%");
    expect(f.context).toContain("From 600 crashes in 2002 to 300 in 2020");
  });

  it("reports the death peak and the latest year, flagged as provisional", () => {
    const f = twentyYearsCallout(years);
    expect(f.context).toContain("they peaked at 50 in 2022 and stood at 35 in 2025");
    expect(f.context).toContain("still rising as late death records arrive");
  });
});

describe("povertyCallout", () => {
  // Fatality rate rises with poverty; county 5 has two demographics years and
  // must use the newer one.
  const counties = [1, 2, 3, 4, 5, 6, 7, 8].map((c) => ({ county_code: c, crash_count: 1000, total_killed: c * 2 }));
  const demo = [
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((c) => ({ county_code: c, year: 2022, poverty_rate: c * 3 })),
    { county_code: 5, year: 2021, poverty_rate: 99 },
    { county_code: 9, year: 2022, poverty_rate: 50 },
  ];
  it("correlates each county's latest poverty rate with deaths per crash", () => {
    const f = povertyCallout(counties, demo, "2019 to 2023");
    expect(f.value).toBe("r = 1.00");
    expect(f.context).toContain("Across 8 counties");
    expect(f.context).toContain("2022 poverty rate");
  });

  it("compares the poorest quarter's median rate with the median county", () => {
    // Poorest quarter = counties 8 and 7 → median 15.0; all counties → median 9.0.
    const f = povertyCallout(counties, demo, "2019 to 2023");
    expect(f.context).toContain("median of 15.0 deaths per 1,000 crashes, 1.67 times the median county");
  });
});

describe("evCallout", () => {
  const vehicles = [
    { county_code: 1, year: 2019, ev_vehicles: 100 }, { county_code: 2, year: 2019, ev_vehicles: 100 },
    { county_code: 1, year: 2025, ev_vehicles: 500 }, { county_code: 2, year: 2025, ev_vehicles: 400 },
    { county_code: 1, year: 2026, ev_vehicles: 9999 },
  ];
  it("sums EVs statewide and ends on the last full crash year", () => {
    const f = evCallout(vehicles, [
      { year: 2016, total_killed: 900 },
      { year: 2019, total_killed: 1000 },
      { year: 2022, total_killed: 1300 },
      { year: 2025, total_killed: 950 },
      { year: 2026, total_killed: 300 },
    ]);
    expect(f.label).toBe("EV registrations, 2019 to 2025");
    expect(f.value).toBe("+350%");
    expect(f.context).toBe(
      "From 200 to 900. Over the same years, pedestrian deaths went from 1,000 to 950, peaking at 1,300 in 2022 (2025 still preliminary)",
    );
  });

  it("drops the peak clause when the peak is an end year", () => {
    const f = evCallout(vehicles, [{ year: 2019, total_killed: 1000 }, { year: 2025, total_killed: 1100 }]);
    expect(f.context).not.toContain("peaking");
  });
});

describe("wfhCallout", () => {
  const hours = (seven: number, eight: number) => [
    { hour: 6, crash_count: 999 }, { hour: 7, crash_count: seven }, { hour: 8, crash_count: eight }, { hour: 9, crash_count: 999 },
  ];
  it("counts only the 7:00 and 8:00 hours", () => {
    const f = wfhCallout(hours(500, 500), hours(350, 350), hours(100, 100), hours(80, 80));
    expect(f.value).toBe("-30%");
    expect(f.context).toBe("Statewide, from 1,000 to 700. The five Bay Area tech counties fell 20%");
  });

  it("says rose when the Bay Area went up", () => {
    const f = wfhCallout(hours(500, 500), hours(350, 350), hours(100, 100), hours(110, 110));
    expect(f.context).toContain("rose 10%");
  });
});

describe("youngDriversCallout", () => {
  it("takes the 18 to 24 share of known ages and a population-weighted share from the newest year", () => {
    const f = youngDriversCallout(
      [
        { age_bracket: "18_24", party_count: 25 },
        { age_bracket: "25_44", party_count: 75 },
        { age_bracket: "unknown", party_count: 100 },
      ],
      [
        { county_code: 1, year: 2022, population: 1000, pct_18_24: 10 },
        { county_code: 2, year: 2022, population: 3000, pct_18_24: 6 },
        { county_code: 1, year: 2023, population: 1000, pct_18_24: null },
        { county_code: 1, year: 2021, population: 1000, pct_18_24: 50 },
      ],
    );
    expect(f.value).toBe("25%");
    expect(f.context).toContain("about 7.0% of Californians (2022)");
    expect(f.context).toContain("50% of at-fault driver records have no age");
  });
});

describe("seasonalCallout", () => {
  it("compares October with February in total and per day, counting leap-year Februaries", () => {
    // 2023–2024: February has 28 + 29 = 57 days, October 62.
    const f = seasonalCallout([{ month: 2, total_killed: 570 }, { month: 10, total_killed: 620 }], 2023, 2024);
    expect(f.value).toBe("+9%");
    expect(f.context).toContain("Over 2023 to 2024");
    expect(f.context).toContain("per day, October runs 0% above February");
  });

  it("says below when October runs lower per day", () => {
    const f = seasonalCallout([{ month: 2, total_killed: 600 }, { month: 10, total_killed: 600 }], 2023, 2024);
    expect(f.context).toContain("8% below February");
  });
});

describe("calEnviroScreenCallout", () => {
  const counties = [1, 2, 3, 4, 5, 6].map((c) => ({ county_code: c, crash_count: 1000, total_killed: 10 + (c % 2) }));
  it("reports r and describes a near-zero correlation plainly", () => {
    const ces = [1, 2, 3, 4, 5, 6].map((c) => ({ county_code: c, ces_score: Math.ceil(c / 2) }));
    const f = calEnviroScreenCallout(counties, ces, "2019 to 2023");
    expect(f.value).toBe("r = 0.00");
    expect(f.context).toBe("Across 6 counties, 2019 to 2023. Close to no relationship at the county level");
  });

  it("calls a strong correlation strong", () => {
    const ces = [1, 2, 3, 4, 5, 6].map((c) => ({ county_code: c, ces_score: c % 2 }));
    expect(calEnviroScreenCallout(counties, ces, "x").context).toContain("A strong relationship");
  });
});

describe("speedEnforcementCallout", () => {
  it("runs from the first alcohol-flag year to the last full year", () => {
    const f = speedEnforcementCallout(
      [
        { year: 2001, crash_count: 5 },
        { year: 2016, crash_count: 1000 },
        { year: 2025, crash_count: 700 },
        { year: 2026, crash_count: 10 },
      ],
      [
        { year: 2016, crash_count: 400, total_killed: 100 },
        { year: 2025, crash_count: 372, total_killed: 65 },
        { year: 2026, crash_count: 1, total_killed: 1 },
      ],
    );
    expect(f.label).toBe("Speeding crashes, 2016 to 2025");
    expect(f.value).toBe("-30%");
    expect(f.context).toBe(
      "From 1,000 to 700. Deaths in alcohol-involved crashes fell 35% over the same years (2025 deaths preliminary), while alcohol-involved crashes fell 7%",
    );
  });
});

describe("story callouts", () => {
  it("are all computed from data: no callout carries a hand-typed value", () => {
    const callouts = DATA_STORIES.flatMap((s) => s.blocks.filter((b): b is StatCalloutBlock => b.type === "stat-callout"));
    expect(callouts.length).toBeGreaterThan(0);
    for (const c of callouts) {
      expect(c).not.toHaveProperty("value");
      expect(c.sources.length).toBeGreaterThan(0);
    }
  });
});
