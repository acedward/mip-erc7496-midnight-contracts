/**
 * The compile-and-layout proof for the MIP's 256-byte payload (MIP sections 1,
 * 2, 2.1, 2.2 and 3 of `mips/mip-xxxx-on-chain-token-metadata.md` @ `f433056`).
 *
 * `Bytes[...spread, byte, ...spread]` is what the reference module uses to
 * concatenate the six fields into one `Bytes<256>`. These tests assert that it
 * compiles (the module is imported, so it did), that the field widths really
 * add up to 256, and that every field lands on the offset the MIP documents —
 * in particular the val-type byte at 65, which is what moved in this revision.
 */
import { describe, expect, it } from 'vitest';
import { Contract, ledger } from '../contracts/managed/MetadataProbe/contract/index.js';
import {
  EVENT_NAME,
  KIND_LEDGER_FLAG,
  KIND_SHIELDED,
  KIND_UNSHIELDED,
  LEGACY_EVENT_NAME,
  MAX_VALUE_LEN,
  MISC_EVENT_SIZE,
  PAYLOAD_SIZE,
  VAL_TYPE_INTEGER,
  VAL_TYPE_STRING,
  deploy,
  hex,
  pad,
  rawMiscBytes,
  validateTokenMetadataEvent,
} from './token-metadata.js';

type PrivateState = Record<string, never>;

const probe = () => deploy<PrivateState>(new Contract<PrivateState>({}), {});
const emptyValue = new Uint8Array(MAX_VALUE_LEN);

