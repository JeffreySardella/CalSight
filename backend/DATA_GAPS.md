# CalSight Data Gaps and Known Limitations

Last updated: 2026-04-16

This is the honest list of what's missing, what's incomplete, and what we know doesn't work perfectly. If you're building a frontend feature and wondering "can I do X with the data?" — check here first.

## Quick reference: what can this data actually do?

If you just need to know whether to build a feature, start here. Detail follows below.

| ✅ Safe to build | ⚠️ With caveats | ❌ Don't build |
|---|---|---|
| County-level crash trends (2001+) | Pin maps of crash locations (63% of crashes have no coords — biased sample) | Individual crash geocoding for the 63% missing lat/long |
| Per-capita / per-licensed-driver / per-road-mile rates | Driver demographic analysis (2016+ only — pre-2016 has no party data) | Race-of-driver analysis (CA doesn't collect it for crashes) |
| Severity breakdowns (fatal / injury / PDO) | Rural county trends before 2010 (small counties missing from ACS 1-yr) | Daily-weather-vs-crash correlation (weather is monthly-averaged) |
| Time-of-day patterns (pre-extracted `crash_hour`) | Education trends before 2012 (Census B15003 not published) | Intra-county weather variation (single number per county) |
| Alcohol / distraction flags (2016+) | "All crashes in CA" language (we only have police-reported ones) | Local-road traffic volume analysis (state highways only) |
| County demographic + economic context | State-wide totals (should be weighted by pop or driver count, not raw sums) | "Historical environmental burden" (CES is a single snapshot) |

## Classifying the gaps (and why this matters)

Missing data is not all the same. Following the standard framework from statistics:

- **MCAR (Missing Completely At Random):** missingness is unrelated to anything. Dropping rows is safe.
- **MAR (Missing At Random):** missingness depends on *other observed* variables (e.g., reporting agency). Dropping biases results but can be corrected by stratifying or reweighting.
- **MNAR (Missing Not At Random):** missingness depends on the unobserved value itself or the data-generating process. Hardest case — can't correct from data alone, must disclose and reason about bias.

Every gap below is labeled with its type. **None of our gaps are MCAR.** That means any "average" we show without context is misleading. This is why `data_quality_stats` exists and why the frontend should surface coverage on every metric.

## Crash records

**The big one: 63% of crashes don't have lat/long.** (**MAR** — missingness depends on reporting agency. Some county sheriffs geocode, some don't.) Both SWITRS and CCRS have this problem. We know the county for every crash so stats and charts work fine, but you can't put most of them on a map. Nothing we can do about it — that's how California reports the data. **Implication:** pin maps show a biased sample. Default to choropleth (county-shaded) maps; offer pin maps only as an explicit opt-in with a disclaimer.

**No person data before 2016.** (**MNAR** — SWITRS never collected it.) SWITRS (2001-2015) gives you the crash itself — when, where, what happened, how many killed/injured. But it doesn't tell you who was driving, their age, gender, whether they were drunk, any of that. The CCRS data starting 2016 has all of it. So any analysis about "who's crashing" is limited to the last 10 years. **Implication:** grey out driver-demographic charts for pre-2016; don't interpolate.

**The two systems don't fully match up.** SWITRS and CCRS use different field names and different codes for some things. We normalized what we could but there are differences:
- SWITRS doesn't have city names, just numeric codes
- SWITRS doesn't have day of week or freeway flags
- The collision type and primary factor vocabularies are slightly different between systems

**Some fields are frequently null even in CCRS:**
- Age and gender on parties/victims — often missing
- Sobriety — null doesn't mean sober, it means nobody recorded it
- Cell phone use — pulled from an unstructured text field, so it's hit or miss
- Vehicle year/make — a lot of nulls

## Demographics

