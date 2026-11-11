/**
 * Canonical party identifiers for Manitoba provincial politics.
 */
export const PARTY_META = {
  NDP: {
    id: 'NDP',
    name: 'New Democratic Party of Manitoba',
    shortName: 'NDP',
    color: '#F37021',
    lightColor: '#FFF3EB',
    textColor: '#FFFFFF',
  },
  PC: {
    id: 'PC',
    name: 'Progressive Conservative Party of Manitoba',
    shortName: 'PC',
    color: '#0057A8',
    lightColor: '#EAF3FC',
    textColor: '#FFFFFF',
  },
  MLP: {
    id: 'MLP',
    name: 'Manitoba Liberal Party',
    shortName: 'Liberal',
    color: '#D71920',
    lightColor: '#FDECEC',
    textColor: '#FFFFFF',
  },
  GPM: {
    id: 'GPM',
    name: 'Green Party of Manitoba',
    shortName: 'Green',
    color: '#2E8B57',
    lightColor: '#EBF7F0',
    textColor: '#FFFFFF',
  },
  KP: {
    id: 'KP',
    name: 'Keystone Party of Manitoba',
    shortName: 'Keystone',
    color: '#6D28D9',
    lightColor: '#F4EFFD',
    textColor: '#FFFFFF',
  },
  IND: {
    id: 'IND',
    name: 'Independent',
    shortName: 'Ind.',
    color: '#64748B',
    lightColor: '#F1F5F9',
    textColor: '#FFFFFF',
  },
  OTHER: {
    id: 'OTHER',
    name: 'Other Party',
    shortName: 'Other',
    color: '#7C3AED',
    lightColor: '#F5F3FF',
    textColor: '#FFFFFF',
  },
  VAC: {
    id: 'VAC',
    name: 'Vacant',
    shortName: 'Vacant',
    color: '#94A3B8',
    lightColor: '#F8FAFC',
    textColor: '#0F172A',
  },
};

/**
 * Normalizes raw Elections Manitoba / Legislature party strings into canonical PartyId.
 */
export function normalizeParty(raw) {
  const s = String(raw ?? '').trim().toUpperCase();
  if (!s) return 'OTHER';
  if (s === 'NDP' || s.includes('NDP') || s.includes('NPD') || s === 'CCF') return 'NDP';
  if (
    s === 'PC' ||
    s === 'P.C.' ||
    s.startsWith('PC ') ||
    s.includes('PROGRESSIVE CONSERVATIVE') ||
    /^CONS(\.|ERVATIVE)?$/i.test(s)
  ) {
    return 'PC';
  }
  if (
    s === 'MLP' ||
    s === 'LIB' ||
    s === 'LIB.' ||
    s === 'LPM' ||
    s.includes('LIBERAL') ||
    s.includes('IND LIB') ||
    s.includes('MLP/PLM') ||
    s.includes('LPM/PLM')
  ) {
    return 'MLP';
  }
  if (s === 'GPM' || s.includes('GPM') || s.includes('GREEN') || s.includes('PVM') || s.includes('VERTS')) return 'GPM';
  if (s === 'KP' || s.includes('KEYSTONE')) return 'KP';
  if (s === 'IND' || s === 'IND.' || s.startsWith('IND')) return 'IND';
  if (s === 'VAC' || s.includes('VACANT')) return 'VAC';
  return 'OTHER';
}

/**
 * Normalizes candidate names from "LAST, First" or "First Last" into consistent
 * display name and strips "Hon." ministerial title into a separate flag.
 */
