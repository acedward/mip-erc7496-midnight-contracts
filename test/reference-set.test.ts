/**
 * Guards the committed fixtures against the reference set that produced them.
 *
 * `deployments/reference-set.json` states, per row, what a token indexer should
 * end up with (`expect`, and `expectRows` where one contract yields several of
 * the MIP's identities). `fixtures/simulator/*.json` is what the compiled
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
import {
  EVENT_NAME,
  LEGACY_EVENT_NAME,
  MAX_VALUE_LEN,
  MISC_EVENT_SIZE,
  PAYLOAD_SIZE,
} from './token-metadata.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const referenceSet = read('deployments/reference-set.json');
const { events } = read('fixtures/simulator/events.json');
const { mints } = read('fixtures/simulator/mints.json');
const expectedTokens = read('fixtures/simulator/expected-tokens.json');
const { tokens } = expectedTokens;
const { vectors } = read('fixtures/simulator/color-vectors.json');
const negatives = read('fixtures/simulator/negative-payloads.json');
const { payloads } = negatives;

type Token = {
  row: string;
  /** MIP section 4: the identity byte, 0..3. */
  kind: number;
  privacy: string;
  storage: string;
  status: string;
  colorHex: string | null;
  mintCount: number;
  totalMinted: string;
  domainSepHex: string;
  name?: string;
};

const rowsOf = (id: string) => (tokens as Token[]).filter((t) => t.row === id);

