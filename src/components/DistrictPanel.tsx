import React from 'react';
import { Award, Calendar, ExternalLink, History, TrendingUp, UserCheck } from 'lucide-react';
import type {
  DistrictElectionRecord,
  DistrictProfile,
  ElectionSnapshot,
  PartyId,
  PartyMeta,
} from '../types/election';
import { isSafeHttpsUrl } from '../schemas/datasetSchema';
import { computeDominationInWindow, getPartyMeta } from '../utils/electionMath';

interface DistrictPanelProps {
  district: DistrictProfile | null;
  activeSnapshot: ElectionSnapshot;
  activeRecord: DistrictElectionRecord | null;
  parties: Record<PartyId, PartyMeta>;
  dominationWindow: [number, number];
  snapshots: ElectionSnapshot[];
  onJumpToYear: (year: number, eventId: string) => void;
}

export const DistrictPanel: React.FC<DistrictPanelProps> = ({
  district,
  activeSnapshot,
  activeRecord,
  parties,
  dominationWindow,
  snapshots,
  onJumpToYear,
}) => {
  if (!district || !activeRecord) {
    return (
      <aside className="inspector-card inspector-card--empty" aria-label="District Details">
        <div className="empty-state">
          <UserCheck className="empty-icon" />
          <h3>Select a Manitoba Electoral District</h3>
          <p>
            Click any riding on the map or inside the Winnipeg inset to inspect its MLA representative, party vote share, and complete 1995–2026 historical timeline.
          </p>
        </div>
      </aside>
    );
  }

  const winnerMeta = getPartyMeta(activeRecord.winner.party, parties);
  const domination = computeDominationInWindow(
    district,
    dominationWindow[0],
    dominationWindow[1]
  );
  const domMeta = getPartyMeta(domination.dominantParty, parties);

  const safeMlaProfileUrl = isSafeHttpsUrl(activeRecord.winner.profileUrl)
    ? activeRecord.winner.profileUrl
    : isSafeHttpsUrl(district.currentMla.profileUrl) && activeSnapshot.kind === 'current'
      ? district.currentMla.profileUrl
      : null;

  const sortedDomParties = (Object.entries(domination.partyWins) as Array<[PartyId, number]>)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  const historyDesc = [...district.history].reverse();

  return (
    <aside className="inspector-card" aria-label={`District inspector for ${district.name}`}>
      {/* Header */}
      <div className="inspector-header">
        <div>
          <span className="region-chip">{district.region}</span>
          <h2 className="inspector-title">{district.name}</h2>
        </div>
        <span className={`party-pill party-pill--${activeRecord.winner.party}`}>
          {winnerMeta.shortName}
        </span>
      </div>

      {/* Representative Card at Active Time Point */}
      <div className="mla-spotlight">
        <div className="mla-spotlight-label">
          <span>
            {activeSnapshot.isProjection
              ? `Projected MLA (${activeSnapshot.year})`
              : `Representative MLA (${activeSnapshot.shortLabel})`}
          </span>
          {activeRecord.winner.isMinisterial && (
            <span className="cabinet-badge">Cabinet / Hon.</span>
          )}
        </div>

        <div className="mla-name-row">
          <strong className="mla-name">
            {activeRecord.winner.isMinisterial ? 'Hon. ' : ''}
            {activeRecord.winner.name}
          </strong>
          {safeMlaProfileUrl && (
            <a
              href={safeMlaProfileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ext-link"
              title="Official Legislative Assembly of Manitoba profile"
            >
              gov.mb.ca <ExternalLink className="icon-xxs" />
            </a>
          )}
        </div>

        <div className="mla-party-line">
          {winnerMeta.name}
          {activeRecord.winner.partyRaw &&
          activeRecord.winner.partyRaw.toUpperCase() !== activeRecord.winner.party
            ? ` (${activeRecord.winner.partyRaw})`
            : ''}
        </div>

        {activeRecord.note && <div className="context-note">{activeRecord.note}</div>}
        {activeRecord.isPredecessorBoundary && activeRecord.originalDivisionName && (
          <div className="context-note">
            Predecessor riding prior to boundary redistribution:{' '}
            <strong>{activeRecord.originalDivisionName}</strong>
          </div>
        )}

        {/* Metrics Row */}
        <div className="metrics-grid">
          <div className="metric-box">
            <span className="metric-lbl">Vote Share</span>
            <strong className="metric-val">
              {activeRecord.winner.voteSharePct > 0
                ? `${activeRecord.winner.voteSharePct.toFixed(1)}%`
                : 'N/A'}
            </strong>
          </div>
          <div className="metric-box">
            <span className="metric-lbl">Victory Margin</span>
            <strong className="metric-val">
              {activeRecord.marginPct > 0 ? `+${activeRecord.marginPct.toFixed(1)}%` : '—'}
            </strong>
          </div>
          <div className="metric-box">
            <span className="metric-lbl">Turnout</span>
            <strong className="metric-val">
              {activeRecord.turnoutPct ? `${activeRecord.turnoutPct.toFixed(1)}%` : 'N/A'}
            </strong>
          </div>
        </div>
      </div>

      {/* Candidate Breakdown (SVG bar chart, zero inline CSS styles) */}
      <div className="inspector-section">
        <h3 className="section-heading">
          <TrendingUp className="icon-xs" />
          Vote Breakdown ({activeSnapshot.shortLabel})
        </h3>
        <div className="candidate-list">
          {activeRecord.candidates.slice(0, 6).map((cand, i) => {
            const pMeta = getPartyMeta(cand.party, parties);
            const barPct = Math.max(2, Math.min(100, cand.voteSharePct));
            return (
              <div key={`${cand.name}-${i}`} className="candidate-row">
                <div className="candidate-meta">
                  <span className="candidate-name">
                    <span className={`legend-swatch legend-swatch--${cand.party}`} />
                    {cand.name}
                    <span className="candidate-party-tag">({pMeta.shortName})</span>
                  </span>
                  <span className="candidate-nums">
                    {cand.votes > 0 ? `${cand.votes.toLocaleString()} · ` : ''}
                    <strong>{cand.voteSharePct.toFixed(1)}%</strong>
                  </span>
                </div>
                <svg
                  viewBox="0 0 100 6"
                  preserveAspectRatio="none"
                  className="candidate-bar-svg"
                  aria-hidden="true"
                >
                  <rect x={0} y={0} width={100} height={6} rx={3} fill="#E2E8F0" />
                  <rect x={0} y={0} width={barPct} height={6} rx={3} fill={pMeta.color} />
                </svg>
              </div>
            );
          })}
        </div>
      </div>

      {/* Historical Party Domination Summary */}
      <div className="inspector-section">
        <div className="section-heading-row">
          <h3 className="section-heading">
            <Award className="icon-xs" />
            Party Domination ({dominationWindow[0]}–{dominationWindow[1]})
          </h3>
          <span className={`dom-badge dom-badge--${domination.dominantParty}`}>
            {domination.classification}
          </span>
        </div>

        <p className="dom-summary-text">
          <strong>{domMeta.shortName}</strong> won{' '}
          <strong>
            {domination.dominantWins} of {domination.totalTerms}
          </strong>{' '}
          elections ({domination.dominancePct}%), with{' '}
          <strong>{domination.flips}</strong> party{' '}
          {domination.flips === 1 ? 'flip' : 'flips'}. Current streak:{' '}
          <strong>
            {domination.currentStreak}{' '}
            {getPartyMeta(domination.currentStreakParty, parties).shortName}
          </strong>{' '}
          {domination.currentStreak === 1 ? 'term' : 'terms'}.
        </p>

        {/* Stacked Domination Bar via SVG */}
        <svg
          viewBox="0 0 100 10"
          preserveAspectRatio="none"
          className="dom-stacked-svg"
          role="img"
          aria-label="Historical party win share bar"
        >
          {(() => {
            let offset = 0;
            return sortedDomParties.map(([pid, wins]) => {
              const pct = (wins / Math.max(1, domination.totalTerms)) * 100;
              const rect = (
                <rect
                  key={pid}
                  x={offset}
                  y={0}
                  width={pct}
                  height={10}
                  fill={getPartyMeta(pid, parties).color}
                />
              );
              offset += pct;
              return rect;
            });
          })()}
        </svg>

        <div className="dom-legend-chips">
          {sortedDomParties.map(([pid, wins]) => (
            <span key={pid} className="dom-chip">
              <span className={`legend-swatch legend-swatch--${pid}`} />
              {getPartyMeta(pid, parties).shortName}: {wins}
            </span>
          ))}
        </div>
      </div>

      {/* Complete Historical MLA Timeline */}
      <div className="inspector-section">
        <h3 className="section-heading">
          <History className="icon-xs" />
          Historical MLA Representatives
        </h3>
        <div className="history-timeline">
          {historyDesc.map((item) => {
            const pMeta = getPartyMeta(item.winner.party, parties);
            const hasMatchingSnapshot = snapshots.some(
              (s) => s.id === item.eventId || s.year === item.year
            );
            const isActiveEvent =
              activeSnapshot.id === item.eventId ||
              (activeSnapshot.year === item.year && activeSnapshot.kind === item.kind);

            return (
              <button
                key={item.eventId}
                type="button"
                disabled={!hasMatchingSnapshot}
                onClick={() => onJumpToYear(item.year, item.eventId)}
                className={`history-item ${isActiveEvent ? 'history-item--active' : ''}`}
              >
                <div className={`history-stripe history-stripe--${item.winner.party}`} />
                <div className="history-body">
                  <div className="history-top">
                    <span className="history-year">
                      <Calendar className="icon-xxs" />
                      {item.year}
                      {item.kind === 'byelection' && (
                        <span className="mini-tag">By-Election</span>
                      )}
                      {item.kind === 'caucus_change' && (
                        <span className="mini-tag">Caucus Change</span>
                      )}
                    </span>
                    <span className={`party-badge party-badge--${item.winner.party}`}>
                      {pMeta.shortName}
                    </span>
                  </div>
                  <div className="history-mla">
                    {item.winner.isMinisterial ? 'Hon. ' : ''}
                    {item.winner.name}
                    {item.winner.voteSharePct > 0 && (
                      <span className="history-pct">
                        {' '}
                        ({item.winner.voteSharePct.toFixed(1)}%)
                      </span>
                    )}
                  </div>
                  {item.isPredecessorBoundary && (
                    <div className="history-pred">
                      As {item.divisionNameAtTime}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
};

