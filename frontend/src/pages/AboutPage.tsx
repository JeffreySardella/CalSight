import type { ReactNode } from "react";
import MetaTags from "../components/seo/MetaTags";
import JargonTerm from "../components/ui/JargonTerm";

export default function AboutPage() {
  return (
    <main className="max-w-[900px] mx-auto px-6 md:px-0">
      <MetaTags
        title="About — CalSight"
        description="Learn about CalSight's mission, data sources, team, and methodology for making California traffic crash data accessible to everyone."
        path="/about"
      />

      {/* Hero Section */}
      <section className="py-24 md:py-32 flex flex-col items-center text-center">
        <h1 className="font-headline text-4xl md:text-7xl font-bold tracking-tighter text-on-surface mb-8">
          About CalSight
        </h1>
        <p className="font-body text-lg md:text-xl text-on-surface-variant max-w-2xl leading-relaxed">
          Empowering communities through radical transparency. CalSight
          translates complex civic infrastructure data into actionable insights
          for a safer California.
        </p>
      </section>

      {/* Our Mission Section */}
      <section id="mission" className="py-16 md:py-24">
        <div className="space-y-12">
          <span className="font-label text-xs uppercase tracking-[0.3em] text-on-surface-variant block">
            OUR MISSION
          </span>
          <div className="space-y-6">
            <p className="text-2xl md:text-3xl font-headline font-bold text-on-surface leading-snug">
              Bridging the gap between raw public data and civic action.
            </p>
            <div className="space-y-6 text-on-surface-variant leading-relaxed text-lg font-light">
              <p>
                Civic technology often suffers from a &ldquo;usability
                chasm&rdquo;&mdash;where data exists in the public domain but
                remains functionally inaccessible to the average resident,
                journalist, or policymaker. CalSight was founded to dismantle
                these barriers, treating public safety data as a fundamental
                right rather than a technical privilege.
              </p>
              <p>
                By leveraging advanced spatial analysis and machine learning, we
                transform disparate records into a cohesive &ldquo;Digital
                Ledger&rdquo; of California&rsquo;s roadways. Our platform
                enables users to see patterns that were previously hidden in
                spreadsheets, fostering a culture of accountability and
                data-driven urban design.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Data Sources Section */}
      <section id="data-sources" className="py-16 md:py-24 space-y-12">
        <span className="font-label text-xs uppercase tracking-[0.3em] text-on-surface-variant">
          DATA SOURCES
        </span>

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-4 md:gap-6">
          {[
            { value: "11.1M", label: "Police-reported crashes" },
            { value: "19", label: "Data sources" },
            { value: "25.3M", label: "Total rows in database" },
          ].map(({ value, label }) => (
            <div key={label} className="bg-surface-container-lowest rounded-lg ambient-shadow flex flex-col items-center justify-center text-center gap-4 py-6 md:py-8 px-6">
              <p className="font-headline text-3xl md:text-4xl font-bold text-on-surface tracking-tight">
                {value}
              </p>
              <p className="text-[10px] text-on-surface-variant uppercase tracking-widest font-semibold leading-snug">
                {label}
              </p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-surface-container-lowest p-8 rounded-lg ambient-shadow flex flex-col justify-between">
            <div>
              <h2 className="font-headline text-xl font-bold text-on-surface">CCRS</h2>
              <p className="text-sm text-on-surface-variant mt-1">California Crash Reporting System</p>
              <p className="text-xs text-on-surface-variant mt-3 leading-relaxed">
                4.35M crashes from 2016-2026. Includes party-level demographics (age, gender, sobriety) and victim records. Published by CHP via data.ca.gov.
              </p>
            </div>
            <div className="flex items-center justify-between mt-6">
              <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wider">4,350,202 rows</p>
              <a href="https://data.ca.gov/dataset/ccrs" target="_blank" rel="noopener noreferrer" className="text-xs text-primary font-medium hover:underline">CCRS on data.ca.gov</a>
            </div>
          </div>

          <div className="bg-surface-container-lowest p-8 rounded-lg ambient-shadow flex flex-col justify-between">
            <div>
              <h2 className="font-headline text-xl font-bold text-on-surface">SWITRS</h2>
              <p className="text-sm text-on-surface-variant mt-1">Statewide Integrated Traffic Records System</p>
              <p className="text-xs text-on-surface-variant mt-3 leading-relaxed">
                6.78M crashes from 2001-2015. Crash-level records only — no party or driver demographics. Archived by UC Berkeley and published by CHP.
              </p>
            </div>
            <div className="flex items-center justify-between mt-6">
              <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wider">6,779,445 rows</p>
              <a href="https://www.chp.ca.gov/programs-services/services-information/switrs-statewide-integrated-traffic-records-system" target="_blank" rel="noopener noreferrer" className="text-xs text-primary font-medium hover:underline">SWITRS on CHP.ca.gov</a>
            </div>
          </div>

          <div className="bg-surface-container-lowest p-8 rounded-lg ambient-shadow flex flex-col justify-between">
            <div>
              <h2 className="font-headline text-xl font-bold text-on-surface">US Census Bureau</h2>
              <p className="text-sm text-on-surface-variant mt-1"><JargonTerm term="ACS">ACS</JargonTerm> Demographics + TIGER/Line Boundaries</p>
              <p className="text-xs text-on-surface-variant mt-3 leading-relaxed">
                28 demographic fields per county per year (population, income, poverty, race, education). TIGER/Line 2023 survey-grade county boundaries for coordinate validation. AREAWATER 2023 for lake and harbor exclusion.
              </p>
            </div>
            <div className="flex items-center justify-between mt-6">
              <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wider">1,012 rows + boundaries</p>
              <a href="https://data.census.gov/" target="_blank" rel="noopener noreferrer" className="text-xs text-primary font-medium hover:underline">US Census data explorer</a>
            </div>
          </div>

          <div className="bg-surface-container-lowest p-8 rounded-lg ambient-shadow flex flex-col justify-between">
            <div>
              <h2 className="font-headline text-xl font-bold text-on-surface">Caltrans</h2>
              <p className="text-sm text-on-surface-variant mt-1">Traffic Volumes &amp; Road Classification</p>
              <ul className="text-xs text-on-surface-variant mt-3 leading-relaxed space-y-1">
                <li><JargonTerm term="AADT">AADT</JargonTerm> annual average daily traffic counts for all state highway segments</li>
                <li>Public Road Functional Classification — road miles by county and road type</li>
              </ul>
            </div>
            <div className="flex items-center justify-between mt-6">
              <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wider">~413 rows combined</p>
              <a href="https://data.ca.gov/dataset/public-road-functional-classification" target="_blank" rel="noopener noreferrer" className="text-xs text-primary font-medium hover:underline">Caltrans on data.ca.gov</a>
            </div>
          </div>

          <div className="bg-surface-container-lowest p-8 rounded-lg ambient-shadow flex flex-col justify-between">
            <div>
              <h2 className="font-headline text-xl font-bold text-on-surface">CalEnviroScreen 5.0</h2>
              <p className="text-sm text-on-surface-variant mt-1">Environmental Justice Scores — OEHHA</p>
              <p className="text-xs text-on-surface-variant mt-3 leading-relaxed">
                Population-weighted county scores aggregated from ~9,100 census tracts. Includes <JargonTerm term="CES">CES</JargonTerm> composite score, pollution burden, PM2.5, ozone, diesel particulate matter, traffic proximity, poverty, unemployment, linguistic isolation, and housing burden.
              </p>
            </div>
            <div className="flex items-center justify-between mt-6">
              <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wider">58 county records</p>
              <a href="https://oehha.ca.gov/calenviroscreen" target="_blank" rel="noopener noreferrer" className="text-xs text-primary font-medium hover:underline">CalEnviroScreen on OEHHA</a>
            </div>
          </div>

          <div className="bg-surface-container-lowest p-8 rounded-lg ambient-shadow flex flex-col justify-between">
            <div>
              <h2 className="font-headline text-xl font-bold text-on-surface">California DMV</h2>
              <p className="text-sm text-on-surface-variant mt-1">Vehicle &amp; Driver Registrations</p>
              <ul className="text-xs text-on-surface-variant mt-3 leading-relaxed space-y-1">
                <li>Vehicle Fuel Type Count by Zip Code (2019–2026) — total vehicles and EV registrations per county. Used for Vehicle Registration Trends and EV analysis.</li>
                <li>Driver Licenses Outstanding by County (2008–2024) — licensed driver counts for exposure-adjusted crash rates.</li>
              </ul>
            </div>
            <div className="flex items-center justify-between mt-6">
              <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wider">~1,433 rows combined</p>
              <a href="https://data.ca.gov/dataset/vehicle-fuel-type-count-by-zip-code" target="_blank" rel="noopener noreferrer" className="text-xs text-primary font-medium hover:underline">DMV vehicles on data.ca.gov</a>
            </div>
          </div>

          <div className="bg-surface-container-lowest p-8 rounded-lg ambient-shadow flex flex-col justify-between">
            <div>
              <h2 className="font-headline text-xl font-bold text-on-surface">CA Dept. of Education</h2>
              <p className="text-sm text-on-surface-variant mt-1">California Public Schools 2024-25 — CDE</p>
              <p className="text-xs text-on-surface-variant mt-3 leading-relaxed">
                9,932 active school locations statewide with coordinates, school type, county, and city. Published annually by CDE via data.ca.gov. Used for school-zone overlay markers on the map.
              </p>
            </div>
            <div className="flex items-center justify-between mt-6">
              <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wider">9,932 active schools</p>
              <a href="https://data.ca.gov/dataset/california-public-schools" target="_blank" rel="noopener noreferrer" className="text-xs text-primary font-medium hover:underline">CDE schools on data.ca.gov</a>
            </div>
          </div>

          <div className="bg-surface-container-lowest p-8 rounded-lg ambient-shadow flex flex-col justify-between">
            <div>
              <h2 className="font-headline text-xl font-bold text-on-surface">CA HCAI</h2>
              <p className="text-sm text-on-surface-variant mt-1">Licensed Healthcare Facilities — formerly OSHPD</p>
              <p className="text-xs text-on-surface-variant mt-3 leading-relaxed">
                ~560 General Acute Care, Acute Psychiatric, and Children's Hospitals with coordinates, bed capacity, and trauma center level. Published monthly by HCAI via data.ca.gov. Used for hospital overlay markers on the map.
              </p>
            </div>
            <div className="flex items-center justify-between mt-6">
              <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wider">~560 hospital records</p>
              <a href="https://data.ca.gov/dataset/licensed-and-certified-healthcare-facility-listing" target="_blank" rel="noopener noreferrer" className="text-xs text-primary font-medium hover:underline">HCAI facilities on data.ca.gov</a>
            </div>
          </div>

          <div className="bg-surface-container-lowest p-8 rounded-lg ambient-shadow flex flex-col justify-between">
            <div>
              <h2 className="font-headline text-xl font-bold text-on-surface">Federal Agencies</h2>
              <p className="text-sm text-on-surface-variant mt-1">NOAA, BLS, FHWA</p>
              <ul className="text-xs text-on-surface-variant mt-3 leading-relaxed space-y-1">
                <li>NOAA monthly county weather data (2001-2025)</li>
                <li>BLS monthly unemployment rates (2005-2025)</li>
                <li>FHWA HPMS road miles and speed limits</li>
              </ul>
            </div>
            <div className="flex items-center justify-between mt-6">
              <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wider">~18,000 rows combined</p>
              <a href="https://www.ncdc.noaa.gov/" target="_blank" rel="noopener noreferrer" className="text-xs text-primary font-medium hover:underline">NOAA Climate Data Center</a>
            </div>
          </div>

          <div className="bg-surface-container-lowest p-8 rounded-lg ambient-shadow flex flex-col justify-between">
            <div>
              <h2 className="font-headline text-xl font-bold text-on-surface">OpenStreetMap + AI</h2>
              <p className="text-sm text-on-surface-variant mt-1">Spatial validation and insight generation</p>
              <ul className="text-xs text-on-surface-variant mt-3 leading-relaxed space-y-1">
                <li>OSM bridge locations (55K+ segments) for coordinate validation</li>
                <li>Groq (llama-3.3-70b) — primary AI insight generation</li>
                <li>Google Gemini 2.5 Flash — fallback</li>
                <li>OpenRouter + Cerebras — additional fallbacks</li>
              </ul>
            </div>
            <div className="flex items-center justify-between mt-6">
              <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wider">OSM data © contributors</p>
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="text-xs text-primary font-medium hover:underline">OSM License</a>
            </div>
          </div>

          <div className="bg-surface-container-lowest p-8 rounded-lg ambient-shadow flex flex-col justify-between">
            <div>
              <h2 className="font-headline text-xl font-bold text-on-surface">DWR / CDEC</h2>
              <p className="text-sm text-on-surface-variant mt-1">California Data Exchange Center</p>
              <p className="text-xs text-on-surface-variant mt-3 leading-relaxed">
                Daily reservoir storage for 15 major reservoirs and snow water equivalent from 15 Sierra snow sensors. Published by the Department of Water Resources.
              </p>
            </div>
            <div className="flex items-center justify-between mt-6">
              <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wider">Daily sensor readings</p>
              <a href="https://cdec.water.ca.gov/" target="_blank" rel="noopener noreferrer" className="text-xs text-primary font-medium hover:underline">cdec.water.ca.gov</a>
            </div>
          </div>

          <div className="bg-surface-container-lowest p-8 rounded-lg ambient-shadow flex flex-col justify-between">
            <div>
              <h2 className="font-headline text-xl font-bold text-on-surface">US Drought Monitor</h2>
              <p className="text-sm text-on-surface-variant mt-1">Weekly county drought severity</p>
              <p className="text-xs text-on-surface-variant mt-3 leading-relaxed">
                Percent of each county's land area in severity classes D0–D4, updated weekly. Produced by the National Drought Mitigation Center, USDA, and NOAA; map courtesy of NDMC.
              </p>
            </div>
            <div className="flex items-center justify-between mt-6">
              <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wider">58 counties weekly</p>
              <a href="https://droughtmonitor.unl.edu/" target="_blank" rel="noopener noreferrer" className="text-xs text-primary font-medium hover:underline">droughtmonitor.unl.edu</a>
            </div>
          </div>
        </div>
      </section>

      {/* Known Limitations Section */}
      <section id="limitations" className="py-16 md:py-24 space-y-12">
        <span className="font-label text-xs uppercase tracking-[0.3em] text-on-surface-variant">
          DATA LIMITATIONS
        </span>
        <p className="text-on-surface-variant leading-relaxed text-lg font-light max-w-2xl">
          We show police-reported crashes only. Here's what that means for the data, and what we're transparent about.
        </p>
        <div className="space-y-4">
          {[
            {
              title: "63% of crashes have no coordinates",
              body: "We know the county for every crash, but most can't be pinned on a map. The missing coordinates depend on which agency filed the report — some county sheriffs geocode consistently, others don't. Choropleth maps are reliable; pin maps show a biased sample.",
            },
            {
              title: "No driver demographics before 2016",
              body: (
                <>
                  <JargonTerm term="SWITRS">SWITRS</JargonTerm> (2001-2015) records the crash but not who was involved.
                  Age, gender, sobriety, and cell phone data come from <JargonTerm term="CCRS">CCRS</JargonTerm> (2016+)
                  only. Charts for those fields are blank or greyed out for pre-2016 years.
                </>
              ),
            },
            {
              title: "Underreporting: real crash numbers are probably 2-3x higher",
              body: "Only crashes that receive a police report end up in the database. NHTSA estimates 50-60% of injury crashes and ~30% of property-damage-only crashes go unreported. Fatal crashes are close to 100% reported. The underreporting rate varies by county, income level, and language access.",
            },
            {
              title: "Pedestrian and bicyclist crashes are undercounted the most",
              body: "Studies that link police crash reports to hospital records find police data captures roughly 44-75% of pedestrian injury crashes and 7-46% of bicyclist injury crashes. Counts for pedestrians and cyclists here reflect police-reported crashes only, so they understate the true number of injuries.",
              source: { label: "Hospital-linkage study (UC eScholarship)", url: "https://escholarship.org/uc/item/0jq5h6f5" },
            },
            {
              title: "Street-level grouping uses reported road names",
              body: "Intersections and corridors are grouped by the primary and secondary road names written on each crash report. Spelling variants (\"Main St\" / \"MAIN  ST\") are normalized together, but crashes with missing or blank road names are excluded from those views, so street-level counts are a lower bound.",
            },
            {
              title: "Education data missing before 2012",
              body: "The Census Bureau didn't publish the B15003 table (educational attainment) in ACS 5-year estimates before 2012. Bachelor's degree and high school rates are null for earlier years.",
            },
            {
              title: "Small counties missing 2005-2009",
              body: (
                <>
                  <JargonTerm term="ACS">ACS</JargonTerm> 1-year estimates only cover counties with 65K+ population.
                  About 28 smaller counties have no demographic data for those five years. Full 58-county coverage
                  begins with the ACS 5-year estimates in 2010.
                </>
              ),
            },
            {
              title: "Traffic volumes cover state highways only",
              body: (
                <>
                  Caltrans <JargonTerm term="AADT">AADT</JargonTerm> data is limited to state-managed roads.
                  Local streets, county roads, and city streets — where many crashes occur — are not included.
                  Per-road-mile rates should be interpreted with this in mind.
                </>
              ),
            },
          ].map(({ title, body, source }: { title: string; body: ReactNode; source?: { label: string; url: string } }) => (
            <div key={title} className="border-t border-outline-variant/20 pt-4">
              <h3 className="text-sm font-semibold text-on-surface mb-1">{title}</h3>
              <p className="text-sm text-on-surface-variant leading-relaxed">{body}</p>
              {source && (
                <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary font-medium hover:underline mt-1 inline-block">
                  {source.label}
                </a>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-on-surface-variant italic">
          Full technical detail in{" "}
          <a href="https://github.com/JeffreySardella/CalSight/blob/main/backend/DATA_GAPS.md" target="_blank" rel="noopener noreferrer" className="underline hover:text-on-surface transition-colors">DATA_GAPS.md</a>
          {" "}and{" "}
          <a href="https://github.com/JeffreySardella/CalSight/blob/main/backend/DATA_VALIDATION.md" target="_blank" rel="noopener noreferrer" className="underline hover:text-on-surface transition-colors">DATA_VALIDATION.md</a>.
        </p>
      </section>

      {/* How It Works Section */}
      <section className="py-16 md:py-24 space-y-12">
        <span className="font-label text-xs uppercase tracking-[0.3em] text-on-surface-variant">
          HOW IT WORKS
        </span>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="space-y-4">
            <div className="w-12 h-12 flex items-center justify-center rounded-full bg-primary-container text-primary">
              <span className="material-symbols-outlined">map</span>
            </div>
            <h3 className="font-headline font-bold text-lg text-on-surface">
              Explore
            </h3>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              Interactive GIS mapping allows you to visualize incident density
              across specific neighborhoods and corridors.
            </p>
          </div>

          <div className="space-y-4">
            <div className="w-12 h-12 flex items-center justify-center rounded-full bg-tertiary-container text-tertiary">
              <span className="material-symbols-outlined">insights</span>
            </div>
            <h3 className="font-headline font-bold text-lg text-on-surface">
              Analyze
            </h3>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              Drill down into time-of-day, weather conditions, and vehicle types
              to understand the root causes of risk.
            </p>
          </div>

          <div className="space-y-4">
            <div className="w-12 h-12 flex items-center justify-center rounded-full bg-secondary-container text-secondary">
              <span className="material-symbols-outlined">psychology</span>
            </div>
            <h3 className="font-headline font-bold text-lg text-on-surface">
              Discover
            </h3>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              Cross-reference crash patterns with demographics, weather, and
              infrastructure data to find unexpected correlations.
            </p>
          </div>
        </div>
      </section>

      {/* The Team Section */}
      <section className="py-16 md:py-24 space-y-12 mb-24">
        <span className="font-label text-xs uppercase tracking-[0.3em] text-on-surface-variant">
          THE TEAM
        </span>
        <div className="flex overflow-x-auto gap-6 pb-8 snap-x no-scrollbar md:grid md:grid-cols-3">
          <div className="min-w-[240px] snap-start space-y-4 p-6 bg-surface-container-low rounded-xl">
            <div className="w-16 h-16 rounded-full bg-primary-fixed text-on-primary-fixed flex items-center justify-center font-bold text-xl font-headline">
              JS
            </div>
            <div>
              <h3 className="font-bold text-on-surface">Jeffrey Sardella</h3>
              <p className="text-xs text-primary font-medium">
                Project Lead & Full-Stack Developer
              </p>
            </div>
          </div>

          <div className="min-w-[240px] snap-start space-y-4 p-6 bg-surface-container-low rounded-xl">
            <div className="w-16 h-16 rounded-full bg-tertiary-fixed text-on-tertiary-fixed flex items-center justify-center font-bold text-xl font-headline">
              MS
            </div>
            <div>
              <h3 className="font-bold text-on-surface">Maksim Shkrabak</h3>
              <p className="text-xs text-primary font-medium">
                Developer
              </p>
            </div>
          </div>

          <div className="min-w-[240px] snap-start space-y-4 p-6 bg-surface-container-low rounded-xl">
            <div className="w-16 h-16 rounded-full bg-secondary-fixed text-on-secondary-fixed flex items-center justify-center font-bold text-xl font-headline">
              JL
            </div>
            <div>
              <h3 className="font-bold text-on-surface">John Longarini</h3>
              <p className="text-xs text-primary font-medium">
                Developer
              </p>
            </div>
          </div>

          <div className="min-w-[240px] snap-start space-y-4 p-6 bg-surface-container-low rounded-xl">
            <div className="w-16 h-16 rounded-full bg-tertiary-fixed text-on-tertiary-fixed flex items-center justify-center font-bold text-xl font-headline">
              GK
            </div>
            <div>
              <h3 className="font-bold text-on-surface">Gavin Kabel</h3>
              <p className="text-xs text-primary font-medium">
                Developer
              </p>
            </div>
          </div>

        </div>
        <p className="text-xs text-on-surface-variant italic md:hidden">
          Scroll for more
        </p>
      </section>

      {/* Privacy Policy Section */}
      <section id="privacy" className="py-16 md:py-24 mb-12">
        <span className="font-label text-xs uppercase tracking-[0.3em] text-on-surface-variant block mb-10">
          PRIVACY
        </span>
        <p className="text-on-surface-variant leading-relaxed text-sm">
          CalSight does not use cookies, tracking pixels, or third-party analytics. No personal data is collected or stored.
          For full details including our Ask AI data handling practices, see our{" "}
          <a href="/privacy" className="underline decoration-on-surface-variant/30 hover:text-on-surface transition-colors font-semibold">Privacy Policy</a>.
        </p>
      </section>
    </main>
  );
}
