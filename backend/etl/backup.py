"""PostgreSQL backup management for CalSight.

Strategy:
  - Daily custom-format pg_dump (compressed, supports parallel restore)
  - 7-day retention with automatic rotation
  - Stored on the Proxmox host at /opt/calsight/backups (bind-mounted)
  - VM 109 (docker-dev) is the DB host; LXC 100 runs the backup client

Restore procedure:
  pg_restore --clean --if-exists -d calsight /backups/calsight_2026-05-16.dump

For point-in-time recovery, enable WAL archiving in postgresql.conf:
  archive_mode = on
  archive_command = 'cp %p /backups/wal/%f'

Usage:
    python -m etl.backup                    # Run backup now
    python -m etl.backup --list             # Show existing backups
    python -m etl.backup --restore FILENAME # Restore from a backup
    python -m etl.backup --upload-only      # Upload latest backup to R2

Offsite sync (Cloudflare R2):
  1. Create R2 bucket in Cloudflare dashboard -> R2 -> Create Bucket
  2. Create S3 API token: R2 -> Manage R2 API Tokens -> Create API token
     - Permissions: Object Read & Write
     - Scope: Apply to specific bucket only
  3. Set env vars:
     R2_ACCESS_KEY_ID=<access-key-id>
     R2_SECRET_ACCESS_KEY=<secret-access-key>
     R2_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
     R2_BUCKET_NAME=calsight-backups
  4. Test: python -m etl.backup --upload-only

Discord notifications:
  Set DISCORD_BACKUP_WEBHOOK to a Discord webhook URL.
  Sends success/failure embeds after each backup cycle.
"""

from __future__ import annotations

import argparse
import logging
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

DEFAULT_BACKUP_DIR = "/opt/calsight/backups"
RETENTION_DAYS = 7
# Always retain at least this many of the most-recent dumps regardless of age,
# so a run of failed pg_dumps can never rotate away every recovery point.
MIN_KEEP_BACKUPS = 3
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_BACKUP_WEBHOOK")


def _notify_discord(message: str, success: bool = True) -> None:
    """Send a backup notification to Discord. No-op if webhook not configured."""
    if not DISCORD_WEBHOOK_URL:
        return
    try:
        import httpx
        color = 0x4ADE80 if success else 0xF87171
        httpx.post(DISCORD_WEBHOOK_URL, json={
            "embeds": [{
                "title": "Backup " + ("OK" if success else "FAILED"),
                "description": message,
                "color": color,
                "footer": {"text": "CalSight Backup"},
                "timestamp": datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z",
            }],
        }, timeout=10)
    except Exception as exc:
        logger.warning("Discord notification failed: %s", exc)


def upload_to_r2(filepath: Path) -> bool:
    """Upload a backup file to Cloudflare R2 for offsite storage.

    Requires env vars: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
    R2_ENDPOINT_URL, R2_BUCKET_NAME

    Returns True on success, False on failure. Skips silently if
    env vars are not configured.
    """
    access_key = os.environ.get("R2_ACCESS_KEY_ID")
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY")
    endpoint_url = os.environ.get("R2_ENDPOINT_URL")
    bucket_name = os.environ.get("R2_BUCKET_NAME")

    if not all([access_key, secret_key, endpoint_url, bucket_name]):
        logger.info("R2 not configured, skipping offsite upload")
        return False

    try:
        import boto3

        s3 = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
        )

        key = f"backups/{filepath.name}"
        size_mb = filepath.stat().st_size / (1024 * 1024)

        logger.info("Uploading %s (%.1f MB) to R2 bucket %s ...", filepath.name, size_mb, bucket_name)
        s3.upload_file(str(filepath), bucket_name, key)
        logger.info("Upload complete: s3://%s/%s (%.1f MB)", bucket_name, key, size_mb)
        return True

    except Exception as exc:
        logger.error("R2 upload failed: %s", exc)
        return False


