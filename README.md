# mip-erc7496-midnight-contracts

On-chain token metadata for Midnight: a standard, a Compact module and reference
contracts that publish a token's `name`, `symbol`, `decimals` and arbitrary
key/value traits as contract events, so an indexer can build a token table
without a registry and without trusting anyone but the emitting contract.

Midnight tokens are ERC-1155-like — one contract mints many tokens, each keyed by
a 32-byte *domain separator*, and the token's colour (its type) is
`persistentCommit([domainSep, contractAddress], pad(32, "midnight:derive_token"))`.
Nothing on chain says what a colour means. This repository fixes that with one
event shape, in the spirit of [EIP-7496 (NFT Dynamic Traits)](https://eips.ethereum.org/EIPS/eip-7496).

- **[`TOKEN-METADATA.md`](./TOKEN-METADATA.md)** — the standard. Normative; read
  this if you want your own contract to appear in a token indexer.
- `contracts/TokenMetadata.compact` — the module every conforming contract
  imports (one circuit: `emitTokenMetadata`).
- `contracts/*.compact` — reference templates: native shielded, native
  unshielded, dual-kind, a shielded collection with one domain per piece, and a
  ledger (contract-state balance) token.
- `deployments/` + `scripts/` — the deployment matrix and a resumable
  deploy-and-publish script, plus a fixture exporter for indexer tests.

Status: **experimental**, first proof of concept. Toolchain: Compact 0.34.0
(language 0.26.0, runtime 0.19.0, Midnight ledger 9).

License: Apache-2.0.
