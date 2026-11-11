import type {
  DistrictDomination,
  DistrictElectionRecord,
  DistrictProfile,
  ElectionSnapshot,
  FutureSwingConfig,
  PartyId,
  PartyMeta,
} from '../types/election';

export const DEFAULT_PARTY_META: Record<PartyId, PartyMeta> = {
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

export const MAJORITY_THRESHOLD = 29;
export const TOTAL_SEATS = 57;

export function getPartyMeta(party: PartyId, table?: Record<PartyId, PartyMeta>): PartyMeta {
  return table?.[party] ?? DEFAULT_PARTY_META[party] ?? DEFAULT_PARTY_META.OTHER;
}

/**
 * Computes party domination metrics for a district within an arbitrary [fromYear, toYear] window.
 */
export function computeDominationInWindow(
  district: DistrictProfile,
  fromYear = 1995,
  toYear = 2026
): DistrictDomination {
  const scoped = district.history.filter(
    (h) => h.year >= fromYear && h.year <= toYear && h.kind !== 'caucus_change'
  );
  const items = scoped.length > 0 ? scoped : district.history;

  const counts: Partial<Record<PartyId, number>> = {};
  for (const h of items) {
    counts[h.winner.party] = (counts[h.winner.party] ?? 0) + 1;
  }

  const total = items.length;
  const sorted = (Object.entries(counts) as Array<[PartyId, number]>).sort(
    (a, b) => b[1] - a[1]
  );
  const [dominantParty, dominantWins] = sorted[0] ?? ['OTHER' as PartyId, 0];
  const dominancePct = total > 0 ? Math.round((dominantWins / total) * 100) : 0;

  let flips = 0;
  for (let i = 1; i < items.length; i++) {
    if (items[i].winner.party !== items[i - 1].winner.party) {
      flips++;
    }
  }

  const streakParty = items[items.length - 1]?.winner.party ?? 'OTHER';
  let currentStreak = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].winner.party === streakParty) {
      currentStreak++;
    } else {
      break;
    }
  }

  let classification = 'Competitive Swing';
  if (dominancePct >= 85 && flips <= 1) {
    classification = `${DEFAULT_PARTY_META[dominantParty].shortName} Fortress`;
  } else if (dominancePct >= 65) {
    classification = `${DEFAULT_PARTY_META[dominantParty].shortName} Stronghold`;
  } else if (flips >= 3) {
    classification = 'Bellwether / Swing';
  } else if (dominancePct >= 55) {
    classification = `Leans ${DEFAULT_PARTY_META[dominantParty].shortName}`;
  }

  return {
    dominantParty,
    dominantWins,
    totalTerms: total,
    dominancePct,
    flips,
    currentStreakParty: streakParty,
    currentStreak,
    classification,
    partyWins: counts,
  };
}

/**
 * Generates a projected future Manitoba election snapshot (2027 scheduled or 2031 outlook)
 * from the verified current baseline and user-selected projection model / party swings.
 */
