from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path


def health_check(_request):
    return JsonResponse({"status": "ok", "service": "SmartFactory ERP API"})


urlpatterns = [
    path("django-admin/", admin.site.urls),
    path("api/health/", health_check, name="health-check"),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/masters/", include("apps.masters.urls")),
    path("api/inventory/", include("apps.inventory.urls")),
    path("api/purchases/", include("apps.purchases.urls")),
    path("api/production/", include("apps.production.urls")),
    path("api/sales/", include("apps.sales.urls")),
    path("api/reports/", include("apps.reports.urls")),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
