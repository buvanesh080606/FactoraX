from django.contrib import admin

from apps.accounts.models import AuditLog, CompanySetting, Notification, User

admin.site.register(User)
admin.site.register(CompanySetting)
admin.site.register(AuditLog)
admin.site.register(Notification)
