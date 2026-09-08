//! Safe extraction of a verified runtime archive.
//!
//! The archive has already been signature- and hash-verified, but "verified"
//! means "is the artifact LexEdge pinned", not "is safe to unpack blindly".
//! An upstream release could still carry an absolute path, a `..` component,
//! or a link pointing outside the destination. Policy:
//!
//!   * paths must be relative and may not contain `..`;
//!   * device, fifo and other special entries are refused;
//!   * a symlink or hardlink is never created. If it points, relatively, at
//!     a regular file inside the same archive it is materialised as a hard
//!     copy of that file (the Ollama tarball ships `libggml.dylib ->
//!     libggml.0.dylib -> libggml.0.22.0.dylib` chains that the runtime
//!     needs to resolve). Anything else fails the whole extraction;
//!   * total bytes and entry count are capped;
//!   * a failed extraction leaves nothing behind.

use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Read};
use std::path::{Component as PathComponent, Path, PathBuf};

const MAX_ENTRIES: usize = 10_000;
/// Windows archives expand past 3 GiB (CUDA libraries); leave headroom.
const MAX_TOTAL_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_LINK_DEPTH: usize = 8;
const MAX_PATH_DEPTH: usize = 32;

#[derive(Debug)]
pub struct ExtractedRuntime {
    pub root: PathBuf,
    pub executable: PathBuf,
    pub files: usize,
    pub bytes: u64,
}

/// Unpack `archive` into `dest`, which must not exist or must be empty.
pub fn extract_runtime_archive(archive: &Path, dest: &Path) -> Result<ExtractedRuntime, String> {
    if dest.exists() {
        let mut entries = fs::read_dir(dest)
            .map_err(|_| "Unable to inspect the runtime directory".to_string())?;
        if entries.next().is_some() {
            return Err("The runtime directory is not empty".to_string());
        }
    }
    fs::create_dir_all(dest).map_err(|_| "Unable to create the runtime directory".to_string())?;

    let result = (|| {
        let name = archive
            .file_name()
            .map(|n| n.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        let (files, bytes) = if name.ends_with(".tgz") || name.ends_with(".tar.gz") {
            extract_tar_gz(archive, dest)?
        } else if name.ends_with(".zip") {
            extract_zip(archive, dest)?
        } else {
            return Err("Unsupported runtime archive format".to_string());
        };
        let executable = locate_executable(dest)?;
        Ok(ExtractedRuntime {
            root: dest.to_path_buf(),
            executable,
            files,
            bytes,
        })
    })();

    if result.is_err() {
        let _ = fs::remove_dir_all(dest);
    }
    result
}

// ---------------------------------------------------------------------------
// Path policy
// ---------------------------------------------------------------------------

/// A relative, normal path with no traversal. Returned as-is so the caller
/// joins it under `dest`.
fn safe_relative(path: &Path) -> Result<PathBuf, String> {
    let mut out = PathBuf::new();
    let mut depth = 0;
    for component in path.components() {
        match component {
            PathComponent::Normal(part) => {
                out.push(part);
                depth += 1;
            }
            PathComponent::CurDir => {}
            PathComponent::ParentDir => {
                return Err(format!(
                    "Archive entry {} attempts directory traversal",
                    path.display()
                ))
            }
            PathComponent::RootDir | PathComponent::Prefix(_) => {
                return Err(format!(
                    "Archive entry {} uses an absolute path",
                    path.display()
                ))
            }
        }
    }
    if out.as_os_str().is_empty() {
        return Err("Archive entry has an empty path".to_string());
    }
    if depth > MAX_PATH_DEPTH {
        return Err("Archive entry is nested too deeply".to_string());
    }
    Ok(out)
}

/// Resolve `target`, interpreted relative to `link`'s directory, to a normal
/// path still inside the root. `..` is allowed here only while it stays
/// inside — `lib/../ollama` is fine, `../ollama` is not.
fn resolve_relative(link: &Path, target: &Path) -> Result<PathBuf, String> {
    if target.is_absolute() {
        return Err(format!(
            "Link {} points at an absolute path",
            link.display()
        ));
    }
    let mut out: Vec<std::ffi::OsString> = link
        .parent()
        .map(|p| p.components().map(|c| c.as_os_str().to_os_string()).collect())
        .unwrap_or_default();
    for component in target.components() {
        match component {
            PathComponent::Normal(part) => out.push(part.to_os_string()),
            PathComponent::CurDir => {}
            PathComponent::ParentDir => {
                if out.pop().is_none() {
                    return Err(format!(
                        "Link {} escapes the runtime directory",
                        link.display()
                    ));
                }
            }
            PathComponent::RootDir | PathComponent::Prefix(_) => {
                return Err(format!("Link {} uses an absolute path", link.display()))
            }
        }
    }
    Ok(out.iter().collect())
}

// ---------------------------------------------------------------------------
// Shared bookkeeping
// ---------------------------------------------------------------------------

struct Budget {
    entries: usize,
    bytes: u64,
}

impl Budget {
    fn new() -> Self {
        Self { entries: 0, bytes: 0 }
    }
    fn entry(&mut self) -> Result<(), String> {
        self.entries += 1;
        if self.entries > MAX_ENTRIES {
            return Err("Archive has too many entries".to_string());
        }
        Ok(())
    }
    fn remaining(&self) -> u64 {
        MAX_TOTAL_BYTES.saturating_sub(self.bytes)
    }
}

/// Copy a regular entry to disk under the byte budget.
fn write_regular(
    reader: &mut dyn Read,
    dest: &Path,
    rel: &Path,
    executable: bool,
    budget: &mut Budget,
) -> Result<(), String> {
    let target = dest.join(rel);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|_| "Unable to create a runtime directory".to_string())?;
    }
    let mut file = fs::File::create(&target)
        .map_err(|_| format!("Unable to write {}", rel.display()))?;
    let limit = budget.remaining();
    let written = io::copy(&mut reader.take(limit.saturating_add(1)), &mut file)
        .map_err(|_| format!("Unable to extract {}", rel.display()))?;
    if written > limit {
        return Err("Archive exceeds the extraction size limit".to_string());
    }
    budget.bytes += written;
    #[cfg(unix)]
    if executable {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&target, fs::Permissions::from_mode(0o755));
    }
    #[cfg(not(unix))]
    let _ = executable;
    Ok(())
}