def rotate_r2_backups(retention_days: int = RETENTION_DAYS) -> int:
    """Delete backups older than retention_days from R2. Returns count removed."""
    access_key = os.environ.get("R2_ACCESS_KEY_ID")
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY")
    endpoint_url = os.environ.get("R2_ENDPOINT_URL")
    bucket_name = os.environ.get("R2_BUCKET_NAME")

    if not all([access_key, secret_key, endpoint_url, bucket_name]):
        return 0

    try:
        import boto3

        s3 = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
        )

        resp = s3.list_objects_v2(Bucket=bucket_name, Prefix="backups/calsight_")
        if "Contents" not in resp:
            return 0

        cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=retention_days)
        removed = 0
        for obj in resp["Contents"]:
            fname = obj["Key"].split("/")[-1]
            try:
                date_str = fname.replace("calsight_", "").replace(".dump", "")
                file_date = datetime.strptime(date_str, "%Y-%m-%d")
                if file_date < cutoff:
                    s3.delete_object(Bucket=bucket_name, Key=obj["Key"])
                    removed += 1
                    logger.info("Rotated from R2: %s", fname)
            except (ValueError, KeyError):
                continue

        if removed:
            logger.info("Rotated %d R2 backup(s) older than %d days", removed, retention_days)
        return removed

    except Exception as exc:
        logger.error("R2 rotation failed: %s", exc)
        return 0


def get_db_url() -> str:
    """Resolve the database URL for pg_dump."""
    # Prefer the ETL URL (has full access); fall back to regular DB URL
    url = (
        os.environ.get("ETL_DATABASE_URL_AZURE")
        or os.environ.get("ETL_DATABASE_URL")
        or os.environ.get("DATABASE_URL_AZURE")
        or os.environ.get("DATABASE_URL")
    )
    if not url:
        raise RuntimeError(
            "No database URL found. Set DATABASE_URL or ETL_DATABASE_URL."
        )
    return url


def _split_db_password(url: str) -> tuple[str, str | None]:
    """Strip the password out of a libpq URL.

    Passing a URL with an inline password as a pg_dump argument exposes the
    secret on the process command line (readable via `ps` or
    /proc/<pid>/cmdline by any local user). We instead hand pg_dump a
    password-free URL and supply the secret through the PGPASSWORD env var.
    """
    parts = urlsplit(url)
    if parts.password is None:
        return url, None
    host = parts.hostname or ""
    if parts.port:
        host = f"{host}:{parts.port}"
    netloc = f"{parts.username}@{host}" if parts.username else host
    sanitized = urlunsplit(
        (parts.scheme, netloc, parts.path, parts.query, parts.fragment)
    )
    return sanitized, parts.password


def run_backup(backup_dir: str = DEFAULT_BACKUP_DIR) -> Path | None:
    """Execute pg_dump and return the path to the backup file.

    Uses custom format (-Fc) because:
      - Compressed by default (typically 5-10x smaller than plain SQL)
      - Supports parallel restore (pg_restore -j 4)
      - Supports selective restore (individual tables)
      - Supports --clean to drop objects before recreating

    We exclude etl_runs because it's operational log data that's easily
    regenerated, and excluding it saves ~5-10% of backup size.
    """
    backup_path = Path(backup_dir)
    backup_path.mkdir(parents=True, exist_ok=True)

    today = datetime.now(timezone.utc).replace(tzinfo=None).strftime("%Y-%m-%d")
    filename = f"calsight_{today}.dump"
    filepath = backup_path / filename

    db_url = get_db_url()
    safe_url, password = _split_db_password(db_url)
    env = os.environ.copy()
    if password is not None:
        env["PGPASSWORD"] = password

    logger.info("Starting backup: %s", filepath)
    start = time.monotonic()

    try:
        result = subprocess.run(
            [
                "pg_dump",
                "--format=custom",
                "--compress=6",
                "--no-owner",
                "--no-acl",
                f"--file={filepath}",
                safe_url,
            ],
            capture_output=True,
            text=True,
            timeout=7200,  # 2 hours max for 11M+ rows
            env=env,
        )

        if result.returncode != 0:
            logger.error("pg_dump failed:\n%s", result.stderr[:1000])
            return None

        elapsed = time.monotonic() - start
        size_mb = filepath.stat().st_size / (1024 * 1024)
        logger.info(
            "Backup complete: %s (%.1f MB in %.0f seconds)",
            filename, size_mb, elapsed,
        )

        upload_to_r2(filepath)

        return filepath

    except FileNotFoundError:
        logger.error(
            "pg_dump not found. Install postgresql-client:\n"
            "  apt-get install -y postgresql-client"
        )
        return None
    except subprocess.TimeoutExpired:
        logger.error("Backup timed out after 2 hours")
        return None


