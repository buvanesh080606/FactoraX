from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.masters.views import (
    BOMViewSet,
    CustomerViewSet,
    PackagingMaterialViewSet,
    ProductViewSet,
    RawMaterialViewSet,
    SupplierViewSet,
    UnitViewSet,
)

router = DefaultRouter()
router.register("units", UnitViewSet, basename="unit")
router.register("customers", CustomerViewSet, basename="customer")
router.register("suppliers", SupplierViewSet, basename="supplier")
router.register("products", ProductViewSet, basename="product")
router.register("raw-materials", RawMaterialViewSet, basename="raw-material")
router.register("packaging-materials", PackagingMaterialViewSet, basename="packaging-material")
router.register("boms", BOMViewSet, basename="bom")

urlpatterns = [
    path("", include(router.urls)),
]