/// Turn every deferred link into a copy of the regular file it ultimately
/// names. Chains are followed through the link map up to MAX_LINK_DEPTH.
fn materialise_links(dest: &Path, links: &BTreeMap<PathBuf, PathBuf>) -> Result<usize, String> {
    let mut made = 0;
    for (link, target) in links {
        let mut current = resolve_relative(link, target)?;
        let mut depth = 0;
        while let Some(next) = links.get(&current) {
            depth += 1;
            if depth > MAX_LINK_DEPTH {
                return Err(format!("Link {} is too deeply chained", link.display()));
            }
            current = resolve_relative(&current, next)?;
        }
        let source = dest.join(&current);
        // Only a regular file we extracted ourselves may be copied.
        let meta = fs::symlink_metadata(&source)
            .map_err(|_| format!("Link {} points at a missing file", link.display()))?;
        if !meta.is_file() {
            return Err(format!("Link {} does not point at a regular file", link.display()));
        }
        let out = dest.join(link);
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|_| "Unable to create a runtime directory".to_string())?;
        }
        if out.exists() {
            let _ = fs::remove_file(&out);
        }
        // A hard link shares storage without creating a symlink primitive;
        // fall back to a plain copy on filesystems that refuse it.
        if fs::hard_link(&source, &out).is_err() {
            fs::copy(&source, &out).map_err(|_| format!("Unable to materialise {}", link.display()))?;
        }
        made += 1;
    }
    Ok(made)
}

