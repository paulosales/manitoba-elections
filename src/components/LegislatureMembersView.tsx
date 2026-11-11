import React, { useMemo, useState } from 'react';
import {
  Award,
  BookOpen,
  Calendar,
  ExternalLink,
  MapPin,
  Search,
  Users,
} from 'lucide-react';
import type {
  DistrictProfile,
  LegislatureMemberRecord,
  LegislatureMembersDataset,
  PartyId,
  PartyMeta,
} from '../types/election';
import { isSafeHttpsUrl } from '../schemas/datasetSchema';
import { getPartyMeta } from '../utils/electionMath';

interface LegislatureMembersViewProps {
  dataset: LegislatureMembersDataset;
  parties: Record<PartyId, PartyMeta>;
  modernDistricts: DistrictProfile[];
  onJumpToDistrictOnMap: (districtId: string) => void;
}

const PAGE_SIZE = 48;

export const LegislatureMembersView: React.FC<LegislatureMembersViewProps> = ({
  dataset,
  parties,
  modernDistricts,
  onJumpToDistrictOnMap,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'current' | 'former_living' | 'deceased'>('ALL');
  const [partyFilter, setPartyFilter] = useState<string>('ALL');
  const [eraFilter, setEraFilter] = useState<'ALL' | '2026' | '1995-2026' | '1950-1994' | '1870-1949'>('ALL');
  const [constituencyFilter, setConstituencyFilter] = useState<string>('ALL');
  const [cabinetOnly, setCabinetOnly] = useState(false);
  const [page, setPage] = useState(1);

  const modernSlugSet = useMemo(
    () => new Set(modernDistricts.map((d) => d.id)),
    [modernDistricts]
  );

  const allConstituencies = useMemo(() => {
    const names = new Set<string>();
    for (const m of dataset.members) {
      if (m.constituency) names.add(m.constituency);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [dataset.members]);

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dataset.members.filter((m) => {
      if (statusFilter !== 'ALL' && m.status !== statusFilter) return false;
      if (partyFilter !== 'ALL' && m.party !== partyFilter) return false;
      if (constituencyFilter !== 'ALL' && m.constituency !== constituencyFilter) return false;
      if (cabinetOnly && !m.isMinisterial) return false;

      if (eraFilter !== 'ALL') {
        const first = m.firstElectedYear ?? 0;
        const last = m.lastYearServed ?? first;
        if (eraFilter === '2026' && m.status !== 'current') return false;
        if (eraFilter === '1995-2026' && last < 1995) return false;
        if (eraFilter === '1950-1994' && (last < 1950 || first > 1994)) return false;
        if (eraFilter === '1870-1949' && first > 1949) return false;
      }

      if (q) {
        const inName = m.name.toLowerCase().includes(q);
        const inConst = m.constituency.toLowerCase().includes(q);
        const inParty = m.partyRaw.toLowerCase().includes(q);
        const inPort = m.portfolios.some((p) => p.toLowerCase().includes(q));
        if (!inName && !inConst && !inParty && !inPort) return false;
      }

      return true;
    });
  }, [dataset.members, search, statusFilter, partyFilter, eraFilter, constituencyFilter, cabinetOnly]);

  const totalPages = Math.max(1, Math.ceil(filteredMembers.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visibleMembers = filteredMembers.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  const resetFilters = () => {
    setSearch('');
    setStatusFilter('ALL');
    setPartyFilter('ALL');
    setEraFilter('ALL');
    setConstituencyFilter('ALL');
    setCabinetOnly(false);
    setPage(1);
  };

  const renderStatusBadge = (m: LegislatureMemberRecord) => {
    if (m.status === 'current') {
      return <span className="status-pill status-pill--current">Current MLA</span>;
    }
    if (m.status === 'former_living') {
      return <span className="status-pill status-pill--living">Former (Living)</span>;
    }
    return <span className="status-pill status-pill--hist">Historical (1870–2025)</span>;
  };

  return (
    <div className="directory-view">
      {/* Header Stats Strip */}
      <section className="kpi-strip" aria-label="Legislature Members Summary">
        <div className="kpi-card">
          <span className="kpi-label">Total MLAs Archived (1870–2026)</span>
          <strong className="kpi-value">{dataset.counts.total}</strong>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Current Sitting MLAs (43rd)</span>
          <strong className="kpi-value">{dataset.counts.current}</strong>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Former Living MLAs</span>
          <strong className="kpi-value">{dataset.counts.formerLiving}</strong>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Deceased Historical MLAs</span>
          <strong className="kpi-value">{dataset.counts.deceased}</strong>
        </div>
      </section>

      {/* Filter Bar */}
      <section className="filter-card" aria-label="Filter Manitoba MLAs">
        <div className="filter-grid">
          <div className="filter-search-wrap">
            <Search className="icon-xs filter-search-icon" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search MLA name, constituency, party, or portfolio (e.g. Premier, Health)..."
              aria-label="Search Legislature Members"
              className="filter-input"
            />
          </div>

          <select
            aria-label="Filter by member status"
            className="select-compact"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as typeof statusFilter);
              setPage(1);
            }}
          >
            <option value="ALL">All Statuses ({dataset.counts.total})</option>
            <option value="current">Current Sitting (57)</option>
            <option value="former_living">Former Living ({dataset.counts.formerLiving})</option>
            <option value="deceased">Historical / Deceased ({dataset.counts.deceased})</option>
          </select>

          <select
            aria-label="Filter by party"
            className="select-compact"
            value={partyFilter}
            onChange={(e) => {
              setPartyFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="ALL">All Parties</option>
            <option value="NDP">NDP / CCF</option>
            <option value="PC">PC / Conservative</option>
            <option value="MLP">Liberal</option>
            <option value="IND">Independent</option>
            <option value="OTHER">Other (Progressive / UFM / SC / Coalition)</option>
          </select>

          <select
            aria-label="Filter by historical era"
            className="select-compact"
            value={eraFilter}
            onChange={(e) => {
              setEraFilter(e.target.value as typeof eraFilter);
              setPage(1);
            }}
          >
            <option value="ALL">All Eras (1870–2026)</option>
            <option value="2026">Sitting Today (2026)</option>
            <option value="1995-2026">Modern Era (1995–2026)</option>
            <option value="1950-1994">Late 20th C. (1950–1994)</option>
            <option value="1870-1949">Early Manitoba (1870–1949)</option>
          </select>

          <select
            aria-label="Filter by constituency"
            className="select-compact"
            value={constituencyFilter}
            onChange={(e) => {
              setConstituencyFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="ALL">All Constituencies ({allConstituencies.length})</option>
            {allConstituencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <label className="checkbox-pill">
            <input
              type="checkbox"
              checked={cabinetOnly}
              onChange={(e) => {
                setCabinetOnly(e.target.checked);
                setPage(1);
              }}
            />
            <span>Cabinet / Speakers</span>
          </label>
        </div>

        <div className="filter-footer">
          <span className="results-count">
            <Users className="icon-xs" />
            Showing <strong>{filteredMembers.length}</strong> matching MLAs
          </span>
          {(search ||
            statusFilter !== 'ALL' ||
            partyFilter !== 'ALL' ||
            eraFilter !== 'ALL' ||
            constituencyFilter !== 'ALL' ||
            cabinetOnly) && (
            <button type="button" className="pill-btn" onClick={resetFilters}>
              Clear Filters
            </button>
          )}
        </div>
      </section>

      {/* Members Grid */}
      <section className="members-grid" aria-label="Manitoba MLA Cards">
        {visibleMembers.map((member) => {
          const pMeta = getPartyMeta(member.party, parties);
          const hasModernRiding = modernSlugSet.has(member.constituencySlug);
          const safeProfile = isSafeHttpsUrl(member.profileUrl) ? member.profileUrl : null;

          return (
            <article key={member.id} className="member-card">
              <div className="member-card-head">
                <div>
                  <div className="member-badges">
                    {renderStatusBadge(member)}
                    <span className={`party-badge party-badge--${member.party}`}>
                      {member.partyRaw !== 'Unspecified' ? member.partyRaw : pMeta.shortName}
                    </span>
                    {member.isMinisterial && (
                      <span className="cabinet-badge">
                        <Award className="icon-xxs" /> Portfolio / Speaker
                      </span>
                    )}
                  </div>
                  <h3 className="member-name">
                    {member.status === 'current' && member.isMinisterial ? 'Hon. ' : ''}
                    {member.name}
                  </h3>
                </div>
              </div>

              <div className="member-meta-line">
                <span>
                  <MapPin className="icon-xxs" /> <strong>{member.constituency}</strong>
                </span>
                {member.firstElectedYear && (
                  <span>
                    <Calendar className="icon-xxs" />{' '}
                    {member.firstElectedYear === member.lastYearServed
                      ? member.firstElectedYear
                      : `${member.firstElectedYear}–${member.lastYearServed ?? ''}`}
                  </span>
                )}
              </div>

              {(member.dob || member.deceasedDate) && (
                <div className="member-bio-dates">
                  {member.dob && <span>Born: {member.dob}</span>}
                  {member.deceasedDate && <span>Deceased: {member.deceasedDate}</span>}
                </div>
              )}

              {member.portfolios.length > 0 && (
                <div className="member-section-box">
                  <div className="member-section-title">Cabinet / Legislative Roles</div>
                  <ul className="compact-list">
                    {member.portfolios.slice(0, 4).map((p, idx) => (
                      <li key={idx}>{p}</li>
                    ))}
                    {member.portfolios.length > 4 && (
                      <li className="more-items">+{member.portfolios.length - 4} more roles</li>
                    )}
                  </ul>
                </div>
              )}

              {member.electionEvents.length > 0 && (
                <div className="member-section-box">
                  <div className="member-section-title">
                    <BookOpen className="icon-xxs" /> Election Record
                  </div>
                  <ul className="compact-list">
                    {member.electionEvents.slice(0, 4).map((ev, idx) => (
                      <li key={idx}>{ev}</li>
                    ))}
                    {member.electionEvents.length > 4 && (
                      <li className="more-items">+{member.electionEvents.length - 4} more entries</li>
                    )}
                  </ul>
                </div>
              )}

              <div className="member-card-actions">
                {hasModernRiding && (
                  <button
                    type="button"
                    className="pill-btn pill-btn--accent"
                    onClick={() => onJumpToDistrictOnMap(member.constituencySlug)}
                  >
                    <MapPin className="icon-xxs" /> View Riding on Map
                  </button>
                )}
                {safeProfile && (
                  <a
                    href={safeProfile}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ext-link"
                  >
                    Official gov.mb.ca Bio <ExternalLink className="icon-xxs" />
                  </a>
                )}
              </div>
            </article>
          );
        })}
      </section>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pagination-bar" role="navigation" aria-label="Member directory pages">
          <button
            type="button"
            className="step-btn"
            disabled={currentPage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span>
            Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>
          </span>
          <button
            type="button"
            className="step-btn"
            disabled={currentPage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};

