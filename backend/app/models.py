from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)

from app.database import Base


class County(Base):
    """California county lookup table — 58 counties."""

    __tablename__ = "counties"

    code = Column(SmallInteger, primary_key=True)
    name = Column(String(50), nullable=False, unique=True)
    fips = Column(String(5))
    latitude = Column(Float)
    longitude = Column(Float)
    population = Column(Integer)
    land_area_sq_miles = Column(Float)  # square miles of land (no water). Used to calculate population density.
    geojson = Column(Text)


class Crash(Base):
    """
    One row per crash from CCRS data.
    Subset of fields relevant to the dashboard — we skip admin/internal columns.
    """

    __tablename__ = "crashes"

    id = Column(BigInteger, primary_key=True)
    collision_id = Column(BigInteger, nullable=False)
    crash_datetime = Column(DateTime, nullable=False)
    day_of_week = Column(String(10))
    county_code = Column(
        SmallInteger, ForeignKey("counties.code"), nullable=False
    )
    city_name = Column(String(100))
    latitude = Column(Float)
    longitude = Column(Float)

    # What happened
    collision_type = Column(String(100))
    primary_factor = Column(String(100))
    motor_vehicle_involved_with = Column(String(100))

    # Severity
    number_killed = Column(SmallInteger, default=0)
    number_injured = Column(SmallInteger, default=0)

    # Conditions
    weather = Column(String(100))
    road_condition = Column(String(100))
    lighting = Column(String(100))

    # Road info
    is_highway = Column(Boolean, default=False)
    is_freeway = Column(Boolean, default=False)
    primary_road = Column(String(100))
    secondary_road = Column(String(100))

    # Hit and run — null = no, "M" = misdemeanor, "F" = felony
    hit_run = Column(String(1))

    # Pre-extracted from crash_datetime so we don't have to do
    # EXTRACT(HOUR FROM crash_datetime) on 11M rows for time-of-day charts.
    crash_hour = Column(SmallInteger)      # 0-23

    # Pre-computed from number_killed and number_injured so the filter
    # panel can just do WHERE severity = 'Fatal' instead of math.
    # Values: 'Fatal', 'Severe Injury', 'Minor Injury', 'Property Damage Only'
    severity = Column(String(25))

    # Pedestrian
    pedestrian_involved = Column(Boolean, default=False)

    # These two flags are set by the backfill script (etl/backfill_derived.py).
    # They look at the crash_parties table and check if ANY person involved
    # in the crash was drunk/on drugs or using a phone. That way the frontend
    # can filter on these without joining to the 8.8M row parties table.
    # Only set for CCRS crashes (2016+) — SWITRS has no party data so these
    # stay null for pre-2016 crashes.
    is_alcohol_involved = Column(Boolean)     # True if any party was HBD or on drugs
    is_distraction_involved = Column(Boolean) # True if any party was on their phone

    # Data provenance — which source this record came from
    data_source = Column(String(10))  # "switrs" or "ccrs"

    # Simplified cause category derived from primary_factor. The raw field has
    # 12,517 distinct values (mix of English and CA Vehicle Code numbers);
    # this collapses to a small fixed vocabulary for fast API filtering.
    # Values: 'speeding', 'dui', 'lane_change', 'other', or NULL when
    # primary_factor itself was NULL. Populated by etl.backfill_derived.
    canonical_cause = Column(String(20))

    # Denormalized from counties.name so dashboard tooltip/export queries
    # don't need to JOIN to counties. County names are effectively immutable
    # in CA — a rerun of backfill_derived re-syncs if that ever changes.
    county_name = Column(String(50))

    # Pre-extracted from crash_datetime, same pattern as crash_hour.
    # Year is in ~80% of dashboard filters; indexed integer compare beats
    # EXTRACT(year FROM crash_datetime) on 11M rows.
    crash_year = Column(SmallInteger)

    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("collision_id", "data_source", name="uq_crashes_collision_source"),
        Index("ix_crashes_county_code", "county_code"),
        Index("ix_crashes_crash_datetime", "crash_datetime"),
        Index("ix_crashes_primary_factor", "primary_factor"),
        Index("ix_crashes_county_datetime", "county_code", "crash_datetime"),
    )


