import { describe, expect, it } from 'vitest';
import {
  isSafeHttpsUrl,
  parseAndValidateBundleJson,
  sanitizeJsonValue,
} from '../schemas/datasetSchema';
import { assertAllowedHttpsUrl, safeWriteJsonFile } from '../../tools/importer/security.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('Security Controls & Input Sanitization', () => {
  it('allows only HTTPS URLs without credentials', () => {
    expect(isSafeHttpsUrl('https://www.electionsmanitoba.ca/en/Results')).toBe(true);
    expect(isSafeHttpsUrl('http://www.electionsmanitoba.ca/en/Results')).toBe(false);
    expect(isSafeHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpsUrl('https://user:pass@www.gov.mb.ca/')).toBe(false);
    expect(isSafeHttpsUrl(null)).toBe(false);
  });

  it('strips prototype-pollution keys recursively from parsed JSON', () => {
    const raw = JSON.parse('{"name":"Tuxedo","__proto__":{"polluted":true},"nested":{"constructor":"bad"}}');
    const clean = sanitizeJsonValue(raw) as Record<string, unknown>;
    expect(clean.name).toBe('Tuxedo');
    expect(Object.prototype.hasOwnProperty.call(clean, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(clean.nested as Record<string, unknown>, 'constructor')).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects invalid dataset bundle uploads', () => {
    expect(() => parseAndValidateBundleJson('{"elections":{},"districts":{}}')).toThrow();
  });

  it('enforces government/open-data hostname allow-list in CLI importer', () => {
    expect(() =>
      assertAllowedHttpsUrl('https://www.electionsmanitoba.ca/downloads/Summary_of_Results_GE2023.xlsx')
    ).not.toThrow();
    expect(() =>
      assertAllowedHttpsUrl('https://www.gov.mb.ca/legislature/members/mla_list_constituency.html')
    ).not.toThrow();
    expect(() =>
      assertAllowedHttpsUrl('https://services.arcgis.com/mMUesHYPkXjaFGfS/arcgis/rest/services/MUNICIPALITY/FeatureServer/0/query')
    ).not.toThrow();
    expect(() =>
      assertAllowedHttpsUrl('https://services.arcgis.com/otherTenant/arcgis/rest/services/Bad/FeatureServer/0')
    ).toThrow(/mMUesHYPkXjaFGfS/);
    expect(() => assertAllowedHttpsUrl('http://www.gov.mb.ca/')).toThrow(/HTTPS/);
    expect(() => assertAllowedHttpsUrl('https://169.254.169.254/latest/meta-data/')).toThrow(/allow-list/);
    expect(() => assertAllowedHttpsUrl('https://evil.example.com/payload.json')).toThrow(/allow-list/);
  });

  it('prevents path traversal when writing imported dataset files', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-sec-'));
    try {
      expect(() => safeWriteJsonFile(tmpDir, '../escape.json', { ok: true })).toThrow(/Unsafe output filename/);
      const res = safeWriteJsonFile(tmpDir, 'ok.json', { ok: true });
      expect(fs.existsSync(res.path)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

