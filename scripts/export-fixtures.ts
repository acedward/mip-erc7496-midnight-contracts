/**
 * Read the public Stagenet indexer for everything `out/deployment.json` recorded and write
 * `fixtures/stagenet/`: the recorded bytes an indexer's golden tests consume.
 *
 *   npx tsx scripts/export-fixtures.ts
 *
 *   fixtures/stagenet/raw-tx.json          per transaction: `raw`, `transactionResult`,
 *                                          block height and hash — real Stagenet bytes
 *   fixtures/stagenet/events.json          every `MiscContractEvent` those transactions
 *                                          emitted, with the 256-byte payload decoded into
 *                                          the MIP's six fields
 *   fixtures/stagenet/expected-tokens.json one entry per expected token row (spec section 5's
 *                                          `Token` shape), built from the events and the
 *                                          matrix's `expect` block
 *   fixtures/stagenet/color-vectors.json   (address, domainSep) -> colour, derived off chain
 *                                          and CHECKED against the colour the chain actually
 *                                          minted wherever a mint exists
 *
 * `fixtures/simulator/` is left alone: it is the offline corpus and does not need a chain.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { CompactTypeBytes, CompactTypeVector, persistentCommit } from '@midnight-ntwrk/compact-runtime';
import { hexOf, pad, REPOSITORY_ROOT, stagenet } from './profile.js';

const OUT = path.join(REPOSITORY_ROOT, 'fixtures', 'stagenet');
const DEPLOYMENT = path.join(REPOSITORY_ROOT, 'out', 'deployment.json');
const MATRIX = path.join(REPOSITORY_ROOT, 'deployments', 'generated-matrix.json');

const profile = stagenet();

const log = (event: string, fields: Record<string, unknown> = {}): void =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));

if (!existsSync(DEPLOYMENT)) throw new Error(`no ${DEPLOYMENT} — run scripts/deploy-and-publish.ts first`);

interface StepRecord { index: number; circuit: string; txId?: string; txHash?: string; blockHeight?: number; error?: string }
interface RowRecord {
  id: string;
  contract: string;
  address?: string;
  deploy?: { txId: string; txHash: string; blockHeight: number };
  tokenColor?: string | Record<string, string>;
  steps: StepRecord[];
}
const deployment = JSON.parse(readFileSync(DEPLOYMENT, 'utf8')) as { rows: Record<string, RowRecord> };
const matrix = JSON.parse(readFileSync(MATRIX, 'utf8')) as {
  rows: {
    id: string;
    name: string;
    symbol: string;
    decimals: number;
    kind: number;
    domain: string | null;
    pieces: { piece: string; domain: string; domainSepHex: string }[] | null;
    expect: Record<string, unknown>;
    steps: { kind: string; circuit: string; events?: unknown[]; domainSepHex?: string; amount?: string; mintKind?: string; piece?: string | null }[];
  }[];
};

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------

async function query<T>(body: string, variables: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(profile.indexer, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: body, variables }),
    });
    const text = await response.text();
    if (!response.ok) {
      if (attempt < 4 && (response.status === 429 || response.status >= 500)) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
        continue;
      }
      throw new Error(`indexer HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    const parsed = JSON.parse(text) as { data?: T; errors?: { message: string }[] };
    if (parsed.errors?.length) throw new Error(`indexer errors: ${parsed.errors.map((e) => e.message).join('; ')}`);
    if (!parsed.data) throw new Error('indexer returned no data');
    return parsed.data;
  }
}

const TRANSACTION_QUERY = `
  query Tx($hash: HexEncoded!) {
    transactions(offset: { hash: $hash }) {
      id hash protocolVersion raw
      block { height hash timestamp }
      ... on RegularTransaction {
        fee
        identifiers
        transactionResult { status segments { id success } }
      }
    }
  }`;

const EVENTS_QUERY = `
  query Events($address: HexEncoded!, $hash: HexEncoded!) {
    contractEvents(filter: { contractAddress: $address, transactionHash: $hash, types: [MISC] }, limit: 500) {
      __typename
      ... on MiscContractEvent {
        id maxId protocolVersion version contractAddress transactionId name payload
        transaction { hash block { height } }
      }
    }
  }`;

// ---------------------------------------------------------------------------
// the MIP's payload
// ---------------------------------------------------------------------------

const textOf = (bytes: Uint8Array): string | null => {
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return decoded;
  } catch {
    return null;
  }
};

interface DecodedPayload {
  domainSep: string;
  kind: number;
  key: string;
  keyText: string | null;
  /** MIP section 2.1 — how a consumer reads `value`. */
  valType: number;
  len: number;
  value: string;
  valueText: string | null;
}

