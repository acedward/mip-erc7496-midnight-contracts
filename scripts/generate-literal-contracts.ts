/**
 * Generate one Compact contract per row of `deployments/reference-set.json`, with every
 * TokenMetadata payload written as a COMPILE-TIME LITERAL.
 *
 * Why (question Q13, decided 2026-09-17):
 *   A `Misc` event whose payload contains runtime bytes costs ~26 000 rows for a single
 *   runtime byte and 416 601 rows (k=19) for the three-field `publishMetadata` of the
 *   parameterised templates in `contracts/`. A k=19 proving key is 134 MB and takes about
 *   six minutes of `zkir`; the full template set is ~1.5 h and ~1.5 GB, and whether such a
 *   proof fits a 6 GiB proof server was never established.
 *   The same event with an all-literal payload is 23 rows (k=7): a 40 KB key generated in
 *   seconds. The bytes on the wire are IDENTICAL — the standard is unchanged, only these
 *   reference contracts choose to bake their own metadata in rather than take it at call
 *   time. The parameterised templates stay in `contracts/` as the reference implementation
 *   of the standard, with their measured cost documented in TOKEN-METADATA.md.
 *
 * What the generated contracts deliberately do NOT have:
 *   - `Ownable` (and therefore no witness, and therefore no private state at all): every
 *     update is a pre-written circuit, so there is no free-form setter to gate. This keeps
 *     the deploy script free of private-state plumbing.
 *   - `Opaque<"string">` metadata and the OpenZeppelin token modules: the generated
 *     contracts talk to the standard library directly, so they take no constructor
 *     arguments and every value in them is visible in the source.
 *
 * Usage:
 *   npx tsx scripts/generate-literal-contracts.ts            # every row
 *   npx tsx scripts/generate-literal-contracts.ts SSTAR UCOM # selected rows
 *
 * Writes `contracts/generated/<ID>.compact` and `deployments/generated-matrix.json`
 * (the step-by-step deployment plan `scripts/deploy-and-publish.ts` executes).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL(import.meta.url).pathname, '..', '..');
const REFERENCE_SET = path.join(ROOT, 'deployments', 'reference-set.json');
const OUT_CONTRACTS = path.join(ROOT, 'contracts', 'generated');
const OUT_MATRIX = path.join(ROOT, 'deployments', 'generated-matrix.json');

const KEY_SIZE = 32;
const VALUE_SIZE = 190;
const DOMAIN_SIZE = 32;

// ---------------------------------------------------------------------------
// the reference set as data
// ---------------------------------------------------------------------------

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
  expect: Record<string, unknown>;
  steps: Step[];
}

const referenceSet = JSON.parse(readFileSync(REFERENCE_SET, 'utf8')) as { rows: Row[] };

// ---------------------------------------------------------------------------
// bytes
// ---------------------------------------------------------------------------

const utf8 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'utf8'));

const padTo = (bytes: Uint8Array, size: number): Uint8Array => {
  if (bytes.length > size) {
    throw new Error(`value of ${bytes.length} bytes does not fit in ${size}`);
  }
  const out = new Uint8Array(size);
  out.set(bytes);
  return out;
};

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/**
 * A Compact literal for `size` bytes whose meaningful prefix is `text`.
 *
 * `pad(size, "…")` is used when the text is plain printable ASCII with nothing the Compact
 * lexer would have to escape, because it keeps the generated source readable. Anything else
 * (JSON with quotes, the "·" in the Constellations piece names, any non-ASCII byte) is
 * written as an explicit byte array, so the emitted bytes never depend on how the compiler
 * reads a string literal.
 */
const byteLiteral = (bytes: Uint8Array, size: number): string => {
  const padded = padTo(bytes, size);
  const meaningful = bytes;
  const simple =
    meaningful.every((b) => b >= 0x20 && b <= 0x7e && b !== 0x22 && b !== 0x5c);
  if (simple) {
    return `pad(${size}, "${Buffer.from(meaningful).toString('latin1')}")`;
  }
  if (meaningful.length === 0) return `pad(${size}, "")`;
  const items: string[] = [];
  for (const b of meaningful) items.push(`0x${b.toString(16).padStart(2, '0')}`);
  // Trailing NULs come from one `pad` spread rather than a wall of 0x00, exactly as
  // TokenMetadata.compact itself writes `Bytes[decimals_, ...pad(189, "")]`.
  if (meaningful.length < size) items.push(`...pad(${size - meaningful.length}, "")`);
  const lines: string[] = [];
  for (let i = 0; i < items.length; i += 12) {
    lines.push('    ' + items.slice(i, i + 12).join(', '));
  }
  return items.length <= 12 ? `Bytes[${items.join(', ')}]` : `Bytes[\n${lines.join(',\n')}\n  ]`;
};

