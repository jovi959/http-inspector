use std::{fs, path::{Component, Path, PathBuf}};

use sha2::{Digest, Sha256};

use crate::IntegrationError;

pub(crate) struct EmbeddedFile { pub relative_path: &'static str, pub bytes: &'static [u8], pub executable: bool }
include!(concat!(env!("OUT_DIR"), "/payload_manifest.rs"));

#[derive(Clone)]
pub(crate) struct MaterializedPayload {
    pub root: PathBuf,
    pub package_file: PathBuf,
    pub package_digest: String,
}

pub(crate) fn materialize(state_root: &Path) -> Result<MaterializedPayload, IntegrationError> {
    let root = state_root.join("adapter-payloads").join("dotnet-httpclient").join(EMBEDDED_ADAPTER_VERSION).join(EMBEDDED_PAYLOAD_DIGEST);
    reject_payload_symlink(state_root, &root)?;
    if root.exists() { return verify_payload(&root); }
    let parent = root.parent().ok_or_else(|| IntegrationError::new("unsafePayloadRoot", root.display().to_string()))?;
    fs::create_dir_all(parent).map_err(io_error)?;
    reject_payload_symlink(state_root, parent)?;
    let staging = parent.join(format!(".{}.staging-{}", EMBEDDED_PAYLOAD_DIGEST, uuid::Uuid::new_v4()));
    fs::create_dir(&staging).map_err(io_error)?;
    let staged = (|| {
        reject_payload_symlink(state_root, &staging)?;
        write_payload(&staging)?;
        verify_payload(&staging)
    })();
    if let Err(error) = staged {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    if let Err(error) = fs::rename(&staging, &root) {
        if root.exists() {
            let _ = fs::remove_dir_all(&staging);
            return verify_payload(&root);
        }
        let _ = fs::remove_dir_all(&staging);
        return Err(io_error(error));
    }
    verify_payload(&root)
}

fn write_payload(root: &Path) -> Result<(), IntegrationError> {
    for embedded in EMBEDDED_FILES {
        let relative = Path::new(embedded.relative_path);
        if relative.is_absolute() || relative.components().any(|component| !matches!(component, Component::Normal(_))) {
            return Err(IntegrationError::new("unsafeEmbeddedPath", embedded.relative_path));
        }
        let target = root.join(relative);
        if let Some(parent) = target.parent() { fs::create_dir_all(parent).map_err(io_error)?; }
        if target.is_symlink() { return Err(IntegrationError::new("payloadSymlinkRejected", target.display().to_string())); }
        fs::write(&target, embedded.bytes).map_err(io_error)?;
        #[cfg(unix)] if embedded.executable {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&target, fs::Permissions::from_mode(0o755)).map_err(io_error)?;
        }
    }
    Ok(())
}

fn verify_payload(root: &Path) -> Result<MaterializedPayload, IntegrationError> {
    if root.is_symlink() || !root.is_dir() { return Err(IntegrationError::new("payloadVerificationFailed", root.display().to_string())); }
    for embedded in EMBEDDED_FILES {
        let target = root.join(embedded.relative_path);
        let metadata = fs::symlink_metadata(&target).map_err(io_error)?;
        if metadata.file_type().is_symlink() || !metadata.is_file() || fs::read(&target).map_err(io_error)? != embedded.bytes {
            return Err(IntegrationError::new("payloadVerificationFailed", target.display().to_string()));
        }
    }
    let package_file = root.join(EMBEDDED_PACKAGE_FILE);
    let bytes = fs::read(&package_file).map_err(io_error)?;
    let package_digest = format!("{:x}", Sha256::digest(bytes));
    if package_digest != EMBEDDED_PACKAGE_DIGEST {
        return Err(IntegrationError::new("payloadDigestMismatch", "The exported adapter package does not match its embedded digest."));
    }
    Ok(MaterializedPayload { root: root.to_path_buf(), package_file, package_digest })
}

