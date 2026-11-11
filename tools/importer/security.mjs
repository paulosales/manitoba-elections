import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { unzipSync } from 'fflate';

export const ALLOWED_GOVERNMENT_HOSTS = new Set([
  'www.electionsmanitoba.ca',
  'electionsmanitoba.ca',
  'www.gov.mb.ca',
  'gov.mb.ca',
  'represent.opennorth.ca',
  'data.winnipeg.ca',
  'services.arcgis.com',
]);

export const USER_AGENT =
  'ManitobaElectionsPWA-DataImporter/1.0 (+https://www.electionsmanitoba.ca/)';

const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;
const MAX_UNZIP_BYTES = 20 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 200;

/**
 * Validates that a remote URL uses HTTPS and belongs to an allow-listed host.
 * Rejects embedded credentials or non-standard protocols to prevent SSRF.
 */
export function assertAllowedHttpsUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`Refusing non-HTTPS URL: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('Refusing URL with embedded credentials');
  }
  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_GOVERNMENT_HOSTS.has(host)) {
    throw new Error(`Hostname not in government/open-data allow-list: ${parsed.hostname}`);
  }
  if (host === 'services.arcgis.com' && !parsed.pathname.startsWith('/mMUesHYPkXjaFGfS/')) {
    throw new Error('Only official Province of Manitoba ArcGIS org (mMUesHYPkXjaFGfS) is allowed');
  }
  return parsed;
}

/**
 * Safely fetches a binary buffer from an allow-listed HTTPS endpoint with
 * redirect validation, timeout, and strict maximum byte limits.
 */
export async function safeFetchBuffer(rawUrl, options = {}) {
  const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES;
  const timeoutMs = options.timeoutMs ?? 25000;
  let currentUrl = assertAllowedHttpsUrl(rawUrl).toString();

  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(currentUrl, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        throw new Error(`Redirect (${res.status}) without Location header from ${currentUrl}`);
      }
      const nextUrl = new URL(location, currentUrl).toString();
      currentUrl = assertAllowedHttpsUrl(nextUrl).toString();
      continue;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${currentUrl}`);
    }

    const contentLenHeader = res.headers.get('content-length');
    if (contentLenHeader) {
      const expected = Number(contentLenHeader);
      if (Number.isFinite(expected) && expected > maxBytes) {
        throw new Error(`Response too large (${expected} bytes > ${maxBytes}) from ${currentUrl}`);
      }
    }

    const reader = res.body?.getReader();
    if (!reader) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) {
        throw new Error(`Response exceeded ${maxBytes} bytes from ${currentUrl}`);
      }
      return { buffer: buf, finalUrl: currentUrl };
    }

    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Streamed response exceeded ${maxBytes} bytes from ${currentUrl}`);
      }
      chunks.push(value);
    }

    return { buffer: Buffer.concat(chunks), finalUrl: currentUrl };
  }

  throw new Error(`Too many redirects fetching ${rawUrl}`);
}

export async function safeFetchText(rawUrl, options = {}) {
  const { buffer, finalUrl } = await safeFetchBuffer(rawUrl, options);
  return { text: buffer.toString('utf8'), finalUrl };
}

/**
 * Validates and decompresses a ZIP (.xlsx) buffer safely, rejecting zip bombs,
 * traversal paths, and XML files containing DOCTYPE or ENTITY declarations.
 */
export function safeUnzipXlsx(buffer) {
  if (buffer.length > MAX_RESPONSE_BYTES) {
    throw new Error('XLSX buffer exceeds maximum size');
  }
  // Verify PK zip magic header
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error('Invalid XLSX/ZIP magic bytes');
  }

  let totalDecompressed = 0;
  let entryCount = 0;

  const entries = unzipSync(new Uint8Array(buffer), {
    filter(file) {
      entryCount++;
      if (entryCount > MAX_ZIP_ENTRIES) {
        throw new Error('XLSX archive contains too many entries');
      }
      if (
        file.name.includes('..') ||
        file.name.startsWith('/') ||
        file.name.includes('\\')
      ) {
        throw new Error(`Unsafe ZIP entry path rejected: ${file.name}`);
      }
      totalDecompressed += file.originalSize;
      if (totalDecompressed > MAX_UNZIP_BYTES) {
        throw new Error('XLSX decompressed size exceeds safety limit');
      }
      return file.name.endsWith('.xml') || file.name.endsWith('.rels');
    },
  });

  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('.xml')) {
      const xmlSnippet = Buffer.from(data.subarray(0, 4096)).toString('utf8');
      if (/<!DOCTYPE|<!ENTITY/i.test(xmlSnippet)) {
        throw new Error(`Unsafe XML declaration (DOCTYPE/ENTITY) in ${name}`);
      }
    }
  }

  return entries;
}

/**
 * Safely writes JSON output inside an explicit sandboxed output directory.
 */
export function safeWriteJsonFile(baseDir, fileName, payload) {
  const resolvedBase = path.resolve(baseDir);
  const safeName = path.basename(fileName);
  if (safeName !== fileName || !safeName || safeName.startsWith('.')) {
    throw new Error(`Unsafe output filename: ${fileName}`);
  }
  const target = path.resolve(resolvedBase, safeName);
  if (!target.startsWith(resolvedBase + path.sep)) {
    throw new Error(`Output path escaped target directory: ${target}`);
  }
  fs.mkdirSync(resolvedBase, { recursive: true });
  const serialized = JSON.stringify(payload, null, 2) + '\n';
  fs.writeFileSync(target, serialized, 'utf8');
  const sha256 = crypto.createHash('sha256').update(serialized).digest('hex');
  return { path: target, bytes: Buffer.byteLength(serialized, 'utf8'), sha256 };
}

