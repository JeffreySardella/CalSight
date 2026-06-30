# ZAP DAST: "PII Disclosure" on `/api/schools` — False Positive

**Status:** Confirmed false positive (2026-06-29). Safe to suppress.

## The finding

The weekly ZAP DAST scan reports a **HIGH "PII Disclosure"** (rule **10062**, CWE-359),
6 instances, all on:

```
GET /api/schools?county=&school_type=&limit=1000&offset=0&include_total=false
```

Evidence values are 14-digit numbers (e.g. `36676456104525`, `50711346119002`).

## Why it's a false positive

`/api/schools` returns only **public California Department of Education
school-directory data** — no personal information. A sample record:

```json
{
  "cds_code": "08-61820-6005417",
  "school_name": "'O Me-nok Learning Center",
  "county_code": 8,
  "city": "Klamath",
  "latitude": 41.55610509,
  "longitude": -124.05281397,
  "school_type": "Elementary",
  "status": "Active"
}
```

ZAP's passive PII scanner flags **14-digit numeric identifiers** as candidate
credit-card / PII numbers (some CDS codes coincidentally pass the Luhn check).
The `cds_code` is the public **County-District-School code** published by CDE —
it identifies a *school*, not a person. There is no name-of-person, contact,
financial, health, or other personal data in this endpoint (or anywhere in the
public read API, which serves only aggregate crash and reference data).

Verdict: **no PII is disclosed.** The match is on a public institutional ID.

## Suppression

Add a ZAP **alert filter** so rule 10062 on this URL is marked False Positive
and the weekly scan stops failing. In the ZAP Automation Framework plan
(`alertFilter` job) or context file:

```yaml
- type: alertFilter
  alertFilters:
    - ruleId: 10062          # PII Disclosure
      newRisk: "False Positive"
      urlRegex: ".*/api/schools.*"
```

Or, equivalently, via CLI:

```
-config "alertFilter.filters.filter(0).ruleId=10062" \
-config "alertFilter.filters.filter(0).url=.*/api/schools.*" \
-config "alertFilter.filters.filter(0).urlRegex=true" \
-config "alertFilter.filters.filter(0).newRisk=-1"   # -1 = False Positive
```

(The ZAP scan config is not in this repo — apply this where the weekly scan is
configured on the runner.)

## Related ZAP LOW findings (already fixed in the API)

The same scan's LOW findings are **already resolved in the deployed API** (the
06-29 run hit a pre-deploy instance); verified live on `api.calsight.org`:

- **X-Content-Type-Options / Cross-Origin-Resource-Policy headers** — present on
  all responses via `SecurityHeadersMiddleware` (`backend/app/main.py`); also
  sets `X-Frame-Options: DENY` and `Referrer-Policy`.
- **500 on null-byte input** — `NullByteSanitizationMiddleware` returns **400**
  for `%00` in the URL/query (no more unhandled 500s).
- Both are covered by `backend/tests/api/test_middleware.py`.

The **Unix timestamp disclosure** LOW (`/api/speed-limits`) is a legitimate data
value (a speed-limit effective date), not sensitive — ignorable.
