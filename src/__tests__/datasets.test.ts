import fs from 'node:fs';
import path from 'node:path';
import { geoArea, type GeoPermissibleObjects } from 'd3-geo';
import { describe, expect, it } from 'vitest';
import {
  validateBoundariesGeoJson,
  validateDistrictsDataset,
  validateElectionsDataset,
  validateLegislatureMembersDataset,
  validateMetadataDataset,
  validateMunicipalDataset,
  validateMunicipalitiesGeoJson,
} from '../schemas/datasetSchema';

const DATA_DIR = path.resolve(process.cwd(), 'public/data');

describe('Imported Manitoba Government Datasets', () => {
  it('validates all generated GeoJSON & JSON datasets against strict Zod schemas', () => {
    const geo18 = validateBoundariesGeoJson(
      JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'boundaries-2018.geojson'), 'utf8'))
    );
    const geo08 = validateBoundariesGeoJson(
      JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'boundaries-2008.geojson'), 'utf8'))
    );
    const elections = validateElectionsDataset(
      JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'elections.json'), 'utf8'))
    );
    const districts = validateDistrictsDataset(
      JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'districts.json'), 'utf8'))
    );
    const metadata = validateMetadataDataset(
      JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'metadata.json'), 'utf8'))
    );
    const members = validateLegislatureMembersDataset(
      JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'legislature-members.json'), 'utf8'))
    );
    const municipal = validateMunicipalDataset(
      JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'municipal.json'), 'utf8'))
    );
    const muniGeo = validateMunicipalitiesGeoJson(
      JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'municipalities.geojson'), 'utf8'))
    );

    expect(geo18.features).toHaveLength(57);
    expect(geo08.features).toHaveLength(57);
    expect(districts.districts).toHaveLength(57);
    expect(elections.snapshots.length).toBeGreaterThanOrEqual(11);
    expect(metadata.counts.byElectionsImported).toBeGreaterThanOrEqual(17);
    expect(members.counts.current).toBe(57);
    expect(members.members.length).toBeGreaterThan(800);
    expect(municipal.winnipeg.wards).toHaveLength(15);
    expect(municipal.winnipeg.snapshots.length).toBeGreaterThanOrEqual(15);
    expect(municipal.manitobaMunicipalities.length).toBeGreaterThanOrEqual(130);
    expect(muniGeo.features.length).toBeGreaterThanOrEqual(150);
  });

  it('verifies historical seat totals and key Manitoba milestones', () => {
    const elections = validateElectionsDataset(
      JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'elections.json'), 'utf8'))
    );
    const districts = validateDistrictsDataset(
      JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'districts.json'), 'utf8'))
    );

    const ge1995 = elections.snapshots.find((s) => s.id === 'ge-1995')!;
    expect(ge1995.seatCounts).toEqual({ PC: 31, NDP: 23, MLP: 3 });

    const ge2016 = elections.snapshots.find((s) => s.id === 'ge-2016')!;
    expect(ge2016.seatCounts).toEqual({ PC: 40, NDP: 14, MLP: 3 });

    const ge2023 = elections.snapshots.find((s) => s.id === 'ge-2023')!;
    expect(ge2023.seatCounts).toEqual({ NDP: 34, PC: 22, MLP: 1 });

    // Verify 2024 Tuxedo By-Election flip (PC -> NDP)
    const tuxedo = districts.districts.find((d) => d.id === 'tuxedo')!;
    const tuxedo2024 = tuxedo.history.find((h) => h.date === '2024-06-18');
    expect(tuxedo2024?.winner.party).toBe('NDP');
    expect(tuxedo2024?.winner.name).toBe('Carla Compton');

    // Verify 2005 Fort Whyte By-Election PDF errata fix & 2011 casing (PC Hugh McFadyen)
    const fortWhyte = districts.districts.find((d) => d.id === 'fort-whyte')!;
    const fw2005 = fortWhyte.history.find((h) => h.date === '2005-12-13');
    expect(fw2005?.winner.party).toBe('PC');
    expect(fw2005?.winner.name).toBe('Hugh McFadyen');
    const fw2011 = fortWhyte.history.find((h) => h.date === '2011-10-04');
    expect(fw2011?.winner.name).toBe('Hugh McFadyen');

    // Verify 2026 The Pas-Kameesak By-Election
    const tpk = districts.districts.find((d) => d.id === 'the-pas-kameesak')!;
    const tpk2026 = tpk.history.find((h) => h.date === '2026-07-21');
    expect(tpk2026?.winner.party).toBe('NDP');
    expect(tpk2026?.winner.name).toBe('Jennifer Flett');

    // Verify Tyndall Park Independent Liberal properly maps to MLP
    const tp = districts.districts.find((d) => d.id === 'tyndall-park')!;
    expect(tp.currentMla.party).toBe('MLP');
  });

  it('matches Winnipeg historical ward aliases and RM of East St. Paul GeoJSON slug', () => {
    const municipal = validateMunicipalDataset(
      JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'municipal.json'), 'utf8'))
    );
    const muniGeo = validateMunicipalitiesGeoJson(
      JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'municipalities.geojson'), 'utf8'))
    );

    const wpg1992 = municipal.winnipeg.snapshots.find((s) => s.year === 1992)!;
    expect(wpg1992.wards['elmwood-east-kildonan']?.councillor).toBeTruthy();
    expect(wpg1992.wards['river-heights-fort-garry']?.councillor).toBeTruthy();
    expect(wpg1992.wards['charleswood-tuxedo-westwood']?.councillor).toBeTruthy();

    const eastStPaulGeo = muniGeo.features.find((f) => f.properties.municipalNo === 121);
    const eastStPaulRec = municipal.manitobaMunicipalities.find(
      (m) => m.id === eastStPaulGeo?.properties.id
    );
    expect(eastStPaulGeo?.properties.id).toBe('east-st-paul-rm');
    expect(eastStPaulRec?.name).toContain('East St. Paul');
    expect(eastStPaulRec?.partyStatus).toBe('Non-Partisan (Independent)');

    // Every municipal polygon must obey D3 spherical winding (no inverted whole-globe features)
    for (const wf of municipal.winnipeg.wardsGeoJson.features) {
      expect(geoArea(wf as unknown as GeoPermissibleObjects)).toBeLessThan(0.01);
    }
    for (const mf of muniGeo.features) {
      expect(geoArea(mf as unknown as GeoPermissibleObjects)).toBeLessThan(0.01);
    }
  });
});

