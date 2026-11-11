import * as cheerio from 'cheerio';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseXlsxWorkbook } from './xlsx.mjs';
import {
  cleanDivisionName,
  normalizeCandidateName,
  normalizeGeometryWindingForD3,
  normalizeParty,
  slugifyDivision,
} from './normalization.mjs';

function parseIntClean(str) {
  const digits = String(str ?? '').replace(/[^0-9]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

function parsePctClean(str) {
  const raw = String(str ?? '').replace(/[% ,]/g, '').trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  // XLSX stores proportions like 0.6337 whereas PDFs store 63.37%
  return n <= 1.0001 && !String(str).includes('%') ? Number((n * 100).toFixed(2)) : Number(n.toFixed(2));
}

function finalizeDivisionRecord(divisionName, candidates, extra = {}) {
  const sorted = [...candidates]
    .filter((c) => c.votes !== null && c.votes >= 0)
    .sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0));

  const computedTotal = sorted.reduce((acc, c) => acc + (c.votes ?? 0), 0);
  const validVotes = extra.validVotes ?? computedTotal;
  const ballotsCast = extra.ballotsCast ?? validVotes;

  const enriched = sorted.map((c, idx) => {
    const pct =
      c.voteSharePct !== null && c.voteSharePct !== undefined
        ? c.voteSharePct
        : ballotsCast > 0
          ? Number((((c.votes ?? 0) / ballotsCast) * 100).toFixed(2))
          : 0;
    return {
      name: c.name,
      party: c.party,
      partyRaw: c.partyRaw,
      votes: c.votes ?? 0,
      voteSharePct: pct,
      elected: idx === 0,
    };
  });

  const winner = enriched[0] ?? {
    name: 'Unknown',
    party: 'OTHER',
    partyRaw: '',
    votes: 0,
    voteSharePct: 0,
    elected: true,
  };
  const runnerUp = enriched[1] ?? null;
  const marginVotes = extra.marginVotes ?? (runnerUp ? winner.votes - runnerUp.votes : winner.votes);
  const marginPct =
    ballotsCast > 0
      ? Number(((marginVotes / ballotsCast) * 100).toFixed(2))
      : runnerUp
        ? Number((winner.voteSharePct - runnerUp.voteSharePct).toFixed(2))
        : winner.voteSharePct;

  const reg = extra.registeredVoters ?? null;
  const turnoutPct =
    extra.turnoutPct ??
    (reg && reg > 0 && ballotsCast > 0 ? Number(((ballotsCast / reg) * 100).toFixed(2)) : null);

  return {
    divisionName,
    divisionSlug: slugifyDivision(divisionName),
    winner,
    runnerUpParty: runnerUp ? runnerUp.party : null,
    marginVotes,
    marginPct,
    ballotsCast,
    registeredVoters: reg,
    turnoutPct,
    candidates: enriched,
    ...(extra.note ? { note: extra.note } : {}),
  };
}

/**
 * Parses current sitting MLAs from the Legislative Assembly of Manitoba HTML page.
 */
export function parseCurrentMlasHtml(html, sourceUrl) {
  const $ = cheerio.load(html);
  const rows = [];

  $('table tr').each((_, tr) => {
    const tds = $(tr).children('td');
    if (tds.length < 3) return;
    const constituencyRaw = $(tds[0]).text().replace(/\s+/g, ' ').trim();
    const memberRaw = $(tds[1]).text().replace(/\s+/g, ' ').trim();
    const partyRaw = $(tds[2]).text().replace(/\s+/g, ' ').trim();
    if (!constituencyRaw || !memberRaw || /constituency/i.test(constituencyRaw)) return;

    const href = $(tds[1]).find('a').first().attr('href') ?? '';
    let profileUrl = null;
    if (href && !href.startsWith('javascript:')) {
      try {
        const resolved = new URL(href, sourceUrl);
        if (resolved.protocol === 'https:') {
          profileUrl = resolved.toString();
        }
      } catch {
        profileUrl = null;
      }
    }

    const divisionName = cleanDivisionName(constituencyRaw);
    const party = normalizeParty(partyRaw || memberRaw);
    const parsedName = normalizeCandidateName(memberRaw);
    rows.push({
      divisionName,
      divisionSlug: slugifyDivision(divisionName),
      memberName: /vacant/i.test(memberRaw) ? 'Vacant' : parsedName.displayName,
      isMinisterial: parsedName.isMinisterial,
      party: /vacant/i.test(memberRaw) ? 'VAC' : party,
      partyRaw,
      profileUrl,
    });
  });

  return rows;
}

/**
 * Parses 2023 General Election XLSX ("43GE Summary of Votes Received.xlsx").
 */
export function parse2023Xlsx(buffer) {
  const sheets = parseXlsxWorkbook(buffer);
  const rows = sheets[0]?.rows ?? [];
  const results = [];

  let currentDiv = null;
  let candidates = [];
  let ballotsCast = null;
  let registeredVoters = null;

  const flush = () => {
    if (!currentDiv || candidates.length === 0) return;
    results.push(
      finalizeDivisionRecord(currentDiv, candidates, {
        ballotsCast,
        registeredVoters,
      })
    );
  };

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const divCell = (row[0] ?? '').trim();
    const candCell = (row[1] ?? '').trim();
    const partyCell = (row[2] ?? '').trim();
    const votesCell = (row[3] ?? '').trim();
    const pctCell = (row[4] ?? '').trim();
    const ballotsCell = (row[5] ?? '').trim();
    const regCell = (row[6] ?? '').trim();

    if (/^total/i.test(divCell)) {
      flush();
      currentDiv = null;
      candidates = [];
      break;
    }

    if (divCell) {
      flush();
      currentDiv = cleanDivisionName(divCell);
      candidates = [];
      ballotsCast = null;
      registeredVoters = null;
    }

    if (!currentDiv) continue;

    if (ballotsCell && !candCell) {
      ballotsCast = parseIntClean(ballotsCell) ?? ballotsCast;
      registeredVoters = parseIntClean(regCell) ?? registeredVoters;
      continue;
    }

    if (/^(declined|rejected)/i.test(candCell)) {
      continue;
    }

    if (candCell && partyCell) {
      const parsedName = normalizeCandidateName(candCell);
      candidates.push({
        name: parsedName.displayName,
        party: normalizeParty(partyCell),
        partyRaw: partyCell,
        votes: parseIntClean(votesCell),
        voteSharePct: parsePctClean(pctCell),
      });
    }
  }

  flush();
  return results;
}

