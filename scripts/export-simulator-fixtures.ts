/**
 * Runs the whole reference set (deployments/reference-set.json) through the
 * Compact simulator and writes the bytes a token indexer must be able to parse.
 *
 *   npm run export:fixtures:simulator
 *
 * This is the OFFLINE counterpart of the on-chain fixture exporter: no node, no
 * indexer, no proof server, no wallet — just the compiled contracts executed
 * in process. What comes out is real compiled-contract output rather than
 * hand-written bytes, so an indexer's golden test can be byte-exact long before
 * anything is deployed. What it cannot give is block heights, transaction
 * hashes or indexer event ids; those are filled with deterministic stand-ins
 * and clearly marked.
 *
 * Contract addresses are derived from the row id, so the whole corpus —
 * including every colour — is reproducible.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentCommit,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { Contract as NativeShielded } from '../contracts/managed/NativeShieldedToken/contract/index.js';
import { Contract as NativeUnshielded } from '../contracts/managed/NativeUnshieldedToken/contract/index.js';
import { Contract as NativeDual } from '../contracts/managed/NativeDualToken/contract/index.js';
import { Contract as ShieldedCollection } from '../contracts/managed/ShieldedCollection/contract/index.js';
import { Contract as LedgerTokenContract } from '../contracts/managed/LedgerToken/contract/index.js';
import { Contract as MetadataProbe } from '../contracts/managed/MetadataProbe/contract/index.js';
import { MAX_VALUE_LEN, deploy, hex, pad } from '../test/token-metadata.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'fixtures', 'simulator');

const BYTES32 = new CompactTypeBytes(32);
const VECTOR2 = new CompactTypeVector(2, BYTES32);
const DERIVE_TOKEN = pad(32, 'midnight:derive_token');
const OWNER_SK = new Uint8Array(32).fill(7);

type OwnerState = { secretKey: Uint8Array };
const witnesses = {
  wit_OwnableSK: ({ privateState }: { privateState: OwnerState }): [OwnerState, Uint8Array] => [
    privateState,
    privateState.secretKey,
  ],
  wit_FungibleTokenSK: ({ privateState }: { privateState: OwnerState }): [OwnerState, Uint8Array] => [
    privateState,
    privateState.secretKey,
  ],
};

const accountId = (sk: Uint8Array) => persistentHash(new CompactTypeVector(1, BYTES32), [sk]);
const ownerEither = {
  is_left: true,
  left: accountId(OWNER_SK),
  right: { bytes: new Uint8Array(32) },
};

/** A deterministic 32-byte contract address, so every fixture is reproducible. */
function addressFor(id: string): string {
  return createHash('sha256').update(`umbra:00020:${id}`).digest('hex');
}

function deriveColor(domainSep: Uint8Array, address: string): Uint8Array {
  return persistentCommit(VECTOR2, [domainSep, Uint8Array.from(Buffer.from(address, 'hex'))], DERIVE_TOKEN);
}

function value190(text: string): { bytes: Uint8Array; len: bigint } {
  const encoded = new TextEncoder().encode(text);
  if (encoded.length > MAX_VALUE_LEN) {
    throw new Error(`value of ${encoded.length} bytes exceeds the ${MAX_VALUE_LEN}-byte field: ${text.slice(0, 40)}…`);
  }
  const bytes = new Uint8Array(MAX_VALUE_LEN);
  bytes.set(encoded);
  return { bytes, len: BigInt(encoded.length) };
}

const zswapRecipient = (label: string) => ({
  is_left: true,
  left: { bytes: pad(32, label) },
  right: { bytes: new Uint8Array(32) },
});
const userRecipient = (label: string) => ({
  is_left: false,
  left: { bytes: new Uint8Array(32) },
  right: { bytes: pad(32, label) },
});
const ledgerAccount = (label: string) =>
  label === 'owner' ? ownerEither : { is_left: true, left: pad(32, label), right: { bytes: new Uint8Array(32) } };