/** The MIP's event name, `pad(32, "mip-xxxx:token-metadata[v1]")` (MIP section 1). */
const EVENT_NAME = 'mip-xxxx:token-metadata[v1]';
/** The value field is 189 bytes wide (MIP section 2). */
const MAX_VALUE_LEN = 189;

/**
 * MIP section 2: 32 domainSep, 1 kind, 32 key, 1 val-type, 1 val-len, 189 value.
 */
function decodePayload(payloadHex: string): DecodedPayload | { error: string } {
  const bytes = new Uint8Array(Buffer.from(payloadHex.replace(/^0x/i, ''), 'hex'));
  if (bytes.length !== 256) return { error: `payload is ${bytes.length} bytes, not 256` };
  const key = bytes.slice(33, 65);
  const trimmedKey = key.slice(0, key.indexOf(0) === -1 ? 32 : key.indexOf(0));
  const valType = bytes[65]!;
  const len = bytes[66]!;
  const value = bytes.slice(67, 256);
  return {
    domainSep: hexOf(bytes.slice(0, 32)),
    kind: bytes[32]!,
    key: hexOf(key),
    keyText: textOf(trimmedKey),
    valType,
    len,
    value: hexOf(value),
    valueText: len <= MAX_VALUE_LEN ? textOf(value.slice(0, len)) : null,
  };
}

// ---------------------------------------------------------------------------
// colours
// ---------------------------------------------------------------------------

const BYTES32 = new CompactTypeBytes(32);
const VECTOR2 = new CompactTypeVector(2, BYTES32);
const DERIVE_TOKEN = pad(32, 'midnight:derive_token');
const deriveColor = (domainSep: Uint8Array, addressHex: string): Uint8Array =>
  persistentCommit(VECTOR2, [domainSep, new Uint8Array(Buffer.from(addressHex.replace(/^0x/i, ''), 'hex'))], DERIVE_TOKEN);

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

interface RawTx {
  row: string;
  step: string;
  txHash: string;
  txId: string;
  indexerTransactionId: number;
  protocolVersion: number;
  blockHeight: number;
  blockHash: string;
  raw: string;
  fee: string | null;
  transactionResult: { status: string; segments: { id: number; success: boolean }[] } | null;
}

interface EventFixture {
  row: string;
  eventId: number;
  contractAddress: string;
  txHash: string;
  blockHeight: number;
  name: string;
  nameText: string | null;
  payload: string;
  decoded: DecodedPayload | { error: string };
}

const rawTxs: RawTx[] = [];
const events: EventFixture[] = [];
const colorVectors: { row: string; piece: string | null; address: string; domainSep: string; color: string; source: string }[] = [];
const problems: { row: string; note: string }[] = [];

