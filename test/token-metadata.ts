/**
 * Test-side decoder for the TokenMetadata standard (../TOKEN-METADATA.md) plus
 * the small simulator harness the contract tests share.
 *
 * The decoder deliberately re-implements the layout from the document rather
 * than importing anything from the contracts: if the Compact side and this side
 * ever disagree, a test must fail.
 */
import {
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
} from '@midnight-ntwrk/compact-runtime';

/** `Misc { name: Bytes<32>, payload: Bytes<256> }` — 288 bytes serialized. */
export const MISC_EVENT_SIZE = 288;
export const PAYLOAD_SIZE = 256;
export const MAX_VALUE_LEN = 190;

export const KIND_UNSHIELDED = 0;
export const KIND_SHIELDED = 1;
export const KIND_LEDGER_FLAG = 2;

/** Compact's `pad(n, "text")`: UTF-8 bytes, NUL-padded on the right. */
export function pad(n: number, text: string): Uint8Array {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > n) throw new Error(`"${text}" does not fit in ${n} bytes`);
  const out = new Uint8Array(n);
  out.set(bytes);
  return out;
}

/** Drops trailing NULs and decodes as UTF-8 — how a key name is compared. */
export function unpad(bytes: Uint8Array): string {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end -= 1;
  return new TextDecoder().decode(bytes.subarray(0, end));
}

export function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

export interface TokenMetadataEvent {
  /** The emitting contract, as the VM tagged the log entry. */
  address: string;
  /** `Misc.name`, i.e. `pad(32, "TokenMetadata")` for a conforming event. */
  eventName: string;
  /** The raw 256-byte payload, zero-extended. */
  payload: Uint8Array;
  domainSep: Uint8Array;
  kind: number;
  key: Uint8Array;
  keyText: string;
  len: number;
  /** The whole 190-byte `value` field, NUL-padded. */
  value: Uint8Array;
  /** `value` truncated to `len` — the meaningful bytes. */
  valueBytes: Uint8Array;
  /** `valueBytes` as UTF-8, for the text-valued keys. */
  valueText: string;
}

/**
 * A `misc` log event as the on-chain VM produces it. The aligned value declares
 * 288 bytes but carries them with trailing NULs trimmed, so consumers reading
 * the raw value MUST zero-extend before slicing — this helper does.
 */
type RawLogEvent = {
  eventType: string;
  address: string;
  data: { tag: string; content: { value: Uint8Array[]; alignment: unknown } };
};

export function rawMiscBytes(event: RawLogEvent): Uint8Array {
  if (event.eventType !== 'misc') throw new Error(`not a misc event: ${event.eventType}`);
  if (event.data.tag !== 'cell') throw new Error(`unexpected log data tag: ${event.data.tag}`);
  const parts = event.data.content.value;
  if (parts.length !== 1) throw new Error(`unexpected aligned value with ${parts.length} atoms`);
  const trimmed = parts[0];
  if (trimmed.length > MISC_EVENT_SIZE) {
    throw new Error(`misc event is ${trimmed.length} bytes, expected at most ${MISC_EVENT_SIZE}`);
  }
  const full = new Uint8Array(MISC_EVENT_SIZE);
  full.set(trimmed);
  return full;
}

/** Parses one `misc` log event as a TokenMetadata event, or throws. */
export function decodeTokenMetadataEvent(event: RawLogEvent): TokenMetadataEvent {
  const bytes = rawMiscBytes(event);
  const eventName = unpad(bytes.subarray(0, 32));
  const payload = bytes.subarray(32, 32 + PAYLOAD_SIZE);
  const domainSep = payload.subarray(0, 32);
  const kind = payload[32];
  const key = payload.subarray(33, 65);
  const len = payload[65];
  const value = payload.subarray(66, 66 + MAX_VALUE_LEN);
  const valueBytes = value.subarray(0, Math.min(len, MAX_VALUE_LEN));
  return {
    address: event.address,
    eventName,
    payload: Uint8Array.from(payload),
    domainSep: Uint8Array.from(domainSep),
    kind,
    key: Uint8Array.from(key),
    keyText: unpad(key),
    len,
    value: Uint8Array.from(value),
    valueBytes: Uint8Array.from(valueBytes),
    valueText: new TextDecoder().decode(valueBytes),
  };
}

export function decodeAll(events: readonly unknown[]): TokenMetadataEvent[] {
  return (events as RawLogEvent[]).map(decodeTokenMetadataEvent);
}

// ---------------------------------------------------------------------------
// Simulator harness
// ---------------------------------------------------------------------------

/** A contract as compactc generates it: `new Contract(witnesses)`. */
export interface GeneratedContract<PS> {
  initialState(context: unknown, ...args: any[]): Promise<{
    currentContractState: { data: unknown };
    currentPrivateState: PS;
  }>;
  impureCircuits: Record<string, (context: any, ...args: any[]) => Promise<any>>;
}

export const ZERO_COIN_PK = '0'.repeat(64);

export interface Call {
  result: unknown;
  /** Every `misc` log event of this call, decoded per the standard. */
  events: TokenMetadataEvent[];
  rawEvents: unknown[];
  /** The transcript effects — `shieldedMints`, `unshieldedMints`, … */
  effects: any;
}

/**
 * Deploys a generated contract in memory and returns a `call` helper that
 * threads the state forward the way a chain would. Follows the harness the
 * shielded-night v2 contract uses against this same runtime (0.19.0).
 */
export async function deploy<PS>(
  contract: GeneratedContract<PS>,
  privateState: PS,
  constructorArgs: unknown[] = [],
  options: { coinPublicKey?: string; address?: string } = {},
) {
  const coinPublicKey = options.coinPublicKey ?? ZERO_COIN_PK;
  const address = options.address ?? sampleContractAddress();
  const init = await contract.initialState(
    createConstructorContext(privateState, coinPublicKey),
    ...constructorArgs,
  );

  let state: unknown = init.currentContractState.data;
  let currentPrivateState: PS = init.currentPrivateState;

  return {
    address,
    get privateState() {
      return currentPrivateState;
    },
    get state() {
      return state;
    },
    /** Calls one circuit and commits its resulting state, like a block would. */
    async call(circuitId: string, ...args: unknown[]): Promise<Call> {
      const circuit = contract.impureCircuits[circuitId];
      if (!circuit) throw new Error(`no such circuit: ${circuitId}`);
      const context = createCircuitContext(
        circuitId,
        address,
        coinPublicKey,
        state as never,
        currentPrivateState,
      );
      const results = await circuit(context, ...args);
      state = results.context.callContext.currentQueryContext.state;
      currentPrivateState = results.context.callContext.currentPrivateState ?? currentPrivateState;
      return {
        result: results.result,
        events: decodeAll(results.context.events),
        rawEvents: results.context.events,
        effects: results.context.callContext.currentQueryContext.effects,
      };
    },
  };
}
