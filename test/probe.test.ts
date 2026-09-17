/**
 * The compile-and-layout proof for the TokenMetadata payload.
 *
 * `Bytes[...spread, byte, ...spread]` is what the standard's module uses to
 * concatenate the five fields into one `Bytes<256>`. These tests assert that it
 * compiles (the module is imported, so it did), that it produces exactly 256
 * bytes, and that every field lands on the documented offset.
 */
import { describe, expect, it } from 'vitest';
import { Contract, ledger } from '../contracts/managed/MetadataProbe/contract/index.js';
import {
  KIND_LEDGER_FLAG,
  KIND_SHIELDED,
  KIND_UNSHIELDED,
  MAX_VALUE_LEN,
  MISC_EVENT_SIZE,
  PAYLOAD_SIZE,
  deploy,
  hex,
  pad,
  rawMiscBytes,
} from './token-metadata.js';

type PrivateState = Record<string, never>;

const probe = () => deploy<PrivateState>(new Contract<PrivateState>({}), {});

describe('TokenMetadata payload layout', () => {
  it('emits three events for the three standard fields, each 256 bytes at the documented offsets', async () => {
    const c = await probe();
    const { events, rawEvents } = await c.call('publishFixture');

    expect(events).toHaveLength(3);
    for (const [i, event] of events.entries()) {
      expect(rawMiscBytes(rawEvents[i] as never)).toHaveLength(MISC_EVENT_SIZE);
      expect(event.eventName).toBe('TokenMetadata');
      expect(event.payload).toHaveLength(PAYLOAD_SIZE);
      expect(event.address).toBe(c.address);
      expect(hex(event.domainSep)).toBe(hex(pad(32, 'umbra:probe')));
      expect(event.kind).toBe(KIND_SHIELDED);
      expect(event.value).toHaveLength(MAX_VALUE_LEN);
    }

    expect(events.map((e) => e.keyText)).toEqual(['name', 'symbol', 'decimals']);
    expect(events[0].len).toBe(11);
    expect(events[0].valueText).toBe('Umbra Probe');
    expect(events[1].len).toBe(6);
    expect(events[1].valueText).toBe('UPROBE');
    expect(events[2].len).toBe(1);
    expect(events[2].valueBytes[0]).toBe(6);

    // The name field is NUL-padded after `len`, never truncated.
    expect(events[0].value.subarray(11).every((b) => b === 0)).toBe(true);
  });

  it('places every field at its documented byte offset', async () => {
    const c = await probe();
    const domainSep = new Uint8Array(32).fill(0xab);
    const key = pad(32, 'magnitude');
    const value = new Uint8Array(MAX_VALUE_LEN);
    value.set(new TextEncoder().encode('1.25'));

    const { events } = await c.call('publishRaw', domainSep, BigInt(KIND_UNSHIELDED), key, 4n, value);
    expect(events).toHaveLength(1);
    const [event] = events;
    const p = event.payload;

    expect(p).toHaveLength(256);
    expect(hex(p.subarray(0, 32))).toBe(hex(domainSep)); // 0..31  domainSep
    expect(p[32]).toBe(KIND_UNSHIELDED); //                  32     kind
    expect(hex(p.subarray(33, 65))).toBe(hex(key)); //        33..64 key
    expect(p[65]).toBe(4); //                                 65     len
    expect(hex(p.subarray(66, 256))).toBe(hex(value)); //     66..255 value
    expect(event.keyText).toBe('magnitude');
    expect(event.valueText).toBe('1.25');
  });

  it('carries a full-length value (len = 190) without spilling out of the payload', async () => {
    const c = await probe();
    const value = new Uint8Array(MAX_VALUE_LEN);
    for (let i = 0; i < value.length; i += 1) value[i] = 0x41 + (i % 26);

    const { events } = await c.call(
      'publishRaw',
      pad(32, 'umbra:probe'),
      BigInt(KIND_SHIELDED),
      pad(32, 'metadata/0'),
      BigInt(MAX_VALUE_LEN),
      value,
    );

    expect(events[0].payload).toHaveLength(PAYLOAD_SIZE);
    expect(events[0].len).toBe(MAX_VALUE_LEN);
    expect(hex(events[0].valueBytes)).toBe(hex(value));
  });

  it('emits the kind byte verbatim, including the ledger flag and the invalid values a consumer must reject', async () => {
    const c = await probe();
    const emptyValue = new Uint8Array(MAX_VALUE_LEN);
    const kinds = [
      KIND_UNSHIELDED,
      KIND_SHIELDED,
      KIND_LEDGER_FLAG,
      KIND_LEDGER_FLAG | KIND_SHIELDED,
      0x80, // a reserved bit: the standard says a consumer rejects this event
    ];

    for (const kind of kinds) {
      const { events } = await c.call(
        'publishRaw',
        pad(32, 'umbra:probe'),
        BigInt(kind),
        pad(32, 'name'),
        0n,
        emptyValue,
      );
      expect(events[0].kind).toBe(kind);
    }
  });

  it('lets a caller build a payload a consumer must reject (len > 190)', async () => {
    const c = await probe();
    const { events } = await c.call(
      'publishRaw',
      pad(32, 'umbra:probe'),
      BigInt(KIND_SHIELDED),
      pad(32, 'name'),
      200n, // > MAX_VALUE_LEN: the contract emits it, the consumer rejects it
      new Uint8Array(MAX_VALUE_LEN).fill(0x42),
    );
    expect(events[0].len).toBe(200);
    expect(events[0].valueBytes).toHaveLength(MAX_VALUE_LEN); // decoder clamps
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
