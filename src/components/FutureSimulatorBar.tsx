import React from 'react';
import { RotateCcw, SlidersHorizontal, Sparkles } from 'lucide-react';
import type { FutureModelType, FutureSwingConfig } from '../types/election';

interface FutureSimulatorBarProps {
  config: FutureSwingConfig;
  onChange: (next: FutureSwingConfig) => void;
}

const DEFAULT_SWINGS = { NDP: 0, PC: 0, MLP: 0, GPM: 0, KP: 0 };

const PRESETS: Array<{ label: string; swings: typeof DEFAULT_SWINGS }> = [
  { label: '0% Neutral Baseline', swings: { NDP: 0, PC: 0, MLP: 0, GPM: 0, KP: 0 } },
  { label: 'NDP +6% Wave', swings: { NDP: 6, PC: -5, MLP: -1, GPM: 0, KP: 0 } },
  { label: 'PC +6% Comeback', swings: { NDP: -6, PC: 6, MLP: 0, GPM: 0, KP: 0 } },
  { label: 'Liberal +8% Urban Surge', swings: { NDP: -4, PC: -4, MLP: 8, GPM: 0, KP: 0 } },
];

export const FutureSimulatorBar: React.FC<FutureSimulatorBarProps> = ({ config, onChange }) => {
  const setModel = (model: FutureModelType) => {
    onChange({ ...config, model });
  };

  const setSwing = (party: keyof typeof DEFAULT_SWINGS, value: number) => {
    onChange({
      ...config,
      model: 'swing',
      swings: { ...config.swings, [party]: value },
    });
  };

  return (
    <section className="future-panel" aria-label="Future Election Scenario Controls">
      <div className="future-panel-head">
        <div className="future-title-group">
          <Sparkles className="icon-sm future-icon" />
          <div>
            <h3 className="future-title">
              Future Scenario Simulator ({config.targetYear} Projection)
            </h3>
            <p className="future-desc">
              Explore projected party domination based on verified 2023–2026 baselines or historical riding dominance. Clearly marked as a simulation — not official results.
            </p>
          </div>
        </div>

        <div className="segmented-control" role="group" aria-label="Projection methodology">
          <button
            type="button"
            className={`seg-btn ${config.model === 'swing' ? 'seg-btn--active' : ''}`}
            onClick={() => setModel('swing')}
          >
            <SlidersHorizontal className="icon-xs" />
            Vote Swing
          </button>
          <button
            type="button"
            className={`seg-btn ${config.model === 'dominance_trend' ? 'seg-btn--active' : ''}`}
            onClick={() => setModel('dominance_trend')}
          >
            Historical Domination
          </button>
          <button
            type="button"
            className={`seg-btn ${config.model === 'status_quo' ? 'seg-btn--active' : ''}`}
            onClick={() => setModel('status_quo')}
          >
            Incumbent Hold
          </button>
        </div>
      </div>

      {config.model === 'swing' && (
        <div className="future-swing-body">
          <div className="swing-presets">
            <span className="preset-label">Presets:</span>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="pill-btn"
                onClick={() => onChange({ ...config, model: 'swing', swings: { ...p.swings } })}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              className="pill-btn"
              onClick={() => onChange({ ...config, swings: { ...DEFAULT_SWINGS } })}
            >
              <RotateCcw className="icon-xxs" />
              Reset
            </button>
          </div>

          <div className="swing-sliders-grid">
            {(
              [
                { id: 'NDP', label: 'NDP Swing' },
                { id: 'PC', label: 'PC Swing' },
                { id: 'MLP', label: 'Liberal Swing' },
                { id: 'GPM', label: 'Green Swing' },
                { id: 'KP', label: 'Keystone Swing' },
              ] as const
            ).map((item) => {
              const val = config.swings[item.id];
              return (
                <label key={item.id} className="swing-slider-item">
                  <div className="swing-slider-label">
                    <span className={`legend-swatch legend-swatch--${item.id}`} />
                    <span>{item.label}</span>
                    <strong className={val > 0 ? 'delta-pos' : val < 0 ? 'delta-neg' : ''}>
                      {val > 0 ? `+${val}%` : `${val}%`}
                    </strong>
                  </div>
                  <input
                    type="range"
                    min={-15}
                    max={15}
                    step={1}
                    value={val}
                    onChange={(e) => setSwing(item.id, Number(e.target.value))}
                  />
                </label>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};

