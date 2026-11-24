from django.urls import path

from apps.inventory.views import (
    InventorySummaryView,
    OpeningStockCreateView,
    StockAdjustmentCreateView,
    StockLedgerListView,
)

urlpatterns = [
    path("summary/", InventorySummaryView.as_view(), name="inventory-summary"),
    path("ledger/", StockLedgerListView.as_view(), name="inventory-ledger"),
    path("opening-stock/", OpeningStockCreateView.as_view(), name="opening-stock"),
    path("adjustments/", StockAdjustmentCreateView.as_view(), name="stock-adjustments"),
]
