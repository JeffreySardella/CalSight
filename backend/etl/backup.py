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
"""

from __future__ import annotations

import argparse
import logging
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

DEFAULT_BACKUP_DIR = "/opt/calsight/backups"
RETENTION_DAYS = 7


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

    today = datetime.utcnow().strftime("%Y-%m-%d")
    filename = f"calsight_{today}.dump"
    filepath = backup_path / filename

    db_url = get_db_url()

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
                db_url,
            ],
            capture_output=True,
            text=True,
            timeout=7200,  # 2 hours max for 11M+ rows
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


def rotate_backups(backup_dir: str = DEFAULT_BACKUP_DIR, retention_days: int = RETENTION_DAYS) -> int:
    """Delete backups older than retention_days. Returns count removed."""
    backup_path = Path(backup_dir)
    cutoff = datetime.utcnow() - timedelta(days=retention_days)
    removed = 0

    for dump_file in backup_path.glob("calsight_*.dump"):
        try:
            # Parse date from filename: calsight_2026-05-16.dump
            date_str = dump_file.stem.replace("calsight_", "")
            file_date = datetime.strptime(date_str, "%Y-%m-%d")
            if file_date < cutoff:
                dump_file.unlink()
                removed += 1
                logger.info("Rotated: %s", dump_file.name)
        except (ValueError, OSError) as exc:
            logger.warning("Could not process %s: %s", dump_file.name, exc)

    if removed:
        logger.info("Rotated %d backup(s) older than %d days", removed, retention_days)

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
            age_days = (datetime.utcnow() - file_date).days

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
        return 1

    rotate_backups(args.dir, args.retention)
    return 0


if __name__ == "__main__":
    sys.exit(main())
