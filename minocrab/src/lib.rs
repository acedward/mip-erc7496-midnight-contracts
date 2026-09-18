//! Exact MinoCrab ports of the five metadata circuits measured in this repository.
//!
//! Original Compact source: acedward/mip-erc7496-midnight-contracts at
//! 71c5b0b5fc0503187df5fb7bb67687b3a5c55ef6. MinoCrab is pinned in Cargo.toml.

pub mod shapes;

use minocrab::v3::{Circuit3, Compiled3, FieldT, Wire3};
use minocrab::{Private, Public};
use minocrab_ledger::{emit, emit_event, ImpactElem, LedgerValue};
use minocrab_std::v3::{
    contract, label, Bool, Bytes, BytesN, Disclose, Discloses, Ledger, LedgerCell,
    LedgerCounter, Serializer, Uint, B32,
};

pub const MISC_SIZE: usize = 288;
pub const MISC_VERSION: u32 = 1;
pub const MISC_TAG: u8 = 10;
pub const METADATA_NAME: &str = "TokenMetadata";

label! {
    DomainSep = "domainSep";
    Kind = "kind";
    Key = "key";
    Len = "len";
    Value = "value";
    Name = "name_";
    NameLen = "nameLen";
    Symbol = "symbol_";
    SymbolLen = "symbolLen";
    Decimals = "decimals_";
}

#[derive(Ledger)]
pub struct ProbeLedger {
    pub calls: LedgerCounter,
}

pub const PROBE: ProbeLedger = ProbeLedger::new();

#[derive(Ledger)]
pub struct SstarLedger {
    pub published: LedgerCell<Bool<Public>>,
    pub mints: LedgerCounter,
}

pub const SSTAR: SstarLedger = SstarLedger::new();

fn emit_misc(c: &mut Circuit3, serialized: BytesN<Public, MISC_SIZE>) {
    let payload = LedgerValue::bytes(
        MISC_SIZE as u32,
        serialized
            .limbs()
            .iter()
            .map(|&wire| ImpactElem::Wire(wire))
            .collect(),
    );
    emit(c, &emit_event(MISC_VERSION, MISC_TAG, &payload));
}

fn emit_token_metadata(
    c: &mut Circuit3,
    domain_sep: &B32<Public>,
    kind: Wire3<FieldT, Public>,
    key: &B32<Public>,
    len: Wire3<FieldT, Public>,
    value: &BytesN<Public, 190>,
) {
    let mut serializer = Serializer::<Public>::new();
    let mut event_name = [0u8; 32];
    event_name[..METADATA_NAME.len()].copy_from_slice(METADATA_NAME.as_bytes());
    serializer.push_literal(c, &event_name);
    serializer.push_b32(domain_sep);
    serializer.push_uint(kind, 1);
    serializer.push_b32(key);
    serializer.push_uint(len, 1);
    serializer.push_bytes_n(value);
    let serialized = serializer.finish::<MISC_SIZE>(c);
    emit_misc(c, serialized);
}

fn emit_literal_metadata(
    c: &mut Circuit3,
    domain_sep: &str,
    kind: u8,
    key: &str,
    value: &[u8],
) {
    assert!(domain_sep.len() <= 32);
    assert!(key.len() <= 32);
    assert!(value.len() <= 190);
    let mut bytes = [0u8; MISC_SIZE];
    bytes[..METADATA_NAME.len()].copy_from_slice(METADATA_NAME.as_bytes());
    bytes[32..32 + domain_sep.len()].copy_from_slice(domain_sep.as_bytes());
    bytes[64] = kind;
    bytes[65..65 + key.len()].copy_from_slice(key.as_bytes());
    bytes[97] = value.len() as u8;
    bytes[98..98 + value.len()].copy_from_slice(value);
    let mut serializer = Serializer::<Public>::new();
    serializer.push_literal(c, &bytes);
    let serialized = serializer.finish::<MISC_SIZE>(c);
    emit_misc(c, serialized);
}

fn emit_standard_fields(
    c: &mut Circuit3,
    domain_sep: &B32<Public>,
    kind: Wire3<FieldT, Public>,
    name: &B32<Public>,
    name_len: Wire3<FieldT, Public>,
    symbol: Wire3<FieldT, Public>,
    symbol_len: Wire3<FieldT, Public>,
    decimals: Wire3<FieldT, Public>,
) {
    let name_key = B32::pad(c, "name");
    let symbol_key = B32::pad(c, "symbol");
    let decimals_key = B32::pad(c, "decimals");

    let mut name_value = Serializer::<Public>::new();
    name_value.push_b32(name);
    let name_value = name_value.finish::<190>(c);
    emit_token_metadata(c, domain_sep, kind, &name_key, name_len, &name_value);

    let mut symbol_value = Serializer::<Public>::new();
    symbol_value.push_uint(symbol, 16);
    let symbol_value = symbol_value.finish::<190>(c);
    emit_token_metadata(c, domain_sep, kind, &symbol_key, symbol_len, &symbol_value);

    let mut decimals_value = Serializer::<Public>::new();
    decimals_value.push_uint(decimals, 1);
    let decimals_value = decimals_value.finish::<190>(c);
    let one = c.constant(1u64);
    emit_token_metadata(c, domain_sep, kind, &decimals_key, one, &decimals_value);
}