class CrashParty(Base):
    """One row per party (driver/pedestrian/cyclist) involved in a crash.

    Links to crashes via collision_id. Contains demographic info (age, gender),
    sobriety status, vehicle details, and fault determination.

    Source: CCRS Parties table on data.ca.gov.
    """

    __tablename__ = "crash_parties"

    id = Column(BigInteger, primary_key=True)
    party_id = Column(BigInteger, nullable=False)
    collision_id = Column(BigInteger, nullable=False)
    party_number = Column(SmallInteger)
    party_type = Column(String(30))        # Driver, Pedestrian, Bicyclist, etc.
    at_fault = Column(Boolean)
    gender = Column(String(1))             # M, F, U
    age = Column(SmallInteger)
    sobriety = Column(String(100))         # HBD, impaired, not impaired, etc.
    vehicle_type = Column(String(100))
    vehicle_year = Column(SmallInteger)
    vehicle_make = Column(String(50))
    speed_limit = Column(SmallInteger)     # posted speed at party location
    movement = Column(String(100))         # proceeding straight, turning, etc.
    safety_equipment = Column(String(100)) # seatbelt, helmet, none, etc.
    cell_phone_use = Column(String(50))    # in use, not in use, etc.
    data_source = Column(String(10))       # "ccrs"
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("party_id", "data_source", name="uq_parties_party_source"),
        Index("ix_crash_parties_collision_id", "collision_id"),
        Index("ix_crash_parties_gender", "gender"),
        Index("ix_crash_parties_at_fault", "at_fault"),
    )


class CrashVictim(Base):
    """One row per injured person, witness, or passenger in a crash.

    Links to crashes via collision_id. Contains injury severity, demographics,
    safety equipment, and ejection status.

    Source: CCRS InjuredWitnessPassengers table on data.ca.gov.
    """

    __tablename__ = "crash_victims"

    id = Column(BigInteger, primary_key=True)
    victim_id = Column(BigInteger, nullable=False)
    collision_id = Column(BigInteger, nullable=False)
    party_number = Column(SmallInteger)
    age = Column(SmallInteger)
    gender = Column(String(1))             # M, F, U
    injury_severity = Column(String(50))   # Fatal, Severe, Possible, etc.
    person_type = Column(String(30))       # Driver, Passenger, Pedestrian, etc.
    seat_position = Column(String(50))
    safety_equipment = Column(String(100))
    ejected = Column(String(30))           # NotEjected, FullyEjected, etc.
    data_source = Column(String(10))       # "ccrs"
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("victim_id", "data_source", name="uq_victims_victim_source"),
        Index("ix_crash_victims_collision_id", "collision_id"),
        Index("ix_crash_victims_injury_severity", "injury_severity"),
        Index("ix_crash_victims_gender", "gender"),
    )


