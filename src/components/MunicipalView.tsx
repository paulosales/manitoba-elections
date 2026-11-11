import React, { useMemo, useRef, useState } from 'react';
import { geoConicEqualArea, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import {
  Building2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Crown,
  ExternalLink,
  History,
  Info,
  MapPin,
  Minus,
  Phone,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type {
  ManitobaMunicipalityRecord,
  MunicipalDataset,
  MunicipalitiesGeoJson,
  WinnipegWardFeature,
} from '../types/election';
import { isSafeHttpsUrl } from '../schemas/datasetSchema';
import { normalizeFeatureCollectionWinding } from '../utils/geoWinding';

interface MunicipalViewProps {
  municipal: MunicipalDataset;
  municipalitiesGeoJson: MunicipalitiesGeoJson;
}

type WardColorMode = 'distinct' | 'party' | 'tenure' | 'flips';

const WARD_PALETTE = [
  '#0EA5E9',
  '#8B5CF6',
  '#F59E0B',
  '#10B981',
  '#EC4899',
  '#3B82F6',
  '#14B8A6',
  '#F97316',
  '#6366F1',
  '#84CC16',
  '#EF4444',
  '#06B6D4',
  '#A855F7',
  '#22C55E',
  '#E11D48',
];

const MUNI_TYPE_COLORS: Record<string, string> = {
  City: '#0284C7',
  Town: '#F59E0B',
  Village: '#10B981',
  Municipality: '#8B5CF6',
  RM: '#475569',
  LGD: '#0D9488',
};

const NON_PARTISAN_LABEL = 'Non-Partisan (Independent)';
const NON_PARTISAN_FILL = '#64748B';

function getShortWardMapLabel(feature: WinnipegWardFeature): string {
  const shortPart = feature.properties.name.split('—')[0].trim();
  return `${feature.properties.wardNumber}. ${shortPart}`;
}

export const MunicipalView: React.FC<MunicipalViewProps> = ({
  municipal,
  municipalitiesGeoJson,
}) => {
  const [subMode, setSubMode] = useState<'winnipeg' | 'manitoba'>('winnipeg');

  // Winnipeg Wards & Mayor State
  const wpgSnapshots = municipal.winnipeg.snapshots;
  const [wpgSnapIdx, setWpgSnapIdx] = useState<number>(Math.max(0, wpgSnapshots.length - 1));
  const [selectedWardId, setSelectedWardId] = useState<string>(
    municipal.winnipeg.wards[0]?.id ?? 'old-kildonan'
  );
  const [hoveredWardId, setHoveredWardId] = useState<string | null>(null);
  const [wardColorMode, setWardColorMode] = useState<WardColorMode>('distinct');
  const [showMayorBreakdown, setShowMayorBreakdown] = useState<boolean>(false);

  // Province-wide 135 Municipalities State
  const [muniSearch, setMuniSearch] = useState('');
  const [muniTypeFilter, setMuniTypeFilter] = useState<string>('ALL');
  const [muniRegionZoom, setMuniRegionZoom] = useState<'south' | 'all'>('south');
  const [selectedMuniId, setSelectedMuniId] = useState<string>('brandon-city');
  const [unmatchedRegionLabel, setUnmatchedRegionLabel] = useState<string | null>(null);

  // Shared zoom/pan state (resets cleanly between Winnipeg & Province views)
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOrigin = useRef<{
    x: number;
    y: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);

  const resetZoomPan = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleZoomBy = (factor: number) => {
    setZoom((prev) => {
      const next = Math.max(1, Math.min(8, Number((prev * factor).toFixed(2))));
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handleWheel: React.WheelEventHandler<SVGSVGElement> = (e) => {
    e.preventDefault();
    handleZoomBy(e.deltaY < 0 ? 1.15 : 0.87);
  };

  const handlePointerDown: React.PointerEventHandler<SVGSVGElement> = (e) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragOrigin.current = {
      x: e.clientX,
      y: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
    };
  };

  const handlePointerMove: React.PointerEventHandler<SVGSVGElement> = (e) => {
    if (!isDragging || !dragOrigin.current) return;
    setPan({
      x: dragOrigin.current.startPanX + (e.clientX - dragOrigin.current.x),
      y: dragOrigin.current.startPanY + (e.clientY - dragOrigin.current.y),
    });
  };

  const handlePointerUp = () => {
    setIsDragging(false);
    dragOrigin.current = null;
  };

  const activeWpgSnap = wpgSnapshots[wpgSnapIdx] ?? wpgSnapshots[wpgSnapshots.length - 1];
  const prevWpgSnap = wpgSnapIdx > 0 ? wpgSnapshots[wpgSnapIdx - 1] : null;
  const is1980MayorOnly = Boolean(
    activeWpgSnap && Object.keys(activeWpgSnap.wards).length === 0
  );

  const wardsById = useMemo(
    () => new Map(municipal.winnipeg.wards.map((w) => [w.id, w])),
    [municipal.winnipeg.wards]
  );

  // Normalize GeoJSON ring winding so D3 spherical geoConicEqualArea renders distinct wards/RMs
  const normalizedWpgFeatures = useMemo(
    () => normalizeFeatureCollectionWinding(municipal.winnipeg.wardsGeoJson.features),
    [municipal.winnipeg.wardsGeoJson.features]
  );

  const normalizedMuniFeatures = useMemo(
    () => normalizeFeatureCollectionWinding(municipalitiesGeoJson.features),
    [municipalitiesGeoJson.features]
  );

  // Winnipeg 15 Wards Projection
  const wpgMapPaths = useMemo(() => {
    const fc = {
      type: 'FeatureCollection' as const,
      name: municipal.winnipeg.wardsGeoJson.name,
      features: normalizedWpgFeatures,
    };
    const proj = geoConicEqualArea()
      .parallels([49.75, 50.0])
      .rotate([97.14, 0])
      .fitExtent(
        [
          [32, 32],
          [768, 628],
        ],
        fc as unknown as GeoPermissibleObjects
      );
    const pg = geoPath(proj);
    return normalizedWpgFeatures.map((f: WinnipegWardFeature) => ({
      feature: f,
      d: pg(f as unknown as GeoPermissibleObjects) ?? '',
      centroid: pg.centroid(f as unknown as GeoPermissibleObjects),
    }));
  }, [normalizedWpgFeatures, municipal.winnipeg.wardsGeoJson.name]);

  // Province-wide Manitoba Municipalities Map Projection
  const mbMuniFeatures = useMemo(() => {
    if (muniRegionZoom === 'all') return normalizedMuniFeatures;
    return normalizedMuniFeatures.filter((f) => {
      const coords = JSON.stringify(f.geometry.coordinates);
      const latMatch = coords.match(/,(\d{2}\.\d+)/);
      const lat = latMatch ? Number(latMatch[1]) : 50;
      return lat < 52.0;
    });
  }, [normalizedMuniFeatures, muniRegionZoom]);

  const mbMuniPaths = useMemo(() => {
    const activeList = mbMuniFeatures.length ? mbMuniFeatures : normalizedMuniFeatures;
    const fc = {
      type: 'FeatureCollection' as const,
      features: activeList,
    };
    const proj = geoConicEqualArea()
      .parallels([49.5, 56.0])
      .rotate([97.5, 0])
      .fitExtent(
        [
          [28, 28],
          [772, 652],
        ],
        fc as unknown as GeoPermissibleObjects
      );
    const pg = geoPath(proj);
    return activeList.map((f) => ({
      feature: f,
      d: pg(f as unknown as GeoPermissibleObjects) ?? '',
    }));
  }, [normalizedMuniFeatures, mbMuniFeatures]);

  const muniById = useMemo(
    () => new Map(municipal.manitobaMunicipalities.map((m) => [m.id, m])),
    [municipal.manitobaMunicipalities]
  );

  const filteredMunicipalities = useMemo(() => {
    const q = muniSearch.trim().toLowerCase();
    return municipal.manitobaMunicipalities.filter((m) => {
      if (muniTypeFilter !== 'ALL' && m.type !== muniTypeFilter) return false;
      if (q) {
        const hitName = m.name.toLowerCase().includes(q);
        const hitHead = m.headName.toLowerCase().includes(q);
        const hitCouncillors = m.councillors.some((c) => c.toLowerCase().includes(q));
        if (!hitName && !hitHead && !hitCouncillors) return false;
      }
      return true;
    });
  }, [municipal.manitobaMunicipalities, muniSearch, muniTypeFilter]);

  const activeWardProfile = wardsById.get(selectedWardId) ?? municipal.winnipeg.wards[0] ?? null;
  const activeWardRecord = activeWpgSnap?.wards[selectedWardId] ?? null;
  const hoveredWardFeature = (hoveredWardId ?? selectedWardId)
    ? normalizedWpgFeatures.find((f) => f.properties.id === (hoveredWardId ?? selectedWardId)) ??
      null
    : null;
  const hoveredWardRecord = hoveredWardFeature
    ? activeWpgSnap?.wards[hoveredWardFeature.properties.id] ?? null
    : null;

  const selectedMunicipality: ManitobaMunicipalityRecord | null =
    muniById.get(selectedMuniId) ?? municipal.manitobaMunicipalities[0] ?? null;

  const getWardVisual = (wardId: string, idx: number) => {
    const rec = activeWpgSnap?.wards[wardId];
    const prevRec = prevWpgSnap?.wards[wardId];
    const profile = wardsById.get(wardId);

    if (!rec) {
      return {
        fill: '#E2E8F0',
        opacity: 0.72,
      };
    }

    if (wardColorMode === 'party') {
      return {
        fill: NON_PARTISAN_FILL,
        opacity: 0.88,
      };
    }

    const flipped = Boolean(prevRec && rec.councillor !== prevRec.councillor);
    if (wardColorMode === 'flips') {
      return {
        fill: flipped ? '#0284C7' : '#CBD5E1',
        opacity: flipped ? 0.92 : 0.45,
      };
    }

    if (wardColorMode === 'tenure' && profile) {
      const terms = profile.history.filter((h) => h.councillor === rec.councillor).length;
      const fill = terms >= 4 ? '#0F766E' : terms >= 2 ? '#0284C7' : '#F59E0B';
      return { fill, opacity: 0.88 };
    }

    return {
      fill: WARD_PALETTE[idx % WARD_PALETTE.length],
      opacity: 0.84,
    };
  };

  const svgWidth = 800;
  const svgHeight = subMode === 'winnipeg' ? 660 : 680;
  const mapTransform = `translate(${pan.x + (svgWidth / 2) * (1 - zoom)} ${
    pan.y + (svgHeight / 2) * (1 - zoom)
  }) scale(${zoom})`;

  return (
    <div className="directory-view">
      {/* Sub-navigation between Winnipeg Wards (1974–2026) and All 135 Manitoba Municipalities */}
      <div className="municipal-mode-bar">
        <div className="segmented-control" role="tablist" aria-label="Municipal view scope">
          <button
            type="button"
            role="tab"
            aria-selected={subMode === 'winnipeg'}
            className={`seg-btn ${subMode === 'winnipeg' ? 'seg-btn--active' : ''}`}
            onClick={() => {
              resetZoomPan();
              setSubMode('winnipeg');
            }}
          >
            <MapPin className="icon-xs" />
            Winnipeg Wards &amp; Mayor (1974–2026)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subMode === 'manitoba'}
            className={`seg-btn ${subMode === 'manitoba' ? 'seg-btn--active' : ''}`}
            onClick={() => {
              resetZoomPan();
              setSubMode('manitoba');
            }}
          >
            <Building2 className="icon-xs" />
            All Manitoba Municipalities ({municipal.manitobaMunicipalities.length} Councils)
          </button>
        </div>

        <span className="municipal-source-tag">
          Official data: Winnipeg Open Data (1964–2026) &amp; MB Municipal Officials Directory (Nov 2026)
        </span>
      </div>

      {/* Explicit Municipal Party System Context Banner */}
      <div className="municipal-party-banner">
        <ShieldCheck className="icon-sm" />
        <div>
          <strong>Councillor &amp; Mayor Party Affiliation — {NON_PARTISAN_LABEL}:</strong>{' '}
          Manitoba municipal elections (City of Winnipeg Charter &amp; Municipal Councils Act) are officially{' '}
          <strong>non-partisan</strong>: candidates run without registered political party banners on the ballot
          (unlike NDP / PC / Liberal MLAs provincially).{' '}
          <span className="municipal-party-note">
            Historically (1972–1989), Winnipeg civic elections featured informal ICEC vs. NDP-aligned slates, though councillors sit legally as independents.
          </span>
        </div>
      </div>

      {subMode === 'winnipeg' ? (
        <>
          {/* Winnipeg Timeline + Mayor Banner */}
          <section className="timeline-card" aria-label="Winnipeg Municipal Election Timeline">
            <div className="timeline-top-row">
              <div className="timeline-status">
                <span className={`era-pill ${activeWpgSnap?.isCurrent ? 'era-pill--now' : 'era-pill--past'}`}>
                  {activeWpgSnap?.isCurrent ? 'Current Council' : 'Historical Council'}
                </span>
                <div>
                  <h2 className="timeline-title">{activeWpgSnap?.label}</h2>
                  <p className="timeline-subtitle">
                    Mayor of Winnipeg:{' '}
                    <strong>{activeWpgSnap?.mayor?.name ?? 'Unknown'}</strong>{' '}
                    <span className="party-badge party-badge--IND">Non-Partisan</span>
                    {activeWpgSnap?.mayor && activeWpgSnap.mayor.voteSharePct > 0
                      ? ` · ${activeWpgSnap.mayor.voteSharePct.toFixed(1)}% (${activeWpgSnap.mayor.votes.toLocaleString()} votes)`
                      : ''}
                    {activeWpgSnap?.mayor && activeWpgSnap.mayor.candidates.length > 1 && (
                      <>
                        {' · '}
                        <button
                          type="button"
                          className="inline-link-btn"
                          onClick={() => setShowMayorBreakdown((v) => !v)}
                        >
                          {showMayorBreakdown ? 'Hide Mayor Race' : 'View Mayor Race'}
                        </button>
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="segmented-control" role="group" aria-label="Winnipeg ward color mode">
                <button
                  type="button"
                  className={`seg-btn ${wardColorMode === 'distinct' ? 'seg-btn--active' : ''}`}
                  onClick={() => setWardColorMode('distinct')}
                >
                  Wards (15)
                </button>
                <button
                  type="button"
                  className={`seg-btn ${wardColorMode === 'party' ? 'seg-btn--active' : ''}`}
                  onClick={() => setWardColorMode('party')}
                >
                  Party Status
                </button>
                <button
                  type="button"
                  className={`seg-btn ${wardColorMode === 'tenure' ? 'seg-btn--active' : ''}`}
                  onClick={() => setWardColorMode('tenure')}
                >
                  <Crown className="icon-xs" />
                  Tenure
                </button>
                <button
                  type="button"
                  className={`seg-btn ${wardColorMode === 'flips' ? 'seg-btn--active' : ''}`}
                  onClick={() => setWardColorMode('flips')}
                >
                  New Councillors
                </button>
              </div>
            </div>

            {showMayorBreakdown && activeWpgSnap?.mayor && (
              <div className="mayor-race-drawer">
                <strong>{activeWpgSnap.year} Mayoral Race Top Candidates (Non-Partisan):</strong>
                <div className="mayor-cands-grid">
                  {activeWpgSnap.mayor.candidates.map((c) => (
                    <div key={c.name} className="mayor-cand-pill">
                      <span>{c.name}</span>
                      <strong>
                        {c.votes.toLocaleString()} ({c.voteSharePct}%)
                      </strong>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="timeline-track-row">
              <div className="step-buttons">
                <button
                  type="button"
                  className="step-btn"
                  disabled={wpgSnapIdx <= 0}
                  onClick={() => setWpgSnapIdx((i) => Math.max(0, i - 1))}
                >
                  <ChevronLeft className="icon-sm" /> Past
                </button>
                <button
                  type="button"
                  className="step-btn"
                  disabled={wpgSnapIdx >= wpgSnapshots.length - 1}
                  onClick={() => setWpgSnapIdx((i) => Math.min(wpgSnapshots.length - 1, i + 1))}
                >
                  Future <ChevronRight className="icon-sm" />
                </button>
              </div>

              <div className="scrubber-wrap">
                <div className="timeline-stops">
                  {wpgSnapshots.map((s, idx) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`stop-chip ${idx === wpgSnapIdx ? 'stop-chip--active' : ''}`}
                      onClick={() => setWpgSnapIdx(idx)}
                    >
                      {s.shortLabel}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Winnipeg Wards Map + Ward Inspector */}
          <div className="workspace-grid">
            <section className="map-card" aria-label="City of Winnipeg Electoral Wards Map">
              <div className="map-toolbar">
                <span className="results-count">
                  <MapPin className="icon-xs" />
                  <strong>City of Winnipeg — 15 Electoral Ward Districts</strong>
                </span>
                <div className="zoom-controls" aria-label="Winnipeg map zoom controls">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => handleZoomBy(1.3)}
                    aria-label="Zoom in"
                  >
                    <Plus className="icon-sm" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => handleZoomBy(0.75)}
                    aria-label="Zoom out"
                  >
                    <Minus className="icon-sm" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={resetZoomPan}
                    aria-label="Reset map view"
                  >
                    <RotateCcw className="icon-sm" />
                  </button>
                </div>
              </div>

              <div className="map-canvas-wrap">
                {hoveredWardFeature && (
                  <div className="map-hud-pill">
                    <div className="hud-header">
                      <span className="hud-district">
                        Ward {hoveredWardFeature.properties.wardNumber}:{' '}
                        {hoveredWardFeature.properties.name}
                      </span>
                      <span className="party-badge party-badge--IND">Non-Partisan</span>
                    </div>
                    <div className="hud-body">
                      <span className="hud-mla">
                        {hoveredWardRecord
                          ? `Councillor: ${hoveredWardRecord.councillor}`
                          : activeWpgSnap && activeWpgSnap.year < 2018 && hoveredWardFeature.properties.id === 'waverley-west'
                          ? 'Ward created in 2018 redistribution'
                          : is1980MayorOnly
                          ? '1980 Open Data includes Mayor only'
                          : `Current: ${hoveredWardFeature.properties.councillor}`}
                      </span>
                      {hoveredWardRecord && hoveredWardRecord.voteSharePct > 0 && (
                        <span className="hud-share">{hoveredWardRecord.voteSharePct}%</span>
                      )}
                    </div>
                  </div>
                )}

                <svg
                  viewBox="0 0 800 660"
                  className={`manitoba-svg ${isDragging ? 'manitoba-svg--dragging' : ''}`}
                  role="img"
                  aria-label="Map of Winnipeg's 15 electoral wards"
                  onWheel={handleWheel}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerUp}
                >
                  <g transform={mapTransform}>
                    {wpgMapPaths.map(({ feature, d, centroid }, idx) => {
                      const id = feature.properties.id;
                      const isSel = selectedWardId === id;
                      const isHov = hoveredWardId === id;
                      const vis = getWardVisual(id, idx);
                      const rec = activeWpgSnap?.wards[id];
                      const councillor = rec?.councillor ?? feature.properties.councillor;

                      return (
                        <g key={id}>
                          <path
                            d={d}
                            fill={vis.fill}
                            fillOpacity={isHov ? 0.96 : vis.opacity}
                            stroke={isSel ? '#0F172A' : '#FFFFFF'}
                            strokeWidth={(isSel ? 3 : isHov ? 2.2 : 1.5) / zoom}
                            className="district-path"
                            tabIndex={0}
                            role="button"
                            aria-label={`Ward ${feature.properties.wardNumber} ${feature.properties.name}: ${councillor}`}
                            onMouseEnter={() => setHoveredWardId(id)}
                            onMouseLeave={() => setHoveredWardId((c) => (c === id ? null : c))}
                            onClick={() => setSelectedWardId(id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setSelectedWardId(id);
                              }
                            }}
                          />
                          {!Number.isNaN(centroid[0]) && (
                            <text
                              x={centroid[0]}
                              y={centroid[1]}
                              textAnchor="middle"
                              fontSize={Math.max(5.5, 9.5 / Math.sqrt(zoom))}
                              className="map-riding-label"
                            >
                              {getShortWardMapLabel(feature)}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </g>
                </svg>
              </div>

              {wardColorMode === 'party' && (
                <div className="map-legend">
                  <div className="legend-row">
                    <span className="legend-title">Municipal Party Status:</span>
                    <span className="legend-item">
                      <span className="legend-swatch legend-swatch--IND" />
                      Non-Partisan / Independent (15 Wards · No Official Municipal Parties)
                    </span>
                  </div>
                </div>
              )}

              {wardColorMode === 'tenure' && (
                <div className="map-legend">
                  <div className="legend-row">
                    <span className="legend-title">Councillor Tenure:</span>
                    <span className="legend-item">
                      <span className="legend-swatch legend-swatch--GPM" /> 4+ Terms
                    </span>
                    <span className="legend-item">
                      <span className="legend-swatch legend-swatch--PC" /> 2–3 Terms
                    </span>
                    <span className="legend-item">
                      <span className="legend-swatch legend-swatch--NDP" /> 1st Term
                    </span>
                    <span className="legend-item">
                      <span className="legend-swatch legend-swatch--faded" /> Pre-2018 / N/A
                    </span>
                  </div>
                </div>
              )}

              {wardColorMode === 'flips' && (
                <div className="map-legend">
                  <div className="legend-row">
                    <span className="legend-title">Council Turnover:</span>
                    <span className="legend-item">
                      <span className="legend-swatch legend-swatch--PC" /> New Councillor Elected
                    </span>
                    <span className="legend-item">
                      <span className="legend-swatch legend-swatch--faded" /> Re-elected Incumbent / N/A
                    </span>
                  </div>
                </div>
              )}
            </section>

            {/* Ward Inspector */}
            {activeWardProfile && (
              <aside className="inspector-card" aria-label={`Ward inspector for ${activeWardProfile.name}`}>
                <div className="inspector-header">
                  <div>
                    <span className="region-chip">
                      City of Winnipeg · Ward {activeWardProfile.wardNumber}
                    </span>
                    <h2 className="inspector-title">{activeWardProfile.name}</h2>
                  </div>
                </div>

                {!activeWardRecord && (
                  <div className="context-note">
                    <Info className="icon-xxs" />{' '}
                    {is1980MayorOnly
                      ? 'City of Winnipeg Open Data (7753-3fjc) records only the 1980 Mayoral race; 1980 ward councillor rows are unavailable.'
                      : activeWardProfile.id === 'waverley-west' && activeWpgSnap && activeWpgSnap.year < 2018
                      ? 'Waverley West was newly created for the 2018 ward redistribution from parts of St. Norbert and River Heights—Fort Garry.'
                      : `Ward boundary or naming differed in ${activeWpgSnap?.year}; select from the full council roster below.`}
                  </div>
                )}

                <div className="mla-spotlight">
                  <div className="mla-spotlight-label">
                    <span>Ward Councillor ({activeWpgSnap?.shortLabel})</span>
                    {activeWardRecord?.acclaimed && <span className="cabinet-badge">Acclaimed</span>}
                  </div>
                  <div className="mla-name-row">
                    <strong className="mla-name">
                      {activeWardRecord?.councillor ?? activeWardProfile.currentCouncillor}
                    </strong>
                    {isSafeHttpsUrl(activeWardProfile.website) && (
                      <a
                        href={activeWardProfile.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ext-link"
                      >
                        winnipeg.ca <ExternalLink className="icon-xxs" />
                      </a>
                    )}
                  </div>
                  <div className="mla-party-line">
                    <span className="party-badge party-badge--IND">Non-Partisan</span>{' '}
                    <span>
                      {activeWardRecord?.partyStatus ?? NON_PARTISAN_LABEL} (Municipal)
                    </span>
                  </div>
                  <div className="mla-party-line">
                    Mayor: <strong>{activeWpgSnap?.mayor?.name ?? 'Scott Gillingham'}</strong> (Non-Partisan)
                  </div>
                  {activeWardProfile.phone && (
                    <div className="mla-party-line">
                      <Phone className="icon-xxs" /> {activeWardProfile.phone}
                    </div>
                  )}
                  {activeWardProfile.neighbourhoods && (
                    <div className="context-note">
                      <strong>Neighbourhoods:</strong> {activeWardProfile.neighbourhoods}
                    </div>
                  )}
                </div>

                {activeWardRecord && activeWardRecord.candidates.length > 0 && activeWardRecord.votes > 0 && (
                  <div className="inspector-section">
                    <h3 className="section-heading">
                      Ward Election Results ({activeWpgSnap?.year})
                    </h3>
                    <div className="candidate-list">
                      {activeWardRecord.candidates.slice(0, 6).map((c) => (
                        <div key={c.name} className="candidate-row">
                          <div className="candidate-meta">
                            <span className="candidate-name">{c.name}</span>
                            <span className="candidate-nums">
                              {c.votes.toLocaleString()} · <strong>{c.voteSharePct}%</strong>
                            </span>
                          </div>
                          <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="candidate-bar-svg">
                            <rect x={0} y={0} width={100} height={6} rx={3} fill="#E2E8F0" />
                            <rect
                              x={0}
                              y={0}
                              width={Math.max(2, c.voteSharePct)}
                              height={6}
                              rx={3}
                              fill={c.won ? '#0284C7' : '#94A3B8'}
                            />
                          </svg>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="inspector-section">
                  <h3 className="section-heading">
                    <History className="icon-xs" />
                    Historical Ward Councillors
                  </h3>
                  {activeWardProfile.longestServingCouncillor && (
                    <p className="dom-summary-text">
                      Longest-serving: <strong>{activeWardProfile.longestServingCouncillor}</strong> ·{' '}
                      <strong>{activeWardProfile.distinctCouncillorsCount}</strong> distinct councillors
                    </p>
                  )}
                  <div className="history-timeline">
                    {[...activeWardProfile.history].reverse().map((h) => {
                      const targetSnapIdx = wpgSnapshots.findIndex((s) => s.year === h.year);
                      return (
                        <button
                          key={`${h.date}-${h.councillor}`}
                          type="button"
                          disabled={targetSnapIdx === -1}
                          onClick={() => targetSnapIdx !== -1 && setWpgSnapIdx(targetSnapIdx)}
                          className={`history-item ${
                            activeWpgSnap?.year === h.year ? 'history-item--active' : ''
                          }`}
                        >
                          <div className="history-stripe history-stripe--IND" />
                          <div className="history-body">
                            <div className="history-top">
                              <span className="history-year">
                                <Calendar className="icon-xxs" /> {h.year} · Non-Partisan
                                {h.acclaimed && <span className="mini-tag">Acclaimed</span>}
                              </span>
                              {h.voteSharePct > 0 && (
                                <span className="history-pct">{h.voteSharePct}%</span>
                              )}
                            </div>
                            <div className="history-mla">{h.councillor}</div>
                            {h.mayorName && (
                              <div className="history-pred">Mayor: {h.mayorName}</div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </aside>
            )}
          </div>

          {activeWpgSnap && Object.keys(activeWpgSnap.wards).length > 0 && (
            <section className="wpg-roster-card" aria-label="Full Historical Council Ward Roster">
              <div className="wpg-roster-header">
                <h3>
                  All Elected Ward Councillors in {activeWpgSnap.shortLabel} (
                  {Object.keys(activeWpgSnap.wards).length} Wards)
                </h3>
                <span className="municipal-source-tag">
                  Non-Partisan Municipal System · Historical ward names from Winnipeg Open Data (1974–present)
                </span>
              </div>
              <div className="wpg-roster-grid">
                {Object.entries(activeWpgSnap.wards)
                  .sort((a, b) => a[1].wardNameAtTime.localeCompare(b[1].wardNameAtTime))
                  .map(([wardKey, rec]) => {
                    const isModernWard = wardsById.has(wardKey);
                    const isSelected = selectedWardId === wardKey;
                    return (
                      <button
                        key={wardKey}
                        type="button"
                        disabled={!isModernWard}
                        onClick={() => isModernWard && setSelectedWardId(wardKey)}
                        className={`wpg-roster-pill ${
                          isSelected ? 'wpg-roster-pill--active' : ''
                        }`}
                      >
                        <span className="wpg-roster-ward">{rec.wardNameAtTime}</span>
                        <span className="wpg-roster-councillor">{rec.councillor}</span>
                        <span className="wpg-roster-meta">
                          Non-Partisan ·{' '}
                          {rec.acclaimed
                            ? 'Acclaimed'
                            : rec.voteSharePct > 0
                            ? `${rec.voteSharePct}% (${rec.votes.toLocaleString()} votes)`
                            : 'Elected 2026'}
                        </span>
                      </button>
                    );
                  })}
              </div>
            </section>
          )}
        </>
      ) : (
        /* Province-Wide 135 Manitoba Municipalities View */
        <div className="workspace-grid">
          <section className="map-card" aria-label="Province-Wide Manitoba Municipalities Map">
            <div className="map-toolbar">
              <div className="region-pills">
                <button
                  type="button"
                  className={`pill-btn ${muniRegionZoom === 'south' ? 'pill-btn--active' : ''}`}
                  onClick={() => {
                    resetZoomPan();
                    setMuniRegionZoom('south');
                  }}
                >
                  Southern &amp; Central MB
                </button>
                <button
                  type="button"
                  className={`pill-btn ${muniRegionZoom === 'all' ? 'pill-btn--active' : ''}`}
                  onClick={() => {
                    resetZoomPan();
                    setMuniRegionZoom('all');
                  }}
                >
                  All Manitoba
                </button>
              </div>
              <div className="map-toolbar-right">
                <span className="results-count">
                  <Users className="icon-xs" /> {filteredMunicipalities.length} councils
                </span>
                <div className="zoom-controls" aria-label="Manitoba municipal map zoom controls">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => handleZoomBy(1.3)}
                    aria-label="Zoom in"
                  >
                    <Plus className="icon-sm" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => handleZoomBy(0.75)}
                    aria-label="Zoom out"
                  >
                    <Minus className="icon-sm" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={resetZoomPan}
                    aria-label="Reset map view"
                  >
                    <RotateCcw className="icon-sm" />
                  </button>
                </div>
              </div>
            </div>

            <div className="map-canvas-wrap">
              {selectedMunicipality && (
                <div className="map-hud-pill">
                  <div className="hud-header">
                    <span className="hud-district">{selectedMunicipality.name}</span>
                    <span className="hud-region">{selectedMunicipality.type}</span>
                  </div>
                  <div className="hud-body">
                    <span className="hud-mla">
                      {selectedMunicipality.headRole}: {selectedMunicipality.headName} (Non-Partisan)
                    </span>
                    {selectedMunicipality.population && (
                      <span className="hud-share">
                        Pop. {selectedMunicipality.population.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <svg
                viewBox="0 0 800 680"
                className={`manitoba-svg ${isDragging ? 'manitoba-svg--dragging' : ''}`}
                role="img"
                aria-label="Manitoba municipalities boundary map"
                onWheel={handleWheel}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
              >
                <g transform={mapTransform}>
                  {mbMuniPaths.map(({ feature, d }) => {
                    const id = feature.properties.id;
                    const isSel = selectedMuniId === id;
                    const color = MUNI_TYPE_COLORS[feature.properties.type] ?? '#64748B';
                    return (
                      <path
                        key={`${feature.properties.municipalNo}-${id}`}
                        d={d}
                        fill={color}
                        fillOpacity={isSel ? 0.96 : 0.72}
                        stroke={isSel ? '#0F172A' : '#FFFFFF'}
                        strokeWidth={(isSel ? 2.2 : 0.65) / zoom}
                        className="district-path"
                        onClick={() => {
                          if (muniById.has(id)) {
                            setSelectedMuniId(id);
                            setUnmatchedRegionLabel(null);
                          } else {
                            setUnmatchedRegionLabel(feature.properties.name);
                          }
                        }}
                      >
                        <title>{feature.properties.name}</title>
                      </path>
                    );
                  })}
                </g>
              </svg>
            </div>

            <div className="map-legend">
              <div className="legend-row">
                <span className="legend-title">Municipality Type (All Non-Partisan):</span>
                {Object.entries(MUNI_TYPE_COLORS).map(([t]) => (
                  <span key={t} className="legend-item">
                    <span className={`legend-swatch legend-swatch--muni-${t}`} />
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </section>

          {/* Right Panel: Selected Municipality Details + Searchable Directory */}
          <aside className="inspector-card" aria-label="Manitoba Municipal Council Directory">
            <div className="muni-search-controls">
              <div className="filter-search-wrap">
                <Search className="icon-xs filter-search-icon" />
                <input
                  type="search"
                  value={muniSearch}
                  onChange={(e) => setMuniSearch(e.target.value)}
                  placeholder="Search city, RM, mayor, or councillor..."
                  aria-label="Search Manitoba municipalities"
                  className="filter-input"
                />
              </div>
              <select
                aria-label="Filter by municipality type"
                className="select-compact"
                value={muniTypeFilter}
                onChange={(e) => setMuniTypeFilter(e.target.value)}
              >
                <option value="ALL">All Types ({municipal.manitobaMunicipalities.length})</option>
                <option value="City">Cities</option>
                <option value="Town">Towns</option>
                <option value="Village">Villages</option>
                <option value="RM">Rural Municipalities (RM)</option>
                <option value="Municipality">Municipalities</option>
              </select>
            </div>

            {unmatchedRegionLabel && (
              <div className="context-note">
                <strong>{unmatchedRegionLabel}</strong> is an unincorporated Northern Affairs community not governed by an incorporated municipal council in the Manitoba Municipal Officials Directory.
              </div>
            )}

            {selectedMunicipality && (
              <div className="mla-spotlight">
                <div className="mla-spotlight-label">
                  <span>{selectedMunicipality.type}</span>
                  {selectedMunicipality.municipalNo && (
                    <span>Mun. #{selectedMunicipality.municipalNo}</span>
                  )}
                </div>
                <div className="mla-name-row">
                  <strong className="mla-name">{selectedMunicipality.name}</strong>
                  {isSafeHttpsUrl(selectedMunicipality.website) && (
                    <a
                      href={selectedMunicipality.website!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ext-link"
                    >
                      Website <ExternalLink className="icon-xxs" />
                    </a>
                  )}
                </div>
                <div className="mla-party-line">
                  <span className="party-badge party-badge--IND">Non-Partisan</span>{' '}
                  <span>{selectedMunicipality.partyStatus ?? NON_PARTISAN_LABEL}</span>
                </div>
                <div className="mla-party-line">
                  <strong>{selectedMunicipality.headRole}:</strong> {selectedMunicipality.headName}
                </div>
                {selectedMunicipality.caoName && (
                  <div className="mla-party-line">
                    <strong>CAO / Manager:</strong> {selectedMunicipality.caoName}
                  </div>
                )}
                {selectedMunicipality.population && (
                  <div className="mla-party-line">
                    <strong>Population:</strong> {selectedMunicipality.population.toLocaleString()}
                  </div>
                )}
                {selectedMunicipality.id === 'winnipeg-city' && (
                  <button
                    type="button"
                    className="pill-btn pill-btn--accent"
                    onClick={() => {
                      resetZoomPan();
                      setSubMode('winnipeg');
                    }}
                  >
                    <MapPin className="icon-xs" />
                    Open Winnipeg 15-Ward Council Map
                  </button>
                )}
                <div className="councillors-box">
                  <div className="member-section-title">
                    Councillors ({selectedMunicipality.councillors.length} · Non-Partisan)
                  </div>
                  <div className="councillors-chips">
                    {selectedMunicipality.councillors.map((c) => (
                      <span key={c} className="councillor-chip">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="inspector-section">
              <h3 className="section-heading">All Manitoba Municipalities</h3>
              <div className="history-timeline">
                {filteredMunicipalities.slice(0, 60).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setSelectedMuniId(m.id);
                      setUnmatchedRegionLabel(null);
                    }}
                    className={`history-item ${selectedMuniId === m.id ? 'history-item--active' : ''}`}
                  >
                    <div className="history-stripe history-stripe--IND" />
                    <div className="history-body">
                      <div className="history-top">
                        <span className="history-year">{m.type} · Non-Partisan</span>
                        {m.population && (
                          <span className="history-pct">Pop. {m.population.toLocaleString()}</span>
                        )}
                      </div>
                      <div className="history-mla">{m.name}</div>
                      <div className="history-pred">
                        {m.headRole}: {m.headName} · {m.councillors.length} councillors
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};
