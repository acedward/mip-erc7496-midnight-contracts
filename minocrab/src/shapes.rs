//! User-requested typed metadata shapes.
//!
//! This is a benchmark-local variant, not the deployed five-field format. Its
//! payload is `domain[32] | kind[1] | key[32] | value_type[1] |
//! value_len[1] | value[189]`. The literal and ledger publishers include the
//! same one-time guard/write; the runtime ladder isolates event emission.

use minocrab::v3::{Circuit3, Compiled3, FieldT, Wire3};
use minocrab::{Private, Public};
use minocrab_std::v3::{
    contract, label, Bool, Bytes, BytesN, Disclose, Discloses, Ledger, LedgerCell,
    Serializer, Uint, B32,
};

use crate::{emit_misc, METADATA_NAME, MISC_SIZE};

pub const VALUE_TYPE_TEXT: u8 = 1;
pub const VALUE_TYPE_UINT: u8 = 2;

label! {
    DomainSep = "domainSep";
    Kind = "kind";
    Key = "key";
    ValType = "valType";
    ValLen = "valLen";
    Value = "value";

    DomainSep1 = "domainSep1";
    Kind1 = "kind1";
    Key1 = "key1";
    ValType1 = "valType1";
    ValLen1 = "valLen1";
    Value1 = "value1";
    DomainSep2 = "domainSep2";
    Kind2 = "kind2";
    Key2 = "key2";
    ValType2 = "valType2";
    ValLen2 = "valLen2";
    Value2 = "value2";
    DomainSep3 = "domainSep3";
    Kind3 = "kind3";
    Key3 = "key3";
    ValType3 = "valType3";
    ValLen3 = "valLen3";
    Value3 = "value3";
}

#[derive(Ledger)]
pub struct ShapesLedger {
    pub literal_published: LedgerCell<Bool<Public>>,
    pub ledger_published: LedgerCell<Bool<Public>>,
    pub domain: LedgerCell<B32<Public>>,
    pub name: LedgerCell<B32<Public>>,
    pub name_len: LedgerCell<Uint<8, Public>>,
    pub symbol: LedgerCell<Bytes<16, Public>>,
    pub symbol_len: LedgerCell<Uint<8, Public>>,
    pub decimals: LedgerCell<Uint<8, Public>>,
}

pub const SHAPES: ShapesLedger = ShapesLedger::new();

fn emit_typed_metadata(
    c: &mut Circuit3,
    domain: &B32<Public>,
    kind: Wire3<FieldT, Public>,
    key: &B32<Public>,
    value_type: Wire3<FieldT, Public>,
    value_len: Wire3<FieldT, Public>,
    value: &BytesN<Public, 189>,
) {
    let mut serializer = Serializer::<Public>::new();
    let mut event_name = [0u8; 32];
    event_name[..METADATA_NAME.len()].copy_from_slice(METADATA_NAME.as_bytes());
    serializer.push_literal(c, &event_name);
    serializer.push_b32(domain);
    serializer.push_uint(kind, 1);
    serializer.push_b32(key);
    serializer.push_uint(value_type, 1);
    serializer.push_uint(value_len, 1);
    serializer.push_bytes_n(value);
    let envelope = serializer.finish::<MISC_SIZE>(c);
    emit_misc(c, envelope);
}

fn emit_literal_typed(
    c: &mut Circuit3,
    domain: &str,
    kind: u8,
    key: &str,
    value_type: u8,
    value: &[u8],
) {
    assert!(domain.len() <= 32);
    assert!(key.len() <= 32);
    assert!(value.len() <= 189);
    let mut envelope = [0u8; MISC_SIZE];
    envelope[..METADATA_NAME.len()].copy_from_slice(METADATA_NAME.as_bytes());
    envelope[32..32 + domain.len()].copy_from_slice(domain.as_bytes());
    envelope[64] = kind;
    envelope[65..65 + key.len()].copy_from_slice(key.as_bytes());
    envelope[97] = value_type;
    envelope[98] = value.len() as u8;
    envelope[99..99 + value.len()].copy_from_slice(value);
    let mut serializer = Serializer::<Public>::new();
    serializer.push_literal(c, &envelope);
    let envelope = serializer.finish::<MISC_SIZE>(c);
    emit_misc(c, envelope);
}

