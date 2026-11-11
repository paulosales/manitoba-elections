import React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Crown,
  GitCompare,
  Pause,
  Play,
  Sparkles,
} from 'lucide-react';
import type { ElectionSnapshot, MapColorMode } from '../types/election';

interface TimelineBarProps {
  snapshots: ElectionSnapshot[];
  activeIndex: number;
  onSelectIndex: (idx: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  colorMode: MapColorMode;
  onChangeColorMode: (mode: MapColorMode) => void;
  dominationFromYear: number;
  onChangeDominationFromYear: (year: number) => void;
}

export const TimelineBar: React.FC<TimelineBarProps> = ({
  snapshots,
  activeIndex,
  onSelectIndex,
  isPlaying,
  onTogglePlay,
  colorMode,
  onChangeColorMode,
  dominationFromYear,
  onChangeDominationFromYear,
}) => {
  const active = snapshots[activeIndex];
  const canGoPast = activeIndex > 0;
  const canGoFuture = activeIndex < snapshots.length - 1;

  return (
    <section className="timeline-card" aria-label="Electoral Time Travel Controls">
      <div className="timeline-top-row">
        <div className="timeline-status">
          <span
            className={`era-pill ${
              active?.isProjection
                ? 'era-pill--future'
                : active?.kind === 'current'
                  ? 'era-pill--now'
                  : 'era-pill--past'
            }`}
          >
            {active?.isProjection
              ? 'Future Scenario'
              : active?.kind === 'current'
                ? 'Current Legislature'
                : active?.kind === 'byelection'
                  ? 'By-Election Update'
                  : 'Historical Election'}
          </span>
          <div>
            <h2 className="timeline-title">{active?.label ?? ''}</h2>
            <p className="timeline-subtitle">
              {active?.subtitle} · {active?.date}
            </p>
          </div>
        </div>

        {/* Map Visualization Mode Toggle */}
        <div className="mode-controls">
          <div className="segmented-control" role="group" aria-label="Map coloring mode">
            <button
              type="button"
              className={`seg-btn ${colorMode === 'party' ? 'seg-btn--active' : ''}`}
              onClick={() => onChangeColorMode('party')}
            >
              <Clock className="icon-xs" />
              MLA Party
            </button>
            <button
              type="button"
              className={`seg-btn ${colorMode === 'domination' ? 'seg-btn--active' : ''}`}
              onClick={() => onChangeColorMode('domination')}
            >
              <Crown className="icon-xs" />
              Domination
            </button>
            <button
              type="button"
              className={`seg-btn ${colorMode === 'flips' ? 'seg-btn--active' : ''}`}
              onClick={() => onChangeColorMode('flips')}
            >
              <GitCompare className="icon-xs" />
              Flips
            </button>
          </div>

          {colorMode === 'domination' && (
            <label className="window-select-label">
              <span>Since:</span>
              <select
                aria-label="Domination start year"
                className="select-compact"
                value={dominationFromYear}
                onChange={(e) => onChangeDominationFromYear(Number(e.target.value))}
              >
                <option value={1995}>1995 (All 31 yrs)</option>
                <option value={1999}>1999 (NDP–PC Era)</option>
                <option value={2011}>2011 (Modern)</option>
                <option value={2016}>2016 (Recent 10 yrs)</option>
                <option value={2019}>2019 (2018 Ridings)</option>
              </select>
            </label>
          )}
        </div>
      </div>

      {/* Playback + Slider + Clickable Stops */}
      <div className="timeline-track-row">
        <div className="step-buttons">
          <button
            type="button"
            className="step-btn"
            disabled={!canGoPast}
            onClick={() => canGoPast && onSelectIndex(activeIndex - 1)}
            aria-label="Go to past election"
          >
            <ChevronLeft className="icon-sm" />
            <span>Past</span>
          </button>

          <button
            type="button"
            className={`play-btn ${isPlaying ? 'play-btn--active' : ''}`}
            onClick={onTogglePlay}
            aria-label={isPlaying ? 'Pause time travel' : 'Play historical timeline'}
          >
            {isPlaying ? <Pause className="icon-sm" /> : <Play className="icon-sm" />}
          </button>

          <button
            type="button"
            className="step-btn"
            disabled={!canGoFuture}
            onClick={() => canGoFuture && onSelectIndex(activeIndex + 1)}
            aria-label="Go to future election"
          >
            <span>Future</span>
            <ChevronRight className="icon-sm" />
          </button>
        </div>

        <div className="scrubber-wrap">
          <input
            type="range"
            min={0}
            max={Math.max(0, snapshots.length - 1)}
            value={activeIndex}
            onChange={(e) => onSelectIndex(Number(e.target.value))}
            aria-label="Timeline year slider"
            className="timeline-range"
          />
          <div className="timeline-stops">
            {snapshots.map((snap, idx) => (
              <button
                key={snap.id}
                type="button"
                className={`stop-chip ${idx === activeIndex ? 'stop-chip--active' : ''} ${
                  snap.isProjection ? 'stop-chip--future' : ''
                }`}
                onClick={() => onSelectIndex(idx)}
                title={snap.label}
              >
                {snap.isProjection && <Sparkles className="icon-xxs" />}
                {snap.shortLabel}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

