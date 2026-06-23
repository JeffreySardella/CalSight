"""ETL alerting — send notifications when pipeline events occur.

Supports Discord and Slack webhooks via a single ALERT_WEBHOOK_URL env var.
Automatically detects the platform from the URL pattern.

Configuration:
    ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/...
    or
    ALERT_WEBHOOK_URL=https://hooks.slack.com/services/...

Both platforms accept a JSON payload with slightly different schemas —
this module handles the formatting differences transparently.

If ALERT_WEBHOOK_URL is not set, alerts are logged but not sent.
This is intentional for local development where you don't want webhook noise.
"""

from __future__ import annotations

import logging
import os
import shutil
from enum import Enum
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)


class AlertLevel(Enum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


# Color codes for Discord embeds (decimal RGB)
_COLORS = {
    AlertLevel.INFO: 3066993,      # green
    AlertLevel.WARNING: 15105570,  # orange
    AlertLevel.ERROR: 15158332,    # red
}

# Emoji prefixes for readability in both Discord and Slack
_EMOJI = {
    AlertLevel.INFO: "✅",      # checkmark
    AlertLevel.WARNING: "⚠️",  # warning sign
    AlertLevel.ERROR: "❌",     # red X
}


def send_alert(level: AlertLevel, title: str, body: str = "") -> bool:
    """Send an alert notification via webhook.

    Returns True if the alert was sent successfully, False otherwise.
    Never raises — alerting failures should not crash the pipeline.
    """
    # Check env var first (for Docker), then fall back to settings
    webhook_url = os.environ.get("ALERT_WEBHOOK_URL", "")
    if not webhook_url:
        try:
            from app.settings import settings
            webhook_url = settings.alert_webhook_url
        except Exception:
            pass

    # Always log regardless of webhook config
    log_msg = f"[{level.value.upper()}] {title}"
    if body:
        log_msg += f"\n{body}"

    if level == AlertLevel.ERROR:
        logger.error(log_msg)
    elif level == AlertLevel.WARNING:
        logger.warning(log_msg)
    else:
        logger.info(log_msg)

    if not webhook_url:
        return False

    try:
        payload = _build_payload(webhook_url, level, title, body)
        resp = httpx.post(webhook_url, json=payload, timeout=10.0)
        resp.raise_for_status()
        return True
    except Exception as exc:
        # Never let alerting failures propagate — the ETL must continue
        logger.warning("Failed to send alert webhook: %s", exc)
        return False


def _build_payload(url: str, level: AlertLevel, title: str, body: str) -> dict:
    """Build the appropriate JSON payload for Discord or Slack."""
    emoji = _EMOJI[level]
    full_title = f"{emoji} CalSight ETL: {title}"

    host = (urlparse(url).hostname or "").lower()
    if host == "discord.com" or host.endswith(".discord.com"):
        return _discord_payload(level, full_title, body)
    elif host == "hooks.slack.com":
        return _slack_payload(full_title, body)
    else:
        # Generic — try Slack format (most webhooks accept it)
        return _slack_payload(full_title, body)


def _discord_payload(level: AlertLevel, title: str, body: str) -> dict:
    """Discord webhook with rich embed."""
    embed = {
        "title": title,
        "color": _COLORS[level],
    }
    if body:
        # Discord has a 4096 char limit on embed descriptions
        embed["description"] = body[:4000]

    return {
        "embeds": [embed],
    }


def _slack_payload(title: str, body: str) -> dict:
    """Slack incoming webhook payload."""
    text = title
    if body:
        text += f"\n```\n{body[:3000]}\n```"

    return {"text": text}


def send_heartbeat(success: bool = True) -> bool:
    """Ping an external dead-man's-switch monitor (e.g. healthchecks.io).

    Push-based liveness, the inverse of send_alert(). The scheduler pings this
    URL after each successful run. If the ping stops arriving on schedule —
    because the job failed, the container died, or the whole box is down — the
    external monitor fires an alert on ITS side. This catches the silent
    failures send_alert() can't: send_alert only runs while the process is
    alive to call it, so a dead box never alerts.

    Reads HEARTBEAT_URL (env first, then settings). No-op if unset. On failure,
    appends '/fail' (the healthchecks.io convention) to signal an explicit
    failure rather than waiting for the grace period to elapse. Never raises.
    """
    url = os.environ.get("HEARTBEAT_URL", "")
    if not url:
        try:
            from app.settings import settings
            url = settings.heartbeat_url
        except Exception:
            pass

    if not url:
        return False

    ping_url = url if success else url.rstrip("/") + "/fail"
    try:
        httpx.get(ping_url, timeout=10.0)
        return True
    except Exception as exc:
        # Heartbeat failures must never crash the pipeline.
        logger.warning("Failed to send heartbeat ping: %s", exc)
        return False


DISK_WARN_PCT = 75
DISK_CRIT_PCT = 90


def get_disk_usage(path: str = "/") -> dict:
    """Get disk usage stats for the given mount point."""
    try:
        usage = shutil.disk_usage(path)
        total_gb = usage.total / (1024 ** 3)
        used_gb = usage.used / (1024 ** 3)
        free_gb = usage.free / (1024 ** 3)
        pct = (usage.used / usage.total) * 100
        return {
            "total_gb": round(total_gb, 1),
            "used_gb": round(used_gb, 1),
            "free_gb": round(free_gb, 1),
            "pct": round(pct, 1),
            "summary": f"{used_gb:.1f}G / {total_gb:.1f}G ({pct:.0f}%)",
        }
    except Exception as exc:
        logger.warning("Could not read disk usage: %s", exc)
        return {"total_gb": 0, "used_gb": 0, "free_gb": 0, "pct": 0, "summary": "unknown"}


def check_disk_and_alert() -> dict:
    """Check disk usage and send a warning/critical alert if thresholds exceeded.

    Returns the disk usage dict so callers can include it in their own alerts.
    """
    disk = get_disk_usage()
    pct = disk["pct"]

    if pct >= DISK_CRIT_PCT:
        send_alert(
            AlertLevel.ERROR,
            f"Disk CRITICAL: {disk['summary']}",
            f"Only {disk['free_gb']}G free — PostgreSQL will crash if disk fills up.\n"
            f"Expand the LXC disk or clean up old data immediately.",
        )
    elif pct >= DISK_WARN_PCT:
        send_alert(
            AlertLevel.WARNING,
            f"Disk warning: {disk['summary']}",
            f"{disk['free_gb']}G free — approaching danger zone.\n"
            f"Consider expanding disk or running cleanup.",
        )

    return disk
