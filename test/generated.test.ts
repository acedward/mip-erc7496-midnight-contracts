/**
 * The generated literal-payload contracts must emit EXACTLY the bytes
 * `deployments/generated-matrix.json` says they will.
 *
 * This is the guard that makes `scripts/generate-literal-contracts.ts` trustworthy: the
 * matrix is what `scripts/deploy-and-publish.ts` executes and what
 * `scripts/export-fixtures.ts` checks the chain against, so if the generator's idea of a
 * payload and the compiled contract's idea of a payload ever diverge, everything downstream
 * is quietly wrong. Running every emitting circuit of every generated contract in the
 * simulator and comparing all 256 bytes is the cheapest way to know they cannot.
 *
 * It also pins the property Q13 rests on: the bytes a literal contract emits are
 * indistinguishable from the bytes the parameterised template in `contracts/` emits.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INTEGER_LEN,
  EVENT_NAME,
  MAX_VALUE_LEN,
  PAYLOAD_SIZE,
  VAL_TYPE_NULL,
  decodeInteger,
  deploy,
  hex,
  pad,
  validateTokenMetadataEvent,
} from './token-metadata.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

interface MatrixEvent {
  piece: string | null;
  domainSep: string;
  kind: number;
  key: string;
  valType: number;
  len: number;
  value: string;
  text: string | null;
}
interface MatrixStep {
  kind: string;
  circuit: string;
  events?: MatrixEvent[];
}
interface MatrixRow {
  id: string;
  contract: string;
  template: string;
  name: string;
  symbol: string;
  decimals: number;
  kind: number;
  steps: MatrixStep[];
}

const matrix = JSON.parse(
  readFileSync(join(ROOT, 'deployments', 'generated-matrix.json'), 'utf8'),
) as { rows: MatrixRow[] };

/** The matrix must describe every row of the reference set, or a regeneration was partial. */
const referenceSet = JSON.parse(
  readFileSync(join(ROOT, 'deployments', 'reference-set.json'), 'utf8'),
) as { rows: { id: string }[] };

