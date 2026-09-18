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
import {
  EVENT_NAME,
  LEGACY_EVENT_NAME,
  MAX_VALUE_LEN,
  VAL_TYPE_INTEGER,
  VAL_TYPE_JSON,
  VAL_TYPE_OPAQUE,
  VAL_TYPE_STRING,
  VAL_TYPE_URI,
  deploy,
  hex,
  pad,
  validateTokenMetadataEvent,
} from '../test/token-metadata.js';

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

/** The MIP's 189-byte `value` field with `text` in its meaningful prefix. */
function value189(text: string): { bytes: Uint8Array; len: bigint } {
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
  valType?: number;
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
  expectRows?: Record<string, unknown>[];
  steps: Step[];
}

/**
 * The val-type a step carries. The reference set states it explicitly; these
 * fallbacks are MIP Appendix A's, kept in step with
 * scripts/generate-literal-contracts.ts.
 */
function valTypeOf(step: Step): number {
  if (step.valType !== undefined) return step.valType;
  const key = step.key ?? '';
  if (/^metadata\/\d+$/.test(key)) return VAL_TYPE_JSON;
  switch (key) {
    case 'decimals':
      return VAL_TYPE_INTEGER;
    case 'metadata':
      return VAL_TYPE_JSON;
    case 'tokenUri':
      return VAL_TYPE_URI;
    default:
      return VAL_TYPE_STRING;
  }
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
  keyHex: string;
  /** MIP section 2.1 — how a consumer reads `value`. */
  valType: number;
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
  /** The kind byte a mint effect implies: 0 unshielded native, 1 shielded native. */
  kindByte: 0 | 1;
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
  const symbolBytes = pad(32, row.symbol);
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
      const { bytes, len } = value189(step.value!);
      const key = pad(32, step.key!);
      const valType = BigInt(valTypeOf(step));
      return row.template === 'NativeDualToken'
        ? ['setMetadata', [BigInt(row.kind), key, valType, len, bytes]]
        : ['setMetadata', [key, valType, len, bytes]];
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
      const { bytes, len } = value189(step.value!);
      return ['setPieceTrait', [pieceDomain, pad(32, step.key!), BigInt(valTypeOf(step)), len, bytes]];
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
      // Everything the reference set emits must be a valid MIP event; a corpus
      // that quietly contained a rejectable payload would be worse than useless.
      const verdict = validateTokenMetadataEvent(event);
      if (verdict.outcome !== 'accepted') {
        throw new Error(
          `${row.id} step ${index} (${step.op}) emitted a non-conforming event: ${JSON.stringify(verdict)}`,
        );
      }
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
        keyHex: hex(event.key),
        valType: event.valType,
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
          // MIP section 6.3: a mint effect is an observation of a NATIVE kind.
          kindByte: kind === 'shielded' ? 1 : 0,
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
  // MIP section 4: a token is identified by `(contractAddress, domainSep, kind)`
  // with the FULL kind byte. A declaration populates exactly its own row and a
  // mint effect populates the native row (kind 0 or 1) its tag implies, so the
  // two can never contradict each other (MIP section 6.3). That is what makes
  // the "Ledger Liar" two rows rather than one flagged one: its kind-2
  // declaration and its kind-0 mint are different tokens as far as the wire
  // format is concerned, and the honest picture is an observed row without a
  // name beside a declared row with one (MIP section 7.2).
  /** One row of the indexer's token table, as far as the simulator can say. */
  interface ExpectedToken {
    row: string;
    contractAddress: string;
    domainSepHex: string;
    domainSepText: string;
    kind: number;
    privacy: string;
    storage: string;
    colorHex: string | null;
    traits: Record<string, unknown>;
    declared?: boolean;
    mintCount: number;
    totalMinted: string;
    status?: string;
    name?: string;
    symbol?: string;
    decimals?: number;
    tokenUri?: string;
  }

  const newRow = (domainSepHex: string, domainSepText: string, kindByte: number): ExpectedToken => {
    const native = (kindByte & 2) === 0;
    return {
      row: row.id,
      contractAddress: address,
      domainSepHex,
      domainSepText,
      /** The MIP's identity byte, 0..3. */
      kind: kindByte,
      privacy: (kindByte & 1) === 1 ? 'shielded' : 'unshielded',
      storage: native ? 'native' : 'ledger',
      // MIP section 3: a colour exists only for the native kinds.
      colorHex: native
        ? hex(deriveColor(Uint8Array.from(Buffer.from(domainSepHex, 'hex')), address))
        : null,
      traits: {} as Record<string, unknown>,
      declared: false,
      mintCount: 0,
      totalMinted: '0',
    };
  };

  /** One map per (domainSep, kind) — the MIP's identity, over this contract. */
  const byIdentity = new Map<string, ExpectedToken>();
  const identityKey = (domainSepHex: string, kindByte: number) => `${domainSepHex}:${kindByte}`;

  for (const event of events.filter((e) => e.row === row.id)) {
    const key = identityKey(event.domainSepHex, event.kind);
    const token =
      byIdentity.get(key) ?? newRow(event.domainSepHex, event.domainSepText, event.kind);
    token.declared = true;
    // Last write wins, in emission order (MIP section 6.2). Appendix A's core
    // keys are projected into columns; everything else is a trait, kept verbatim
    // with its val-type (MIP section 5.2).
    if (event.keyText === 'decimals' && event.valType === VAL_TYPE_INTEGER) {
      token.decimals = Number(Buffer.from(event.valueHex, 'hex')[0] ?? 0);
    } else if (event.keyText === 'name' && event.valType === VAL_TYPE_STRING) {
      token.name = event.valueText;
    } else if (event.keyText === 'symbol' && event.valType === VAL_TYPE_STRING) {
      token.symbol = event.valueText;
    } else if (event.keyText === 'tokenUri' && event.valType === VAL_TYPE_URI) {
      token.tokenUri = event.valueText;
    } else {
      (token.traits as Record<string, unknown>)[event.keyText] = {
        valType: event.valType,
        valLen: event.len,
        valueHex: event.valueHex,
        text: event.valType === VAL_TYPE_OPAQUE ? null : event.valueText,
      };
    }
    byIdentity.set(key, token);
  }

  for (const mint of mints.filter((m) => m.row === row.id)) {
    const key = identityKey(mint.domainSepHex, mint.kindByte);
    const token =
      byIdentity.get(key) ??
      newRow(
        mint.domainSepHex,
        new TextDecoder().decode(Buffer.from(mint.domainSepHex, 'hex')).replace(/\0+$/, ''),
        mint.kindByte,
      );
    // A mint is a fact about a native kind; it creates or confirms that row and
    // never touches another one.
    token.colorHex = mint.colorHex;
    token.mintCount += 1;
    token.totalMinted = String(BigInt(token.totalMinted) + BigInt(mint.amount));
    byIdentity.set(key, token);
  }

  // MIP section 7.2: three states, and only native kinds can reach `described`.
  for (const token of [...byIdentity.values()].sort((a, b) => a.kind - b.kind)) {
    const declared = token.declared === true;
    const minted = token.mintCount > 0;
    delete token.declared;
    token.status = minted ? (declared ? 'described' : 'observed') : 'declared';
    expectedTokens.push(token as unknown as Record<string, unknown>);
  }
}

