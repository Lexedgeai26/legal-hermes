//! Resumable, verified component download.
//!
//! A component is trusted only after the bytes on disk match the signed
//! manifest's size and SHA-256 exactly. Until then it lives under a `.part`
//! name beside a state file (download-state.v1) so an interrupted download
//! resumes with an HTTP Range request instead of starting over.
//!
//! Redirects are followed only to https. A registry or CDN that bounces to
//! plain http is treated as a failure, not a convenience.

use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::Duration;

use futures::StreamExt as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::component_manifest::Component;
use crate::runtime::rfc3339_utc_now;

const STATE_SCHEMA_VERSION: u32 = 1;
/// Persist progress at most this often so a crash loses little.
const STATE_FLUSH_INTERVAL_BYTES: u64 = 4 * 1024 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
/// No single chunk may take longer than this; the overall download has no
/// wall-clock cap because a 1.4 GB Windows archive on a slow office line is
/// legitimate.
const CHUNK_TIMEOUT: Duration = Duration::from_secs(120);

/// Mirrors schemas/download-state.v1.schema.json.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DownloadState {
    pub schema_version: u32,
    pub download_id: String,
    pub component_id: String,
    pub url: String,
    pub expected_bytes: u64,
    pub received_bytes: u64,
    pub expected_sha256: String,
    pub partial_path: String,
    #[serde(default)]
    pub etag: Option<String>,
    #[serde(default)]
    pub last_modified: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DownloadProgress {
    pub received_bytes: u64,
    pub total_bytes: u64,
    pub fraction: f64,
}

/// Where a component's files live under the download directory.
pub struct DownloadPaths {
    pub final_path: PathBuf,
    pub partial_path: PathBuf,
    pub state_path: PathBuf,
}

pub fn download_paths(dir: &Path, component: &Component) -> DownloadPaths {
    let file_name = component
        .url
        .rsplit('/')
        .next()
        .filter(|n| !n.is_empty())
        .unwrap_or("component.bin");
    let stem = format!("{}-{}-{}", component.id, component.version, file_name);
    DownloadPaths {
        final_path: dir.join(&stem),
        partial_path: dir.join(format!("{stem}.part")),
        state_path: dir.join(format!("{stem}.download.json")),
    }
}

/// Decide where to resume from. Only a state file that describes exactly this
/// download, with a partial file no larger than it claims, may be resumed;
/// anything else restarts from zero. Restarting is always safe — resuming the
/// wrong bytes is not.
pub fn resume_offset(
    state: Option<&DownloadState>,
    partial_len: Option<u64>,
    component: &Component,
) -> u64 {
    let (Some(state), Some(len)) = (state, partial_len) else {
        return 0;
    };
    let matches = state.schema_version == STATE_SCHEMA_VERSION
        && state.component_id == component.id
        && state.url == component.url
        && state.expected_bytes == component.size_bytes
        && state.expected_sha256.eq_ignore_ascii_case(&component.sha256)
        && state.received_bytes <= state.expected_bytes
        && len == state.received_bytes;
    if matches {
        state.received_bytes
    } else {
        0
    }
}

/// Stream a file through SHA-256 and compare size and digest. This is the
/// only function that may declare a component trustworthy.
pub fn verify_file(path: &Path, expected_size: u64, expected_sha256: &str) -> Result<(), String> {
    let metadata = std::fs::metadata(path)
        .map_err(|_| "The downloaded component is missing".to_string())?;
    if metadata.len() != expected_size {
        return Err(format!(
            "Component size mismatch: expected {expected_size} bytes, found {}",
            metadata.len()
        ));
    }
    let mut file = std::fs::File::open(path)
        .map_err(|_| "Unable to read the downloaded component".to_string())?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher)
        .map_err(|_| "Unable to hash the downloaded component".to_string())?;
    let actual: String = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    if !actual.eq_ignore_ascii_case(expected_sha256) {
        return Err("Component SHA-256 verification failed".to_string());
    }
    Ok(())
}

fn https_only_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.url().scheme() == "https" && attempt.previous().len() < 10 {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .user_agent("LexEdge-Hermes-Agent-Setup/0.0.1")
        .build()
        .map_err(|_| "Unable to create the download client".to_string())
}

fn write_state(path: &Path, state: &DownloadState) -> Result<(), String> {
    let encoded = serde_json::to_vec_pretty(state)
        .map_err(|_| "Unable to encode download state".to_string())?;
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, encoded).map_err(|_| "Unable to save download state".to_string())?;
    std::fs::rename(&temp, path).map_err(|_| "Unable to commit download state".to_string())
}

