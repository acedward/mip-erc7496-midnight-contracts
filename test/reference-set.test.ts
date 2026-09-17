/**
 * Guards the committed fixtures against the reference set that produced them.
 *
 * `deployments/reference-set.json` states, per row, what a token indexer should
 * end up with (`expect`). `fixtures/simulator/*.json` is what the compiled
 * contracts actually produced. If the two ever drift — a template changes, a
 * step is added, the fold's rules move — this fails rather than shipping a
 * fixture corpus that no longer means what the matrix says it means.
 *
 * Regenerate with: npm run export:fixtures:simulator
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MISC_EVENT_SIZE, PAYLOAD_SIZE } from './token-metadata.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const referenceSet = read('deployments/reference-set.json');
const { events } = read('fixtures/simulator/events.json');
const { mints } = read('fixtures/simulator/mints.json');
const { tokens } = read('fixtures/simulator/expected-tokens.json');
const { vectors } = read('fixtures/simulator/color-vectors.json');
const { payloads } = read('fixtures/simulator/negative-payloads.json');

type Token = {
  row: string;
  kind: string;
  storage: string;
  status: string;
  colorHex: string | null;
  mintCount: number;
  totalMinted: string;
  name?: string;
};

const rowsOf = (id: string) => (tokens as Token[]).filter((t) => t.row === id);

describe('the reference set fixtures', () => {
  it('holds every payload at exactly 256 bytes with the standard event name', () => {
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.eventName).toBe('TokenMetadata');
      expect(event.payloadHex).toHaveLength(PAYLOAD_SIZE * 2);
      expect(event.len).toBeLessThanOrEqual(190);
      expect(event.kind).toBeLessThanOrEqual(3);
    }
  });

  it('covers all four table states plus every family', () => {
    expect(new Set((tokens as Token[]).map((t) => t.status))).toEqual(
      new Set(['observed', 'declared', 'described', 'inconsistent']),
    );
    expect(new Set((tokens as Token[]).map((t) => `${t.kind}/${t.storage}`))).toEqual(
      new Set(['shielded/native', 'unshielded/native', 'unshielded/ledger']),
    );
  });

  for (const row of referenceSet.rows) {
    const expected = row.expect ?? {};
    it(`row ${row.id} (${row.name}) matches what the matrix promises`, () => {
      const got = rowsOf(row.id);
      expect(got.length).toBe(expected.rows ?? 1);

      const first = got[0];
      if (expected.status) expect(first.status).toBe(expected.status);
      if (expected.storage) expect(first.storage).toBe(expected.storage);
      if (expected.color === null) expect(first.colorHex).toBeNull();
      if (expected.mintCount !== undefined) expect(first.mintCount).toBe(expected.mintCount);
      if (expected.totalMinted !== undefined) expect(first.totalMinted).toBe(expected.totalMinted);
      if (expected.name === null) expect(first.name).toBeUndefined();
      else if (first.status !== 'observed') expect(first.name).toBeTruthy();
    });
  }

  it('gives one colour to both kinds of the dual token and five distinct ones to the collection', () => {
    const dual = rowsOf('DAUR');
    expect(dual).toHaveLength(2);
    expect(dual[0].colorHex).toBe(dual[1].colorHex);
    expect(new Set(dual.map((t) => t.kind))).toEqual(new Set(['shielded', 'unshielded']));

    const pieces = rowsOf('CNST');
    expect(pieces).toHaveLength(5);
    expect(new Set(pieces.map((t) => t.colorHex)).size).toBe(5);
  });

  it('records a colour for every native token and none for a ledger token', () => {
    for (const token of tokens as Token[]) {
      if (token.storage === 'ledger') expect(token.colorHex).toBeNull();
      else expect(token.colorHex).toMatch(/^[0-9a-f]{64}$/);
    }
    for (const vector of vectors) {
      expect(vector.colorHex).toMatch(/^[0-9a-f]{64}$/);
      expect(vector.contractAddress).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('ties every mint to a token row and to the colour derived from its domain separator', () => {
    for (const mint of mints) {
      const row = (tokens as Token[]).find(
        (t) => t.row === mint.row && (t as never as { domainSepHex: string }).domainSepHex === mint.domainSepHex && t.kind === mint.kind,
      );
      expect(row, `no token row for mint ${mint.row}/${mint.domainSepHex}`).toBeDefined();
      expect(row!.colorHex).toBe(mint.colorHex);
      expect(row!.storage).toBe('native');
    }
  });

  it('keeps a negative payload for every rejection rule of the standard', () => {
    expect(payloads.length).toBeGreaterThanOrEqual(6);
    for (const payload of payloads) {
      expect(payload.eventName).toBe('TokenMetadata');
      expect(payload.payloadHex).toHaveLength(PAYLOAD_SIZE * 2);
      expect(payload.why).toBeTruthy();
    }
    expect(payloads.some((p: { len: number }) => p.len > 190)).toBe(true);
    expect(payloads.some((p: { kind: number }) => (p.kind & 0xfc) !== 0)).toBe(true);
  });

  it('documents the event size the standard fixes', () => {
    expect(MISC_EVENT_SIZE).toBe(32 + PAYLOAD_SIZE);
  });
});