interface Step {
  op: string;
  key?: string;
  value?: string;
  to?: string;
  amount?: string;
  nonce?: string;
  piece?: string;
  pieceName?: string;
}

interface Row {
  id: string;
  name: string;
  symbol: string;
  decimals: number;
  kind: number;
  template: string;
  domain?: string;
  pieces?: string[];
  optional?: boolean;
  expect?: Record<string, unknown>;
  steps: Step[];
}

const referenceSet = JSON.parse(readFileSync(join(ROOT, 'deployments', 'reference-set.json'), 'utf8')) as {
  rows: Row[];
};

// --------------------------------------------------------------------------

interface EventRecord {
  row: string;
  /** Index of the event across the whole corpus, in emission order — stands in for the indexer's event id. */
  eventId: number;
  step: number;
  op: string;
  contractAddress: string;
  eventName: string;
  payloadHex: string;
  domainSepHex: string;
  domainSepText: string;
  kind: number;
  keyText: string;
  len: number;
  valueHex: string;
  valueText: string;
}

interface MintRecord {
  row: string;
  step: number;
  op: string;
  contractAddress: string;
  domainSepHex: string;
  kind: 'shielded' | 'unshielded';
  amount: string;
  colorHex: string;
}

const events: EventRecord[] = [];
const mints: MintRecord[] = [];
const colorVectors: { row: string; contractAddress: string; domainSepHex: string; domainSepText: string; colorHex: string; source: string }[] = [];
const expectedTokens: Record<string, unknown>[] = [];

let eventId = 0;

function newContract(template: string) {
  switch (template) {
    case 'NativeShieldedToken':
      return new NativeShielded<OwnerState>(witnesses as never);
    case 'NativeUnshieldedToken':
      return new NativeUnshielded<OwnerState>(witnesses as never);
    case 'NativeDualToken':
      return new NativeDual<OwnerState>(witnesses as never);
    case 'ShieldedCollection':
      return new ShieldedCollection<OwnerState>(witnesses as never);
    case 'LedgerToken':
      return new LedgerTokenContract<OwnerState>(witnesses as never);
    default:
      throw new Error(`unknown template: ${template}`);
  }
}

function constructorArgs(row: Row): unknown[] {
  const domain = pad(32, row.domain ?? '');
  const nameBytes = pad(32, row.name);
  const nameLen = BigInt(new TextEncoder().encode(row.name).length);
  const symbolBytes = pad(16, row.symbol);
  const symbolLen = BigInt(new TextEncoder().encode(row.symbol).length);
  const decimals = BigInt(row.decimals);

  switch (row.template) {
    case 'NativeShieldedToken':
      return [ownerEither, domain, row.name, nameBytes, nameLen, row.symbol, symbolBytes, symbolLen, decimals];
    case 'NativeUnshieldedToken':
      return [ownerEither, domain, nameBytes, nameLen, symbolBytes, symbolLen, decimals, BigInt(row.kind)];
    case 'NativeDualToken':
      return [ownerEither, domain, nameBytes, nameLen, symbolBytes, symbolLen, decimals];
    case 'ShieldedCollection':
      return [ownerEither, row.name, row.symbol, symbolBytes, symbolLen, decimals];
    case 'LedgerToken':
      return [ownerEither, domain, row.name, nameBytes, nameLen, row.symbol, symbolBytes, symbolLen, decimals];
    default:
      throw new Error(`unknown template: ${row.template}`);
  }
}

