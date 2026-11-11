#!/usr/bin/env node
/**
 * Official Manitoba Government Election & Boundary Data Importer
 *
 * Fetches official election returns, by-elections, sitting MLA rosters, and
 * electoral division geometries from:
 *   - Elections Manitoba (https://www.electionsmanitoba.ca)
 *   - Legislative Assembly of Manitoba (https://www.gov.mb.ca/legislature)
 *   - OpenNorth Represent API / Elections Manitoba boundaries (https://represent.opennorth.ca)
 *
 * Usage:
 *   node tools/import-manitoba-data.mjs [--skip-boundaries] [--verify-only] [--out public/data]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import { z } from 'zod';
import {
  assertAllowedHttpsUrl,
  safeFetchBuffer,
  safeFetchText,
  safeWriteJsonFile,
} from './importer/security.mjs';
import {
  PARTY_META,
  HISTORICAL_TO_2018_LINEAGE,
  HISTORICAL_TO_2008_LINEAGE,
  PREDECESSOR_FALLBACK_2018,
  PREDECESSOR_FALLBACK_2008,
  classifyRegion,
  cleanDivisionName,
  normalizeCandidateName,
  normalizeGeometryWindingForD3,
  normalizeParty,
  slugifyDivision,
} from './importer/normalization.mjs';
import {
  buildWinnipegMunicipalData,
  parse2023Xlsx,
  parseByElectionPdf,
  parseByElectionXlsx,
  parseCurrentMlasHtml,
  parseHistoricalSummaryPdf,
  parseMlaBioArchiveHtml,
  parseModMunicipalitiesPdf,
  parsePdfGeneralElection,
} from './importer/parsers.mjs';

const WORKSPACE_ROOT = path.resolve(process.cwd());
const DEFAULT_OUT_DIR = path.resolve(WORKSPACE_ROOT, 'public/data');

const SOURCES = {
  currentMlas: 'https://www.gov.mb.ca/legislature/members/mla_list_constituency.html',
  mlaLivingBio: 'https://www.gov.mb.ca/legislature/members/mla_bio_living.html',
  mlaDeceasedBio: 'https://www.gov.mb.ca/legislature/members/mla_bio_deceased.html',
  ge2023Xlsx: 'https://www.electionsmanitoba.ca/downloads/43GE%20Summary%20of%20Votes%20Received.xlsx',
  ge2019Pdf: 'https://www.electionsmanitoba.ca/downloads/PDF_EDResults_GE2019.pdf',
  ge2016Pdf: 'https://www.electionsmanitoba.ca/downloads/PDF_EDResults_GE2016.pdf',
  ge2011Pdf: 'https://www.electionsmanitoba.ca/downloads/PDF_EDResults_GE2011.pdf',
  ge2007Pdf: 'https://www.electionsmanitoba.ca/downloads/PDF_EDResults_GE2007.pdf',
  ge1999Pdf: 'https://www.electionsmanitoba.ca/downloads/PDF_EDResults_GE1999.pdf',
  historicalSummaryPdf: 'https://www.electionsmanitoba.ca/downloads/HistoricalSummary.pdf',
  byElectionsIndex: 'https://www.electionsmanitoba.ca/en/Results/ByElectionsResults',
  boundaries2018: 'https://represent.opennorth.ca/boundaries/manitoba-electoral-districts-2018/simple_shape?limit=100',
  boundaries2008: 'https://represent.opennorth.ca/boundaries/manitoba-electoral-districts-2008/simple_shape?limit=100',
  modPdf: 'https://www.gov.mb.ca/mr/contactus/pubs/mod.pdf',
  mbMunicipalGeo:
    'https://services.arcgis.com/mMUesHYPkXjaFGfS/arcgis/rest/services/MUNICIPALITY/FeatureServer/0/query?where=1%3D1&outFields=OBJECTID,MUNI_NO,MUNI_NAME,MUNI_TYPE,MUNI_LIST_NAME,MUNI_LIST_NAME_WITH_TYPE&f=geojson&outSR=4326&maxAllowableOffset=0.005',
  wpgWardsGeo: 'https://data.winnipeg.ca/resource/t4cg-yaxs.geojson?$limit=50',
  wpgCouncil: 'https://data.winnipeg.ca/resource/r4tk-7dip.json?$limit=200',
  wpgElections:
    "https://data.winnipeg.ca/resource/7753-3fjc.json?$where=position%20in('Office%20of%20Mayor','Office%20of%20Councillor')&$limit=5000",
};

const GENERAL_ELECTION_META = [
  { id: 'ge-1995', year: 1995, date: '1995-04-25', label: '1995 General Election', shortLabel: '1995', number: '36th General Election', boundaryEra: '2008' },
  { id: 'ge-1999', year: 1999, date: '1999-09-21', label: '1999 General Election', shortLabel: '1999', number: '37th General Election', boundaryEra: '2008' },
  { id: 'ge-2003', year: 2003, date: '2003-06-03', label: '2003 General Election', shortLabel: '2003', number: '38th General Election', boundaryEra: '2008' },
  { id: 'ge-2007', year: 2007, date: '2007-05-22', label: '2007 General Election', shortLabel: '2007', number: '39th General Election', boundaryEra: '2008' },
  { id: 'ge-2011', year: 2011, date: '2011-10-04', label: '2011 General Election', shortLabel: '2011', number: '40th General Election', boundaryEra: '2008' },
  { id: 'ge-2016', year: 2016, date: '2016-04-19', label: '2016 General Election', shortLabel: '2016', number: '41st General Election', boundaryEra: '2008' },
  { id: 'ge-2019', year: 2019, date: '2019-09-10', label: '2019 General Election', shortLabel: '2019', number: '42nd General Election', boundaryEra: '2018' },
  { id: 'ge-2023', year: 2023, date: '2023-10-03', label: '2023 General Election', shortLabel: '2023', number: '43rd General Election', boundaryEra: '2018' },
];

// Official Manitoba By-Election metadata keyed by URL path on electionsmanitoba.ca
const KNOWN_BY_ELECTION_DATES = {
  '2026ThePas-Kameesak': [{ division: 'The Pas-Kameesak', date: '2026-07-21', label: '2026 The Pas-Kameesak By-Election' }],
  '2025SpruceWoods': [{ division: 'Spruce Woods', date: '2025-08-26', label: '2025 Spruce Woods By-Election' }],
  '2025Transcona': [{ division: 'Transcona', date: '2025-03-18', label: '2025 Transcona By-Election' }],
  '2024Tuxedo': [{ division: 'Tuxedo', date: '2024-06-18', label: '2024 Tuxedo By-Election' }],
  '2022KirkfieldPark': [{ division: 'Kirkfield Park', date: '2022-12-13', label: '2022 Kirkfield Park By-Election' }],
  '2022Thompson': [{ division: 'Thompson', date: '2022-06-07', label: '2022 Thompson By-Election' }],
  '2022FortWhyte': [{ division: 'Fort Whyte', date: '2022-03-22', label: '2022 Fort Whyte By-Election' }],
  '2018': [{ division: 'St. Boniface', date: '2018-07-17', label: '2018 St. Boniface By-Election' }],
  '2017': [{ division: 'Point Douglas', date: '2017-06-13', label: '2017 Point Douglas By-Election' }],
  '2015': [{ division: 'The Pas', date: '2015-04-21', label: '2015 The Pas By-Election' }],
  '2014': [
    { division: 'Arthur-Virden', date: '2014-01-28', label: '2014 Arthur-Virden By-Election', hint: 'ArthurVirden' },
    { division: 'Morris', date: '2014-01-28', label: '2014 Morris By-Election', hint: 'Morris' },
  ],
  '2012': [{ division: 'Fort Whyte', date: '2012-09-04', label: '2012 Fort Whyte By-Election' }],
  '2010': [{ division: 'Concordia', date: '2010-03-02', label: '2010 Concordia By-Election' }],
  '2009': [
    { division: 'Elmwood', date: '2009-03-24', label: '2009 Elmwood By-Election', hint: 'Elmwood' },
    { division: 'The Pas', date: '2009-03-24', label: '2009 The Pas By-Election', hint: 'ThePas' },
  ],
  '2005': [{ division: 'Fort Whyte', date: '2005-12-13', label: '2005 Fort Whyte By-Election' }],
};

function roundCoords(coords) {
  if (typeof coords[0] === 'number') {
    return [Number(coords[0].toFixed(4)), Number(coords[1].toFixed(4))];
  }
  return coords.map(roundCoords);
}

function computePolygonCentroid(geometry) {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  const walk = (arr) => {
    if (typeof arr[0] === 'number') {
      if (arr[0] < minLon) minLon = arr[0];
      if (arr[0] > maxLon) maxLon = arr[0];
      if (arr[1] < minLat) minLat = arr[1];
      if (arr[1] > maxLat) maxLat = arr[1];
    } else {
      for (const child of arr) walk(child);
    }
  };
  walk(geometry.coordinates);
  return [Number(((minLon + maxLon) / 2).toFixed(4)), Number(((minLat + maxLat) / 2).toFixed(4))];
}

/**
 * Downloads and normalizes all 57 electoral division polygons for a boundary era.
 */
