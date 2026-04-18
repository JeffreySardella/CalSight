# CalSight Data Validation Report

Last checked: 2026-04-15

So this is basically a rundown of what's actually in the database right now, with some spot checks to make sure the numbers aren't crazy. We pull from 17 different government data sources and if you're looking at this page on the site, this is where all those numbers come from.

## What we have

| # | Source | Table | Rows | Years | Where it comes from |
|---|--------|-------|------|-------|---------------------|
| 1 | SWITRS crashes | crashes | 6,779,445 | 2001-2015 | CHP / UC Berkeley |
| 2 | CCRS crashes | crashes | 4,350,202 | 2016-2026 | CHP via data.ca.gov |
| 3 | Crash parties | crash_parties | 8,802,294 | 2016-2026 | CHP via data.ca.gov |
| 4 | Crash victims | crash_victims | 5,299,270 | 2016-2026 | CHP via data.ca.gov |
| 5 | Census demographics | demographics | 1,012 | 2005-2022 | US Census Bureau ACS |
| 6 | Weather | weather | 17,315 | 2001-2025 | NOAA Climate Data Online |
| 7 | Traffic volumes | traffic_volumes | 58 | Current | Caltrans |
| 8 | Vehicle registrations | vehicle_registrations | 464 | 2019-2026 | CA DMV via data.ca.gov |
| 9 | Schools | school_locations | 9,932 | 2024-25 | CA Dept of Education |
| 10 | Hospitals | hospitals | 560 | Current | CA HCAI via data.ca.gov |
| 11 | Speed limits | speed_limits | 171 | 2022 | FHWA HPMS |
| 12 | Unemployment | unemployment_rates | 14,558 | 2005-2025 | Bureau of Labor Statistics |
| 13 | CalEnviroScreen | calenviroscreen | 58 | 2021 | CA OEHHA |
| 14 | Licensed drivers | licensed_drivers | 969 | 2008-2024 | CA DMV via data.ca.gov |
| 15 | Road miles | road_miles | 355 | Current | Caltrans via data.ca.gov |

That's about **25.3 million rows** total.

## Crash data

11,129,647 crashes going back to 2001. The older stuff (SWITRS, 2001-2015) is more bare bones — you get the crash itself but not who was involved. Starting in 2016 with CCRS we get the driver/pedestrian/cyclist details per crash, which is where the age, gender, sobriety, and cell phone data comes from.

Only about 37% of crashes have lat/long coordinates. The rest we know the county for but can't pin on a map. Kind of a pain but it's a limitation of how California reports the data.

For the 2016+ crashes we also flagged:
- **388K crashes as alcohol or drug involved** — that's 8.9% which lines up with what NHTSA reports nationally
- **110K crashes as distraction involved** (cell phone use) — 2.5%, also in line with national numbers

Every crash also has:
- **crash_hour** (0-23) — pre-extracted from the datetime so time-of-day charts are fast
- **severity** — pre-computed as 'Fatal', 'Injury', or 'Property Damage Only' so the filter panel doesn't have to do math on every query

Top 5 counties for crashes all time: LA (3.3M), Orange (854K), San Bernardino (684K), San Diego (637K), Riverside (612K). No surprises there.

## Demographics spot checks

We pull 28 fields per county per year from the Census. Here's what a few counties look like for 2022 to make sure the data makes sense:

**Los Angeles County** — Pop 9.9M, density 2,449/sq mi, median income $83K. Race: 25% White, 49% Hispanic, 15% Asian, 8% Black. Poverty at 13.7%, 8.7% of households have no vehicle, 38% speak Spanish at home. 80% have a high school diploma, 35% have a bachelor's or higher.

**San Francisco** — Pop 851K, density 18,107/sq mi, income $137K. 30% of households don't have a car which makes sense for SF. 60% have a bachelor's degree. 35% Asian, 38% White.

**Imperial County** — Pop 180K, density 43/sq mi, income $54K. 85% Hispanic, 21% poverty rate, 72% high school diploma rate. This is the agricultural border county so those numbers check out.

**Alpine County** — Pop 1,515, density 2/sq mi. Smallest county in the state. Income $101K which sounds high but it's basically a ski/vacation area with very few people.

All of that looks right.

Not everything is filled in for every year though. Education data (bachelor's rate, high school rate) is only available starting 2012 for the ACS 5-year estimates. And for 2005-2009 we only have data for the bigger counties because the Census 1-year estimates don't cover counties under 65K population.

## Unemployment

Monthly rates for all 58 counties, 2005 through March 2025. The COVID spike shows up clearly — statewide average hit 16.9% in April 2020, now back down to about 6.6%.

## CalEnviroScreen

Environmental justice scores for all 58 counties. We pulled 8,035 census tracts from OEHHA and averaged them up to county level weighted by population. Merced County has the highest score (44.4, lots of agricultural pollution and 46% poverty). Marin has the lowest (10.2). That tracks.

## Vehicle registrations

All 58 counties, 2019-2026. You can see California's EV push working:
- 2019: 1.4% EV
- 2022: 2.7% EV
- 2025: 6.2% EV

About 30 million registered vehicles statewide give or take.

## What we know is missing or incomplete

Being upfront about this:

- **63% of crashes don't have coordinates** — we know the county but can't map the exact spot
- **No person-level data before 2016** — the 6.8M SWITRS crashes just have the crash itself, not who was driving
- **Education data has gaps pre-2012** — Census didn't publish the B15003 table in early ACS 5-year releases
- **Small rural counties missing pre-2010** — ACS 1-year only covers counties over 65K population
- **Traffic volumes and speed limits only cover state highways** — local roads aren't in there
- **CalEnviroScreen is one snapshot** (version 4.0, based on 2021 data) — not a time series
- **Weather is monthly county averages** — doesn't capture daily variation or local differences within a county

More detail in `DATA_GAPS.md` if you want the full list.

## How to refresh the data

Everything runs through `run_all_etl.sh` in the backend directory. Each script is safe to re-run — it'll update existing rows and add new ones without creating duplicates.

| Source | How often it updates | Command |
|--------|---------------------|---------|
| Crashes | As CHP publishes new CCRS data | `python -m etl.load_crashes` |
| Demographics | Annual (Census has a 1-2 year lag) | `python -m etl.load_demographics` |
| Unemployment | Monthly (BLS lags about 2 months) | `python -m etl.bls_unemployment` |
| Vehicle registrations | Annual | `python -m etl.dmv_vehicles` |
| Weather | Monthly | `python -m etl.noaa_weather` |
| CalEnviroScreen | Whenever OEHHA puts out a new version | `python -m etl.load_calenviroscreen` |
| Everything at once | — | `bash run_all_etl.sh` |
