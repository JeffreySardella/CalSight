export default function AboutPage() {
  return (
    <main className="max-w-[900px] mx-auto px-6 md:px-0">

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
            { value: "17", label: "Government data sources" },
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
              <h3 className="font-headline text-xl font-bold text-on-surface">CCRS</h3>
              <p className="text-sm text-on-surface-variant mt-1">California Crash Reporting System</p>
              <p className="text-xs text-on-surface-variant mt-3 leading-relaxed">
                4.35M crashes from 2016-2026. Includes party-level demographics (age, gender, sobriety) and victim records. Published by CHP via data.ca.gov.
              </p>
            </div>
            <div className="flex items-center justify-between mt-6">
              <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wider">4,350,202 rows · 2016-2026</p>
              <a href="https://data.ca.gov/dataset/ccrs" target="_blank" rel="noopener noreferrer" className="text-xs text-primary font-medium hover:underline">Learn More</a>
            </div>
          </div>

          <div className="bg-surface-container-lowest p-8 rounded-lg ambient-shadow flex flex-col justify-between">
            <div>
              <h3 className="font-headline text-xl font-bold text-on-surface">SWITRS</h3>
              <p className="text-sm text-on-surface-variant mt-1">Statewide Integrated Traffic Records System</p>
              <p className="text-xs text-on-surface-variant mt-3 leading-relaxed">
                6.78M crashes from 2001-2015. Crash-level records only — no party or driver demographics. Archived by UC Berkeley and published by CHP.
              </p>
            </div>
            <div className="flex items-center justify-between mt-6">
              <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wider">6,779,445 rows · 2001-2015</p>
              <a href="https://www.chp.ca.gov/programs-services/services-information/switrs-statewide-integrated-traffic-records-system" target="_blank" rel="noopener noreferrer" className="text-xs text-primary font-medium hover:underline">Learn More</a>
            </div>
          </div>

          <div className="bg-surface-container-lowest p-8 rounded-lg ambient-shadow flex flex-col justify-between">
            <div>
              <h3 className="font-headline text-xl font-bold text-on-surface">US Census Bureau</h3>
              <p className="text-sm text-on-surface-variant mt-1">American Community Survey (ACS)</p>
              <p className="text-xs text-on-surface-variant mt-3 leading-relaxed">
                28 demographic and economic fields per county per year — population, income, poverty, race, education, vehicle ownership. 5-year estimates for all 58 counties starting 2010; 1-year estimates for larger counties 2005-2009.
              </p>
            </div>
            <div className="flex items-center justify-between mt-6">
              <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wider">1,012 rows · 2005-2022</p>
              <a href="https://data.census.gov/" target="_blank" rel="noopener noreferrer" className="text-xs text-primary font-medium hover:underline">Learn More</a>
            </div>
          </div>

          <div className="bg-surface-container-lowest p-8 rounded-lg ambient-shadow flex flex-col justify-between">
            <div>
              <h3 className="font-headline text-xl font-bold text-on-surface">NOAA / BLS / DMV</h3>
              <p className="text-sm text-on-surface-variant mt-1">Weather, Unemployment &amp; Vehicle Data</p>
              <p className="text-xs text-on-surface-variant mt-3 leading-relaxed">
                Monthly county weather (NOAA, 2001-2025), monthly unemployment rates (BLS, 2005-2025), annual vehicle registrations by county (CA DMV, 2019-2026), and licensed driver counts (CA DMV, 2008-2024).
              </p>
            </div>
            <div className="flex items-center justify-between mt-6">
              <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wider">32,306 rows combined</p>
              <a href="https://www.bls.gov/lau/" target="_blank" rel="noopener noreferrer" className="text-xs text-primary font-medium hover:underline">Learn More</a>
            </div>
          </div>

          <div className="bg-surface-container-lowest p-8 rounded-lg ambient-shadow flex flex-col justify-between">
            <div>
              <h3 className="font-headline text-xl font-bold text-on-surface">Caltrans</h3>
              <p className="text-sm text-on-surface-variant mt-1">Traffic Volumes &amp; Road Miles</p>
              <p className="text-xs text-on-surface-variant mt-3 leading-relaxed">
                Annual average daily traffic (AADT) and road miles for state-managed highways. Covers state routes only — local and county roads are not included.
              </p>
            </div>
            <div className="flex items-center justify-between mt-6">
              <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wider">413 rows · state highways only</p>
              <a href="https://dot.ca.gov/programs/traffic-operations/census" target="_blank" rel="noopener noreferrer" className="text-xs text-primary font-medium hover:underline">Learn More</a>
            </div>
          </div>

          <div className="bg-surface-container-lowest p-8 rounded-lg ambient-shadow flex flex-col justify-between">
            <div>
              <h3 className="font-headline text-xl font-bold text-on-surface">CalEnviroScreen</h3>
              <p className="text-sm text-on-surface-variant mt-1">CA Office of Environmental Health Hazard Assessment</p>
              <p className="text-xs text-on-surface-variant mt-3 leading-relaxed">
                Environmental justice scores for all 58 counties, derived from 8,035 census tracts (version 4.0, based on 2021 data). A single snapshot — not a time series.
              </p>
            </div>
            <div className="flex items-center justify-between mt-6">
              <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wider">58 rows · 2021 snapshot</p>
              <a href="https://oehha.ca.gov/calenviroscreen" target="_blank" rel="noopener noreferrer" className="text-xs text-primary font-medium hover:underline">Learn More</a>
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
              body: "SWITRS (2001-2015) records the crash but not who was involved. Age, gender, sobriety, and cell phone data come from CCRS (2016+) only. Charts for those fields are blank or greyed out for pre-2016 years.",
            },
            {
              title: "Underreporting: real crash numbers are probably 2-3x higher",
              body: "Only crashes that receive a police report end up in the database. NHTSA estimates 50-60% of injury crashes and ~30% of property-damage-only crashes go unreported. Fatal crashes are close to 100% reported. The underreporting rate varies by county, income level, and language access.",
            },
            {
              title: "Education data missing before 2012",
              body: "The Census Bureau didn't publish the B15003 table (educational attainment) in ACS 5-year estimates before 2012. Bachelor's degree and high school rates are null for earlier years.",
            },
            {
              title: "Small counties missing 2005-2009",
              body: "ACS 1-year estimates only cover counties with 65K+ population. About 28 smaller counties have no demographic data for those five years. Full 58-county coverage begins with the ACS 5-year estimates in 2010.",
            },
            {
              title: "Traffic volumes cover state highways only",
              body: "Caltrans AADT data is limited to state-managed roads. Local streets, county roads, and city streets — where many crashes occur — are not included. Per-road-mile rates should be interpreted with this in mind.",
            },
          ].map(({ title, body }) => (
            <div key={title} className="border-t border-outline-variant/20 pt-4">
              <h4 className="text-sm font-semibold text-on-surface mb-1">{title}</h4>
              <p className="text-sm text-on-surface-variant leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-on-surface-variant/60 italic">
          Full technical detail in{" "}
          <a href="https://github.com/JeffreySardella/CalSight/blob/main/backend/DATA_GAPS.md" target="_blank" rel="noopener noreferrer" className="underline hover:text-on-surface-variant transition-colors">DATA_GAPS.md</a>
          {" "}and{" "}
          <a href="https://github.com/JeffreySardella/CalSight/blob/main/backend/DATA_VALIDATION.md" target="_blank" rel="noopener noreferrer" className="underline hover:text-on-surface-variant transition-colors">DATA_VALIDATION.md</a>.
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
            <h4 className="font-headline font-bold text-lg text-on-surface">
              Explore
            </h4>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              Interactive GIS mapping allows you to visualize incident density
              across specific neighborhoods and corridors.
            </p>
          </div>

          <div className="space-y-4">
            <div className="w-12 h-12 flex items-center justify-center rounded-full bg-tertiary-container text-tertiary">
              <span className="material-symbols-outlined">insights</span>
            </div>
            <h4 className="font-headline font-bold text-lg text-on-surface">
              Analyze
            </h4>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              Drill down into time-of-day, weather conditions, and vehicle types
              to understand the root causes of risk.
            </p>
          </div>

          <div className="space-y-4">
            <div className="w-12 h-12 flex items-center justify-center rounded-full bg-secondary-container text-secondary">
              <span className="material-symbols-outlined">psychology</span>
            </div>
            <h4 className="font-headline font-bold text-lg text-on-surface">
              Discover
            </h4>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              Use our AI-driven insights to find unexpected correlations between
              infrastructure design and safety outcomes.
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
              <h4 className="font-bold text-on-surface">Jeffrey Sardella</h4>
              <p className="text-xs text-primary font-medium mb-2">
                Project Lead & Full-Stack Developer
              </p>
              <p className="text-xs text-on-surface-variant leading-normal">
                Jeffrey founded CalSight and leads project direction, design system, and architecture for making California crash data accessible.
              </p>
            </div>
          </div>

          <div className="min-w-[240px] snap-start space-y-4 p-6 bg-surface-container-low rounded-xl">
            <div className="w-16 h-16 rounded-full bg-tertiary-fixed text-on-tertiary-fixed flex items-center justify-center font-bold text-xl font-headline">
              MS
            </div>
            <div>
              <h4 className="font-bold text-on-surface">Maksim Shkrabak</h4>
              <p className="text-xs text-primary font-medium mb-2">
                Put what title you want here
              </p>
              <p className="text-xs text-on-surface-variant leading-normal">
                short description of what you do, your background, and your role in the project. You can also include any relevant experience or skills that contribute to the project&#39;s success.
              </p>
            </div>
          </div>

          <div className="min-w-[240px] snap-start space-y-4 p-6 bg-surface-container-low rounded-xl">
            <div className="w-16 h-16 rounded-full bg-secondary-fixed text-on-secondary-fixed flex items-center justify-center font-bold text-xl font-headline">
              JL
            </div>
            <div>
              <h4 className="font-bold text-on-surface">John Longarini</h4>
              <p className="text-xs text-primary font-medium mb-2">
                Put what title you want here
              </p>
              <p className="text-xs text-on-surface-variant leading-normal">
                short description of what you do, your background, and your role in the project. You can also include any relevant experience or skills that contribute to the project&#39;s success.
              </p>
            </div>
          </div>

          <div className="min-w-[240px] snap-start space-y-4 p-6 bg-surface-container-low rounded-xl">
            <div className="w-16 h-16 rounded-full bg-tertiary-fixed text-on-tertiary-fixed flex items-center justify-center font-bold text-xl font-headline">
              GK
            </div>
            <div>
              <h4 className="font-bold text-on-surface">Gavin Kabel</h4>
              <p className="text-xs text-primary font-medium mb-2">
                Put what title you want here
              </p>
              <p className="text-xs text-on-surface-variant leading-normal">
                short description of what you do, your background, and your role in the project. You can also include any relevant experience or skills that contribute to the project&#39;s success.
              </p>
            </div>
          </div>

        </div>
        <p className="text-xs text-on-surface-variant/50 italic md:hidden">
          Scroll for more
        </p>
      </section>

      {/* Privacy Policy Section */}
      <section id="privacy" className="py-16 md:py-24 mb-12">
        <span className="font-label text-xs uppercase tracking-[0.3em] text-on-surface-variant block mb-10">
          PRIVACY POLICY
        </span>
        <div className="space-y-6 text-on-surface-variant leading-relaxed text-sm">
          <p>
            CalSight is a public civic data tool. All crash data displayed is
            sourced from publicly available California government datasets
            (CCRS, SWITRS) and contains no personally identifiable information.
          </p>
          <p>
            <span className="font-semibold text-on-surface">AI Features:</span>{" "}
            Questions submitted through the Ask AI feature are processed by
            Google&rsquo;s Gemini API to generate responses. Your questions are
            sent to Google&rsquo;s servers for processing but are not stored,
            logged, or used for training by CalSight. Google&rsquo;s own data
            handling practices apply to API interactions.
          </p>
          <p>
            <span className="font-semibold text-on-surface">Analytics:</span>{" "}
            CalSight does not use cookies, tracking pixels, or third-party
            analytics. No personal data is collected, stored, or shared.
          </p>
            <p>
              <span className="font-semibold text-on-surface">Contact:</span>{" "}
              For questions about data handling, reach out via the project&rsquo;s{" "}
              <a 
                href="https://github.com/JeffreySardella/CalSight" 
                target="_blank" 
                rel="noopener noreferrer"
                className="underline decoration-on-surface-variant/30 hover:text-on-surface transition-colors"
              >
                GitHub repository
              </a>.
            </p>
        </div>
      </section>
    </main>
  );
}
