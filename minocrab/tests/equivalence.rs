use std::borrow::Cow;
use std::path::PathBuf;

use midnight_base_crypto::fab::{
    Alignment, AlignmentAtom, AlignmentSegment, AlignedValue, Value, ValueAtom,
};
use midnight_onchain_state::state::StateValue;
use midnight_onchain_vm::ops::{Key, Op};
use midnight_onchain_vm::result_mode::ResultModeVerify;
use midnight_storage::arena::Sp;
use midnight_storage::db::InMemoryDB;
use midnight_transient_crypto::hash::transient_commit;
use midnight_transient_crypto::proofs::{KeyLocation, ProofPreimage, Zkir};
use midnight_transient_crypto::repr::FieldRepr;
use minocrab::Fr;
use minocrab_sim::v3::{assert_call_compatible, simulate};
use minocrab_zkir::v3::IrSource;
use token_metadata_minocrab_benchmark::{MetadataProbe, Sstar, MISC_SIZE};

type VmOp = Op<ResultModeVerify, InMemoryDB>;

fn compact(name: &str, contract: &str) -> IrSource {
    let root = PathBuf::from(std::env::var_os("COMPACT_V3_DIR").expect("COMPACT_V3_DIR"));
    minocrab_zkir::v3::read_zkir(root.join(contract).join("zkir").join(format!("{name}.zkir")))
        .expect("pinned Compact-v3 artifact parses")
}

fn bytesn_value(n: u32, bytes: &[u8]) -> AlignedValue {
    AlignedValue::new(
        Value(vec![ValueAtom(bytes.to_vec()).normalize()]),
        Alignment(vec![AlignmentSegment::Atom(AlignmentAtom::Bytes { length: n })]),
    )
    .unwrap()
}

fn cell(value: AlignedValue) -> StateValue {
    StateValue::Cell(Sp::new(value))
}

fn field_key(index: u8) -> Key {
    Key::Value(bytesn_value(1, &[index]))
}

fn counter_increment(field: u8) -> Vec<VmOp> {
    vec![
        Op::Idx {
            cached: false,
            push_path: true,
            path: vec![field_key(field)].into(),
        },
        Op::Addi { immediate: 1 },
        Op::Ins { cached: true, n: 1 },
    ]
}

fn counter_read(field: u8, value: u64) -> Vec<VmOp> {
    vec![
        Op::Dup { n: 0 },
        Op::Idx {
            cached: false,
            push_path: false,
            path: vec![field_key(field)].into(),
        },
        Op::Popeq {
            cached: true,
            result: bytesn_value(8, &value.to_le_bytes()),
        },
    ]
}

fn bool_read(field: u8, value: bool) -> Vec<VmOp> {
    vec![
        Op::Dup { n: 0 },
        Op::Idx {
            cached: false,
            push_path: false,
            path: vec![field_key(field)].into(),
        },
        Op::Popeq {
            cached: false,
            result: bytesn_value(1, &[u8::from(value)]),
        },
    ]
}

fn bool_write(field: u8, value: bool) -> Vec<VmOp> {
    vec![
        Op::Push {
            storage: false,
            value: cell(bytesn_value(1, &[field])),
        },
        Op::Push {
            storage: true,
            value: cell(bytesn_value(1, &[u8::from(value)])),
        },
        Op::Ins { cached: false, n: 1 },
    ]
}

fn event_op(bytes: &[u8; MISC_SIZE]) -> Vec<VmOp> {
    vec![
        Op::Push {
            storage: false,
            value: StateValue::Array(
                vec![
                    cell(bytesn_value(4, &1u32.to_le_bytes())),
                    cell(bytesn_value(1, &[10])),
                    cell(bytesn_value(MISC_SIZE as u32, bytes)),
                ]
                .into(),
            ),
        },
        Op::Log,
    ]
}

fn transcript(ops: &[VmOp]) -> Vec<Fr> {
    let mut out = Vec::new();
    for op in ops {
        op.field_repr(&mut out);
    }
    out
}