export function normalizeCandidateName(rawName) {
  let clean = String(rawName ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  let isMinisterial = false;
  if (/\bHon\.?\s*/i.test(clean)) {
    isMinisterial = true;
    clean = clean.replace(/\bHon\.?\s*/gi, '').replace(/\s+/g, ' ').trim();
  }

  // Convert "LAST, First" -> "First Last"
  if (clean.includes(',')) {
    const [lastRaw, firstRaw] = clean.split(',', 2);
    const last = toTitleCaseName(lastRaw.trim());
    const first = toTitleCaseName((firstRaw ?? '').trim());
    const display = [first, last].filter(Boolean).join(' ');
    return { displayName: display, sortName: `${last}, ${first}`, isMinisterial };
  }

  const display = toTitleCaseName(clean);
  return { displayName: display, sortName: display, isMinisterial };
}

function toTitleCaseName(str) {
  if (!str) return '';
  return str
    .split(/\s+/)
    .map((word) => {
      if (word.length > 2 && (word === word.toUpperCase() || /^(mc|mac)[A-Z]{2,}$/i.test(word))) {
        return word
          .toLowerCase()
          .replace(/(^|[\-'])([a-z\u00e0-\u00ff])/g, (_, sep, ch) => sep + ch.toUpperCase())
          .replace(/^Mc([a-z])/i, (_, ch) => `Mc${ch.toUpperCase()}`)
          .replace(/^Mac([a-z]{3,})/i, (_, rest) => `Mac${rest[0].toUpperCase()}${rest.slice(1)}`);
      }
      return word;
    })
    .join(' ');
}

/**
 * Canonical slug for electoral divisions so accents, hyphens, periods, and spacing match.
 */
export function slugifyDivision(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const KNOWN_ALIASES = {
  'brandoneastbrandonest': 'Brandon East',
  'brandonwestbrandonouest': 'Brandon West',
  'dawsontrailchemindawson': 'Dawson Trail',
  'fortrougefortrouge': 'Fort Rouge',
  'interlakegimlientreleslacsgimli': 'Interlake-Gimli',
  'lacdubonnetlacdubonnet': 'Lac du Bonnet',
  'laverendrye': 'La Vérendrye',
  'portagelaprairie': 'Portage la Prairie',
  'portagelaprairieportagelaprairie': 'Portage la Prairie',
  'redrivernorthriviererougenord': 'Red River North',
  'ridingmountainmontriding': 'Riding Mountain',
  'stbonifacesaintboniface': 'St. Boniface',
  'stboniface': 'St. Boniface',
  'stjamessaintjames': 'St. James',
  'stjames': 'St. James',
  'stjohnssaintjohns': 'St. Johns',
  'stjohns': 'St. Johns',
  'stvitalsaintvital': 'St. Vital',
  'stvital': 'St. Vital',
  'stnorbert': 'St. Norbert',
  'stpaul': 'St. Paul',
  'sterose': 'Ste. Rose',
  'seineriverriviereseine': 'Seine River',
  'thepaskameesaklepaskameesak': 'The Pas-Kameesak',
  'thepaskameesak': 'The Pas-Kameesak',
  'thepaslepas': 'The Pas',
  'thepas': 'The Pas',
  'turtlemountainmontturtle': 'Turtle Mountain',
  'rupertsland': "Rupert's Land",
  'kewatinook': 'Kewatinook',
  'keewatinook': 'Keewatinook',
  'morris': 'Morris',
  'sprucewoods': 'Spruce Woods',
};

/**
 * Cleans bilingual Elections Manitoba division names ("Brandon East/Brandon-Est")
 * into canonical English division name.
 */
export function cleanDivisionName(raw) {
  let text = String(raw ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Handle "English / French" or "English/French"
  if (text.includes('/')) {
    const [left, right] = text.split('/', 2).map((s) => s.trim());
    // Strip French bilingual duplicates where left is English
    if (left && right) {
      text = left;
    }
  }
  // Remove trailing French duplicate stuck without slash (e.g., "Brandon-Oues")
  text = text
    .replace(/\s+Brandon-Oues(t)?$/i, '')
    .replace(/\s+Brandon-Est$/i, '')
    .replace(/\s+Chemin-Dawson$/i, '')
    .replace(/\s+Entre-les-Lacs-Gimli$/i, '')
    .replace(/\s+Le Pas-Kameesak$/i, '')
    .replace(/\s+Fort-Rouge$/i, '')
    .trim();

  const compact = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  if (KNOWN_ALIASES[compact]) {
    return KNOWN_ALIASES[compact];
  }
  return text;
}

/**
 * Maps historical (1995-2016) riding slugs to their primary 2018-era successor riding slug
 * so longitudinal MLA history & party domination work seamlessly across boundary changes.
 */
export const HISTORICAL_TO_2018_LINEAGE = {
  'arthur-virden': 'turtle-mountain',
  'broadway': 'union-station',
  'carman': 'midland',
  'charleswood': 'roblin',
  'crescentwood': 'fort-rouge',
  'dauphin-roblin': 'dauphin',
  'emerson': 'borderland',
  'fort-garry-riverview': 'fort-garry',
  'gimli': 'interlake-gimli',
  'gladstone': 'agassiz',
  'inkster': 'tyndall-park',
  'interlake': 'interlake-gimli',
  'kewatinook': 'keewatinook',
  'ruperts-land': 'keewatinook',
  'kildonan': 'mcphillips',
  'logan': 'union-station',
  'lord-roberts': 'fort-garry',
  'minnedosa': 'riding-mountain',
  'minto': 'notre-dame',
  'morris': 'midland',
  'niakwa': 'southdale',
  'osborne': 'fort-rouge',
  'pembina': 'morden-winkler',
  'river-east': 'kildonan-river-east',
  'roblin-russell': 'riding-mountain',
  'russell': 'riding-mountain',
  'st-norbert': 'waverley',
  'st-paul': 'springfield-ritchot',
  'springfield': 'springfield-ritchot',
  'ste-rose': 'agassiz',
  'sturgeon-creek': 'assiniboia',
  'the-pas': 'the-pas-kameesak',
  'wellington': 'notre-dame',
};

/**
 * Fallback predecessor source riding (historical slug) when a newer 2018-era district
 * did not yet exist in an earlier election year.
 */
export const PREDECESSOR_FALLBACK_2018 = {
  'borderland': ['emerson'],
  'dawson-trail': ['la-verendrye', 'springfield'],
  'fort-richmond': ['fort-garry', 'fort-garry-riverview', 'st-norbert'],
  'fort-whyte': ['st-norbert', 'tuxedo'],
  'lagimodiere': ['southdale', 'seine-river'],
  'mcphillips': ['kildonan', 'the-maples'],
  'midland': ['carman', 'morris'],
  'morden-winkler': ['pembina'],
  'notre-dame': ['minto', 'wellington'],
  'red-river-north': ['st-paul', 'selkirk'],
  'riding-mountain': ['minnedosa', 'russell', 'roblin-russell'],
  'roblin': ['charleswood'],
  'springfield-ritchot': ['st-paul', 'springfield'],
  'spruce-woods': ['turtle-mountain', 'arthur-virden'],
  'turtle-mountain': ['arthur-virden', 'spruce-woods'],
  'union-station': ['logan', 'broadway', 'minto', 'point-douglas'],
  'waverley': ['st-norbert'],
  'agassiz': ['ste-rose', 'gladstone'],
  'interlake-gimli': ['gimli', 'interlake'],
  'keewatinook': ['kewatinook', 'ruperts-land'],
  'kildonan-river-east': ['river-east', 'kildonan'],
  'the-pas-kameesak': ['the-pas'],
};

/**
 * Fallback predecessor source riding for 2008-era map polygons when viewing 1995-2007.
 */
export const PREDECESSOR_FALLBACK_2008 = {
  'agassiz': ['ste-rose', 'gladstone'],
  'dawson-trail': ['la-verendrye', 'springfield'],
  'fort-garry-riverview': ['fort-garry', 'lord-roberts'],
  'fort-richmond': ['fort-garry', 'st-norbert'],
  'fort-whyte': ['st-norbert', 'tuxedo'],
  'kewatinook': ['ruperts-land'],
  'midland': ['carman', 'morris'],
  'minto': ['wellington'],
  'morden-winkler': ['pembina'],
  'riding-mountain': ['minnedosa', 'russell', 'roblin-russell'],
  'spruce-woods': ['turtle-mountain'],
  'st-paul': ['springfield'],
  'tyndall-park': ['inkster'],
  'dauphin': ['dauphin-roblin'],
  'logan': ['broadway', 'minto', 'point-douglas'],
};

/**
 * Maps 1995/1999/2003/2007 riding slugs to their closest 2008-era boundary slug
 * for rendering 1995-2007 on the 2008 boundary map.
 */
export const HISTORICAL_TO_2008_LINEAGE = {
  'broadway': 'logan',
  'carman': 'midland',
  'crescentwood': 'fort-garry-riverview',
  'dauphin-roblin': 'dauphin',
  'fort-garry': 'fort-garry-riverview',
  'gladstone': 'agassiz',
  'inkster': 'tyndall-park',
  'lord-roberts': 'fort-garry-riverview',
  'minnedosa': 'riding-mountain',
  'niakwa': 'southdale',
  'osborne': 'fort-rouge',
  'pembina': 'morden-winkler',
  'roblin-russell': 'riding-mountain',
  'ruperts-land': 'kewatinook',
  'russell': 'riding-mountain',
  'springfield': 'st-paul',
  'ste-rose': 'agassiz',
  'sturgeon-creek': 'assiniboia',
  'turtle-mountain': 'spruce-woods',
  'wellington': 'minto',
};

export const WINNIPEG_RIDINGS = new Set([
  'assiniboia',
  'burrows',
  'concordia',
  'elmwood',
  'fort-garry',
  'fort-richmond',
  'fort-rouge',
  'fort-whyte',
  'kildonan-river-east',
  'kirkfield-park',
  'lagimodiere',
  'mcphillips',
  'notre-dame',
  'point-douglas',
  'radisson',
  'riel',
  'river-heights',
  'roblin',
  'rossmere',
  'seine-river',
  'southdale',
  'st-boniface',
  'st-james',
  'st-johns',
  'st-vital',
  'the-maples',
  'transcona',
  'tuxedo',
  'tyndall-park',
  'union-station',
  'waverley',
  'wolseley',
]);

export const NORTHERN_RIDINGS = new Set([
  'flin-flon',
  'keewatinook',
  'kewatinook',
  'the-pas-kameesak',
  'the-pas',
  'thompson',
]);

export const BRANDON_WESTMAN_RIDINGS = new Set([
  'agassiz',
  'brandon-east',
  'brandon-west',
  'dauphin',
  'riding-mountain',
  'spruce-woods',
  'swan-river',
  'turtle-mountain',
]);

export function classifyRegion(slug) {
  if (WINNIPEG_RIDINGS.has(slug)) return 'Winnipeg';
  if (NORTHERN_RIDINGS.has(slug)) return 'Northern Manitoba';
  if (BRANDON_WESTMAN_RIDINGS.has(slug)) return 'Brandon & Westman';
  return 'Southern & Interlake';
}

function ringSignedArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const p1 = ring[i];
    const p2 = ring[i + 1];
    if (!p1 || !p2) continue;
    sum += (p1[0] ?? 0) * (p2[1] ?? 0) - (p2[0] ?? 0) * (p1[1] ?? 0);
  }
  return sum / 2;
}

function normalizePolygonRingsForD3(rings) {
  return rings.map((ring, idx) => {
    const area = ringSignedArea(ring);
    if (idx === 0 && area > 0) return [...ring].reverse();
    if (idx > 0 && area < 0) return [...ring].reverse();
    return ring;
  });
}

/**
 * Normalizes GeoJSON Polygon/MultiPolygon winding to match d3-geo spherical
 * polygons (clockwise exterior rings, counter-clockwise holes).
 */
export function normalizeGeometryWindingForD3(geometry) {
  if (!geometry) return geometry;
  if (geometry.type === 'Polygon') {
    return { ...geometry, coordinates: normalizePolygonRingsForD3(geometry.coordinates) };
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map(normalizePolygonRingsForD3),
    };
  }
  return geometry;
}
