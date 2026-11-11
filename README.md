# Manitoba Elections & Governance Atlas (React PWA)

An installable Progressive Web App (PWA) built with React, TypeScript, Vite, and `d3-geo` that visualizes Manitoba's 57 provincial electoral divisions, current & historical Legislative Assembly Members (1870–2026), party domination analytics, future scenario projections, and municipal mayors, reeves, and councillors across Manitoba.

## Features

- **Provincial Electoral Map (57 Districts, 1995–2031)**:
  - Vector GeoJSON map (both **2018** and **2008** boundary redistributions) with a dedicated **Winnipeg Metro Inset**, regional zoom presets (*All Manitoba*, *Winnipeg (32)*, *South & Interlake*, *Westman & Brandon*, *North*), and pan/zoom controls.
  - Color modes: **MLA Party**, **Party Domination**, and **Party Flips**.
  - **Past ← Present → Future Time Travel** across 8 General Elections (`1995`–`2023`), 17 By-Elections (`2005`–`2026`), Current Sitting Assembly (`2026`), and Future Projections (`2027*` & `2031*`) with uniform vote-swing sliders and historical dominance modeling.
  - **57-District Party Domination Matrix** and legislative seat trajectory chart.
- **Legislature Members Archive (896 MLAs, 1870–2026)**:
  - Browse **57 Current Sitting MLAs**, **226 Former Living MLAs**, and **666 Deceased Historical MLAs** sourced directly from the Legislative Assembly of Manitoba (`gov.mb.ca/legislature`).
  - Filter by status, party, era (`1870–1949`, `1950–1994`, `1995–2026`, `2026 Sitting`), constituency, or Cabinet/Speaker role, with one-click jump to the provincial map.
- **Municipal Councils & Wards**:
  - **City of Winnipeg Wards & Mayor (1964–2026)**: Interactive 15-Ward GeoJSON map, Mayor & Ward Councillor timeline (`1974`–`2026`), candidate vote counts (`1964`–`2022`), councillor tenure dominance, and ward turnover views.
  - **All 135 Manitoba Municipalities**: Interactive province-wide municipal boundary map and searchable council directory listing each City/Town/Village/RM's **Mayor or Reeve**, **Chief Administrative Officer**, **Councillors**, population, and official links from the Manitoba Municipal Officials Directory.
- **Offline-Ready PWA**:
  - Precaches app assets, icons, GeoJSON boundaries, and election/municipal JSON datasets via Workbox Service Worker (`vite-plugin-pwa`).

## Quick Start

```bash
npm install
npm run dev      # Dev server at http://127.0.0.1:5173
npm test         # Run unit, schema, dataset & integration tests
npm run build    # Type-check & build production PWA
npm run preview  # Preview production PWA at http://127.0.0.1:4173
```

## Official Government Data Importer Tool

Refresh all provincial, MLA archive, and municipal datasets directly from official Manitoba government & municipal open-data endpoints into `public/data/`:

```bash
# Full import (boundaries + general & by-elections + 1870-2026 MLAs + Winnipeg & Manitoba municipal councils)
npm run import:data

# Refresh election results, MLAs & municipal data while reusing existing boundary GeoJSONs
npm run import:data -- --skip-boundaries

# Verify dataset schemas & completeness offline
npm run import:verify
```

### Populated Datasets (`public/data/`)

- `boundaries-2018.geojson` & `boundaries-2008.geojson` — 57 Manitoba provincial electoral divisions
- `elections.json` & `districts.json` — 1995–2026 provincial election snapshots & per-district histories
- `legislature-members.json` — 896 current, former living, and historical MLAs (1870–2026)
- `municipal.json` & `municipalities.geojson` — Winnipeg 15-ward GeoJSON + 1964–2026 Mayor/Councillor elections + 135 Manitoba municipal councils & boundaries
- `metadata.json` — Official source URLs, record counts, timestamps, and SHA-256 checksums