fn emit_standard_typed(
    c: &mut Circuit3,
    domain: &B32<Public>,
    name: &B32<Public>,
    name_len: Wire3<FieldT, Public>,
    symbol: Wire3<FieldT, Public>,
    symbol_len: Wire3<FieldT, Public>,
    decimals: Wire3<FieldT, Public>,
) {
    let kind = c.constant(1u64);
    let text_type = c.constant(VALUE_TYPE_TEXT as u64);
    let uint_type = c.constant(VALUE_TYPE_UINT as u64);
    let name_key = B32::pad(c, "name");
    let symbol_key = B32::pad(c, "symbol");
    let decimals_key = B32::pad(c, "decimals");

    let mut name_value = Serializer::<Public>::new();
    name_value.push_b32(name);
    let name_value = name_value.finish::<189>(c);
    emit_typed_metadata(c, domain, kind, &name_key, text_type, name_len, &name_value);

    let mut symbol_value = Serializer::<Public>::new();
    symbol_value.push_uint(symbol, 16);
    let symbol_value = symbol_value.finish::<189>(c);
    emit_typed_metadata(c, domain, kind, &symbol_key, text_type, symbol_len, &symbol_value);

    let mut decimals_value = Serializer::<Public>::new();
    decimals_value.push_uint(decimals, 1);
    let decimals_value = decimals_value.finish::<189>(c);
    let one = c.constant(1u64);
    emit_typed_metadata(c, domain, kind, &decimals_key, uint_type, one, &decimals_value);
}

pub struct MetadataShapes;

#[contract]
impl MetadataShapes {
    #[circuit]
    pub fn literal3(c: &mut Circuit3) -> Discloses<()> {
        let published = SHAPES.literal_published.read(c);
        let unpublished = c.not(published.field());
        c.assert_with(unpublished, Some("metadata already published"));
        let yes = Bool::constant(c, true);
        SHAPES.literal_published.write(c, &yes);
        emit_literal_typed(c, "umbra:literal", 1, "name", VALUE_TYPE_TEXT, b"Literal Token");
        emit_literal_typed(c, "umbra:literal", 1, "symbol", VALUE_TYPE_TEXT, b"LIT");
        emit_literal_typed(c, "umbra:literal", 1, "decimals", VALUE_TYPE_UINT, &[6]);
        Discloses::of(())
    }

    #[circuit]
    pub fn ledger3(c: &mut Circuit3) -> Discloses<()> {
        let published = SHAPES.ledger_published.read(c);
        let unpublished = c.not(published.field());
        c.assert_with(unpublished, Some("metadata already published"));
        let yes = Bool::constant(c, true);
        SHAPES.ledger_published.write(c, &yes);

        let domain = SHAPES.domain.read(c);
        let name = SHAPES.name.read(c);
        let name_len = SHAPES.name_len.read(c);
        let symbol = SHAPES.symbol.read(c);
        let symbol_len = SHAPES.symbol_len.read(c);
        let decimals = SHAPES.decimals.read(c);
        emit_standard_typed(
            c,
            &domain,
            &name,
            name_len.field(),
            symbol.field(),
            symbol_len.field(),
            decimals.field(),
        );
        Discloses::of(())
    }

    #[circuit]
    pub fn runtime1(
        c: &mut Circuit3,
        #[arg(name = "domainSep")] domain: B32<Private>,
        kind: Uint<8>,
        key: B32<Private>,
        #[arg(name = "valType")] value_type: Uint<8>,
        #[arg(name = "valLen")] value_len: Uint<8>,
        value: BytesN<Private, 189>,
    ) -> Discloses<(DomainSep, Kind, Key, ValType, ValLen, Value)> {
        let domain = domain.disclose_as::<DomainSep>(c);
        let kind = kind.disclose_as::<Kind>(c);
        let key = key.disclose_as::<Key>(c);
        let value_type = value_type.disclose_as::<ValType>(c);
        let value_len = value_len.disclose_as::<ValLen>(c);
        let value = value.disclose_as::<Value>(c);
        emit_typed_metadata(
            c,
            &domain,
            kind.field(),
            &key,
            value_type.field(),
            value_len.field(),
            &value,
        );
        Discloses::of(())
    }