class Demographic(Base):
    """Census data for each county for each year.

    One row per county per year (e.g., LA County 2022). Has 28 fields
    covering population, income, race/ethnicity, age brackets, poverty,
    education, vehicle ownership, housing, and language. All from the
    Census Bureau's American Community Survey (ACS).

    We use the ACS 5-year estimates for 2010+ (covers all 58 counties)
    and 1-year estimates for 2005-2009 (only covers counties over 65K
    population, so smaller rural counties are missing for those years).

    Education fields (pct_bachelors_or_higher, pct_high_school_or_higher)
    are null for some early years because the Census didn't publish the
    B15003 table until 2012 in the 5-year data.

    population_density is derived — we calculate it from population
    divided by the county's land area (stored in the counties table).
    """

    __tablename__ = "demographics"

    id = Column(Integer, primary_key=True)
    county_code = Column(
        SmallInteger, ForeignKey("counties.code"), nullable=False
    )
    year = Column(SmallInteger, nullable=False)
    population = Column(Integer)
    median_age = Column(Float)
    median_income = Column(Integer)
    commute_drive_alone_pct = Column(Float)
    commute_carpool_pct = Column(Float)
    commute_transit_pct = Column(Float)
    commute_walk_pct = Column(Float)
    commute_bike_pct = Column(Float)
    commute_wfh_pct = Column(Float)

    # Race/Ethnicity — from Census table B03002 (Hispanic/Latino by Race).
    # These should add up to ~100% for each county. "Other" is everyone
    # not in the four main groups (Native American, Pacific Islander,
    # multiracial, etc.)
    pct_white = Column(Float)              # White alone, not Hispanic
    pct_black = Column(Float)              # Black alone, not Hispanic
    pct_asian = Column(Float)              # Asian alone, not Hispanic
    pct_hispanic = Column(Float)           # Hispanic/Latino, any race
    pct_other_race = Column(Float)         # everyone else combined

    # Age distribution — from Census table B01001. We sum up 47 individual
    # age cells (male + female) into 5 brackets that matter for traffic safety.
    # Young adults (18-24) have the highest crash risk, elderly (65+) are
    # most vulnerable as pedestrians.
    pct_under_18 = Column(Float)           # kids
    pct_18_24 = Column(Float)              # young adults — highest crash risk group
    pct_25_44 = Column(Float)              # prime working age
    pct_45_64 = Column(Float)              # middle age
    pct_65_plus = Column(Float)            # elderly — most vulnerable as pedestrians

    # Socioeconomic — poverty is from B17001, education from B15003.
    # Education is null for some years because the Census didn't publish
    # B15003 until 2012 in the ACS 5-year data.
    poverty_rate = Column(Float)           # % of people below the poverty line
    pct_bachelors_or_higher = Column(Float)  # % of people 25+ with a bachelor's degree or more
    pct_high_school_or_higher = Column(Float)  # % of people 25+ who at least finished high school

    # Transportation / Housing — these help explain crash patterns.
    # Counties where a lot of people don't have cars might have more
    # pedestrian crashes. Owner vs renter is a socioeconomic signal.
    pct_no_vehicle = Column(Float)         # % of households with zero cars (B08201)
    pct_owner_occupied_housing = Column(Float)  # % of housing that's owner-occupied vs rental (B25003)

    # Language — from Census table B16001. Matters for traffic safety
    # because non-English speakers might not understand road signs or
    # safety campaigns.
    pct_english_only = Column(Float)       # % who only speak English at home
    pct_spanish_speaking = Column(Float)   # % who speak Spanish at home

    # Derived field — we calculate this ourselves by dividing population
    # by the county's land area (from the counties table). Ranges from
    # ~2 people/sq mi (Alpine) to ~18,000 (San Francisco).
    population_density = Column(Float)

    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("county_code", "year"),
        Index("ix_demographics_year", "year"),
    )


class CountyInsight(Base):
    """Pre-computed summary stats and AI narrative per county per year."""

    __tablename__ = "county_insights"

    id = Column(Integer, primary_key=True)
    county_code = Column(
        SmallInteger, ForeignKey("counties.code"), nullable=False
    )
    year = Column(SmallInteger, nullable=False)
    total_crashes = Column(Integer)
    total_killed = Column(SmallInteger)
    total_injured = Column(Integer)
    crash_rate_per_capita = Column(Float)
    top_cause = Column(String(100))
    top_cause_pct = Column(Float)
    yoy_change_pct = Column(Float)
    peak_hour = Column(SmallInteger)
    dui_pct = Column(Float)
    narrative = Column(Text)
    generated_at = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (UniqueConstraint("county_code", "year"),)


class CountyInsightDetail(Base):
    """Granular breakdowns per county/year by category (collision type, cause, etc.)."""

    __tablename__ = "county_insight_details"

    id = Column(Integer, primary_key=True)
    county_code = Column(
        SmallInteger, ForeignKey("counties.code"), nullable=False
    )
    year = Column(SmallInteger, nullable=False)
    category = Column(String(30), nullable=False)
    label = Column(String(100), nullable=False)
    count = Column(Integer)
    pct_of_total = Column(Float)
    yoy_change_pct = Column(Float)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("county_code", "year", "category", "label"),
    )


class Weather(Base):
    """Monthly weather summary per county.

    Aggregated from NOAA GSOM (Global Summary of the Month) data across
    all weather stations in each county. Enables weather-vs-crash correlation.

    Source: NOAA Climate Data Online API (ncei.noaa.gov/cdo-web).
    """

    __tablename__ = "weather"

    id = Column(Integer, primary_key=True)
    county_code = Column(
        SmallInteger, ForeignKey("counties.code"), nullable=False
    )
    year = Column(SmallInteger, nullable=False)
    month = Column(SmallInteger, nullable=False)  # 1-12
    avg_temp_f = Column(Float)         # average temperature (°F)
    max_temp_f = Column(Float)         # average of daily max temps (°F)
    min_temp_f = Column(Float)         # average of daily min temps (°F)
    precipitation_in = Column(Float)   # total precipitation (inches)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("county_code", "year", "month"),
        Index("ix_weather_county_year", "county_code", "year"),
    )


