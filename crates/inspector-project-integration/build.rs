use std::{env, fs, path::{Path, PathBuf}, process::Command};

use serde_json::Value;
use sha2::{Digest, Sha256};
use walkdir::WalkDir;

fn main() {
    let crate_root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("manifest directory"));
    let adapter_root = crate_root.join("../../adapters/dotnet");
    let manifest_path = adapter_root.join("adapter.json");
    let manifest_bytes = fs::read(&manifest_path).expect("read dotnet adapter manifest");
    let manifest: Value = serde_json::from_slice(&manifest_bytes).expect("parse dotnet adapter manifest");
    let package_relative = manifest["package"]["file"].as_str().expect("package file");
    let digest_relative = manifest["package"]["sha256File"].as_str().expect("package digest file");
    let package_path = adapter_root.join(package_relative);
    let digest_path = adapter_root.join(digest_relative);
    if !package_path.is_file() || !digest_path.is_file() {
        let build_script = adapter_root.join("HttpInspector.Adapter/build-bundle.sh");
        let status = Command::new("bash").arg(&build_script).status().expect("run adapter package build prerequisite");
        assert!(status.success(), "adapter package build prerequisite failed: {}", build_script.display());
    }
    let package_bytes = fs::read(&package_path).expect("adapter package must be built before Rust packaging");
    let expected_digest = fs::read_to_string(&digest_path).expect("read adapter package digest");
    let actual_digest = hex_digest(&package_bytes);
    assert_eq!(expected_digest.trim(), actual_digest, "adapter package digest mismatch");
    assert_eq!(manifest["package"]["sha256"].as_str().expect("manifest package digest"), actual_digest, "adapter package digest must match its immutable manifest identity");
    let expected_filename = format!("{}.{}.nupkg", manifest["package"]["id"].as_str().expect("package id"), manifest["package"]["version"].as_str().expect("package version"));
    assert_eq!(package_path.file_name().and_then(|value| value.to_str()), Some(expected_filename.as_str()), "adapter package filename must match its declared identity");
    for (name, value) in manifest["integration"].as_object().expect("integration entrypoints") {
        if matches!(name.as_str(), "shell" | "strategy") { continue; }
        let relative = value.as_str().expect("integration entrypoint path");
        assert!(adapter_root.join(relative).is_file(), "declared integration entrypoint is missing: {relative}");
    }

    let mut paths = vec![manifest_path, package_path, digest_path, adapter_root.join("HttpInspector.Adapter/README.md")];
    let integration_root = adapter_root.join("HttpInspector.Adapter.Integration");
    paths.extend(WalkDir::new(&integration_root).follow_links(false).into_iter().map(Result::unwrap)
        .filter(|entry| entry.file_type().is_file()).map(|entry| entry.into_path()));
    paths.sort();
    paths.dedup();

    let mut payload_hasher = Sha256::new();
    let mut generated = String::from("pub(crate) const EMBEDDED_FILES: &[EmbeddedFile] = &[\n");
    for path in paths {
        println!("cargo:rerun-if-changed={}", path.display());
        assert!(!path.is_symlink(), "payload file cannot be a symlink: {}", path.display());
        let relative = path.strip_prefix(&adapter_root).expect("payload path inside adapter root").to_string_lossy().replace('\\', "/");
        let bytes = fs::read(&path).expect("read payload file");
        payload_hasher.update((relative.len() as u64).to_le_bytes());
        payload_hasher.update(relative.as_bytes());
        payload_hasher.update((bytes.len() as u64).to_le_bytes());
        payload_hasher.update(&bytes);
        let executable = relative.ends_with(".sh");
        generated.push_str(&format!("    EmbeddedFile {{ relative_path: {relative:?}, bytes: include_bytes!({path:?}), executable: {executable} }},\n", path = path.display().to_string()));
    }
    generated.push_str("];\n");
    generated.push_str(&format!("pub const EMBEDDED_PAYLOAD_DIGEST: &str = {:?};\n", format!("{:x}", payload_hasher.finalize())));
    generated.push_str(&format!("pub const EMBEDDED_ADAPTER_VERSION: &str = {:?};\n", manifest["version"].as_str().expect("adapter version")));
    generated.push_str(&format!("pub const EMBEDDED_PACKAGE_ID: &str = {:?};\n", manifest["package"]["id"].as_str().expect("package id")));
    generated.push_str(&format!("pub const EMBEDDED_PACKAGE_VERSION: &str = {:?};\n", manifest["package"]["version"].as_str().expect("package version")));
    generated.push_str(&format!("pub const EMBEDDED_PACKAGE_FILE: &str = {:?};\n", package_relative));
    generated.push_str(&format!("pub const EMBEDDED_PACKAGE_DIGEST: &str = {:?};\n", actual_digest));
    fs::write(Path::new(&env::var("OUT_DIR").expect("out directory")).join("payload_manifest.rs"), generated).expect("write payload manifest");
}

fn hex_digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