    #[circuit]
    #[allow(clippy::too_many_arguments)]
    pub fn runtime2(
        c: &mut Circuit3,
        #[arg(name = "domainSep1")] d1: B32<Private>,
        #[arg(name = "kind1")] k1: Uint<8>,
        #[arg(name = "key1")] key1: B32<Private>,
        #[arg(name = "valType1")] t1: Uint<8>,
        #[arg(name = "valLen1")] len1: Uint<8>,
        #[arg(name = "value1")] value1: BytesN<Private, 189>,
        #[arg(name = "domainSep2")] d2: B32<Private>,
        #[arg(name = "kind2")] k2: Uint<8>,
        #[arg(name = "key2")] key2: B32<Private>,
        #[arg(name = "valType2")] t2: Uint<8>,
        #[arg(name = "valLen2")] len2: Uint<8>,
        #[arg(name = "value2")] value2: BytesN<Private, 189>,
    ) -> Discloses<(
        DomainSep1,
        Kind1,
        Key1,
        ValType1,
        ValLen1,
        Value1,
        DomainSep2,
        Kind2,
        Key2,
        ValType2,
        ValLen2,
        Value2,
    )> {
        let d1 = d1.disclose_as::<DomainSep1>(c);
        let k1 = k1.disclose_as::<Kind1>(c);
        let key1 = key1.disclose_as::<Key1>(c);
        let t1 = t1.disclose_as::<ValType1>(c);
        let len1 = len1.disclose_as::<ValLen1>(c);
        let value1 = value1.disclose_as::<Value1>(c);
        let d2 = d2.disclose_as::<DomainSep2>(c);
        let k2 = k2.disclose_as::<Kind2>(c);
        let key2 = key2.disclose_as::<Key2>(c);
        let t2 = t2.disclose_as::<ValType2>(c);
        let len2 = len2.disclose_as::<ValLen2>(c);
        let value2 = value2.disclose_as::<Value2>(c);
        emit_typed_metadata(c, &d1, k1.field(), &key1, t1.field(), len1.field(), &value1);
        emit_typed_metadata(c, &d2, k2.field(), &key2, t2.field(), len2.field(), &value2);
        Discloses::of(())
    }

    #[circuit]
    #[allow(clippy::too_many_arguments)]
    pub fn runtime3(
        c: &mut Circuit3,
        #[arg(name = "domainSep1")] d1: B32<Private>,
        #[arg(name = "kind1")] k1: Uint<8>,
        #[arg(name = "key1")] key1: B32<Private>,
        #[arg(name = "valType1")] t1: Uint<8>,
        #[arg(name = "valLen1")] len1: Uint<8>,
        #[arg(name = "value1")] value1: BytesN<Private, 189>,
        #[arg(name = "domainSep2")] d2: B32<Private>,
        #[arg(name = "kind2")] k2: Uint<8>,
        #[arg(name = "key2")] key2: B32<Private>,
        #[arg(name = "valType2")] t2: Uint<8>,
        #[arg(name = "valLen2")] len2: Uint<8>,
        #[arg(name = "value2")] value2: BytesN<Private, 189>,
        #[arg(name = "domainSep3")] d3: B32<Private>,
        #[arg(name = "kind3")] k3: Uint<8>,
        #[arg(name = "key3")] key3: B32<Private>,
        #[arg(name = "valType3")] t3: Uint<8>,
        #[arg(name = "valLen3")] len3: Uint<8>,
        #[arg(name = "value3")] value3: BytesN<Private, 189>,
    ) -> Discloses<(
        (
            DomainSep1,
            Kind1,
            Key1,
            ValType1,
            ValLen1,
            Value1,
            DomainSep2,
            Kind2,
            Key2,
            ValType2,
            ValLen2,
            Value2,
        ),
        (DomainSep3, Kind3, Key3, ValType3, ValLen3, Value3),
    )> {
        let d1 = d1.disclose_as::<DomainSep1>(c);
        let k1 = k1.disclose_as::<Kind1>(c);
        let key1 = key1.disclose_as::<Key1>(c);
        let t1 = t1.disclose_as::<ValType1>(c);
        let len1 = len1.disclose_as::<ValLen1>(c);
        let value1 = value1.disclose_as::<Value1>(c);
        let d2 = d2.disclose_as::<DomainSep2>(c);
        let k2 = k2.disclose_as::<Kind2>(c);
        let key2 = key2.disclose_as::<Key2>(c);
        let t2 = t2.disclose_as::<ValType2>(c);
        let len2 = len2.disclose_as::<ValLen2>(c);
        let value2 = value2.disclose_as::<Value2>(c);
        let d3 = d3.disclose_as::<DomainSep3>(c);
        let k3 = k3.disclose_as::<Kind3>(c);
        let key3 = key3.disclose_as::<Key3>(c);
        let t3 = t3.disclose_as::<ValType3>(c);
        let len3 = len3.disclose_as::<ValLen3>(c);
        let value3 = value3.disclose_as::<Value3>(c);
        emit_typed_metadata(c, &d1, k1.field(), &key1, t1.field(), len1.field(), &value1);
        emit_typed_metadata(c, &d2, k2.field(), &key2, t2.field(), len2.field(), &value2);
        emit_typed_metadata(c, &d3, k3.field(), &key3, t3.field(), len3.field(), &value3);
        Discloses::of(())
    }
}

pub fn circuits() -> [(&'static str, Compiled3); 5] {
    [
        ("literal3", MetadataShapes::literal3()),
        ("ledger3", MetadataShapes::ledger3()),
        ("runtime1", MetadataShapes::runtime1()),
        ("runtime2", MetadataShapes::runtime2()),
        ("runtime3", MetadataShapes::runtime3()),
    ]
}