class SpeedLimit(Base):
    """Posted speed limits aggregated per county.

    Aggregated from FHWA HPMS (Highway Performance Monitoring System)
    road segment data. Stores the distribution of speed limits and
    lane counts per county for crash-severity correlation analysis.

    Source: FHWA HPMS via geo.dot.gov ArcGIS FeatureServer.
    """

    __tablename__ = "speed_limits"

    id = Column(Integer, primary_key=True)
    county_code = Column(
        SmallInteger, ForeignKey("counties.code"), nullable=False
    )
    speed_limit = Column(SmallInteger, nullable=False)  # posted mph
    segment_count = Column(Integer)         # number of road segments
    avg_lanes = Column(Float)               # average through-lanes
    total_aadt = Column(Integer)            # total traffic volume
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("county_code", "speed_limit"),
        Index("ix_speed_limits_county", "county_code"),
    )


class Hospital(Base):
    """California hospital and trauma center locations.

    Enables crash severity analysis: distance to nearest trauma center,
    coverage gaps, and correlation between proximity and fatality rates.

    Source: CA HCAI "Licensed and Certified Healthcare Facility Listing"
    on data.ca.gov.
    """

    __tablename__ = "hospitals"

    id = Column(Integer, primary_key=True)
    facility_id = Column(String(20), nullable=False, unique=True)
    facility_name = Column(String(200), nullable=False)
    facility_type = Column(String(100))    # General Acute Care Hospital, etc.
    county_code = Column(
        SmallInteger, ForeignKey("counties.code"), nullable=False
    )
    city = Column(String(100))
    address = Column(String(200))
    latitude = Column(Float)
    longitude = Column(Float)
    bed_capacity = Column(Integer)
    trauma_center = Column(String(50))      # Level I, II, III, etc. or null
    trauma_pediatric = Column(String(50))   # Pediatric trauma level or null
    status = Column(String(20))             # OPEN, CLOSED
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("ix_hospitals_county", "county_code"),
    )


class VehicleRegistration(Base):
    """Registered vehicles per county per year.

    Aggregated from DMV zip-code-level data. Enables calculating crash
    rates per registered vehicle — a better safety metric than raw counts.

    Source: CA DMV "Vehicle Fuel Type Count by Zip Code" on data.ca.gov.
    """

    __tablename__ = "vehicle_registrations"

    id = Column(Integer, primary_key=True)
    county_code = Column(
        SmallInteger, ForeignKey("counties.code"), nullable=False
    )
    year = Column(SmallInteger, nullable=False)
    total_vehicles = Column(Integer)
    ev_vehicles = Column(Integer)      # battery electric + plug-in hybrid
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("county_code", "year"),
        Index("ix_vehicle_registrations_county_year", "county_code", "year"),
    )


class SchoolLocation(Base):
    """California public school locations.

    Point locations for K-12 public schools. Enables "crashes near schools"
    analysis and school-zone safety metrics.

    Source: CA Dept of Education via data.ca.gov.
    """

    __tablename__ = "school_locations"

    id = Column(Integer, primary_key=True)
    cds_code = Column(String(14), nullable=False, unique=True)  # County-District-School code
    school_name = Column(String(200), nullable=False)
    county_code = Column(
        SmallInteger, ForeignKey("counties.code"), nullable=False
    )
    city = Column(String(100))
    latitude = Column(Float)
    longitude = Column(Float)
    school_type = Column(String(50))   # Elementary, Middle, High, etc.
    status = Column(String(20))        # Active, Closed, etc.
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("ix_school_locations_county", "county_code"),
    )


