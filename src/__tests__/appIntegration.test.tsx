import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';

const DATA_DIR = path.resolve(process.cwd(), 'public/data');

describe('Full App Integration (Provincial, Legislature Archive & Municipal Views)', () => {
  const files: Record<string, string> = {
    '/data/boundaries-2018.geojson': fs.readFileSync(
      path.join(DATA_DIR, 'boundaries-2018.geojson'),
      'utf8'
    ),
    '/data/boundaries-2008.geojson': fs.readFileSync(
      path.join(DATA_DIR, 'boundaries-2008.geojson'),
      'utf8'
    ),
    '/data/elections.json': fs.readFileSync(path.join(DATA_DIR, 'elections.json'), 'utf8'),
    '/data/districts.json': fs.readFileSync(path.join(DATA_DIR, 'districts.json'), 'utf8'),
    '/data/metadata.json': fs.readFileSync(path.join(DATA_DIR, 'metadata.json'), 'utf8'),
    '/data/legislature-members.json': fs.readFileSync(
      path.join(DATA_DIR, 'legislature-members.json'),
      'utf8'
    ),
    '/data/municipal.json': fs.readFileSync(path.join(DATA_DIR, 'municipal.json'), 'utf8'),
    '/data/municipalities.geojson': fs.readFileSync(
      path.join(DATA_DIR, 'municipalities.geojson'),
      'utf8'
    ),
  };

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        const body = files[url];
        if (!body) {
          return new Response('Not found', { status: 404 });
        }
        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('navigates Provincial Map, Legislature Members (Current & Historical), and Municipal Councils & Wards', async () => {
    render(<App />);

    // Wait for initial load (Current Assembly 2026 + Fort Rouge / Wab Kinew)
    await waitFor(() => {
      expect(screen.getByText('Current Assembly (2026)')).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'Fort Rouge' })).toBeInTheDocument();
    expect(screen.getAllByText(/Wab Kinew/i).length).toBeGreaterThanOrEqual(1);

    // Jump to 2016 General Election in the past
    fireEvent.click(screen.getByRole('button', { name: '2016' }));
    expect(screen.getByText('2016 General Election')).toBeInTheDocument();
    expect(screen.getByText(/PC Majority \(40\/57/i)).toBeInTheDocument();

    // Switch to Domination color mode
    fireEvent.click(screen.getByRole('button', { name: 'Domination' }));
    expect(screen.getByText(/Darker shade = higher share of terms held/i)).toBeInTheDocument();

    // Jump to Future 2027* Projection and apply PC +6% Comeback
    fireEvent.click(screen.getByRole('button', { name: /2027\*/i }));
    expect(screen.getByText(/Future Scenario Simulator \(2027 Projection\)/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /PC \+6% Comeback/i }));
    expect(screen.getByText('PROJECTED FUTURE SCENARIO')).toBeInTheDocument();

    // Switch to Legislature Members (Current & Historical MLAs 1870-2026)
    fireEvent.click(screen.getByRole('button', { name: /Legislature Members/i }));
    expect(screen.getByText(/Total MLAs Archived \(1870–2026\)/i)).toBeInTheDocument();
    const mlaSearch = screen.getByLabelText('Search Legislature Members');
    fireEvent.change(mlaSearch, { target: { value: 'Gary Doer' } });
    expect(screen.getByText(/Gary Doer/i)).toBeInTheDocument();

    // Switch to Municipal Councils & Wards
    fireEvent.click(screen.getByRole('button', { name: /Municipal Councils & Wards/i }));
    expect(screen.getByText('Current Winnipeg City Council (2026)')).toBeInTheDocument();
    expect(screen.getAllByText(/Scott Gillingham/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: /Ward 1 Old Kildonan: Greg McFarlane/i })).toBeInTheDocument();

    // Switch Winnipeg ward color mode to Party Status (Non-Partisan / Independent)
    fireEvent.click(screen.getByRole('button', { name: 'Party Status' }));
    expect(screen.getByText(/Non-Partisan \/ Independent \(15 Wards/i)).toBeInTheDocument();

    // Jump back in time to 1974 Winnipeg Election (Mayor Steve Juba)
    fireEvent.click(screen.getByRole('button', { name: '1974' }));
    expect(screen.getByText('1974 Winnipeg Municipal Election')).toBeInTheDocument();
    expect(screen.getAllByText(/Steve Juba/i).length).toBeGreaterThanOrEqual(1);

    // Switch to All Manitoba Municipalities (135 Councils)
    fireEvent.click(screen.getByRole('tab', { name: /All Manitoba Municipalities/i }));
    const muniSearch = screen.getByLabelText('Search Manitoba municipalities');
    fireEvent.change(muniSearch, { target: { value: 'Brandon' } });
    expect(screen.getAllByText(/Brandon \(City\)/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Jeff Fawcett/i).length).toBeGreaterThanOrEqual(1);
  });
});
