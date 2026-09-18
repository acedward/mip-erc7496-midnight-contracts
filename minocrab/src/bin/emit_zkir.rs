use std::path::PathBuf;

use minocrab_zkir::v3::to_zkir_string;
use token_metadata_minocrab_benchmark::{circuits, shapes};

fn main() {
    let out = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .expect("usage: emit_zkir <output-directory>");
    std::fs::create_dir_all(&out).expect("create output directory");
    for (name, compiled) in circuits().into_iter().chain(shapes::circuits()) {
        let path = out.join(format!("{name}.zkir"));
        std::fs::write(&path, to_zkir_string(&compiled.ir).expect("serialize ZKIR"))
            .expect("write ZKIR");
        println!("{}", path.display());
    }
}