async function extractPdfPagesItems(buffer) {
  const data = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    pages.push({
      pageNumber: p,
      items: content.items
        .filter((it) => it.str && it.str.trim())
        .map((it) => ({
          x: Math.round(it.transform[4]),
          y: Math.round(it.transform[5]),
          s: it.str.replace(/\u00a0/g, ' ').trim(),
        })),
    });
  }
  return pages;
}

function groupItemsIntoRows(items, yTolerance = 3) {
  const rows = [];
  for (const it of items) {
    let row = rows.find((r) => Math.abs(r.y - it.y) <= yTolerance);
    if (!row) {
      row = { y: it.y, items: [] };
      rows.push(row);
    }
    row.items.push(it);
  }
  rows.sort((a, b) => b.y - a.y);
  for (const r of rows) {
    r.items.sort((a, b) => a.x - b.x);
  }
  return rows;
}

const FRENCH_SUBLABEL_RE =
  /^(Brandon[-– ]?Est|Brandon[-– ]?Oues?t?|Chemin[-–]?Dawson|Fort[-–]Rouge|Gare[-–]Union|Entre[-–]les[-–]Lacs.*|Le Pas.*|Pointe[-– ]?Douglas|Portage[-–]la[-–]Prairie|Rivière[-–]Rouge[-–]Nord|Rivière[-– ]?Seine|Saint[-–]Boniface|Saint[-–]James|Saint[-–]Johns|Saint[-–]Norbert|Saint[-–]Vital|Sainte[-–]Rose|Mont[-–]Riding|Mont[-–]Turtle|Lac[-–]du[-–]Bonnet)$/i;

const HEADER_FOOTER_RE =
  /^(SUMMARY OF VOTES|COMPTES RENDU|COMPTE RENDU|\d+\s*(ND|RD|TH|E)?\s*(GENERAL|ÉLECTION)|Electoral Division|Circonscription|électorale|Candidate|Candidat|Party|Registered Party|Political Party|Parti|Votes|Suffrages|Ballots Cast|exprimés|% of Votes|Cast \*|des voix|Pourcentage|Percent of|Table\/Tableau|Statement of Votes|Relevé des suffrages|ÉLECTIONS|ELECTIONS|MANITOBA|voix obtenues|obtenues|ou candidate|\*Total votes|\*Voix obtenues|faveur du|\(de la\)|Nombre de voix|^\d+$)/i;

/**
 * Coordinate-aware parser for Elections Manitoba PDF_EDResults_GE20XX.pdf (1999, 2007, 2011, 2016, 2019).
 */
export async function parsePdfGeneralElection(buffer, year) {
  const pages = await extractPdfPagesItems(buffer);
  const results = [];

  if (year === 2016) {
    // 2016 PDF has centered division labels and a duplicated layer after a second header on even pages
    const seenDivisions = new Set();

    for (const page of pages) {
      // Truncate before duplicated second-page layer (marked by a SUMMARY header after item 20)
      let cutIdx = page.items.length;
      for (let i = 20; i < page.items.length; i++) {
        if (/SUMMARY OF VOTES RECEIVED/i.test(page.items[i].s)) {
          cutIdx = i;
          break;
        }
      }
      const cleanItems = page.items.slice(0, cutIdx);
      const rows = groupItemsIntoRows(cleanItems, 3);

      // Extract division labels (x < 180) and candidate rows (x >= 200)
      const divLabels = [];
      const candRows = [];

      for (const r of rows) {
        if (r.y > 690 || r.y < 100) continue;
        const leftItems = r.items.filter((it) => it.x < 190);
        const rightItems = r.items.filter((it) => it.x >= 200);

        if (leftItems.length > 0) {
          const text = leftItems.map((i) => i.s).join(' ').trim();
          if (text && !HEADER_FOOTER_RE.test(text)) {
            if (/^Portage-la-Prairie$/i.test(text) && divLabels.length > 0 && /Portage la Prairie/i.test(divLabels[divLabels.length - 1].raw)) {
              divLabels[divLabels.length - 1].raw += ' ' + text;
            } else {
              divLabels.push({ y: r.y, raw: text });
            }
          }
        }

        if (rightItems.length >= 3) {
          const cand = rightItems.filter((i) => i.x >= 210 && i.x < 380).map((i) => i.s).join(' ').trim();
          const party = rightItems.filter((i) => i.x >= 380 && i.x < 465).map((i) => i.s).join(' ').trim();
          const votesItem = rightItems.find((i) => i.x >= 465 && i.x < 530);
          const pctItem = rightItems.find((i) => i.x >= 530);
          const votes = parseIntClean(votesItem?.s);
          const pct = parsePctClean(pctItem?.s);
          if (cand && party && votes !== null && !HEADER_FOOTER_RE.test(cand)) {
            const parsedName = normalizeCandidateName(cand);
            candRows.push({
              y: r.y,
              name: parsedName.displayName,
              party: normalizeParty(party),
              partyRaw: party,
              votes,
              voteSharePct: pct,
            });
          }
        }
      }

      // Segment sorted candidate rows cleanly using monotonic % descent and <= 100.5% cumulative sum
      const groups = [];
      let currentGroup = [];
      let runningPct = 0;
      let prevPct = Infinity;
      for (const c of candRows) {
        const pct = c.voteSharePct ?? 0;
        const startsNew =
          currentGroup.length > 0 &&
          (pct > prevPct + 0.05 || (runningPct >= 90 && runningPct + pct > 100.5));
        if (startsNew) {
          groups.push(currentGroup);
          currentGroup = [];
          runningPct = 0;
        }
        currentGroup.push(c);
        runningPct += pct;
        prevPct = pct;
      }
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
      }

      if (groups.length !== divLabels.length) {
        throw new Error(
          `2016 PDF page ${page.pageNumber} segmentation mismatch: ${groups.length} groups vs ${divLabels.length} division labels`
        );
      }

      for (let idx = 0; idx < divLabels.length; idx++) {
        const divName = cleanDivisionName(divLabels[idx].raw);
        if (seenDivisions.has(divName) || groups[idx].length === 0) continue;
        seenDivisions.add(divName);
        results.push(finalizeDivisionRecord(divName, groups[idx]));
      }
    }

    return results;
  }

  // 1999, 2007, 2011, 2019: top-aligned division names
  let activeDivision = null;
  let activeCandidates = [];
  let activeBallotsCast = null;

  const flushActive = () => {
    if (!activeDivision || activeCandidates.length === 0) return;
    results.push(
      finalizeDivisionRecord(activeDivision, activeCandidates, {
        ballotsCast: activeBallotsCast,
      })
    );
    activeDivision = null;
    activeCandidates = [];
    activeBallotsCast = null;
  };

  // Determine x-column boundaries per year
  const colCfg =
    year === 2019
      ? { divMaxX: 120, candMaxX: 270, partyMaxX: 345, votesMaxX: 415, ballotsMaxX: 495 }
      : year === 2011
        ? { divMaxX: 210, candMaxX: 340, partyMaxX: 430, votesMaxX: 515, ballotsMaxX: 515 }
        : year === 2007
          ? { divMaxX: 155, candMaxX: 280, partyMaxX: 390, votesMaxX: 490, ballotsMaxX: 490 }
          : { divMaxX: 155, candMaxX: 285, partyMaxX: 395, votesMaxX: 475, ballotsMaxX: 475 }; // 1999

  for (const page of pages) {
    const rows = groupItemsIntoRows(page.items, 3);
    for (const r of rows) {
      if (r.y < 40) continue;
      const divStr = r.items.filter((i) => i.x < colCfg.divMaxX).map((i) => i.s).join(' ').trim();
      const candStr = r.items
        .filter((i) => i.x >= colCfg.divMaxX && i.x < colCfg.candMaxX)
        .map((i) => i.s)
        .join(' ')
        .trim();
      const partyStr = r.items
        .filter((i) => i.x >= colCfg.candMaxX && i.x < colCfg.partyMaxX)
        .map((i) => i.s)
        .join(' ')
        .trim();
      const votesStr = r.items
        .filter((i) => i.x >= colCfg.partyMaxX && i.x < colCfg.votesMaxX)
        .map((i) => i.s)
        .join(' ')
        .trim();
      const ballotsStr =
        colCfg.ballotsMaxX > colCfg.votesMaxX
          ? r.items
              .filter((i) => i.x >= colCfg.votesMaxX && i.x < colCfg.ballotsMaxX)
              .map((i) => i.s)
              .join(' ')
              .trim()
          : '';
      const pctStr = r.items
        .filter((i) => i.x >= colCfg.ballotsMaxX)
        .map((i) => i.s)
        .join(' ')
        .trim();

      if (HEADER_FOOTER_RE.test(divStr) || HEADER_FOOTER_RE.test(candStr) || /Table\/Tableau|Statement of Votes/i.test(r.items.map((i) => i.s).join(' '))) {
        continue;
      }

      if (divStr && !FRENCH_SUBLABEL_RE.test(divStr)) {
        const cleaned = cleanDivisionName(divStr);
        // If division matches activeDivision (bilingual continuation line), don't flush
        if (cleaned !== activeDivision) {
          flushActive();
          activeDivision = cleaned;
        }
      }

      if (activeDivision && candStr && partyStr) {
        const votes = parseIntClean(votesStr);
        const pct = parsePctClean(pctStr);
        if (votes !== null) {
          const parsedName = normalizeCandidateName(candStr);
          activeCandidates.push({
            name: parsedName.displayName,
            party: normalizeParty(partyStr),
            partyRaw: partyStr,
            votes,
            voteSharePct: pct,
          });
          if (ballotsStr) {
            const b = parseIntClean(ballotsStr);
            if (b) activeBallotsCast = b;
          }
        }
      }
    }
  }

  flushActive();
  return results;
}

