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
use token_metadata_minocrab_benchmark::shapes::{
    MetadataShapes, VALUE_TYPE_TEXT, VALUE_TYPE_UINT,
};
use token_metadata_minocrab_benchmark::MISC_SIZE;

type VmOp = Op<ResultModeVerify, InMemoryDB>;

fn compact(name: &str) -> IrSource {
    let root = PathBuf::from(std::env::var_os("COMPACT_V3_DIR").expect("COMPACT_V3_DIR"));
    minocrab_zkir::v3::read_zkir(
        root.join("MetadataShapes")
            .join("zkir")
            .join(format!("{name}.zkir")),
    )
    .expect("pinned Compact-v3 shape artifact parses")
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

fn cell_read(field: u8, n: u32, bytes: &[u8]) -> Vec<VmOp> {
    vec![
        Op::Dup { n: 0 },
        Op::Idx {
            cached: false,
            push_path: false,
            path: vec![field_key(field)].into(),
        },
        Op::Popeq {
            cached: false,
            result: bytesn_value(n, bytes),
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
    let randomness = Fr::from(0x1500_7496_u64);
    let commitment = transient_commit(&inputs, randomness);
    ProofPreimage {
        inputs,
        private_transcript: vec![],
        public_transcript_inputs: transcript(&ops),
        public_transcript_outputs: public_outputs,
        binding_input: 0.into(),
        communications_commitment: Some((commitment, randomness)),
        key_location: KeyLocation(Cow::Borrowed("token-metadata-shapes-benchmark")),
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

fn padded<const N: usize>(bytes: &[u8]) -> [u8; N] {
    assert!(bytes.len() <= N);
    let mut out = [0u8; N];
    out[..bytes.len()].copy_from_slice(bytes);
    out
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct TypedEvent {
    domain: [u8; 32],
    kind: u8,
    key: [u8; 32],
    value_type: u8,
    value_len: u8,
    value: [u8; 189],
}

impl TypedEvent {
    fn inputs(&self) -> Vec<Fr> {
        let mut inputs = bytes_slots(&self.domain);
        inputs.push(Fr::from(self.kind));
        inputs.extend(bytes_slots(&self.key));
        inputs.push(Fr::from(self.value_type));
        inputs.push(Fr::from(self.value_len));
        inputs.extend(bytes_slots(&self.value));
        inputs
    }

    fn envelope(&self) -> [u8; MISC_SIZE] {
        let mut out = [0u8; MISC_SIZE];
        out[..13].copy_from_slice(b"TokenMetadata");
        out[32..64].copy_from_slice(&self.domain);
        out[64] = self.kind;
        out[65..97].copy_from_slice(&self.key);
        out[97] = self.value_type;
        out[98] = self.value_len;
        out[99..].copy_from_slice(&self.value);
        out
    }
}

fn runtime_preimage(events: &[TypedEvent]) -> ProofPreimage {
    let mut inputs = Vec::new();
    let mut ops = Vec::new();
    for event in events {
        inputs.extend(event.inputs());
        ops.extend(event_op(&event.envelope()));
    }
    preimage(inputs, ops, vec![])
}

fn assert_accepts_both(ours: &IrSource, theirs: &IrSource, pi: &ProofPreimage) {
    assert_call_compatible(ours, theirs, pi);
    assert!(ours.check(pi).is_ok(), "upstream check must accept MinoCrab artifact");
    assert!(theirs.check(pi).is_ok(), "upstream check must accept Compact artifact");
}

fn assert_rejects_both(ours: &IrSource, theirs: &IrSource, pi: &ProofPreimage) {
    assert!(simulate(ours, pi).is_err(), "MinoCrab simulator must reject");
    assert!(simulate(theirs, pi).is_err(), "Compact simulator must reject");
    assert!(ours.check(pi).is_err(), "upstream check must reject MinoCrab artifact");
    assert!(theirs.check(pi).is_err(), "upstream check must reject Compact artifact");
}

fn literal_events() -> [TypedEvent; 3] {
    [
        TypedEvent {
            domain: padded(b"umbra:literal"),
            kind: 1,
            key: padded(b"name"),
            value_type: VALUE_TYPE_TEXT,
            value_len: 13,
            value: padded(b"Literal Token"),
        },
        TypedEvent {
            domain: padded(b"umbra:literal"),
            kind: 1,
            key: padded(b"symbol"),
            value_type: VALUE_TYPE_TEXT,
            value_len: 3,
            value: padded(b"LIT"),
        },
        TypedEvent {
            domain: padded(b"umbra:literal"),
            kind: 1,
            key: padded(b"decimals"),
            value_type: VALUE_TYPE_UINT,
            value_len: 1,
            value: padded(&[6]),
        },
    ]
}

fn literal_ops(read: bool, write: bool) -> Vec<VmOp> {
    let mut ops = cell_read(0, 1, &[u8::from(read)]);
    ops.extend(bool_write(0, write));
    for event in literal_events() {
        ops.extend(event_op(&event.envelope()));
    }
    ops
}

#[derive(Clone)]
struct LedgerValues {
    domain: [u8; 32],
    name: [u8; 32],
    name_len: u8,
    symbol: [u8; 16],
    symbol_len: u8,
    decimals: u8,
}

impl LedgerValues {
    fn events(&self) -> [TypedEvent; 3] {
        [
            TypedEvent {
                domain: self.domain,
                kind: 1,
                key: padded(b"name"),
                value_type: VALUE_TYPE_TEXT,
                value_len: self.name_len,
                value: padded(&self.name),
            },
            TypedEvent {
                domain: self.domain,
                kind: 1,
                key: padded(b"symbol"),
                value_type: VALUE_TYPE_TEXT,
                value_len: self.symbol_len,
                value: padded(&self.symbol),
            },
            TypedEvent {
                domain: self.domain,
                kind: 1,
                key: padded(b"decimals"),
                value_type: VALUE_TYPE_UINT,
                value_len: 1,
                value: padded(&[self.decimals]),
            },
        ]
    }

    fn public_outputs(&self, published: bool) -> Vec<Fr> {
        let mut outputs = vec![Fr::from(u64::from(published))];
        outputs.extend(bytes_slots(&self.domain));
        outputs.extend(bytes_slots(&self.name));
        outputs.push(Fr::from(self.name_len));
        outputs.push(Fr::from_le_bytes(&self.symbol).expect("16 bytes fit"));
        outputs.push(Fr::from(self.symbol_len));
        outputs.push(Fr::from(self.decimals));
        outputs
    }
}

fn ledger_ops(
    read: &LedgerValues,
    emitted: &LedgerValues,
    published: bool,
    write: bool,
) -> Vec<VmOp> {
    let mut ops = cell_read(1, 1, &[u8::from(published)]);
    ops.extend(bool_write(1, write));
    ops.extend(cell_read(2, 32, &read.domain));
    ops.extend(cell_read(3, 32, &read.name));
    ops.extend(cell_read(4, 1, &[read.name_len]));
    ops.extend(cell_read(5, 16, &read.symbol));
    ops.extend(cell_read(6, 1, &[read.symbol_len]));
    ops.extend(cell_read(7, 1, &[read.decimals]));
    for event in emitted.events() {
        ops.extend(event_op(&event.envelope()));
    }
    ops
}

fn ledger_preimage(values: &LedgerValues) -> ProofPreimage {
    preimage(
        vec![],
        ledger_ops(values, values, false, true),
        values.public_outputs(false),
    )
}

fn runtime_cases() -> [TypedEvent; 4] {
    [
        TypedEvent {
            domain: [0; 32],
            kind: 0,
            key: [0; 32],
            value_type: 0,
            value_len: 0,
            value: [0; 189],
        },
        TypedEvent {
            domain: std::array::from_fn(|i| i as u8),
            kind: 255,
            key: std::array::from_fn(|i| (255 - i) as u8),
            value_type: 255,
            value_len: 189,
            value: std::array::from_fn(|i| (i % 251) as u8),
        },
        TypedEvent {
            domain: padded(b"31-byte-boundary-domain-value!!"),
            kind: 0x80,
            key: padded(b"typed-value-length-above-cap"),
            value_type: 7,
            value_len: 190,
            value: [0x55; 189],
        },
        TypedEvent {
            domain: [255; 32],
            kind: 1,
            key: [255; 32],
            value_type: 255,
            value_len: 255,
            value: [255; 189],
        },
    ]
}

#[test]
fn typed_envelope_has_exact_offsets_and_288_bytes() {
    let event = &runtime_cases()[1];
    let envelope = event.envelope();
    assert_eq!(envelope.len(), 288);
    assert_eq!(&envelope[..32], &padded::<32>(b"TokenMetadata"));
    assert_eq!(&envelope[32..64], &event.domain);
    assert_eq!(envelope[64], event.kind);
    assert_eq!(&envelope[65..97], &event.key);
    assert_eq!(envelope[97], event.value_type);
    assert_eq!(envelope[98], event.value_len);
    assert_eq!(&envelope[99..], &event.value);
}

#[test]
fn literal3_matches_with_complete_guard_write_and_events() {
    let pi = preimage(vec![], literal_ops(false, true), vec![Fr::from(0u64)]);
    assert_accepts_both(&MetadataShapes::literal3().ir, &compact("literal3"), &pi);
}

#[test]
fn ledger3_matches_two_runtime_states_and_changes_event_bytes() {
    let first = LedgerValues {
        domain: padded(b"umbra:ledger:a"),
        name: padded(b"Ledger Alpha"),
        name_len: 12,
        symbol: padded(b"LGA"),
        symbol_len: 3,
        decimals: 6,
    };
    let second = LedgerValues {
        domain: std::array::from_fn(|i| (i * 3) as u8),
        name: [255; 32],
        name_len: 255,
        symbol: [0x55; 16],
        symbol_len: 16,
        decimals: 255,
    };
    assert_ne!(first.events(), second.events());
    for values in [&first, &second] {
        let pi = ledger_preimage(values);
        assert_accepts_both(&MetadataShapes::ledger3().ir, &compact("ledger3"), &pi);
    }
}

#[test]
fn runtime1_matches_boundaries_full_uint8_ranges_and_limb_edges() {
    for event in runtime_cases() {
        let pi = runtime_preimage(&[event]);
        assert_accepts_both(&MetadataShapes::runtime1().ir, &compact("runtime1"), &pi);
    }
}

#[test]
fn runtime2_and_runtime3_match_independent_tuples() {
    let cases = runtime_cases();
    let two = [cases[0].clone(), cases[2].clone()];
    let three = [cases[0].clone(), cases[1].clone(), cases[3].clone()];
    assert_ne!(two[0].envelope(), two[1].envelope());
    assert_ne!(three[0].envelope(), three[1].envelope());
    assert_ne!(three[1].envelope(), three[2].envelope());
    assert_accepts_both(
        &MetadataShapes::runtime2().ir,
        &compact("runtime2"),
        &runtime_preimage(&two),
    );
    assert_accepts_both(
        &MetadataShapes::runtime3().ir,
        &compact("runtime3"),
        &runtime_preimage(&three),
    );
}

#[test]
fn runtime1_rejects_type_length_and_value_mutations() {
    let event = runtime_cases()[1].clone();
    let ours = MetadataShapes::runtime1().ir;
    let theirs = compact("runtime1");
    for offset in [97usize, 98, 99] {
        let mut envelope = event.envelope();
        envelope[offset] ^= 1;
        let pi = preimage(event.inputs(), event_op(&envelope), vec![]);
        assert_rejects_both(&ours, &theirs, &pi);
    }
}

#[test]
fn runtime_ladder_rejects_wrong_event_order_and_count() {
    let cases = runtime_cases();
    let two = [cases[0].clone(), cases[2].clone()];
    let mut swapped_ops = event_op(&two[1].envelope());
    swapped_ops.extend(event_op(&two[0].envelope()));
    let mut inputs = two[0].inputs();
    inputs.extend(two[1].inputs());
    let swapped = preimage(inputs.clone(), swapped_ops, vec![]);
    assert_rejects_both(&MetadataShapes::runtime2().ir, &compact("runtime2"), &swapped);

    let missing = preimage(inputs, event_op(&two[0].envelope()), vec![]);
    assert_rejects_both(&MetadataShapes::runtime2().ir, &compact("runtime2"), &missing);

    let three = [cases[0].clone(), cases[1].clone(), cases[3].clone()];
    let mut ops = event_op(&three[0].envelope());
    ops.extend(event_op(&three[1].envelope()));
    let mut inputs = Vec::new();
    for event in &three {
        inputs.extend(event.inputs());
    }
    let missing_third = preimage(inputs, ops, vec![]);
    assert_rejects_both(
        &MetadataShapes::runtime3().ir,
        &compact("runtime3"),
        &missing_third,
    );
}

#[test]
fn ledger3_rejects_read_event_mismatch_with_consistent_witness_output() {
    let emitted = LedgerValues {
        domain: padded(b"umbra:ledger:bound"),
        name: padded(b"Bound Ledger"),
        name_len: 12,
        symbol: padded(b"BND"),
        symbol_len: 3,
        decimals: 6,
    };
    let mut read = emitted.clone();
    read.domain[0] ^= 1;
    let pi = preimage(
        vec![],
        ledger_ops(&read, &emitted, false, true),
        read.public_outputs(false),
    );
    assert_rejects_both(&MetadataShapes::ledger3().ir, &compact("ledger3"), &pi);
}

#[test]
fn complete_literal_and_ledger_transcripts_reject_guard_or_write_mutations() {
    let literal_guard = preimage(vec![], literal_ops(true, true), vec![Fr::from(1u64)]);
    assert_rejects_both(
        &MetadataShapes::literal3().ir,
        &compact("literal3"),
        &literal_guard,
    );
    let literal_write = preimage(vec![], literal_ops(false, false), vec![Fr::from(0u64)]);
    assert_rejects_both(
        &MetadataShapes::literal3().ir,
        &compact("literal3"),
        &literal_write,
    );

    let values = LedgerValues {
        domain: padded(b"umbra:ledger:guard"),
        name: padded(b"Guard Ledger"),
        name_len: 12,
        symbol: padded(b"GRD"),
        symbol_len: 3,
        decimals: 8,
    };
    let ledger_guard = preimage(
        vec![],
        ledger_ops(&values, &values, true, true),
        values.public_outputs(true),
    );
    assert_rejects_both(
        &MetadataShapes::ledger3().ir,
        &compact("ledger3"),
        &ledger_guard,
    );
    let ledger_write = preimage(
        vec![],
        ledger_ops(&values, &values, false, false),
        values.public_outputs(false),
    );
    assert_rejects_both(
        &MetadataShapes::ledger3().ir,
        &compact("ledger3"),
        &ledger_write,
    );
}

#[test]
fn runtime_input_range_is_enforced() {
    let event = runtime_cases()[0].clone();
    let mut inputs = event.inputs();
    inputs[2] = Fr::from(256u64); // kind follows the two Bytes<32> limbs
    let pi = preimage(inputs, event_op(&event.envelope()), vec![]);
    assert_rejects_both(&MetadataShapes::runtime1().ir, &compact("runtime1"), &pi);
}
