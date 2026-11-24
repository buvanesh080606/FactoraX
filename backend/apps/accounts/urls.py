from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from apps.accounts.views import (
    AuditLogListView,
    CompanySettingView,
    ForgotPasswordView,
    LoginView,
    LogoutView,
    MeView,
    NotificationViewSet,
    UserViewSet,
)

router = DefaultRouter()
router.register("users", UserViewSet, basename="user")
router.register("notifications", NotificationViewSet, basename="notification")

urlpatterns = [
    path("login/", LoginView.as_view(), name="auth-login"),
    path("refresh/", TokenRefreshView.as_view(), name="auth-refresh"),
    path("logout/", LogoutView.as_view(), name="auth-logout"),
    path("me/", MeView.as_view(), name="auth-me"),
    path("forgot-password/", ForgotPasswordView.as_view(), name="auth-forgot-password"),
    path("company-settings/", CompanySettingView.as_view(), name="company-settings"),
    path("audit-logs/", AuditLogListView.as_view(), name="audit-logs"),
    path("", include(router.urls)),
]