def rotate_backups(
    backup_dir: str = DEFAULT_BACKUP_DIR,
    retention_days: int = RETENTION_DAYS,
    min_keep: int = MIN_KEEP_BACKUPS,
) -> int:
    """Delete backups older than retention_days, but ALWAYS keep at least
    `min_keep` most-recent dumps regardless of age.

    Without the min_keep guard, if pg_dump fails for retention_days+ consecutive
    days the rotation would delete every surviving backup, leaving zero local
    recovery points. Returns count removed.
    """
    backup_path = Path(backup_dir)
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=retention_days)

    dated_backups = []
    for dump_file in backup_path.glob("calsight_*.dump"):
        try:
            # Parse date from filename: calsight_2026-05-16.dump
            date_str = dump_file.stem.replace("calsight_", "")
            file_date = datetime.strptime(date_str, "%Y-%m-%d")
            dated_backups.append((file_date, dump_file))
        except ValueError:
            continue

    # Newest first; the first `min_keep` are protected from deletion.
    dated_backups.sort(key=lambda pair: pair[0], reverse=True)

    removed = 0
    for file_date, dump_file in dated_backups[min_keep:]:
        if file_date < cutoff:
            try:
                dump_file.unlink()
                removed += 1
                logger.info("Rotated: %s", dump_file.name)
            except OSError as exc:
                logger.warning("Could not remove %s: %s", dump_file.name, exc)

    if removed:
        logger.info(
            "Rotated %d backup(s) older than %d days (kept newest %d)",
            removed, retention_days, min_keep,
        )

    return removed


def list_backups(backup_dir: str = DEFAULT_BACKUP_DIR) -> list[dict]:
    """List all backup files with metadata."""
    backup_path = Path(backup_dir)
    backups = []

    for dump_file in sorted(backup_path.glob("calsight_*.dump"), reverse=True):
        try:
            date_str = dump_file.stem.replace("calsight_", "")
            file_date = datetime.strptime(date_str, "%Y-%m-%d")
            size_mb = dump_file.stat().st_size / (1024 * 1024)
            age_days = (datetime.now(timezone.utc).replace(tzinfo=None) - file_date).days

            backups.append({
                "filename": dump_file.name,
                "date": date_str,
                "size_mb": round(size_mb, 1),
                "age_days": age_days,
                "path": str(dump_file),
            })
        except (ValueError, OSError):
            continue

    return backups


def main() -> int:
    parser = argparse.ArgumentParser(description="CalSight PostgreSQL Backup")
    parser.add_argument("--dir", default=DEFAULT_BACKUP_DIR, help="Backup directory")
    parser.add_argument("--list", action="store_true", help="List existing backups")
    parser.add_argument("--rotate-only", action="store_true", help="Only rotate old backups")
    parser.add_argument("--retention", type=int, default=RETENTION_DAYS, help="Days to retain")
    parser.add_argument("--upload-only", action="store_true", help="Upload latest backup to R2")
    args = parser.parse_args()

    if args.list:
        backups = list_backups(args.dir)
        if not backups:
            print("No backups found.")
            return 0
        print(f"\n{'Filename':<35} {'Size':<10} {'Age':<10}")
        print("-" * 55)
        for b in backups:
            print(f"{b['filename']:<35} {b['size_mb']:.1f} MB    {b['age_days']}d old")
        print(f"\nTotal: {len(backups)} backup(s)")
        return 0

    if args.upload_only:
        backup_path = Path(args.dir)
        dumps = sorted(backup_path.glob("calsight_*.dump"), reverse=True)
        if not dumps:
            logger.error("No backup files found in %s", args.dir)
            return 1
        latest = dumps[0]
        logger.info("Latest backup: %s", latest.name)
        return 0 if upload_to_r2(latest) else 1

    if args.rotate_only:
        rotate_backups(args.dir, args.retention)
        return 0

    # Run backup then rotate
    filepath = run_backup(args.dir)
    if filepath is None:
        _notify_discord("pg_dump failed — check server logs", success=False)
        return 1

    size_mb = filepath.stat().st_size / (1024 * 1024)
    r2_ok = upload_to_r2(filepath)
    local_rotated = rotate_backups(args.dir, args.retention)
    r2_rotated = rotate_r2_backups(args.retention)

    lines = [f"**{filepath.name}** — {size_mb:.1f} MB"]
    if r2_ok:
        lines.append("Uploaded to R2")
    elif DISCORD_WEBHOOK_URL and os.environ.get("R2_BUCKET_NAME"):
        _notify_discord(f"Backup saved locally but R2 upload failed\n{lines[0]}", success=False)
    if local_rotated or r2_rotated:
        lines.append(f"Rotated: {local_rotated} local, {r2_rotated} R2")
    _notify_discord("\n".join(lines), success=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