fn locate_executable(dest: &Path) -> Result<PathBuf, String> {
    let name = if cfg!(target_os = "windows") { "ollama.exe" } else { "ollama" };
    for candidate in [dest.join(name), dest.join("bin").join(name)] {
        if fs::symlink_metadata(&candidate).map(|m| m.is_file()).unwrap_or(false) {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&candidate, fs::Permissions::from_mode(0o755));
            }
            return Ok(candidate);
        }
    }
    Err("The runtime archive contains no ollama executable".to_string())
}

// ---------------------------------------------------------------------------
// tar.gz
// ---------------------------------------------------------------------------

fn extract_tar_gz(archive: &Path, dest: &Path) -> Result<(usize, u64), String> {
    use tar::EntryType;

    let file = fs::File::open(archive).map_err(|_| "Unable to open the runtime archive".to_string())?;
    let decoder = flate2::read::GzDecoder::new(io::BufReader::new(file));
    let mut tar = tar::Archive::new(decoder);
    let mut budget = Budget::new();
    let mut links: BTreeMap<PathBuf, PathBuf> = BTreeMap::new();
    let mut files = 0;

    let entries = tar
        .entries()
        .map_err(|_| "The runtime archive is not a valid tar stream".to_string())?;
    for entry in entries {
        let mut entry = entry.map_err(|_| "The runtime archive is corrupt".to_string())?;
        budget.entry()?;
        let raw = entry
            .path()
            .map_err(|_| "An archive entry has an unreadable path".to_string())?
            .into_owned();
        let rel = safe_relative(&raw)?;
        let kind = entry.header().entry_type();
        match kind {
            EntryType::Directory => {
                fs::create_dir_all(dest.join(&rel))
                    .map_err(|_| "Unable to create a runtime directory".to_string())?;
            }
            EntryType::Regular | EntryType::Continuous => {
                let mode = entry.header().mode().unwrap_or(0o644);
                write_regular(&mut entry, dest, &rel, mode & 0o111 != 0, &mut budget)?;
                files += 1;
            }
            EntryType::Symlink | EntryType::Link => {
                let target = entry
                    .link_name()
                    .map_err(|_| "An archive link has an unreadable target".to_string())?
                    .ok_or_else(|| format!("Link {} has no target", rel.display()))?
                    .into_owned();
                links.insert(rel, target);
            }
            // GNU/PAX metadata entries are consumed by the tar crate itself;
            // anything else that reaches here is not something we install.
            other => {
                return Err(format!(
                    "Archive entry {} has unsupported type {:?}",
                    rel.display(),
                    other
                ))
            }
        }
    }
    files += materialise_links(dest, &links)?;
    Ok((files, budget.bytes))
}

// ---------------------------------------------------------------------------
// zip
// ---------------------------------------------------------------------------

