import { z } from 'zod';
import type {
  BoundariesGeoJson,
  DistrictsDataset,
  ElectionsDataset,
  LegislatureMembersDataset,
  MetadataDataset,
  MunicipalDataset,
  MunicipalitiesGeoJson,
} from '../types/election';

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const PartyIdSchema = z.enum(['NDP', 'PC', 'MLP', 'GPM', 'KP', 'IND', 'OTHER', 'VAC']);

const SafeHttpsUrlSchema = z
  .string()
  .max(500)
  .refine((val) => isSafeHttpsUrl(val), { message: 'Only HTTPS URLs are permitted' });

/**
 * Validates that a URL is a valid HTTPS URL with no embedded credentials.
 */
export function isSafeHttpsUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

/**
 * Recursively clones plain JSON values while stripping prototype-pollution keys.
 */
export function sanitizeJsonValue<T>(input: T): T {
  if (Array.isArray(input)) {
    return input.map((item) => sanitizeJsonValue(item)) as unknown as T;
  }
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      out[key] = sanitizeJsonValue(val);
    }
    return out as T;
  }
  return input;
}

const CandidateResultSchema = z.object({
  name: z.string().min(1).max(160),
  party: PartyIdSchema,
  partyRaw: z.string().max(80),
  votes: z.number().int().min(0).max(500000),
  voteSharePct: z.number().min(0).max(100),
  elected: z.boolean(),
  isMinisterial: z.boolean().optional(),
  profileUrl: SafeHttpsUrlSchema.nullable().optional(),
});

const DistrictRecordSchema = z.object({
  divisionName: z.string().min(1).max(120),
  divisionSlug: z.string().min(1).max(120),
  mappedDivisionSlug: z.string().max(120).optional(),
  originalDivisionName: z.string().max(120).optional(),
  isPredecessorBoundary: z.boolean().optional(),
  winner: CandidateResultSchema,
  runnerUpParty: PartyIdSchema.nullable(),
  marginVotes: z.number().int().min(0).max(500000),
  marginPct: z.number().min(0).max(100),
  ballotsCast: z.number().int().min(0).max(500000),
  registeredVoters: z.number().int().min(0).max(500000).nullable(),
  turnoutPct: z.number().min(0).max(100).nullable(),
  candidates: z.array(CandidateResultSchema).min(1).max(20),
  note: z.string().max(300).optional(),
});

