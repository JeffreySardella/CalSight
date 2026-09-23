/**
 * JSON-LD structured data generators for CalSight pages.
 *
 * Google uses structured data for rich results in search. For a traffic
 * safety dashboard, the most relevant schemas are:
 *   - Dataset (for the crash data)
 *   - BreadcrumbList (for navigation context)
 *
 * References:
 *   https://schema.org/Dataset
 *   https://developers.google.com/search/docs/appearance/structured-data/dataset
 */

/**
 * Dataset schema for the crash records — helps with Google Dataset Search
 */
export function buildDatasetSchema(params?: {
  counties?: string[];
  dateRange?: { start?: string; end?: string };
}) {
  const spatial = params?.counties?.length
    ? params.counties.map((c) => ({ "@type": "Place", name: `${c} County, California` }))
    : [{ "@type": "Place", name: "California, United States" }];

  const temporal = params?.dateRange
    ? `${params.dateRange.start || "2001-01"} / ${params.dateRange.end || "2026-09"}`
    : "2001-01 / 2026-09";

  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "California Traffic Crash Records (SWITRS + CCRS)",
    description:
      "Comprehensive traffic collision records from the Statewide Integrated Traffic Records System (SWITRS, 2001-2015) and California Crash Records System (CCRS, 2016-present), maintained by the California Highway Patrol.",
    url: "https://calsight.org/stats",
    license: "https://www.ca.gov/about/public-records-act/",
    creator: {
      "@type": "GovernmentOrganization",
      name: "California Highway Patrol",
      url: "https://www.chp.ca.gov",
    },
    distribution: {
      "@type": "DataDownload",
      encodingFormat: "application/json",
      contentUrl: "https://api.calsight.org/api/stats",
    },
    spatialCoverage: spatial,
    temporalCoverage: temporal,
    variableMeasured: [
      { "@type": "PropertyValue", name: "Total Crashes", unitCode: "C62" },
      { "@type": "PropertyValue", name: "Fatalities", unitCode: "C62" },
      { "@type": "PropertyValue", name: "Injuries", unitCode: "C62" },
      { "@type": "PropertyValue", name: "Killed or Seriously Injured per 100K Population", unitCode: "P1" },
    ],
    measurementTechnique: "Police-reported crash records via CHP SWITRS/CCRS systems",
    keywords: [
      "California traffic crashes",
      "SWITRS",
      "CCRS",
      "traffic safety",
      "crash data",
      "fatality rate",
      "Vision Zero",
      "traffic collisions",
    ],
  };
}

/**
 * BreadcrumbList for navigation context in search results
 */
export function buildBreadcrumbSchema(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `https://calsight.org${item.path}`,
    })),
  };
}
