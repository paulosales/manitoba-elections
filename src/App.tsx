import React, { useEffect, useMemo, useState } from 'react';
import {
  validateBoundariesGeoJson,
  validateDistrictsDataset,
  validateElectionsDataset,
  validateLegislatureMembersDataset,
  validateMetadataDataset,
  validateMunicipalDataset,
  validateMunicipalitiesGeoJson,
} from './schemas/datasetSchema';
import type {
  AppTab,
  BoundariesGeoJson,
  DistrictProfile,
  DistrictsDataset,
  ElectionsDataset,
  FutureSwingConfig,
  LegislatureMembersDataset,
  MapColorMode,
  MetadataDataset,
  MunicipalDataset,
  MunicipalitiesGeoJson,
  RegionView,
} from './types/election';
import { buildFutureSnapshot } from './utils/electionMath';
import { AssemblySummary } from './components/AssemblySummary';
import { TimelineBar } from './components/TimelineBar';
import { FutureSimulatorBar } from './components/FutureSimulatorBar';
import { ManitobaMap } from './components/ManitobaMap';
import { DistrictPanel } from './components/DistrictPanel';
import { DominationAnalyticsModal } from './components/DominationAnalyticsModal';
import { DataImporterModal } from './components/DataImporterModal';
import { LegislatureMembersView } from './components/LegislatureMembersView';
import { MunicipalView } from './components/MunicipalView';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DEFAULT_FUTURE_2027: FutureSwingConfig = {
  model: 'swing',
  targetYear: 2027,
  swings: { NDP: 0, PC: 0, MLP: 0, GPM: 0, KP: 0 },
};

const CUSTOM_BUNDLE_IDB_DB = 'manitoba-elections-db';
const CUSTOM_BUNDLE_STORE = 'datasets';
const CUSTOM_BUNDLE_KEY = 'custom-bundle';