fn preimage(inputs: Vec<Fr>, ops: Vec<VmOp>, public_outputs: Vec<Fr>) -> ProofPreimage {
    let randomness = Fr::from(0x7496_u64);
    let commitment = transient_commit(&inputs, randomness);
    ProofPreimage {
        inputs,
        private_transcript: vec![],
        public_transcript_inputs: transcript(&ops),
        public_transcript_outputs: public_outputs,
        binding_input: 0.into(),
        communications_commitment: Some((commitment, randomness)),
        key_location: KeyLocation(Cow::Borrowed("token-metadata-minocrab-benchmark")),
    }
}

fn bytes_slots(bytes: &[u8]) -> Vec<Fr> {
    let mut slots: Vec<_> = bytes
        .chunks(31)
        .map(|chunk| Fr::from_le_bytes(chunk).expect("31 bytes fit"))
        .collect();
    slots.reverse();
    slots
}

fn metadata_event(
    domain: &[u8; 32],
    kind: u8,
    key: &[u8; 32],
    len: u8,
    value: &[u8; 190],
) -> [u8; MISC_SIZE] {
    let mut out = [0u8; MISC_SIZE];
    out[..13].copy_from_slice(b"TokenMetadata");
    out[32..64].copy_from_slice(domain);
    out[64] = kind;
    out[65..97].copy_from_slice(key);
    out[97] = len;
    out[98..].copy_from_slice(value);
    out
}

fn padded<const N: usize>(bytes: &[u8]) -> [u8; N] {
    assert!(bytes.len() <= N);
    let mut out = [0u8; N];
    out[..bytes.len()].copy_from_slice(bytes);
    out
}

#[derive(Clone)]
struct RawCase {
    domain: [u8; 32],
    kind: u8,
    key: [u8; 32],
    len: u8,
    value: [u8; 190],
}

impl RawCase {
    fn inputs(&self) -> Vec<Fr> {
        let mut out = bytes_slots(&self.domain);
        out.push(Fr::from(self.kind));
        out.extend(bytes_slots(&self.key));
        out.push(Fr::from(self.len));
        out.extend(bytes_slots(&self.value));
        out
    }

    fn ops(&self) -> Vec<VmOp> {
        let mut ops = counter_increment(0);
        ops.extend(event_op(&metadata_event(
            &self.domain,
            self.kind,
            &self.key,
            self.len,
            &self.value,
        )));
        ops
    }

    fn preimage(&self) -> ProofPreimage {
        preimage(self.inputs(), self.ops(), vec![])
    }
}

#[derive(Clone)]
struct StandardCase {
    domain: [u8; 32],
    kind: u8,
    name: [u8; 32],
    name_len: u8,
    symbol: [u8; 16],
    symbol_len: u8,
    decimals: u8,
}

impl StandardCase {
    fn inputs(&self) -> Vec<Fr> {
        let mut out = bytes_slots(&self.domain);
        out.push(Fr::from(self.kind));
        out.extend(bytes_slots(&self.name));
        out.push(Fr::from(self.name_len));
        out.push(Fr::from_le_bytes(&self.symbol).unwrap());
        out.push(Fr::from(self.symbol_len));
        out.push(Fr::from(self.decimals));
        out
    }

    fn events(&self) -> [[u8; MISC_SIZE]; 3] {
        let mut name_value = [0u8; 190];
        name_value[..32].copy_from_slice(&self.name);
        let mut symbol_value = [0u8; 190];
        symbol_value[..16].copy_from_slice(&self.symbol);
        let mut decimals_value = [0u8; 190];
        decimals_value[0] = self.decimals;
        [
            metadata_event(&self.domain, self.kind, &padded(b"name"), self.name_len, &name_value),
            metadata_event(
                &self.domain,
                self.kind,
                &padded(b"symbol"),
                self.symbol_len,
                &symbol_value,
            ),
            metadata_event(&self.domain, self.kind, &padded(b"decimals"), 1, &decimals_value),
        ]
    }

    fn preimage(&self) -> ProofPreimage {
        let mut ops = counter_increment(0);
        for event in self.events() {
            ops.extend(event_op(&event));
        }
        preimage(self.inputs(), ops, vec![])
    }
}

