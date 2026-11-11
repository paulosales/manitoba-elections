import React, { useRef, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Database,
  Download,
  ExternalLink,
  RotateCcw,
  ShieldCheck,
  Terminal,
  Upload,
  X,
} from 'lucide-react';
import type {
  DistrictsDataset,
  ElectionsDataset,
  MetadataDataset,
} from '../types/election';
import { isSafeHttpsUrl, parseAndValidateBundleJson } from '../schemas/datasetSchema';

interface DataImporterModalProps {
  open: boolean;
  onClose: () => void;
  metadata: MetadataDataset | null;
  elections: ElectionsDataset;
  districts: DistrictsDataset;
  hasCustomOverride: boolean;
  onApplyImportedBundle: (bundle: {
    elections: ElectionsDataset;
    districts: DistrictsDataset;
  }) => void;
  onResetToOfficial: () => void;
}

export const DataImporterModal: React.FC<DataImporterModalProps> = ({
  open,
  onClose,
  metadata,
  elections,
  districts,
  hasCustomOverride,
  onApplyImportedBundle,
  onResetToOfficial,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [statusMessage, setStatusMessage] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);

  if (!open) return null;

  const cliCommand = 'npm run import:data';

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(cliCommand);
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 2000);
    } catch {
      setStatusMessage({
        kind: 'error',
        text: 'Clipboard unavailable. Copy the command manually: npm run import:data',
      });
    }
  };

  const handleExportBundle = () => {
    const bundle = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      elections,
      districts,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `manitoba-elections-dataset-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMessage({ kind: 'success', text: 'Exported validated dataset bundle JSON.' });
  };

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.json')) {
      setStatusMessage({ kind: 'error', text: 'Only .json dataset bundles are permitted.' });
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setStatusMessage({ kind: 'error', text: 'File exceeds 15 MB safety limit.' });
      return;
    }
    try {
      const text = await file.text();
      const validated = parseAndValidateBundleJson(text);
      onApplyImportedBundle(validated);
      setStatusMessage({
        kind: 'success',
        text: `Imported ${validated.districts.districts.length} districts and ${validated.elections.snapshots.length} election snapshots into local offline storage.`,
      });
    } catch (err) {
      setStatusMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Invalid dataset JSON schema.',
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Government Election Data Importer">
      <div className="modal-card">
        <div className="modal-header">
          <div className="modal-title-group">
            <Database className="icon-md" />
            <div>
              <h2>Government Election Data Importer &amp; Provenance</h2>
              <p>
                Official datasets populated directly from Elections Manitoba &amp; the Legislative Assembly of Manitoba.
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close modal">
            <X className="icon-sm" />
          </button>
        </div>

        {/* Summary Stats */}
        <div className="importer-stats-grid">
          <div className="metric-box">
            <span className="metric-lbl">Electoral Divisions</span>
            <strong className="metric-val">{districts.districts.length}</strong>
          </div>
          <div className="metric-box">
            <span className="metric-lbl">Election Snapshots</span>
            <strong className="metric-val">{elections.snapshots.length}</strong>
          </div>
          <div className="metric-box">
            <span className="metric-lbl">By-Elections Imported</span>
            <strong className="metric-val">{metadata?.counts.byElectionsImported ?? 0}</strong>
          </div>
          <div className="metric-box">
            <span className="metric-lbl">Historical MLAs</span>
            <strong className="metric-val">
              {metadata?.counts.legislatureMembersTotal ?? '—'}
            </strong>
          </div>
          <div className="metric-box">
            <span className="metric-lbl">MB Municipalities</span>
            <strong className="metric-val">
              {metadata?.counts.manitobaMunicipalities ?? '—'}
            </strong>
          </div>
          <div className="metric-box">
            <span className="metric-lbl">Winnipeg Wards</span>
            <strong className="metric-val">{metadata?.counts.winnipegWards ?? '—'}</strong>
          </div>
          <div className="metric-box">
            <span className="metric-lbl">Last Imported</span>
            <strong className="metric-val">
              {metadata?.importedAt ? metadata.importedAt.slice(0, 10) : 'Custom'}
            </strong>
          </div>
        </div>

        {/* CLI Tool Runner Section */}
        <div className="importer-section">
          <h3 className="section-heading">
            <Terminal className="icon-xs" />
            Official Government CLI Importer Tool
          </h3>
          <p className="importer-desc">
            Run the Node.js CLI importer in this repository to fetch fresh official spreadsheets, PDFs, sitting MLA rosters, and boundary GeoJSONs directly from Manitoba government sites and regenerate <code>public/data/</code>:
          </p>
          <div className="cli-box">
            <code>{cliCommand}</code>
            <button type="button" className="pill-btn" onClick={handleCopyCommand}>
              <Copy className="icon-xxs" />
              {copiedCmd ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className="importer-hint">
            Includes strict HTTPS domain allow-listing (<code>electionsmanitoba.ca</code>, <code>gov.mb.ca</code>, <code>represent.opennorth.ca</code>), ZIP/XML XXE protection, and 57-seat schema verification (<code>npm run import:verify</code>).
          </p>
        </div>

        {/* Local Bundle Import / Export */}
        <div className="importer-section">
          <h3 className="section-heading">
            <ShieldCheck className="icon-xs" />
            Dataset Bundle Export / Local Override
          </h3>
          <div className="importer-actions">
            <button type="button" className="action-btn" onClick={handleExportBundle}>
              <Download className="icon-xs" />
              Export JSON Bundle
            </button>

            <label className="action-btn file-upload-btn">
              <Upload className="icon-xs" />
              Load Dataset JSON
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={handleFileChange}
              />
            </label>

            {hasCustomOverride && (
              <button type="button" className="action-btn" onClick={onResetToOfficial}>
                <RotateCcw className="icon-xs" />
                Restore Official Dataset
              </button>
            )}
          </div>

          {statusMessage && (
            <div
              className={`status-banner ${
                statusMessage.kind === 'error' ? 'status-banner--error' : 'status-banner--ok'
              }`}
              role="status"
            >
              <CheckCircle2 className="icon-xs" />
              <span>{statusMessage.text}</span>
            </div>
          )}
        </div>

        {/* Official Government Sources Provenance */}
        {metadata && (
          <div className="importer-section">
            <h3 className="section-heading">Verified Government Sources</h3>
            <ul className="sources-list">
              {metadata.sources.map((src) => (
                <li key={src.url} className="source-item">
                  <span>{src.name}</span>
                  {isSafeHttpsUrl(src.url) && (
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ext-link"
                    >
                      Source <ExternalLink className="icon-xxs" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

