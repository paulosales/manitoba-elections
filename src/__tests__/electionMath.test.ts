import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateDistrictsDataset, validateElectionsDataset } from '../schemas/datasetSchema';
import { buildFutureSnapshot, computeDominationInWindow } from '../utils/electionMath';

const DATA_DIR = path.resolve(process.cwd(), 'public/data');

describe('Party Domination & Future Projection Engine', () => {
  const elections = validateElectionsDataset(
    JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'elections.json'), 'utf8'))
  );
  const districts = validateDistrictsDataset(
    JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'districts.json'), 'utf8'))
  );
  const currentSnap = elections.snapshots.find((s) => s.kind === 'current')!;

  it('computes accurate party domination metrics within custom time windows', () => {
    const concordia = districts.districts.find((d) => d.id === 'concordia')!;
    const fullDom = computeDominationInWindow(concordia, 1995, 2026);
    expect(fullDom.dominantParty).toBe('NDP');
    expect(fullDom.dominancePct).toBe(100);
    expect(fullDom.flips).toBe(0);
    expect(fullDom.classification).toBe('NDP Fortress');

    const tuxedo = districts.districts.find((d) => d.id === 'tuxedo')!;
    const tuxModern = computeDominationInWindow(tuxedo, 2019, 2026);
    expect(tuxModern.flips).toBe(1); // Flipped PC -> NDP in 2024
  });

  it('projects future 2027 seats dynamically under uniform party swing', () => {
    const pcWave = buildFutureSnapshot(currentSnap, districts.districts, {
      model: 'swing',
      targetYear: 2027,
      swings: { NDP: -10, PC: 10, MLP: 0, GPM: 0, KP: 0 },
    });

    expect(pcWave.isProjection).toBe(true);
    expect(pcWave.year).toBe(2027);
    const totalSeats = Object.values(pcWave.seatCounts).reduce((a, b) => a + (b ?? 0), 0);
    expect(totalSeats).toBe(57);
    expect(pcWave.seatCounts.PC ?? 0).toBeGreaterThan(currentSnap.seatCounts.PC ?? 0);
  });

  it('projects historical domination baseline accurately', () => {
    const domProj = buildFutureSnapshot(currentSnap, districts.districts, {
      model: 'dominance_trend',
      targetYear: 2031,
      swings: { NDP: 0, PC: 0, MLP: 0, GPM: 0, KP: 0 },
    });
    expect(domProj.year).toBe(2031);
    expect(domProj.results['concordia'].winner.party).toBe('NDP');
    expect(domProj.results['steinbach'].winner.party).toBe('PC');
  });
});