// ---------------------------------------------------------------------------
// the events a row emits
// ---------------------------------------------------------------------------

interface Emit {
  /** the piece label for a collection row, otherwise null */
  piece: string | null;
  domain: string;
  domainSepHex: string;
  kind: number;
  key: string;
  /** the meaningful value bytes (before NUL padding to 190) */
  value: Uint8Array;
  valueHex: string;
  len: number;
  /** printable form for the matrix file */
  text: string | null;
}

const domainFor = (row: Row, piece?: string): string =>
  piece ? `cnst:${piece}` : (row.domain ?? `umbra:${row.symbol.toLowerCase()}`);

const makeEmit = (row: Row, key: string, value: Uint8Array, text: string | null, piece?: string): Emit => {
  if (value.length > VALUE_SIZE) {
    throw new Error(`${row.id}: value for "${key}" is ${value.length} bytes (max ${VALUE_SIZE})`);
  }
  const domain = domainFor(row, piece);
  return {
    piece: piece ?? null,
    domain,
    domainSepHex: hex(padTo(utf8(domain), DOMAIN_SIZE)),
    kind: row.kind,
    key,
    value,
    valueHex: hex(padTo(value, VALUE_SIZE)),
    len: value.length,
    text,
  };
};

const standardEmits = (row: Row, name: string, piece?: string): Emit[] => [
  makeEmit(row, 'name', utf8(name), name, piece),
  makeEmit(row, 'symbol', utf8(row.symbol), row.symbol, piece),
  makeEmit(row, 'decimals', new Uint8Array([row.decimals]), String(row.decimals), piece),
];

// ---------------------------------------------------------------------------
// grouping steps into circuits
// ---------------------------------------------------------------------------

type PlannedStep =
  | { kind: 'emit'; circuit: string; emits: Emit[]; sourceOps: string[] }
  | {
      kind: 'mint';
      circuit: string;
      mintKind: 'shielded' | 'unshielded';
      piece: string | null;
      domain: string;
      domainSepHex: string;
      to: string;
      amount: string;
      nonce: string | null;
    }
  | { kind: 'ledger'; circuit: string; op: string; to: string; amount: string };

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Walks a row's ordered steps and produces the ordered circuit calls the deployment makes.
 *
 * Consecutive metadata-emitting steps for the same token collapse into ONE circuit (they
 * are all literal, so N events cost ~8 rows each) — that is what turns SNEB's nine events
 * into a single transaction. A group is broken by a mint, by a change of token, and by a
 * key that the group has already emitted: re-emitting a key is the standard's update path
 * and the matrix wants those in later blocks.
 */
