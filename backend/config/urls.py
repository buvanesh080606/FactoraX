from django.conf import settings
from django.contrib import admin
from django.db import connection
from django.http import JsonResponse
from django.urls import include, path, re_path
from django.views.static import serve


def health_check(request):
    payload = {"status": "ok", "service": "FactoraX ERP API"}
    if request.GET.get("db") == "1":
        with connection.cursor() as cur:
            cur.execute("SELECT 1")
        payload["database"] = "ok"
    return JsonResponse(payload)


urlpatterns = [
    path("", health_check, name="root-health"),
    path("django-admin/", admin.site.urls),
    path("api/health/", health_check, name="health-check"),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/masters/", include("apps.masters.urls")),
    path("api/inventory/", include("apps.inventory.urls")),
    path("api/purchases/", include("apps.purchases.urls")),
    path("api/production/", include("apps.production.urls")),
    path("api/sales/", include("apps.sales.urls")),
    path("api/reports/", include("apps.reports.urls")),
    re_path(r"^media/(?P<path>.*)$", serve, {"document_root": settings.MEDIA_ROOT}),
]