class TrafficVolume(Base):
    """Annual Average Daily Traffic (AADT) per county.

    Aggregated from Caltrans road-segment data. AADT is the total volume
    of traffic on state highways in a county, summed across all measured
    segments. This enables crash-rate-per-traffic-volume analysis.

    Source: Caltrans Traffic Census Program via ArcGIS FeatureServer.
    """

    __tablename__ = "traffic_volumes"

    id = Column(Integer, primary_key=True)
    county_code = Column(
        SmallInteger, ForeignKey("counties.code"), nullable=False
    )
    total_aadt = Column(Integer)          # sum of AADT across all segments
    segment_count = Column(SmallInteger)  # how many road segments measured
    avg_aadt_per_segment = Column(Integer)  # total_aadt / segment_count
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("county_code"),
        Index("ix_traffic_volumes_county_code", "county_code"),
    )


class UnemploymentRate(Base):
    """Monthly unemployment rate for each county.

    Comes from the Bureau of Labor Statistics (BLS). They track this for
    every US county going back to the 90s. We pull 2005-2025 which gives
    us monthly rates we can line up with crash data.

    Good for stuff like "did crash rates go up during COVID when
    unemployment spiked?" (spoiler: they went down because nobody was
    driving, even though unemployment hit 17%).

    Free API, just needs a key from https://www.bls.gov/developers/
    """

    __tablename__ = "unemployment_rates"

    id = Column(Integer, primary_key=True)
    county_code = Column(
        SmallInteger, ForeignKey("counties.code"), nullable=False
    )
    year = Column(SmallInteger, nullable=False)
    month = Column(SmallInteger, nullable=False)  # 1-12
    unemployment_rate = Column(Float)  # percentage, e.g. 4.5
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("county_code", "year", "month"),
        Index("ix_unemployment_rates_county_year", "county_code", "year"),
    )


class CalenviroScreen(Base):
    """CalEnviroScreen 4.0 — California's environmental justice scores.

    OEHHA (Office of Environmental Health Hazard Assessment) scores every
    census tract in California based on pollution exposure and population
    vulnerability. Higher score = more burdened community.

    The raw data is at the census tract level (~8,000 tracts) but we
    average it up to county level using population weighting. So this
    table has one row per county with averaged scores.

    Good for equity analysis — "do high-pollution, high-poverty counties
    also have worse crash outcomes?" Merced County has the highest score
    (lots of agricultural pollution + 46% poverty). Marin has the lowest.
    """

    __tablename__ = "calenviroscreen"

    id = Column(Integer, primary_key=True)
    county_code = Column(
        SmallInteger, ForeignKey("counties.code"), nullable=False, unique=True
    )
    ces_score = Column(Float)              # overall CES 4.0 score
    ces_percentile = Column(Float)         # overall percentile (0-100)
    pollution_burden = Column(Float)       # pollution burden score
    pop_characteristics = Column(Float)    # population characteristics score

    # Key pollution indicators
    pm25_score = Column(Float)             # particulate matter 2.5
    ozone_score = Column(Float)
    diesel_pm_score = Column(Float)        # diesel particulate matter
    pesticide_score = Column(Float)
    traffic_score = Column(Float)          # traffic proximity & volume

    # Key socioeconomic indicators
    poverty_pct = Column(Float)
    unemployment_pct = Column(Float)
    education_pct = Column(Float)          # % without HS diploma
    linguistic_isolation_pct = Column(Float)
    housing_burden_pct = Column(Float)

    # Aggregation metadata
    tract_count = Column(SmallInteger)     # how many tracts in county
    total_population = Column(Integer)     # total pop used for weighting
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("ix_calenviroscreen_county", "county_code"),
    )


