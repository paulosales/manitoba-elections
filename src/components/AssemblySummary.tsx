import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  Building2,
  Database,
  Download,
  Map as MapIcon,
  Search,
  Users,
  WifiOff,
} from 'lucide-react';
import type {
  AppTab,
  DistrictElectionRecord,
  DistrictProfile,
  ElectionSnapshot,
  PartyId,
  PartyMeta,
} from '../types/election';
import {
  getPartyMeta,
  getSortedSeatEntries,
  MAJORITY_THRESHOLD,
  TOTAL_SEATS,
} from '../utils/electionMath';

interface AssemblySummaryProps {
  activeTab: AppTab;
  onChangeTab: (tab: AppTab) => void;
  totalMlaCount: number;
  totalMunicipalitiesCount: number;
  activeSnapshot: ElectionSnapshot;
  resultsMap: Record<string, DistrictElectionRecord>;
  districts: DistrictProfile[];
  parties: Record<PartyId, PartyMeta>;
  onSelectDistrict: (id: string) => void;
  onOpenAnalytics: () => void;
  onOpenImporter: () => void;
  isOffline: boolean;
  canInstallPwa: boolean;
  onInstallPwa: () => void;
}

export const AssemblySummary: React.FC<AssemblySummaryProps> = ({
  activeTab,
  onChangeTab,
  totalMlaCount,
  totalMunicipalitiesCount,
  activeSnapshot,
  resultsMap,
  districts,
  parties,
  onSelectDistrict,
  onOpenAnalytics,
  onOpenImporter,
  isOffline,
  canInstallPwa,
  onInstallPwa,
}) => {
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  const seatEntries = useMemo(
    () => getSortedSeatEntries(activeSnapshot.seatCounts),
    [activeSnapshot.seatCounts]
  );

  const leading = seatEntries[0];
  const isMajority = leading && leading.seats >= MAJORITY_THRESHOLD;

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return districts
      .filter((d) => {
        const rec = resultsMap[d.id];
        const mlaName = rec?.winner.name ?? d.currentMla.name;
        const histMatch = d.history.some((h) => h.winner.name.toLowerCase().includes(q));
        return (
          d.name.toLowerCase().includes(q) ||
          d.region.toLowerCase().includes(q) ||
          mlaName.toLowerCase().includes(q) ||
          histMatch
        );
      })
      .slice(0, 8);
  }, [query, districts, resultsMap]);

  return (
    <header className="top-header">
      <div className="brand-bar">
        <div className="brand-title-block">
          <img src="/icons/icon.svg" alt="" className="brand-logo" />
          <div>
            <h1 className="brand-title">Manitoba Elections &amp; Governance Atlas</h1>
            <p className="brand-subtitle">
              Provincial Districts (1995–2031) · MLAs (1870–2026) · Municipal Councils &amp; Wards
            </p>
          </div>
        </div>

        <div className="header-actions">
          {isOffline && (
            <span className="offline-pill" title="Running from offline PWA cache">
              <WifiOff className="icon-xs" />
              Offline Ready
            </span>
          )}

          {canInstallPwa && (
            <button type="button" className="action-btn action-btn--install" onClick={onInstallPwa}>
              <Download className="icon-xs" />
              Install App
            </button>
          )}

          <button type="button" className="action-btn" onClick={onOpenAnalytics}>
            <BarChart3 className="icon-xs" />
            Domination Matrix
          </button>

          <button type="button" className="action-btn" onClick={onOpenImporter}>
            <Database className="icon-xs" />
            Gov Data Importer
          </button>
        </div>
      </div>

      {/* Primary Section Tabs */}
      <nav className="primary-nav-bar" aria-label="Primary application sections">
        <button
          type="button"
          className={`nav-tab-btn ${activeTab === 'provincial' ? 'nav-tab-btn--active' : ''}`}
          onClick={() => onChangeTab('provincial')}
        >
          <MapIcon className="icon-xs" />
          Provincial Map (57 Districts)
        </button>

        <button
          type="button"
          className={`nav-tab-btn ${activeTab === 'legislature' ? 'nav-tab-btn--active' : ''}`}
          onClick={() => onChangeTab('legislature')}
        >
          <Users className="icon-xs" />
          Legislature Members ({totalMlaCount} MLAs)
        </button>

        <button
          type="button"
          className={`nav-tab-btn ${activeTab === 'municipal' ? 'nav-tab-btn--active' : ''}`}
          onClick={() => onChangeTab('municipal')}
        >
          <Building2 className="icon-xs" />
          Municipal Councils &amp; Wards ({totalMunicipalitiesCount})
        </button>
      </nav>

      {/* Seat Balance + Search Strip (shown on Provincial Map view) */}
      {activeTab === 'provincial' && (
        <div className="seat-summary-strip">
          <div className="seat-bar-container">
            <div className="seat-bar-labels">
              <div className="seat-badges">
                {seatEntries.map((entry) => (
                  <span key={entry.party} className="seat-chip">
                    <span className={`legend-swatch legend-swatch--${entry.party}`} />
                    <strong>{entry.meta.shortName}</strong>
                    <span>{entry.seats}</span>
                  </span>
                ))}
              </div>
              <span className="majority-status">
                {leading
                  ? `${leading.meta.shortName} ${isMajority ? 'Majority' : 'Minority'} (${leading.seats}/${TOTAL_SEATS} · 29 needed)`
                  : `${TOTAL_SEATS} Seats`}
              </span>
            </div>

            <svg
              viewBox="0 0 570 16"
              preserveAspectRatio="none"
              className="seat-bar-svg"
              role="img"
              aria-label="Manitoba Legislative Assembly seat distribution out of 57 seats"
            >
              {(() => {
                let xCursor = 0;
                return seatEntries.map((entry) => {
                  const w = (entry.seats / TOTAL_SEATS) * 570;
                  const el = (
                    <rect
                      key={entry.party}
                      x={xCursor}
                      y={2}
                      width={w}
                      height={12}
                      fill={entry.meta.color}
                    />
                  );
                  xCursor += w;
                  return el;
                });
              })()}
              <line
                x1={(MAJORITY_THRESHOLD / TOTAL_SEATS) * 570}
                y1={0}
                x2={(MAJORITY_THRESHOLD / TOTAL_SEATS) * 570}
                y2={16}
                stroke="#0F172A"
                strokeWidth={2}
                strokeDasharray="2 2"
              />
            </svg>
          </div>

          <div className="search-box-wrap">
            <div className="search-input-shell">
              <Search className="icon-xs search-icon" />
              <input
                type="search"
                value={query}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setTimeout(() => setSearchFocused(false), 180)}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search district or MLA (e.g. Tuxedo, Kinew, Doer)..."
                aria-label="Search district or MLA"
                className="search-input"
              />
            </div>

            {searchFocused && searchResults.length > 0 && (
              <div className="search-dropdown" role="listbox" aria-label="Matching districts">
                {searchResults.map((d) => {
                  const rec = resultsMap[d.id];
                  const party = rec?.winner.party ?? d.currentMla.party;
                  const mla = rec?.winner.name ?? d.currentMla.name;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      role="option"
                      aria-selected={false}
                      className="search-result-btn"
                      onMouseDown={() => {
                        onSelectDistrict(d.id);
                        setQuery('');
                        setSearchFocused(false);
                      }}
                    >
                      <div>
                        <strong>{d.name}</strong>
                        <span className="search-mla"> — {mla}</span>
                      </div>
                      <span className={`party-badge party-badge--${party}`}>
                        {getPartyMeta(party, parties).shortName}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
};