/** Translates one matrix step into a circuit call. */
function callFor(row: Row, step: Step): [string, unknown[]] {
  const pieceDomain = step.piece ? pad(32, `cnst:${step.piece}`) : undefined;
  switch (step.op) {
    case 'publishMetadata':
      return ['publishMetadata', []];
    case 'publishUnshielded':
      return ['publishUnshielded', []];
    case 'publishShielded':
      return ['publishShielded', []];
    case 'setMetadata': {
      const { bytes, len } = value190(step.value!);
      const key = pad(32, step.key!);
      return row.template === 'NativeDualToken'
        ? ['setMetadata', [BigInt(row.kind), key, len, bytes]]
        : ['setMetadata', [key, len, bytes]];
    }
    case 'mint':
      return row.template === 'NativeShieldedToken'
        ? ['mint', [zswapRecipient(step.to!), BigInt(step.amount!), pad(32, step.nonce!)]]
        : ['mint', [userRecipient(step.to!), BigInt(step.amount!)]];
    case 'mintShielded':
      return ['mintShielded', [zswapRecipient(step.to!), BigInt(step.amount!), pad(32, step.nonce!)]];
    case 'mintUnshielded':
      return ['mintUnshielded', [userRecipient(step.to!), BigInt(step.amount!)]];
    case 'ledgerMint':
      return ['mint', [ledgerAccount(step.to!), BigInt(step.amount!)]];
    case 'transfer':
      return ['transfer', [ledgerAccount(step.to!), BigInt(step.amount!)]];
    case 'mintPiece':
      return ['mintPiece', [pieceDomain, zswapRecipient(step.to!), pad(32, step.nonce!)]];
    case 'publishPiece':
      return [
        'publishPiece',
        [pieceDomain, pad(32, step.pieceName!), BigInt(new TextEncoder().encode(step.pieceName!).length)],
      ];
    case 'setPieceTrait': {
      const { bytes, len } = value190(step.value!);
      return ['setPieceTrait', [pieceDomain, pad(32, step.key!), len, bytes]];
    }
    default:
      throw new Error(`unknown step: ${step.op}`);
  }
}

