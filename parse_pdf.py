import sys
from pypdf import PdfReader

try:
    pdf_path = r"c:\Users\luigg\Desktop\2026\proyectos terminados\tasas al dia\abasto\cierre_2026-03-24.pdf"
    out_path = r"c:\Users\luigg\Desktop\2026\proyectos terminados\tasas al dia\abasto\cierre_text.txt"
    with open(out_path, 'w', encoding='utf-8') as f:
        reader = PdfReader(pdf_path)
        for page in reader.pages:
            f.write(page.extract_text() + "\n")
    print("PDF extracted successfully")
except Exception as e:
    print(f"Error extracting PDF: {e}")
