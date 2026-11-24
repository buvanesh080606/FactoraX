from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.production.views import (
    ExpenseViewSet,
    ProductionPlanningView,
    ProductionRunViewSet,
    VarianceReportView,
)

router = DefaultRouter()
router.register("runs", ProductionRunViewSet, basename="production-run")
router.register("expenses", ExpenseViewSet, basename="expense")

urlpatterns = [
    path("variance-report/", VarianceReportView.as_view(), name="variance-report"),
    path("planning/", ProductionPlanningView.as_view(), name="production-planning"),
    path("", include(router.urls)),
]