pub struct MetadataProbe;

#[contract]
impl MetadataProbe {
    #[circuit]
    pub fn publish_raw(
        c: &mut Circuit3,
        #[arg(name = "domainSep")] domain_sep: B32<Private>,
        kind: Uint<8>,
        key: B32<Private>,
        len: Uint<8>,
        value: BytesN<Private, 190>,
    ) -> Discloses<(DomainSep, Kind, Key, Len, Value)> {
        PROBE.calls.increment(c, 1);
        let domain_sep = domain_sep.disclose_as::<DomainSep>(c);
        let kind = kind.disclose_as::<Kind>(c);
        let key = key.disclose_as::<Key>(c);
        let len = len.disclose_as::<Len>(c);
        let value = value.disclose_as::<Value>(c);
        emit_token_metadata(c, &domain_sep, kind.field(), &key, len.field(), &value);
        Discloses::of(())
    }

    #[circuit]
    pub fn publish_standard(
        c: &mut Circuit3,
        #[arg(name = "domainSep")] domain_sep: B32<Private>,
        kind: Uint<8>,
        #[arg(name = "name_")] name: B32<Private>,
        #[arg(name = "nameLen")] name_len: Uint<8>,
        #[arg(name = "symbol_")] symbol: Bytes<16>,
        #[arg(name = "symbolLen")] symbol_len: Uint<8>,
        #[arg(name = "decimals_")] decimals: Uint<8>,
    ) -> Discloses<(DomainSep, Kind, Name, NameLen, Symbol, SymbolLen, Decimals)> {
        PROBE.calls.increment(c, 1);
        let domain_sep = domain_sep.disclose_as::<DomainSep>(c);
        let kind = kind.disclose_as::<Kind>(c);
        let name = name.disclose_as::<Name>(c);
        let name_len = name_len.disclose_as::<NameLen>(c);
        let symbol = symbol.disclose_as::<Symbol>(c);
        let symbol_len = symbol_len.disclose_as::<SymbolLen>(c);
        let decimals = decimals.disclose_as::<Decimals>(c);
        emit_standard_fields(
            c,
            &domain_sep,
            kind.field(),
            &name,
            name_len.field(),
            symbol.field(),
            symbol_len.field(),
            decimals.field(),
        );
        Discloses::of(())
    }

    #[circuit]
    pub fn publish_fixture(c: &mut Circuit3) -> Discloses<()> {
        PROBE.calls.increment(c, 1);
        emit_literal_metadata(c, "umbra:probe", 1, "name", b"Umbra Probe");
        emit_literal_metadata(c, "umbra:probe", 1, "symbol", b"UPROBE");
        emit_literal_metadata(c, "umbra:probe", 1, "decimals", &[6]);
        Discloses::of(())
    }

    #[circuit(output = "result")]
    pub fn calls(c: &mut Circuit3) -> Discloses<(), Uint<64, Public>> {
        Discloses::of(PROBE.calls.read(c))
    }
}

pub struct Sstar;

#[contract]
impl Sstar {
    #[circuit]
    pub fn publish_metadata(c: &mut Circuit3) -> Discloses<()> {
        let published = SSTAR.published.read(c);
        let unpublished = c.not(published.field());
        c.assert_with(unpublished, Some("TokenMetadata: already published"));
        let yes = Bool::constant(c, true);
        SSTAR.published.write(c, &yes);

        emit_literal_metadata(c, "umbra:sstar", 1, "name", b"Shielded Star");
        emit_literal_metadata(c, "umbra:sstar", 1, "symbol", b"SSTAR");
        emit_literal_metadata(c, "umbra:sstar", 1, "decimals", &[6]);
        Discloses::of(())
    }
}

pub fn circuits() -> [(&'static str, Compiled3); 5] {
    [
        ("publishRaw", MetadataProbe::publish_raw()),
        ("publishStandard", MetadataProbe::publish_standard()),
        ("publishFixture", MetadataProbe::publish_fixture()),
        ("calls", MetadataProbe::calls()),
        ("SSTAR-publishMetadata", Sstar::publish_metadata()),
    ]
}