export function buildFutureSnapshot(
  currentSnapshot: ElectionSnapshot,
  districts: DistrictProfile[],
  config: FutureSwingConfig
): ElectionSnapshot {
  const districtMap = new Map(districts.map((d) => [d.id, d]));
  const projectedResults: Record<string, DistrictElectionRecord> = {};
  const seatCounts: Partial<Record<PartyId, number>> = {};

  for (const [slug, baseRec] of Object.entries(currentSnapshot.resultsUnified2018)) {
    const profile = districtMap.get(slug);
    let nextRecord: DistrictElectionRecord;

    if (config.model === 'status_quo') {
      nextRecord = {
        ...baseRec,
        note: `Projected ${config.targetYear} hold (current incumbent baseline)`,
        flippedFromCurrent: false,
      };
    } else if (config.model === 'dominance_trend' && profile) {
      const dom = profile.domination;
      const domParty = dom.dominantParty;
      const flipped = domParty !== baseRec.winner.party;
      const matchingCand = baseRec.candidates.find((c) => c.party === domParty);
      const projectedWinner = matchingCand
        ? { ...matchingCand, elected: true }
        : {
            name: `${DEFAULT_PARTY_META[domParty].shortName} Candidate (Proj.)`,
            party: domParty,
            partyRaw: domParty,
            votes: baseRec.winner.votes,
            voteSharePct: dom.dominancePct,
            elected: true,
          };

      nextRecord = {
        ...baseRec,
        winner: projectedWinner,
        flippedFromCurrent: flipped,
        note: `Historical dominance model (${dom.dominantWins}/${dom.totalTerms} terms held by ${DEFAULT_PARTY_META[domParty].shortName})`,
      };
    } else {
      // Uniform vote swing simulation starting from verified 2023-2026 baseline
      const adjusted = baseRec.candidates.map((cand) => {
        const delta =
          cand.party in config.swings
            ? config.swings[cand.party as keyof typeof config.swings]
            : 0;
        const shiftedPct = Math.max(0.2, cand.voteSharePct + delta);
        return { ...cand, shiftedPct };
      });

      // Ensure major parties exist in swing simulation if user swung a party not present in riding
      const sumRaw = adjusted.reduce((acc, c) => acc + c.shiftedPct, 0) || 100;
      const ballots = baseRec.ballotsCast || 8000;
      const renormalized = adjusted
        .map((c) => {
          const pct = Number(((c.shiftedPct / sumRaw) * 100).toFixed(2));
          return {
            name: c.name,
            party: c.party,
            partyRaw: c.partyRaw,
            votes: Math.round((pct / 100) * ballots),
            voteSharePct: pct,
            elected: false,
          };
        })
        .sort((a, b) => b.voteSharePct - a.voteSharePct);

      renormalized[0].elected = true;
      const winner = renormalized[0];
      const runnerUp = renormalized[1] ?? null;
      const marginVotes = runnerUp ? winner.votes - runnerUp.votes : winner.votes;
      const marginPct = runnerUp
        ? Number((winner.voteSharePct - runnerUp.voteSharePct).toFixed(2))
        : winner.voteSharePct;
      const flipped = winner.party !== baseRec.winner.party;

      nextRecord = {
        ...baseRec,
        winner: {
          ...winner,
          name: flipped
            ? `${DEFAULT_PARTY_META[winner.party].shortName} Gain (Proj.)`
            : winner.name,
        },
        runnerUpParty: runnerUp ? runnerUp.party : null,
        marginVotes,
        marginPct,
        candidates: renormalized,
        flippedFromCurrent: flipped,
        note: flipped
          ? `Projected flip from ${DEFAULT_PARTY_META[baseRec.winner.party].shortName} → ${DEFAULT_PARTY_META[winner.party].shortName}`
          : `Projected ${DEFAULT_PARTY_META[winner.party].shortName} hold`,
      };
    }

    seatCounts[nextRecord.winner.party] = (seatCounts[nextRecord.winner.party] ?? 0) + 1;
    projectedResults[slug] = nextRecord;
  }

  const date = config.targetYear === 2027 ? '2027-10-05' : '2031-10-07';
  const modelLabel =
    config.model === 'swing'
      ? 'Uniform Swing Simulator'
      : config.model === 'dominance_trend'
        ? 'Historical Domination Baseline'
        : 'Incumbent Hold Baseline';

  return {
    id: `future-${config.targetYear}`,
    kind: 'future',
    year: config.targetYear,
    date,
    label: `${config.targetYear} Projected Election`,
    shortLabel: `${config.targetYear}*`,
    subtitle: `PROJECTED SCENARIO — ${modelLabel}`,
    boundaryEra: '2018',
    sourceUrl: 'https://www.electionsmanitoba.ca/en/Results',
    seatCounts,
    results: projectedResults,
    resultsUnified2018: projectedResults,
    isProjection: true,
  };
}

/**
 * Returns fill opacity / shading intensity based on victory margin or dominance strength.
 */
export function getDistrictFillColor(
  baseHex: string,
  strengthPct: number,
  mode: 'party' | 'domination' | 'flips',
  isFlipped: boolean
): { fill: string; opacity: number } {
  if (mode === 'flips') {
    return {
      fill: baseHex,
      opacity: isFlipped ? 0.96 : 0.25,
    };
  }
  if (mode === 'domination') {
    // Dominance % ranges ~35 to 100
    const normalized = Math.max(0.45, Math.min(0.98, 0.35 + (strengthPct / 100) * 0.65));
    return { fill: baseHex, opacity: Number(normalized.toFixed(2)) };
  }
  // Standard party color with crisp readable saturation; slight margin nuance
  const opacity = strengthPct >= 20 ? 0.95 : strengthPct >= 8 ? 0.85 : 0.74;
  return { fill: baseHex, opacity };
}

/**
 * Computes seat breakdown sorted by seat count descending.
 */
export function getSortedSeatEntries(
  seatCounts: Partial<Record<PartyId, number>>
): Array<{ party: PartyId; seats: number; meta: PartyMeta }> {
  return (Object.entries(seatCounts) as Array<[PartyId, number]>)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([party, seats]) => ({
      party,
      seats,
      meta: getPartyMeta(party),
    }));
}

