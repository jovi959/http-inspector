//! Index of GUID and integer values named by constants in the integrated projects' source code.

use std::{collections::BTreeMap, fs, path::{Path, PathBuf}, time::{SystemTime, UNIX_EPOCH}};

use serde::{Deserialize, Serialize};

use crate::{csharp_constants::scan_csharp, IntegrationError};

const CACHE_FILE: &str = "value-names.json";
const SOURCES_FILE: &str = "value-name-sources.json";
/// Bump when the scanner's output changes so old caches are rebuilt automatically.
const INDEX_VERSION: u32 = 2;
const SKIPPED_DIRECTORIES: &[&str] = &["bin", "obj", "node_modules", "packages", "TestResults", "dist", "target"];
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_FILES: usize = 50_000;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ValueNamesRequest {
    #[serde(default)]
    pub refresh: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ValueNameSourceRequest {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ValueName {
    pub name: String,
    pub file: String,
    pub line: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ValueNameIndex {
    #[serde(default)]
    pub version: u32,
    pub roots: Vec<String>,
    pub scanned_at_epoch_seconds: u64,
    pub files_scanned: usize,
    pub entries: BTreeMap<String, Vec<ValueName>>,
}

/// Returns the cached index unless a refresh is requested, the source roots changed, or the scanner changed.
/// Roots are the integrated projects plus the folder the user chose, so names work without an active integration.
pub(crate) fn load_or_scan(state_root: &Path, project_roots: &[String], refresh: bool) -> Result<ValueNameIndex, IntegrationError> {
    let mut requested = project_roots.to_vec();
    requested.extend(saved_sources(state_root));
    let roots = source_roots(&requested);
    let cache = state_root.join(CACHE_FILE);
    if !refresh {
        if let Some(cached) = read_cache(&cache).filter(|cached| cached.version == INDEX_VERSION && cached.roots == roots) { return Ok(cached); }
    }
    let index = scan(&roots);
    write_cache(state_root, &index)?;
    Ok(index)
}

/// Remembers the folder the user chose to scan (replacing any earlier choice).
pub(crate) fn set_source(state_root: &Path, path: &str) -> Result<(), IntegrationError> {
    let folder = Path::new(path);
    if !folder.is_absolute() || !folder.is_dir() {
        return Err(IntegrationError::new("invalidValueNameSource", "Choose an existing source folder to scan for value names."));
    }
    let bytes = serde_json::to_vec(&[path]).map_err(|error| IntegrationError::new("valueNamesCacheFailed", error.to_string()))?;
    write_atomically(state_root, SOURCES_FILE, &bytes)
}

fn saved_sources(state_root: &Path) -> Vec<String> {
    fs::read(state_root.join(SOURCES_FILE)).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
}

/// An integrated project is a `.csproj` folder; its constants often live in sibling projects, so scan the whole repository.
fn source_roots(project_roots: &[String]) -> Vec<String> {
    let mut roots: Vec<String> = project_roots.iter().map(|root| source_root(Path::new(root)).display().to_string()).collect();
    roots.sort();
    roots.dedup();
    let all = roots.clone();
    roots.retain(|root| !all.iter().any(|other| other != root && Path::new(root).starts_with(other)));
    roots
}

fn source_root(project_root: &Path) -> PathBuf {
    project_root.ancestors().find(|ancestor| ancestor.join(".git").exists()).unwrap_or(project_root).to_path_buf()
}

fn scan(roots: &[String]) -> ValueNameIndex {
    let mut entries: BTreeMap<String, Vec<ValueName>> = BTreeMap::new();
    let mut files_scanned = 0;
    for root in roots {
        let root_path = Path::new(root);
        let mut files = Vec::new();
        collect_source_files(root_path, &mut files);
        files.sort();
        for file in files {
            let Ok(source) = fs::read_to_string(&file) else { continue; };
            files_scanned += 1;
            let relative = file.strip_prefix(root_path).unwrap_or(&file).to_string_lossy().replace('\\', "/");
            for found in scan_csharp(&source) {
                let names = entries.entry(found.value).or_default();
                if !names.iter().any(|existing| existing.name == found.name) {
                    names.push(ValueName { name: found.name, file: relative.clone(), line: found.line });
                }
            }
        }
    }
    for names in entries.values_mut() { names.sort_by(|left, right| left.name.cmp(&right.name)); }
    let scanned_at_epoch_seconds = SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_secs()).unwrap_or_default();
    ValueNameIndex { version: INDEX_VERSION, roots: roots.to_vec(), scanned_at_epoch_seconds, files_scanned, entries }
}

fn collect_source_files(directory: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(directory) else { return; };
    for entry in entries.flatten() {
        if files.len() >= MAX_FILES { return; }
        let Ok(file_type) = entry.file_type() else { continue; };
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if file_type.is_dir() {
            if !name.starts_with('.') && !SKIPPED_DIRECTORIES.contains(&name.as_str()) { collect_source_files(&path, files); }
        } else if file_type.is_file() && name.ends_with(".cs") && entry.metadata().is_ok_and(|metadata| metadata.len() <= MAX_FILE_BYTES) {
            files.push(path);
        }
    }
}

fn read_cache(cache: &Path) -> Option<ValueNameIndex> {
    serde_json::from_slice(&fs::read(cache).ok()?).ok()
}

fn write_cache(state_root: &Path, index: &ValueNameIndex) -> Result<(), IntegrationError> {
    let bytes = serde_json::to_vec(index).map_err(|error| IntegrationError::new("valueNamesCacheFailed", error.to_string()))?;
    write_atomically(state_root, CACHE_FILE, &bytes)
}

fn write_atomically(state_root: &Path, file_name: &str, bytes: &[u8]) -> Result<(), IntegrationError> {
    let failed = |error: std::io::Error| IntegrationError::new("valueNamesCacheFailed", error.to_string());
    fs::create_dir_all(state_root).map_err(failed)?;
    let staging = state_root.join(format!("{file_name}.tmp-{}", uuid::Uuid::new_v4()));
    fs::write(&staging, bytes).map_err(failed)?;
    fs::rename(&staging, state_root.join(file_name)).map_err(|error| {
        let _ = fs::remove_file(&staging);
        failed(error)
    })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn names(index: &ValueNameIndex, value: &str) -> Vec<String> {
        index.entries.get(value).map(|names| names.iter().map(|name| name.name.clone()).collect()).unwrap_or_default()
    }

    fn fixture() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("http-inspector-value-names-{}", uuid::Uuid::new_v4()));
        let repository = root.join("repository");
        fs::create_dir_all(repository.join(".git")).expect("create repository marker");
        fs::create_dir_all(repository.join("src/Api/bin/Debug")).expect("create api project");
        fs::create_dir_all(repository.join("src/Models")).expect("create sibling project");
        fs::write(repository.join("src/Api/Api.csproj"), "<Project />").expect("write project file");
        fs::write(repository.join("src/Models/Codes.cs"), "public static class Codes\n{\n    public const int Primary = 100000033;\n}\n").expect("write sibling constants");
        fs::write(repository.join("src/Api/bin/Debug/Generated.cs"), "public static class Generated { public const int Skipped = 100000077; }\n").expect("write build output");
        root
    }

    #[test]
    fn scans_the_whole_repository_of_an_integrated_project_but_skips_build_output() {
        let root = fixture();
        let project = root.join("repository/src/Api").display().to_string();

        let index = load_or_scan(&root.join("state"), &[project], false).expect("scan source");

        assert_eq!(index.roots, vec![root.join("repository").display().to_string()]);
        assert_eq!(names(&index, "100000033"), vec!["Codes.Primary"]);
        assert_eq!(index.entries["100000033"][0].file, "src/Models/Codes.cs");
        assert_eq!(index.entries["100000033"][0].line, 3);
        assert!(names(&index, "100000077").is_empty(), "bin output must not be scanned");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn keeps_the_cached_index_until_a_refresh_is_requested() {
        let root = fixture();
        let project = root.join("repository/src/Api").display().to_string();
        let state = root.join("state");
        load_or_scan(&state, std::slice::from_ref(&project), false).expect("first scan");
        fs::write(root.join("repository/src/Models/Codes.cs"), "public static class Codes { public const int Primary = 100000044; }\n").expect("change constants");

        let cached = load_or_scan(&state, std::slice::from_ref(&project), false).expect("cached index");
        let refreshed = load_or_scan(&state, &[project], true).expect("refreshed index");

        assert_eq!(names(&cached, "100000033"), vec!["Codes.Primary"]);
        assert!(names(&cached, "100000044").is_empty());
        assert_eq!(names(&refreshed, "100000044"), vec!["Codes.Primary"]);
        assert!(names(&refreshed, "100000033").is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn scans_a_chosen_source_folder_when_no_project_is_integrated() {
        let root = fixture();
        let state = root.join("state");

        set_source(&state, &root.join("repository/src/Models").display().to_string()).expect("save source folder");
        let index = load_or_scan(&state, &[], false).expect("scan chosen folder");

        assert_eq!(index.roots, vec![root.join("repository").display().to_string()]);
        assert_eq!(names(&index, "100000033"), vec!["Codes.Primary"]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_a_source_folder_that_is_relative_or_missing() {
        let state = std::env::temp_dir().join(format!("http-inspector-value-names-{}", uuid::Uuid::new_v4()));

        assert_eq!(set_source(&state, "relative/folder").expect_err("relative path").code, "invalidValueNameSource");
        assert_eq!(set_source(&state, &state.join("missing").display().to_string()).expect_err("missing folder").code, "invalidValueNameSource");
    }

    #[test]
    fn rescans_a_cache_written_by_an_older_scanner() {
        let root = fixture();
        let project = root.join("repository/src/Api").display().to_string();
        let state = root.join("state");
        let current = load_or_scan(&state, std::slice::from_ref(&project), false).expect("first scan");
        let mut stale = current.clone();
        stale.version = 1;
        stale.entries.insert("100000099".into(), vec![ValueName { name: "Stale.Name".into(), file: "Old.cs".into(), line: 1 }]);
        fs::write(state.join(CACHE_FILE), serde_json::to_vec(&stale).expect("serialize stale cache")).expect("write stale cache");

        let index = load_or_scan(&state, &[project], false).expect("scan again");

        assert_eq!(index.version, INDEX_VERSION);
        assert!(names(&index, "100000099").is_empty(), "stale cache must not be reused");
        let _ = fs::remove_dir_all(root);
    }
}