async function fetchBoundaries(listUrl, era) {
  const items = [];
  let nextUrl = listUrl;
  while (nextUrl) {
    assertAllowedHttpsUrl(nextUrl);
    const { text } = await safeFetchText(nextUrl, { timeoutMs: 45000 });
    const listing = JSON.parse(text);
    items.push(...(listing.objects ?? []));
    nextUrl = listing.meta?.next
      ? new URL(listing.meta.next, 'https://represent.opennorth.ca').toString()
      : null;
  }

  if (items.length !== 57) {
    throw new Error(`Expected 57 boundary objects from ${listUrl}, got ${items.length}`);
  }

  const features = items.map((obj) => {
    const geom = obj.simple_shape ?? obj.shape;
    if (!geom) {
      throw new Error(`Missing geometry for ${obj.name} in ${listUrl}`);
    }
    const cleanName = cleanDivisionName(obj.name);
    const slug = slugifyDivision(cleanName);
    const roundedGeom = {
      type: geom.type,
      coordinates: roundCoords(geom.coordinates),
    };
    const centroid = obj.centroid?.coordinates
      ? roundCoords(obj.centroid.coordinates)
      : computePolygonCentroid(roundedGeom);
    return {
      type: 'Feature',
      properties: {
        id: slug,
        name: cleanName,
        era,
        region: classifyRegion(slug),
        centroid,
      },
      geometry: roundedGeom,
    };
  });

  features.sort((a, b) => a.properties.name.localeCompare(b.properties.name));
  return {
    type: 'FeatureCollection',
    name: `manitoba-electoral-divisions-${era}`,
    features,
  };
}

/**
 * Discovers and imports Elections Manitoba By-Elections (2005-2026) from official XLSX files.
 */