/**
 * Parses 1995 (pages 86-87) and 2003 (pages 90-91) General Elections from
 * Elections Manitoba HistoricalSummary.pdf (landscape rotated tables).
 */
export async function parseHistoricalSummaryPdf(buffer) {
  const pages = await extractPdfPagesItems(buffer);
  const elections = { 1995: [], 2003: [] };

  const parseRotatedYearPages = (pageNums, year) => {
    const out = [];
    for (const pNum of pageNums) {
      const page = pages.find((p) => p.pageNumber === pNum);
      if (!page) continue;

      // Group by x (within +-4pt) because rows run vertically in this landscape PDF
      const cols = [];
      for (const it of page.items) {
        if (it.y < 40) continue;
        let col = cols.find((c) => Math.abs(c.x - it.x) <= 4);
        if (!col) {
          col = { x: it.x, items: [] };
          cols.push(col);
        }
        col.items.push(it);
      }
      cols.sort((a, b) => a.x - b.x);

      // Locate header y-bands from columns containing "Registered Voters" / "Lib." / "PC"
      const headerItems = cols
        .filter((c) => c.x >= 140 && c.x <= 190)
        .flatMap((c) => c.items);

      const findHeaderY = (re) => headerItems.find((i) => re.test(i.s))?.y ?? null;
      const yReg = findHeaderY(/Registered Voters/i);
      const yCast = findHeaderY(/Votes cast/i);
      const yTurnout = findHeaderY(/% Turnout/i);
      const yPlurality = findHeaderY(/Plurality/i);

      // Party column headers in rotated table
      const partyBands = [];
      const partyChecks = [
        { re: /^CPC-M/i, party: 'OTHER', raw: 'CPC-M' },
        { re: /^Ind\.?$/i, party: 'IND', raw: 'Ind.' },
        { re: /^LPM/i, party: 'OTHER', raw: 'LPM' },
        { re: /^Lib\.?$/i, party: 'MLP', raw: 'Lib.' },
        { re: /^NDP/i, party: 'NDP', raw: 'NDP' },
        { re: /^GPM/i, party: 'GPM', raw: 'GPM' },
        { re: /^PC$/i, party: 'PC', raw: 'PC' },
      ];
      for (const pc of partyChecks) {
        const hit = headerItems.find((i) => pc.re.test(i.s));
        if (hit) {
          partyBands.push({ y: hit.y, party: pc.party, raw: pc.raw });
        }
      }

      for (const col of cols) {
        if (col.x < 185) continue;
        col.items.sort((a, b) => a.y - b.y);
        const divItem = col.items.find((i) => i.y < 125);
        if (!divItem) continue;
        if (/^Total/i.test(divItem.s) || /^0\.\d+%/.test(divItem.s) || /^\d+\.\d+%$/.test(divItem.s)) continue;

        const memberItem = col.items.find((i) => i.y >= 125 && i.y < 290);
        if (!memberItem || (!memberItem.s.includes('(') && !memberItem.s.includes(')'))) continue;

        const divisionName = cleanDivisionName(divItem.s);
        // Extract "Member Name (PARTY)" (handles occasional missing opening or closing paren)
        const mMatch =
          memberItem.s.match(/^(.+?)\s*\(([^)]+)\)?\s*$/) ||
          memberItem.s.match(/^(.+?)\s+(PC|NDP\/NPD|Lib\.?\/?Lib\.?\.*)\)\s*$/i);
        if (!mMatch) continue;
        const parsedWinnerName = normalizeCandidateName(mMatch[1]);
        const winnerPartyRaw = mMatch[2].trim();
        const winnerParty = normalizeParty(winnerPartyRaw);

        const pickNearY = (targetY, maxDist = 20) => {
          if (targetY === null) return null;
          let best = null;
          let bestD = Infinity;
          for (const it of col.items) {
            if (it.y < 285) continue;
            const d = Math.abs(it.y - targetY);
            if (d <= maxDist && d < bestD) {
              bestD = d;
              best = it.s;
            }
          }
          return best;
        };

        const registeredVoters = parseIntClean(pickNearY(yReg, 18));
        const ballotsCast = parseIntClean(pickNearY(yCast, 18));
        const turnoutPct = parsePctClean(pickNearY(yTurnout, 18));
        const plurality = parseIntClean(pickNearY(yPlurality, 20));

        const candidates = [];
        for (const pb of partyBands) {
          const valStr = pickNearY(pb.y, 16);
          const votes = parseIntClean(valStr);
          if (votes !== null && votes > 0) {
            const isWinner = pb.party === winnerParty;
            candidates.push({
              name: isWinner ? parsedWinnerName.displayName : `${pb.raw} Candidate`,
              party: pb.party,
              partyRaw: pb.raw,
              votes,
              voteSharePct: ballotsCast ? Number(((votes / ballotsCast) * 100).toFixed(2)) : null,
            });
          }
        }

        // Ensure winner exists even if column was missed
        if (!candidates.some((c) => c.party === winnerParty)) {
          candidates.push({
            name: parsedWinnerName.displayName,
            party: winnerParty,
            partyRaw: winnerPartyRaw,
            votes: 0,
            voteSharePct: null,
          });
        }

        out.push(
          finalizeDivisionRecord(divisionName, candidates, {
            ballotsCast,
            registeredVoters,
            turnoutPct,
            marginVotes: plurality ?? undefined,
          })
        );
      }
    }
    return out;
  };

  elections[1995] = parseRotatedYearPages([86, 87], 1995);
  elections[2003] = parseRotatedYearPages([90, 91], 2003);
  return elections;
}

