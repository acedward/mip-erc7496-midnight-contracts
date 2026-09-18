use minocrab_sim::v3::cost;
use token_metadata_minocrab_benchmark::{circuits, shapes};

fn main() {
    println!("circuit\tk\trows");
    for (name, compiled) in circuits().into_iter().chain(shapes::circuits()) {
        let (k, rows) = cost(&compiled.ir);
        println!("{name}\t{k}\t{rows}");
    }
}