async function loadCustomBundleFromIdb(): Promise<{
  elections: ElectionsDataset;
  districts: DistrictsDataset;
} | null> {
  if (typeof indexedDB === 'undefined') return null;
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(CUSTOM_BUNDLE_IDB_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(CUSTOM_BUNDLE_STORE)) {
          req.result.createObjectStore(CUSTOM_BUNDLE_STORE);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(CUSTOM_BUNDLE_STORE, 'readonly');
        const getReq = tx.objectStore(CUSTOM_BUNDLE_STORE).get(CUSTOM_BUNDLE_KEY);
        getReq.onsuccess = () => resolve(getReq.result ?? null);
        getReq.onerror = () => resolve(null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function saveCustomBundleToIdb(
  bundle: { elections: ElectionsDataset; districts: DistrictsDataset } | null
): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(CUSTOM_BUNDLE_IDB_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(CUSTOM_BUNDLE_STORE)) {
          req.result.createObjectStore(CUSTOM_BUNDLE_STORE);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(CUSTOM_BUNDLE_STORE, 'readwrite');
        const store = tx.objectStore(CUSTOM_BUNDLE_STORE);
        if (bundle) {
          store.put(bundle, CUSTOM_BUNDLE_KEY);
        } else {
          store.delete(CUSTOM_BUNDLE_KEY);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      };
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export const App: React.FC = () => {
  const [geo2018, setGeo2018] = useState<BoundariesGeoJson | null>(null);
  const [geo2008, setGeo2008] = useState<BoundariesGeoJson | null>(null);
  const [elections, setElections] = useState<ElectionsDataset | null>(null);
  const [districts, setDistricts] = useState<DistrictsDataset | null>(null);
  const [legislatureMembers, setLegislatureMembers] =
    useState<LegislatureMembersDataset | null>(null);
  const [municipalData, setMunicipalData] = useState<MunicipalDataset | null>(null);
  const [municipalitiesGeoJson, setMunicipalitiesGeoJson] =
    useState<MunicipalitiesGeoJson | null>(null);

  const [officialBackup, setOfficialBackup] = useState<{
    elections: ElectionsDataset;
    districts: DistrictsDataset;
  } | null>(null);
  const [metadata, setMetadata] = useState<MetadataDataset | null>(null);
  const [hasCustomOverride, setHasCustomOverride] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Interactive navigation state
  const [activeTab, setActiveTab] = useState<AppTab>('provincial');
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [selectedDistrictId, setSelectedDistrictId] = useState<string | null>('fort-rouge');
  const [colorMode, setColorMode] = useState<MapColorMode>('party');
  const [regionView, setRegionView] = useState<RegionView>('all');
  const [unifiedBoundaries, setUnifiedBoundaries] = useState<boolean>(false);
  const [dominationFromYear, setDominationFromYear] = useState<number>(1995);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // Future Scenario state
  const [futureConfig, setFutureConfig] = useState<FutureSwingConfig>(DEFAULT_FUTURE_2027);

  // Modals & PWA status
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [importerOpen, setImporterOpen] = useState(false);
  const [isOffline, setIsOffline] = useState<boolean>(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      try {
        const [rGeo18, rGeo08, rElec, rDist, rMeta, rMembers, rMunicipal, rMuniGeo] =
          await Promise.all([
            fetch('/data/boundaries-2018.geojson'),
            fetch('/data/boundaries-2008.geojson'),
            fetch('/data/elections.json'),
            fetch('/data/districts.json'),
            fetch('/data/metadata.json'),
            fetch('/data/legislature-members.json'),
            fetch('/data/municipal.json'),
            fetch('/data/municipalities.geojson'),
          ]);

        if (!rGeo18.ok || !rGeo08.ok || !rElec.ok || !rDist.ok) {
          throw new Error('Failed to load Manitoba election datasets.');
        }

        const [jGeo18, jGeo08, jElec, jDist, jMeta, jMembers, jMunicipal, jMuniGeo] =
          await Promise.all([
            rGeo18.json(),
            rGeo08.json(),
            rElec.json(),
            rDist.json(),
            rMeta.ok ? rMeta.json() : Promise.resolve(null),
            rMembers.ok ? rMembers.json() : Promise.resolve(null),
            rMunicipal.ok ? rMunicipal.json() : Promise.resolve(null),
            rMuniGeo.ok ? rMuniGeo.json() : Promise.resolve(null),
          ]);

        const vGeo18 = validateBoundariesGeoJson(jGeo18);
        const vGeo08 = validateBoundariesGeoJson(jGeo08);
        const vElec = validateElectionsDataset(jElec);
        const vDist = validateDistrictsDataset(jDist);
        const vMeta = jMeta ? validateMetadataDataset(jMeta) : null;
        const vMembers = jMembers ? validateLegislatureMembersDataset(jMembers) : null;
        const vMunicipal = jMunicipal ? validateMunicipalDataset(jMunicipal) : null;
        const vMuniGeo = jMuniGeo ? validateMunicipalitiesGeoJson(jMuniGeo) : null;

        if (cancelled) return;
        setGeo2018(vGeo18);
        setGeo2008(vGeo08);
        setOfficialBackup({ elections: vElec, districts: vDist });
        setMetadata(vMeta);
        setLegislatureMembers(vMembers);
        setMunicipalData(vMunicipal);
        setMunicipalitiesGeoJson(vMuniGeo);

        const custom = await loadCustomBundleFromIdb();
        if (!cancelled && custom) {
          try {
            const cElec = validateElectionsDataset(custom.elections);
            const cDist = validateDistrictsDataset(custom.districts);
            setElections(cElec);
            setDistricts(cDist);
            setHasCustomOverride(true);
            const curIdx = cElec.snapshots.findIndex((s) => s.kind === 'current');
            setActiveIndex(curIdx >= 0 ? curIdx : cElec.snapshots.length - 1);
            return;
          } catch {
            // Fall back to official dataset if stored custom bundle is stale
          }
        }

        setElections(vElec);
        setDistricts(vDist);
        const curIdx = vElec.snapshots.findIndex((s) => s.kind === 'current');
        setActiveIndex(curIdx >= 0 ? curIdx : vElec.snapshots.length - 1);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Unable to load datasets.');
        }
      }
    }
    void loadAll();
    return () => {
      cancelled = true;
    };
  }, []);

  const fullSnapshots = useMemo(() => {
    if (!elections || !districts) return [];
    const currentSnap =
      elections.snapshots.find((s) => s.kind === 'current') ??
      elections.snapshots[elections.snapshots.length - 1];
    if (!currentSnap) return elections.snapshots;

    const proj2027 = buildFutureSnapshot(currentSnap, districts.districts, {
      ...futureConfig,
      targetYear: 2027,
    });
    const proj2031 = buildFutureSnapshot(currentSnap, districts.districts, {
      ...futureConfig,
      targetYear: 2031,
    });

    return [...elections.snapshots, proj2027, proj2031];
  }, [elections, districts, futureConfig]);

  useEffect(() => {
    if (!isPlaying || fullSnapshots.length === 0) return;
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => {
        if (prev >= fullSnapshots.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [isPlaying, fullSnapshots.length]);

  const districtsById = useMemo(() => {
    const map = new Map<string, DistrictProfile>();
    for (const d of districts?.districts ?? []) {
      map.set(d.id, d);
    }
    return map;
  }, [districts]);

  const activeSnapshot = fullSnapshots[activeIndex] ?? fullSnapshots[0] ?? null;
  const previousSnapshot = activeIndex > 0 ? fullSnapshots[activeIndex - 1] ?? null : null;

  useEffect(() => {
    if (activeSnapshot?.id === 'future-2027' && futureConfig.targetYear !== 2027) {
      setFutureConfig((prev) => ({ ...prev, targetYear: 2027 }));
    } else if (activeSnapshot?.id === 'future-2031' && futureConfig.targetYear !== 2031) {
      setFutureConfig((prev) => ({ ...prev, targetYear: 2031 }));
    }
  }, [activeSnapshot?.id, futureConfig.targetYear]);

  const handleInstallPwa = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const handleJumpToYear = (year: number, eventId: string) => {
    const byId = fullSnapshots.findIndex((s) => s.id === eventId);
    if (byId !== -1) {
      setActiveIndex(byId);
      return;
    }
    const byYear = fullSnapshots.findIndex((s) => s.year === year);
    if (byYear !== -1) {
      setActiveIndex(byYear);
    }
  };

  const handleApplyImportedBundle = (bundle: {
    elections: ElectionsDataset;
    districts: DistrictsDataset;
  }) => {
    setElections(bundle.elections);
    setDistricts(bundle.districts);
    setHasCustomOverride(true);
    void saveCustomBundleToIdb(bundle);
  };

  const handleResetToOfficial = () => {
    if (!officialBackup) return;
    setElections(officialBackup.elections);
    setDistricts(officialBackup.districts);
    setHasCustomOverride(false);
    void saveCustomBundleToIdb(null);
  };

  if (loadError) {
    return (
      <main className="loading-screen" role="alert">
        <div className="loading-card">
          <h1>Unable to Load Manitoba Election Data</h1>
          <p>{loadError}</p>
        </div>
      </main>
    );
  }

  if (!geo2018 || !geo2008 || !elections || !districts || !activeSnapshot) {
    return (
      <main className="loading-screen">
        <div className="loading-card">
          <div className="spinner" aria-hidden="true" />
          <p>Loading Manitoba electoral divisions, MLAs, and municipal datasets…</p>
        </div>
      </main>
    );
  }

  const use2008Geo = activeSnapshot.boundaryEra === '2008' && !unifiedBoundaries;
  const activeGeoJson = use2008Geo ? geo2008 : geo2018;
  const activeResultsMap = use2008Geo
    ? activeSnapshot.results
    : activeSnapshot.resultsUnified2018;
  const prevResultsMap = previousSnapshot
    ? use2008Geo && previousSnapshot.boundaryEra === '2008'
      ? previousSnapshot.results
      : previousSnapshot.resultsUnified2018
    : null;

  const selectedProfile = selectedDistrictId
    ? districtsById.get(selectedDistrictId) ??
      districts.districts.find(
        (d) =>
          d.id === selectedDistrictId ||
          d.name.toLowerCase() ===
            (activeGeoJson.features.find((f) => f.properties.id === selectedDistrictId)?.properties
              .name.toLowerCase() ?? '')
      ) ??
      null
    : null;

  const selectedRecord = selectedDistrictId
    ? activeResultsMap[selectedDistrictId] ??
      (selectedProfile ? activeSnapshot.resultsUnified2018[selectedProfile.id] : null) ??
      null
    : null;

  return (
    <div className="app-shell">
      <AssemblySummary
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        totalMlaCount={legislatureMembers?.counts.total ?? 57}
        totalMunicipalitiesCount={municipalData?.manitobaMunicipalities.length ?? 0}
        activeSnapshot={activeSnapshot}
        resultsMap={activeResultsMap}
        districts={districts.districts}
        parties={elections.parties}
        onSelectDistrict={(id) => {
          setActiveTab('provincial');
          setSelectedDistrictId(id);
        }}
        onOpenAnalytics={() => setAnalyticsOpen(true)}
        onOpenImporter={() => setImporterOpen(true)}
        isOffline={isOffline}
        canInstallPwa={Boolean(installPrompt)}
        onInstallPwa={() => void handleInstallPwa()}
      />

      <main className="main-content">
        {activeTab === 'provincial' && (
          <>
            <TimelineBar
              snapshots={fullSnapshots}
              activeIndex={activeIndex}
              onSelectIndex={(idx) => {
                setIsPlaying(false);
                setActiveIndex(idx);
              }}
              isPlaying={isPlaying}
              onTogglePlay={() => setIsPlaying((p) => !p)}
              colorMode={colorMode}
              onChangeColorMode={setColorMode}
              dominationFromYear={dominationFromYear}
              onChangeDominationFromYear={setDominationFromYear}
            />

            {activeSnapshot.isProjection && (
              <FutureSimulatorBar config={futureConfig} onChange={setFutureConfig} />
            )}

            <div className="workspace-grid">
              <ManitobaMap
                geoJson={activeGeoJson}
                resultsMap={activeResultsMap}
                previousResultsMap={prevResultsMap}
                districtsById={districtsById}
                parties={elections.parties}
                selectedDistrictId={selectedDistrictId}
                onSelectDistrict={(id) => setSelectedDistrictId(id)}
                colorMode={colorMode}
                regionView={regionView}
                onChangeRegionView={setRegionView}
                dominationWindow={[dominationFromYear, Math.min(2026, activeSnapshot.year)]}
                boundaryEra={activeSnapshot.boundaryEra}
                unifiedBoundaries={unifiedBoundaries}
                onToggleUnifiedBoundaries={() => setUnifiedBoundaries((v) => !v)}
                isProjection={activeSnapshot.isProjection}
              />

              <DistrictPanel
                district={selectedProfile}
                activeSnapshot={activeSnapshot}
                activeRecord={selectedRecord}
                parties={elections.parties}
                dominationWindow={[dominationFromYear, 2026]}
                snapshots={fullSnapshots}
                onJumpToYear={handleJumpToYear}
              />
            </div>
          </>
        )}

        {activeTab === 'legislature' && legislatureMembers && (
          <LegislatureMembersView
            dataset={legislatureMembers}
            parties={elections.parties}
            modernDistricts={districts.districts}
            onJumpToDistrictOnMap={(districtId) => {
              setSelectedDistrictId(districtId);
              setActiveTab('provincial');
            }}
          />
        )}

        {activeTab === 'municipal' && municipalData && municipalitiesGeoJson && (
          <MunicipalView
            municipal={municipalData}
            municipalitiesGeoJson={municipalitiesGeoJson}
          />
        )}
      </main>

      <DominationAnalyticsModal
        open={analyticsOpen}
        onClose={() => setAnalyticsOpen(false)}
        snapshots={fullSnapshots}
        districts={districts.districts}
        parties={elections.parties}
        onSelectDistrictAndYear={(id, idx) => {
          setSelectedDistrictId(id);
          setActiveIndex(idx);
          setActiveTab('provincial');
        }}
      />

      <DataImporterModal
        open={importerOpen}
        onClose={() => setImporterOpen(false)}
        metadata={metadata}
        elections={elections}
        districts={districts}
        hasCustomOverride={hasCustomOverride}
        onApplyImportedBundle={handleApplyImportedBundle}
        onResetToOfficial={handleResetToOfficial}
      />
    </div>
  );
};
export default App;
