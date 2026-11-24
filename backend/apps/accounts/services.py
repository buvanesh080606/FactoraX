import logging
from typing import Any, Optional

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.utils import timezone

from apps.accounts.models import AuditLog, Notification, User

logger = logging.getLogger(__name__)


def log_audit(
    *,
    user: Optional[User],
    action: str,
    entity_type: str,
    entity_id: Any = "",
    summary: str = "",
    metadata: Optional[dict] = None,
    request=None,
) -> AuditLog:
    ip_address = None
    if request is not None:
        forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
        ip_address = forwarded.split(",")[0].strip() if forwarded else request.META.get("REMOTE_ADDR")
    return AuditLog.objects.create(
        user=user if (user and getattr(user, "is_authenticated", False)) else None,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id or ""),
        summary=summary,
        metadata=metadata or {},
        ip_address=ip_address,
    )


def notify_event(
    *,
    event_type: str,
    title: str,
    message: str,
    recipient: Optional[User] = None,
    target_roles: Optional[list[str]] = None,
    entity_type: str = "",
    entity_id: Any = "",
) -> list[Notification]:
    created = []
    if recipient is not None:
        n = Notification.objects.create(
            recipient=recipient,
            target_role="",
            event_type=event_type,
            title=title,
            message=message,
            entity_type=entity_type,
            entity_id=str(entity_id or ""),
        )
        created.append(n)
        _broadcast_group(f"user_{recipient.id}", n)

    for role in target_roles or []:
        n = Notification.objects.create(
            recipient=None,
            target_role=role,
            event_type=event_type,
            title=title,
            message=message,
            entity_type=entity_type,
            entity_id=str(entity_id or ""),
        )
        created.append(n)
        _broadcast_group(f"role_{role}", n)

    return created


def _broadcast_group(group_name: str, notification: Notification) -> None:
    try:
        channel_layer = get_channel_layer()
        if channel_layer is None:
            return
        async_to_sync(channel_layer.group_send)(
            group_name,
            {
                "type": "notification.event",
                "payload": {
                    "id": notification.id,
                    "event_type": notification.event_type,
                    "title": notification.title,
                    "message": notification.message,
                    "entity_type": notification.entity_type,
                    "entity_id": notification.entity_id,
                    "is_read": notification.is_read,
                    "created_at": timezone.localtime(notification.created_at).isoformat(),
                },
            },
        )
    except Exception as exc:
        logger.debug("WebSocket broadcast skipped: %s", exc)
