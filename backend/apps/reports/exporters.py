import csv
from io import BytesIO, StringIO

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def export_csv(title: str, columns: list[tuple[str, str]], rows: list[dict]) -> bytes:
    buf = StringIO()
    writer = csv.writer(buf)
    writer.writerow([label for _, label in columns])
    for row in rows:
        writer.writerow([row.get(key, "") for key, _ in columns])
    return buf.getvalue().encode("utf-8-sig")


def export_xlsx(title: str, columns: list[tuple[str, str]], rows: list[dict]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = title[:31]

    header_fill = PatternFill(start_color="351044", end_color="351044", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True)

    ws.append([label for _, label in columns])
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="left", vertical="center")

    for row in rows:
        ws.append([row.get(key, "") for key, _ in columns])

    for col_idx, (_, label) in enumerate(columns, start=1):
        max_len = max(
            [len(str(label))] + [len(str(r.get(columns[col_idx - 1][0], ""))) for r in rows[:200]]
        )
        ws.column_dimensions[ws.cell(1, col_idx).column_letter].width = min(max_len + 4, 42)

    out = BytesIO()
    wb.save(out)
    return out.getvalue()


def export_pdf(title: str, columns: list[tuple[str, str]], rows: list[dict]) -> bytes:
    buf = BytesIO()
    page_size = landscape(A4) if len(columns) > 6 else A4
    doc = SimpleDocTemplate(
        buf,
        pagesize=page_size,
        leftMargin=10 * mm,
        rightMargin=10 * mm,
        topMargin=12 * mm,
        bottomMargin=12 * mm,
        title=title,
    )
    styles = getSampleStyleSheet()
    heading = ParagraphStyle(
        "RepHeading",
        parent=styles["Heading2"],
        textColor=colors.HexColor("#351044"),
        fontSize=14,
    )
    cell_style = ParagraphStyle(
        "RepCell",
        parent=styles["Normal"],
        fontSize=7.5,
        leading=9.5,
        textColor=colors.HexColor("#24172A"),
    )

    elements = [Paragraph(f"FactoraX ERP — {title}", heading), Spacer(1, 4 * mm)]
    table_data = [[label for _, label in columns]]
    for row in rows[:500]:
        table_data.append(
            [Paragraph(str(row.get(key, "")), cell_style) for key, _ in columns]
        )

    avail_width = page_size[0] - 20 * mm
    col_w = avail_width / max(len(columns), 1)
    tbl = Table(table_data, colWidths=[col_w] * len(columns), repeatRows=1)
    tbl.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#351044")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, 0), 8),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FFF6FA")]),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#E9DFE8")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    elements.append(tbl)
    doc.build(elements)
    return buf.getvalue()