const SnapshotSchema = z.object({
  id: z.string().min(1).max(60),
  kind: z.enum(['general', 'byelection', 'current', 'future']),
  year: z.number().int().min(1870).max(2100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string().min(1).max(160),
  shortLabel: z.string().min(1).max(24),
  subtitle: z.string().max(240),
  boundaryEra: z.enum(['2008', '2018']),
  sourceUrl: SafeHttpsUrlSchema,
  seatCounts: z.record(z.string(), z.number().int().min(0).max(100)),
  results: z.record(z.string(), DistrictRecordSchema),
  resultsUnified2018: z.record(z.string(), DistrictRecordSchema),
});

export const ElectionsDatasetSchema = z.object({
  schemaVersion: z.number().int().min(1),
  generatedAt: z.string().min(1),
  parties: z.record(
    z.string(),
    z.object({
      id: PartyIdSchema,
      name: z.string().min(1).max(120),
      shortName: z.string().min(1).max(30),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
      lightColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
      textColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    })
  ),
  snapshots: z.array(SnapshotSchema).min(1).max(40),
});

export const DistrictsDatasetSchema = z.object({
  schemaVersion: z.number().int().min(1),
  generatedAt: z.string().min(1),
  districts: z
    .array(
      z.object({
        id: z.string().min(1).max(120),
        name: z.string().min(1).max(120),
        region: z.string().min(1).max(80),
        centroid: z.tuple([z.number().min(-110).max(-85), z.number().min(48).max(61)]),
        currentMla: z.object({
          name: z.string().min(1).max(160),
          party: PartyIdSchema,
          partyRaw: z.string().max(80),
          isMinisterial: z.boolean(),
          profileUrl: SafeHttpsUrlSchema.nullable(),
        }),
        domination: z.object({
          dominantParty: PartyIdSchema,
          dominantWins: z.number().int().min(0),
          totalTerms: z.number().int().min(1),
          dominancePct: z.number().min(0).max(100),
          flips: z.number().int().min(0),
          currentStreakParty: PartyIdSchema,
          currentStreak: z.number().int().min(0),
          classification: z.string().min(1).max(80),
          partyWins: z.record(z.string(), z.number().int().min(0)),
        }),
        history: z
          .array(
            z.object({
              eventId: z.string().min(1).max(100),
              date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
              year: z.number().int().min(1870).max(2100),
              kind: z.enum(['general', 'byelection', 'caucus_change']),
              eventLabel: z.string().min(1).max(160),
              divisionNameAtTime: z.string().min(1).max(120),
              isPredecessorBoundary: z.boolean(),
              winner: CandidateResultSchema,
              runnerUpParty: PartyIdSchema.nullable(),
              marginVotes: z.number().int().min(0),
              marginPct: z.number().min(0).max(100),
              ballotsCast: z.number().int().min(0),
              registeredVoters: z.number().int().min(0).nullable(),
              turnoutPct: z.number().min(0).max(100).nullable(),
              candidates: z.array(CandidateResultSchema).min(1).max(20),
              sourceUrl: SafeHttpsUrlSchema,
            })
          )
          .min(1),
      })
    )
    .length(57),
});

export const BoundariesGeoJsonSchema = z.object({
  type: z.literal('FeatureCollection'),
  name: z.string().min(1),
  features: z
    .array(
      z.object({
        type: z.literal('Feature'),
        properties: z.object({
          id: z.string().min(1).max(120),
          name: z.string().min(1).max(120),
          era: z.enum(['2008', '2018']),
          region: z.string().min(1).max(80),
          centroid: z.tuple([z.number(), z.number()]),
        }),
        geometry: z.object({
          type: z.enum(['Polygon', 'MultiPolygon']),
          coordinates: z.array(z.any()).min(1),
        }),
      })
    )
    .length(57),
});

export const MetadataDatasetSchema = z.object({
  schemaVersion: z.number().int().min(1),
  importedAt: z.string().min(1),
  sources: z.array(z.object({ name: z.string(), url: SafeHttpsUrlSchema })),
  counts: z.object({
    districts: z.number().int(),
    snapshots: z.number().int(),
    byElectionsImported: z.number().int(),
    currentSeatTally: z.record(z.string(), z.number().int()),
    legislatureMembersTotal: z.number().int().optional(),
    manitobaMunicipalities: z.number().int().optional(),
    winnipegWards: z.number().int().optional(),
  }),
  files: z.array(
    z.object({
      file: z.string(),
      bytes: z.number().int(),
      sha256: z.string(),
    })
  ),
});

export const BundleImportSchema = z.object({
  elections: ElectionsDatasetSchema,
  districts: DistrictsDatasetSchema,
});

export function validateElectionsDataset(raw: unknown): ElectionsDataset {
  return ElectionsDatasetSchema.parse(sanitizeJsonValue(raw)) as unknown as ElectionsDataset;
}

export function validateDistrictsDataset(raw: unknown): DistrictsDataset {
  return DistrictsDatasetSchema.parse(sanitizeJsonValue(raw)) as unknown as DistrictsDataset;
}

export function validateBoundariesGeoJson(raw: unknown): BoundariesGeoJson {
  return BoundariesGeoJsonSchema.parse(sanitizeJsonValue(raw)) as unknown as BoundariesGeoJson;
}

export function validateMetadataDataset(raw: unknown): MetadataDataset {
  return MetadataDatasetSchema.parse(sanitizeJsonValue(raw)) as unknown as MetadataDataset;
}

export const LegislatureMembersDatasetSchema = z.object({
  schemaVersion: z.number().int().min(1),
  generatedAt: z.string().min(1),
  counts: z.object({
    total: z.number().int().min(1),
    current: z.number().int().min(0),
    formerLiving: z.number().int().min(0),
    deceased: z.number().int().min(0),
  }),
  members: z
    .array(
      z.object({
        id: z.string().min(1).max(160),
        name: z.string().min(1).max(180),
        constituency: z.string().min(1).max(140),
        constituencySlug: z.string().max(140),
        party: PartyIdSchema,
        partyRaw: z.string().max(300),
        status: z.enum(['current', 'former_living', 'deceased']),
        firstElectedYear: z.number().int().nullable(),
        lastYearServed: z.number().int().nullable(),
        dob: z.string().max(80).nullable(),
        deceasedDate: z.string().max(80).nullable(),
        electionEvents: z.array(z.string().max(300)),
        portfolios: z.array(z.string().max(300)),
        isMinisterial: z.boolean(),
        profileUrl: SafeHttpsUrlSchema,
      })
    )
    .min(1),
});

const WinnipegCandidateSchema = z.object({
  name: z.string().min(1).max(160),
  votes: z.number().int().min(0),
  voteSharePct: z.number().min(0).max(100),
  won: z.boolean(),
});

export const MunicipalDatasetSchema = z.object({
  schemaVersion: z.number().int().min(1),
  generatedAt: z.string().min(1),
  winnipeg: z.object({
    wardsGeoJson: z.object({
      type: z.literal('FeatureCollection'),
      name: z.string().min(1),
      features: z
        .array(
          z.object({
            type: z.literal('Feature'),
            properties: z.object({
              id: z.string().min(1),
              wardNumber: z.number().int(),
              name: z.string().min(1),
              councillor: z.string(),
              phone: z.string(),
              website: z.string(),
            }),
            geometry: z.object({
              type: z.enum(['Polygon', 'MultiPolygon']),
              coordinates: z.array(z.any()).min(1),
            }),
          })
        )
        .length(15),
    }),
    snapshots: z
      .array(
        z.object({
          id: z.string().min(1),
          year: z.number().int(),
          date: z.string().min(1),
          label: z.string().min(1),
          shortLabel: z.string().min(1),
          isCurrent: z.boolean(),
          mayor: z
            .object({
              name: z.string().min(1),
              partyStatus: z.string().optional(),
              votes: z.number().int(),
              voteSharePct: z.number(),
              candidates: z.array(WinnipegCandidateSchema),
            })
            .nullable(),
          wards: z.record(z.string(), z.any()),
        })
      )
      .min(1),
    wards: z
      .array(
        z.object({
          id: z.string().min(1),
          wardNumber: z.number().int(),
          name: z.string().min(1),
          currentCouncillor: z.string(),
          phone: z.string(),
          website: z.string(),
          neighbourhoods: z.string(),
          longestServingCouncillor: z.string(),
          distinctCouncillorsCount: z.number().int(),
          history: z.array(z.any()),
        })
      )
      .length(15),
    sourceUrl: SafeHttpsUrlSchema,
  }),
  manitobaMunicipalities: z
    .array(
      z.object({
        id: z.string().min(1),
        municipalNo: z.number().int().nullable(),
        name: z.string().min(1),
        rawName: z.string().min(1),
        type: z.string().min(1),
        population: z.number().int().nullable(),
        headRole: z.string().min(1),
        headName: z.string().min(1),
        caoName: z.string(),
        councillors: z.array(z.string()),
        partyStatus: z.string().optional(),
        phone: z.string().nullable(),
        email: z.string().nullable(),
        website: z.string().nullable(),
        sourceUrl: SafeHttpsUrlSchema,
      })
    )
    .min(100),
});

export const MunicipalitiesGeoJsonSchema = z.object({
  type: z.literal('FeatureCollection'),
  name: z.string().min(1),
  features: z
    .array(
      z.object({
        type: z.literal('Feature'),
        properties: z.object({
          id: z.string().min(1),
          municipalNo: z.number().int(),
          name: z.string().min(1),
          type: z.string().min(1),
        }),
        geometry: z.object({
          type: z.enum(['Polygon', 'MultiPolygon']),
          coordinates: z.array(z.any()).min(1),
        }),
      })
    )
    .min(100),
});

export function validateLegislatureMembersDataset(raw: unknown): LegislatureMembersDataset {
  return LegislatureMembersDatasetSchema.parse(
    sanitizeJsonValue(raw)
  ) as unknown as LegislatureMembersDataset;
}

export function validateMunicipalDataset(raw: unknown): MunicipalDataset {
  return MunicipalDatasetSchema.parse(sanitizeJsonValue(raw)) as unknown as MunicipalDataset;
}

export function validateMunicipalitiesGeoJson(raw: unknown): MunicipalitiesGeoJson {
  return MunicipalitiesGeoJsonSchema.parse(
    sanitizeJsonValue(raw)
  ) as unknown as MunicipalitiesGeoJson;
}

export function parseAndValidateBundleJson(jsonText: string): {
  elections: ElectionsDataset;
  districts: DistrictsDataset;
} {
  if (new Blob([jsonText]).size > MAX_UPLOAD_BYTES) {
    throw new Error('Dataset file exceeds 15 MB safety limit.');
  }
  const parsed = JSON.parse(jsonText);
  const sanitized = sanitizeJsonValue(parsed);
  return BundleImportSchema.parse(sanitized) as unknown as {
    elections: ElectionsDataset;
    districts: DistrictsDataset;
  };
}