describe('generated-matrix.json', () => {
  it('covers every row of the reference set', () => {
    expect(matrix.rows.map((row) => row.id)).toEqual(referenceSet.rows.map((row) => row.id));
  });

  it('never exceeds the MIP’s 189-byte value field and always declares a val-type', () => {
    for (const row of matrix.rows) {
      for (const step of row.steps) {
        for (const event of step.events ?? []) {
          const where = `${row.id}/${step.circuit}/${event.key}`;
          expect(event.len, where).toBeLessThanOrEqual(MAX_VALUE_LEN);
          expect(event.value.length, where).toBe(MAX_VALUE_LEN * 2);
          // MIP section 2.1: 0..5 are defined, 6..255 are reserved.
          expect(event.valType, where).toBeGreaterThanOrEqual(0);
          expect(event.valType, where).toBeLessThanOrEqual(VAL_TYPE_NULL);
          // A Null carries no bytes at all.
          if (event.valType === VAL_TYPE_NULL) expect(event.len, where).toBe(0);
        }
      }
    }
  });

  it('gives MIP Appendix A’s val-type to every well-known key it uses', () => {
    const expected: Record<string, number> = {
      name: 1,
      symbol: 1,
      decimals: 2,
      metadata: 3,
      tokenUri: 4,
    };
    for (const row of matrix.rows) {
      for (const step of row.steps) {
        for (const event of step.events ?? []) {
          // A Null clears any key, well-known or not (MIP section 2.1).
          if (event.valType === VAL_TYPE_NULL) continue;
          const want = expected[event.key];
          if (want !== undefined) {
            expect(event.valType, `${row.id}/${step.circuit}/${event.key}`).toBe(want);
          }
        }
      }
    }
  });

  it('emits every `decimals` as `Uint<128>`: val-len 16, little-endian', () => {
    // MIP Appendix A's recommended width. The bytes are the number in the LOW
    // byte followed by NULs, never the digits' UTF-8 — a `Uint<128>` of 6 is
    // `0x06` + fifteen NULs, which is what Appendix A prints.
    let seen = 0;
    for (const row of matrix.rows) {
      for (const step of row.steps) {
        for (const event of step.events ?? []) {
          if (event.key !== 'decimals') continue;
          seen += 1;
          const where = `${row.id}/${step.circuit}/decimals`;
          expect(event.len, where).toBe(DEFAULT_INTEGER_LEN);
          const value = Uint8Array.from(Buffer.from(event.value, 'hex'));
          expect(decodeInteger(value.subarray(0, DEFAULT_INTEGER_LEN)), where).toBe(BigInt(row.decimals));
          // Every byte past the number is NUL, for the whole 189-byte field.
          expect(value.subarray(1).every((b) => b === 0), where).toBe(true);
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('carries the Null declaration MIP section 2.1 defines', () => {
    const nulls = matrix.rows.flatMap((row) =>
      row.steps.flatMap((step) => (step.events ?? []).filter((e) => e.valType === VAL_TYPE_NULL)),
    );
    expect(nulls.length).toBeGreaterThan(0);
    for (const event of nulls) {
      expect(event.len).toBe(0);
      // Emitters SHOULD zero the ignored bytes, and this one does: all 189.
      expect(event.value).toBe('00'.repeat(MAX_VALUE_LEN));
      expect(event.text).toBeNull();
    }
  });

  it('no longer carries a `metadata/<n>` part: MIP-0018 defines no reassembly', () => {
    // A val-type 3 value must be ONE complete JSON value (section 2.1) and the
    // MIP defines no multipart representation (section 5.4), so the six-part
    // document this repository published against the #315 draft is gone. The
    // rejected fragment lives on in fixtures/simulator/negative-payloads.json.
    const keys = matrix.rows.flatMap((row) =>
      row.steps.flatMap((step) => (step.events ?? []).map((e) => e.key)),
    );
    expect(keys.filter((key) => key.startsWith('metadata/'))).toEqual([]);
    for (const row of matrix.rows) {
      for (const step of row.steps) {
        for (const event of step.events ?? []) {
          if (event.valType !== 3) continue;
          const text = Buffer.from(event.value, 'hex').subarray(0, event.len).toString('utf8');
          expect(() => JSON.parse(text), `${row.id}/${event.key}`).not.toThrow();
        }
      }
    }
  });
});

for (const row of matrix.rows) {
  const emitting = row.steps.filter((step) => step.kind === 'emit');
  if (emitting.length === 0) continue;

  describe(`generated ${row.id} (${row.name})`, () => {
    it('emits exactly the payloads the matrix records', async () => {
      const { Contract } = (await import(
        `../contracts/managed/${row.contract}/contract/index.js`
      )) as unknown as { Contract: new (witnesses: Record<string, never>) => never };
      const instance = await deploy(new Contract({}) as never, {});

      for (const step of emitting) {
        const call = await instance.call(step.circuit);
        const expectedEvents = step.events ?? [];
        expect(call.events.length, `${row.id}.${step.circuit} event count`).toBe(expectedEvents.length);

        for (const [index, expected] of expectedEvents.entries()) {
          const actual = call.events[index]!;
          const where = `${row.id}.${step.circuit}[${index}] (${expected.key})`;
          expect(actual.eventName, where).toBe(EVENT_NAME);
          expect(actual.payload.length, where).toBe(PAYLOAD_SIZE);
          expect(hex(actual.domainSep), where).toBe(expected.domainSep);
          expect(actual.kind, where).toBe(expected.kind);
          expect(actual.keyText, where).toBe(expected.key);
          expect(actual.valType, where).toBe(expected.valType);
          expect(actual.len, where).toBe(expected.len);
          expect(hex(actual.value), where).toBe(expected.value);
          // Every event the reference set emits must survive transport validation.
          expect(validateTokenMetadataEvent(actual), where).toEqual({ outcome: 'accepted' });
          if (expected.text !== null && expected.key !== 'decimals') {
            expect(actual.valueText, where).toBe(expected.text);
          }
        }
      }
    });

    it('declares the kind byte and the domain separator the matrix says', async () => {
      const { pureCircuits } = (await import(
        `../contracts/managed/${row.contract}/contract/index.js`
      )) as unknown as { pureCircuits: Record<string, () => unknown> };
      // A collection takes its domain per call, so it has no contract-wide `domainSep()`.
      if (row.template !== 'ShieldedCollection') {
        expect(hex(pureCircuits.domainSep!() as Uint8Array)).toBe(
          hex(pad(32, `umbra:${row.symbol.toLowerCase()}`)),
        );
      }
      expect(Number(pureCircuits.decimals!())).toBe(row.decimals);
    });
  });
}

describe('a literal payload is byte-identical to the parameterised template’s', () => {
  it('SSTAR.publishMetadata equals NativeShieldedToken.publishMetadata', async () => {
    const generated = (await import('../contracts/managed/SSTAR/contract/index.js')) as unknown as {
      Contract: new (w: Record<string, never>) => never;
    };
    const template = (await import(
      '../contracts/managed/NativeShieldedToken/contract/index.js'
    )) as unknown as { Contract: new (w: Record<string, unknown>) => never };

    const address = '11'.repeat(32);
    const ownerSecretKey = new Uint8Array(32).fill(7);
    const witnesses = {
      wit_OwnableSK: ({ privateState }: { privateState: { secretKey: Uint8Array } }) => [
        privateState,
        privateState.secretKey,
      ],
    };

    const literal = await deploy(new generated.Contract({}) as never, {}, [], { address });
    const literalEvents = (await literal.call('publishMetadata')).events;

    const { persistentHash, CompactTypeBytes, CompactTypeVector } = await import(
      '@midnight-ntwrk/compact-runtime'
    );
    const accountId = persistentHash(new CompactTypeVector(1, new CompactTypeBytes(32)), [ownerSecretKey]);
    const parameterised = await deploy(
      new template.Contract(witnesses) as never,
      { secretKey: ownerSecretKey },
      [
        { is_left: true, left: accountId, right: { bytes: new Uint8Array(32) } },
        pad(32, 'umbra:sstar'),
        'Shielded Star',
        pad(32, 'Shielded Star'),
        13n,
        'SSTAR',
        pad(32, 'SSTAR'),
        5n,
        6n,
      ],
      { address },
    );
    const templateEvents = (await parameterised.call('publishMetadata')).events;

    expect(literalEvents.map((event) => hex(event.payload))).toEqual(
      templateEvents.map((event) => hex(event.payload)),
    );
  });
});
