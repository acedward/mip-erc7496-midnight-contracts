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
import { EVENT_NAME, MAX_VALUE_LEN, deploy, hex, pad, PAYLOAD_SIZE, validateTokenMetadataEvent } from './token-metadata.js';

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
          // MIP section 2.1: 0..4 are defined, 5..255 are reserved.
          expect(event.valType, where).toBeGreaterThanOrEqual(0);
          expect(event.valType, where).toBeLessThanOrEqual(4);
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
          const want = /^metadata\/\d+$/.test(event.key) ? 3 : expected[event.key];
          if (want !== undefined) {
            expect(event.valType, `${row.id}/${step.circuit}/${event.key}`).toBe(want);
          }
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
