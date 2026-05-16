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
from enum import Enum

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

    if "discord.com" in url:
        return _discord_payload(level, full_title, body)
    elif "hooks.slack.com" in url:
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
