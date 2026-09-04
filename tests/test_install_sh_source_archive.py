from pathlib import Path
import json


ROOT = Path(__file__).resolve().parents[1]


def test_posix_installer_accepts_and_extracts_packaged_source_archive():
    source = (ROOT / "scripts" / "install.sh").read_text(encoding="utf-8")

    assert 'SOURCE_ARCHIVE=""' in source
    assert "--source-archive|-SourceArchive" in source
    assert 'python3 - "$SOURCE_ARCHIVE" "$extract_dir"' in source
    assert "unsafe source archive member" in source
    assert 'source_root="$extract_dir/hermes-agent"' in source
    assert 'used_source_archive=true' in source
    assert '[ "$used_source_archive" = false ]' in source


def test_desktop_passes_packaged_archive_to_posix_installer():
    source = (
        ROOT / "apps" / "desktop" / "electron" / "bootstrap-runner.cjs"
    ).read_text(encoding="utf-8")

    assert "args.push('--source-archive', sourceArchive)" in source


def test_desktop_package_bundles_installers_for_both_platform_families():
    package = json.loads(
        (ROOT / "apps" / "desktop" / "package.json").read_text(encoding="utf-8")
    )
    resources = {
        (entry.get("from"), entry.get("to"))
        for entry in package["build"]["extraResources"]
    }

    assert ("../../scripts/install.ps1", "bootstrap/install.ps1") in resources
    assert ("../../scripts/install.sh", "bootstrap/install.sh") in resources
