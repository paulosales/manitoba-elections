export type PartyId = 'NDP' | 'PC' | 'MLP' | 'GPM' | 'KP' | 'IND' | 'OTHER' | 'VAC';

export interface PartyMeta {
  id: PartyId;
  name: string;
  shortName: string;
  color: string;
  lightColor: string;
  textColor: string;
}

export interface CandidateResult {
  name: string;
  party: PartyId;
  partyRaw: string;
  votes: number;
  voteSharePct: number;
  elected: boolean;
  isMinisterial?: boolean;
  profileUrl?: string | null;
}

export interface DistrictElectionRecord {
  divisionName: string;
  divisionSlug: string;
  mappedDivisionSlug?: string;
  originalDivisionName?: string;
  isPredecessorBoundary?: boolean;
  winner: CandidateResult;
  runnerUpParty: PartyId | null;
  marginVotes: number;
  marginPct: number;
  ballotsCast: number;
  registeredVoters: number | null;
  turnoutPct: number | null;
  candidates: CandidateResult[];
  note?: string;
  flippedFromCurrent?: boolean;
}

export type BoundaryEra = '2008' | '2018';

export interface ElectionSnapshot {
  id: string;
  kind: 'general' | 'byelection' | 'current' | 'future';
  year: number;
  date: string;
  label: string;
  shortLabel: string;
  subtitle: string;
  boundaryEra: BoundaryEra;
  sourceUrl: string;
  seatCounts: Partial<Record<PartyId, number>>;
  results: Record<string, DistrictElectionRecord>;
  resultsUnified2018: Record<string, DistrictElectionRecord>;
  isProjection?: boolean;
}

export interface DistrictHistoryItem {
  eventId: string;
  date: string;
  year: number;
  kind: 'general' | 'byelection' | 'caucus_change';
  eventLabel: string;
  divisionNameAtTime: string;
  isPredecessorBoundary: boolean;
  winner: CandidateResult;
  runnerUpParty: PartyId | null;
  marginVotes: number;
  marginPct: number;
  ballotsCast: number;
  registeredVoters: number | null;
  turnoutPct: number | null;
  candidates: CandidateResult[];
  sourceUrl: string;
}

export interface DistrictDomination {
  dominantParty: PartyId;
  dominantWins: number;
  totalTerms: number;
  dominancePct: number;
  flips: number;
  currentStreakParty: PartyId;
  currentStreak: number;
  classification: string;
  partyWins: Partial<Record<PartyId, number>>;
}

export interface DistrictProfile {
  id: string;
  name: string;
  region: string;
  centroid: [number, number];
  currentMla: {
    name: string;
    party: PartyId;
    partyRaw: string;
    isMinisterial: boolean;
    profileUrl: string | null;
  };
  domination: DistrictDomination;
  history: DistrictHistoryItem[];
}

export interface BoundaryFeature {
  type: 'Feature';
  properties: {
    id: string;
    name: string;
    era: BoundaryEra;
    region: string;
    centroid: [number, number];
  };
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: unknown[];
  };
}

export interface BoundariesGeoJson {
  type: 'FeatureCollection';
  name: string;
  features: BoundaryFeature[];
}

export interface ElectionsDataset {
  schemaVersion: number;
  generatedAt: string;
  parties: Record<PartyId, PartyMeta>;
  snapshots: ElectionSnapshot[];
}

export interface DistrictsDataset {
  schemaVersion: number;
  generatedAt: string;
  districts: DistrictProfile[];
}

export interface MetadataDataset {
  schemaVersion: number;
  importedAt: string;
  sources: Array<{ name: string; url: string }>;
  counts: {
    districts: number;
    snapshots: number;
    byElectionsImported: number;
    currentSeatTally: Partial<Record<PartyId, number>>;
    legislatureMembersTotal?: number;
    manitobaMunicipalities?: number;
    winnipegWards?: number;
  };
  files: Array<{ file: string; bytes: number; sha256: string }>;
}