describe('the MIP payload layout', () => {
  it('adds up: 32 + 1 + 32 + 1 + 1 + 189 = 256', () => {
    expect(32 + 1 + 32 + 1 + 1 + MAX_VALUE_LEN).toBe(PAYLOAD_SIZE);
    expect(MISC_EVENT_SIZE).toBe(32 + PAYLOAD_SIZE);
  });

  it('names the event exactly as MIP section 1 states, byte for byte', async () => {
    const c = await probe();
    const { events, rawEvents } = await c.call('publishFixture');
    const nameBytes = rawMiscBytes(rawEvents[0] as never).subarray(0, 32);

    // MIP section 1: 0x6d69702d…5b76315d (27 bytes) followed by five NULs.
    expect(hex(nameBytes)).toBe(
      '6d69702d787878783a746f6b656e2d6d657461646174615b76315d0000000000',
    );
    expect(hex(nameBytes)).toBe(hex(pad(32, EVENT_NAME)));
    expect(nameBytes.subarray(27).every((b) => b === 0)).toBe(true);
    expect(events.every((e) => e.eventName === EVENT_NAME)).toBe(true);
  });

  it('emits the three core fields with Appendix A’s val-types (1, 1, 2)', async () => {
    const c = await probe();
    const { events, rawEvents } = await c.call('publishFixture');

    expect(events).toHaveLength(3);
    for (const [i, event] of events.entries()) {
      expect(rawMiscBytes(rawEvents[i] as never)).toHaveLength(MISC_EVENT_SIZE);
      expect(event.payload).toHaveLength(PAYLOAD_SIZE);
      expect(event.address).toBe(c.address);
      expect(hex(event.domainSep)).toBe(hex(pad(32, 'umbra:probe')));
      expect(event.kind).toBe(KIND_SHIELDED);
      expect(event.value).toHaveLength(MAX_VALUE_LEN);
      expect(validateTokenMetadataEvent(event)).toEqual({ outcome: 'accepted' });
    }

    expect(events.map((e) => e.keyText)).toEqual(['name', 'symbol', 'decimals']);
    expect(events.map((e) => e.valType)).toEqual([
      VAL_TYPE_STRING,
      VAL_TYPE_STRING,
      VAL_TYPE_INTEGER,
    ]);
    expect(events[0].len).toBe(11);
    expect(events[0].valueText).toBe('Umbra Probe');
    expect(events[1].len).toBe(6);
    expect(events[1].valueText).toBe('UPROBE');
    // decimals is a big-endian unsigned integer in exactly one byte.
    expect(events[2].len).toBe(1);
    expect(events[2].valueBytes[0]).toBe(6);

    // The name field is NUL-padded after `val-len`, never truncated.
    expect(events[0].value.subarray(11).every((b) => b === 0)).toBe(true);
  });

  it('places every field at its documented byte offset', async () => {
    const c = await probe();
    const domainSep = new Uint8Array(32).fill(0xab);
    const key = pad(32, 'magnitude');
    const value = new Uint8Array(MAX_VALUE_LEN);
    value.set(new TextEncoder().encode('1.25'));

    const { events } = await c.call(
      'publishRaw',
      domainSep,
      BigInt(KIND_UNSHIELDED),
      key,
      BigInt(VAL_TYPE_STRING),
      4n,
      value,
    );
    expect(events).toHaveLength(1);
    const [event] = events;
    const p = event.payload;

    expect(p).toHaveLength(PAYLOAD_SIZE);
    expect(hex(p.subarray(0, 32))).toBe(hex(domainSep)); //   0..31   domainSep
    expect(p[32]).toBe(KIND_UNSHIELDED); //                   32      kind
    expect(hex(p.subarray(33, 65))).toBe(hex(key)); //        33..64  key
    expect(p[65]).toBe(VAL_TYPE_STRING); //                   65      val-type
    expect(p[66]).toBe(4); //                                 66      val-len
    expect(hex(p.subarray(67, 256))).toBe(hex(value)); //     67..255 value
    expect(event.keyText).toBe('magnitude');
    expect(event.valueText).toBe('1.25');
  });

  it('carries a full-length value (val-len = 189) without spilling out of the payload', async () => {
    const c = await probe();
    const value = new Uint8Array(MAX_VALUE_LEN);
    for (let i = 0; i < value.length; i += 1) value[i] = 0x41 + (i % 26);

    const { events } = await c.call(
      'publishRaw',
      pad(32, 'umbra:probe'),
      BigInt(KIND_SHIELDED),
      pad(32, 'metadata/0'),
      BigInt(VAL_TYPE_STRING),
      BigInt(MAX_VALUE_LEN),
      value,
    );

    expect(events[0].payload).toHaveLength(PAYLOAD_SIZE);
    expect(events[0].len).toBe(MAX_VALUE_LEN);
    expect(hex(events[0].valueBytes)).toBe(hex(value));
  });

  it('emits the kind byte verbatim, including the two ledger kinds and one a consumer rejects', async () => {
    const c = await probe();
    const kinds = [
      KIND_UNSHIELDED,
      KIND_SHIELDED,
      KIND_LEDGER_FLAG,
      KIND_LEDGER_FLAG | KIND_SHIELDED,
      4, // MIP section 3: 4..255 MUST reject the event
    ];

    for (const kind of kinds) {
      const { events } = await c.call(
        'publishRaw',
        pad(32, 'umbra:probe'),
        BigInt(kind),
        pad(32, 'name'),
        BigInt(VAL_TYPE_STRING),
        0n,
        emptyValue,
      );
      expect(events[0].kind).toBe(kind);
      expect(validateTokenMetadataEvent(events[0]).outcome).toBe(kind <= 3 ? 'accepted' : 'rejected');
    }
  });

  it('lets a caller build the payloads MIP sections 2.1 and 2.2 say a consumer must reject', async () => {
    const c = await probe();
    const raw = (kind: number, key: Uint8Array, valType: number, valLen: number) =>
      c.call('publishRaw', pad(32, 'umbra:probe'), BigInt(kind), key, BigInt(valType), BigInt(valLen), emptyValue);

    // val-len above the 189-byte value field
    const long = await raw(KIND_SHIELDED, pad(32, 'name'), VAL_TYPE_STRING, 200);
    expect(long.events[0].len).toBe(200);
    expect(long.events[0].valueBytes).toHaveLength(MAX_VALUE_LEN); // the decoder clamps
    expect(validateTokenMetadataEvent(long.events[0])).toEqual({
      outcome: 'rejected',
      reason: 'val_len_too_long',
    });

    // a reserved val-type
    const reserved = await raw(KIND_SHIELDED, pad(32, 'name'), 7, 0);
    expect(reserved.events[0].valType).toBe(7);
    expect(validateTokenMetadataEvent(reserved.events[0])).toEqual({
      outcome: 'rejected',
      reason: 'val_type_reserved',
    });

    // an empty key (all NUL after trimming)
    const emptyKey = await raw(KIND_SHIELDED, new Uint8Array(32), VAL_TYPE_STRING, 0);
    expect(emptyKey.events[0].keyText).toBe('');
    expect(validateTokenMetadataEvent(emptyKey.events[0])).toEqual({
      outcome: 'rejected',
      reason: 'key_empty',
    });

    // val-type 2 with val-len 0 breaks the integer rule (1 <= val-len <= 16)
    const badInt = await raw(KIND_SHIELDED, pad(32, 'decimals'), VAL_TYPE_INTEGER, 0);
    expect(validateTokenMetadataEvent(badInt.events[0])).toEqual({
      outcome: 'rejected',
      reason: 'val_type_rule',
    });
  });

  it('accepts val-len = 0 as "present, empty" (MIP section 6.2)', async () => {
    const c = await probe();
    const { events } = await c.call(
      'publishRaw',
      pad(32, 'umbra:probe'),
      BigInt(KIND_SHIELDED),
      pad(32, 'description'),
      BigInt(VAL_TYPE_STRING),
      0n,
      emptyValue,
    );
    expect(events[0].len).toBe(0);
    expect(events[0].valueBytes).toHaveLength(0);
    expect(validateTokenMetadataEvent(events[0])).toEqual({ outcome: 'accepted' });
  });

  it('emits the pre-MIP event name too, and a consumer IGNORES it rather than rejecting it', async () => {
    const c = await probe();
    const { events } = await c.call(
      'publishLegacyName',
      pad(32, 'umbra:probe'),
      BigInt(KIND_SHIELDED),
      pad(32, 'name'),
      BigInt(VAL_TYPE_STRING),
      4n,
      (() => {
        const v = new Uint8Array(MAX_VALUE_LEN);
        v.set(new TextEncoder().encode('Old!'));
        return v;
      })(),
    );

    expect(events[0].eventName).toBe(LEGACY_EVENT_NAME);
    expect(events[0].payload).toHaveLength(PAYLOAD_SIZE);
    // Everything about the payload is well formed; only the name disqualifies it.
    expect(events[0].valueText).toBe('Old!');
    expect(validateTokenMetadataEvent(events[0])).toEqual({
      outcome: 'ignored',
      reason: 'event_name',
    });
  });

  it('counts its publish calls in ledger state', async () => {
    const c = await probe();
    expect(ledger(c.state as never)._calls).toBe(0n);
    await c.call('publishFixture');
    await c.call('publishFixture');
    expect(ledger(c.state as never)._calls).toBe(2n);
    const { result } = await c.call('calls');
    expect(result).toBe(2n);
  });
});
