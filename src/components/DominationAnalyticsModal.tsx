import React, { useMemo, useState } from 'react';
import { Crown, X } from 'lucide-react';
import type {
  DistrictProfile,
  ElectionSnapshot,
  PartyId,
  PartyMeta,
} from '../types/election';
import { computeDominationInWindow, getPartyMeta, MAJORITY_THRESHOLD, TOTAL_SEATS } from '../utils/electionMath';

interface DominationAnalyticsModalProps {
  open: boolean;
  onClose: () => void;
  snapshots: ElectionSnapshot[];
  districts: DistrictProfile[];
  parties: Record<PartyId, PartyMeta>;
  onSelectDistrictAndYear: (districtId: string, snapshotIndex: number) => void;
}

export const DominationAnalyticsModal: React.FC<DominationAnalyticsModalProps> = ({
  open,
  onClose,
  snapshots,
  districts,
  parties,
  onSelectDistrictAndYear,
}) => {
  const [regionFilter, setRegionFilter] = useState<string>('ALL');
  const [classFilter, setClassFilter] = useState<string>('ALL');

  const keyColumns = useMemo(
    () =>
      snapshots.filter(
        (s) => s.kind === 'general' || s.kind === 'current' || s.id === 'future-2027'
      ),
    [snapshots]
  );

  const filteredDistricts = useMemo(() => {
    return districts.filter((d) => {
      if (regionFilter !== 'ALL' && d.region !== regionFilter) return false;
      if (classFilter === 'SWING' && d.domination.flips < 2) return false;
      if (classFilter === 'FORTRESS' && d.domination.dominancePct < 85) return false;
      return true;
    });
  }, [districts, regionFilter, classFilter]);

  if (!open) return null;

  const partyOrder: PartyId[] = ['NDP', 'PC', 'MLP', 'IND', 'GPM', 'KP', 'OTHER'];

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Party Domination Analytics">
      <div className="modal-card modal-card--wide">
        <div className="modal-header">
          <div className="modal-title-group">
            <Crown className="icon-md" />
            <div>
              <h2>Manitoba Party Domination Over Time (1995–2027+)</h2>
              <p>Click any cell in the 57-district matrix to inspect that riding and jump to that year.</p>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close modal">
            <X className="icon-sm" />
          </button>
        </div>

        {/* Province-Wide Seat Balance Chart (SVG) */}
        <div className="analytics-chart-section">
          <h3>Legislature Seat Trajectory (57 Total · 29 Majority)</h3>
          <svg viewBox="0 0 760 190" className="seat-trajectory-svg" role="img" aria-label="Seat distribution across elections">
            {/* Majority line */}
            <line
              x1={42}
              y1={150 - (MAJORITY_THRESHOLD / TOTAL_SEATS) * 125}
              x2={744}
              y2={150 - (MAJORITY_THRESHOLD / TOTAL_SEATS) * 125}
              stroke="#64748B"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            <text
              x={8}
              y={154 - (MAJORITY_THRESHOLD / TOTAL_SEATS) * 125}
              fontSize={10}
              fill="#475569"
            >
              29 Maj
            </text>

            {keyColumns.map((snap, idx) => {
              const colW = 700 / Math.max(1, keyColumns.length);
              const barW = Math.min(36, colW * 0.56);
              const x = 44 + idx * colW + (colW - barW) / 2;
              let yBottom = 150;

              return (
                <g key={snap.id}>
                  {partyOrder.map((pid) => {
                    const seats = snap.seatCounts[pid] ?? 0;
                    if (seats <= 0) return null;
                    const h = (seats / TOTAL_SEATS) * 125;
                    const y = yBottom - h;
                    yBottom = y;
                    return (
                      <rect
                        key={pid}
                        x={x}
                        y={y}
                        width={barW}
                        height={h}
                        fill={getPartyMeta(pid, parties).color}
                        opacity={snap.isProjection ? 0.78 : 0.95}
                      >
                        <title>{`${snap.label}: ${getPartyMeta(pid, parties).shortName} ${seats} seats`}</title>
                      </rect>
                    );
                  })}
                  <text x={x + barW / 2} y={168} textAnchor="middle" fontSize={10.5} fill="#0F172A">
                    {snap.shortLabel}
                  </text>
                  <text x={x + barW / 2} y={182} textAnchor="middle" fontSize={9} fill="#64748B">
                    {(() => {
                      const top = partyOrder
                        .map((p) => ({ p, n: snap.seatCounts[p] ?? 0 }))
                        .sort((a, b) => b.n - a.n)[0];
                      return top ? `${getPartyMeta(top.p, parties).shortName} ${top.n}` : '';
                    })()}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Filters for District Matrix */}
        <div className="matrix-filters">
          <label className="filter-label">
            <span>Region:</span>
            <select
              className="select-compact"
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
            >
              <option value="ALL">All Regions (57)</option>
              <option value="Winnipeg">Winnipeg (32)</option>
              <option value="Southern & Interlake">Southern &amp; Interlake</option>
              <option value="Brandon & Westman">Brandon &amp; Westman</option>
              <option value="Northern Manitoba">Northern Manitoba</option>
            </select>
          </label>

          <label className="filter-label">
            <span>Dominance Type:</span>
            <select
              className="select-compact"
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
            >
              <option value="ALL">All Districts ({districts.length})</option>
              <option value="SWING">Battleground / Swing (2+ flips)</option>
              <option value="FORTRESS">Fortress (85%+ one party)</option>
            </select>
          </label>
        </div>

        {/* 57-District Historical Party Domination Grid */}
        <div className="matrix-scroll">
          <table className="domination-table">
            <thead>
              <tr>
                <th>District</th>
                <th>Dominance</th>
                <th>Flips</th>
                {keyColumns.map((col) => (
                  <th key={col.id}>{col.shortLabel}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredDistricts.map((d) => {
                const dom = computeDominationInWindow(d, 1995, 2026);
                const domMeta = getPartyMeta(dom.dominantParty, parties);
                return (
                  <tr key={d.id}>
                    <td className="matrix-name-cell">
                      <strong>{d.name}</strong>
                      <span>{d.region}</span>
                    </td>
                    <td>
                      <span className={`dom-badge dom-badge--${dom.dominantParty}`}>
                        {domMeta.shortName} {dom.dominancePct}%
                      </span>
                    </td>
                    <td className="matrix-flips-cell">{dom.flips}</td>
                    {keyColumns.map((col) => {
                      const snapIdx = snapshots.findIndex((s) => s.id === col.id);
                      const rec = col.resultsUnified2018[d.id];
                      const p = rec?.winner.party ?? 'OTHER';
                      const pMeta = getPartyMeta(p, parties);
                      return (
                        <td key={`${d.id}-${col.id}`} className="matrix-cell-td">
                          <button
                            type="button"
                            className={`matrix-cell-btn matrix-cell-btn--${p}`}
                            title={`${d.name} (${col.label}): ${rec?.winner.name ?? ''} (${pMeta.shortName})`}
                            onClick={() => {
                              onSelectDistrictAndYear(d.id, snapIdx >= 0 ? snapIdx : 0);
                              onClose();
                            }}
                          >
                            {pMeta.shortName}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