function planSteps(row: Row): PlannedStep[] {
  const planned: PlannedStep[] = [];
  let group: { emits: Emit[]; ops: string[]; piece: string | null; keys: Set<string>; publish: string | null } | null = null;
  let updateIndex = 0;

  const flush = (): void => {
    if (!group) return;
    const { emits, ops, piece, keys, publish } = group;
    let circuit: string;
    if (publish === 'publishMetadata') circuit = 'publishMetadata';
    else if (publish === 'publishUnshielded') circuit = 'publishUnshielded';
    else if (publish === 'publishShielded') circuit = 'publishShielded';
    else if (publish === 'publishPiece') circuit = `publish${capitalize(piece ?? '')}`;
    else if (keys.has('name')) circuit = `publishRename${piece ? capitalize(piece) : ''}`;
    else {
      updateIndex += 1;
      circuit = `update${piece ? capitalize(piece) : ''}${updateIndex}`;
    }
    planned.push({ kind: 'emit', circuit, emits, sourceOps: ops });
    group = null;
  };

  const push = (emits: Emit[], op: string, piece: string | null, publish: string | null): void => {
    const keys = new Set(emits.map((e) => e.key));
    if (group && (group.piece !== piece || emits.some((e) => group!.keys.has(e.key)) || publish !== null)) {
      flush();
    }
    if (!group) group = { emits: [], ops: [], piece, keys: new Set(), publish };
    group.emits.push(...emits);
    group.ops.push(op);
    for (const key of keys) group.keys.add(key);
  };

  for (const step of row.steps) {
    switch (step.op) {
      case 'publishMetadata':
        push(standardEmits(row, row.name), step.op, null, 'publishMetadata');
        break;
      case 'publishUnshielded':
        push(standardEmits({ ...row, kind: 0 }, row.name), step.op, null, 'publishUnshielded');
        break;
      case 'publishShielded':
        push(standardEmits({ ...row, kind: 1 }, row.name), step.op, null, 'publishShielded');
        break;
      case 'publishPiece':
        push(standardEmits(row, step.pieceName ?? row.name, step.piece), step.op, step.piece ?? null, 'publishPiece');
        break;
      case 'setMetadata':
        push([makeEmit(row, step.key!, utf8(step.value!), step.value!)], step.op, null, null);
        break;
      case 'setPieceTrait':
        push(
          [makeEmit(row, step.key!, utf8(step.value!), step.value!, step.piece)],
          step.op,
          step.piece ?? null,
          null,
        );
        break;
      case 'mint':
      case 'mintShielded':
      case 'mintUnshielded':
      case 'mintPiece': {
        flush();
        const piece = step.piece ?? null;
        const domain = domainFor(row, step.piece);
        const shielded =
          step.op === 'mintShielded' ||
          step.op === 'mintPiece' ||
          (step.op === 'mint' && (row.kind & 1) === 1);
        planned.push({
          kind: 'mint',
          circuit: step.op === 'mintPiece' ? 'mintPiece' : step.op === 'mint' ? 'mint' : step.op,
          mintKind: shielded ? 'shielded' : 'unshielded',
          piece,
          domain,
          domainSepHex: hex(padTo(utf8(domain), DOMAIN_SIZE)),
          to: step.to ?? 'owner',
          amount: step.amount ?? '1',
          nonce: step.nonce ?? null,
        });
        break;
      }
      case 'ledgerMint':
      case 'transfer':
        flush();
        planned.push({
          kind: 'ledger',
          circuit: step.op === 'ledgerMint' ? 'ledgerMint' : 'transfer',
          op: step.op,
          to: step.to ?? 'owner',
          amount: step.amount ?? '0',
        });
        break;
      default:
        throw new Error(`${row.id}: unknown step op "${step.op}"`);
    }
  }
  flush();
  return planned;
}

// ---------------------------------------------------------------------------
// Compact source
// ---------------------------------------------------------------------------

const emitCall = (emit: Emit): string => {
  const domain = byteLiteral(utf8(emit.domain), DOMAIN_SIZE);
  const key = byteLiteral(utf8(emit.key), KEY_SIZE);
  const value = byteLiteral(emit.value, VALUE_SIZE);
  return `  // ${emit.piece ? `${emit.piece}: ` : ''}${emit.key} = ${
    emit.text === null ? '<bytes>' : JSON.stringify(emit.text)
  } (len ${emit.len})
  TM_emitTokenMetadata(${domain}, ${emit.kind}, ${key}, ${emit.len}, ${value});`;
};

const emitCircuit = (step: Extract<PlannedStep, { kind: 'emit' }>, guard: string | null): string => {
  const body = step.emits.map(emitCall).join('\n');
  const guarded = guard
    ? `  assert(!${guard}, "TokenMetadata: already published");\n  ${guard} = true;\n`
    : '';
  return `/**
 * @description ${step.sourceOps.join(' + ')} — ${step.emits.length} TokenMetadata event${
    step.emits.length === 1 ? '' : 's'
  }, every byte a compile-time literal.
 */
export circuit ${step.circuit}(): [] {
${guarded}${body}
}`;
};

const HEADER = (row: Row, planned: PlannedStep[]): string => `// SPDX-License-Identifier: Apache-2.0
//
// GENERATED FILE — do not edit. Produced by scripts/generate-literal-contracts.ts from
// deployments/reference-set.json row "${row.id}" (${row.name}).
//
// ${row.name} (${row.symbol}), ${row.decimals} decimals, kind byte ${row.kind}, template
// ${row.template}. Every TokenMetadata payload below is a compile-time literal, so each
// emitting circuit costs about eight rows per event (k=7) instead of the ~120 000 rows per
// runtime event the parameterised templates in contracts/ pay — see TOKEN-METADATA.md
// "Circuit cost" and question Q13. The bytes emitted are exactly the standard's bytes.
//
// Circuits the deployment calls, in order:
${planned.map((s) => `//   ${s.circuit}${s.kind === 'emit' ? ` (${s.emits.length} event${s.emits.length === 1 ? '' : 's'})` : ''}`).join('\n')}

