from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs" / "templates" / "JKSH_Vendor_Price_Data_Template.xlsx"


def col_name(number: int) -> str:
    result = ""
    while number:
        number, remainder = divmod(number - 1, 26)
        result = chr(65 + remainder) + result
    return result


def cell(reference: str, value: object = "", style: int = 0, formula: str | None = None) -> str:
    attrs = f'r="{reference}"'
    if style:
        attrs += f' s="{style}"'
    if formula is not None:
        return f"<c {attrs}><f>{escape(formula)}</f><v></v></c>"
    if isinstance(value, (int, float)):
        return f"<c {attrs}><v>{value}</v></c>"
    text = escape(str(value))
    preserve = ' xml:space="preserve"' if str(value).strip() != str(value) else ""
    return f'<c {attrs} t="inlineStr"><is><t{preserve}>{text}</t></is></c>'


def row_xml(row_number: int, values: list[object], styles: list[int] | None = None) -> str:
    styles = styles or [0] * len(values)
    cells = [cell(f"{col_name(i)}{row_number}", value, styles[i - 1]) for i, value in enumerate(values, 1)]
    return f'<row r="{row_number}">{"".join(cells)}</row>'


def worksheet(
    rows: list[str],
    widths: list[float],
    dimensions: str,
    freeze_row: int | None = None,
    auto_filter: str | None = None,
    validations: list[tuple[str, str]] | None = None,
) -> str:
    cols = "".join(
        f'<col min="{index}" max="{index}" width="{width}" customWidth="1"/>'
        for index, width in enumerate(widths, 1)
    )
    pane = ""
    if freeze_row:
        pane = (
            f'<sheetViews><sheetView workbookViewId="0"><pane ySplit="{freeze_row}" '
            f'topLeftCell="A{freeze_row + 1}" activePane="bottomLeft" state="frozen"/>'
            "</sheetView></sheetViews>"
        )
    else:
        pane = '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
    validation_xml = ""
    if validations:
        rules = "".join(
            f'<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="{escape(ref)}">'
            f'<formula1>"{escape(options)}"</formula1></dataValidation>'
            for ref, options in validations
        )
        validation_xml = f'<dataValidations count="{len(validations)}">{rules}</dataValidations>'
    filter_xml = f'<autoFilter ref="{auto_filter}"/>' if auto_filter else ""
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<dimension ref="{dimensions}"/>{pane}<sheetFormatPr defaultRowHeight="15"/>'
        f'<cols>{cols}</cols><sheetData>{"".join(rows)}</sheetData>{filter_xml}{validation_xml}'
        '<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>'
        "</worksheet>"
    )


def instructions_sheet() -> str:
    rows = [
        row_xml(1, ["JKSH Vendor and Franchise Selling Price Template"], [2]),
        row_xml(3, ["Purpose", "Accountant fills vendor details, purchase costs and JKSH prices charged to franchise outlets."], [1, 0]),
        row_xml(5, ["Instructions"], [1]),
        row_xml(6, ["1", "Fill yellow/input columns. Green columns contain formulas and should not be edited."], [0, 0]),
        row_xml(7, ["2", "Use one Vendor_Item_Prices row for each vendor and item combination."], [0, 0]),
        row_xml(8, ["3", "All JKSH selling prices in the final price column include GST."], [0, 0]),
        row_xml(9, ["4", "Use dates in YYYY-MM-DD format and amounts in Indian rupees."], [0, 0]),
        row_xml(10, ["5", "Use the same Vendor Code in both sheets. Do not rename sheets or column headers."], [0, 0]),
        row_xml(11, ["6", "If a vendor changes price, add a new row with a new Effective From date."], [0, 0]),
        row_xml(13, ["Meaning", "JKSH Selling Price means the amount charged by JKSH to a franchise outlet for Stock. It is not the customer menu price."], [1, 0]),
        row_xml(15, ["Colour guide", "Yellow = enter data", "Green = automatically calculated"], [1, 3, 4]),
    ]
    return worksheet(rows, [18, 105, 30], "A1:C15")


def vendor_sheet() -> str:
    headers = [
        "Vendor Code*",
        "Vendor Name*",
        "Contact Person",
        "Mobile",
        "Email",
        "GSTIN",
        "Address",
        "Payment Terms (Days)",
        "Active*",
    ]
    example = [
        "VEN001",
        "ABC Tea Suppliers",
        "Ramesh",
        "9876543210",
        "accounts@abctea.example",
        "36ABCDE1234F1Z5",
        "Hyderabad, Telangana",
        15,
        "YES",
    ]
    rows = [row_xml(1, headers, [1] * len(headers)), row_xml(2, example, [3] * len(headers))]
    for number in range(3, 202):
        rows.append(row_xml(number, [""] * len(headers), [3] * len(headers)))
    return worksheet(
        rows,
        [16, 28, 22, 16, 30, 20, 38, 22, 12],
        "A1:I201",
        freeze_row=1,
        auto_filter="A1:I201",
        validations=[("I2:I201", "YES,NO")],
    )