fn assert_rejects_both(ours: &IrSource, theirs: &IrSource, pi: &ProofPreimage) {
    assert!(simulate(ours, pi).is_err(), "MinoCrab simulator must reject");
    assert!(simulate(theirs, pi).is_err(), "Compact simulator must reject");
    assert!(ours.check(pi).is_err(), "upstream VM must reject MinoCrab artifact");
    assert!(theirs.check(pi).is_err(), "upstream VM must reject Compact artifact");
}

fn sstar_ops(read_value: bool, write_value: bool) -> Vec<VmOp> {
    let domain = padded::<32>(b"umbra:sstar");
    let fields = [
        ("name", b"Shielded Star".as_slice()),
        ("symbol", b"SSTAR".as_slice()),
        ("decimals", &[6u8][..]),
    ];
    let mut ops = bool_read(0, read_value);
    ops.extend(bool_write(0, write_value));
    for (key, value) in fields {
        ops.extend(event_op(&metadata_event(
            &domain,
            1,
            &padded(key.as_bytes()),
            value.len() as u8,
            &padded(value),
        )));
    }
    ops
}

#[test]
fn envelope_is_exactly_288_bytes_with_256_byte_payload() {
    let domain = padded::<32>(b"umbra:probe");
    let key = padded::<32>(b"name");
    let value = padded::<190>(b"Umbra Probe");
    let event = metadata_event(&domain, 1, &key, 11, &value);
    assert_eq!(event.len(), 288);
    assert_eq!(&event[..32], &padded::<32>(b"TokenMetadata"));
    assert_eq!(&event[32..], [&domain[..], &[1], &key[..], &[11], &value[..]].concat());
    assert!(event[98 + 11..].iter().all(|byte| *byte == 0));
}

#[test]
fn publish_raw_matches_compact_at_boundaries_and_limb_edges() {
    let theirs = compact("publishRaw", "MetadataProbe");
    let ours = MetadataProbe::publish_raw().ir;
    let cases = [
        RawCase {
            domain: [0; 32],
            kind: 0,
            key: [0; 32],
            len: 0,
            value: [0; 190],
        },
        RawCase {
            domain: std::array::from_fn(|i| i as u8),
            kind: 255,
            key: std::array::from_fn(|i| (255 - i) as u8),
            len: 190,
            value: std::array::from_fn(|i| (i % 251) as u8),
        },
        RawCase {
            domain: padded(b"31-byte-boundary-domain-value!!"),
            kind: 0x80,
            key: padded(b"reserved-kind-is-still-accepted"),
            len: 191,
            value: [0x55; 190],
        },
        RawCase {
            domain: [255; 32],
            kind: 1,
            key: [255; 32],
            len: 255,
            value: [255; 190],
        },
    ];
    for case in cases {
        assert_call_compatible(&ours, &theirs, &case.preimage());
    }
}

#[test]
fn publish_standard_matches_compact_for_full_uint8_range() {
    let theirs = compact("publishStandard", "MetadataProbe");
    let ours = MetadataProbe::publish_standard().ir;
    let cases = [
        StandardCase {
            domain: [0; 32],
            kind: 0,
            name: [0; 32],
            name_len: 0,
            symbol: [0; 16],
            symbol_len: 0,
            decimals: 0,
        },
        StandardCase {
            domain: std::array::from_fn(|i| (3 * i) as u8),
            kind: 0x80,
            name: std::array::from_fn(|i| (7 * i) as u8),
            name_len: 32,
            symbol: *b"SIXTEEN-BYTE-SYM",
            symbol_len: 16,
            decimals: 36,
        },
        StandardCase {
            domain: [255; 32],
            kind: 255,
            name: [255; 32],
            name_len: 255,
            symbol: [255; 16],
            symbol_len: 255,
            decimals: 255,
        },
    ];
    for case in cases {
        assert_call_compatible(&ours, &theirs, &case.preimage());
    }
}

