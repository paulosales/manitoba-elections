type PositionRing = number[][];

function ringSignedArea(ring: PositionRing): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const p1 = ring[i];
    const p2 = ring[i + 1];
    if (!p1 || !p2) continue;
    sum += (p1[0] ?? 0) * (p2[1] ?? 0) - (p2[0] ?? 0) * (p1[1] ?? 0);
  }
  return sum / 2;
}

function normalizePolygonRings(rings: PositionRing[]): PositionRing[] {
  return rings.map((ring, idx) => {
    const signed = ringSignedArea(ring);
    // d3-geo spherical polygons require clockwise exterior (signed < 0 in lon/lat)
    // and counter-clockwise interior hole rings (signed > 0 in lon/lat).
    if (idx === 0 && signed > 0) return [...ring].reverse();
    if (idx > 0 && signed < 0) return [...ring].reverse();
    return ring;
  });
}

/**
 * Ensures GeoJSON Polygon/MultiPolygon ring winding matches d3-geo's spherical
 * exterior/hole convention so small civic wards never invert to fill the globe.
 */
export function normalizeD3Geometry<
  G extends { type: 'Polygon' | 'MultiPolygon' | string; coordinates: unknown[] },
>(geometry: G): G {
  if (geometry.type === 'Polygon') {
    return {
      ...geometry,
      coordinates: normalizePolygonRings(geometry.coordinates as PositionRing[]),
    };
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      ...geometry,
      coordinates: (geometry.coordinates as PositionRing[][]).map(normalizePolygonRings),
    };
  }
  return geometry;
}

export function normalizeFeatureCollectionWinding<
  F extends { geometry: { type: 'Polygon' | 'MultiPolygon' | string; coordinates: unknown[] } },
>(features: readonly F[]): F[] {
  return features.map((f) => ({
    ...f,
    geometry: normalizeD3Geometry(f.geometry),
  }));
}

