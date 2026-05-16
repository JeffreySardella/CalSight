/**
 * JSON-LD structured data generators for CalSight pages.
 *
 * Google uses structured data for rich results in search. For a traffic
 * safety dashboard, the most relevant schemas are:
 *   - WebApplication (for the app itself)
 *   - Dataset (for the crash data)
 *   - GovernmentService (for the public records source)
 *   - BreadcrumbList (for navigation context)
 *
 * References:
 *   https://schema.org/Dataset
 *   https://developers.google.com/search/docs/appearance/structured-data/dataset
 */

/**
 * Base organization schema for CalSight
 */
export function buildOrganizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "CalSight",
    url: "https://calsight.org",
    logo: "https://calsight.org/web-app-manifest-512x512.png",
    description: "Open-source California traffic crash data exploration platform",
  };
}

/**
 * WebApplication schema — tells Google this is an interactive web app
 */
export function buildWebAppSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "CalSight",
    url: "https://calsight.org",
    applicationCategory: "DataVisualization",
    operatingSystem: "Web",
    description:
      "Explore 11 million California traffic crashes with interactive maps, AI-powered insights, and demographic analysis.",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    featureList: [
      "Interactive crash map with county-level filtering",
      "AI-powered safety insights using Groq LLM",
      "Customizable statistics dashboard with 12 chart types",
      "Demographic and equity analysis",
      "PDF and PNG export",
      "Natural language query builder",
    ],
  };
}

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
    ? `${params.dateRange.start || "2001-01"} / ${params.dateRange.end || "2024-12"}`
    : "2001-01 / 2024-12";

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
      { "@type": "PropertyValue", name: "KSI Rate per 100K Population", unitCode: "P1" },
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

/**
 * FAQPage schema — useful for the About page or if we add an FAQ section
 */
export function buildFaqSchema(
  faqs: { question: string; answer: string }[]
) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}
