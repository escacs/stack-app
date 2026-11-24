// Tests for the preset helpers (src/presets.ts): the row summary and the filter.
import { describe, expect, it } from 'vitest';
import { filterPresets, presetSummary } from './presets';

const web = { name: 'web', description: 'Front-end starter', imports: [{ id: 'skill/a', to: 'x' }, { id: 'style/b', to: null }] };
const solo = { name: 'solo', description: 'One thing', imports: [{ id: 'skill/c', to: null }] };

describe('presetSummary', () => {
  it('counts what the bundle holds', () => {
    expect(presetSummary(web)).toBe('2 entries');
    expect(presetSummary(solo)).toBe('1 entry');
  });
});

describe('filterPresets', () => {
  it('keeps everything for an empty query', () => {
    expect(filterPresets([web, solo], '  ')).toHaveLength(2);
  });
  it('matches name, description and member ids; every term must hit', () => {
    expect(filterPresets([web, solo], 'front').map((p) => p.name)).toEqual(['web']);
    expect(filterPresets([web, solo], 'skill/c').map((p) => p.name)).toEqual(['solo']);
    expect(filterPresets([web, solo], 'web one')).toEqual([]);
  });
});