async function fetchByElections() {
  const { text: indexHtml } = await safeFetchText(SOURCES.byElectionsIndex);
  const $ = cheerio.load(indexHtml);
  const subPages = new Set();
  $('a[href*="/en/Results/ByElections/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) subPages.add(href.trim());
  });

  const imported = [];
  for (const relPath of subPages) {
    const key = relPath.split('/').pop();
    const knownEntries = KNOWN_BY_ELECTION_DATES[key];
    if (!knownEntries) continue;

    const pageUrl = new URL(relPath, 'https://www.electionsmanitoba.ca').toString();
    const { text: pageHtml } = await safeFetchText(pageUrl);
    const $p = cheerio.load(pageHtml);
    const xlsxLinks = [];
    const pdfLinks = [];
    $p('a[href]').each((_, el) => {
      const href = ($p(el).attr('href') ?? '').trim();
      if (/\.xlsx$/i.test(href) && !/VAbyVA|VA_results|Results_by_Voting_Area|Results_By_Poll|Results_By_Voting_Area/i.test(href)) {
        xlsxLinks.push(new URL(href, 'https://www.electionsmanitoba.ca').toString());
      } else if (/Summary_Results_By2005_FortWhyte\.pdf$/i.test(href)) {
        pdfLinks.push(new URL(href, 'https://www.electionsmanitoba.ca').toString());
      }
    });

    for (const entry of knownEntries) {
      const preferPdf = entry.date === '2005-12-13' && pdfLinks.length > 0;
      const matchingUrl = preferPdf
        ? pdfLinks[0]
        : xlsxLinks.find((u) => !entry.hint || u.toLowerCase().includes(entry.hint.toLowerCase())) ??
          xlsxLinks[0];
      if (!matchingUrl) continue;

      try {
        const { buffer } = await safeFetchBuffer(matchingUrl);
        const parsed = preferPdf
          ? await parseByElectionPdf(buffer, {
              divisionName: entry.division,
              date: entry.date,
              label: entry.label,
            })
          : parseByElectionXlsx(buffer, {
              divisionName: entry.division,
              date: entry.date,
              label: entry.label,
            });
        if (parsed?.record) {
          imported.push({
            id: `be-${entry.date}-${slugifyDivision(entry.division)}`,
            date: entry.date,
            year: Number(entry.date.slice(0, 4)),
            label: entry.label,
            divisionName: parsed.record.divisionName,
            divisionSlug: parsed.record.divisionSlug,
            sourceUrl: matchingUrl,
            record: parsed.record,
          });
        }
      } catch (err) {
        console.warn(`Skipped by-election ${entry.label}: ${err.message}`);
      }
    }
  }

  imported.sort((a, b) => a.date.localeCompare(b.date));
  return imported;
}

function tallySeats(resultsMap) {
  const counts = {};
  for (const rec of Object.values(resultsMap)) {
    const p = rec.winner.party;
    counts[p] = (counts[p] ?? 0) + 1;
  }
  return counts;
}

function resolveTargetSlug(rawSlug, era) {
  if (era === '2018') {
    return HISTORICAL_TO_2018_LINEAGE[rawSlug] ?? rawSlug;
  }
  return HISTORICAL_TO_2008_LINEAGE[rawSlug] ?? rawSlug;
}

/**
 * Maps a raw general election result array onto the canonical 57 divisions of the target era,
 * preserving original division name for boundary-lineage annotations and filling newly created
 * ridings via official predecessor fallback mappings so all 57 polygons render cleanly.
 */
function buildSnapshotResults(records, targetDivisions, era) {
  const targetBySlug = new Map(targetDivisions.map((d) => [d.slug, d]));
  const rawBySlug = new Map(records.map((r) => [r.divisionSlug, r]));
  const mapped = {};

  for (const rec of records) {
    let targetSlug = rec.divisionSlug;
    if (!targetBySlug.has(targetSlug)) {
      targetSlug = resolveTargetSlug(rec.divisionSlug, era);
    }
    if (!targetBySlug.has(targetSlug)) {
      continue;
    }
    const existing = mapped[targetSlug];
    const isDirect = rec.divisionSlug === targetSlug;
    if (!existing || isDirect) {
      mapped[targetSlug] = {
        ...rec,
        mappedDivisionSlug: targetSlug,
        originalDivisionName: rec.divisionName,
        isPredecessorBoundary: !isDirect,
      };
    }
  }

  const fallbackMap = era === '2018' ? PREDECESSOR_FALLBACK_2018 : PREDECESSOR_FALLBACK_2008;
  for (const div of targetDivisions) {
    if (mapped[div.slug]) continue;
    const candidates = fallbackMap[div.slug] ?? [];
    for (const predSlug of candidates) {
      const predRec = rawBySlug.get(predSlug);
      if (predRec) {
        mapped[div.slug] = {
          ...predRec,
          mappedDivisionSlug: div.slug,
          originalDivisionName: predRec.divisionName,
          isPredecessorBoundary: true,
          note: `Predecessor riding (${predRec.divisionName}) prior to redistribution`,
        };
        break;
      }
    }
  }

  return mapped;
}