class DataQualityStat(Base):
    """Pre-computed data quality stats so the frontend can show them fast.

    Instead of counting 11M crash rows every time someone loads a page,
    we pre-compute stuff like "what % of crashes have lat/long" per county
    and per year. The frontend can just grab these numbers and show them
    as disclaimers on maps and charts.

    Gets refreshed by the backfill script after crash data loads. The
    table is small — one row per (county, year) combo, plus rows where
    county_code is null (year-level stats) and where year is null
    (county-level stats).
    """

    __tablename__ = "data_quality_stats"

    id = Column(Integer, primary_key=True)
    county_code = Column(SmallInteger, ForeignKey("counties.code"), nullable=True)
    year = Column(SmallInteger, nullable=True)

    # --- Crash-level fill rates ---
    total_crashes = Column(Integer)

    # Coordinates — "what % can we put on a map?"
    crashes_with_coords = Column(Integer)
    coords_pct = Column(Float)

    # Cause — "what % have a known cause?"
    crashes_with_primary_factor = Column(Integer)
    primary_factor_pct = Column(Float)

    # Weather/road/lighting — conditions at time of crash
    crashes_with_weather = Column(Integer)
    weather_pct = Column(Float)
    crashes_with_road_cond = Column(Integer)
    road_cond_pct = Column(Float)
    crashes_with_lighting = Column(Integer)
    lighting_pct = Column(Float)

    # Alcohol/distraction flags (only CCRS 2016+, null for SWITRS)
    crashes_with_alcohol_flag = Column(Integer)   # not-null (TRUE or FALSE)
    alcohol_flag_pct = Column(Float)
    crashes_alcohol_true = Column(Integer)         # just the TRUE ones
    alcohol_true_pct = Column(Float)

    crashes_with_distraction_flag = Column(Integer)
    distraction_flag_pct = Column(Float)
    crashes_distraction_true = Column(Integer)
    distraction_true_pct = Column(Float)

    # --- Party-level fill rates (2016+ only) ---
    total_parties = Column(Integer)

    parties_with_age = Column(Integer)
    age_pct = Column(Float)
    parties_with_gender = Column(Integer)
    gender_pct = Column(Float)
    parties_with_sobriety = Column(Integer)
    sobriety_pct = Column(Float)

    # --- Victim-level fill rates (2016+ only) ---
    total_victims = Column(Integer)
    victims_with_injury_severity = Column(Integer)
    injury_severity_pct = Column(Float)

    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("county_code", "year"),
        Index("ix_data_quality_stats_county", "county_code"),
        Index("ix_data_quality_stats_year", "year"),
    )


class LicensedDriver(Base):
    """How many people have a driver's license in each county each year.

    This is important because it lets us calculate "crashes per 10K
    licensed drivers" which is how NHTSA and most safety organizations
    report crash rates. Without this, you can only do crashes per capita
    which includes babies, people who don't drive, etc.

    About 28 million licensed drivers statewide as of 2024.

    Source: CA DMV "Driver Licenses Outstanding by County" on data.ca.gov.
    The dataset is just one spreadsheet with year columns that we pivot
    into rows.
    """

    __tablename__ = "licensed_drivers"

    id = Column(Integer, primary_key=True)
    county_code = Column(
        SmallInteger, ForeignKey("counties.code"), nullable=False
    )
    year = Column(SmallInteger, nullable=False)
    driver_count = Column(Integer)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("county_code", "year"),
        Index("ix_licensed_drivers_county_year", "county_code", "year"),
    )


class RoadMile(Base):
    """How many miles of road are in each county, broken out by road type.

    This lets us calculate stuff like "crashes per 100 miles of road"
    which is another way to normalize crash rates. A county with more
    roads should have more crashes just by having more road, so you
    need to adjust for that.

    Each row is one county + one road type. The road types use the FHWA
    functional classification system:
      1 = Interstate (like I-5)
      2 = Freeway/Expressway
      3 = Principal Arterial (big city streets)
      4 = Minor Arterial
      5 = Major Collector
      6 = Minor Collector
      7 = Local (neighborhood streets)

    Source: Caltrans road data on data.ca.gov, aggregated from ~780K
    individual road segments.
    """

    __tablename__ = "road_miles"

    id = Column(Integer, primary_key=True)
    county_code = Column(
        SmallInteger, ForeignKey("counties.code"), nullable=False
    )
    f_system = Column(SmallInteger, nullable=False)  # 1-7 functional class
    segment_count = Column(Integer)
    total_miles = Column(Float)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("county_code", "f_system"),
        Index("ix_road_miles_county", "county_code"),
    )


class EtlRun(Base):
    """Tracks ETL pipeline execution — one row per source per run."""

    __tablename__ = "etl_runs"

    id = Column(Integer, primary_key=True)
    source = Column(String(20), nullable=False)
    status = Column(String(20), nullable=False)
    started_at = Column(DateTime, nullable=False)
    finished_at = Column(DateTime)
    rows_loaded = Column(Integer)
    error_message = Column(Text)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("ix_etl_runs_source_started_at", "source", "started_at"),
    )
