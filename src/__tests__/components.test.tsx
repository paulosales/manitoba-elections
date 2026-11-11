import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  validateBoundariesGeoJson,
  validateDistrictsDataset,
  validateElectionsDataset,
} from '../schemas/datasetSchema';
import { TimelineBar } from '../components/TimelineBar';
import { DistrictPanel } from '../components/DistrictPanel';
import { ManitobaMap } from '../components/ManitobaMap';
import { FutureSimulatorBar } from '../components/FutureSimulatorBar';

const DATA_DIR = path.resolve(process.cwd(), 'public/data');

describe('Manitoba Elections PWA Components', () => {
  const geo18 = validateBoundariesGeoJson(
    JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'boundaries-2018.geojson'), 'utf8'))
  );
  const elections = validateElectionsDataset(
    JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'elections.json'), 'utf8'))
  );
  const districts = validateDistrictsDataset(
    JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'districts.json'), 'utf8'))
  );
  const districtsById = new Map(districts.districts.map((d) => [d.id, d]));

  it('steps backward to past and forward to future on TimelineBar', () => {
    const onSelectIndex = vi.fn();
    render(
      <TimelineBar
        snapshots={elections.snapshots}
        activeIndex={7}
        onSelectIndex={onSelectIndex}
        isPlaying={false}
        onTogglePlay={vi.fn()}
        colorMode="party"
        onChangeColorMode={vi.fn()}
        dominationFromYear={1995}
        onChangeDominationFromYear={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Go to past election/i }));
    expect(onSelectIndex).toHaveBeenCalledWith(6);

    fireEvent.click(screen.getByRole('button', { name: /Go to future election/i }));
    expect(onSelectIndex).toHaveBeenCalledWith(8);
  });

  it('renders 57 clickable district polygons and notifies on click', () => {
    const onSelectDistrict = vi.fn();
    const curSnap = elections.snapshots.find((s) => s.kind === 'current')!;
    render(
      <ManitobaMap
        geoJson={geo18}
        resultsMap={curSnap.results}
        previousResultsMap={null}
        districtsById={districtsById}
        parties={elections.parties}
        selectedDistrictId="fort-rouge"
        onSelectDistrict={onSelectDistrict}
        colorMode="party"
        regionView="all"
        onChangeRegionView={vi.fn()}
        dominationWindow={[1995, 2026]}
        boundaryEra="2018"
        unifiedBoundaries={false}
        onToggleUnifiedBoundaries={vi.fn()}
      />
    );

    const brandonEast = screen.getByRole('button', { name: /Brandon East:/i });
    fireEvent.click(brandonEast);
    expect(onSelectDistrict).toHaveBeenCalledWith('brandon-east');
  });

  it('renders historical MLAs and triggers year jump in DistrictPanel', () => {
    const onJumpToYear = vi.fn();
    const curSnap = elections.snapshots.find((s) => s.kind === 'current')!;
    const tuxedo = districtsById.get('tuxedo')!;
    render(
      <DistrictPanel
        district={tuxedo}
        activeSnapshot={curSnap}
        activeRecord={curSnap.results['tuxedo']}
        parties={elections.parties}
        dominationWindow={[1995, 2026]}
        snapshots={elections.snapshots}
        onJumpToYear={onJumpToYear}
      />
    );

    expect(screen.getByText('Tuxedo')).toBeInTheDocument();
    expect(screen.getAllByText(/Carla Compton/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Heather Stefanson/i).length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole('button', { name: /2016.*Stefanson/i }));
    expect(onJumpToYear).toHaveBeenCalledWith(2016, 'ge-2016');
  });

  it('updates future swing configuration on preset click', () => {
    const onChange = vi.fn();
    render(
      <FutureSimulatorBar
        config={{
          model: 'swing',
          targetYear: 2027,
          swings: { NDP: 0, PC: 0, MLP: 0, GPM: 0, KP: 0 },
        }}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /NDP \+6% Wave/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        swings: { NDP: 6, PC: -5, MLP: -1, GPM: 0, KP: 0 },
      })
    );
  });
});