describe('the reference set fixtures', () => {
  it('holds every payload at exactly 256 bytes under the MIP’s event name', () => {
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.eventName).toBe(EVENT_NAME);
      expect(event.payloadHex).toHaveLength(PAYLOAD_SIZE * 2);
      expect(event.len).toBeLessThanOrEqual(MAX_VALUE_LEN);
      expect(event.kind).toBeLessThanOrEqual(3);
      // MIP section 2.1: 0..4 defined, 5..255 reserved.
      expect(event.valType).toBeGreaterThanOrEqual(0);
      expect(event.valType).toBeLessThanOrEqual(4);
    }
  });

  it('covers the MIP’s three token states and three value domains the set exercises', () => {
    // MIP section 7.2 — and `inconsistent` is not one of them any more.
    expect(new Set((tokens as Token[]).map((t) => t.status))).toEqual(
      new Set(['observed', 'declared', 'described']),
    );
    expect(new Set((tokens as Token[]).map((t) => `${t.privacy}/${t.storage}`))).toEqual(
      new Set(['shielded/native', 'unshielded/native', 'unshielded/ledger']),
    );
    expect(new Set((tokens as Token[]).map((t) => t.kind))).toEqual(new Set([0, 1, 2]));
  });

  it('keys every row on the MIP’s (address, domainSep, kind) identity', () => {
    const identities = new Set(
      (tokens as Token[]).map(
        (t) => `${(t as never as { contractAddress: string }).contractAddress}:${t.domainSepHex}:${t.kind}`,
      ),
    );
    expect(identities.size).toBe(tokens.length);
    expect(expectedTokens.identities).toBe(tokens.length);
    // Two contracts describe one (address, domainSep) under two kinds: the dual
    // token and the Ledger Liar. Both are links a consumer MAY show (MIP §4).
    expect(expectedTokens.addressDomainPairs).toBe(tokens.length - 2);
  });

  it('derives privacy and storage from the kind byte, never the other way round', () => {
    for (const token of tokens as Token[]) {
      expect(token.privacy).toBe((token.kind & 1) === 1 ? 'shielded' : 'unshielded');
      expect(token.storage).toBe((token.kind & 2) === 2 ? 'ledger' : 'native');
      // MIP section 3: a colour exists only for the native kinds.
      if (token.storage === 'ledger') expect(token.colorHex).toBeNull();
      else expect(token.colorHex).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  for (const row of referenceSet.rows) {
    const expected = row.expect ?? {};
    it(`row ${row.id} (${row.name}) matches what the matrix promises`, () => {
      const got = rowsOf(row.id);
      expect(got.length).toBe(expected.rows ?? 1);

      if (row.expectRows) {
        // One contract, several of the MIP's identities: match each by kind byte.
        for (const want of row.expectRows as Record<string, unknown>[]) {
          const actual = got.find((t) => t.kind === want.kind);
          expect(actual, `${row.id} has no kind-${want.kind} row`).toBeDefined();
          for (const [field, value] of Object.entries(want)) {
            if (field === 'kind') continue;
            if (field === 'color') expect(actual!.colorHex).toBe(value);
            else if (field === 'name' && value === null) expect(actual!.name).toBeUndefined();
            else expect(actual![field as keyof Token], `${row.id}.${field}`).toBe(value);
          }
        }
        return;
      }

      const first = got[0];
      if (expected.status) expect(first.status).toBe(expected.status);
      if (expected.storage) expect(first.storage).toBe(expected.storage);
      if (expected.color === null) expect(first.colorHex).toBeNull();
      if (expected.mintCount !== undefined) expect(first.mintCount).toBe(expected.mintCount);
      if (expected.totalMinted !== undefined) expect(first.totalMinted).toBe(expected.totalMinted);
      if (expected.name === null) expect(first.name).toBeUndefined();
      else if (first.status !== 'observed') expect(first.name).toBeTruthy();
      // A single-identity row carries the kind byte its contract declares.
      if ((expected.rows ?? 1) === 1) expect(first.kind).toBe(row.kind);
    });
  }

  it('gives one colour to both kinds of the dual token and five distinct ones to the collection', () => {
    const dual = rowsOf('DAUR');
    expect(dual).toHaveLength(2);
    expect(dual[0].colorHex).toBe(dual[1].colorHex);
    expect(new Set(dual.map((t) => t.kind))).toEqual(new Set([0, 1]));

    const pieces = rowsOf('CNST');
    expect(pieces).toHaveLength(5);
    expect(new Set(pieces.map((t) => t.colorHex)).size).toBe(5);
  });

  it('turns the Ledger Liar into two honest rows, not one flagged one', () => {
    // MIP sections 6.3 and 7.2: a mint is a fact about kind 0, a declaration is
    // a claim about kind 2, and neither can hide or relabel the other.
    const liar = rowsOf('LLIAR');
    expect(liar).toHaveLength(2);

    const observed = liar.find((t) => t.kind === 0)!;
    expect(observed.status).toBe('observed');
    expect(observed.name).toBeUndefined();
    expect(observed.mintCount).toBe(1);
    expect(observed.colorHex).toMatch(/^[0-9a-f]{64}$/);

    const declared = liar.find((t) => t.kind === 2)!;
    expect(declared.status).toBe('declared');
    expect(declared.name).toBe('Ledger Liar');
    expect(declared.mintCount).toBe(0);
    expect(declared.colorHex).toBeNull();

    // They share a domain separator, which is the link a consumer MAY show.
    expect(observed.domainSepHex).toBe(declared.domainSepHex);
  });

  it('records a colour for every colour vector', () => {
    for (const vector of vectors) {
      expect(vector.colorHex).toMatch(/^[0-9a-f]{64}$/);
      expect(vector.contractAddress).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('ties every mint to a native token row and to the colour derived from its domain separator', () => {
    for (const mint of mints) {
      expect(mint.kindByte, 'a mint effect is always a native kind').toBeLessThanOrEqual(1);
      const row = (tokens as Token[]).find(
        (t) => t.row === mint.row && t.domainSepHex === mint.domainSepHex && t.kind === mint.kindByte,
      );
      expect(row, `no token row for mint ${mint.row}/${mint.domainSepHex}`).toBeDefined();
      expect(row!.colorHex).toBe(mint.colorHex);
      expect(row!.storage).toBe('native');
    }
  });

  it('keeps a payload for every rejection rule of MIP sections 2.1, 2.2 and 3', () => {
    const reasons = new Set(
      payloads.filter((p: { expect: string }) => p.expect === 'rejected').map((p: { reason: string }) => p.reason),
    );
    expect(reasons).toEqual(
      new Set(['val_len_too_long', 'val_type_reserved', 'val_type_rule', 'key_empty', 'kind_unknown']),
    );

    for (const payload of payloads) {
      expect(payload.payloadHex).toHaveLength(PAYLOAD_SIZE * 2);
      expect(payload.why).toBeTruthy();
      expect(['rejected', 'applied', 'ignored']).toContain(payload.expect);
      expect(payload.eventName).toBe(payload.expect === 'ignored' ? LEGACY_EVENT_NAME : EVENT_NAME);
    }

    expect(payloads.some((p: { len: number }) => p.len > MAX_VALUE_LEN)).toBe(true);
    expect(payloads.some((p: { kind: number }) => p.kind > 3)).toBe(true);
    expect(payloads.some((p: { valType: number }) => p.valType > 4)).toBe(true);
  });

  it('carries the one event a consumer must IGNORE rather than reject', () => {
    // MIP section 1: any Misc event under another name is not a TokenMetadata
    // event at all. The pre-MIP name is the case that will actually be seen.
    const ignored = payloads.filter((p: { expect: string }) => p.expect === 'ignored');
    expect(ignored).toHaveLength(1);
    expect(ignored[0].eventName).toBe(LEGACY_EVENT_NAME);
    expect(ignored[0].reason).toBeUndefined();
  });

  it('carries well-known keys whose Appendix A projection fails but whose event is APPLIED', () => {
    // MIP section 5.3: keep the trait, flag the projection, do not reject.
    const projectionFailures = payloads.filter((p: { projectionFails?: boolean }) => p.projectionFails);
    expect(projectionFailures.length).toBeGreaterThanOrEqual(5);
    for (const payload of projectionFailures) {
      expect(payload.expect).toBe('applied');
      expect(payload.reason).toBeUndefined();
    }
    // The headline case: a well-known key carrying the wrong val-type.
    expect(
      projectionFailures.some(
        (p: { keyText: string; valType: number }) => p.keyText === 'decimals' && p.valType === 1,
      ),
    ).toBe(true);
  });

  it('documents the event size the MIP fixes', () => {
    expect(MISC_EVENT_SIZE).toBe(32 + PAYLOAD_SIZE);
    expect(32 + 1 + 32 + 1 + 1 + MAX_VALUE_LEN).toBe(PAYLOAD_SIZE);
  });

  it('never mentions the state this repository used to have', () => {
    // The MIP has three consumer states; `inconsistent` was ours and is gone.
    const corpus = JSON.stringify([expectedTokens, negatives, referenceSet]);
    expect(corpus).not.toContain('inconsistent');
  });
});