function computeDistrictDomination(historyEntries) {
  const counts = {};
  for (const h of historyEntries) {
    const p = h.winner.party;
    counts[p] = (counts[p] ?? 0) + 1;
  }
  const total = historyEntries.length;
  const sortedParties = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const [dominantParty, dominantWins] = sortedParties[0] ?? ['OTHER', 0];
  const dominancePct = total > 0 ? Math.round((dominantWins / total) * 100) : 0;

  let flips = 0;
  for (let i = 1; i < historyEntries.length; i++) {
    if (historyEntries[i].winner.party !== historyEntries[i - 1].winner.party) {
      flips++;
    }
  }

  let currentStreakParty = historyEntries[historyEntries.length - 1]?.winner.party ?? 'OTHER';
  let currentStreak = 0;
  for (let i = historyEntries.length - 1; i >= 0; i--) {
    if (historyEntries[i].winner.party === currentStreakParty) {
      currentStreak++;
    } else {
      break;
    }
  }

  let classification = 'Competitive Swing';
  if (dominancePct >= 85 && flips <= 1) {
    classification = `${PARTY_META[dominantParty]?.shortName ?? dominantParty} Fortress`;
  } else if (dominancePct >= 65) {
    classification = `${PARTY_META[dominantParty]?.shortName ?? dominantParty} Stronghold`;
  } else if (flips >= 3) {
    classification = 'Bellwether / Swing';
  } else if (dominancePct >= 55) {
    classification = `Leans ${PARTY_META[dominantParty]?.shortName ?? dominantParty}`;
  }

  return {
    dominantParty,
    dominantWins,
    totalTerms: total,
    dominancePct,
    flips,
    currentStreakParty,
    currentStreak,
    classification,
    partyWins: counts,
  };
}

const DatasetIntegritySchema = z.object({
  snapshots: z.array(
    z.object({
      id: z.string().min(1),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      label: z.string().min(1),
      results: z.record(z.string(), z.any()),
    })
  ).min(8),
});

async function verifyExistingDatasets(outDir) {
  const resolvedOut = path.resolve(outDir);
  const electionsPath = path.join(resolvedOut, 'elections.json');
  const districtsPath = path.join(resolvedOut, 'districts.json');
  const b18Path = path.join(resolvedOut, 'boundaries-2018.geojson');
  const membersPath = path.join(resolvedOut, 'legislature-members.json');
  const municipalPath = path.join(resolvedOut, 'municipal.json');
  const muniGeoPath = path.join(resolvedOut, 'municipalities.geojson');

  for (const p of [electionsPath, districtsPath, b18Path, membersPath, municipalPath, muniGeoPath]) {
    if (!fs.existsSync(p)) {
      throw new Error(`Missing dataset file: ${p}`);
    }
  }

  const elections = JSON.parse(fs.readFileSync(electionsPath, 'utf8'));
  DatasetIntegritySchema.parse(elections);
  for (const snap of elections.snapshots) {
    if (Object.keys(snap.results).length !== 57 || Object.keys(snap.resultsUnified2018).length !== 57) {
      throw new Error(`Snapshot ${snap.id} does not cover all 57 divisions`);
    }
  }

  const districts = JSON.parse(fs.readFileSync(districtsPath, 'utf8'));
  if (!Array.isArray(districts.districts) || districts.districts.length !== 57) {
    throw new Error(`Expected 57 districts in districts.json, got ${districts.districts?.length}`);
  }
  for (const d of districts.districts) {
    const geCount = d.history.filter((h) => h.kind === 'general').length;
    if (geCount !== 8) {
      throw new Error(`District ${d.name} expected 8 general elections, got ${geCount}`);
    }
  }

  const geo = JSON.parse(fs.readFileSync(b18Path, 'utf8'));
  if (!Array.isArray(geo.features) || geo.features.length !== 57) {
    throw new Error(`Expected 57 features in boundaries-2018.geojson, got ${geo.features?.length}`);
  }

  const membersData = JSON.parse(fs.readFileSync(membersPath, 'utf8'));
  if (!Array.isArray(membersData.members) || membersData.members.length < 500) {
    throw new Error(`Expected >= 500 legislature members, got ${membersData.members?.length}`);
  }

  const municipalData = JSON.parse(fs.readFileSync(municipalPath, 'utf8'));
  if (!Array.isArray(municipalData.manitobaMunicipalities) || municipalData.manitobaMunicipalities.length < 100) {
    throw new Error(`Expected >= 100 Manitoba municipalities, got ${municipalData.manitobaMunicipalities?.length}`);
  }
  if (!Array.isArray(municipalData.winnipeg?.wards) || municipalData.winnipeg.wards.length !== 15) {
    throw new Error(`Expected 15 Winnipeg wards, got ${municipalData.winnipeg?.wards?.length}`);
  }

  const muniGeo = JSON.parse(fs.readFileSync(muniGeoPath, 'utf8'));
  if (!Array.isArray(muniGeo.features) || muniGeo.features.length < 100) {
    throw new Error(`Expected >= 100 municipal boundary polygons, got ${muniGeo.features?.length}`);
  }

  console.log(
    'Verification passed: 57 districts, 57 GeoJSON polygons,',
    elections.snapshots.length,
    'election snapshots,',
    membersData.members.length,
    'MLAs (1870–2026),',
    municipalData.winnipeg.wards.length,
    'Winnipeg wards, and',
    municipalData.manitobaMunicipalities.length,
    'Manitoba municipalities.'
  );
}