#[test]
fn fixed_fixture_matches_compact() {
    let domain = padded::<32>(b"umbra:probe");
    let fields = [
        ("name", b"Umbra Probe".as_slice()),
        ("symbol", b"UPROBE".as_slice()),
        ("decimals", &[6u8][..]),
    ];
    let mut ops = counter_increment(0);
    for (key, value) in fields {
        ops.extend(event_op(&metadata_event(
            &domain,
            1,
            &padded(key.as_bytes()),
            value.len() as u8,
            &padded(value),
        )));
    }
    let pi = preimage(vec![], ops, vec![]);
    assert_call_compatible(
        &MetadataProbe::publish_fixture().ir,
        &compact("publishFixture", "MetadataProbe"),
        &pi,
    );
}

#[test]
fn calls_matches_compact_and_returns_counter_value() {
    let value = 0x1020_3040_5060_7080u64;
    let mut pi = preimage(vec![], counter_read(0, value), vec![Fr::from(value)]);
    let randomness = Fr::from(0x7496_u64);
    pi.communications_commitment = Some((transient_commit(&[Fr::from(value)], randomness), randomness));
    assert_call_compatible(
        &MetadataProbe::calls().ir,
        &compact("calls", "MetadataProbe"),
        &pi,
    );
}

#[test]
fn sstar_matches_compact_and_preserves_one_time_guard() {
    let pi = preimage(vec![], sstar_ops(false, true), vec![Fr::from(0u64)]);
    assert_call_compatible(
        &Sstar::publish_metadata().ir,
        &compact("publishMetadata", "SSTAR"),
        &pi,
    );
}

#[test]
fn changed_event_payload_is_rejected_by_both_artifacts_and_upstream_vm() {
    let case = RawCase {
        domain: padded(b"umbra:probe"),
        kind: 1,
        key: padded(b"name"),
        len: 4,
        value: padded(b"test"),
    };
    let mut event = metadata_event(&case.domain, case.kind, &case.key, case.len, &case.value);
    event[98] ^= 1;
    let mut ops = counter_increment(0);
    ops.extend(event_op(&event));
    let pi = preimage(case.inputs(), ops, vec![]);
    assert_rejects_both(
        &MetadataProbe::publish_raw().ir,
        &compact("publishRaw", "MetadataProbe"),
        &pi,
    );
}

#[test]
fn changed_counter_effect_is_rejected_by_both_artifacts_and_upstream_vm() {
    let case = RawCase {
        domain: padded(b"umbra:probe"),
        kind: 1,
        key: padded(b"symbol"),
        len: 3,
        value: padded(b"TOK"),
    };
    let ops = event_op(&metadata_event(
        &case.domain,
        case.kind,
        &case.key,
        case.len,
        &case.value,
    ));
    let pi = preimage(case.inputs(), ops, vec![]);
    assert_rejects_both(
        &MetadataProbe::publish_raw().ir,
        &compact("publishRaw", "MetadataProbe"),
        &pi,
    );
}

#[test]
fn already_published_state_is_rejected_by_both_artifacts_and_upstream_vm() {
    let pi = preimage(vec![], sstar_ops(true, true), vec![Fr::from(1u64)]);
    assert_rejects_both(
        &Sstar::publish_metadata().ir,
        &compact("publishMetadata", "SSTAR"),
        &pi,
    );
}

#[test]
fn out_of_range_uint8_input_is_rejected_by_both_artifacts_and_upstream_vm() {
    let case = RawCase {
        domain: padded(b"umbra:probe"),
        kind: 0,
        key: padded(b"name"),
        len: 1,
        value: padded(b"x"),
    };
    let mut inputs = case.inputs();
    inputs[2] = Fr::from(256u64);
    let pi = preimage(inputs, case.ops(), vec![]);
    assert_rejects_both(
        &MetadataProbe::publish_raw().ir,
        &compact("publishRaw", "MetadataProbe"),
        &pi,
    );
}

#[test]
fn changed_sstar_state_write_is_rejected_by_both_artifacts_and_upstream_vm() {
    let pi = preimage(vec![], sstar_ops(false, false), vec![Fr::from(0u64)]);
    assert_rejects_both(
        &Sstar::publish_metadata().ir,
        &compact("publishMetadata", "SSTAR"),
        &pi,
    );
}