pub(crate) fn garbage_collect(state_root: &Path, current_root: &Path, referenced_roots: &[PathBuf], catalog_valid: bool) -> Result<(), IntegrationError> {
    if !catalog_valid { return Ok(()); }
    let adapter_root = state_root.join("adapter-payloads/dotnet-httpclient");
    if !adapter_root.is_dir() { return Ok(()); }
    for version_entry in fs::read_dir(&adapter_root).map_err(io_error)? {
        let version_entry = version_entry.map_err(io_error)?;
        if !version_entry.file_type().map_err(io_error)?.is_dir() || version_entry.path().is_symlink() { continue; }
        for digest_entry in fs::read_dir(version_entry.path()).map_err(io_error)? {
            let digest_entry = digest_entry.map_err(io_error)?;
            let candidate = digest_entry.path();
            let digest = digest_entry.file_name();
            let digest = digest.to_string_lossy();
            if !digest_entry.file_type().map_err(io_error)?.is_dir() || candidate.is_symlink() || digest.len() != 64 || !digest.bytes().all(|value| value.is_ascii_hexdigit()) { continue; }
            if candidate == current_root || referenced_roots.iter().any(|referenced| referenced == &candidate) { continue; }
            fs::remove_dir_all(&candidate).map_err(io_error)?;
        }
        let _ = fs::remove_dir(version_entry.path());
    }
    Ok(())
}

fn reject_payload_symlink(state_root: &Path, root: &Path) -> Result<(), IntegrationError> {
    let mut current = state_root.to_path_buf();
    if fs::symlink_metadata(&current).map(|metadata| metadata.file_type().is_symlink()).unwrap_or(false) {
        return Err(IntegrationError::new("payloadSymlinkRejected", current.display().to_string()));
    }
    let relative = root.strip_prefix(state_root).map_err(|_| IntegrationError::new("unsafePayloadRoot", root.display().to_string()))?;
    for component in relative.components() {
        current.push(component.as_os_str());
        if fs::symlink_metadata(&current).map(|metadata| metadata.file_type().is_symlink()).unwrap_or(false) {
            return Err(IntegrationError::new("payloadSymlinkRejected", current.display().to_string()));
        }
    }
    Ok(())
}

fn io_error(error: std::io::Error) -> IntegrationError { IntegrationError::new("payloadIoFailed", error.to_string()) }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retention_removes_only_unreferenced_application_digest_directories() {
        let state_root = std::env::temp_dir().join(format!("http-inspector-retention-{}", uuid::Uuid::new_v4()));
        let version_root = state_root.join("adapter-payloads/dotnet-httpclient/1.0.0");
        let current = version_root.join("a".repeat(64));
        let referenced = version_root.join("b".repeat(64));
        let stale = version_root.join("c".repeat(64));
        for path in [&current, &referenced, &stale] { fs::create_dir_all(path).expect("create payload fixture"); }
        garbage_collect(&state_root, &current, std::slice::from_ref(&referenced), true).expect("collect unreferenced payload");
        assert!(current.is_dir());
        assert!(referenced.is_dir());
        assert!(!stale.exists());
        fs::remove_dir_all(state_root).expect("remove payload fixture");
    }

    #[test]
    fn uncertain_catalog_preserves_unreferenced_payloads() {
        let state_root = std::env::temp_dir().join(format!("http-inspector-retention-{}", uuid::Uuid::new_v4()));
        let current = state_root.join(format!("adapter-payloads/dotnet-httpclient/1.0.0/{}", "a".repeat(64)));
        let uncertain = state_root.join(format!("adapter-payloads/dotnet-httpclient/1.0.0/{}", "b".repeat(64)));
        for path in [&current, &uncertain] { fs::create_dir_all(path).expect("create payload fixture"); }
        garbage_collect(&state_root, &current, &[], false).expect("preserve uncertain payload");
        assert!(uncertain.is_dir());
        fs::remove_dir_all(state_root).expect("remove payload fixture");
    }
}