async function runImport() {
  const args = process.argv.slice(2);
  const verifyOnly = args.includes('--verify-only');
  const skipBoundaries = args.includes('--skip-boundaries');
  const outIdx = args.indexOf('--out');
  const requestedOut = outIdx !== -1 && args[outIdx + 1] ? args[outIdx + 1] : 'public/data';
  const outDir = path.resolve(WORKSPACE_ROOT, requestedOut);
  if (outDir !== WORKSPACE_ROOT && !outDir.startsWith(WORKSPACE_ROOT + path.sep)) {
    throw new Error(`Output directory must stay inside workspace: ${outDir}`);
  }

  if (verifyOnly) {
    await verifyExistingDatasets(outDir);
    return;
  }

  console.log('=== Manitoba Official Government Data Importer ===');

  let geo2018;
  let geo2008;
  const b18File = path.join(outDir, 'boundaries-2018.geojson');
  const b08File = path.join(outDir, 'boundaries-2008.geojson');

  if (skipBoundaries && fs.existsSync(b18File) && fs.existsSync(b08File)) {
    console.log('1/5 Reusing existing boundary GeoJSON files (--skip-boundaries)...');
    geo2018 = JSON.parse(fs.readFileSync(b18File, 'utf8'));
    geo2008 = JSON.parse(fs.readFileSync(b08File, 'utf8'));
  } else {
    console.log('1/5 Fetching official 2018 & 2008 Manitoba Electoral Division boundaries...');
    [geo2018, geo2008] = await Promise.all([
      fetchBoundaries(SOURCES.boundaries2018, '2018'),
      fetchBoundaries(SOURCES.boundaries2008, '2008'),
    ]);
  }

  const divisions2018 = geo2018.features.map((f) => ({
    slug: f.properties.id,
    name: f.properties.name,
    region: f.properties.region,
    centroid: f.properties.centroid,
  }));
  const divisions2008 = geo2008.features.map((f) => ({
    slug: f.properties.id,
    name: f.properties.name,
    region: f.properties.region,
    centroid: f.properties.centroid,
  }));

  console.log('2/5 Fetching Current Sitting MLAs from Manitoba Legislature (gov.mb.ca)...');
  const { text: mlaHtml } = await safeFetchText(SOURCES.currentMlas);
  const currentMlas = parseCurrentMlasHtml(mlaHtml, SOURCES.currentMlas);
  if (currentMlas.length !== 57) {
    throw new Error(`Expected 57 sitting MLAs from gov.mb.ca, got ${currentMlas.length}`);
  }

  console.log('3/5 Fetching General Elections (1995-2023) from Elections Manitoba...');
  const [ge2023Buf, ge2019Buf, ge2016Buf, ge2011Buf, ge2007Buf, ge1999Buf, histBuf] =
    await Promise.all([
      safeFetchBuffer(SOURCES.ge2023Xlsx).then((r) => r.buffer),
      safeFetchBuffer(SOURCES.ge2019Pdf).then((r) => r.buffer),
      safeFetchBuffer(SOURCES.ge2016Pdf).then((r) => r.buffer),
      safeFetchBuffer(SOURCES.ge2011Pdf).then((r) => r.buffer),
      safeFetchBuffer(SOURCES.ge2007Pdf).then((r) => r.buffer),
      safeFetchBuffer(SOURCES.ge1999Pdf).then((r) => r.buffer),
      safeFetchBuffer(SOURCES.historicalSummaryPdf).then((r) => r.buffer),
    ]);

  const histParsed = await parseHistoricalSummaryPdf(histBuf);
  const rawByYear = {
    1995: histParsed[1995],
    1999: await parsePdfGeneralElection(ge1999Buf, 1999),
    2003: histParsed[2003],
    2007: await parsePdfGeneralElection(ge2007Buf, 2007),
    2011: await parsePdfGeneralElection(ge2011Buf, 2011),
    2016: await parsePdfGeneralElection(ge2016Buf, 2016),
    2019: await parsePdfGeneralElection(ge2019Buf, 2019),
    2023: parse2023Xlsx(ge2023Buf),
  };

  for (const [y, list] of Object.entries(rawByYear)) {
    if (list.length !== 57) {
      throw new Error(`Expected 57 divisions in GE ${y}, parsed ${list.length}`);
    }
  }

  console.log('4/5 Fetching Official By-Elections (2005-2026) from Elections Manitoba...');
  const byElections = await fetchByElections();
  console.log(`    Imported ${byElections.length} official by-elections.`);

  // Build chronological snapshots
  const snapshots = [];

  for (const geMeta of GENERAL_ELECTION_META) {
    const rawRecords = rawByYear[geMeta.year];
    const targetDivs = geMeta.boundaryEra === '2018' ? divisions2018 : divisions2008;
    const results = buildSnapshotResults(rawRecords, targetDivs, geMeta.boundaryEra);

    // Also store a 2018-mapped view so users can toggle Unified Modern Boundaries
    const resultsUnified2018 =
      geMeta.boundaryEra === '2018'
        ? results
        : buildSnapshotResults(rawRecords, divisions2018, '2018');

    const sourceUrl =
      geMeta.year === 2023
        ? SOURCES.ge2023Xlsx
        : geMeta.year === 1995 || geMeta.year === 2003
          ? SOURCES.historicalSummaryPdf
          : SOURCES[`ge${geMeta.year}Pdf`];

    snapshots.push({
      id: geMeta.id,
      kind: 'general',
      year: geMeta.year,
      date: geMeta.date,
      label: geMeta.label,
      shortLabel: geMeta.shortLabel,
      subtitle: geMeta.number,
      boundaryEra: geMeta.boundaryEra,
      sourceUrl,
      seatCounts: tallySeats(Object.fromEntries(rawRecords.map((r) => [r.divisionSlug, r]))),
      results,
      resultsUnified2018,
    });
  }

  // Apply post-2023 by-elections and current 2026 Assembly snapshot
  const base2023 = snapshots.find((s) => s.id === 'ge-2023').results;
  const currentAssemblyResults = structuredClone(base2023);

  // Post-Tuxedo 2024 By-Election snapshot
  const tuxedoBe = byElections.find((b) => b.id.includes('2024-06-18'));
  if (tuxedoBe) {
    const afterTuxedo = structuredClone(base2023);
    afterTuxedo[tuxedoBe.divisionSlug] = {
      ...tuxedoBe.record,
      mappedDivisionSlug: tuxedoBe.divisionSlug,
      originalDivisionName: tuxedoBe.divisionName,
    };
    snapshots.push({
      id: 'be-2024-tuxedo',
      kind: 'byelection',
      year: 2024,
      date: '2024-06-18',
      label: '2024 Tuxedo By-Election',
      shortLabel: '2024',
      subtitle: 'Tuxedo flips PC → NDP for first time since 1981',
      boundaryEra: '2018',
      sourceUrl: tuxedoBe.sourceUrl,
      seatCounts: tallySeats(afterTuxedo),
      results: afterTuxedo,
      resultsUnified2018: afterTuxedo,
    });
  }

  // Post-2025 By-Elections (Transcona + Spruce Woods)
  const post2025 = structuredClone(
    snapshots[snapshots.length - 1].results
  );
  const be2025List = byElections.filter((b) => b.year === 2025);
  if (be2025List.length > 0) {
    for (const be of be2025List) {
      post2025[be.divisionSlug] = {
        ...be.record,
        mappedDivisionSlug: be.divisionSlug,
        originalDivisionName: be.divisionName,
      };
    }
    snapshots.push({
      id: 'be-2025',
      kind: 'byelection',
      year: 2025,
      date: '2025-08-26',
      label: '2025 By-Elections (Transcona & Spruce Woods)',
      shortLabel: '2025',
      subtitle: '43rd Legislature mid-term updates',
      boundaryEra: '2018',
      sourceUrl: SOURCES.byElectionsIndex,
      seatCounts: tallySeats(post2025),
      results: post2025,
      resultsUnified2018: post2025,
    });
  }

  // Apply ALL post-2023 by-elections onto Current 2026 Assembly, then reconcile with live gov.mb.ca MLA list
  for (const be of byElections.filter((b) => b.date > '2023-10-03')) {
    currentAssemblyResults[be.divisionSlug] = {
      ...be.record,
      mappedDivisionSlug: be.divisionSlug,
      originalDivisionName: be.divisionName,
    };
  }

  const mlaBySlug = new Map(currentMlas.map((m) => [m.divisionSlug, m]));
  for (const div of divisions2018) {
    const sitting = mlaBySlug.get(div.slug);
    const prev = currentAssemblyResults[div.slug];
    if (!sitting || !prev) continue;

    const changedParty = sitting.party !== prev.winner.party;
    const samePerson =
      slugifyDivision(sitting.memberName) === slugifyDivision(prev.winner.name);
    const updatedCandidates = prev.candidates.map((c) => ({ ...c }));

    currentAssemblyResults[div.slug] = {
      ...prev,
      winner: {
        ...prev.winner,
        name: sitting.memberName,
        party: sitting.party,
        partyRaw: sitting.partyRaw,
        isMinisterial: sitting.isMinisterial,
        profileUrl: sitting.profileUrl,
        ...(samePerson ? {} : { votes: prev.winner.votes, voteSharePct: prev.winner.voteSharePct }),
      },
      candidates: updatedCandidates,
      note: changedParty
        ? `Caucus change since election (now ${sitting.party})`
        : prev.note,
    };
  }

  snapshots.push({
    id: 'current-2026',
    kind: 'current',
    year: 2026,
    date: '2026-11-11',
    label: 'Current Assembly (2026)',
    shortLabel: 'Now',
    subtitle: '43rd Legislature — Live gov.mb.ca + 2024–2026 By-Elections',
    boundaryEra: '2018',
    sourceUrl: SOURCES.currentMlas,
    seatCounts: tallySeats(currentAssemblyResults),
    results: currentAssemblyResults,
    resultsUnified2018: currentAssemblyResults,
  });

  // Build per-district full historical timelines (1995-2026) mapped onto the 57 2018 divisions
  const districtsOutput = divisions2018.map((div) => {
    const history = [];

    // 1. General elections 1995-2023
    for (const geMeta of GENERAL_ELECTION_META) {
      const snap = snapshots.find((s) => s.id === geMeta.id);
      const rec = snap?.resultsUnified2018?.[div.slug];
      if (!rec) continue;
      history.push({
        eventId: geMeta.id,
        date: geMeta.date,
        year: geMeta.year,
        kind: 'general',
        eventLabel: geMeta.label,
        divisionNameAtTime: rec.originalDivisionName,
        isPredecessorBoundary: slugifyDivision(rec.originalDivisionName) !== div.slug,
        winner: rec.winner,
        runnerUpParty: rec.runnerUpParty,
        marginVotes: rec.marginVotes,
        marginPct: rec.marginPct,
        ballotsCast: rec.ballotsCast,
        registeredVoters: rec.registeredVoters,
        turnoutPct: rec.turnoutPct,
        candidates: rec.candidates,
        sourceUrl: snap.sourceUrl,
      });
    }

    // 2. Historical & recent by-elections affecting this riding (or predecessor)
    for (const be of byElections) {
      const targetSlug = divisions2018.some((d) => d.slug === be.divisionSlug)
        ? be.divisionSlug
        : HISTORICAL_TO_2018_LINEAGE[be.divisionSlug];
      if (targetSlug !== div.slug) continue;
      history.push({
        eventId: be.id,
        date: be.date,
        year: be.year,
        kind: 'byelection',
        eventLabel: be.label,
        divisionNameAtTime: be.divisionName,
        isPredecessorBoundary: slugifyDivision(be.divisionName) !== div.slug,
        winner: be.record.winner,
        runnerUpParty: be.record.runnerUpParty,
        marginVotes: be.record.marginVotes,
        marginPct: be.record.marginPct,
        ballotsCast: be.record.ballotsCast,
        registeredVoters: be.record.registeredVoters,
        turnoutPct: be.record.turnoutPct,
        candidates: be.record.candidates,
        sourceUrl: be.sourceUrl,
      });
    }

    history.sort((a, b) => a.date.localeCompare(b.date));

    // 3. Current sitting status if party shifted mid-term without a by-election
    const sitting = mlaBySlug.get(div.slug);
    const lastEvent = history[history.length - 1];
    if (sitting && lastEvent && sitting.party !== lastEvent.winner.party) {
      history.push({
        eventId: `caucus-${div.slug}`,
        date: '2026-11-11',
        year: 2026,
        kind: 'caucus_change',
        eventLabel: 'Sitting Caucus Status (43rd Legislature)',
        divisionNameAtTime: div.name,
        isPredecessorBoundary: false,
        winner: {
          name: sitting.memberName,
          party: sitting.party,
          partyRaw: sitting.partyRaw,
          votes: lastEvent.winner.votes,
          voteSharePct: lastEvent.winner.voteSharePct,
          elected: true,
          isMinisterial: sitting.isMinisterial,
          profileUrl: sitting.profileUrl,
        },
        runnerUpParty: lastEvent.runnerUpParty,
        marginVotes: lastEvent.marginVotes,
        marginPct: lastEvent.marginPct,
        ballotsCast: lastEvent.ballotsCast,
        registeredVoters: lastEvent.registeredVoters,
        turnoutPct: lastEvent.turnoutPct,
        candidates: lastEvent.candidates,
        sourceUrl: SOURCES.currentMlas,
      });
    }

    const domination = computeDistrictDomination(history);
    const current = currentAssemblyResults[div.slug];

    return {
      id: div.slug,
      name: div.name,
      region: div.region,
      centroid: div.centroid,
      currentMla: {
        name: sitting?.memberName ?? current.winner.name,
        party: sitting?.party ?? current.winner.party,
        partyRaw: sitting?.partyRaw ?? current.winner.partyRaw,
        isMinisterial: sitting?.isMinisterial ?? false,
        profileUrl: sitting?.profileUrl ?? null,
      },
      domination,
      history,
    };
  });

  console.log('5/7 Fetching Historical Manitoba MLAs (1870–2026) from Legislative Assembly...');
  const [{ text: livingBioHtml }, { text: deceasedBioHtml }] = await Promise.all([
    safeFetchText(SOURCES.mlaLivingBio),
    safeFetchText(SOURCES.mlaDeceasedBio),
  ]);
  const livingFormer = parseMlaBioArchiveHtml(livingBioHtml, 'former_living', SOURCES.mlaLivingBio);
  const deceasedHistorical = parseMlaBioArchiveHtml(
    deceasedBioHtml,
    'deceased',
    SOURCES.mlaDeceasedBio
  );

  // Merge current sitting MLAs with their election events from districtsOutput
  const currentNamesSet = new Set(currentMlas.map((m) => slugifyDivision(m.memberName)));
  const currentMlaRecords = currentMlas.map((m) => {
    const dist = districtsOutput.find((d) => d.id === m.divisionSlug);
    const matchingHistory = (dist?.history ?? []).filter(
      (h) => slugifyDivision(h.winner.name) === slugifyDivision(m.memberName)
    );
    const electionEvents = matchingHistory.map(
      (h) =>
        `${h.kind === 'byelection' ? 'Elected by-election' : 'Elected g.e.'} ${h.date} (${h.winner.voteSharePct.toFixed(1)}%)`
    );
    const years = matchingHistory.map((h) => h.year);
    return {
      id: `${slugifyDivision(m.memberName)}-current`,
      name: m.memberName,
      constituency: m.divisionName,
      constituencySlug: m.divisionSlug,
      party: m.party,
      partyRaw: m.partyRaw,
      status: 'current',
      firstElectedYear: years.length ? Math.min(...years) : 2023,
      lastYearServed: 2026,
      dob: null,
      deceasedDate: null,
      electionEvents: electionEvents.length ? electionEvents : ['Sitting Member — 43rd Legislature'],
      portfolios: m.isMinisterial ? ['Executive Council / Cabinet Minister (Hon.)'] : [],
      isMinisterial: m.isMinisterial,
      profileUrl: m.profileUrl ?? SOURCES.currentMlas,
    };
  });

  const allMlaMembers = [
    ...currentMlaRecords,
    ...livingFormer.filter((m) => !currentNamesSet.has(slugifyDivision(m.name))),
    ...deceasedHistorical,
  ].sort((a, b) => a.name.localeCompare(b.name));

  console.log('6/7 Fetching Municipal Data (Winnipeg Wards/Elections 1964–2026 & Manitoba MOD)...');
  const [modBuf, mbMunGeoText, wpgWardsText, wpgCouncilText, wpgElectionsText] = await Promise.all([
    safeFetchBuffer(SOURCES.modPdf).then((r) => r.buffer),
    safeFetchText(SOURCES.mbMunicipalGeo, { timeoutMs: 45000 }).then((r) => r.text),
    safeFetchText(SOURCES.wpgWardsGeo).then((r) => r.text),
    safeFetchText(SOURCES.wpgCouncil).then((r) => r.text),
    safeFetchText(SOURCES.wpgElections).then((r) => r.text),
  ]);

  const manitobaMunicipalities = await parseModMunicipalitiesPdf(modBuf, SOURCES.modPdf);
  const wpgBuilt = buildWinnipegMunicipalData({
    wardsGeoJson: JSON.parse(wpgWardsText),
    councilRows: JSON.parse(wpgCouncilText),
    electionRows: JSON.parse(wpgElectionsText),
    sourceUrl: 'https://data.winnipeg.ca/resource/7753-3fjc.json',
  });

  const rawMbMunGeo = JSON.parse(mbMunGeoText);
  const muniByNo = new Map(
    manitobaMunicipalities
      .filter((m) => m.municipalNo !== null)
      .map((m) => [m.municipalNo, m])
  );
  const muniBySlug = new Map(manitobaMunicipalities.map((m) => [m.id, m]));
  const municipalitiesGeoJson = {
    type: 'FeatureCollection',
    name: 'manitoba-municipalities',
    features: (rawMbMunGeo.features ?? []).map((f) => {
      const mNo = Number(f.properties?.MUNI_NO ?? 0);
      const listName = String(f.properties?.MUNI_LIST_NAME ?? '');
      const mType = String(f.properties?.MUNI_TYPE ?? 'RM');
      const rawLabel = String(f.properties?.MUNI_NAME ?? f.properties?.MUNI_LIST_NAME ?? '');
      const matched =
        muniByNo.get(mNo) ??
        muniBySlug.get(slugifyDivision(`${listName} ${mType}`)) ??
        muniBySlug.get(slugifyDivision(rawLabel));
      const slug = matched?.id ?? slugifyDivision(rawLabel);
      return {
        type: 'Feature',
        properties: {
          id: slug,
          municipalNo: mNo,
          name: matched?.name ?? rawLabel,
          type: matched?.type ?? String(f.properties?.MUNI_TYPE ?? 'RM'),
        },
        geometry: normalizeGeometryWindingForD3({
          type: f.geometry.type,
          coordinates: roundCoords(f.geometry.coordinates),
        }),
      };
    }),
  };

  console.log('7/7 Writing validated datasets to', outDir, '...');
  const written = [
    safeWriteJsonFile(outDir, 'boundaries-2018.geojson', geo2018),
    safeWriteJsonFile(outDir, 'boundaries-2008.geojson', geo2008),
    safeWriteJsonFile(outDir, 'elections.json', {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      parties: PARTY_META,
      snapshots,
    }),
    safeWriteJsonFile(outDir, 'districts.json', {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      districts: districtsOutput,
    }),
    safeWriteJsonFile(outDir, 'legislature-members.json', {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      counts: {
        total: allMlaMembers.length,
        current: currentMlaRecords.length,
        formerLiving: livingFormer.length,
        deceased: deceasedHistorical.length,
      },
      members: allMlaMembers,
    }),
    safeWriteJsonFile(outDir, 'municipal.json', {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      winnipeg: wpgBuilt,
      manitobaMunicipalities,
    }),
    safeWriteJsonFile(outDir, 'municipalities.geojson', municipalitiesGeoJson),
  ];

  const metadata = {
    schemaVersion: 1,
    importedAt: new Date().toISOString(),
    sources: [
      { name: 'Legislative Assembly of Manitoba — Current MLAs', url: SOURCES.currentMlas },
      { name: 'Legislative Assembly of Manitoba — Living Former MLAs Archive', url: SOURCES.mlaLivingBio },
      { name: 'Legislative Assembly of Manitoba — Deceased Historical MLAs (1870–2025)', url: SOURCES.mlaDeceasedBio },
      { name: 'Elections Manitoba — 2023 General Election (43rd)', url: SOURCES.ge2023Xlsx },
      { name: 'Elections Manitoba — 2019 General Election (42nd)', url: SOURCES.ge2019Pdf },
      { name: 'Elections Manitoba — 2016 General Election (41st)', url: SOURCES.ge2016Pdf },
      { name: 'Elections Manitoba — 2011 General Election (40th)', url: SOURCES.ge2011Pdf },
      { name: 'Elections Manitoba — 2007 General Election (39th)', url: SOURCES.ge2007Pdf },
      { name: 'Elections Manitoba — 1999 General Election (37th)', url: SOURCES.ge1999Pdf },
      { name: 'Elections Manitoba — Historical Summaries (1995 & 2003)', url: SOURCES.historicalSummaryPdf },
      { name: 'Elections Manitoba — By-Elections (2005–2026)', url: SOURCES.byElectionsIndex },
      { name: 'Manitoba Electoral Divisions Boundaries (2018 & 2008)', url: SOURCES.boundaries2018 },
      { name: 'Manitoba Municipal Relations — Municipal Officials Directory (Nov 2026)', url: SOURCES.modPdf },
      { name: 'Province of Manitoba Maps — Municipal Boundaries Layer', url: SOURCES.mbMunicipalGeo },
      { name: 'City of Winnipeg Open Data — Election Results (1964–2022) & 2026 Council Wards', url: 'https://data.winnipeg.ca/resource/7753-3fjc.json' },
    ],
    counts: {
      districts: districtsOutput.length,
      snapshots: snapshots.length,
      byElectionsImported: byElections.length,
      currentSeatTally: tallySeats(currentAssemblyResults),
      legislatureMembersTotal: allMlaMembers.length,
      manitobaMunicipalities: manitobaMunicipalities.length,
      winnipegWards: wpgBuilt.wards.length,
    },
    files: written.map((w) => ({
      file: path.basename(w.path),
      bytes: w.bytes,
      sha256: w.sha256,
    })),
  };

  safeWriteJsonFile(outDir, 'metadata.json', metadata);
  await verifyExistingDatasets(outDir);

  console.log('\nImport complete! Summary by Election Snapshot:');
  for (const s of snapshots) {
    console.log(` - ${s.date} | ${s.label}:`, JSON.stringify(s.seatCounts));
  }
}

runImport().catch((err) => {
  console.error('IMPORT FAILED:', err.message);
  process.exit(1);
});
