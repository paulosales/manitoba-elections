import * as cheerio from 'cheerio';
import { safeUnzipXlsx } from './security.mjs';

/**
 * Converts an Excel column reference (e.g., "A", "AA") to a 0-based index.
 */
function colLettersToIndex(letters) {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

/**
 * Extracts sheets from an .xlsx buffer as arrays of row string arrays.
 * Uses strict XXE-free XML parsing via cheerio and zip-bomb checks via fflate.
 */
export function parseXlsxWorkbook(buffer) {
  const entries = safeUnzipXlsx(buffer);

  let sharedStrings = [];
  if (entries['xl/sharedStrings.xml']) {
    const ssXml = Buffer.from(entries['xl/sharedStrings.xml']).toString('utf8');
    const $ss = cheerio.load(ssXml, { xml: true });
    sharedStrings = $ss('si')
      .map((_, si) => {
        // Concatenate text nodes excluding phonetic runs (<rPh>)
        const clone = $ss(si).clone();
        clone.find('rPh').remove();
        return clone.text();
      })
      .get();
  }

  const sheetFiles = Object.keys(entries)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/sheet(\d+)\.xml/)?.[1] ?? 0);
      const nb = Number(b.match(/sheet(\d+)\.xml/)?.[1] ?? 0);
      return na - nb;
    });

  const sheets = [];
  for (const sheetName of sheetFiles) {
    const xml = Buffer.from(entries[sheetName]).toString('utf8');
    const $ = cheerio.load(xml, { xml: true });
    const rows = [];

    $('sheetData > row').each((_, rowEl) => {
      const rowValues = [];
      $(rowEl)
        .children('c')
        .each((__, cellEl) => {
          const ref = $(cellEl).attr('r') ?? '';
          const colMatch = ref.match(/^([A-Z]+)\d+$/);
          const colIndex = colMatch ? colLettersToIndex(colMatch[1]) : rowValues.length;
          while (rowValues.length < colIndex) {
            rowValues.push('');
          }

          const cellType = $(cellEl).attr('t') ?? '';
          let val = '';
          if (cellType === 's') {
            const idxStr = $(cellEl).children('v').first().text();
            const idx = Number(idxStr);
            val = Number.isInteger(idx) && idx >= 0 && idx < sharedStrings.length ? sharedStrings[idx] : '';
          } else if (cellType === 'inlineStr') {
            val = $(cellEl).children('is').text();
          } else if (cellType === 'str') {
            val = $(cellEl).children('v').first().text();
          } else {
            val = $(cellEl).children('v').first().text();
          }
          rowValues[colIndex] = val.trim();
        });
      rows.push(rowValues);
    });

    sheets.push({ name: sheetName, rows });
  }

  return sheets;
}