def price_sheet() -> str:
    headers = [
        "Vendor Code*",
        "Item Code*",
        "Item Name*",
        "Category*",
        "Pack Description*",
        "Purchase Unit*",
        "Base Quantity*",
        "Base Unit*",
        "Units Per Carton",
        "Vendor Rate Before GST*",
        "Vendor Discount %",
        "Net Purchase Before GST",
        "Purchase GST %*",
        "Vendor Invoice Rate Incl GST",
        "Transport Per Purchase Unit",
        "Other Cost Per Purchase Unit",
        "Landed Cost Before GST",
        "JKSH Selling Price Before GST*",
        "Selling GST %*",
        "JKSH Selling Price Incl GST",
        "Profit Per Unit Before GST",
        "Margin %",
        "MRP",
        "Minimum Order Quantity",
        "Order Multiple",
        "Effective From*",
        "Effective Until",
        "Preferred Vendor*",
        "Active*",
        "Notes",
    ]
    examples = [
        ["VEN001", "TV-TEA-1KG", "T VANAMM Tea Powder", "Tea Powder", "1 kg packet", "Packet", 1000, "gram", "", 250, 0, "", 5, "", 5, 0, "", 285, 5, "", "", "", 300, 5, 1, "2026-09-08", "", "YES", "YES", ""],
        ["VEN002", "TV-CUP-80ML", "Printed Tea Cup 80 ml", "Packaging", "Box of 1000 cups", "Box", 1000, "piece", "", 800, 0, "", 18, "", 30, 0, "", 1050, 18, "", "", "", 1250, 1, 1, "2026-09-08", "", "YES", "YES", ""],
    ]
    rows = [row_xml(1, headers, [1] * len(headers))]
    formula_columns = {12, 14, 17, 20, 21, 22}
    for number in range(2, 202):
        values = examples[number - 2] if number <= 3 else [""] * len(headers)
        cells: list[str] = []
        for index, value in enumerate(values, 1):
            ref = f"{col_name(index)}{number}"
            if index == 12:
                cells.append(cell(ref, style=4, formula=f'IF(J{number}="","",J{number}*(1-IF(K{number}="",0,K{number})/100))'))
            elif index == 14:
                cells.append(cell(ref, style=4, formula=f'IF(L{number}="","",L{number}*(1+M{number}/100))'))
            elif index == 17:
                cells.append(cell(ref, style=4, formula=f'IF(L{number}="","",L{number}+IF(O{number}="",0,O{number})+IF(P{number}="",0,P{number}))'))
            elif index == 20:
                cells.append(cell(ref, style=4, formula=f'IF(R{number}="","",R{number}*(1+S{number}/100))'))
            elif index == 21:
                cells.append(cell(ref, style=4, formula=f'IF(OR(R{number}="",Q{number}=""),"",R{number}-Q{number})'))
            elif index == 22:
                cells.append(cell(ref, style=4, formula=f'IFERROR(U{number}/R{number}*100,"")'))
            else:
                style = 3 if index not in formula_columns else 4
                cells.append(cell(ref, value, style))
        rows.append(f'<row r="{number}">{"".join(cells)}</row>')
    return worksheet(
        rows,
        [16, 18, 30, 18, 24, 18, 16, 15, 18, 24, 20, 25, 18, 27, 27, 27, 24, 29, 18, 28, 27, 16, 14, 24, 16, 18, 18, 20, 12, 35],
        "A1:AD201",
        freeze_row=1,
        auto_filter="A1:AD201",
        validations=[
            ("F2:F201", "Packet,Box,Carton,Kg,Litre,Piece"),
            ("H2:H201", "gram,kilogram,ml,litre,piece"),
            ("AB2:AB201", "YES,NO"),
            ("AC2:AC201", "YES,NO"),
        ],
    )


def simple_vendor_price_sheet() -> str:
    headers = [
        "S.No",
        "Vendor Name*",
        "Vendor Phone",
        "Item Name*",
        "Brand",
        "Pack Size*",
        "Buying Price Incl. GST*",
        "GST %",
        "JKSH Selling Price Incl. GST*",
        "Minimum Order Qty",
        "Notes",
    ]
    examples = [
        [1, "ABC Tea Suppliers", "9876543210", "T VANAMM Tea Powder", "T VANAMM", "1 kg packet", 262.50, 5, 300, 5, ""],
        [2, "XYZ Packaging", "9876543211", "Printed Tea Cup 80 ml", "T VANAMM", "Box of 1000 cups", 944, 18, 1100, 1, ""],
    ]
    rows = [row_xml(1, headers, [1] * len(headers))]
    for number in range(2, 102):
        values = examples[number - 2] if number <= 3 else [number - 1] + [""] * (len(headers) - 1)
        rows.append(row_xml(number, values, [3] * len(headers)))
    return worksheet(
        rows,
        [8, 28, 18, 30, 18, 22, 25, 12, 31, 21, 35],
        "A1:K101",
        freeze_row=1,
        auto_filter="A1:K101",
    )


def build() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    content_types = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>'''
    root_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>'''
    workbook = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Vendor Prices" sheetId="1" r:id="rId1"/>
  </sheets>
  <calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/>
</workbook>'''
    workbook_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>'''
    styles = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11"/><name val="Aptos"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font>
    <font><b/><color rgb="FF6B3E26"/><sz val="16"/><name val="Aptos Display"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF6B3E26"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE2F0D9"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD9D9D9"/></left><right style="thin"><color rgb="FFD9D9D9"/></right><top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>'''
    timestamp = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    core = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>JKSH Vendor Price Data Template</dc:title><dc:creator>JKSH</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">{timestamp}</dcterms:created>
</cp:coreProperties>'''
    app = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application></Properties>'''

    with ZipFile(OUTPUT, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", root_rels)
        archive.writestr("docProps/core.xml", core)
        archive.writestr("docProps/app.xml", app)
        archive.writestr("xl/workbook.xml", workbook)
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        archive.writestr("xl/styles.xml", styles)
        archive.writestr("xl/worksheets/sheet1.xml", simple_vendor_price_sheet())

    print(OUTPUT)


if __name__ == "__main__":
    build()
