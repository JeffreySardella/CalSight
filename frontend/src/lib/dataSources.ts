/**
 * Single source of truth for "how many data sources does CalSight use?".
 *
 * This number was stated three different ways on the public site — the intro
 * overlay counted up to 17, the About page's headline stat said 19, and the
 * methodology doc said 15 — while the About page actually lists the twelve
 * providers below. A transparency product cannot disagree with itself about
 * how much data it has, so every surface now reads this constant.
 *
 * Counted by upstream PROVIDER, not by dataset or ETL job: Caltrans supplies
 * AADT, road miles and speed limits but is one provider; the ETL runs ~27 jobs
 * across these twelve. If you add or remove a provider card on the About page,
 * update this list in the same commit.
 */
export const DATA_SOURCE_PROVIDERS = [
  "CCRS (CHP)",
  "SWITRS (CHP)",
  "US Census Bureau",
  "Caltrans",
  "CalEnviroScreen",
  "California DMV",
  "CA Dept. of Education",
  "CA HCAI",
  "Federal agencies (NOAA, NHTSA FARS, BLS)",
  "OpenStreetMap",
  "DWR / CDEC",
  "US Drought Monitor",
] as const;

export const DATA_SOURCE_COUNT = DATA_SOURCE_PROVIDERS.length;
