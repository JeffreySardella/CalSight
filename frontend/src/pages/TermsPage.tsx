import JargonTerm from "../components/ui/JargonTerm";

export default function TermsPage() {
  return (
    <div className="max-w-[700px] mx-auto px-6 pt-16 pb-24">
      <h1 className="font-headline text-3xl font-extrabold tracking-tighter text-on-surface mb-2">
        Terms of Service
      </h1>
      <p className="text-xs text-on-surface-variant mb-8">Last updated: July 10, 2026</p>

      <div className="space-y-8 text-on-surface-variant text-sm leading-relaxed">
        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">Overview</h2>
          <p>
            CalSight is a free, open-source tool for exploring California traffic crash data,
            operated as a volunteer civic-technology project. By using this site, you agree to
            these terms. They are written in plain English on purpose — there is no account to
            create, nothing to buy, and no data of yours that we want.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">Data Is Provided As-Is</h2>
          <p>
            All crash data shown here comes from publicly available government sources, primarily
            the California Highway Patrol&apos;s{" "}
            <JargonTerm term="SWITRS">SWITRS</JargonTerm> and{" "}
            <JargonTerm term="CCRS">CCRS</JargonTerm> systems, along with other public state and
            federal datasets. We process and visualize this data but we did not create it, and we
            cannot guarantee it is complete, current, or error-free. Source data contains known
            gaps and reporting biases — see the About page for a candid list of limitations. Do
            not rely on this site as the sole basis for safety, legal, financial, or policy
            decisions.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">AI-Generated Content</h2>
          <p>
            The Ask AI feature and AI-generated insights use large language models to summarize
            crash statistics. AI-generated text can be inaccurate, incomplete, or misleading, even
            when it sounds confident. It is provided for general information only and is not
            professional, legal, medical, engineering, or safety advice. Always verify important
            figures against the underlying charts and official sources before acting on them.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">No Affiliation with Government Agencies</h2>
          <p>
            CalSight is an independent project. It is not affiliated with, endorsed by, or
            operated by the California Highway Patrol (CHP), Caltrans, the DMV, or any other
            agency of the State of California or the federal government. References to those
            agencies describe where the data comes from, nothing more.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">Acceptable Use</h2>
          <p className="mb-3">
            This is a shared, donated resource. Please don&apos;t break it for everyone else. You
            agree not to:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Scrape or bulk-download through the site&apos;s API in ways that degrade service for others — the underlying datasets are freely available from the source agencies, so get them there instead</li>
            <li>Circumvent rate limits or attempt to disrupt, overload, or probe the service</li>
            <li>Use the Ask AI feature to attempt to extract, manipulate, or abuse the underlying AI systems</li>
            <li>Misrepresent CalSight output as official government data or as your own work product</li>
            <li>Use the site for any unlawful purpose</li>
          </ul>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">No Warranty</h2>
          <p>
            The site and its data are provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo;
            without warranties of any kind, express or implied — including accuracy, reliability,
            fitness for a particular purpose, and uninterrupted availability. This is a volunteer
            project; the site may change, break, or go offline at any time without notice.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by law, the volunteers who build and operate CalSight
            are not liable for any damages arising from your use of (or inability to use) the site,
            its data, or its AI-generated content. Your sole remedy for dissatisfaction with the
            site is to stop using it.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">Privacy</h2>
          <p>
            We collect as close to nothing as we can manage. See the{" "}
            <a href="/privacy" className="text-primary underline">Privacy Policy</a> for the full
            details, including how the Ask AI feature handles your questions.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">Changes to These Terms</h2>
          <p>
            If we make material changes to these terms, we will update the &ldquo;Last
            updated&rdquo; date at the top of this page. Since CalSight has no accounts or email
            collection, we cannot notify users directly — please check back periodically.
            Continued use of the site after changes means you accept the updated terms.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">Contact</h2>
          <p>
            Questions about these terms? Reach out via the{" "}
            <a href="https://github.com/JeffreySardella/CalSight" className="text-primary underline" target="_blank" rel="noopener noreferrer">
              CalSight GitHub repository
            </a>.
          </p>
        </section>
      </div>
    </div>
  );
}