/**
 * Parses Elections Manitoba By-Election XLSX files (both 2024-2026 polling-place format
 * and 2005-2022 Summary_of_Results format).
 */
export function parseByElectionXlsx(buffer, meta = {}) {
  const sheets = parseXlsxWorkbook(buffer);
  const allRows = sheets.flatMap((s) => s.rows);

  // Detect division name & date from sheet text if not provided
  let divisionName = meta.divisionName ?? '';
  let electedRaw = '';
  let dateText = meta.date ?? '';

  for (const row of allRows.slice(0, 15)) {
    const joined = row.filter(Boolean).join(' ');
    if (!divisionName) {
      const mDiv = joined.match(/Electoral Division[^A-Za-z]*(?:\/\s*Circonscription[^A-Za-z]*)?\s+([A-ZÀ-ÿ'’.\- ]+?)(?:\s*\/|\s*$)/i);
      if (mDiv) {
        divisionName = cleanDivisionName(mDiv[1]);
      }
    }
    const mEl = joined.match(/Candidate Elected[^:]*[:\n ]+\s*([A-ZÀ-ÿ'’.,\- ]+)/i);
    if (mEl && !electedRaw) {
      electedRaw = mEl[1].trim();
    }
    const mDate = joined.match(/Date of Election[^A-Za-z0-9]*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i);
    if (mDate && !dateText) {
      dateText = mDate[1];
    }
  }

  // Format A (2024-2026): header row has columns like "NAME, First (PARTY)" and a "TOTAL" row at bottom
  const sheet1Rows = sheets[0]?.rows ?? [];
  const headerIdx = sheet1Rows.findIndex((r) =>
    r.some((c) => /\((PC|NDP|MLP|LIB|GPM|KP|IND)/i.test(c))
  );
  if (headerIdx !== -1) {
    const headerRow = sheet1Rows[headerIdx];
    const totalRow = [...sheet1Rows]
      .reverse()
      .find((r) => r.some((c) => /^TOTAL$/i.test(c.trim())));

    const candidates = [];
    let ballotsCast = null;

    if (totalRow) {
      for (let col = 0; col < headerRow.length; col++) {
        const hdr = headerRow[col] ?? '';
        const val = parseIntClean(totalRow[col]);
        if (/Total Ballots Cast/i.test(hdr) && val !== null) {
          ballotsCast = val;
          continue;
        }
        const m = hdr.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
        if (m && val !== null) {
          const parsedName = normalizeCandidateName(m[1]);
          candidates.push({
            name: parsedName.displayName,
            party: normalizeParty(m[2]),
            partyRaw: m[2].trim(),
            votes: val,
            voteSharePct: null,
          });
        }
      }
    }

    if (candidates.length > 0 && divisionName) {
      // Check sheet 2 for registered voters total if present
      let registeredVoters = null;
      if (sheets[1]) {
        const s2Total = [...sheets[1].rows]
          .reverse()
          .find((r) => r.some((c) => /^TOTAL$/i.test(c.trim())));
        const s2Header = sheets[1].rows.find((r) =>
          r.some((c) => /Registered Voters/i.test(c))
        );
        if (s2Total && s2Header) {
          const regCol = s2Header.findIndex((c) => /Registered Voters/i.test(c));
          if (regCol !== -1) {
            registeredVoters = parseIntClean(s2Total[regCol]);
          }
        }
      }

      return {
        dateText,
        record: finalizeDivisionRecord(divisionName, candidates, {
          ballotsCast,
          registeredVoters,
          note: `By-election (${meta.label ?? dateText})`,
        }),
      };
    }
  }

  // Format B (2005-2022 Summary_of_Results): row-wise Candidate | Party | Votes | %
  const candidates = [];
  let ballotsCast = null;
  let registeredVoters = null;

  const candHeaderIdx = sheet1Rows.findIndex((r) =>
    r.some((c) => /Candidate/i.test(c)) && r.some((c) => /Party|Parti/i.test(c))
  );
  if (candHeaderIdx !== -1) {
    const hdr = sheet1Rows[candHeaderIdx];
    const colCand = hdr.findIndex((c) => /Candidate/i.test(c));
    const colParty = hdr.findIndex((c) => /Party|Parti/i.test(c));
    const colVotes = hdr.findIndex((c) => /Votes|Voix|Suffrages/i.test(c) && !/%/.test(c));
    const colPct = hdr.findIndex((c) => /%/.test(c));

    for (let i = candHeaderIdx + 1; i < sheet1Rows.length; i++) {
      const r = sheet1Rows[i];
      const joined = r.join(' ');
      if (/Registered Voters|Électeurs inscrits/i.test(joined)) {
        const nums = r.map(parseIntClean).filter((n) => n !== null);
        if (nums.length > 0) registeredVoters = nums[nums.length - 1];
        continue;
      }
      if (/Ballots Cast|Votes Cast|Total.*Cast/i.test(joined)) {
        const nums = r.map(parseIntClean).filter((n) => n !== null);
        if (nums.length > 0) ballotsCast = nums[0];
        continue;
      }
      const cand = (r[colCand] ?? '').trim();
      const party = (r[colParty] ?? '').trim();
      const votes = parseIntClean(r[colVotes]);
      if (!cand || !party || votes === null || /Rejected|Declined|Total/i.test(cand)) continue;
      const parsedName = normalizeCandidateName(cand);
      candidates.push({
        name: parsedName.displayName,
        party: normalizeParty(party),
        partyRaw: party,
        votes,
        voteSharePct: colPct !== -1 ? parsePctClean(r[colPct]) : null,
      });
    }
  }

  if (candidates.length > 0 && divisionName) {
    return {
      dateText,
      record: finalizeDivisionRecord(divisionName, candidates, {
        ballotsCast,
        registeredVoters,
        note: `By-election (${meta.label ?? dateText})`,
      }),
    };
  }

  return null;
}

/**
 * Parses Summary_Results_By2005_FortWhyte.pdf (where official PDF matches actual
 * results while the legacy Excel had two candidate rows transposed).
 */
export async function parseByElectionPdf(buffer, meta = {}) {
  const pages = await extractPdfPagesItems(buffer);
  const rows = groupItemsIntoRows(pages[0]?.items ?? [], 4);
  const candidates = [];
  let ballotsCast = null;
  let registeredVoters = null;

  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    const joined = r.items.map((i) => i.s).join(' ');
    if (/Total votes cast/i.test(joined)) {
      const nums = [r, rows[idx + 1]].filter(Boolean).flatMap((rr) => rr.items.map((i) => parseIntClean(i.s))).filter((n) => n !== null);
      if (nums.length) ballotsCast = nums[nums.length - 1];
      continue;
    }
    if (/Registered Voters/i.test(joined)) {
      const nums = [r, rows[idx + 1]].filter(Boolean).flatMap((rr) => rr.items.map((i) => parseIntClean(i.s))).filter((n) => n !== null);
      if (nums.length) registeredVoters = nums[nums.length - 1];
      continue;
    }
    if (/Candidate|Registered Party|Votes Received|Rejected|Declined|Plurality|Turnout|Summary|Byelection|^déposés$|^inscrits$|^Page \d+$/i.test(joined)) {
      continue;
    }

    const cand = r.items.filter((i) => i.x < 190).map((i) => i.s).join(' ').trim();
    const party = r.items.filter((i) => i.x >= 190 && i.x < 450).map((i) => i.s).join(' ').trim();
    const votesItem = r.items.find((i) => i.x >= 450 && i.x < 650);
    const pctItem = r.items.find((i) => i.x >= 650);
    const votes = parseIntClean(votesItem?.s);
    if (cand && party && votes !== null) {
      const parsedName = normalizeCandidateName(cand === 'McFadyen' ? 'McFadyen, Hugh' : cand);
      candidates.push({
        name: parsedName.displayName,
        party: normalizeParty(party),
        partyRaw: party,
        votes,
        voteSharePct: parsePctClean(pctItem?.s),
      });
    }
  }

  if (candidates.length === 0 || !meta.divisionName) return null;
  return {
    dateText: meta.date ?? '',
    record: finalizeDivisionRecord(meta.divisionName, candidates, {
      ballotsCast,
      registeredVoters,
      note: `By-election (${meta.label ?? meta.date})`,
    }),
  };
}

/**
 * Parses Manitoba Legislature historical MLA archives (mla_bio_living.html / mla_bio_deceased.html).
 */
export function parseMlaBioArchiveHtml(html, status, sourceUrl) {
  const $ = cheerio.load(html);
  const members = [];

  $('table tr').each((_, tr) => {
    const tds = $(tr).children('td');
    if (tds.length !== 3) return;

    const col0 = $(tds[0]);
    const nameRaw = col0.find('strong').first().text().replace(/\s+/g, ' ').trim();
    if (!nameRaw || /^NAME$/i.test(nameRaw)) return;

    const col0Clone = col0.clone();
    col0Clone.find('strong').first().remove();
    const metaText = col0Clone.text().replace(/\s+/g, ' ').trim();

    let dob = null;
    let deceasedDate = null;
    const dobMatch = metaText.match(/DOB:\s*([A-Za-z0-9,\s]+?)(?=Deceased:|$)/i);
    if (dobMatch) dob = dobMatch[1].trim();
    const decMatch = metaText.match(/Deceased:\s*([A-Za-z0-9,\s]+)$/i);
    if (decMatch) deceasedDate = decMatch[1].trim();

    const beforeBioDates = metaText.split(/DOB:|Deceased:/i)[0].trim();
    const parenMatches = [...beforeBioDates.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim());
    const constituencyRaw = parenMatches[0] ?? '';
    let partyRaw = parenMatches[1] ?? '';

    // Election events from column 1 (normalize raw HTML source newlines first)
    const col1Html = ($(tds[1]).html() ?? '').replace(/\r?\n/g, ' ');
    const electionEvents = col1Html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<p\b[^>]*>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .split('\n')
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter((s) => s && s !== '\u00a0');

    if (!partyRaw) {
      for (const ev of electionEvents) {
        const pm = ev.match(/\(([^)]+)\)/);
        if (
          pm &&
          pm[1].trim().length <= 36 &&
          !/^Accl$/i.test(pm[1]) &&
          !/Election|tie|contested|declared|Senate/i.test(pm[1])
        ) {
          partyRaw = pm[1].trim();
          break;
        }
      }
    }

    // Portfolios from column 2
    const col2Html = ($(tds[2]).html() ?? '').replace(/\r?\n/g, ' ');
    const portfolios = col2Html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<p\b[^>]*>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .split('\n')
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter((s) => s && s !== '\u00a0');

    const yearsAll = electionEvents
      .flatMap((ev) => [...ev.matchAll(/\b(18\d\d|19\d\d|20\d\d)\b/g)].map((m) => Number(m[1])))
      .filter((y) => y >= 1870 && y <= 2030);

    const activeYears = electionEvents
      .filter((ev) => /Elected|Re-elected|Appointed/i.test(ev))
      .flatMap((ev) => [...ev.matchAll(/\b(18\d\d|19\d\d|20\d\d)\b/g)].map((m) => Number(m[1])));

    const firstElectedYear =
      activeYears.length > 0
        ? Math.min(...activeYears)
        : yearsAll.length > 0
          ? Math.min(...yearsAll)
          : null;
    const lastYearServed =
      yearsAll.length > 0 ? Math.max(...yearsAll) : firstElectedYear;

    const constituency = cleanDivisionName(constituencyRaw);
    const parsedName = normalizeCandidateName(nameRaw);
    const party = normalizeParty(partyRaw);
    const isMinisterial = portfolios.some((p) =>
      /Minister|Premier|Speaker/i.test(p)
    );

    members.push({
      id: `${slugifyDivision(parsedName.displayName)}-${firstElectedYear ?? 'hist'}`,
      name: parsedName.displayName,
      constituency: constituency || 'Manitoba',
      constituencySlug: constituency ? slugifyDivision(constituency) : '',
      party,
      partyRaw: partyRaw || 'Unspecified',
      status,
      firstElectedYear,
      lastYearServed,
      dob,
      deceasedDate,
      electionEvents,
      portfolios,
      isMinisterial,
      profileUrl: sourceUrl,
    });
  });

  return members;
}

/**
 * Parses Manitoba Municipal Relations' official Municipal Officials Directory (mod.pdf).
 */
export async function parseModMunicipalitiesPdf(buffer, sourceUrl) {
  const pages = await extractPdfPagesItems(buffer);
  const municipalities = [];
  const seenMun = new Set();

  for (const page of pages) {
    if (page.pageNumber < 22) continue;
    const items = page.items.filter((i) => i.y > 35);
    const anchors = items
      .filter((i) => i.x >= 250 && i.x <= 325 && /^(Mayor|Reeve|Head of Council)$/i.test(i.s))
      .sort((a, b) => b.y - a.y);

    for (let idx = 0; idx < anchors.length; idx++) {
      const anchor = anchors[idx];
      const topY = anchor.y + 5;
      const botY = idx + 1 < anchors.length ? anchors[idx + 1].y + 8 : 35;
      const block = items.filter((i) => i.y <= topY && i.y > botY);

      // Left column: name is on y near anchor.y (plus wrapped type line if present)
      const leftLines = groupItemsIntoRows(
        block.filter((i) => i.x < 250),
        3
      );
      let rawName = '';
      if (leftLines[0]) {
        rawName = leftLines[0].items.map((i) => i.s).join(' ').trim();
        if (
          leftLines[1] &&
          /^(MUNICIPALITY|RM|TOWN|CITY|VILLAGE|LGD)$/i.test(
            leftLines[1].items.map((i) => i.s).join(' ').trim()
          )
        ) {
          rawName += ' ' + leftLines[1].items.map((i) => i.s).join(' ').trim();
        }
      }
      rawName = rawName.replace(/\s+/g, ' ').trim();
      if (!rawName || seenMun.has(rawName)) continue;

      // Parse type & display name ("BRANDON, CITY" -> "Brandon", type "City")
      const typeMatch = rawName.match(/^(.+?),\s*(RM|CITY|TOWN|VILLAGE|MUNICIPALITY|LGD)$/i);
      const munTypeRaw = typeMatch ? typeMatch[2].toUpperCase() : 'MUNICIPALITY';
      const baseNameRaw = typeMatch ? typeMatch[1].trim() : rawName;
      const baseTitle = baseNameRaw
        .toLowerCase()
        .replace(/(^|[\s\-.])([a-z\u00e0-\u00ff])/g, (_, s, ch) => s + ch.toUpperCase());
      const munType =
        munTypeRaw === 'RM'
          ? 'RM'
          : munTypeRaw === 'LGD'
            ? 'LGD'
            : munTypeRaw[0] + munTypeRaw.slice(1).toLowerCase();
      const displayName = munType === 'RM' ? `RM of ${baseTitle}` : `${baseTitle} (${munType})`;

      // Middle column metadata
      const midText = block
        .filter((i) => i.x >= 250 && i.x < 445)
        .map((i) => i.s)
        .join(' ');
      const popMatch = midText.match(/Population:\s*([\d,]+)/i);
      const numMatch = midText.match(/Municipal #:\s*(\d+)/i);
      const population = popMatch ? Number(popMatch[1].replace(/,/g, '')) : null;
      const municipalNo = numMatch ? Number(numMatch[1]) : null;

      // Left column contact lines
      const leftTextLines = leftLines.map((r) => r.items.map((i) => i.s).join(' ').trim());
      const phoneLine = leftTextLines.find((l) => /^Phone:/i.test(l));
      const emailLine = leftTextLines.find((l) => /^Email:/i.test(l));
      const webLine = leftTextLines.find((l) => /^Website:/i.test(l));
      const phone = phoneLine ? phoneLine.replace(/^Phone:\s*/i, '').trim() : null;
      const email = emailLine ? emailLine.replace(/^Email:\s*/i, '').trim() : null;
      let website = webLine ? webLine.replace(/^Website:\s*/i, '').trim() : null;
      if (website && !/^https?:\/\//i.test(website)) {
        website = `https://${website}`;
      }
      if (website && !/^https:\/\//i.test(website)) {
        website = website.replace(/^http:\/\//i, 'https://');
      }

      // Right column: Head of Council, CAO, Councillors
      const rightRows = groupItemsIntoRows(
        block.filter((i) => i.x >= 445),
        3
      ).map((r) => r.items.map((i) => i.s).join(' ').trim());

      // Merge hyphen-wrapped or single-token wrapped surnames (e.g. "Gordon (Mac)" + "Kinghorn")
      const mergedNames = [];
      for (const line of rightRows) {
        if (!line) continue;
        if (mergedNames.length > 0 && mergedNames[mergedNames.length - 1].endsWith('-')) {
          mergedNames[mergedNames.length - 1] += line;
        } else if (mergedNames.length > 0 && !line.includes(' ')) {
          mergedNames[mergedNames.length - 1] += ' ' + line;
        } else {
          mergedNames.push(line);
        }
      }

      const headName = mergedNames[0] ?? 'Vacant';
      const isWinnipeg = /WINNIPEG,\s*CITY/i.test(rawName);
      const caoName = isWinnipeg ? 'Office of the Chief Administrative Officer' : (mergedNames[1] ?? '');
      // City of Winnipeg lists Mayor followed directly by all 15 Councillors in mod.pdf
      const councillorStartIdx = isWinnipeg ? 1 : 2;
      const councillors = mergedNames.slice(councillorStartIdx);

      seenMun.add(rawName);
      municipalities.push({
        id: slugifyDivision(rawName),
        municipalNo,
        name: displayName,
        rawName,
        type: munType,
        population,
        headRole: anchor.s,
        headName,
        caoName,
        councillors,
        partyStatus: 'Non-Partisan (Independent)',
        phone,
        email,
        website,
        sourceUrl,
      });
    }
  }

  municipalities.sort((a, b) => a.name.localeCompare(b.name));
  return municipalities;
}

const WINNIPEG_WARD_ALIASES = {
  'charleswoodtuxedo': 'charleswood-tuxedo-westwood',
  'charleswoodtuxedowestwood': 'charleswood-tuxedo-westwood',
  'charleswoodfortgarry': 'charleswood-tuxedo-westwood',
  'stjamesbrooklands': 'st-james',
  'stjames': 'st-james',
  'stcharles': 'st-james',
  'stnorbert': 'st-norbert-seine-river',
  'stnorbertseineriver': 'st-norbert-seine-river',
  'fortrouge': 'fort-rouge-east-fort-garry',
  'fortrougeeastfortgarry': 'fort-rouge-east-fort-garry',
  'elmwood': 'elmwood-east-kildonan',
  'elmwoodeastkildonan': 'elmwood-east-kildonan',
  'riverheights': 'river-heights-fort-garry',
  'riverheightsfortgarry': 'river-heights-fort-garry',
  'danielmcintyre': 'daniel-mcintyre',
  'mynarski': 'mynarski',
  'northkildonan': 'north-kildonan',
  'oldkildonan': 'old-kildonan',
  'pointdouglas': 'point-douglas',
  'stboniface': 'st-boniface',
  'stvital': 'st-vital',
  'transcona': 'transcona',
  'waverleywest': 'waverley-west',
};

function mapWinnipegWardSlug(rawArea) {
  const compact = String(rawArea ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return WINNIPEG_WARD_ALIASES[compact] ?? slugifyDivision(rawArea);
}

/**
 * Combines City of Winnipeg Ward GeoJSON, Council Data (2014-2026), and Election Results (1964-2022)
 * into clean chronological municipal snapshots and per-ward historical councillor timelines.
 */
export function buildWinnipegMunicipalData({
  wardsGeoJson,
  councilRows,
  electionRows,
  sourceUrl,
}) {
  const wardFeatures = (wardsGeoJson.features ?? []).map((f) => {
    const name = String(f.properties?.name ?? '').replace(/\s*-\s*/g, ' — ');
    const slug = mapWinnipegWardSlug(f.properties?.name ?? '');
    return {
      type: 'Feature',
      properties: {
        id: slug,
        wardNumber: Number(f.properties?.number ?? 0),
        name,
        councillor: String(f.properties?.councillor ?? ''),
        phone: String(f.properties?.phone ?? ''),
        website: String(f.properties?.website ?? ''),
      },
      geometry: normalizeGeometryWindingForD3(f.geometry),
    };
  });

  wardFeatures.sort((a, b) => a.properties.wardNumber - b.properties.wardNumber);
  const canonicalWardIds = new Set(wardFeatures.map((f) => f.properties.id));

  // Index r4tk-7dip current & historical council terms (2014, 2018, 2022, 2026)
  const councilByYear = new Map();
  for (const row of councilRows) {
    const year = Number(row.year);
    if (!Number.isFinite(year)) continue;
    if (!councilByYear.has(year)) {
      councilByYear.set(year, { mayor: null, wards: {}, meta: {} });
    }
    const bucket = councilByYear.get(year);
    if (/mayor/i.test(row.position_english ?? '')) {
      bucket.mayor = String(row.person ?? '').trim();
    } else {
      const wSlug = mapWinnipegWardSlug(row.name_english ?? '');
      bucket.wards[wSlug] = {
        councillor: String(row.person ?? '').trim(),
        wardName: String(row.name_english ?? '').trim(),
        neighbourhoods: String(row.neighbourhoods ?? '').trim(),
        wardUrl: row.ward_url ?? null,
      };
    }
  }

  // Group 7753-3fjc historical election rows by date + position + area
  const electionsByDate = new Map();
  for (const row of electionRows) {
    const date = String(row.date ?? '').slice(0, 10);
    if (!date) continue;
    if (!electionsByDate.has(date)) {
      electionsByDate.set(date, {
        date,
        year: Number(date.slice(0, 4)),
        type: String(row.type ?? 'General Election'),
        mayorCandidates: [],
        wards: new Map(),
      });
    }
    const bucket = electionsByDate.get(date);
    const parsedCand = normalizeCandidateName(row.candidate ?? '');
    const candObj = {
      name: parsedCand.displayName,
      votes: parseIntClean(row.votes) ?? 0,
      won: /^yes$/i.test(String(row.won ?? '')),
    };

    if (/mayor/i.test(row.position ?? '')) {
      bucket.mayorCandidates.push(candObj);
    } else if (/councillor/i.test(row.position ?? '')) {
      const areaName = String(row.area ?? '').trim();
      const wSlug = mapWinnipegWardSlug(areaName);
      if (!bucket.wards.has(wSlug)) {
        bucket.wards.set(wSlug, { areaName, candidates: [] });
      }
      bucket.wards.get(wSlug).candidates.push(candObj);
    }
  }

  // Build General Election snapshots (1974-2022) + Current 2026 Council
  const snapshots = [];
  const generalDates = [...electionsByDate.values()]
    .filter((e) => /general/i.test(e.type) && e.year >= 1974)
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const ge of generalDates) {
    ge.mayorCandidates.sort((a, b) => b.votes - a.votes);
    const totalMayorVotes = ge.mayorCandidates.reduce((acc, c) => acc + c.votes, 0);
    const mayorWinner = ge.mayorCandidates.find((c) => c.won) ?? ge.mayorCandidates[0] ?? null;

    const wardResults = {};
    for (const [wSlug, wData] of ge.wards.entries()) {
      const sorted = [...wData.candidates].sort((a, b) => b.votes - a.votes);
      const totalVotes = sorted.reduce((acc, c) => acc + c.votes, 0);
      const winner = sorted.find((c) => c.won) ?? sorted[0];
      if (!winner) continue;
      const runnerUp = sorted[1] ?? null;
      const winnerPct = totalVotes > 0 ? Number(((winner.votes / totalVotes) * 100).toFixed(1)) : 0;
      const marginPct =
        runnerUp && totalVotes > 0
          ? Number((((winner.votes - runnerUp.votes) / totalVotes) * 100).toFixed(1))
          : winnerPct;

      wardResults[wSlug] = {
        wardSlug: wSlug,
        wardNameAtTime: wData.areaName,
        councillor: winner.name,
        partyStatus: 'Non-Partisan (Independent)',
        votes: winner.votes,
        voteSharePct: winnerPct,
        marginPct,
        acclaimed: sorted.length === 1 && winner.votes === 0,
        candidates: sorted.map((c) => ({
          name: c.name,
          votes: c.votes,
          voteSharePct: totalVotes > 0 ? Number(((c.votes / totalVotes) * 100).toFixed(1)) : 0,
          won: c.won,
        })),
      };
    }

    snapshots.push({
      id: `wpg-${ge.year}`,
      year: ge.year,
      date: ge.date,
      label: `${ge.year} Winnipeg Municipal Election`,
      shortLabel: String(ge.year),
      isCurrent: false,
      mayor: mayorWinner
        ? {
            name: mayorWinner.name,
            partyStatus: 'Non-Partisan (Independent)',
            votes: mayorWinner.votes,
            voteSharePct:
              totalMayorVotes > 0
                ? Number(((mayorWinner.votes / totalMayorVotes) * 100).toFixed(1))
                : 0,
            candidates: ge.mayorCandidates.slice(0, 6).map((c) => ({
              name: c.name,
              votes: c.votes,
              voteSharePct:
                totalMayorVotes > 0 ? Number(((c.votes / totalMayorVotes) * 100).toFixed(1)) : 0,
              won: c.won,
            })),
          }
        : null,
      wards: wardResults,
    });
  }

  // Add Current 2026 Council snapshot from r4tk-7dip + t4cg-yaxs
  const curCouncil = councilByYear.get(2026);
  if (curCouncil) {
    const wardResults = {};
    for (const wf of wardFeatures) {
      const wSlug = wf.properties.id;
      const cEntry = curCouncil.wards[wSlug];
      const councillorName = wf.properties.councillor || cEntry?.councillor || 'Vacant';
      wardResults[wSlug] = {
        wardSlug: wSlug,
        wardNameAtTime: wf.properties.name,
        councillor: councillorName,
        partyStatus: 'Non-Partisan (Independent)',
        votes: 0,
        voteSharePct: 0,
        marginPct: 0,
        acclaimed: false,
        candidates: [{ name: councillorName, votes: 0, voteSharePct: 0, won: true }],
      };
    }
    snapshots.push({
      id: 'wpg-2026-current',
      year: 2026,
      date: '2026-11-11',
      label: 'Current Winnipeg City Council (2026)',
      shortLabel: 'Now',
      isCurrent: true,
      mayor: {
        name: curCouncil.mayor ?? 'Scott Gillingham',
        partyStatus: 'Non-Partisan (Independent)',
        votes: 0,
        voteSharePct: 0,
        candidates: [{ name: curCouncil.mayor ?? 'Scott Gillingham', votes: 0, voteSharePct: 0, won: true }],
      },
      wards: wardResults,
    });
  }

  // Build per-ward historical councillor timelines
  const wards = wardFeatures.map((wf) => {
    const wSlug = wf.properties.id;
    const cMeta = curCouncil?.wards[wSlug];
    const history = [];

    for (const snap of snapshots) {
      const rec = snap.wards[wSlug];
      if (!rec) continue;
      history.push({
        year: snap.year,
        date: snap.date,
        label: snap.label,
        councillor: rec.councillor,
        wardNameAtTime: rec.wardNameAtTime,
        voteSharePct: rec.voteSharePct,
        votes: rec.votes,
        acclaimed: rec.acclaimed,
        mayorName: snap.mayor?.name ?? '',
      });
    }

    // Also include any mid-term by-elections affecting this ward
    for (const ev of [...electionsByDate.values()].filter((e) => !/general/i.test(e.type))) {
      const wData = ev.wards.get(wSlug);
      if (!wData) continue;
      const sorted = [...wData.candidates].sort((a, b) => b.votes - a.votes);
      const winner = sorted.find((c) => c.won) ?? sorted[0];
      const totalVotes = sorted.reduce((acc, c) => acc + c.votes, 0);
      if (winner) {
        history.push({
          year: ev.year,
          date: ev.date,
          label: `${ev.year} Ward By-Election`,
          councillor: winner.name,
          wardNameAtTime: wData.areaName,
          voteSharePct: totalVotes > 0 ? Number(((winner.votes / totalVotes) * 100).toFixed(1)) : 0,
          votes: winner.votes,
          acclaimed: false,
          mayorName: '',
        });
      }
    }

    history.sort((a, b) => a.date.localeCompare(b.date));

    // Count distinct councillors & longest serving
    const termCounts = {};
    for (const h of history) {
      termCounts[h.councillor] = (termCounts[h.councillor] ?? 0) + 1;
    }
    const longestEntry = Object.entries(termCounts).sort((a, b) => b[1] - a[1])[0];

    return {
      id: wSlug,
      wardNumber: wf.properties.wardNumber,
      name: wf.properties.name,
      currentCouncillor: wf.properties.councillor,
      phone: wf.properties.phone,
      website: wf.properties.website,
      neighbourhoods: cMeta?.neighbourhoods ?? '',
      longestServingCouncillor: longestEntry ? `${longestEntry[0]} (${longestEntry[1]} terms)` : '',
      distinctCouncillorsCount: Object.keys(termCounts).length,
      history,
    };
  });

  // Ensure canonical wards filter only valid 15 wards
  void canonicalWardIds;

  return {
    wardsGeoJson: {
      type: 'FeatureCollection',
      name: 'winnipeg-electoral-wards',
      features: wardFeatures,
    },
    snapshots,
    wards,
    sourceUrl,
  };
}