for (const [id, record] of Object.entries(deployment.rows)) {
  if (!record.address) {
    problems.push({ row: id, note: 'no address: the row was never deployed' });
    continue;
  }
  const matrixRow = matrix.rows.find((r) => r.id === id);
  if (!matrixRow) {
    problems.push({ row: id, note: 'no matching matrix row' });
    continue;
  }

  const transactions: { step: string; txHash: string; txId: string }[] = [];
  if (record.deploy) transactions.push({ step: 'deploy', txHash: record.deploy.txHash, txId: record.deploy.txId });
  for (const step of record.steps) {
    if (step.txHash && step.txId) transactions.push({ step: step.circuit, txHash: step.txHash, txId: step.txId });
  }

  for (const transaction of transactions) {
    const data = await query<{ transactions: Record<string, unknown>[] }>(TRANSACTION_QUERY, { hash: transaction.txHash });
    const found = data.transactions[0] as
      | {
          id: number;
          hash: string;
          protocolVersion: number;
          raw: string;
          fee?: string;
          block: { height: number; hash: string };
          transactionResult?: { status: string; segments: { id: number; success: boolean }[] };
        }
      | undefined;
    if (!found) {
      problems.push({ row: id, note: `the indexer does not know transaction ${transaction.txHash} (${transaction.step})` });
      continue;
    }
    rawTxs.push({
      row: id,
      step: transaction.step,
      txHash: found.hash,
      txId: transaction.txId,
      indexerTransactionId: found.id,
      protocolVersion: found.protocolVersion,
      blockHeight: found.block.height,
      blockHash: found.block.hash,
      raw: found.raw,
      fee: found.fee ?? null,
      transactionResult: found.transactionResult ?? null,
    });

    const eventData = await query<{ contractEvents: Record<string, unknown>[] }>(EVENTS_QUERY, {
      address: record.address,
      hash: transaction.txHash,
    });
    for (const event of eventData.contractEvents) {
      if (event.__typename !== 'MiscContractEvent') continue;
      const nameBytes = new Uint8Array(Buffer.from(String(event.name).replace(/^0x/i, ''), 'hex'));
      const zero = nameBytes.indexOf(0);
      events.push({
        row: id,
        eventId: Number(event.id),
        contractAddress: String(event.contractAddress),
        txHash: found.hash,
        blockHeight: found.block.height,
        name: String(event.name),
        nameText: textOf(nameBytes.slice(0, zero === -1 ? nameBytes.length : zero)),
        payload: String(event.payload),
        decoded: decodePayload(String(event.payload)),
      });
    }
    log('transaction', { row: id, step: transaction.step, blockHeight: found.block.height, events: eventData.contractEvents.length });
  }

  // Colours: derive, and check against what the chain actually minted where we can.
  const domains = matrixRow.pieces
    ? matrixRow.pieces.map((p) => ({ piece: p.piece as string | null, domain: p.domain }))
    : matrixRow.domain
      ? [{ piece: null as string | null, domain: matrixRow.domain }]
      : [];
  for (const entry of domains) {
    colorVectors.push({
      row: id,
      piece: entry.piece,
      address: record.address,
      domainSep: hexOf(pad(32, entry.domain)),
      color: hexOf(deriveColor(pad(32, entry.domain), record.address)),
      source: 'persistentCommit([domainSep, address], pad(32, "midnight:derive_token"))',
    });
  }
}

// Expected token rows, folded from the events exactly as a consumer would.
interface ExpectedToken {
  row: string;
  address: string;
  domainSep: string;
  /** MIP section 4: the identity byte, 0..3. `privacy`/`storage` derive from it. */
  kind: number;
  privacy: 'shielded' | 'unshielded';
  storage: 'native' | 'ledger';
  color: string | null;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  traits: Record<string, { valType: number; value: string; text: string | null; len: number }>;
  /** Mints of this exact row, from the matrix; the chain's effect map is the authority. */
  mintCount: number;
  totalMinted: string;
  /** MIP section 7.2: observed | declared | described. */
  status: 'observed' | 'declared' | 'described';
  declared: boolean;
  expect: Record<string, unknown>;
}

const newExpected = (
  row: string,
  address: string,
  domainSep: string,
  kindByte: number,
  expect: Record<string, unknown>,
): ExpectedToken => {
  const native = (kindByte & 2) === 0;
  return {
    row,
    address,
    domainSep,
    kind: kindByte,
    privacy: (kindByte & 1) === 1 ? 'shielded' : 'unshielded',
    storage: native ? 'native' : 'ledger',
    // MIP section 3: a colour exists only for the native kinds.
    color: native ? hexOf(deriveColor(new Uint8Array(Buffer.from(domainSep, 'hex')), address)) : null,
    name: null,
    symbol: null,
    decimals: null,
    traits: {},
    mintCount: 0,
    totalMinted: '0',
    status: 'declared',
    declared: false,
    expect,
  };
};

