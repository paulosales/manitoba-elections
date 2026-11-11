import React, { useMemo, useRef, useState } from 'react';
import { geoConicEqualArea, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { Compass, Layers, Maximize2, Minus, Plus, RotateCcw } from 'lucide-react';
import type {
  BoundariesGeoJson,
  BoundaryEra,
  BoundaryFeature,
  DistrictElectionRecord,
  DistrictProfile,
  MapColorMode,
  PartyId,
  PartyMeta,
  RegionView,
} from '../types/election';
import { computeDominationInWindow, getDistrictFillColor, getPartyMeta } from '../utils/electionMath';

interface ManitobaMapProps {
  geoJson: BoundariesGeoJson;
  resultsMap: Record<string, DistrictElectionRecord>;
  previousResultsMap: Record<string, DistrictElectionRecord> | null;
  districtsById: Map<string, DistrictProfile>;
  parties: Record<PartyId, PartyMeta>;
  selectedDistrictId: string | null;
  onSelectDistrict: (id: string) => void;
  colorMode: MapColorMode;
  regionView: RegionView;
  onChangeRegionView: (view: RegionView) => void;
  dominationWindow: [number, number];
  boundaryEra: BoundaryEra;
  unifiedBoundaries: boolean;
  onToggleUnifiedBoundaries: () => void;
  isProjection?: boolean;
}

const VIEW_WIDTH = 800;
const VIEW_HEIGHT = 860;

const WINNIPEG_SET_LABELS = new Set([
  'Assiniboia',
  'Burrows',
  'Charleswood',
  'Concordia',
  'Elmwood',
  'Fort Garry',
  'Fort Garry-Riverview',
  'Fort Richmond',
  'Fort Rouge',
  'Fort Whyte',
  'Kildonan',
  'Kildonan-River East',
  'Kirkfield Park',
  'Lagimodière',
  'Logan',
  'McPhillips',
  'Minto',
  'Notre Dame',
  'Point Douglas',
  'Radisson',
  'Riel',
  'River East',
  'River Heights',
  'Roblin',
  'Rossmere',
  'Seine River',
  'Southdale',
  'St. Boniface',
  'St. James',
  'St. Johns',
  'St. Norbert',
  'St. Vital',
  'The Maples',
  'Transcona',
  'Tuxedo',
  'Tyndall Park',
  'Union Station',
  'Waverley',
  'Wolseley',
]);

const REGION_CITIES: Array<{ name: string; coords: [number, number]; minScale?: boolean }> = [
  { name: 'Winnipeg', coords: [-97.1384, 49.8951] },
  { name: 'Brandon', coords: [-99.9501, 49.8485] },
  { name: 'Thompson', coords: [-97.8553, 55.7433] },
  { name: 'The Pas', coords: [-101.2546, 53.8255] },
  { name: 'Flin Flon', coords: [-101.8762, 54.7682] },
  { name: 'Dauphin', coords: [-100.0503, 51.1494] },
  { name: 'Portage la Prairie', coords: [-98.2926, 49.9728] },
  { name: 'Steinbach', coords: [-96.6839, 49.5258] },
  { name: 'Selkirk', coords: [-96.8797, 50.1436] },
  { name: 'Winkler', coords: [-97.9412, 49.1817] },
];

const REGION_TABS: Array<{ id: RegionView; label: string }> = [
  { id: 'all', label: 'All Manitoba' },
  { id: 'winnipeg', label: 'Winnipeg (32)' },
  { id: 'southern', label: 'South & Interlake' },
  { id: 'westman', label: 'Westman & Brandon' },
  { id: 'north', label: 'North' },
];

function isWinnipegFeature(f: BoundaryFeature): boolean {
  return f.properties.region === 'Winnipeg' || WINNIPEG_SET_LABELS.has(f.properties.name);
}

function filterFeaturesForRegion(features: BoundaryFeature[], region: RegionView): BoundaryFeature[] {
  if (region === 'all') return features;
  if (region === 'winnipeg') return features.filter(isWinnipegFeature);
  if (region === 'north') {
    return features.filter(
      (f) => f.properties.region === 'Northern Manitoba' || ['flin-flon', 'thompson', 'the-pas', 'the-pas-kameesak', 'keewatinook', 'kewatinook'].includes(f.properties.id)
    );
  }
  if (region === 'westman') {
    return features.filter(
      (f) =>
        f.properties.region === 'Brandon & Westman' ||
        ['agassiz', 'arthur-virden', 'brandon-east', 'brandon-west', 'dauphin', 'riding-mountain', 'spruce-woods', 'swan-river', 'turtle-mountain'].includes(f.properties.id)
    );
  }
  return features.filter((f) => !isWinnipegFeature(f) && f.properties.region !== 'Northern Manitoba');
}

export const ManitobaMap: React.FC<ManitobaMapProps> = ({
  geoJson,
  resultsMap,
  previousResultsMap,
  districtsById,
  parties,
  selectedDistrictId,
  onSelectDistrict,
  colorMode,
  regionView,
  onChangeRegionView,
  dominationWindow,
  boundaryEra,
  unifiedBoundaries,
  onToggleUnifiedBoundaries,
  isProjection,
}) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOrigin = useRef<{ x: number; y: number; startPanX: number; startPanY: number } | null>(null);

  const regionFeatures = useMemo(
    () => filterFeaturesForRegion(geoJson.features, regionView),
    [geoJson.features, regionView]
  );

  const winnipegFeatures = useMemo(
    () => geoJson.features.filter(isWinnipegFeature),
    [geoJson.features]
  );

  const { mainPaths, mainProjection } = useMemo(() => {
    const collection = {
      type: 'FeatureCollection' as const,
      features: regionFeatures.length > 0 ? regionFeatures : geoJson.features,
    };
    const projection = geoConicEqualArea()
      .parallels([51, 58])
      .rotate([97.5, 0])
      .fitExtent(
        [
          [34, 34],
          [VIEW_WIDTH - 34, VIEW_HEIGHT - 34],
        ],
        collection as unknown as GeoPermissibleObjects
      );
    const pathGen = geoPath(projection);
    const computed = geoJson.features.map((feature) => ({
      feature,
      d: pathGen(feature as unknown as GeoPermissibleObjects) ?? '',
      centroidPx: pathGen.centroid(feature as unknown as GeoPermissibleObjects),
    }));
    return { mainPaths: computed, mainProjection: projection };
  }, [geoJson.features, regionFeatures]);

  // Winnipeg inset projection (rendered when viewing province-wide 'all' view)
  const winnipegInset = useMemo(() => {
    if (regionView !== 'all' || winnipegFeatures.length === 0) return null;
    const insetSize = 232;
    const insetX = VIEW_WIDTH - insetSize - 20;
    const insetY = VIEW_HEIGHT - insetSize - 20;
    const wpgCollection = {
      type: 'FeatureCollection' as const,
      features: winnipegFeatures,
    };
    const proj = geoConicEqualArea()
      .parallels([49.7, 50.0])
      .rotate([97.15, 0])
      .fitExtent(
        [
          [insetX + 12, insetY + 28],
          [insetX + insetSize - 12, insetY + insetSize - 10],
        ],
        wpgCollection as unknown as GeoPermissibleObjects
      );
    const pg = geoPath(proj);
    return {
      x: insetX,
      y: insetY,
      size: insetSize,
      paths: winnipegFeatures.map((feature) => ({
        feature,
        d: pg(feature as unknown as GeoPermissibleObjects) ?? '',
      })),
    };
  }, [regionView, winnipegFeatures]);

  const activeHoverId = hoveredId ?? selectedDistrictId;
  const hoverFeature = activeHoverId
    ? geoJson.features.find((f) => f.properties.id === activeHoverId) ?? null
    : null;
  const hoverRecord = activeHoverId ? resultsMap[activeHoverId] ?? null : null;
  const hoverProfile = activeHoverId ? districtsById.get(activeHoverId) ?? null : null;

  const getVisualForFeature = (id: string) => {
    const rec = resultsMap[id];
    const prev = previousResultsMap?.[id];
    const profile = districtsById.get(id);

    if (!rec) {
      return { fill: '#CBD5E1', opacity: 0.6, isFlipped: false };
    }

    if (colorMode === 'domination' && profile) {
      const dom = computeDominationInWindow(profile, dominationWindow[0], dominationWindow[1]);
      const meta = getPartyMeta(dom.dominantParty, parties);
      const { fill, opacity } = getDistrictFillColor(meta.color, dom.dominancePct, 'domination', false);
      return { fill, opacity, isFlipped: false, isSwing: dom.flips >= 3 };
    }

    const isFlipped = Boolean(
      rec.flippedFromCurrent || (prev && prev.winner.party !== rec.winner.party)
    );
    const meta = getPartyMeta(rec.winner.party, parties);
    const { fill, opacity } = getDistrictFillColor(
      meta.color,
      rec.marginPct,
      colorMode,
      isFlipped
    );
    return { fill, opacity, isFlipped, isSwing: false };
  };

  const resetZoomPan = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleRegionSelect = (view: RegionView) => {
    resetZoomPan();
    onChangeRegionView(view);
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
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    handleZoomBy(factor);
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
    const dx = e.clientX - dragOrigin.current.x;
    const dy = e.clientY - dragOrigin.current.y;
    setPan({
      x: dragOrigin.current.startPanX + dx,
      y: dragOrigin.current.startPanY + dy,
    });
  };

  const handlePointerUp = () => {
    setIsDragging(false);
    dragOrigin.current = null;
  };

  // Center zoom smoothly around SVG canvas center
  const cx = VIEW_WIDTH / 2;
  const cy = VIEW_HEIGHT / 2;
  const mapTransform = `translate(${pan.x + cx * (1 - zoom)} ${pan.y + cy * (1 - zoom)}) scale(${zoom})`;

  const wpgCenterCoord = mainProjection([-97.1384, 49.8951]);

  return (
    <section className="map-card" aria-label="Interactive Manitoba Electoral Districts Map">
      {/* Map Header Controls */}
      <div className="map-toolbar">
        <div className="region-pills" role="tablist" aria-label="Map region focus">
          {REGION_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={regionView === tab.id}
              className={`pill-btn ${regionView === tab.id ? 'pill-btn--active' : ''}`}
              onClick={() => handleRegionSelect(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="map-toolbar-right">
          {boundaryEra === '2008' && (
            <button
              type="button"
              className={`pill-btn ${unifiedBoundaries ? 'pill-btn--accent' : ''}`}
              onClick={onToggleUnifiedBoundaries}
              title="Switch between actual 2008 historical riding polygons and unified 2018 modern ridings"
            >
              <Layers className="icon-xs" />
              {unifiedBoundaries ? '2018 Modern Ridings' : '2008 Era Ridings'}
            </button>
          )}
          <div className="zoom-controls" aria-label="Map zoom controls">
            <button type="button" className="icon-btn" onClick={() => handleZoomBy(1.3)} aria-label="Zoom in">
              <Plus className="icon-sm" />
            </button>
            <button type="button" className="icon-btn" onClick={() => handleZoomBy(0.75)} aria-label="Zoom out">
              <Minus className="icon-sm" />
            </button>
            <button type="button" className="icon-btn" onClick={resetZoomPan} aria-label="Reset map view">
              <RotateCcw className="icon-sm" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Map Viewport */}
      <div className="map-canvas-wrap">
        {/* Live Hover / Selected HUD Pill */}
        {hoverFeature && hoverRecord && (
          <div className="map-hud-pill" aria-live="polite">
            <div className="hud-header">
              <span className="hud-district">{hoverFeature.properties.name}</span>
              <span className="hud-region">{hoverFeature.properties.region}</span>
            </div>
            {colorMode === 'domination' && hoverProfile ? (
              (() => {
                const dom = computeDominationInWindow(
                  hoverProfile,
                  dominationWindow[0],
                  dominationWindow[1]
                );
                const meta = getPartyMeta(dom.dominantParty, parties);
                return (
                  <div className="hud-body">
                    <span className={`party-badge party-badge--${dom.dominantParty}`}>
                      {meta.shortName}
                    </span>
                    <span className="hud-mla">
                      {dom.classification} ({dom.dominantWins}/{dom.totalTerms} wins · {dom.dominancePct}%)
                    </span>
                  </div>
                );
              })()
            ) : (
              <div className="hud-body">
                <span className={`party-badge party-badge--${hoverRecord.winner.party}`}>
                  {getPartyMeta(hoverRecord.winner.party, parties).shortName}
                </span>
                <span className="hud-mla">
                  {hoverRecord.winner.isMinisterial ? 'Hon. ' : ''}
                  {hoverRecord.winner.name}
                </span>
                {hoverRecord.winner.voteSharePct > 0 && (
                  <span className="hud-share">{hoverRecord.winner.voteSharePct.toFixed(1)}%</span>
                )}
              </div>
            )}
            {hoverRecord.isPredecessorBoundary && hoverRecord.originalDivisionName && (
              <div className="hud-note">
                Historical riding: {hoverRecord.originalDivisionName}
              </div>
            )}
          </div>
        )}

        {isProjection && (
          <div className="projection-watermark">PROJECTED FUTURE SCENARIO</div>
        )}

        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          className={`manitoba-svg ${isDragging ? 'manitoba-svg--dragging' : ''}`}
          role="img"
          aria-label="Map of Manitoba provincial electoral districts colored by MLA party"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          <rect x={0} y={0} width={VIEW_WIDTH} height={VIEW_HEIGHT} fill="transparent" />

          <g transform={mapTransform}>
            {mainPaths.map(({ feature, d, centroidPx }) => {
              const id = feature.properties.id;
              const isSelected = selectedDistrictId === id;
              const isHovered = hoveredId === id;
              const visual = getVisualForFeature(id);
              const showRegionLabel =
                regionView !== 'all' ||
                (!isWinnipegFeature(feature) && !Number.isNaN(centroidPx[0]));

              return (
                <g key={id}>
                  <path
                    d={d}
                    fill={visual.fill}
                    fillOpacity={isHovered ? Math.min(1, visual.opacity + 0.12) : visual.opacity}
                    stroke={isSelected ? '#0F172A' : isHovered ? '#1E293B' : '#FFFFFF'}
                    strokeWidth={
                      isSelected ? 2.6 / zoom : isHovered ? 1.8 / zoom : 0.75 / zoom
                    }
                    className="district-path"
                    tabIndex={0}
                    role="button"
                    aria-label={`${feature.properties.name}: ${resultsMap[id]?.winner.name ?? 'No data'} (${resultsMap[id]?.winner.party ?? 'N/A'})`}
                    onMouseEnter={() => setHoveredId(id)}
                    onMouseLeave={() => setHoveredId((cur) => (cur === id ? null : cur))}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectDistrict(id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectDistrict(id);
                      }
                    }}
                  />
                  {regionView === 'winnipeg' && !Number.isNaN(centroidPx[0]) && (
                    <text
                      x={centroidPx[0]}
                      y={centroidPx[1]}
                      textAnchor="middle"
                      className="map-riding-label"
                      fontSize={9 / Math.sqrt(zoom)}
                    >
                      {feature.properties.name}
                    </text>
                  )}
                  {regionView !== 'winnipeg' &&
                    regionView !== 'all' &&
                    showRegionLabel &&
                    !Number.isNaN(centroidPx[0]) && (
                      <text
                        x={centroidPx[0]}
                        y={centroidPx[1]}
                        textAnchor="middle"
                        className="map-riding-label"
                        fontSize={10 / Math.sqrt(zoom)}
                      >
                        {feature.properties.name}
                      </text>
                    )}
                </g>
              );
            })}

            {/* Reference city markers (non-Winnipeg views or province-wide landmarks) */}
            {regionView !== 'winnipeg' &&
              REGION_CITIES.map((city) => {
                const pt = mainProjection(city.coords);
                if (!pt || pt[0] < 10 || pt[0] > VIEW_WIDTH - 10 || pt[1] < 10 || pt[1] > VIEW_HEIGHT - 10) {
                  return null;
                }
                return (
                  <g key={city.name} className="city-marker" pointerEvents="none">
                    <circle
                      cx={pt[0]}
                      cy={pt[1]}
                      r={3.2 / Math.sqrt(zoom)}
                      fill="#0F172A"
                      stroke="#FFFFFF"
                      strokeWidth={1.2 / Math.sqrt(zoom)}
                    />
                    <text
                      x={pt[0] + 6 / Math.sqrt(zoom)}
                      y={pt[1] + 3 / Math.sqrt(zoom)}
                      fontSize={10 / Math.sqrt(zoom)}
                      className="city-label"
                    >
                      {city.name}
                    </text>
                  </g>
                );
              })}

            {/* Connector highlight box around Winnipeg on All-Manitoba view */}
            {regionView === 'all' && wpgCenterCoord && winnipegInset && (
              <g pointerEvents="none">
                <circle
                  cx={wpgCenterCoord[0]}
                  cy={wpgCenterCoord[1]}
                  r={18}
                  fill="none"
                  stroke="#0F172A"
                  strokeWidth={1.3}
                  strokeDasharray="3 3"
                />
                <line
                  x1={wpgCenterCoord[0] + 15}
                  y1={wpgCenterCoord[1] + 10}
                  x2={winnipegInset.x}
                  y2={winnipegInset.y + 40}
                  stroke="#64748B"
                  strokeWidth={1.1}
                  strokeDasharray="4 3"
                />
              </g>
            )}
          </g>

          {/* Dedicated Winnipeg Metro Inset Panel on All-Manitoba View */}
          {winnipegInset && (
            <g className="winnipeg-inset">
              <rect
                x={winnipegInset.x}
                y={winnipegInset.y}
                width={winnipegInset.size}
                height={winnipegInset.size}
                rx={12}
                fill="#FFFFFF"
                fillOpacity={0.96}
                stroke="#CBD5E1"
                strokeWidth={1.5}
              />
              <text
                x={winnipegInset.x + 12}
                y={winnipegInset.y + 20}
                className="inset-title"
                fontSize={11}
              >
                Winnipeg Metro (32 seats)
              </text>
              <g
                className="inset-zoom-trigger"
                role="button"
                tabIndex={0}
                aria-label="Zoom into Winnipeg Metro"
                onClick={() => handleRegionSelect('winnipeg')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleRegionSelect('winnipeg');
                  }
                }}
              >
                <rect
                  x={winnipegInset.x + winnipegInset.size - 56}
                  y={winnipegInset.y + 7}
                  width={46}
                  height={18}
                  rx={5}
                  fill="#F1F5F9"
                  stroke="#CBD5E1"
                  strokeWidth={1}
                />
                <text
                  x={winnipegInset.x + winnipegInset.size - 33}
                  y={winnipegInset.y + 19}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#0F172A"
                  fontWeight={600}
                >
                  Expand
                </text>
              </g>
              {winnipegInset.paths.map(({ feature, d }) => {
                const id = feature.properties.id;
                const isSelected = selectedDistrictId === id;
                const isHovered = hoveredId === id;
                const visual = getVisualForFeature(id);
                return (
                  <path
                    key={`inset-${id}`}
                    d={d}
                    fill={visual.fill}
                    fillOpacity={isHovered ? 1 : visual.opacity}
                    stroke={isSelected ? '#0F172A' : isHovered ? '#1E293B' : '#FFFFFF'}
                    strokeWidth={isSelected ? 2 : isHovered ? 1.4 : 0.65}
                    className="district-path"
                    onMouseEnter={() => setHoveredId(id)}
                    onMouseLeave={() => setHoveredId((cur) => (cur === id ? null : cur))}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectDistrict(id);
                    }}
                  />
                );
              })}
            </g>
          )}

          {/* Subtle Compass / Scale Attribution */}
          <g transform="translate(20, 822)" pointerEvents="none">
            <Compass x={0} y={-2} width={16} height={16} stroke="#64748B" />
            <text x={22} y={10} fontSize={10} fill="#64748B">
              Manitoba Provincial Electoral Divisions ({unifiedBoundaries ? '2018' : boundaryEra} Boundaries)
            </text>
          </g>
        </svg>

        {regionView !== 'all' && (
          <button
            type="button"
            className="back-all-btn"
            onClick={() => handleRegionSelect('all')}
          >
            <Maximize2 className="icon-xs" />
            Full Manitoba View
          </button>
        )}
      </div>

      {/* Color Legend Footer */}
      <div className="map-legend">
        {colorMode === 'domination' ? (
          <div className="legend-row">
            <span className="legend-title">
              Party Domination ({dominationWindow[0]}–{dominationWindow[1]}):
            </span>
            {(['NDP', 'PC', 'MLP', 'IND'] as PartyId[]).map((pid) => (
              <span key={pid} className="legend-item">
                <span className={`legend-swatch legend-swatch--${pid}`} />
                {getPartyMeta(pid, parties).shortName}
              </span>
            ))}
            <span className="legend-hint">Darker shade = higher share of terms held</span>
          </div>
        ) : colorMode === 'flips' ? (
          <div className="legend-row">
            <span className="legend-title">Party Flips Highlight:</span>
            <span className="legend-item">
              <span className="legend-swatch legend-swatch--NDP" />
              Solid = Flipped party vs prior snapshot
            </span>
            <span className="legend-item">
              <span className="legend-swatch legend-swatch--faded" />
              Faded = Held by same party
            </span>
          </div>
        ) : (
          <div className="legend-row">
            <span className="legend-title">MLA Party Color:</span>
            {(['NDP', 'PC', 'MLP', 'GPM', 'KP', 'IND'] as PartyId[]).map((pid) => (
              <span key={pid} className="legend-item">
                <span className={`legend-swatch legend-swatch--${pid}`} />
                {getPartyMeta(pid, parties).shortName}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
