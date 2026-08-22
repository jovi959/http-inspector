use std::{
    env, fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, ExitStatus, Stdio},
    sync::mpsc::{self, Receiver},
    thread,
    time::Duration,
};

use wait_timeout::ChildExt;

use crate::IntegrationError;

const CONFIGURED_BASH_FILE: &str = "git-bash-path";
const BASH_VALIDATION_TIMEOUT: Duration = Duration::from_secs(5);
const SCRIPT_TIMEOUT: Duration = Duration::from_secs(60);
const OUTPUT_DRAIN_TIMEOUT: Duration = Duration::from_secs(5);
const TIMEOUT_DIAGNOSTIC_TIMEOUT: Duration = Duration::from_secs(1);
const BASH_VALIDATION_COMMAND: &str = "for required in awk sed grep find sort mktemp cmp diff; do command -v \"$required\" >/dev/null 2>&1 || { printf 'Missing required Bash command: %s\\n' \"$required\" >&2; exit 127; }; done; command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 || command -v openssl >/dev/null 2>&1 || { printf 'Missing required SHA-256 command: sha256sum, shasum, or openssl\\n' >&2; exit 127; }; exit 0";

#[derive(Debug)]
struct BashOutput {
    status: ExitStatus,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

pub(crate) fn discover_bash(state_root: &Path) -> Option<PathBuf> {
    if let Some(path) = env::var_os("HTTP_INSPECTOR_BASH") {
        return normalize_bash_path(Path::new(&path));
    }
    if let Ok(path) = fs::read_to_string(state_root.join(CONFIGURED_BASH_FILE))
        && let Some(path) = normalize_bash_path(Path::new(path.trim()))
    {
        return Some(path);
    }
    bash_candidates()
        .into_iter()
        .find_map(|path| normalize_bash_path(&path))
}

pub(crate) fn select_bash(
    state_root: &Path,
    selected_path: &Path,
) -> Result<PathBuf, IntegrationError> {
    let bash = normalize_bash_path(selected_path).ok_or_else(|| {
        IntegrationError::new(
            "invalidBashPath",
            "Choose Git Bash (git-bash.exe) or its bin/bash.exe executable.",
        )
    })?;
    let mut command = bash_command(&bash);
    command.arg("-c").arg(BASH_VALIDATION_COMMAND);
    let output = run_bash(command, BASH_VALIDATION_TIMEOUT, "Bash validation")
        .map_err(|error| IntegrationError::new("bashValidationFailed", error.message))?;
    if !output.status.success() {
        let diagnostics = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Err(IntegrationError::new(
            "bashValidationFailed",
            if diagnostics.is_empty() {
                "The selected Git Bash executable could not run the required non-interactive commands.".into()
            } else {
                diagnostics
            },
        ));
    }
    fs::create_dir_all(state_root)
        .map_err(|error| IntegrationError::new("bashPreferenceWriteFailed", error.to_string()))?;
    let temporary_path = state_root.join(format!(".{CONFIGURED_BASH_FILE}.tmp"));
    fs::write(&temporary_path, bash.display().to_string())
        .map_err(|error| IntegrationError::new("bashPreferenceWriteFailed", error.to_string()))?;
    fs::rename(temporary_path, state_root.join(CONFIGURED_BASH_FILE))
        .map_err(|error| IntegrationError::new("bashPreferenceWriteFailed", error.to_string()))?;
    Ok(bash)
}

fn bash_candidates() -> Vec<PathBuf> {
    if cfg!(windows) {
        let mut candidates = Vec::new();
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
            let git_root = PathBuf::from(local_app_data).join("Programs").join("Git");
            candidates.extend([
                git_root.join("bin").join("bash.exe"),
                git_root.join("usr").join("bin").join("bash.exe"),
            ]);
        }
        for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(root) = env::var_os(variable) {
                let git_root = PathBuf::from(root).join("Git");
                candidates.extend([
                    git_root.join("bin").join("bash.exe"),
                    git_root.join("usr").join("bin").join("bash.exe"),
                ]);
            }
        }
        candidates
    } else {
        ["/bin/bash", "/usr/bin/bash", "/opt/homebrew/bin/bash"]
            .into_iter()
            .map(PathBuf::from)
            .collect()
    }
}

fn normalize_bash_path(selected_path: &Path) -> Option<PathBuf> {
    if selected_path.is_file()
        && selected_path
            .file_name()
            .is_some_and(|name| name.eq_ignore_ascii_case("git-bash.exe"))
    {
        let root = selected_path.parent()?;
        return [
            root.join("bin").join("bash.exe"),
            root.join("usr").join("bin").join("bash.exe"),
        ]
        .into_iter()
        .find(|path| path.is_file());
    }
    selected_path.is_file().then(|| selected_path.to_path_buf())
}