fn extract_zip(archive: &Path, dest: &Path) -> Result<(usize, u64), String> {
    let file = fs::File::open(archive).map_err(|_| "Unable to open the runtime archive".to_string())?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|_| "The runtime archive is not a valid zip".to_string())?;
    let mut budget = Budget::new();
    let mut links: BTreeMap<PathBuf, PathBuf> = BTreeMap::new();
    let mut files = 0;

    for index in 0..zip.len() {
        let mut entry = zip
            .by_index(index)
            .map_err(|_| "The runtime archive is corrupt".to_string())?;
        budget.entry()?;
        // enclosed_name() already refuses traversal and absolute names; run
        // the same policy anyway so both formats are held to one rule.
        let raw = entry
            .enclosed_name()
            .ok_or_else(|| format!("Archive entry {} attempts directory traversal", entry.name()))?;
        let rel = safe_relative(&raw)?;
        let mode = entry.unix_mode().unwrap_or(0);
        if entry.is_dir() {
            fs::create_dir_all(dest.join(&rel))
                .map_err(|_| "Unable to create a runtime directory".to_string())?;
        } else if mode & 0o170000 == 0o120000 {
            // A symlink stored in a zip carries its target as the file body.
            let mut target = String::new();
            entry
                .take(4096)
                .read_to_string(&mut target)
                .map_err(|_| format!("Link {} has an unreadable target", rel.display()))?;
            links.insert(rel, PathBuf::from(target.trim_end_matches(['\n', '\r'])));
        } else {
            write_regular(&mut entry, dest, &rel, mode & 0o111 != 0, &mut budget)?;
            files += 1;
        }
    }
    files += materialise_links(dest, &links)?;
    Ok((files, budget.bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::io::Write as _;

    fn temp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("lexedge-extract-{tag}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    // -- tar helpers --------------------------------------------------------

    struct TarSpec<'a> {
        files: Vec<(&'a str, &'a [u8], u32)>,
        links: Vec<(&'a str, &'a str)>,
        /// Raw names written straight into the header, bypassing the tar
        /// crate's own refusal to write `..` or absolute paths.
        raw_files: Vec<(&'a str, &'a [u8])>,
        raw_links: Vec<(&'a str, &'a str)>,
    }

    fn build_tgz(dir: &Path, spec: TarSpec) -> PathBuf {
        let path = dir.join("runtime.tgz");
        let gz = GzEncoder::new(fs::File::create(&path).unwrap(), Compression::fast());
        let mut tar = tar::Builder::new(gz);
        for (name, body, mode) in spec.files {
            let mut h = tar::Header::new_gnu();
            h.set_size(body.len() as u64);
            h.set_mode(mode);
            h.set_entry_type(tar::EntryType::Regular);
            h.set_cksum();
            tar.append_data(&mut h, name, body).unwrap();
        }
        for (name, target) in spec.links {
            let mut h = tar::Header::new_gnu();
            h.set_size(0);
            h.set_mode(0o777);
            h.set_entry_type(tar::EntryType::Symlink);
            h.set_link_name(target).unwrap();
            h.set_cksum();
            tar.append_data(&mut h, name, io::empty()).unwrap();
        }
        for (name, body) in spec.raw_files {
            let mut h = tar::Header::new_old();
            h.as_old_mut().name[..name.len()].copy_from_slice(name.as_bytes());
            h.set_size(body.len() as u64);
            h.set_mode(0o644);
            h.set_entry_type(tar::EntryType::Regular);
            h.set_cksum();
            tar.append(&h, body).unwrap();
        }
        for (name, target) in spec.raw_links {
            let mut h = tar::Header::new_old();
            h.as_old_mut().name[..name.len()].copy_from_slice(name.as_bytes());
            h.as_old_mut().linkname[..target.len()].copy_from_slice(target.as_bytes());
            h.set_size(0);
            h.set_mode(0o777);
            h.set_entry_type(tar::EntryType::Symlink);
            h.set_cksum();
            tar.append(&h, io::empty()).unwrap();
        }
        tar.into_inner().unwrap().finish().unwrap();
        path
    }

    fn clean(spec_files: Vec<(&'static str, &'static [u8], u32)>) -> TarSpec<'static> {
        TarSpec { files: spec_files, links: vec![], raw_files: vec![], raw_links: vec![] }
    }

    fn no_symlinks_under(root: &Path) -> bool {
        fn walk(p: &Path) -> bool {
            for e in fs::read_dir(p).unwrap() {
                let e = e.unwrap();
                let m = fs::symlink_metadata(e.path()).unwrap();
                if m.file_type().is_symlink() {
                    return false;
                }
                if m.is_dir() && !walk(&e.path()) {
                    return false;
                }
            }
            true
        }
        walk(root)
    }

    // -- tests --------------------------------------------------------------

    #[test]
    fn real_layout_extracts_with_dylib_chains_materialised() {
        let d = temp("real");
        let mut spec = clean(vec![
            ("ollama", b"binary", 0o755),
            ("llama-server", b"server", 0o755),
            ("libggml-base.0.22.0.dylib", b"lib-bytes", 0o644),
            ("mlx_metal_v3/mlx.metallib", b"metal", 0o644),
        ]);
        spec.links = vec![
            ("libggml-base.0.dylib", "libggml-base.0.22.0.dylib"),
            ("libggml-base.dylib", "libggml-base.0.dylib"), // chain of two
        ];
        let archive = build_tgz(&d, spec);
        let dest = d.join("runtime");
        let out = extract_runtime_archive(&archive, &dest).unwrap();

        assert_eq!(out.executable, dest.join("ollama"));
        assert_eq!(fs::read(dest.join("libggml-base.dylib")).unwrap(), b"lib-bytes");
        assert_eq!(fs::read(dest.join("libggml-base.0.dylib")).unwrap(), b"lib-bytes");
        assert_eq!(fs::read(dest.join("mlx_metal_v3/mlx.metallib")).unwrap(), b"metal");
        assert!(no_symlinks_under(&dest), "no symlink may ever be created");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_ne!(fs::metadata(&out.executable).unwrap().permissions().mode() & 0o111, 0);
        }
        assert_eq!(out.files, 6);
    }

    #[test]
    fn traversal_entry_aborts_and_cleans_up() {
        let d = temp("traversal");
        let mut spec = clean(vec![("ollama", b"x", 0o755)]);
        spec.raw_files = vec![("../evil", b"pwn")];
        let archive = build_tgz(&d, spec);
        let dest = d.join("runtime");
        let err = extract_runtime_archive(&archive, &dest).unwrap_err();
        assert!(err.contains("traversal"), "{err}");
        assert!(!dest.exists(), "a failed extraction must leave nothing");
        assert!(!d.join("evil").exists());
    }

    #[test]
    fn absolute_entry_is_refused() {
        let d = temp("absolute");
        let mut spec = clean(vec![("ollama", b"x", 0o755)]);
        spec.raw_files = vec![("/tmp/lexedge-absolute-test", b"pwn")];
        let archive = build_tgz(&d, spec);
        let err = extract_runtime_archive(&archive, &d.join("runtime")).unwrap_err();
        assert!(err.contains("absolute"), "{err}");
        assert!(!Path::new("/tmp/lexedge-absolute-test").exists());
    }

    #[test]
    fn escaping_and_dangling_links_are_refused() {
        let d = temp("links");
        let mut escaping = clean(vec![("ollama", b"x", 0o755)]);
        escaping.raw_links = vec![("lib.dylib", "../../etc/passwd")];
        let err = extract_runtime_archive(&build_tgz(&d, escaping), &d.join("r1")).unwrap_err();
        assert!(err.contains("escapes"), "{err}");

        let mut dangling = clean(vec![("ollama", b"x", 0o755)]);
        dangling.links = vec![("lib.dylib", "does-not-exist.dylib")];
        let err = extract_runtime_archive(&build_tgz(&d, dangling), &d.join("r2")).unwrap_err();
        assert!(err.contains("missing"), "{err}");

        let mut absolute = clean(vec![("ollama", b"x", 0o755)]);
        absolute.raw_links = vec![("lib.dylib", "/usr/lib/libSystem.dylib")];
        let err = extract_runtime_archive(&build_tgz(&d, absolute), &d.join("r3")).unwrap_err();
        assert!(err.contains("absolute"), "{err}");
    }

    #[test]
    fn a_link_may_point_inside_via_dotdot_but_not_outside() {
        let d = temp("inside");
        let mut spec = clean(vec![("ollama", b"x", 0o755), ("lib/real.dylib", b"r", 0o644)]);
        // sub/../lib/real.dylib stays inside the root: allowed.
        spec.links = vec![("sub/alias.dylib", "../lib/real.dylib")];
        let dest = d.join("runtime");
        extract_runtime_archive(&build_tgz(&d, spec), &dest).unwrap();
        assert_eq!(fs::read(dest.join("sub/alias.dylib")).unwrap(), b"r");
    }

    #[test]
    fn missing_executable_and_unknown_format_are_errors() {
        let d = temp("noexe");
        let spec = clean(vec![("libonly.dylib", b"x", 0o644)]);
        let err = extract_runtime_archive(&build_tgz(&d, spec), &d.join("r1")).unwrap_err();
        assert!(err.contains("executable"), "{err}");

        let bogus = d.join("runtime.rar");
        fs::write(&bogus, b"nope").unwrap();
        assert!(extract_runtime_archive(&bogus, &d.join("r2")).unwrap_err().contains("format"));
    }

    #[test]
    fn non_empty_destination_is_refused() {
        let d = temp("nonempty");
        let dest = d.join("runtime");
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join("leftover"), b"x").unwrap();
        let archive = build_tgz(&d, clean(vec![("ollama", b"x", 0o755)]));
        assert!(extract_runtime_archive(&archive, &dest).unwrap_err().contains("not empty"));
        // And we did not delete the user's leftover to make room.
        assert!(dest.join("leftover").exists());
    }

    #[test]
    fn zip_extracts_and_refuses_traversal() {
        use zip::write::SimpleFileOptions;

        let d = temp("zip");
        let good = d.join("runtime.zip");
        {
            let mut w = zip::ZipWriter::new(fs::File::create(&good).unwrap());
            let exe = if cfg!(target_os = "windows") { "ollama.exe" } else { "ollama" };
            w.start_file(exe, SimpleFileOptions::default().unix_permissions(0o755)).unwrap();
            w.write_all(b"binary").unwrap();
            w.start_file("lib/cuda.dll", SimpleFileOptions::default()).unwrap();
            w.write_all(b"dll").unwrap();
            // A real symlink entry. (unix_permissions() masks to 0o777 and
            // would silently drop the S_IFLNK bits, which is why this uses
            // the writer's dedicated symlink API.)
            w.add_symlink("lib/alias.dll", "cuda.dll", SimpleFileOptions::default()).unwrap();
            w.finish().unwrap();
        }
        let dest = d.join("r1");
        let out = extract_runtime_archive(&good, &dest).unwrap();
        assert!(out.executable.ends_with(if cfg!(target_os = "windows") { "ollama.exe" } else { "ollama" }));
        assert_eq!(fs::read(dest.join("lib/alias.dll")).unwrap(), b"dll");
        assert!(no_symlinks_under(&dest));

        let bad = d.join("bad.zip");
        {
            let mut w = zip::ZipWriter::new(fs::File::create(&bad).unwrap());
            w.start_file("ollama", SimpleFileOptions::default()).unwrap();
            w.write_all(b"x").unwrap();
            w.start_file("../escape", SimpleFileOptions::default()).unwrap();
            w.write_all(b"pwn").unwrap();
            w.finish().unwrap();
        }
        let err = extract_runtime_archive(&bad, &d.join("r2")).unwrap_err();
        assert!(err.contains("traversal"), "{err}");
        assert!(!d.join("escape").exists());
    }

    #[test]
    fn path_policy_unit_cases() {
        assert!(safe_relative(Path::new("a/b/c")).is_ok());
        assert!(safe_relative(Path::new("./a")).is_ok());
        assert!(safe_relative(Path::new("a/../b")).is_err());
        assert!(safe_relative(Path::new("/a")).is_err());
        assert!(safe_relative(Path::new("")).is_err());

        assert_eq!(resolve_relative(Path::new("x/link"), Path::new("real")).unwrap(), PathBuf::from("x/real"));
        assert_eq!(resolve_relative(Path::new("x/link"), Path::new("../real")).unwrap(), PathBuf::from("real"));
        assert!(resolve_relative(Path::new("link"), Path::new("../real")).is_err());
    }
}
