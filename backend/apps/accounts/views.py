from django.db.models import Q
from rest_framework import generics, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import AuditLog, CompanySetting, Notification, User
from apps.accounts.permissions import (
    ADMIN_OWNER,
    ALL_ROLES,
    IsAdminOrOwner,
    IsAuditViewer,
    role_permission,
)
from apps.accounts.serializers import (
    AuditLogSerializer,
    CompanySettingSerializer,
    LoginSerializer,
    NotificationSerializer,
    UserCreateSerializer,
    UserSerializer,
)
from apps.accounts.services import log_audit


class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        refresh = RefreshToken.for_user(user)
        log_audit(
            user=user,
            action="LOGIN",
            entity_type="User",
            entity_id=user.id,
            summary=f"{user.full_name} ({user.role}) logged in.",
            request=request,
        )
        return Response(
            {
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "user": UserSerializer(user).data,
                "redirect_to": user.home_route,
                "company": CompanySettingSerializer(CompanySetting.get_solo()).data,
            },
            status=status.HTTP_200_OK,
        )


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        refresh_token = request.data.get("refresh")
        if refresh_token:
            try:
                token = RefreshToken(refresh_token)
                token.blacklist()
            except Exception:
                pass
        log_audit(
            user=request.user,
            action="LOGOUT",
            entity_type="User",
            entity_id=request.user.id,
            summary=f"{request.user.full_name} logged out.",
            request=request,
        )
        return Response({"detail": "Logged out successfully."})


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(
            {
                "user": UserSerializer(request.user).data,
                "redirect_to": request.user.home_route,
                "company": CompanySettingSerializer(CompanySetting.get_solo()).data,
            }
        )


class ForgotPasswordView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        identifier = (request.data.get("identifier") or "").strip()
        if not identifier:
            return Response(
                {"detail": "Please provide your username or registered email."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user = User.objects.filter(
            Q(username__iexact=identifier) | Q(email__iexact=identifier)
        ).first()
        if user:
            log_audit(
                user=user,
                action="PASSWORD_RESET_REQUESTED",
                entity_type="User",
                entity_id=user.id,
                summary=f"Password reset requested for {user.username}.",
                request=request,
            )
        return Response(
            {
                "detail": "If an account matches that identifier, your administrator has been notified to reset your password."
            }
        )


class CompanySettingView(APIView):
    permission_classes = [role_permission(ALL_ROLES, ADMIN_OWNER)]

    def get(self, request):
        return Response(CompanySettingSerializer(CompanySetting.get_solo()).data)

    def patch(self, request):
        setting = CompanySetting.get_solo()
        serializer = CompanySettingSerializer(setting, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        log_audit(
            user=request.user,
            action="UPDATE_COMPANY_SETTINGS",
            entity_type="CompanySetting",
            entity_id=setting.id,
            summary="Updated factory settings.",
            metadata=request.data,
            request=request,
        )
        return Response(serializer.data)


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all().order_by("role", "first_name", "username")
    permission_classes = [IsAdminOrOwner]
    filterset_fields = ["role", "is_active"]
    search_fields = ["username", "email", "first_name", "last_name", "phone"]

    def get_serializer_class(self):
        if self.action == "create":
            return UserCreateSerializer
        return UserSerializer

    def perform_create(self, serializer):
        user = serializer.save()
        log_audit(
            user=self.request.user,
            action="CREATE_USER",
            entity_type="User",
            entity_id=user.id,
            summary=f"Created user {user.username} with role {user.role}.",
            request=self.request,
        )


class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return Notification.objects.filter(
            Q(recipient=user) | Q(recipient__isnull=True, target_role=user.role)
        ).order_by("-created_at")

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        unread_count = qs.filter(is_read=False).count()
        page = self.paginate_queryset(qs)
        if page is not None:
            response = self.get_paginated_response(self.get_serializer(page, many=True).data)
            response.data["unread_count"] = unread_count
            return response
        return Response(
            {
                "unread_count": unread_count,
                "results": self.get_serializer(qs[:50], many=True).data,
            }
        )

    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        notif = self.get_object()
        notif.is_read = True
        notif.save(update_fields=["is_read"])
        return Response({"status": "read", "id": notif.id})

    @action(detail=False, methods=["post"], url_path="read-all")
    def read_all(self, request):
        updated = self.get_queryset().filter(is_read=False).update(is_read=True)
        return Response({"marked_read": updated})


class AuditLogListView(generics.ListAPIView):
    queryset = AuditLog.objects.select_related("user").all()
    serializer_class = AuditLogSerializer
    permission_classes = [IsAuditViewer]
    filterset_fields = ["action", "entity_type", "user"]
    search_fields = ["summary", "entity_type", "entity_id", "action"]