pub(crate) fn to_bash_path(_bash: &Path, path: &Path) -> Result<String, IntegrationError> {
    if cfg!(windows) {
        return windows_path_to_bash(&native_path_text(path));
    }
    Ok(path.display().to_string())
}

pub(crate) fn to_native_path(_bash: &Path, path: &str) -> Result<PathBuf, IntegrationError> {
    if cfg!(windows) && path.starts_with('/') {
        return bash_path_to_windows(path).map(PathBuf::from);
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

fn windows_path_to_bash(path: &str) -> Result<String, IntegrationError> {
    let path = path.replace('\\', "/");
    let path = path.strip_prefix("//?/").unwrap_or(&path);
    let path = path
        .strip_prefix("UNC/")
        .map(|unc_path| format!("//{unc_path}"))
        .unwrap_or_else(|| path.to_owned());
    if path.starts_with("//") {
        return Ok(path);
    }
    let bytes = path.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        let drive = (bytes[0] as char).to_ascii_lowercase();
        let remainder = path[2..].trim_start_matches('/');
        return Ok(if remainder.is_empty() {
            format!("/{drive}")
        } else {
            format!("/{drive}/{remainder}")
        });
    }
    Err(IntegrationError::new(
        "pathConversionFailed",
        format!("Unsupported Windows path for Git Bash: {path}"),
    ))
}

fn bash_path_to_windows(path: &str) -> Result<String, IntegrationError> {
    if let Some(unc_path) = path.strip_prefix("//") {
        return Ok(format!("\\\\{}", unc_path.replace('/', "\\")));
    }
    let path = path.strip_prefix('/').unwrap_or(path);
    let (drive, remainder) = path.split_once('/').unwrap_or((path, ""));
    if drive.len() == 1 && drive.as_bytes()[0].is_ascii_alphabetic() {
        return Ok(if remainder.is_empty() {
            format!("{}:\\", drive.to_ascii_uppercase())
        } else {
            format!(
                "{}:\\{}",
                drive.to_ascii_uppercase(),
                remainder.replace('/', "\\")
            )
        });
    }
    Err(IntegrationError::new(
        "pathConversionFailed",
        format!("Unsupported Git Bash path for Windows: {path}"),
    ))
}

pub(crate) fn run_json(
    bash: &Path,
    script: &Path,
    arguments: &[String],
) -> Result<serde_json::Value, IntegrationError> {
    let mut command = bash_command(bash);
    command.arg(script).args(arguments);
    let output = run_bash(command, SCRIPT_TIMEOUT, "integration script")?;
    if !output.status.success() {
        return Err(IntegrationError::new(
            "scriptFailed",
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    serde_json::from_slice(&output.stdout).map_err(|error| {
        IntegrationError::new(
            "invalidScriptJson",
            format!("{error}: {}", String::from_utf8_lossy(&output.stdout)),
        )
    })
}

fn bash_command(bash: &Path) -> Command {
    // All platforms run the same non-interactive Bash contract; platform-specific path conversion stays outside the scripts.
    let mut command = Command::new(bash);
    command
        .arg("--noprofile")
        .arg("--norc")
        .stdin(Stdio::null());
    command
}

fn run_bash(
    mut command: Command,
    timeout: Duration,
    operation: &str,
) -> Result<BashOutput, IntegrationError> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| IntegrationError::new("bashStartFailed", error.to_string()))?;
    let stdout = child.stdout.take().ok_or_else(|| {
        IntegrationError::new("bashOutputFailed", "Bash stdout was not available.")
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        IntegrationError::new("bashOutputFailed", "Bash stderr was not available.")
    })?;
    // Start draining before waiting so a full OS pipe cannot prevent Bash from exiting.
    let stdout_reader = read_pipe(stdout);
    let stderr_reader = read_pipe(stderr);
    let status = match child
        .wait_timeout(timeout)
        .map_err(|error| IntegrationError::new("bashWaitFailed", error.to_string()))?
    {
        Some(status) => status,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            let diagnostics = receive_pipe(stderr_reader, operation, TIMEOUT_DIAGNOSTIC_TIMEOUT)
                .unwrap_or_default();
            return Err(IntegrationError::new(
                "operationTimedOut",
                timeout_message(operation, timeout, &diagnostics),
            ));
        }
    };
    let stdout = receive_pipe(stdout_reader, operation, OUTPUT_DRAIN_TIMEOUT)?;
    let stderr = receive_pipe(stderr_reader, operation, OUTPUT_DRAIN_TIMEOUT)?;
    Ok(BashOutput {
        status,
        stdout,
        stderr,
    })
}

fn read_pipe<R: Read + Send + 'static>(mut pipe: R) -> Receiver<std::io::Result<Vec<u8>>> {
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = pipe.read_to_end(&mut bytes).map(|_| bytes);
        let _ = sender.send(result);
    });
    receiver
}

