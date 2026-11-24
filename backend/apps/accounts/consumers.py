from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.models import User


@database_sync_to_async
def _get_user_from_token(token_str: str):
    if not token_str:
        return None
    try:
        token = AccessToken(token_str)
        user_id = token.get("user_id")
        return User.objects.filter(id=user_id, is_active=True).first()
    except Exception:
        return None


class NotificationConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        query = parse_qs(self.scope.get("query_string", b"").decode("utf-8"))
        token_str = (query.get("token") or [""])[0]
        user = await _get_user_from_token(token_str)
        if not user:
            await self.close(code=4001)
            return

        self.user = user
        self.user_group = f"user_{user.id}"
        self.role_group = f"role_{user.role}"

        await self.channel_layer.group_add(self.user_group, self.channel_name)
        await self.channel_layer.group_add(self.role_group, self.channel_name)
        await self.accept()
        await self.send_json(
            {
                "type": "connected",
                "user": user.username,
                "role": user.role,
            }
        )

    async def disconnect(self, close_code):
        if hasattr(self, "user_group"):
            await self.channel_layer.group_discard(self.user_group, self.channel_name)
        if hasattr(self, "role_group"):
            await self.channel_layer.group_discard(self.role_group, self.channel_name)

    async def notification_event(self, event):
        await self.send_json(
            {
                "type": "notification",
                **event["payload"],
            }
        )
