import JargonTerm from "../components/ui/JargonTerm";

export default function PrivacyPage() {
  return (
    <div className="max-w-[700px] mx-auto px-6 pt-16 pb-24">
      <h1 className="font-headline text-3xl font-extrabold tracking-tighter text-on-surface mb-2">
        Privacy Policy
      </h1>
      <p className="text-xs text-on-surface-variant mb-8">Last updated: July 10, 2026</p>

      <div className="space-y-8 text-on-surface-variant text-sm leading-relaxed">
        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">Overview</h2>
          <p>
            CalSight is a free, open-source civic data tool. We do not require accounts,
            logins, or passwords. We do not use cookies, tracking pixels, or third-party
            analytics. We do not sell, share, or monetize any data. This policy explains
            what happens technically when you use the site.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">Hosting &amp; Infrastructure</h2>
          <p>
            CalSight is hosted on{" "}
            <a href="https://www.cloudflare.com/privacypolicy/" className="text-primary underline" target="_blank" rel="noopener noreferrer">Cloudflare Pages</a>.
            When you visit the site, Cloudflare processes your request and may log your IP address,
            browser type, and request URL as part of their standard infrastructure (DDoS protection,
            CDN caching). We do not add any analytics or tracking on top of Cloudflare&apos;s defaults.
            We do not have access to individual visitor IP logs.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">Ask AI Feature</h2>
          <p className="mb-3">
            When you use the Ask AI feature, your question is sent to a third-party AI provider
            to generate a response. Chat history exists only in your browser&apos;s session storage
            and is cleared when you close the tab.
          </p>
          <p>
            <strong className="text-on-surface">Important:</strong> some of our fallback providers
            — notably the free tier of Google Gemini — may use text submitted through their APIs
            for model training and product improvement (see the provider list below). Treat
            anything you type into Ask AI as if it could be retained by a third party:{" "}
            <strong className="text-on-surface">do not include personal information</strong>{" "}
            (names, addresses, license plates, case numbers, or details of a specific crash you
            were involved in) in your questions.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">Feedback &amp; Quality Improvement</h2>
          <p>
            When you rate a response (thumbs up or down), we store the question, the AI&apos;s answer,
            which provider generated it, the tools called, your vote, and which filters were active
            at the time. This data is used solely to improve response quality. No personal information
            (IP address, name, or account data) is attached to feedback — it is completely anonymous.
            The suggested &ldquo;Popular Questions&rdquo; shown on the Ask AI page are curated examples,
            not sourced from user queries.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">Data Retention</h2>
          <p>
            Feedback records (the question, the AI&apos;s answer, the provider, the tools called,
            your vote, and the active filters) are the only user-generated data we store on our
            servers. They are retained indefinitely for quality improvement unless deletion is
            requested. Because no IP address, account, or other identifier is attached to a
            feedback record, we cannot link a record to you — if you want a specific record
            deleted, contact us via GitHub (link below) with the approximate question text and
            we will remove matching records. Questions asked through Ask AI that you do not rate
            are not stored in our database; they are processed to generate the answer (including
            a short-lived server-side answer cache) and sent to the AI provider as described above.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">What We Send to AI Providers</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Your question (plain text, maximum 500 characters)</li>
            <li>Recent conversation context (last 5 exchanges) for follow-up understanding</li>
            <li>Your active filter selections (county, year, severity, cause) so the model can tailor its answer — these contain no personal data</li>
            <li>Crash statistics from our database (public California state data, not user data)</li>
          </ul>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">What We Do NOT Collect or Send</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Your precise GPS location (geolocation stays in your browser and is never sent to us)</li>
            <li>Any personally identifiable information</li>
            <li>Browsing history or behavior on other sites</li>
            <li>Device fingerprints</li>
          </ul>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">AI Providers</h2>
          <p className="mb-3">CalSight uses the following AI providers to generate responses:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong>Groq</strong> — Primary provider. Does not use API inputs for model training.{" "}
              <a href="https://groq.com/privacy-policy/" className="text-primary underline" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
            </li>
            <li>
              <strong>Cerebras</strong> — Fallback. Does not use API inputs for model training.{" "}
              <a href="https://cerebras.ai/privacy-policy" className="text-primary underline" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
            </li>
            <li>
              <strong>Google Gemini</strong> (free tier) — Fallback. Under Google&apos;s terms for
              unpaid API use, Google may use submitted text (your question and conversation
              context) to train and improve its models, and human reviewers may read it. Do not
              include personal information in questions.{" "}
              <a href="https://ai.google.dev/gemini-api/terms" className="text-primary underline" target="_blank" rel="noopener noreferrer">Terms of Service</a>
            </li>
            <li>
              <strong>OpenRouter</strong> — Fallback. Privacy depends on the backing model provider.{" "}
              <a href="https://openrouter.ai/privacy" className="text-primary underline" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">Third-Party Services</h2>
          <p className="mb-3">
            Your browser makes direct requests to the following services when using CalSight.
            Each service can see your IP address as part of the request:
          </p>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong>CARTO</strong> — Provides map tile images (basemaps.cartocdn.com). CARTO sees
              which map tiles your browser requests (i.e., which area you&apos;re viewing at what zoom level).{" "}
              <a href="https://carto.com/privacy/" className="text-primary underline" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
            </li>
            <li>
              <strong>Google Fonts</strong> — Serves the Libre Baskerville typeface and Material Symbols
              icons (fonts.googleapis.com, fonts.gstatic.com). Google may log font requests.{" "}
              <a href="https://developers.google.com/fonts/faq/privacy" className="text-primary underline" target="_blank" rel="noopener noreferrer">Google Fonts Privacy</a>
            </li>
            <li>
              <strong>OpenStreetMap Nominatim</strong> — Powers address/place search. Only your search
              text is transmitted, not GPS coordinates or personal information.{" "}
              <a href="https://osmfoundation.org/wiki/Privacy_Policy" className="text-primary underline" target="_blank" rel="noopener noreferrer">OSM Privacy Policy</a>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">Location Features</h2>
          <p>
            The &ldquo;My Location&rdquo; button uses your browser&apos;s geolocation API to center the map
            on your position. Your coordinates are processed entirely in your browser to identify the
            nearest county — they are never sent to our servers.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">Local Storage (Browser Only)</h2>
          <p className="mb-3">
            CalSight stores your preferences in your browser&apos;s local storage so they persist
            between visits. This data never leaves your device. It includes:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Theme preference (dark/light mode)</li>
            <li>Custom theme colors and accessibility settings</li>
            <li>Dashboard layout and saved dashboard configurations</li>
            <li>Map layer visibility and filter mode preference</li>
            <li>Saved favorite locations</li>
            <li>Keyboard shortcut remaps</li>
            <li>Whether you&apos;ve dismissed the intro overlay</li>
          </ul>
          <p className="mt-3">
            You can clear all of this data at any time using your browser&apos;s &ldquo;Clear site
            data&rdquo; function. No login or account is required — these preferences are purely local.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">Data Sources</h2>
          <p>
            All crash and demographic data displayed on CalSight is sourced from publicly available
            California and federal datasets (<JargonTerm term="CCRS">CCRS</JargonTerm>,{" "}
            <JargonTerm term="SWITRS">SWITRS</JargonTerm>, Census{" "}
            <JargonTerm term="ACS">ACS</JargonTerm>, NOAA, BLS, Caltrans, DMV,{" "}
            <JargonTerm term="CalEnviroScreen">CalEnviroScreen</JargonTerm>, FHWA). No private or
            proprietary data is used. No individual crash
            records contain personally identifiable information — all data is aggregated at the
            county level or anonymized at the record level by the source agencies.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">Children&apos;s Privacy (COPPA)</h2>
          <p>
            CalSight does not knowingly collect personal information from anyone, including children
            under 13. Since we collect no personal data and require no accounts, there is no
            mechanism through which a child&apos;s information could be gathered.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">California Consumer Privacy Act (CCPA)</h2>
          <p>
            CalSight does not sell personal information. We do not collect personal information
            as defined by the CCPA (real name, email, IP address, browsing history, geolocation,
            or identifiers). Because no personal information is collected, there is nothing to
            delete, disclose, or opt out of. If you have questions, you can still contact us
            using the link below.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">Changes to This Policy</h2>
          <p>
            If we make material changes to this policy, we will update the &ldquo;Last updated&rdquo;
            date at the top of this page. Since CalSight has no accounts or email collection,
            we cannot notify users directly — please check back periodically.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">Contact</h2>
          <p>
            Questions about this policy? Reach out via the{" "}
            <a href="https://github.com/JeffreySardella/CalSight" className="text-primary underline" target="_blank" rel="noopener noreferrer">
              CalSight GitHub repository
            </a>.
          </p>
        </section>
      </div>
    </div>
  );
}
