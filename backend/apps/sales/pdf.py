from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from apps.sales.models import Invoice
from apps.sales.services import get_invoice_allocated_total, get_invoice_outstanding

DEEP_PURPLE = colors.HexColor("#351044")
MAGENTA = colors.HexColor("#B81762")
LIGHT_PINK = colors.HexColor("#FFF6FA")
BORDER = colors.HexColor("#E9DFE8")
TEXT_DARK = colors.HexColor("#24172A")
TEXT_MUTED = colors.HexColor("#746879")


def render_invoice_pdf(invoice: Invoice) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=14 * mm,
        bottomMargin=14 * mm,
        title=f"Tax Invoice {invoice.invoice_number}",
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "SFTitle",
        parent=styles["Heading1"],
        fontSize=18,
        textColor=colors.white,
        leading=22,
    )
    sub_white = ParagraphStyle(
        "SFSubWhite",
        parent=styles["Normal"],
        fontSize=9,
        textColor=colors.HexColor("#F4DCE8"),
        leading=12,
    )
    normal = ParagraphStyle(
        "SFNormal",
        parent=styles["Normal"],
        fontSize=9,
        textColor=TEXT_DARK,
        leading=13,
    )
    bold = ParagraphStyle(
        "SFBold",
        parent=normal,
        fontName="Helvetica-Bold",
    )
    muted = ParagraphStyle(
        "SFMuted",
        parent=normal,
        fontSize=8,
        textColor=TEXT_MUTED,
    )

    elements = []

    # Header Banner
    header_data = [
        [
            Paragraph(f"<b>{invoice.seller_name}</b><br/><font size='8'>TAX INVOICE (GST)</font>", title_style),
            Paragraph(
                f"<b>Invoice No:</b> {invoice.invoice_number}<br/>"
                f"<b>Financial Year:</b> {invoice.financial_year}<br/>"
                f"<b>Invoice Date:</b> {invoice.invoice_date.strftime('%d %b %Y')}<br/>"
                f"<b>Order Ref:</b> {invoice.order.order_number}",
                sub_white,
            ),
        ]
    ]
    header_table = Table(header_data, colWidths=[112 * mm, 70 * mm])
    header_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), DEEP_PURPLE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ]
        )
    )
    elements.append(header_table)
    elements.append(Spacer(1, 5 * mm))

    # Seller & Buyer details
    supply_type = "Inter-State Supply (IGST)" if invoice.is_inter_state else "Intra-State Supply (CGST + SGST)"
    party_data = [
        [
            Paragraph(
                f"<b>SELLER DETAILS</b><br/>"
                f"{invoice.seller_name}<br/>"
                f"{invoice.seller_address}<br/>"
                f"<b>State:</b> {invoice.seller_state}<br/>"
                f"<b>GSTIN:</b> {invoice.seller_gstin}",
                normal,
            ),
            Paragraph(
                f"<b>BILL TO (CUSTOMER)</b><br/>"
                f"{invoice.customer_name}<br/>"
                f"{invoice.customer_address or 'N/A'}<br/>"
                f"<b>State:</b> {invoice.customer_state}<br/>"
                f"<b>GSTIN:</b> {invoice.customer_gstin or 'Unregistered'}<br/>"
                f"<b>Supply Type:</b> {supply_type}",
                normal,
            ),
        ]
    ]
    party_table = Table(party_data, colWidths=[91 * mm, 91 * mm])
    party_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), LIGHT_PINK),
                ("BOX", (0, 0), (-1, -1), 0.8, BORDER),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, BORDER),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    elements.append(party_table)
    elements.append(Spacer(1, 5 * mm))

    # Line items table
    if invoice.is_inter_state:
        headers = ["#", "Product", "HSN", "Qty", "Rate (Rs)", "Taxable", "GST %", "IGST", "Total (Rs)"]
        col_widths = [9 * mm, 52 * mm, 18 * mm, 16 * mm, 19 * mm, 21 * mm, 13 * mm, 16 * mm, 18 * mm]
    else:
        headers = ["#", "Product", "HSN", "Qty", "Rate", "Taxable", "CGST", "SGST", "Total (Rs)"]
        col_widths = [8 * mm, 50 * mm, 18 * mm, 15 * mm, 18 * mm, 20 * mm, 17 * mm, 17 * mm, 19 * mm]

    rows = [headers]
    for idx, item in enumerate(invoice.items.all(), start=1):
        if invoice.is_inter_state:
            rows.append(
                [
                    str(idx),
                    item.product_name,
                    item.hsn_code,
                    f"{item.quantity:.0f}" if item.quantity == int(item.quantity) else f"{item.quantity:.2f}",
                    f"{item.unit_price:.2f}",
                    f"{item.taxable_amount:.2f}",
                    f"{item.gst_rate:.1f}%",
                    f"{item.igst_amount:.2f}",
                    f"{item.line_total:.2f}",
                ]
            )
        else:
            rows.append(
                [
                    str(idx),
                    item.product_name,
                    item.hsn_code,
                    f"{item.quantity:.0f}" if item.quantity == int(item.quantity) else f"{item.quantity:.2f}",
                    f"{item.unit_price:.2f}",
                    f"{item.taxable_amount:.2f}",
                    f"{item.cgst_amount:.2f}",
                    f"{item.sgst_amount:.2f}",
                    f"{item.line_total:.2f}",
                ]
            )

    item_table = Table(rows, colWidths=col_widths, repeatRows=1)
    item_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), MAGENTA),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.2),
                ("ALIGN", (0, 0), (0, -1), "CENTER"),
                ("ALIGN", (3, 1), (-1, -1), "RIGHT"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT_PINK]),
                ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    elements.append(item_table)
    elements.append(Spacer(1, 5 * mm))

    # Tax & Payment Summary
    paid = get_invoice_allocated_total(invoice.id)
    outstanding = get_invoice_outstanding(invoice)

    summary_rows = [
        ["Taxable Value", f"Rs. {invoice.taxable_total:,.2f}"],
    ]
    if invoice.is_inter_state:
        summary_rows.append(["IGST", f"Rs. {invoice.igst_total:,.2f}"])
    else:
        summary_rows.append(["CGST", f"Rs. {invoice.cgst_total:,.2f}"])
        summary_rows.append(["SGST", f"Rs. {invoice.sgst_total:,.2f}"])
    summary_rows.append(["Invoice Grand Total", f"Rs. {invoice.grand_total:,.2f}"])
    summary_rows.append(["Payments Received", f"Rs. {paid:,.2f}"])
    summary_rows.append(["Balance Outstanding", f"Rs. {outstanding:,.2f}"])

    sum_table = Table(summary_rows, colWidths=[45 * mm, 35 * mm])
    sum_table.setStyle(
        TableStyle(
            [
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("LINEABOVE", (0, -3), (-1, -3), 1, DEEP_PURPLE),
                ("FONTNAME", (0, -3), (-1, -3), "Helvetica-Bold"),
                ("BACKGROUND", (0, -3), (-1, -3), LIGHT_PINK),
                ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                ("TEXTCOLOR", (0, -1), (-1, -1), DEEP_PURPLE),
                ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, BORDER),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )

    footer_wrapper = Table(
        [
            [
                Paragraph(
                    "<b>Terms & Declaration:</b><br/>"
                    "1. Goods once dispatched are subject to quality inspection at delivery.<br/>"
                    "2. All disputes are subject to Tiruchirappalli jurisdiction.<br/>"
                    "3. Computer-generated GST tax invoice from SmartFactory ERP.",
                    muted,
                ),
                sum_table,
            ]
        ],
        colWidths=[100 * mm, 82 * mm],
    )
    footer_wrapper.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    elements.append(footer_wrapper)
    elements.append(Spacer(1, 14 * mm))

    elements.append(
        Paragraph(
            f"For <b>{invoice.seller_name}</b> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Authorized Signatory",
            bold,
        )
    )

    doc.build(elements)
    return buf.getvalue()