async function runRow(row: Row) {
  const address = addressFor(row.id);
  const contract = await deploy<OwnerState>(newContract(row.template) as never, { secretKey: OWNER_SK }, constructorArgs(row), {
    address,
  });

  for (const [index, step] of row.steps.entries()) {
    const [circuit, args] = callFor(row, step);
    const call = await contract.call(circuit, ...args);

    for (const event of call.events) {
      events.push({
        row: row.id,
        eventId: eventId++,
        step: index,
        op: step.op,
        contractAddress: address,
        eventName: event.eventName,
        payloadHex: hex(event.payload),
        domainSepHex: hex(event.domainSep),
        domainSepText: new TextDecoder().decode(event.domainSep).replace(/\0+$/, ''),
        kind: event.kind,
        keyText: event.keyText,
        len: event.len,
        valueHex: hex(event.valueBytes),
        valueText: event.valueText,
      });
    }

    for (const [which, kind] of [
      ['shieldedMints', 'shielded'],
      ['unshieldedMints', 'unshielded'],
    ] as const) {
      const map = call.effects?.[which];
      if (!map) continue;
      for (const [domainSepHex, amount] of map.entries()) {
        const domainSep = Uint8Array.from(Buffer.from(String(domainSepHex), 'hex'));
        mints.push({
          row: row.id,
          step: index,
          op: step.op,
          contractAddress: address,
          domainSepHex: String(domainSepHex),
          kind,
          amount: String(amount),
          colorHex: hex(deriveColor(domainSep, address)),
        });
      }
    }
  }

  // Colour vectors: what the contract says, and what an observer derives.
  const domains = row.pieces ? row.pieces.map((p) => `cnst:${p}`) : row.domain ? [row.domain] : [];
  for (const domainText of domains) {
    const domainSep = pad(32, domainText);
    const derived = deriveColor(domainSep, address);
    const args = row.template === 'ShieldedCollection' ? [domainSep] : [];
    let fromCircuit: string | null = null;
    if (row.template !== 'LedgerToken') {
      const { result } = await contract.call('tokenColor', ...args);
      fromCircuit = hex(result as Uint8Array);
      if (fromCircuit !== hex(derived)) {
        throw new Error(`colour mismatch for ${row.id}/${domainText}: circuit ${fromCircuit} vs derived ${hex(derived)}`);
      }
    }
    colorVectors.push({
      row: row.id,
      contractAddress: address,
      domainSepHex: hex(domainSep),
      domainSepText: domainText,
      colorHex: hex(derived),
      source: fromCircuit ? 'tokenColor() == persistentCommit([domainSep, address], "midnight:derive_token")' : 'ledger token — no colour exists',
    });
  }

  // The rows an indexer should end up with, as far as the simulator can say.
  //
  // The row key is `(address, domainSep, kind)` where `kind` is BIT 0 of the
  // kind byte only — shielded or unshielded. Bit 1 (native vs ledger) is the
  // `storage` column, not part of the key. That is what makes the "Ledger Liar"
  // interesting: its declaration (kind byte 2 = unshielded ledger) and its mint
  // (unshielded native) land on the SAME row, and the row is `inconsistent`.
  const perToken = new Map<string, Record<string, unknown>>();
  const rowKey = (domainSepHex: string, kindByte: number) => `${domainSepHex}:${kindByte & 1}`;

  for (const event of events.filter((e) => e.row === row.id)) {
    const key = rowKey(event.domainSepHex, event.kind);
    const declaredLedger = (event.kind & 2) !== 0;
    const token = perToken.get(key) ?? {
      row: row.id,
      contractAddress: address,
      domainSepHex: event.domainSepHex,
      domainSepText: event.domainSepText,
      kind: event.kind & 1 ? 'shielded' : 'unshielded',
      declaredKindByte: event.kind,
      storage: declaredLedger ? 'ledger' : 'native',
      colorHex: declaredLedger
        ? null
        : hex(deriveColor(Uint8Array.from(Buffer.from(event.domainSepHex, 'hex')), address)),
      traits: {} as Record<string, string>,
    };
    // Last write wins, in emission order.
    if (event.keyText === 'decimals') token.decimals = Number(Buffer.from(event.valueHex, 'hex')[0] ?? 0);
    else if (event.keyText === 'name') token.name = event.valueText;
    else if (event.keyText === 'symbol') token.symbol = event.valueText;
    else if (event.keyText === 'tokenUri') token.tokenUri = event.valueText;
    else (token.traits as Record<string, string>)[event.keyText] = event.valueText;
    perToken.set(key, token);
  }

  for (const mint of mints.filter((m) => m.row === row.id)) {
    const kindByte = mint.kind === 'shielded' ? 1 : 0;
    const key = rowKey(mint.domainSepHex, kindByte);
    const token = perToken.get(key) ?? {
      row: row.id,
      contractAddress: address,
      domainSepHex: mint.domainSepHex,
      domainSepText: new TextDecoder().decode(Buffer.from(mint.domainSepHex, 'hex')).replace(/\0+$/, ''),
      kind: mint.kind,
      storage: 'native',
      colorHex: mint.colorHex,
      traits: {},
    };
    // An observed mint is a fact and overrides whatever a declaration claimed.
    token.observedKind = mint.kind;
    token.storage = 'native';
    token.colorHex = mint.colorHex;
    token.mintCount = ((token.mintCount as number) ?? 0) + 1;
    token.totalMinted = String(BigInt((token.totalMinted as string) ?? '0') + BigInt(mint.amount));
    perToken.set(key, token);
  }

  for (const token of perToken.values()) {
    const described = token.name !== undefined || token.symbol !== undefined;
    const minted = ((token.mintCount as number) ?? 0) > 0;
    const declaredKind = token.declaredKindByte as number | undefined;
    // A declaration that calls a token ledger-held while a mint proves it native
    // (or that disagrees about bit 0) is kept, but the row is flagged.
    const contradicts =
      minted &&
      declaredKind !== undefined &&
      (((declaredKind & 2) !== 0) || (declaredKind & 1) !== (token.kind === 'shielded' ? 1 : 0));
    token.mintCount ??= 0;
    token.totalMinted ??= '0';
    token.status = !described ? 'observed' : !minted ? 'declared' : contradicts ? 'inconsistent' : 'described';
    expectedTokens.push(token);
  }
}