pragma language_version >= 0.26.0;

import CompactStandardLibrary;
import "../TokenMetadata" prefix TM_;
`;

function generateNativeSingle(row: Row, planned: PlannedStep[], shielded: boolean): string {
  const domain = domainFor(row);
  const domainLiteral = byteLiteral(utf8(domain), DOMAIN_SIZE);
  const emits = planned.filter((s): s is Extract<PlannedStep, { kind: 'emit' }> => s.kind === 'emit');
  const hasPublish = emits.some((s) => s.circuit === 'publishMetadata');
  const mintCircuit = shielded
    ? `/**
 * @description Mints \`amount\` of this token to \`recipient\` as a shielded coin.
 * @param {Bytes<32>} nonce - Caller-supplied and unique per mint.
 */
export circuit mint(
  recipient: Either<ZswapCoinPublicKey, ContractAddress>,
  amount: Uint<64>,
  nonce: Bytes<32>
): ShieldedCoinInfo {
  assert(amount > 0, "amount must be positive");
  _mints.increment(1);
  return mintShieldedToken(${domainLiteral}, disclose(amount), disclose(nonce), disclose(recipient));
}`
    : `/**
 * @description Mints \`amount\` of this token to \`recipient\` as an unshielded UTxO.
 * @return {Bytes<32>} - The colour actually minted.
 */
export circuit mint(
  recipient: Either<ContractAddress, UserAddress>,
  amount: Uint<64>
): Bytes<32> {
  assert(amount > 0, "amount must be positive");
  _mints.increment(1);
  return mintUnshieldedToken(${domainLiteral}, disclose(amount), disclose(recipient));
}`;

  const exports = shielded
    ? 'export { ContractAddress, Either, Maybe, ShieldedCoinInfo, ZswapCoinPublicKey };'
    : 'export { ContractAddress, Either, Maybe, UserAddress };';

  return `${HEADER(row, planned)}
${exports}

${hasPublish ? '/** True once `publishMetadata` has run; it may run only once. */\nexport ledger _published: Boolean;\n' : ''}/** How many mints this contract has made, for a cheap read-back after deployment. */
export ledger _mints: Counter;

/** The domain separator this contract mints and describes under. */
export circuit domainSep(): Bytes<32> {
  return ${domainLiteral};
}

/** The token's colour: \`tokenType(domainSep, this contract)\`. */
export circuit tokenColor(): Bytes<32> {
  return tokenType(${domainLiteral}, kernel.self());
}

/** The kind byte this contract declares (see ../../TOKEN-METADATA.md section 3). */
export circuit kind(): Uint<8> {
  return ${row.kind};
}

export circuit decimals(): Uint<8> {
  return ${row.decimals};
}

export circuit mints(): Uint<64> {
  return _mints.read() as Uint<64>;
}

${emits
  .map((s) => emitCircuit(s, s.circuit === 'publishMetadata' ? '_published' : null))
  .join('\n\n')}

${mintCircuit}
`;
}

function generateDual(row: Row, planned: PlannedStep[]): string {
  const domain = domainFor(row);
  const domainLiteral = byteLiteral(utf8(domain), DOMAIN_SIZE);
  const emits = planned.filter((s): s is Extract<PlannedStep, { kind: 'emit' }> => s.kind === 'emit');
  return `${HEADER(row, planned)}
export { ContractAddress, Either, Maybe, ShieldedCoinInfo, UserAddress, ZswapCoinPublicKey };

/** One guard per kind: the two halves of this token are published separately. */
export ledger _publishedUnshielded: Boolean;
export ledger _publishedShielded: Boolean;
export ledger _mints: Counter;

/** The one domain separator both kinds of this token share. */
export circuit domainSep(): Bytes<32> {
  return ${domainLiteral};
}

/** The colour both kinds share: \`tokenType(domainSep, this contract)\`. */
export circuit tokenColor(): Bytes<32> {
  return tokenType(${domainLiteral}, kernel.self());
}

export circuit decimals(): Uint<8> {
  return ${row.decimals};
}

export circuit mints(): Uint<64> {
  return _mints.read() as Uint<64>;
}

${emits
  .map((s) =>
    emitCircuit(
      s,
      s.circuit === 'publishUnshielded'
        ? '_publishedUnshielded'
        : s.circuit === 'publishShielded'
          ? '_publishedShielded'
          : null,
    ),
  )
  .join('\n\n')}

