from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.accounts.models import UserRole


def role_permission(read_roles, write_roles):
    """Factory returning a DRF permission class enforcing distinct read and write roles."""

    class RoleAccessPermission(BasePermission):
        def has_permission(self, request, view):
            user = request.user
            if not user or not user.is_authenticated:
                return False
            if request.method in SAFE_METHODS:
                return user.role in read_roles
            return user.role in write_roles

    RoleAccessPermission.__name__ = (
        f"RolePerm_{'_'.join(read_roles)}__W_{'_'.join(write_roles)}"
    )
    return RoleAccessPermission


class IsAdminOrOwner(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in {UserRole.ADMIN, UserRole.OWNER}
        )


class IsOwnerOnly(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role == UserRole.OWNER
        )


class IsSalesmanOnly(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role == UserRole.SALESMAN
        )


class IsAuditViewer(BasePermission):
    """Read-only access for Accountant, Admin, Owner."""

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method not in SAFE_METHODS:
            return False
        return request.user.role in {
            UserRole.ACCOUNTANT,
            UserRole.ADMIN,
            UserRole.OWNER,
        }


ALL_ROLES = {
    UserRole.SALESMAN,
    UserRole.ADMIN,
    UserRole.PRODUCTION,
    UserRole.ACCOUNTANT,
    UserRole.OWNER,
}
INTERNAL_ROLES = {
    UserRole.ADMIN,
    UserRole.PRODUCTION,
    UserRole.ACCOUNTANT,
    UserRole.OWNER,
}
ADMIN_OWNER = {UserRole.ADMIN, UserRole.OWNER}
PRODUCTION_WRITE = {UserRole.PRODUCTION, UserRole.ADMIN, UserRole.OWNER}