/**
 * Payloads a conforming consumer must REJECT. They cannot come from the
 * reference templates — those only ever emit valid ones — so the probe emits
 * them on demand.
 */
async function runNegatives() {
  const address = addressFor('PROBE');
  const probe = await deploy<Record<string, never>>(new MetadataProbe({}) as never, {}, [], { address });
  const empty = new Uint8Array(MAX_VALUE_LEN);
  const cases: { why: string; kind: number; key: string; len: number; value: Uint8Array }[] = [
    { why: 'len above the 190-byte value field', kind: 1, key: 'name', len: 200, value: new Uint8Array(MAX_VALUE_LEN).fill(0x41) },
    { why: 'decimals with a length other than 1', kind: 1, key: 'decimals', len: 3, value: empty },
    { why: 'decimals above 36', kind: 1, key: 'decimals', len: 1, value: Uint8Array.from([99, ...empty.subarray(1)]) },
    { why: 'a reserved kind bit is set', kind: 0x80, key: 'name', len: 4, value: value190('good').bytes },
    { why: 'kind 0x03 — shielded ledger, valid but exercises both bits', kind: 3, key: 'name', len: 4, value: value190('both').bytes },
    { why: 'an empty name (len 0)', kind: 1, key: 'name', len: 0, value: empty },
    { why: 'a name that is not valid UTF-8', kind: 1, key: 'name', len: 3, value: Uint8Array.from([0xff, 0xfe, 0xfd, ...empty.subarray(3)]) },
  ];

  const out: Record<string, unknown>[] = [];
  for (const c of cases) {
    const { events: emitted } = await probe.call(
      'publishRaw',
      pad(32, 'umbra:probe'),
      BigInt(c.kind),
      pad(32, c.key),
      BigInt(c.len),
      c.value,
    );
    out.push({
      why: c.why,
      contractAddress: address,
      eventName: emitted[0].eventName,
      payloadHex: hex(emitted[0].payload),
      kind: emitted[0].kind,
      keyText: emitted[0].keyText,
      len: emitted[0].len,
    });
  }
  return out;
}

// --------------------------------------------------------------------------

const only = process.argv.slice(2);
const rows = only.length ? referenceSet.rows.filter((r) => only.includes(r.id)) : referenceSet.rows;

for (const row of rows) {
  await runRow(row);
  process.stdout.write(`${row.id}: ${events.filter((e) => e.row === row.id).length} events, ${mints.filter((m) => m.row === row.id).length} mints\n`);
}
const negatives = await runNegatives();

mkdirSync(OUT, { recursive: true });
const provenance = {
  source: 'Compact simulator (@midnight-ntwrk/compact-runtime 0.19.0), compactc 0.34.0',
  producedBy: 'scripts/export-simulator-fixtures.ts',
  note: 'Real compiled-contract output, executed in process. Contract addresses are sha256("umbra:00020:<row id>") so everything here is reproducible; there are no block heights, transaction hashes or indexer event ids, and `eventId` is simply the emission order across the whole corpus.',
};
const write = (file: string, body: unknown) =>
  writeFileSync(join(OUT, file), `${JSON.stringify({ ...provenance, ...(body as object) }, null, 2)}\n`);

write('events.json', { count: events.length, events });
write('mints.json', { count: mints.length, mints });
write('color-vectors.json', { count: colorVectors.length, vectors: colorVectors });
write('expected-tokens.json', { count: expectedTokens.length, tokens: expectedTokens });
write('negative-payloads.json', { count: negatives.length, payloads: negatives });

process.stdout.write(
  `\nwrote ${events.length} events, ${mints.length} mints, ${colorVectors.length} colour vectors, ${expectedTokens.length} expected token rows and ${negatives.length} negative payloads to fixtures/simulator/\n`,
);