/** Mints the shielded half of this token (kind byte 1). */
export circuit mintShielded(
  recipient: Either<ZswapCoinPublicKey, ContractAddress>,
  amount: Uint<64>,
  nonce: Bytes<32>
): ShieldedCoinInfo {
  assert(amount > 0, "amount must be positive");
  _mints.increment(1);
  return mintShieldedToken(${domainLiteral}, disclose(amount), disclose(nonce), disclose(recipient));
}

/** Mints the unshielded half of this token (kind byte 0), same colour. */
export circuit mintUnshielded(
  recipient: Either<ContractAddress, UserAddress>,
  amount: Uint<64>
): Bytes<32> {
  assert(amount > 0, "amount must be positive");
  _mints.increment(1);
  return mintUnshieldedToken(${domainLiteral}, disclose(amount), disclose(recipient));
}
`;
}

function generateCollection(row: Row, planned: PlannedStep[]): string {
  const emits = planned.filter((s): s is Extract<PlannedStep, { kind: 'emit' }> => s.kind === 'emit');
  return `${HEADER(row, planned)}
export { ContractAddress, Either, Maybe, ShieldedCoinInfo, ZswapCoinPublicKey };

/** How many pieces have been minted, for a cheap read-back after deployment. */
export ledger _mintedPieces: Counter;

/**
 * @description The colour of one piece: \`tokenType(pieceDomain, this contract)\`. The
 * domain is a call argument, which is what makes this one address many tokens — the
 * ERC-1155 / EIP-7496 shape. Only the metadata payloads are literal.
 */
export circuit tokenColor(pieceDomain: Bytes<32>): Bytes<32> {
  return tokenType(disclose(pieceDomain), kernel.self());
}

export circuit decimals(): Uint<8> {
  return ${row.decimals};
}

export circuit mintedPieces(): Uint<64> {
  return _mintedPieces.read() as Uint<64>;
}

/**
 * @description Mints one unit of the piece identified by \`pieceDomain\`. No event: the
 * mint is public in the transaction's effects, which is what the indexer reads.
 * @param {Bytes<32>} nonce - Caller-supplied, unique per (piece, mint).
 */
export circuit mintPiece(
  pieceDomain: Bytes<32>,
  recipient: Either<ZswapCoinPublicKey, ContractAddress>,
  nonce: Bytes<32>
): ShieldedCoinInfo {
  _mintedPieces.increment(1);
  return mintShieldedToken(disclose(pieceDomain), 1, disclose(nonce), disclose(recipient));
}

${emits.map((s) => emitCircuit(s, null)).join('\n\n')}
`;
}

function generateLedger(row: Row, planned: PlannedStep[]): string {
  const emits = planned.filter((s): s is Extract<PlannedStep, { kind: 'emit' }> => s.kind === 'emit');
  const domainLiteral = byteLiteral(utf8(domainFor(row)), DOMAIN_SIZE);
  return `${HEADER(row, planned)}
export { ContractAddress, Either, Maybe };

/**
 * Balances live in contract state, not in UTxOs — that is what kind bit 1 declares. The
 * accounting is deliberately minimal: a ledger token is invisible to a mint scanner, so
 * the only thing this contract owes the indexer is its TokenMetadata events.
 */
export ledger _balances: Map<Bytes<32>, Uint<128>>;
export ledger _totalSupply: Uint<128>;
/** True once \`publishMetadata\` has run; it may run only once. */
export ledger _published: Boolean;

/** The 32 bytes this contract uses as its token id (any value the contract chooses). */
export circuit domainSep(): Bytes<32> {
  return ${domainLiteral};
}

/** The kind byte this contract declares: ${row.kind} — see ../../TOKEN-METADATA.md section 3. */
export circuit kind(): Uint<8> {
  return ${row.kind};
}

export circuit decimals(): Uint<8> {
  return ${row.decimals};
}

export circuit totalSupply(): Uint<128> {
  return _totalSupply;
}

export circuit balanceOf(account: Bytes<32>): Uint<128> {
  if (!_balances.member(disclose(account))) {
    return 0;
  }
  return _balances.lookup(disclose(account));
}

/** Creates \`amount\` of this token in \`account\`'s contract-state balance. */
export circuit ledgerMint(account: Bytes<32>, amount: Uint<128>): [] {
  assert(amount > 0, "amount must be positive");
  const prior = _balances.member(disclose(account)) ? _balances.lookup(disclose(account)) : 0;
  _balances.insert(disclose(account), (prior + disclose(amount)) as Uint<128>);
  _totalSupply = (_totalSupply + disclose(amount)) as Uint<128>;
}

