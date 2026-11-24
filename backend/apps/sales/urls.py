from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.sales.views import (
    DispatchViewSet,
    InvoiceViewSet,
    PaymentViewSet,
    ReceivablesAgeingView,
    SalesOrderViewSet,
)

router = DefaultRouter()
router.register("orders", SalesOrderViewSet, basename="sales-order")
router.register("invoices", InvoiceViewSet, basename="invoice")
router.register("dispatches", DispatchViewSet, basename="dispatch")
router.register("payments", PaymentViewSet, basename="payment")

urlpatterns = [
    path("receivables/", ReceivablesAgeingView.as_view(), name="receivables-ageing"),
    path("", include(router.urls)),
]
