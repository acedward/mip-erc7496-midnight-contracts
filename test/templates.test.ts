/**
 * The five reference templates, exercised in the Compact simulator.
 *
 * What these tests are for:
 *  - every template emits exactly the events ../TOKEN-METADATA.md prescribes,
 *    with the right kind byte;
 *  - the colour an outside observer derives from `(domainSep, address)` equals
 *    the colour the contract mints — the check the indexer performs (spec §6.4)
 *    and MIP-0011/0014's mandatory re-derivation;
 *  - the mint effects a scanner reads from a transcript appear where expected,
 *    and a ledger token produces none at all;
 *  - access control holds: publish-once really is once, and only the owner can
 *    update metadata.
 */
import { describe, expect, it } from 'vitest';
import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentCommit,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { Contract as NativeShielded } from '../contracts/managed/NativeShieldedToken/contract/index.js';
import { Contract as NativeUnshielded } from '../contracts/managed/NativeUnshieldedToken/contract/index.js';
import { Contract as NativeDual } from '../contracts/managed/NativeDualToken/contract/index.js';
import { Contract as Collection } from '../contracts/managed/ShieldedCollection/contract/index.js';
import { Contract as LedgerTokenContract } from '../contracts/managed/LedgerToken/contract/index.js';
import {
  KIND_LEDGER_FLAG,
  KIND_SHIELDED,
  KIND_UNSHIELDED,
  MAX_VALUE_LEN,
  deploy,
  hex,
  pad,
} from './token-metadata.js';

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------

type OwnerState = { secretKey: Uint8Array };

const BYTES32 = new CompactTypeBytes(32);
const VECTOR2_BYTES32 = new CompactTypeVector(2, BYTES32);
const DERIVE_TOKEN = pad(32, 'midnight:derive_token');

const OWNER_SK = new Uint8Array(32).fill(7);
const STRANGER_SK = new Uint8Array(32).fill(9);

/** OpenZeppelin `Utils.computeAccountId`: `persistentHash<Vector<1,Bytes<32>>>([sk])`. */
function accountId(secretKey: Uint8Array): Uint8Array {
  return persistentHash(new CompactTypeVector(1, BYTES32), [secretKey]);
}

function ownerOf(secretKey: Uint8Array) {
  return { is_left: true, left: accountId(secretKey), right: { bytes: new Uint8Array(32) } };
}

const ownableWitnesses = {
  wit_OwnableSK: ({ privateState }: { privateState: OwnerState }): [OwnerState, Uint8Array] => [
    privateState,
    privateState.secretKey,
  ],
};

/**
 * What an outside observer computes from a transaction alone:
 * `persistentCommit([domainSep, address], pad(32, "midnight:derive_token"))`
 * (coin-structure `contract.rs`, and the standard library's `tokenType`).
 */
function deriveColor(domainSep: Uint8Array, contractAddress: string): Uint8Array {
  const addressBytes = Uint8Array.from(Buffer.from(contractAddress, 'hex'));
  return persistentCommit(VECTOR2_BYTES32, [domainSep, addressBytes], DERIVE_TOKEN);
}

/** UTF-8 byte length — not the character count, which is what `len` must carry. */
function byteLen(text: string): bigint {
  return BigInt(new TextEncoder().encode(text).length);
}