/** Moves \`amount\` from one contract-state balance to another. \`from\` is a Compact keyword. */
export circuit transfer(sender: Bytes<32>, recipient: Bytes<32>, amount: Uint<128>): [] {
  const available = _balances.member(disclose(sender)) ? _balances.lookup(disclose(sender)) : 0;
  assert(available >= amount, "insufficient balance");
  _balances.insert(disclose(sender), (available - disclose(amount)) as Uint<128>);
  const prior = _balances.member(disclose(recipient)) ? _balances.lookup(disclose(recipient)) : 0;
  _balances.insert(disclose(recipient), (prior + disclose(amount)) as Uint<128>);
}

${emits
  .map((s) => emitCircuit(s, s.circuit === 'publishMetadata' ? '_published' : null))
  .join('\n\n')}
`;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const selected = process.argv.slice(2);
const rows = referenceSet.rows.filter((row) => selected.length === 0 || selected.includes(row.id));
if (selected.length > 0 && rows.length !== selected.length) {
  const missing = selected.filter((id) => !rows.some((row) => row.id === id));
  throw new Error(`unknown row id(s): ${missing.join(', ')}`);
}

mkdirSync(OUT_CONTRACTS, { recursive: true });

const matrixRows: unknown[] = [];

for (const row of rows) {
  const planned = planSteps(row);
  let source: string;
  switch (row.template) {
    case 'NativeShieldedToken':
      source = generateNativeSingle(row, planned, true);
      break;
    case 'NativeUnshieldedToken':
      source = generateNativeSingle(row, planned, (row.kind & 1) === 1);
      break;
    case 'NativeDualToken':
      source = generateDual(row, planned);
      break;
    case 'ShieldedCollection':
      source = generateCollection(row, planned);
      break;
    case 'LedgerToken':
      source = generateLedger(row, planned);
      break;
    default:
      throw new Error(`${row.id}: unknown template "${row.template}"`);
  }
  const file = path.join(OUT_CONTRACTS, `${row.id}.compact`);
  writeFileSync(file, source, 'utf8');
  const eventCount = planned.reduce((n, s) => n + (s.kind === 'emit' ? s.emits.length : 0), 0);
  console.log(
    `${row.id.padEnd(7)} ${row.template.padEnd(22)} ${String(planned.length).padStart(2)} transactions, ${String(
      eventCount,
    ).padStart(2)} events  -> contracts/generated/${row.id}.compact`,
  );

  matrixRows.push({
    id: row.id,
    contract: row.id,
    template: row.template,
    name: row.name,
    symbol: row.symbol,
    decimals: row.decimals,
    kind: row.kind,
    optional: row.optional === true,
    domain: row.pieces ? null : domainFor(row),
    domainSepHex: row.pieces ? null : hex(padTo(utf8(domainFor(row)), DOMAIN_SIZE)),
    pieces: row.pieces
      ? row.pieces.map((piece) => ({
          piece,
          domain: domainFor(row, piece),
          domainSepHex: hex(padTo(utf8(domainFor(row, piece)), DOMAIN_SIZE)),
        }))
      : null,
    expect: row.expect,
    steps: planned.map((step) =>
      step.kind === 'emit'
        ? {
            kind: 'emit',
            circuit: step.circuit,
            sourceOps: step.sourceOps,
            events: step.emits.map((e) => ({
              piece: e.piece,
              domainSep: e.domainSepHex,
              kind: e.kind,
              key: e.key,
              len: e.len,
              value: e.valueHex,
              text: e.text,
            })),
          }
        : step,
    ),
  });
}

writeFileSync(
  OUT_MATRIX,
  `${JSON.stringify(
    {
      $comment:
        'GENERATED by scripts/generate-literal-contracts.ts. The ordered on-chain plan for each row of deployments/reference-set.json: which generated contract to deploy, which circuit each step calls, and the exact TokenMetadata bytes that step emits. scripts/deploy-and-publish.ts executes it and scripts/export-fixtures.ts checks the chain against it.',
      generatedAt: new Date().toISOString(),
      rows: matrixRows,
    },
    null,
    2,
  )}\n`,
  'utf8',
);
console.log(`\nwrote ${path.relative(ROOT, OUT_MATRIX)} (${matrixRows.length} rows)`);
