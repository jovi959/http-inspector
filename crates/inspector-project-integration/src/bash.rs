use std::{env, fs, path::{Path, PathBuf}, process::{Command, Stdio}, time::Duration};

use wait_timeout::ChildExt;

use crate::IntegrationError;

const CONFIGURED_BASH_FILE: &str = "git-bash-path";

pub(crate) fn discover_bash(state_root: &Path) -> Option<PathBuf> {
    if let Some(path) = env::var_os("HTTP_INSPECTOR_BASH") {
        return normalize_bash_path(Path::new(&path));
    }
    if let Ok(path) = fs::read_to_string(state_root.join(CONFIGURED_BASH_FILE))
        && let Some(path) = normalize_bash_path(Path::new(path.trim())) { return Some(path); }
    bash_candidates().into_iter().find_map(|path| normalize_bash_path(&path))
}

pub(crate) fn select_bash(state_root: &Path, selected_path: &Path) -> Result<PathBuf, IntegrationError> {
    let bash = normalize_bash_path(selected_path).ok_or_else(|| IntegrationError::new("invalidBashPath", "Choose Git Bash (git-bash.exe) or its bin/bash.exe executable."))?;
    let output = Command::new(&bash).arg("--noprofile").arg("--norc").arg("-c").arg("exit 0").output()
        .map_err(|error| IntegrationError::new("bashValidationFailed", error.to_string()))?;
    if !output.status.success() { return Err(IntegrationError::new("bashValidationFailed", "The selected Git Bash executable could not run a non-interactive command.")); }
    fs::create_dir_all(state_root).map_err(|error| IntegrationError::new("bashPreferenceWriteFailed", error.to_string()))?;
    let temporary_path = state_root.join(format!(".{CONFIGURED_BASH_FILE}.tmp"));
    fs::write(&temporary_path, bash.display().to_string()).map_err(|error| IntegrationError::new("bashPreferenceWriteFailed", error.to_string()))?;
    fs::rename(temporary_path, state_root.join(CONFIGURED_BASH_FILE)).map_err(|error| IntegrationError::new("bashPreferenceWriteFailed", error.to_string()))?;
    Ok(bash)
}

fn bash_candidates() -> Vec<PathBuf> {
    if cfg!(windows) {
        let mut candidates = Vec::new();
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
            let git_root = PathBuf::from(local_app_data).join("Programs").join("Git");
            candidates.extend([git_root.join("bin").join("bash.exe"), git_root.join("usr").join("bin").join("bash.exe")]);
        }
        for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(root) = env::var_os(variable) {
                let git_root = PathBuf::from(root).join("Git");
                candidates.extend([git_root.join("bin").join("bash.exe"), git_root.join("usr").join("bin").join("bash.exe")]);
            }
        }
        candidates
    } else {
        ["/bin/bash", "/usr/bin/bash", "/opt/homebrew/bin/bash"].into_iter().map(PathBuf::from).collect()
    }
}

fn normalize_bash_path(selected_path: &Path) -> Option<PathBuf> {
    if selected_path.is_file() && selected_path.file_name().is_some_and(|name| name.eq_ignore_ascii_case("git-bash.exe")) {
        let root = selected_path.parent()?;
        return [root.join("bin").join("bash.exe"), root.join("usr").join("bin").join("bash.exe")].into_iter().find(|path| path.is_file());
    }
    selected_path.is_file().then(|| selected_path.to_path_buf())
}

pub(crate) fn to_bash_path(bash: &Path, path: &Path) -> Result<String, IntegrationError> {
    if cfg!(windows) {
        return convert_path(bash, "cygpath -u -- \"$1\"", &native_path_text(path));
    }
    Ok(path.display().to_string())
}

pub(crate) fn to_native_path(bash: &Path, path: &str) -> Result<PathBuf, IntegrationError> {
    if cfg!(windows) && path.starts_with('/') {
        return convert_path(bash, "cygpath -w -- \"$1\"", path).map(PathBuf::from);
    }
    Ok(PathBuf::from(path))
}

fn native_path_text(path: &Path) -> String {
    let path = path.display().to_string();
    if cfg!(windows) {
        if let Some(unc_path) = path.strip_prefix("\\\\?\\UNC\\") {
            return format!("\\\\{unc_path}");
        }
        return path.strip_prefix("\\\\?\\").unwrap_or(&path).to_owned();
    }
    path
}

fn convert_path(bash: &Path, command: &str, path: &str) -> Result<String, IntegrationError> {
    let output = Command::new(bash).arg("--noprofile").arg("--norc").arg("-c").arg(command).arg("http-inspector-path").arg(path).output()
        .map_err(|error| IntegrationError::new("pathConversionFailed", error.to_string()))?;
    if !output.status.success() {
        return Err(IntegrationError::new("pathConversionFailed", String::from_utf8_lossy(&output.stderr).trim().to_owned()));
    }
    let converted = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if converted.is_empty() {
        return Err(IntegrationError::new("pathConversionFailed", "Git Bash returned an empty converted path."));
    }
    Ok(converted)
}

pub(crate) fn run_json(bash: &Path, script: &Path, arguments: &[String]) -> Result<serde_json::Value, IntegrationError> {
    let mut child = Command::new(bash).arg("--noprofile").arg("--norc").arg(script).args(arguments)
        .stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()
        .map_err(|error| IntegrationError::new("bashStartFailed", error.to_string()))?;
    match child.wait_timeout(Duration::from_secs(30)).map_err(|error| IntegrationError::new("bashWaitFailed", error.to_string()))? {
        Some(_) => {}
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(IntegrationError::new("operationTimedOut", "The integration script exceeded 30 seconds."));
        }
    }
    let output = child.wait_with_output().map_err(|error| IntegrationError::new("bashOutputFailed", error.to_string()))?;
    if !output.status.success() {
        return Err(IntegrationError::new("scriptFailed", String::from_utf8_lossy(&output.stderr).trim().to_owned()));
    }
    serde_json::from_slice(&output.stdout).map_err(|error| IntegrationError::new("invalidScriptJson", format!("{error}: {}", String::from_utf8_lossy(&output.stdout))))
}