function value190(text: string): Uint8Array {
  const out = new Uint8Array(MAX_VALUE_LEN);
  out.set(new TextEncoder().encode(text));
  return out;
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

const account = (label: string) => ({
  is_left: true,
  left: pad(32, label),
  right: { bytes: new Uint8Array(32) },
});

/** The mint effect maps a scanner reads out of a transcript. */
const mintValues = (effects: any, which: 'shieldedMints' | 'unshieldedMints') =>
  [...(effects[which]?.values() ?? [])];

// --------------------------------------------------------------------------
// NativeShieldedToken — spec §7.1 rows 4-6 (Shielded Star / Nebula / Ghost)
// --------------------------------------------------------------------------

const SSTAR_DOMAIN = pad(32, 'umbra:sstar');

async function shieldedToken(secretKey = OWNER_SK) {
  return deploy<OwnerState>(
    new NativeShielded<OwnerState>(ownableWitnesses),
    { secretKey },
    [
      ownerOf(OWNER_SK),
      SSTAR_DOMAIN,
      'Shielded Star',
      pad(32, 'Shielded Star'),
      13n,
      'SSTAR',
      pad(16, 'SSTAR'),
      5n,
      6n,
    ],
  );
}

describe('NativeShieldedToken', () => {
  it('publishes name, symbol and decimals as three shielded-kind events', async () => {
    const c = await shieldedToken();
    const { events } = await c.call('publishMetadata');

    expect(events).toHaveLength(3);
    expect(events.map((e) => [e.keyText, e.valueText])).toEqual([
      ['name', 'Shielded Star'],
      ['symbol', 'SSTAR'],
      ['decimals', ''],
    ]);
    for (const event of events) {
      expect(event.eventName).toBe('TokenMetadata');
      expect(event.kind).toBe(KIND_SHIELDED);
      expect(hex(event.domainSep)).toBe(hex(SSTAR_DOMAIN));
      expect(event.payload).toHaveLength(256);
    }
    expect(events[2].valueBytes[0]).toBe(6); // decimals is one byte, not text
  });

  it('refuses to publish twice', async () => {
    const c = await shieldedToken();
    await c.call('publishMetadata');
    await expect(c.call('publishMetadata')).rejects.toThrow(/already published/);
  });

  it('mints the colour an outside observer derives from (domainSep, address)', async () => {
    const c = await shieldedToken();
    const { result: circuitColor } = await c.call('tokenColor');
    const derived = deriveColor(SSTAR_DOMAIN, c.address);
    expect(hex(circuitColor as Uint8Array)).toBe(hex(derived));

    const nonce = pad(32, 'sstar-mint-1');
    const { result, effects } = await c.call('mint', zswapRecipient('holder-1'), 5_000_000n, nonce);
    const coin = result as { nonce: Uint8Array; color: Uint8Array; value: bigint };
    expect(hex(coin.color)).toBe(hex(derived));
    expect(coin.value).toBe(5_000_000n);
    expect(mintValues(effects, 'shieldedMints')).toEqual([5_000_000n]);
    expect(mintValues(effects, 'unshieldedMints')).toEqual([]);
  });

  it('lets the owner update a key and nobody else', async () => {
    const c = await shieldedToken();
    const { events } = await c.call(
      'setMetadata',
      pad(32, 'name'),
      byteLen('Shielded Star!'),
      value190('Shielded Star!'),
    );
    expect(events).toHaveLength(1);
    expect(events[0].keyText).toBe('name');
    expect(events[0].len).toBe(14);
    expect(events[0].valueText).toBe('Shielded Star!');
    expect(events[0].kind).toBe(KIND_SHIELDED);

    const stranger = await shieldedToken(STRANGER_SK);
    await expect(
      stranger.call('setMetadata', pad(32, 'name'), 4n, value190('mine')),
    ).rejects.toThrow(/not the owner/);
  });

  it('keeps the OpenZeppelin metadata circuits working beside the events', async () => {
    const c = await shieldedToken();
    expect((await c.call('name')).result).toBe('Shielded Star');
    expect((await c.call('symbol')).result).toBe('SSTAR');
    expect((await c.call('decimals')).result).toBe(6n);
    expect(hex((await c.call('domainSep')).result as Uint8Array)).toBe(hex(SSTAR_DOMAIN));
  });
});

// --------------------------------------------------------------------------
// NativeUnshieldedToken — spec §7.1 rows 7-9 and the "Ledger Liar" row 12
// --------------------------------------------------------------------------

const UCOM_DOMAIN = pad(32, 'umbra:ucom');

async function unshieldedToken(kind = KIND_UNSHIELDED, secretKey = OWNER_SK) {
  return deploy<OwnerState>(
    new NativeUnshielded<OwnerState>(ownableWitnesses),
    { secretKey },
    [
      ownerOf(OWNER_SK),
      UCOM_DOMAIN,
      pad(32, 'Unshielded Comet'),
      16n,
      pad(16, 'UCOM'),
      4n,
      6n,
      BigInt(kind),
    ],
  );
}

describe('NativeUnshieldedToken', () => {
  it('publishes with the unshielded kind byte and mints an unshielded effect', async () => {
    const c = await unshieldedToken();
    const { events } = await c.call('publishMetadata');
    expect(events.map((e) => e.keyText)).toEqual(['name', 'symbol', 'decimals']);
    expect(events.every((e) => e.kind === KIND_UNSHIELDED)).toBe(true);
    expect(events[0].valueText).toBe('Unshielded Comet');

    const { result, effects } = await c.call('mint', userRecipient('holder-2'), 1_000n);
    expect(hex(result as Uint8Array)).toBe(hex(deriveColor(UCOM_DOMAIN, c.address)));
    expect(mintValues(effects, 'unshieldedMints')).toEqual([1_000n]);
    expect(mintValues(effects, 'shieldedMints')).toEqual([]);
  });

  it('rejects a zero amount and a zero recipient', async () => {
    const c = await unshieldedToken();
    await expect(c.call('mint', userRecipient('holder-2'), 0n)).rejects.toThrow(/positive/);
    await expect(
      c.call(
        'mint',
        { is_left: false, left: { bytes: new Uint8Array(32) }, right: { bytes: new Uint8Array(32) } },
        1n,
      ),
    ).rejects.toThrow(/invalid recipient/);
  });

  it('can be deployed as the deliberate liar: declares ledger, mints natively', async () => {
    const c = await unshieldedToken(KIND_LEDGER_FLAG);
    const { events } = await c.call('publishMetadata');
    expect(events.every((e) => e.kind === KIND_LEDGER_FLAG)).toBe(true);

    // ...and it still mints for real, which is exactly the contradiction the
    // indexer must flag as `inconsistent` rather than believe.
    const { effects } = await c.call('mint', userRecipient('holder-3'), 42n);
    expect(mintValues(effects, 'unshieldedMints')).toEqual([42n]);
  });
});

// --------------------------------------------------------------------------
// NativeDualToken — spec §7.1 row 10 (Dual Aurora)
// --------------------------------------------------------------------------

const DAUR_DOMAIN = pad(32, 'umbra:daur');

async function dualToken(secretKey = OWNER_SK) {
  return deploy<OwnerState>(
    new NativeDual<OwnerState>(ownableWitnesses),
    { secretKey },
    [
      ownerOf(OWNER_SK),
      DAUR_DOMAIN,
      pad(32, 'Dual Aurora'),
      11n,
      pad(16, 'DAUR'),
      4n,
      6n,
    ],
  );
}

describe('NativeDualToken', () => {
  it('publishes each kind separately, three events at a time', async () => {
    const c = await dualToken();
    const unshielded = await c.call('publishUnshielded');
    const shielded = await c.call('publishShielded');

    expect(unshielded.events).toHaveLength(3);
    expect(shielded.events).toHaveLength(3);
    expect(unshielded.events.every((e) => e.kind === KIND_UNSHIELDED)).toBe(true);
    expect(shielded.events.every((e) => e.kind === KIND_SHIELDED)).toBe(true);
    // One domain separator, so one colour value, described twice.
    expect(hex(unshielded.events[0].domainSep)).toBe(hex(shielded.events[0].domainSep));

    await expect(c.call('publishUnshielded')).rejects.toThrow(/already published/);
    await expect(c.call('publishShielded')).rejects.toThrow(/already published/);
  });

  it('mints one colour in two value domains', async () => {
    const c = await dualToken();
    const expected = deriveColor(DAUR_DOMAIN, c.address);
    expect(hex((await c.call('tokenColor')).result as Uint8Array)).toBe(hex(expected));

    const shielded = await c.call('mintShielded', zswapRecipient('holder-4'), 10n, pad(32, 'daur-1'));
    expect(hex((shielded.result as { color: Uint8Array }).color)).toBe(hex(expected));
    expect(mintValues(shielded.effects, 'shieldedMints')).toEqual([10n]);

    const unshielded = await c.call('mintUnshielded', userRecipient('holder-5'), 20n);
    expect(hex(unshielded.result as Uint8Array)).toBe(hex(expected));
    expect(mintValues(unshielded.effects, 'unshieldedMints')).toEqual([20n]);
  });

  it('updates one kind at a time', async () => {
    const c = await dualToken();
    const { events } = await c.call(
      'setMetadata',
      BigInt(KIND_SHIELDED),
      pad(32, 'description'),
      6n,
      value190('aurora'),
    );
    expect(events[0].kind).toBe(KIND_SHIELDED);
    expect(events[0].keyText).toBe('description');
    expect(events[0].valueText).toBe('aurora');
  });
});

// --------------------------------------------------------------------------
// ShieldedCollection — spec §7.1 row 11 (Constellations)
// --------------------------------------------------------------------------

const PIECES = ['orion', 'lyra', 'cygnus'] as const;

async function collection(secretKey = OWNER_SK) {
  return deploy<OwnerState>(
    new Collection<OwnerState>(ownableWitnesses),
    { secretKey },
    [ownerOf(OWNER_SK), 'Constellations', 'CNST', pad(16, 'CNST'), 4n, 0n],
  );
}

describe('ShieldedCollection', () => {
  it('gives every piece its own colour at one address', async () => {
    const c = await collection();
    const colors: string[] = [];

    for (const piece of PIECES) {
      const domain = pad(32, `cnst:${piece}`);
      const derived = deriveColor(domain, c.address);
      expect(hex((await c.call('tokenColor', domain)).result as Uint8Array)).toBe(hex(derived));

      const { result, effects } = await c.call(
        'mintPiece',
        domain,
        zswapRecipient(`collector-${piece}`),
        pad(32, `cnst:${piece}:1`),
      );
      const coin = result as { color: Uint8Array; value: bigint };
      expect(hex(coin.color)).toBe(hex(derived));
      expect(coin.value).toBe(1n); // one of each piece
      expect(mintValues(effects, 'shieldedMints')).toEqual([1n]);
      colors.push(hex(coin.color));
    }

    expect(new Set(colors).size).toBe(PIECES.length);
    expect((await c.call('mintedPieces')).result).toBe(BigInt(PIECES.length));
  });

  it('describes a piece with its own name and the family symbol and decimals', async () => {
    const c = await collection();
    const domain = pad(32, 'cnst:orion');
    const pieceName = 'Constellations · Orion'; // the middle dot is 2 UTF-8 bytes
    const { events } = await c.call('publishPiece', domain, pad(32, pieceName), byteLen(pieceName));

    expect(events).toHaveLength(3);
    expect(events.map((e) => e.keyText)).toEqual(['name', 'symbol', 'decimals']);
    expect(events[0].valueText).toBe(pieceName);
    expect(events[1].valueText).toBe('CNST');
    expect(events[2].valueBytes[0]).toBe(0);
    expect(events.every((e) => hex(e.domainSep) === hex(domain))).toBe(true);
    expect(events.every((e) => e.kind === KIND_SHIELDED)).toBe(true);
  });

  it('carries the tokenUri and arbitrary traits per piece, owner only', async () => {
    const c = await collection();
    const domain = pad(32, 'cnst:orion');
    const uri = 'http://localhost:10020/constellations/orion';

    const published = await c.call('setPieceTrait', domain, pad(32, 'tokenUri'), byteLen(uri), value190(uri));
    expect(published.events[0].keyText).toBe('tokenUri');
    expect(published.events[0].valueText).toBe(uri);

    // EIP-7496 dynamic trait: the last write is the one that counts.
    const first = await c.call('setPieceTrait', domain, pad(32, 'magnitude'), 4n, value190('1.25'));
    const second = await c.call('setPieceTrait', domain, pad(32, 'magnitude'), 4n, value190('0.50'));
    expect(first.events[0].valueText).toBe('1.25');
    expect(second.events[0].valueText).toBe('0.50');

    const stranger = await collection(STRANGER_SK);
    await expect(
      stranger.call('setPieceTrait', domain, pad(32, 'magnitude'), 1n, value190('9')),
    ).rejects.toThrow(/not the owner/);
    await expect(
      stranger.call('publishPiece', domain, pad(32, 'Stolen'), 6n),
    ).rejects.toThrow(/not the owner/);
  });
});

// --------------------------------------------------------------------------
// LedgerToken — spec §7.1 rows 1-2 (Ledger Sun / Ledger Moon)
// --------------------------------------------------------------------------

const LSUN_DOMAIN = pad(32, 'umbra:lsun');

async function ledgerToken(secretKey = OWNER_SK) {
  return deploy<OwnerState>(
    new LedgerTokenContract<OwnerState>({
      ...ownableWitnesses,
      wit_FungibleTokenSK: ({ privateState }: { privateState: OwnerState }): [OwnerState, Uint8Array] => [
        privateState,
        privateState.secretKey,
      ],
    } as never),
    { secretKey },
    [
      ownerOf(OWNER_SK),
      LSUN_DOMAIN,
      'Ledger Sun',
      pad(32, 'Ledger Sun'),
      10n,
      'LSUN',
      pad(16, 'LSUN'),
      4n,
      6n,
    ],
  );
}

describe('LedgerToken', () => {
  it('publishes with the ledger kind byte — the only way this token can be seen', async () => {
    const c = await ledgerToken();
    const { events, effects } = await c.call('publishMetadata');

    expect(events).toHaveLength(3);
    expect(events.every((e) => e.kind === KIND_LEDGER_FLAG)).toBe(true);
    expect(events[0].valueText).toBe('Ledger Sun');
    expect(hex(events[0].domainSep)).toBe(hex(LSUN_DOMAIN));
    // Nothing is minted at the protocol level, ever.
    expect(mintValues(effects, 'shieldedMints')).toEqual([]);
    expect(mintValues(effects, 'unshieldedMints')).toEqual([]);
  });

  it('moves balances in contract state and produces no mint effect', async () => {
    const c = await ledgerToken();
    const holder = accountId(OWNER_SK);
    const owner = { is_left: true, left: holder, right: { bytes: new Uint8Array(32) } };

    const minted = await c.call('mint', owner, 1_000_000n);
    expect(mintValues(minted.effects, 'unshieldedMints')).toEqual([]);
    expect((await c.call('totalSupply')).result).toBe(1_000_000n);
    expect((await c.call('balanceOf', owner)).result).toBe(1_000_000n);

    const moved = await c.call('transfer', account('recipient'), 250_000n);
    expect(moved.result).toBe(true);
    expect(moved.events).toHaveLength(0);
    expect(mintValues(moved.effects, 'unshieldedMints')).toEqual([]);
    expect((await c.call('balanceOf', owner)).result).toBe(750_000n);
    expect((await c.call('balanceOf', account('recipient'))).result).toBe(250_000n);
  });

  it('renames itself through an owner-only update', async () => {
    const c = await ledgerToken();
    const renamed = 'Ledger Moon (renamed)';
    const { events } = await c.call('setMetadata', pad(32, 'name'), byteLen(renamed), value190(renamed));
    expect(events[0].valueText).toBe(renamed);
    expect(events[0].kind).toBe(KIND_LEDGER_FLAG);

    const stranger = await ledgerToken(STRANGER_SK);
    await expect(
      stranger.call('setMetadata', pad(32, 'name'), 4n, value190('mine')),
    ).rejects.toThrow(/not the owner/);
    await expect(stranger.call('mint', account('x'), 1n)).rejects.toThrow(/not the owner/);
  });
});