**Education data missing for some years.** (**MNAR** — Census simply didn't publish it.) The Census Bureau didn't publish the B15003 table (educational attainment) in the ACS 5-year estimates before 2012, or in the 1-year estimates before 2008. So `pct_bachelors_or_higher` and `pct_high_school_or_higher` are null for those years. Everything else is filled in. **Implication:** show a shaded "not published by Census" band on time-series charts; don't draw a zero-value line.

**Small counties missing 2005-2009.** (**MAR** — missingness depends on observed population.) The ACS 1-year estimates only cover counties with 65K+ population. That's about 30 out of 58 counties. Starting in 2010 with the ACS 5-year, all 58 are covered. **Implication:** for 2005-2009 analyses, stratify by "big" vs "small" counties rather than averaging across all 58.

**No race/ethnicity at the crash level.** California's crash reporting system doesn't collect the race of people involved in crashes. We have race/ethnicity at the county level from Census, so you can look at county demographics alongside crash rates, but you can't say "this specific crash involved a Hispanic driver." That data just doesn't exist in the source.

## Vehicle registrations

**Had a bug that's now fixed.** The DMV changed a column name from `Zip Code` to `ZIP Code` between their 2023 and 2024 datasets. Our ETL was only looking for one spelling so 2019-2023 was only loading 1 county per year. Fixed now — all 58 counties load for all years.

**Zip-to-county mapping isn't perfect.** About 5% of California zip codes don't map cleanly to a county — PO boxes, military addresses, zips that span county lines. We use the Census crosswalk and pick the county with the most land area overlap. Close enough for our purposes but it means the county totals are approximate.

## Traffic and road data

**AADT only covers state highways.** Caltrans measures traffic on state-managed roads. Local roads, county roads, city streets — none of that is in there. And a lot of crashes happen on local roads. So the traffic volume numbers are incomplete.

**Speed limits same deal.** The FHWA HPMS data only has speed limits for federal-aid highways. Your neighborhood street isn't in there.

**Road miles are approximate.** The segment lengths are in Web Mercator projection which introduces like 2-5% distortion at California's latitude. For comparing counties against each other it's fine. Just don't treat the mileage as precise survey data.

## Weather

**Monthly county averages.** NOAA gives us monthly temperature and precipitation averaged across all weather stations in a county. That means:
- Can't see daily spikes (like "it rained hard on the day of the crash")
- Rural counties with fewer weather stations have less reliable averages
- A big county like San Bernardino has very different weather in the mountains vs the desert, but we just get one number

Good enough for trend analysis ("rainy months have more crashes") but not for individual crash analysis.

## CalEnviroScreen

**Single snapshot.** Version 4.0 is based on 2021 data. It's not a time series — we can't show how environmental burden changed over the years. When OEHHA releases version 5.0 we can update it but for now it's one point in time.

**County averages from tract data.** The raw data is at the census tract level (~8,000 tracts). We averaged up to 58 counties using population weighting. That hides a lot of variation within counties — LA County for example has tracts ranging from very low to very high environmental burden.

## Unemployment

**About 2 months behind.** BLS publishes county unemployment with a lag. So if it's April, the most recent data is probably February.

## What we don't have at all

Things that would be useful but we couldn't get:

- **Licensed driver demographics** — DMV publishes total counts by county but not broken down by age/gender. Would be great for calculating crash rates for young drivers vs old drivers but it's not available as data.
- **DUI arrest data** — CA DOJ has it on their OpenJustice portal but the download links are buried and the format is inconsistent. Could probably scrape it eventually.
- **Bike/pedestrian infrastructure** — no statewide dataset of protected bike lanes, crosswalks, etc. Every city tracks this differently.
- **Transit ridership** — each transit agency publishes their own data separately. No unified California dataset.
- **NHTSA FARS via API** — the federal fatal crash database. Their API blocks automated access (returns 403). But they do have bulk CSV downloads we could use if we wanted a second source of fatality data.
- **Road construction zones** — Caltrans has real-time data but no historical archive you can download.
- **Population density by census tract** — we have county-level density but not neighborhood-level. Would help with urban vs rural crash analysis.

## Unreported crashes

(**MNAR** — missingness is driven by the severity of the crash itself, which is exactly what we're analyzing. This is the most dangerous kind of gap.)

This is a big one that's easy to miss. Our 11.1 million crashes are only the ones that got a police report. A lot of crashes — probably the majority of minor ones — never get reported. NHTSA estimates that only about 50-60% of injury crashes and maybe 30% of property-damage-only crashes end up in official records. Fatal crashes are close to 100% reported because, well, somebody has to deal with that.

So the real number of crashes in California between 2001-2026 is probably 2-3x higher than what's in our database. And the underreporting rate isn't the same everywhere — it probably varies by county based on things like:

- **Income and insurance** — people without insurance are less likely to call police after a fender bender
- **Language barriers** — non-English speakers might not report, especially undocumented residents
- **Urban vs rural** — a parking lot scrape in LA probably doesn't get reported, but a crash on a rural highway almost always does
- **Crash severity** — minor property damage gets skipped way more than injuries

We don't have a dataset that tells us the reporting rate by county. The closest thing would be comparing hospital ER visits for crash injuries (from HCAI) against injury crashes in our data — the gap is your underreporting estimate. But HCAI data requires a formal data request, it's not on a public API.

What we CAN do is be upfront about this on the site: "This data shows police-reported crashes only. The actual number of crashes is likely 2-3x higher, with minor incidents being the most underreported."

## The bottom line

We're at maybe 60-70% of what an ideal traffic safety platform would have. The big gaps are the missing crash coordinates (63%), no person data before 2016, and the fact that traffic/road data only covers state highways. Everything else is pretty solid — 17 data sources, 25M+ rows, all from official government sources.

For the frontend, the data supports:
- County-level dashboards with crash trends, demographics, and economic context
- Crash severity analysis (killed/injured by cause, time, location)
- Equity analysis (CalEnviroScreen scores vs crash rates)
- Driver demographic analysis (age, gender, sobriety — 2016+ only)
- Rate calculations (per capita, per licensed driver, per road mile, per registered vehicle)
- Economic correlation (unemployment, income, poverty vs crash outcomes)
