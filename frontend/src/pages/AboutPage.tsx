import { Helmet } from "react-helmet-async";

export default function AboutPage() {
  return (
    <main className="max-w-[900px] mx-auto px-6 md:px-0">
      <Helmet>
        <title>CalSight | About</title>
        <meta name="description" content="CalSight is an open source civic tech tool making California crash data explorable for residents, journalists, and policymakers." />
        <meta property="og:title" content="CalSight | About" />
        <meta property="og:description" content="CalSight is an open source civic tech tool making California crash data explorable for residents, journalists, and policymakers." />
        <meta property="og:image" content="/og-image.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="CalSight | About" />
        <meta name="twitter:description" content="CalSight is an open source civic tech tool making California crash data explorable for residents, journalists, and policymakers." />
        <script type="application/ld+json">{JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          "name": "CalSight",
          "url": "https://calsight.io",
          "description": "California Crash Data Explorer — open source civic tech tool.",
          "creator": {
            "@type": "Organization",
            "name": "CalSight"
          }
        })}</script>
      </Helmet>

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
      <section className="py-16 md:py-24">
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
      <section className="py-16 md:py-24 space-y-12">
        <span className="font-label text-xs uppercase tracking-[0.3em] text-on-surface-variant">
          DATA SOURCES
        </span>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-surface-container-lowest p-8 rounded-lg ambient-shadow flex flex-col justify-between h-48">
            <div>
              <h3 className="font-headline text-xl font-bold text-on-surface">
                CCRS
              </h3>
              <p className="text-sm text-on-surface-variant mt-2">
                California Crash Reporting System
              </p>
            </div>
            <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wider">
              Primary Record Set
            </p>
          </div>

          <div className="bg-surface-container-lowest p-8 rounded-lg ambient-shadow flex flex-col justify-between h-48">
            <div>
              <h3 className="font-headline text-xl font-bold text-on-surface">
                SWITRS
              </h3>
              <p className="text-sm text-on-surface-variant mt-2">
                Statewide Integrated Traffic Records
              </p>
            </div>
            <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wider">
              Historical Metadata
            </p>
          </div>

          <div className="bg-surface-container-lowest p-8 rounded-lg ambient-shadow flex flex-col justify-between h-48">
            <div>
              <h3 className="font-headline text-xl font-bold text-on-surface">
                US Census Bureau
              </h3>
              <p className="text-sm text-on-surface-variant mt-2">
                Demographic &amp; Economic Context
              </p>
            </div>
            <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wider">
              Socio-economic Overlay
            </p>
          </div>

          <div className="bg-surface-container-lowest p-8 rounded-lg ambient-shadow flex flex-col justify-between h-48">
            <div>
              <h3 className="font-headline text-xl font-bold text-on-surface">
                CHP
              </h3>
              <p className="text-sm text-on-surface-variant mt-2">
                California Highway Patrol Enforcement
              </p>
            </div>
            <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wider">
              Operational Data
            </p>
          </div>
        </div>
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
              ES
            </div>
            <div>
              <h4 className="font-bold text-on-surface">Elena Sorvino</h4>
              <p className="text-xs text-primary font-medium mb-2">
                Director of Data Science
              </p>
              <p className="text-xs text-on-surface-variant leading-normal">
                Formerly of the DOT, Elena leads our algorithmic transparency
                initiatives.
              </p>
            </div>
          </div>

          <div className="min-w-[240px] snap-start space-y-4 p-6 bg-surface-container-low rounded-xl">
            <div className="w-16 h-16 rounded-full bg-tertiary-fixed text-on-tertiary-fixed flex items-center justify-center font-bold text-xl font-headline">
              MJ
            </div>
            <div>
              <h4 className="font-bold text-on-surface">Marcus Jensen</h4>
              <p className="text-xs text-primary font-medium mb-2">
                Lead Systems Architect
              </p>
              <p className="text-xs text-on-surface-variant leading-normal">
                Marcus manages our distributed pipeline for real-time traffic
                record ingestion.
              </p>
            </div>
          </div>

          <div className="min-w-[240px] snap-start space-y-4 p-6 bg-surface-container-low rounded-xl">
            <div className="w-16 h-16 rounded-full bg-secondary-fixed text-on-secondary-fixed flex items-center justify-center font-bold text-xl font-headline">
              LY
            </div>
            <div>
              <h4 className="font-bold text-on-surface">Lana Yang</h4>
              <p className="text-xs text-primary font-medium mb-2">
                Civic Design Lead
              </p>
              <p className="text-xs text-on-surface-variant leading-normal">
                Lana ensures CalSight&rsquo;s visual language is accessible to
                all California citizens.
              </p>
            </div>
          </div>
        </div>
        <p className="text-xs text-on-surface-variant/50 italic md:hidden">
          Scroll for more
        </p>
      </section>
    </main>
  );
}
