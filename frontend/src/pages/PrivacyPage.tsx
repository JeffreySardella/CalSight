export default function PrivacyPage() {
  return (
    <div className="max-w-[700px] mx-auto px-6 pt-16 pb-24">
      <h1 className="font-headline text-3xl font-extrabold tracking-tighter text-on-surface mb-8">
        Privacy Policy
      </h1>

      <div className="space-y-8 text-on-surface-variant text-sm leading-relaxed">
        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">Ask AI Feature</h2>
          <p>
            When you use the Ask AI feature, your question is sent to a third-party AI provider
            to generate a response. CalSight does not store your questions or conversations on our servers
            — chat history exists only in your browser's session storage and is cleared when you close the tab.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">What We Send</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Your question (plain text, maximum 500 characters)</li>
            <li>Recent conversation context (last 5 exchanges) for follow-up understanding</li>
            <li>Crash statistics from our database (public California state data, not user data)</li>
          </ul>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">What We Do NOT Send</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Your IP address or location</li>
            <li>Any personally identifiable information</li>
            <li>Your filter selections (these query our database locally — only the resulting statistics are sent)</li>
          </ul>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">AI Providers</h2>
          <p className="mb-3">CalSight uses the following AI providers to generate responses:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong>Groq</strong> — Does not use API inputs for model training.{" "}
              <a href="https://groq.com/privacy-policy/" className="text-primary underline" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
            </li>
            <li>
              <strong>Cerebras</strong> — Does not use API inputs for model training.{" "}
              <a href="https://cerebras.ai/privacy-policy" className="text-primary underline" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
            </li>
            <li>
              <strong>Google Gemini</strong> (free tier) — May use inputs to improve products.{" "}
              <a href="https://ai.google.dev/gemini-api/terms" className="text-primary underline" target="_blank" rel="noopener noreferrer">Terms of Service</a>
            </li>
            <li>
              <strong>OpenRouter</strong> — Privacy depends on the backing model provider.{" "}
              <a href="https://openrouter.ai/privacy" className="text-primary underline" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-2">Data Sources</h2>
          <p>
            All crash data displayed on CalSight is sourced from publicly available California state datasets
            (CCRS, SWITRS, Census ACS, NOAA, BLS, Caltrans, DMV). No private or proprietary data is used.
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