/**
 * The events a conforming consumer must NOT simply apply. They cannot come from
 * the reference templates — those only ever emit valid ones — so the probe emits
 * them on demand, which keeps them real compiled-contract output like the rest
 * of the corpus.
 *
 * Three outcomes, and the difference between them is the point:
 *
 *   - `ignored`   not a TokenMetadata event at all (MIP section 1). Not stored,
 *                 NOT recorded as rejected: the pre-MIP `TokenMetadata` name is
 *                 the case that matters here.
 *   - `rejected`  a TokenMetadata event whose payload breaks MIP section 2.1,
 *                 2.2 or 3. `reason` is the stable reason of spec 00021 FR-102.
 *   - `applied`   a valid event at the transport level. Some of these are keys
 *                 whose Appendix A projection fails (`projectionFails`): the
 *                 trait is still stored and the event is NOT rejected
 *                 (MIP sections 5.3 and 7.1).
 */
async function runNegatives() {
  const address = addressFor('PROBE');
  const probe = await deploy<Record<string, never>>(new MetadataProbe({}) as never, {}, [], { address });
  const empty = new Uint8Array(MAX_VALUE_LEN);
  const fill = (bytes: number[]): Uint8Array => Uint8Array.from([...bytes, ...empty.subarray(bytes.length)]);

  interface Case {
    why: string;
    /** MIP reference the case comes from. */
    mip: string;
    expect: 'rejected' | 'applied' | 'ignored';
    reason?: string;
    /** True when the event is applied but its Appendix A projection must fail. */
    projectionFails?: boolean;
    legacyName?: boolean;
    kind: number;
    key: Uint8Array;
    keyLabel: string;
    valType: number;
    len: number;
    value: Uint8Array;
  }

  const key = (text: string) => ({ key: pad(32, text), keyLabel: text });

  const cases: Case[] = [
    // ---- MIP section 1: the event name -----------------------------------
    {
      why: 'the pre-MIP event name `TokenMetadata`: a MIP consumer ignores it, and does not record it as rejected',
      mip: '1',
      expect: 'ignored',
      legacyName: true,
      kind: 1,
      ...key('name'),
      valType: VAL_TYPE_STRING,
      len: 10,
      value: value189('Old Name!!').bytes,
    },
    // ---- MIP section 2.2: transport validation ---------------------------
    {
      why: 'val-len 200 is above the 189-byte value field',
      mip: '2.2',
      expect: 'rejected',
      reason: 'val_len_too_long',
      kind: 1,
      ...key('name'),
      valType: VAL_TYPE_STRING,
      len: 200,
      value: new Uint8Array(MAX_VALUE_LEN).fill(0x41),
    },
    {
      why: 'an empty key: all 32 bytes NUL, so nothing is left after trimming',
      mip: '2.2',
      expect: 'rejected',
      reason: 'key_empty',
      kind: 1,
      key: new Uint8Array(32),
      keyLabel: '',
      valType: VAL_TYPE_STRING,
      len: 4,
      value: value189('void').bytes,
    },
    // ---- MIP section 2.1: the val-type byte ------------------------------
    {
      why: 'val-type 5, the first reserved value',
      mip: '2.1',
      expect: 'rejected',
      reason: 'val_type_reserved',
      kind: 1,
      ...key('name'),
      valType: 5,
      len: 4,
      value: value189('five').bytes,
    },
    {
      why: 'val-type 7, a reserved value in the middle of the range',
      mip: '2.1',
      expect: 'rejected',
      reason: 'val_type_reserved',
      kind: 1,
      ...key('description'),
      valType: 7,
      len: 5,
      value: value189('seven').bytes,
    },
    {
      why: 'val-type 255, the top of the reserved range',
      mip: '2.1',
      expect: 'rejected',
      reason: 'val_type_reserved',
      kind: 0,
      ...key('symbol'),
      valType: 255,
      len: 3,
      value: value189('MAX').bytes,
    },
    {
      why: 'val-type 1 carrying bytes that are not valid UTF-8',
      mip: '2.1',
      expect: 'rejected',
      reason: 'val_type_rule',
      kind: 1,
      ...key('name'),
      valType: VAL_TYPE_STRING,
      len: 3,
      value: fill([0xff, 0xfe, 0xfd]),
    },
    {
      why: 'val-type 2 with val-len 0 — an integer needs 1..16 bytes',
      mip: '2.1',
      expect: 'rejected',
      reason: 'val_type_rule',
      kind: 1,
      ...key('decimals'),
      valType: VAL_TYPE_INTEGER,
      len: 0,
      value: empty,
    },
    {
      why: 'val-type 2 with val-len 17 — above the 16-byte integer ceiling',
      mip: '2.1',
      expect: 'rejected',
      reason: 'val_type_rule',
      kind: 1,
      ...key('supplyCap'),
      valType: VAL_TYPE_INTEGER,
      len: 17,
      value: new Uint8Array(MAX_VALUE_LEN).fill(0x01),
    },
    {
      why: 'val-type 4 carrying a relative reference instead of an absolute URI',
      mip: '2.1',
      expect: 'rejected',
      reason: 'val_type_rule',
      kind: 1,
      ...key('tokenUri'),
      valType: VAL_TYPE_URI,
      len: 22,
      value: value189('/constellations/orion').bytes,
    },
    // ---- MIP section 3: the kind byte ------------------------------------
    {
      why: 'kind 4 — the first value MIP section 3 reserves',
      mip: '3',
      expect: 'rejected',
      reason: 'kind_unknown',
      kind: 4,
      ...key('name'),
      valType: VAL_TYPE_STRING,
      len: 4,
      value: value189('four').bytes,
    },
    {
      why: 'kind 255 — the pre-MIP layout treated the high bits as flags; they are not',
      mip: '3',
      expect: 'rejected',
      reason: 'kind_unknown',
      kind: 255,
      ...key('name'),
      valType: VAL_TYPE_STRING,
      len: 3,
      value: value189('max').bytes,
    },
    {
      why: 'kind 3 — shielded ledger: valid and applied, but purely informative (no colour)',
      mip: '3',
      expect: 'applied',
      kind: 3,
      ...key('name'),
      valType: VAL_TYPE_STRING,
      len: 12,
      value: value189('Hidden Ledge').bytes,
    },
    // ---- MIP sections 5.1, 5.2, 6.2: applied, but awkward -----------------
    {
      why: 'a key that is not valid UTF-8: MUST NOT be rejected, and is displayed as hex',
      mip: '5.1',
      expect: 'applied',
      kind: 1,
      key: Uint8Array.from([0xff, 0xfe, 0x01, ...new Uint8Array(29)]),
      keyLabel: '<non-UTF-8 key fffe01>',
      valType: VAL_TYPE_STRING,
      len: 4,
      value: value189('odd!').bytes,
    },
    {
      why: 'val-len 0 on a free trait: "present, empty" at the transport level',
      mip: '6.2',
      expect: 'applied',
      kind: 1,
      ...key('description'),
      valType: VAL_TYPE_STRING,
      len: 0,
      value: empty,
    },
    {
      why: 'val-type 0 opaque bytes: applied and surfaced as hex, no parsing rule at all',
      mip: '2.1',
      expect: 'applied',
      kind: 1,
      ...key('fingerprint'),
      valType: VAL_TYPE_OPAQUE,
      len: 4,
      value: fill([0xde, 0xad, 0xbe, 0xef]),
    },
    // ---- MIP section 5.3 / Appendix A: projection fails, event applied ----
    {
      why: 'the well-known key `decimals` carried as a UTF-8 string ("6") instead of Appendix A’s integer: APPLIED as a trait, projection fails, decimals column untouched',
      mip: '5.3',
      expect: 'applied',
      projectionFails: true,
      kind: 1,
      ...key('decimals'),
      valType: VAL_TYPE_STRING,
      len: 1,
      value: value189('6').bytes,
    },
    {
      why: 'the well-known key `name` carried as JSON instead of a string: applied as a trait, projection fails',
      mip: '5.3',
      expect: 'applied',
      projectionFails: true,
      kind: 1,
      ...key('name'),
      valType: VAL_TYPE_JSON,
      len: 15,
      value: value189('{"name":"json"}').bytes,
    },
    {
      why: 'decimals 99: the right type, but above Appendix A’s 36 — applied, projection fails',
      mip: 'A',
      expect: 'applied',
      projectionFails: true,
      kind: 1,
      ...key('decimals'),
      valType: VAL_TYPE_INTEGER,
      len: 1,
      value: fill([99]),
    },
    {
      why: 'a 40-byte symbol: valid transport, above Appendix A’s 32 — applied, projection fails',
      mip: 'A',
      expect: 'applied',
      projectionFails: true,
      kind: 1,
      ...key('symbol'),
      valType: VAL_TYPE_STRING,
      len: 40,
      value: value189('A'.repeat(40)).bytes,
    },
    {
      why: 'an empty name (val-len 0): "present, empty" at transport, but Appendix A wants 1..189 — applied, projection fails',
      mip: 'A',
      expect: 'applied',
      projectionFails: true,
      kind: 1,
      ...key('name'),
      valType: VAL_TYPE_STRING,
      len: 0,
      value: empty,
    },
    {
      why: 'a tokenUri that is an absolute non-http URI (ftp): passes MIP 2.1, fails Appendix A’s http(s) rule — applied, projection fails',
      mip: 'A',
      expect: 'applied',
      projectionFails: true,
      kind: 1,
      ...key('tokenUri'),
      valType: VAL_TYPE_URI,
      len: 26,
      value: value189('ftp://example.invalid/x.png').bytes,
    },
  ];

  const out: Record<string, unknown>[] = [];
  for (const c of cases) {
    const { events: emitted } = await probe.call(
      c.legacyName ? 'publishLegacyName' : 'publishRaw',
      pad(32, 'umbra:probe'),
      BigInt(c.kind),
      c.key,
      BigInt(c.valType),
      BigInt(c.len),
      c.value,
    );
    const event = emitted[0];
    const verdict = validateTokenMetadataEvent(event);

    // The corpus states what a consumer must do; the reference decoder has to
    // agree with it here, or the fixture would teach the wrong lesson.
    const expectedOutcome = c.expect === 'applied' ? 'accepted' : c.expect;
    if (verdict.outcome !== expectedOutcome) {
      throw new Error(`negative "${c.why}": decoder says ${JSON.stringify(verdict)}, corpus says ${c.expect}`);
    }
    if (c.reason && (verdict as { reason?: string }).reason !== c.reason) {
      throw new Error(`negative "${c.why}": decoder reason ${JSON.stringify(verdict)} != ${c.reason}`);
    }

    out.push({
      why: c.why,
      mipSection: c.mip,
      expect: c.expect,
      ...(c.reason ? { reason: c.reason } : {}),
      ...(c.projectionFails ? { projectionFails: true } : {}),
      contractAddress: address,
      eventName: event.eventName,
      payloadHex: hex(event.payload),
      kind: event.kind,
      keyHex: hex(event.key),
      keyText: c.keyLabel,
      valType: event.valType,
      len: event.len,
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
  standard: `MIP PR #315, mips/mip-xxxx-on-chain-token-metadata.md @ f433056; event name "${EVENT_NAME}" (the pre-MIP "${LEGACY_EVENT_NAME}" is ignored, MIP section 1)`,
  source: 'Compact simulator (@midnight-ntwrk/compact-runtime 0.19.0), compactc 0.34.0',
  producedBy: 'scripts/export-simulator-fixtures.ts',
  note: 'Real compiled-contract output, executed in process. Contract addresses are sha256("umbra:00020:<row id>") so everything here is reproducible; there are no block heights, transaction hashes or indexer event ids, and `eventId` is simply the emission order across the whole corpus. Token rows are keyed by the MIP\'s identity `(contractAddress, domainSep, kind 0..3)`; `privacy` and `storage` are derived from the kind byte and `status` is one of observed | declared | described (MIP section 7.2).',
};
const write = (file: string, body: unknown) =>
  writeFileSync(join(OUT, file), `${JSON.stringify({ ...provenance, ...(body as object) }, null, 2)}\n`);

const statusCounts = expectedTokens.reduce<Record<string, number>>((acc, token) => {
  const status = String(token.status);
  acc[status] = (acc[status] ?? 0) + 1;
  return acc;
}, {});
const identities = new Set(
  expectedTokens.map((t) => `${t.contractAddress}:${t.domainSepHex}:${t.kind}`),
);
const addressDomainPairs = new Set(
  expectedTokens.map((t) => `${t.contractAddress}:${t.domainSepHex}`),
);

write('events.json', { count: events.length, events });
write('mints.json', { count: mints.length, mints });
write('color-vectors.json', { count: colorVectors.length, vectors: colorVectors });
write('expected-tokens.json', {
  count: expectedTokens.length,
  identities: identities.size,
  addressDomainPairs: addressDomainPairs.size,
  statusCounts,
  tokens: expectedTokens,
});
write('negative-payloads.json', {
  count: negatives.length,
  outcomes: negatives.reduce<Record<string, number>>((acc, payload) => {
    const outcome = String(payload.expect);
    acc[outcome] = (acc[outcome] ?? 0) + 1;
    return acc;
  }, {}),
  payloads: negatives,
});

process.stdout.write(
  `\nwrote ${events.length} events, ${mints.length} mints, ${colorVectors.length} colour vectors, ` +
    `${expectedTokens.length} expected token rows over ${identities.size} identities ` +
    `(${Object.entries(statusCounts)
      .map(([status, n]) => `${n} ${status}`)
      .join(', ')}) and ${negatives.length} negative/edge payloads to fixtures/simulator/\n`,
);
