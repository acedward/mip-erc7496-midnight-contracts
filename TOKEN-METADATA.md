# The `TokenMetadata` standard

**Version**: 1 (the event name `TokenMetadata` *is* the version — see [Versioning](#versioning))
**Status**: experimental, first proof of concept
**Toolchain**: Compact 0.34.0 (language 0.26.0, runtime 0.19.0), Midnight ledger 9
**Canonical copy**: this file, in `acedward/mip-erc7496-midnight-contracts`

A Midnight contract can mint many tokens. Each is identified inside the contract
by a 32-byte **domain separator**, and its **colour** (the token type the ledger
and every wallet see) is derived from the domain separator and the contract's own
address:

```
colour = persistentCommit([domainSep, contractAddress], pad(32, "midnight:derive_token"))
```

Minting is public and static in the transaction — a contract call's transcript
carries `effects.shieldedMints` / `effects.unshieldedMints` as
`domainSep → amount` — so anyone can enumerate every colour that was ever minted
and who minted it. What no one can do is say what a colour *means*: nothing on
chain carries a name, a symbol, a number of decimals or anything else.

This standard fixes that with **one event shape**. A contract describes its own
tokens by emitting `Misc` events named `TokenMetadata`, one event per
`(domainSep, kind, key, value)` tuple. An indexer folds them, last write wins,
and gets a table of every token with its display fields and its arbitrary traits.
The design follows [EIP-7496 (NFT Dynamic Traits)](https://eips.ethereum.org/EIPS/eip-7496):
keys are fixed-width byte strings, values are opaque bytes, the emitting contract
is the sole authority, and updates are just later events.

---

## 1. The event

```
Misc {
  name:    pad(32, "TokenMetadata")   // Bytes<32>, NUL-padded
  payload: <the 256 bytes of section 2> // Bytes<256>
}
```

`Misc` is the Compact standard library's catch-all event type
(`onchain-vm` event tag 10). A conforming consumer accepts an event as a
`TokenMetadata` event **iff**

1. its type is `Misc`, and
2. `name == pad(32, "TokenMetadata")` (`0x546f6b656e4d65746164617461` followed by
   19 NUL bytes), and
3. its payload is **exactly 256 bytes**.

Anything else is not a `TokenMetadata` event and MUST be ignored. A payload of
the right name but the wrong length MUST be recorded as rejected, never applied.

A Compact **constructor cannot emit**, directly or through a circuit it calls.
Conforming contracts therefore expose a `publishMetadata()` circuit that the
deployer calls immediately after deployment (see section 6).

## 2. Payload layout

256 bytes, big-endian, no padding between fields:

| Offset | Size | Field | Meaning |
|---|---|---|---|
| 0 | 32 | `domainSep` | the token within the contract (the ERC-1155 `id` analogue). For native tokens it is exactly the value passed to `mintShieldedToken` / `mintUnshieldedToken`; for ledger tokens it is any 32 bytes the contract chooses, e.g. `pad(32, "umbra:lsun")` |
| 32 | 1 | `kind` | see section 3 |
| 33 | 32 | `key` | UTF-8 key name, NUL-padded (`pad(32, "name")`); compared after trimming trailing NULs |
| 65 | 1 | `len` | number of meaningful bytes in `value`, `0 ≤ len ≤ 190` |
| 66 | 190 | `value` | the value bytes, NUL-padded after `len` |

`32 + 1 + 32 + 1 + 190 = 256`.

`len > 190` MUST reject the event. Bytes of `value` at or after `len` carry no
meaning and MUST be ignored by consumers (the reference contracts set them to
NUL).

## 3. The `kind` byte

| Bit | 0 | 1 |
|---|---|---|
| 0 | unshielded | shielded |
| 1 | native (UTxO, minted by `mintShieldedToken` / `mintUnshieldedToken`) | ledger (balances kept in contract state) |
| 2–7 | MUST be zero | reserved — a set bit rejects the event |

So the four valid values are:

| `kind` | meaning |
|---|---|
| `0` | unshielded native |
| `1` | shielded native |
| `2` | unshielded ledger (MIP-0004 style account token) |
| `3` | shielded ledger (confidential balances) |

A colour exists only for **native** tokens (bit 1 clear). A consumer MUST NOT
derive a colour for a declaration with bit 1 set.

The `(domainSep, kind)` pair — not `domainSep` alone — identifies a token: a
contract may mint the same domain separator both shielded and unshielded, which
produces one colour value used as two different token types. Such a contract
publishes its metadata twice, once per kind.

## 4. Key registry

Well-known keys, which a consumer projects into dedicated columns:

| key | value encoding | validation |
|---|---|---|
| `name` | UTF-8 | `1 ≤ len ≤ 190`, valid UTF-8 |
| `symbol` | UTF-8 | `1 ≤ len ≤ 32`, valid UTF-8 |
| `decimals` | one byte | `len == 1`, `value[0] ≤ 36` |
| `metadata` | UTF-8 JSON, single part | `len ≥ 2`, parses as a JSON object |
| `metadata/<n>` | UTF-8 JSON split into parts `n = 0, 1, …` (each ≤ 190 bytes) | parts are concatenated in `n` order and applied only when `0..max` are all present and the concatenation parses as a JSON object; `n ≤ 15` (≤ 3 040 bytes) |
| `tokenUri` | UTF-8 URL — the ERC-721 `tokenURI` analogue: where this token's metadata document can be fetched | `len ≤ 190`, parses as an absolute `http(s)://` URL |

Any other key is a **trait**: stored verbatim (raw bytes plus `len`) against
`(contract, domainSep, kind)` and surfaced as such. This is EIP-7496's
`getTraitValue`. Suggested, not required: `description`, `image` (a URL or a
`data:` URI, usually inside `metadata`), `website`, `metadataUri` (EIP-7496's
collection-level trait-definition document, distinct from the per-token
`tokenUri`).

Key comparison: trailing NUL bytes are trimmed, then the bytes are compared
exactly. Keys are case-sensitive.

## 5. Rules

1. **Authority.** The emitting contract is the only authority for
   `(its own address, domainSep, kind)`. A consumer MUST take the address from
   the event's `contractAddress`, never from the payload. Because a colour is
   derived from `(domainSep, contractAddress)`, no contract can describe another
   contract's token.
2. **Last write wins**, per `(contract, domainSep, kind, key)`, ordered by block
   height and then by the event's position in the transaction's evaluation
   order. Earlier values are history, not truth.
3. **Declaration never overrides observation.** A mint effect in a transcript is
   a fact; a `TokenMetadata` event is a claim. If a contract has been observed
   minting `(domainSep, kind)` natively, an event claiming `kind` bit 1 (ledger)
   or the other value of bit 0 does not change what was observed: the consumer
   keeps the observed storage and kind, still applies the key/value, and flags
   the token as inconsistent.
4. **Describing an unminted token is legal.** A ledger token has no mint at all
   and can only ever be declared; a native token may be described before (or
   without) its first mint.
5. **No registration.** Nothing needs to be registered with anyone. A consumer
   discovers contracts from the transactions themselves — every contract call's
   transcript publicly states how many `log` (event) operations it ran — and
   fetches the events of exactly those calls.

## 6. Writing a conforming contract

Import the module, store what you want to publish, and call it from a circuit —
**not** from the constructor, which cannot emit.

```compact
pragma language_version >= 0.26.0;
import CompactStandardLibrary;
import "./TokenMetadata" prefix TM_;

export sealed ledger _domain: Bytes<32>;
export sealed ledger _name: Bytes<32>;   export sealed ledger _nameLen: Uint<8>;
export sealed ledger _symbol: Bytes<16>; export sealed ledger _symbolLen: Uint<8>;
export sealed ledger _decimals: Uint<8>;
export ledger _published: Boolean;

constructor(domain_: Bytes<32>, name_: Bytes<32>, nameLen: Uint<8>,
            symbol_: Bytes<16>, symbolLen: Uint<8>, decimals_: Uint<8>) {
  _domain = disclose(domain_);
  _name = disclose(name_);     _nameLen = disclose(nameLen);
  _symbol = disclose(symbol_); _symbolLen = disclose(symbolLen);
  _decimals = disclose(decimals_);
}

// The colour anyone else derives from (domainSep, address) must equal this.
export circuit tokenColor(): Bytes<32> {
  return tokenType(_domain, kernel.self());
}

// Called once, right after deployment: three events (name, symbol, decimals).
export circuit publishMetadata(): [] {
  assert(!_published, "already published");
  _published = true;
  TM_emitStandardFields(_domain, TM_KIND_SHIELDED(),
                        _name, _nameLen, _symbol, _symbolLen, _decimals);
}

// EIP-7496 dynamic trait update. Guard it with your own access control.
export circuit setMetadata(key: Bytes<32>, len: Uint<8>, value: Bytes<190>): [] {
  TM_emitTokenMetadata(_domain, TM_KIND_SHIELDED(), key, len, value);
}

export circuit mint(recipient: ZswapCoinPublicKey, amount: Uint<64>,
                    nonce: Bytes<32>): ShieldedCoinInfo {
  return mintShieldedToken(_domain, disclose(amount), disclose(nonce),
                           left<ZswapCoinPublicKey, ContractAddress>(disclose(recipient)));
}
```

Everything that reaches `emit` is public: pass `disclose(...)` for anything
derived from a witness, exactly as you would for any other public write.

The module itself is [`contracts/TokenMetadata.compact`](./contracts/TokenMetadata.compact):

```compact
pragma language_version >= 0.26.0;
import CompactStandardLibrary;

export module TokenMetadata {
  export circuit KIND_UNSHIELDED(): Uint<8>  { return 0; }
  export circuit KIND_SHIELDED(): Uint<8>    { return 1; }
  export circuit KIND_LEDGER_FLAG(): Uint<8> { return 2; }

  export circuit emitTokenMetadata(domainSep: Bytes<32>, kind: Uint<8>, key: Bytes<32>,
                                   len: Uint<8>, value: Bytes<190>): [] {
    emit(Misc {
      name: pad(32, "TokenMetadata"),
      payload: Bytes[...domainSep, kind, ...key, len, ...value]   // 32+1+32+1+190 = 256
    });
  }

  export circuit emitStandardFields(domainSep: Bytes<32>, kind: Uint<8>,
                                    name_: Bytes<32>, nameLen: Uint<8>,
                                    symbol_: Bytes<16>, symbolLen: Uint<8>,
                                    decimals_: Uint<8>): [] {
    emitTokenMetadata(domainSep, kind, pad(32, "name"),     nameLen,   Bytes[...name_,   ...pad(158, "")]);
    emitTokenMetadata(domainSep, kind, pad(32, "symbol"),   symbolLen, Bytes[...symbol_, ...pad(174, "")]);
    emitTokenMetadata(domainSep, kind, pad(32, "decimals"), 1,         Bytes[decimals_,  ...pad(189, "")]);
  }
}
```

`Bytes[...]` literals with spreads of `Bytes<n>` values are how the payload is
concatenated: each spread contributes its `n` `Uint<8>` elements, so the literal
above is exactly 256 elements. (`serialize<T, n>` is not an option — Compact
instantiates it only for standard event types, not for `Bytes<32>` or a
user-defined struct.)

## 7. Mapping to EIP-7496

| EIP-7496 | here |
|---|---|
| `tokenId` | `domainSep` (+ `kind`) |
| `traitKey: bytes32` | `key: Bytes<32>` |
| `traitValue: bytes32` | `value: Bytes<190>` with `len` — longer values, no hashing |
| `TraitUpdated` event | one `TokenMetadata` `Misc` event |
| `getTraitValue(tokenId, traitKey)` | the folded key/value table of the consumer |
| `getTraitMetadataURI` | the `metadata` JSON inline, or a `metadataUri` key |
| ERC-721 `tokenURI(tokenId)` | the `tokenUri` key |
| the contract is the authority | the emitting contract is the authority, enforced by colour derivation |

## Versioning

The **event name is the version**. A future, incompatible layout uses a new name
(`TokenMetadata2`) and never a reinterpretation of this one. A consumer that only
knows version 1 ignores `TokenMetadata2` events; a consumer that knows both keeps
them apart. Within version 1, new keys are added to the registry freely — unknown
keys are already required to be stored verbatim as traits.

## Consumer notes

Event *contents* cannot be read statically from a transaction: `emit` compiles to
the VM's `log` opcode and its operand comes from the stack at execution time.
What a transaction does state publicly is **how many `log` ops each contract
call's transcript runs**. A consumer therefore:

1. scans every transaction for `ContractDeploy` / `ContractCall` actions and for
   the mint effects of each call's transcripts (these are the *observed* facts);
2. counts `log` ops in the guaranteed transcript and in the fallible transcript
   of every successful segment;
3. for each call with at least one `log` op, fetches that call's events — from an
   indexer, or from its own ledger replay — and compares the count it got with
   the count the transcript promised before applying anything.

Mints in a guaranteed transcript count when the transaction succeeded or
partially succeeded; mints in a fallible transcript count only when that intent's
segment succeeded.