fn receive_pipe(
    receiver: Receiver<std::io::Result<Vec<u8>>>,
    operation: &str,
    timeout: Duration,
) -> Result<Vec<u8>, IntegrationError> {
    receiver
        .recv_timeout(timeout)
        .map_err(|_| {
            IntegrationError::new(
                "bashOutputFailed",
                format!("The {operation} did not close its output streams."),
            )
        })?
        .map_err(|error| IntegrationError::new("bashOutputFailed", error.to_string()))
}

fn timeout_message(operation: &str, timeout: Duration, diagnostics: &[u8]) -> String {
    let diagnostics = String::from_utf8_lossy(diagnostics).trim().to_owned();
    if diagnostics.is_empty() {
        return format!("The {operation} exceeded {} seconds.", timeout.as_secs());
    }
    format!(
        "The {operation} exceeded {} seconds. {diagnostics}",
        timeout.as_secs()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bash_for_test() -> PathBuf {
        bash_candidates()
            .into_iter()
            .find(|path| path.is_file())
            .expect("Bash must be available for Bash runner tests")
    }

    fn test_script(contents: &str) -> (PathBuf, PathBuf) {
        let directory =
            env::temp_dir().join(format!("http-inspector-bash-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("create temporary script directory");
        let script = directory.join("script.sh");
        fs::write(&script, contents).expect("write temporary Bash script");
        (directory, script)
    }

    #[test]
    fn drains_large_json_output_before_waiting_for_bash_to_exit() {
        let (directory, script) = test_script(
            "chunk='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; printf '{\\\"payload\\\":\\\"'; for ((index = 0; index < 16384; index++)); do printf '%s' \"$chunk\"; printf '%s' \"$chunk\" >&2; done; printf '\\\"}'",
        );
        let value = run_json(&bash_for_test(), &script, &[])
            .expect("large JSON output should not deadlock the runner");
        assert!(
            value["payload"]
                .as_str()
                .is_some_and(|payload| payload.len() > 65_536)
        );
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn gives_bash_eof_instead_of_inheriting_interactive_stdin() {
        let (directory, script) =
            test_script("IFS= read -r value || true; printf '{\\\"stdin\\\":\\\"closed\\\"}'");
        let value =
            run_json(&bash_for_test(), &script, &[]).expect("Bash should receive EOF on stdin");
        assert_eq!(value["stdin"].as_str(), Some("closed"));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn validates_the_selected_non_interactive_bash_and_required_utilities() {
        let state_root = env::temp_dir().join(format!(
            "http-inspector-bash-state-{}",
            uuid::Uuid::new_v4()
        ));
        let bash = bash_for_test();
        let selected = select_bash(&state_root, &bash)
            .expect("available Bash must pass integration validation");
        assert_eq!(selected, bash);
        let _ = fs::remove_dir_all(state_root);
    }

    #[test]
    fn terminates_a_timed_out_bash_operation() {
        let (directory, script) = test_script("while :; do :; done");
        let mut command = bash_command(&bash_for_test());
        command.arg(&script);
        let error = run_bash(command, Duration::from_millis(25), "test operation")
            .expect_err("infinite Bash script must time out");
        assert_eq!(error.code, "operationTimedOut");
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn converts_windows_paths_without_starting_a_cygpath_process() {
        assert_eq!(
            windows_path_to_bash(r"C:\Users\Jovi\source repos\Project").expect("drive path"),
            "/c/Users/Jovi/source repos/Project"
        );
        assert_eq!(
            windows_path_to_bash(r"\\?\C:\Users\Jovi\Project").expect("extended drive path"),
            "/c/Users/Jovi/Project"
        );
        assert_eq!(
            windows_path_to_bash(r"\\server\share\Project").expect("UNC path"),
            "//server/share/Project"
        );
        assert_eq!(
            windows_path_to_bash(r"\\?\UNC\server\share\Project").expect("extended UNC path"),
            "//server/share/Project"
        );
        assert_eq!(
            bash_path_to_windows("/c/Users/Jovi/source repos/Project").expect("Bash drive path"),
            r"C:\Users\Jovi\source repos\Project"
        );
        assert_eq!(
            bash_path_to_windows("//server/share/Project").expect("Bash UNC path"),
            r"\\server\share\Project"
        );
    }
}