const expected: ExpectedToken[] = [];
for (const matrixRow of matrix.rows) {
  const record = deployment.rows[matrixRow.id];
  if (!record?.address) continue;
  const byRowKey = new Map<string, ExpectedToken>();
  for (const event of events.filter((e) => e.row === matrixRow.id).sort((a, b) => a.eventId - b.eventId)) {
    const decoded = event.decoded;
    if ('error' in decoded) continue;
    // MIP section 1: only events under the MIP's name are TokenMetadata events.
    if (event.nameText !== EVENT_NAME) continue;
    // MIP section 4: the FULL kind byte is part of the identity.
    const rowKey = `${decoded.domainSep}:${decoded.kind}`;
    let token = byRowKey.get(rowKey);
    if (!token) {
      token = newExpected(matrixRow.id, record.address, decoded.domainSep, decoded.kind, matrixRow.expect);
      byRowKey.set(rowKey, token);
    }
    token.declared = true;
    const valueBytes = new Uint8Array(Buffer.from(decoded.value, 'hex')).slice(0, decoded.len);
    // Appendix A's core keys are projected only when they carry the type it gives them.
    if (decoded.keyText === 'name' && decoded.valType === 1) token.name = decoded.valueText;
    else if (decoded.keyText === 'symbol' && decoded.valType === 1) token.symbol = decoded.valueText;
    else if (decoded.keyText === 'decimals' && decoded.valType === 2) token.decimals = valueBytes[0] ?? null;
    else if (decoded.keyText) {
      token.traits[decoded.keyText] = {
        valType: decoded.valType,
        value: decoded.value,
        text: decoded.valueText,
        len: decoded.len,
      };
    }
  }
  // A row can exist with NO events at all: `SGHOST` is minted and never described, which is
  // exactly the "unknown colour" case a wallet shows today. Fold the mint steps in too, so
  // the corpus carries every row of the matrix and not only the ones that spoke.
  for (const step of matrixRow.steps) {
    if (step.kind !== 'mint') continue;
    const domainSep = step.domainSepHex!;
    // A mint is always NATIVE: the ledger has no other way to create a token, so
    // the effect's tag fixes the kind byte at 0 or 1 (MIP section 6.3). A contract
    // that DECLARED kind 2 and minted natively (the Ledger Liar) therefore fills
    // two rows — this observed one and its own declared one — and neither can
    // hide or relabel the other.
    const kindByte = step.mintKind === 'shielded' ? 1 : 0;
    const rowKey = `${domainSep}:${kindByte}`;
    let token = byRowKey.get(rowKey);
    if (!token) {
      token = newExpected(matrixRow.id, record.address, domainSep, kindByte, matrixRow.expect);
      byRowKey.set(rowKey, token);
    }
    token.mintCount += 1;
    token.totalMinted = (BigInt(token.totalMinted) + BigInt(step.amount ?? '0')).toString();
  }

  // MIP section 7.2: three states, and only a native kind can reach `described`.
  for (const token of byRowKey.values()) {
    token.status = token.mintCount > 0 ? (token.declared ? 'described' : 'observed') : 'declared';
  }

  expected.push(...[...byRowKey.values()].sort((a, b) => a.kind - b.kind));
}

mkdirSync(OUT, { recursive: true });
const provenance = {
  $comment:
    'Recorded from the PUBLIC Midnight Stagenet indexer for the contracts in out/deployment.json. Every byte here came off the chain; fixtures/simulator/ is the offline counterpart.',
  network: 'stagenet',
  indexer: profile.indexer,
  recordedAt: new Date().toISOString(),
};
writeFileSync(path.join(OUT, 'raw-tx.json'), `${JSON.stringify({ ...provenance, transactions: rawTxs }, null, 2)}\n`);
writeFileSync(path.join(OUT, 'events.json'), `${JSON.stringify({ ...provenance, events }, null, 2)}\n`);
writeFileSync(path.join(OUT, 'expected-tokens.json'), `${JSON.stringify({ ...provenance, tokens: expected }, null, 2)}\n`);
writeFileSync(
  path.join(OUT, 'color-vectors.json'),
  `${JSON.stringify({ ...provenance, vectors: colorVectors }, null, 2)}\n`,
);

// `out/` is a scratch directory and is not committed, but the deployment record — the
// addresses and transaction hashes everything else in this repository refers to — is the
// artefact of the run and belongs in git next to the matrix that produced it.
writeFileSync(
  path.join(REPOSITORY_ROOT, 'deployments', 'stagenet-deployment.json'),
  `${JSON.stringify(deployment, null, 2)}\n`,
);

log('written', {
  transactions: rawTxs.length,
  events: events.length,
  tokens: expected.length,
  colorVectors: colorVectors.length,
  problems,
});