fn read_state(path: &Path) -> Option<DownloadState> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Download `component` into `dir`, resuming if possible, and return the
/// verified final path. Idempotent: a verified final file is returned at once.
pub async fn download_component(
    component: &Component,
    dir: &Path,
    mut on_progress: impl FnMut(DownloadProgress),
) -> Result<PathBuf, String> {
    if !component.url.starts_with("https://") {
        return Err("Components may only be downloaded over https".to_string());
    }
    std::fs::create_dir_all(dir)
        .map_err(|_| "Unable to create the download directory".to_string())?;
    let paths = download_paths(dir, component);

    // Already have it.
    if paths.final_path.is_file()
        && verify_file(&paths.final_path, component.size_bytes, &component.sha256).is_ok()
    {
        on_progress(DownloadProgress {
            received_bytes: component.size_bytes,
            total_bytes: component.size_bytes,
            fraction: 1.0,
        });
        return Ok(paths.final_path);
    }

    let prior = read_state(&paths.state_path);
    let partial_len = std::fs::metadata(&paths.partial_path).ok().map(|m| m.len());
    let mut offset = resume_offset(prior.as_ref(), partial_len, component);

    let client = https_only_client()?;
    let mut request = client.get(&component.url);
    if offset > 0 {
        request = request.header("Range", format!("bytes={offset}-"));
    }
    let response = request
        .send()
        .await
        .map_err(|_| "Unable to reach the download server".to_string())?;

    // A server that ignores Range answers 200 with the whole body: restart.
    let status = response.status();
    if offset > 0 && status != reqwest::StatusCode::PARTIAL_CONTENT {
        offset = 0;
    }
    if !(status.is_success() || status == reqwest::StatusCode::PARTIAL_CONTENT) {
        return Err(format!("The download server answered {}", status.as_u16()));
    }
    // Refuse a body we did not ask for. The manifest is the authority on size.
    if let Some(len) = response.content_length() {
        if offset.saturating_add(len) > component.size_bytes {
            return Err("The download server offered more data than the manifest allows".to_string());
        }
    }
    let etag = response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let last_modified = response
        .headers()
        .get(reqwest::header::LAST_MODIFIED)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(offset == 0)
        .open(&paths.partial_path)
        .map_err(|_| "Unable to open the partial download".to_string())?;
    if offset > 0 {
        use std::io::Seek as _;
        file.set_len(offset)
            .map_err(|_| "Unable to trim the partial download".to_string())?;
        file.seek(std::io::SeekFrom::End(0))
            .map_err(|_| "Unable to position the partial download".to_string())?;
    }

    let mut state = DownloadState {
        schema_version: STATE_SCHEMA_VERSION,
        download_id: prior
            .as_ref()
            .filter(|_| offset > 0)
            .map(|s| s.download_id.clone())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        component_id: component.id.clone(),
        url: component.url.clone(),
        expected_bytes: component.size_bytes,
        received_bytes: offset,
        expected_sha256: component.sha256.to_ascii_lowercase(),
        partial_path: paths.partial_path.to_string_lossy().into_owned(),
        etag,
        last_modified,
        updated_at: rfc3339_utc_now(),
    };
    write_state(&paths.state_path, &state)?;

    let mut received = offset;
    let mut since_flush = 0_u64;
    let mut stream = response.bytes_stream();
    loop {
        let next = tokio::time::timeout(CHUNK_TIMEOUT, stream.next()).await;
        let chunk = match next {
            Ok(Some(Ok(chunk))) => chunk,
            Ok(Some(Err(_))) => return Err("The download was interrupted".to_string()),
            Ok(None) => break,
            Err(_) => return Err("The download stalled".to_string()),
        };
        received = received.saturating_add(chunk.len() as u64);
        if received > component.size_bytes {
            let _ = std::fs::remove_file(&paths.partial_path);
            let _ = std::fs::remove_file(&paths.state_path);
            return Err("The download server sent more data than the manifest allows".to_string());
        }
        file.write_all(&chunk)
            .map_err(|_| "Unable to write the download to disk".to_string())?;
        since_flush += chunk.len() as u64;
        if since_flush >= STATE_FLUSH_INTERVAL_BYTES {
            file.flush().ok();
            state.received_bytes = received;
            state.updated_at = rfc3339_utc_now();
            write_state(&paths.state_path, &state)?;
            since_flush = 0;
        }
        on_progress(DownloadProgress {
            received_bytes: received,
            total_bytes: component.size_bytes,
            fraction: received as f64 / component.size_bytes as f64,
        });
    }
    file.flush().ok();
    drop(file);

    if received != component.size_bytes {
        // Short read: keep the partial for a later resume.
        state.received_bytes = received;
        state.updated_at = rfc3339_utc_now();
        write_state(&paths.state_path, &state)?;
        return Err(format!(
            "The download ended early ({received} of {} bytes); it will resume next time",
            component.size_bytes
        ));
    }

    if let Err(err) = verify_file(&paths.partial_path, component.size_bytes, &component.sha256) {
        // Corrupt bytes are never kept for resume.
        let _ = std::fs::remove_file(&paths.partial_path);
        let _ = std::fs::remove_file(&paths.state_path);
        return Err(err);
    }
    std::fs::rename(&paths.partial_path, &paths.final_path)
        .map_err(|_| "Unable to finalise the download".to_string())?;
    let _ = std::fs::remove_file(&paths.state_path);
    Ok(paths.final_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::component_manifest::{Architecture, Platform};

    fn component(size: u64, sha: &str) -> Component {
        Component {
            id: "ollama".to_string(),
            version: "0.33.3".to_string(),
            platform: Platform::Macos,
            architecture: Architecture::Arm64,
            url: "https://example.invalid/releases/ollama-darwin.tgz".to_string(),
            size_bytes: size,
            sha256: sha.to_string(),
            license: "MIT".to_string(),
            notice_path: "n".to_string(),
            minimum_os_version: None,
            authenticode_required: false,
            rollback_version: None,
        }
    }

    fn state_for(c: &Component, received: u64) -> DownloadState {
        DownloadState {
            schema_version: 1,
            download_id: "d1".to_string(),
            component_id: c.id.clone(),
            url: c.url.clone(),
            expected_bytes: c.size_bytes,
            received_bytes: received,
            expected_sha256: c.sha256.clone(),
            partial_path: "/x/y.part".to_string(),
            etag: None,
            last_modified: None,
            updated_at: "2026-09-08T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn paths_are_named_by_component_and_version() {
        let c = component(10, &"a".repeat(64));
        let p = download_paths(Path::new("/dl"), &c);
        assert_eq!(p.final_path, Path::new("/dl/ollama-0.33.3-ollama-darwin.tgz"));
        assert!(p.partial_path.to_string_lossy().ends_with(".part"));
        assert!(p.state_path.to_string_lossy().ends_with(".download.json"));
    }

    #[test]
    fn resume_only_when_state_and_partial_agree_exactly() {
        let c = component(1_000, &"a".repeat(64));
        let good = state_for(&c, 400);
        assert_eq!(resume_offset(Some(&good), Some(400), &c), 400);

        // Partial on disk differs from what the state claims: restart.
        assert_eq!(resume_offset(Some(&good), Some(399), &c), 0);
        assert_eq!(resume_offset(Some(&good), Some(401), &c), 0);
        // No partial, or no state: restart.
        assert_eq!(resume_offset(Some(&good), None, &c), 0);
        assert_eq!(resume_offset(None, Some(400), &c), 0);

        // State for a different artifact (new version / hash) must not resume.
        let other = component(1_000, &"b".repeat(64));
        assert_eq!(resume_offset(Some(&good), Some(400), &other), 0);
        let mut wrong_url = good.clone();
        wrong_url.url = "https://elsewhere.invalid/a".to_string();
        assert_eq!(resume_offset(Some(&wrong_url), Some(400), &c), 0);
        // Received more than expected is corrupt state.
        let mut over = good.clone();
        over.received_bytes = 2_000;
        assert_eq!(resume_offset(Some(&over), Some(2_000), &c), 0);
    }

    #[test]
    fn verify_file_checks_size_then_digest() {
        let dir = std::env::temp_dir().join(format!("lexedge-dl-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("blob");
        std::fs::write(&path, b"hello lexedge").unwrap();
        let digest: String = Sha256::digest(b"hello lexedge")
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();

        assert!(verify_file(&path, 13, &digest).is_ok());
        assert!(verify_file(&path, 13, &digest.to_uppercase()).is_ok());
        assert!(verify_file(&path, 12, &digest).unwrap_err().contains("size"));
        assert!(verify_file(&path, 13, &"0".repeat(64))
            .unwrap_err()
            .contains("SHA-256"));
        assert!(verify_file(&dir.join("absent"), 13, &digest).is_err());
    }

    #[test]
    fn state_round_trips_through_the_schema_shape() {
        let c = component(1_000, &"a".repeat(64));
        let s = state_for(&c, 10);
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("\"expectedSha256\""));
        assert!(json.contains("\"receivedBytes\":10"));
        assert_eq!(serde_json::from_str::<DownloadState>(&json).unwrap(), s);
        // Unknown fields are a schema violation, not something to ignore.
        assert!(serde_json::from_str::<DownloadState>(&json.replace("\"etag\"", "\"extra\":1,\"etag\"")).is_err());
    }

    #[tokio::test]
    async fn plain_http_is_refused_before_any_network_call() {
        let mut c = component(10, &"a".repeat(64));
        c.url = "http://example.invalid/a.tgz".to_string();
        let dir = std::env::temp_dir().join(format!("lexedge-dl-{}", uuid::Uuid::new_v4()));
        let err = download_component(&c, &dir, |_| {}).await.unwrap_err();
        assert!(err.contains("https"));
    }

    #[tokio::test]
    async fn a_verified_final_file_is_returned_without_downloading() {
        let dir = std::env::temp_dir().join(format!("lexedge-dl-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let body = b"already here";
        let digest: String = Sha256::digest(body).iter().map(|b| format!("{b:02x}")).collect();
        let c = component(body.len() as u64, &digest);
        let paths = download_paths(&dir, &c);
        std::fs::write(&paths.final_path, body).unwrap();

        let mut last = None;
        // The URL is unreachable; success proves no request was made.
        let got = download_component(&c, &dir, |p| last = Some(p)).await.unwrap();
        assert_eq!(got, paths.final_path);
        assert_eq!(last.unwrap().fraction, 1.0);
    }
}