export type MapColorMode = 'party' | 'domination' | 'flips';
export type RegionView = 'all' | 'winnipeg' | 'southern' | 'westman' | 'north';
export type FutureModelType = 'swing' | 'dominance_trend' | 'status_quo';
export type AppTab = 'provincial' | 'legislature' | 'municipal';

export interface FutureSwingConfig {
  model: FutureModelType;
  targetYear: 2027 | 2031;
  swings: Record<'NDP' | 'PC' | 'MLP' | 'GPM' | 'KP', number>;
}

export interface LegislatureMemberRecord {
  id: string;
  name: string;
  constituency: string;
  constituencySlug: string;
  party: PartyId;
  partyRaw: string;
  status: 'current' | 'former_living' | 'deceased';
  firstElectedYear: number | null;
  lastYearServed: number | null;
  dob: string | null;
  deceasedDate: string | null;
  electionEvents: string[];
  portfolios: string[];
  isMinisterial: boolean;
  profileUrl: string;
}

export interface LegislatureMembersDataset {
  schemaVersion: number;
  generatedAt: string;
  counts: {
    total: number;
    current: number;
    formerLiving: number;
    deceased: number;
  };
  members: LegislatureMemberRecord[];
}

export interface WinnipegWardFeature {
  type: 'Feature';
  properties: {
    id: string;
    wardNumber: number;
    name: string;
    councillor: string;
    phone: string;
    website: string;
  };
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: unknown[];
  };
}

export interface WinnipegWardCandidate {
  name: string;
  votes: number;
  voteSharePct: number;
  won: boolean;
}

export interface WinnipegWardElectionRecord {
  wardSlug: string;
  wardNameAtTime: string;
  councillor: string;
  partyStatus?: string;
  votes: number;
  voteSharePct: number;
  marginPct: number;
  acclaimed: boolean;
  candidates: WinnipegWardCandidate[];
}

export interface WinnipegSnapshot {
  id: string;
  year: number;
  date: string;
  label: string;
  shortLabel: string;
  isCurrent: boolean;
  isProjection?: boolean;
  mayor: {
    name: string;
    partyStatus?: string;
    votes: number;
    voteSharePct: number;
    candidates: WinnipegWardCandidate[];
  } | null;
  wards: Record<string, WinnipegWardElectionRecord>;
}

export interface WinnipegWardHistoryItem {
  year: number;
  date: string;
  label: string;
  councillor: string;
  wardNameAtTime: string;
  voteSharePct: number;
  votes: number;
  acclaimed: boolean;
  mayorName: string;
}

export interface WinnipegWardProfile {
  id: string;
  wardNumber: number;
  name: string;
  currentCouncillor: string;
  phone: string;
  website: string;
  neighbourhoods: string;
  longestServingCouncillor: string;
  distinctCouncillorsCount: number;
  history: WinnipegWardHistoryItem[];
}

export interface ManitobaMunicipalityRecord {
  id: string;
  municipalNo: number | null;
  name: string;
  rawName: string;
  type: string;
  population: number | null;
  headRole: string;
  headName: string;
  caoName: string;
  councillors: string[];
  partyStatus?: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  sourceUrl: string;
}

export interface MunicipalDataset {
  schemaVersion: number;
  generatedAt: string;
  winnipeg: {
    wardsGeoJson: {
      type: 'FeatureCollection';
      name: string;
      features: WinnipegWardFeature[];
    };
    snapshots: WinnipegSnapshot[];
    wards: WinnipegWardProfile[];
    sourceUrl: string;
  };
  manitobaMunicipalities: ManitobaMunicipalityRecord[];
}

export interface MunicipalitiesGeoJson {
  type: 'FeatureCollection';
  name: string;
  features: Array<{
    type: 'Feature';
    properties: {
      id: string;
      municipalNo: number;
      name: string;
      type: string;
    };
    geometry: {
      type: 'Polygon' | 'MultiPolygon';
      coordinates: unknown[];
    };
  }>;
}


