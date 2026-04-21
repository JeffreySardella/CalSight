// ONE-SHOT migration script — the result is committed in
// public/ca-counties.geojson. Run again only if the GeoJSON is regenerated
// from the CartoDB source.
//
// Minimally adds `county_code` to each feature's properties while preserving
// the original formatting. A full JSON.parse + JSON.stringify round-trip
// would reformat every coordinate array (4x the line count in git), so we
// do a surgical regex insertion after each `"name": "<County>"` line.
//
// Safe to re-run: if `county_code` lines are already present the regex
// insertion will duplicate them (git will show you). To undo, restore
// the file from HEAD and re-run.
//
// Mapping mirrors backend/app/seed_counties.py (sequential 1-58, alphabetical).
// Keep in sync with that file.

import fs from "node:fs";
import path from "node:path";

const CODES = {
  "Alameda": 1, "Alpine": 2, "Amador": 3, "Butte": 4, "Calaveras": 5,
  "Colusa": 6, "Contra Costa": 7, "Del Norte": 8, "El Dorado": 9, "Fresno": 10,
  "Glenn": 11, "Humboldt": 12, "Imperial": 13, "Inyo": 14, "Kern": 15,
  "Kings": 16, "Lake": 17, "Lassen": 18, "Los Angeles": 19, "Madera": 20,
  "Marin": 21, "Mariposa": 22, "Mendocino": 23, "Merced": 24, "Modoc": 25,
  "Mono": 26, "Monterey": 27, "Napa": 28, "Nevada": 29, "Orange": 30,
  "Placer": 31, "Plumas": 32, "Riverside": 33, "Sacramento": 34, "San Benito": 35,
  "San Bernardino": 36, "San Diego": 37, "San Francisco": 38, "San Joaquin": 39, "San Luis Obispo": 40,
  "San Mateo": 41, "Santa Barbara": 42, "Santa Clara": 43, "Santa Cruz": 44, "Shasta": 45,
  "Sierra": 46, "Siskiyou": 47, "Solano": 48, "Sonoma": 49, "Stanislaus": 50,
  "Sutter": 51, "Tehama": 52, "Trinity": 53, "Tulare": 54, "Tuolumne": 55,
  "Ventura": 56, "Yolo": 57, "Yuba": 58,
};

const file = path.resolve("public/ca-counties.geojson");
const raw = fs.readFileSync(file, "utf8");

const missing = new Set(Object.keys(CODES));
let inserts = 0;

const out = raw.replace(
  /("name":\s*"([^"]+)",)(\s*\n)(\s*)/g,
  (match, nameLine, name, newline, indent) => {
    const code = CODES[name];
    if (code == null) return match;
    missing.delete(name);
    inserts++;
    return `${nameLine}${newline}${indent}"county_code": ${code},${newline}${indent}`;
  },
);

if (missing.size > 0) {
  console.error("No insert for counties not found in file:", [...missing]);
  process.exit(1);
}

fs.writeFileSync(file, out);
console.log(`Inserted county_code into ${inserts} features.`);
