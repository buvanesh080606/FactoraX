from django.contrib.auth import authenticate
from django.db.models import Q
from rest_framework import serializers

from apps.accounts.models import AuditLog, CompanySetting, Notification, User


class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.ReadOnlyField()
    home_route = serializers.ReadOnlyField()

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "full_name",
            "role",
            "phone",
            "territory",
            "is_active",
            "home_route",
            "created_at",
        ]
        read_only_fields = ["id", "created_at", "full_name", "home_route"]


class UserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "password",
            "first_name",
            "last_name",
            "role",
            "phone",
            "territory",
            "is_active",
        ]

    def create(self, validated_data):
        password = validated_data.pop("password")
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user


class LoginSerializer(serializers.Serializer):
    identifier = serializers.CharField(
        help_text="Username or email address", required=False
    )
    username = serializers.CharField(required=False)
    email = serializers.CharField(required=False)
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        identifier = (
            attrs.get("identifier")
            or attrs.get("username")
            or attrs.get("email")
            or ""
        ).strip()
        password = attrs.get("password") or ""
        if not identifier or not password:
            raise serializers.ValidationError("Username/email and password are required.")

        candidate = User.objects.filter(
            Q(username__iexact=identifier) | Q(email__iexact=identifier)
        ).first()
        if not candidate:
            raise serializers.ValidationError("Invalid credentials.")
        if not candidate.is_active:
            raise serializers.ValidationError("This user account is deactivated.")

        user = authenticate(username=candidate.username, password=password)
        if not user:
            raise serializers.ValidationError("Invalid credentials.")

        attrs["user"] = user
        return attrs


class CompanySettingSerializer(serializers.ModelSerializer):
    class Meta:
        model = CompanySetting
        fields = [
            "id",
            "company_name",
            "gstin",
            "state",
            "address",
            "phone",
            "email",
            "invoice_prefix",
            "financial_year",
            "variance_tolerance_pct",
            "default_gst_rate",
            "updated_at",
        ]
        read_only_fields = ["id", "updated_at"]


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = [
            "id",
            "event_type",
            "title",
            "message",
            "entity_type",
            "entity_id",
            "target_role",
            "is_read",
            "created_at",
        ]


class AuditLogSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    user_role = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = [
            "id",
            "user",
            "user_name",
            "user_role",
            "action",
            "entity_type",
            "entity_id",
            "summary",
            "metadata",
            "ip_address",
            "created_at",
        ]

    def get_user_name(self, obj):
        return obj.user.full_name if obj.user else "System"

    def get_user_role(self, obj):
        return obj.user.role if obj.user else "SYSTEM"
