from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.permissions import ADMIN_OWNER, INTERNAL_ROLES, role_permission
from apps.purchases.models import Purchase
from apps.purchases.serializers import PurchaseSerializer
from apps.purchases.services import confirm_purchase


class PurchaseViewSet(viewsets.ModelViewSet):
    queryset = (
        Purchase.objects.select_related("supplier", "created_by", "confirmed_by")
        .prefetch_related(
            "items",
            "items__raw_material",
            "items__raw_material__unit",
            "items__packaging_material",
            "items__packaging_material__unit",
        )
        .all()
    )
    serializer_class = PurchaseSerializer
    permission_classes = [role_permission(INTERNAL_ROLES, ADMIN_OWNER)]
    filterset_fields = ["supplier", "status", "purchase_date"]
    search_fields = ["purchase_number", "invoice_ref", "supplier__name", "notes"]

    def get_queryset(self):
        qs = super().get_queryset()
        date_from = self.request.query_params.get("date_from")
        date_to = self.request.query_params.get("date_to")
        if date_from:
            qs = qs.filter(purchase_date__gte=date_from)
        if date_to:
            qs = qs.filter(purchase_date__lte=date_to)
        return qs

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        try:
            purchase = confirm_purchase(int(pk), user=request.user, request=request)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(purchase).data)
