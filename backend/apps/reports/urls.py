from django.urls import path

from apps.reports.views import (
    AdminDashboardView,
    AuditReportExportView,
    AuditReportView,
    OwnerDashboardView,
    ProductionDashboardView,
    SalesmanDashboardView,
)

urlpatterns = [
    path("dashboard/admin/", AdminDashboardView.as_view(), name="dashboard-admin"),
    path("dashboard/owner/", OwnerDashboardView.as_view(), name="dashboard-owner"),
    path("dashboard/production/", ProductionDashboardView.as_view(), name="dashboard-production"),
    path("dashboard/salesman/", SalesmanDashboardView.as_view(), name="dashboard-salesman"),
    path("<str:report_key>/export/", AuditReportExportView.as_view(), name="report-export"),
    path("<str:report_key>/", AuditReportView.as_view(), name="report-detail"),
]
