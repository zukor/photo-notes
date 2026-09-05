from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether

OUT = Path(__file__).resolve().parents[1] / "output" / "pdf"
OUT.mkdir(parents=True, exist_ok=True)

COMMON = [
    ("Sign in and open Basic", "Sign in on your normal phone. Confirm Photo Notes Basic opens without an error."),
    ("Take, retake, and cancel a photo", "Take a photo, use Retake Photo once, then cancel it. Take a new photo to continue."),
    ("Save a complete Photo Note", "Take a photo, record a voice note, and save it. Confirm the photo, note, GPS, address, and topic remain together."),
    ("Find and organize it", "Open Organize, find the Photo Note, add a title, change its topic, and confirm the changes remain after refresh."),
    ("View and zoom", "Open View and Zoom, move around the enlarged photo, then use Reset Photo."),
    ("Share one Photo Note", "Select the Photo Note in Send and use Share. Confirm the phone share sheet opens."),
    ("Report one test issue", "Open Report an Issue and submit a clearly labeled test report so the reporting workflow is checked too."),
]

ASSIGNMENTS = {
    "Jose": ("Regression and Reliability", "Recheck previously reported Android problems, then complete a longer mixed capture session.", [
        ("Recheck Android voice transcription", "Record several notes with short pauses. Confirm words do not repeat or move to the next photo."),
        ("Recheck issue-report voice input", "Use Speak Description in Report an Issue twice and confirm each description appears once."),
        ("Recheck address handling", "Test Retry Location and Address, then edit one address and confirm it stays corrected."),
        ("Submit two issue reports", "Submit two labeled test reports in succession and confirm the second Send button works."),
        ("Complete a 20-photo mixed session", "Capture 20 varied Photo Notes. Mix voice and typed notes and confirm no photo, note, or location crosses into another item."),
    ]),
    "Rolando": ("Android Capture Reliability", "This is your current starting assignment. Focus on repeated field capture, voice behavior, and saving when the connection changes.", [
        ("Capture 15 consecutive Photo Notes", "Take 15 different photos with short voice notes. Confirm every note stays with the photo on which it was recorded."),
        ("Test pauses and background noise", "Record one note after waiting three seconds and another with ordinary background noise. Confirm recording stays usable and does not spam repeated words."),
        ("Test a weak connection", "With a weak or changing connection, save several Photo Notes and continue working. Confirm uploads finish without blocking the next capture."),
        ("Leave and reopen Photo Notes", "After saving, switch to another app and return. Confirm saved and waiting-to-upload items are still present."),
    ]),
    "Hassan": ("Organize and Edit", "Focus on keeping a larger library understandable and correcting captured information.", [
        ("Review at least 15 Photo Notes", "Inspect at least 15 library cards. Confirm each photo is large enough to identify and matches its title and notes."),
        ("Edit titles, topics, notes, and addresses", "Change each type of information on different Photo Notes, refresh, and confirm every change remains."),
        ("Test selection controls", "Use Select All and Clear All, then select individual Photo Notes. Confirm the count and checkmarks are correct."),
        ("Test deletion safely", "Create a disposable test Photo Note, delete it from Organize, and confirm only that item is removed."),
        ("Review Photo Details & History", "Open details for an edited Photo Note and confirm file format, original capture, and later changes are understandable."),
    ]),
    "Gabby": ("Create and Send", "Focus on turning selected Photo Notes into a polished document and sharing it.", [
        ("Build a document", "Create a document from several Photo Notes, change their order and captions, and review the paginated preview."),
        ("Add company branding", "Upload a test company logo and confirm it appears in the document preview."),
        ("Try a Word template", "Import a simple Word template and confirm Photo Notes recognizes it without changing the original file."),
        ("Edit the document layout", "Change the cover, heading, spacing, and basic layout controls, then confirm the preview updates."),
        ("Download and share formats", "Create PDF, Word, and Markdown outputs. Test Download, Share, and Print where available and report any confusing wording."),
    ]),
}

styles = getSampleStyleSheet()
title = ParagraphStyle("Title", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=22, leading=26, textColor=colors.HexColor("#174AA8"), alignment=TA_CENTER, spaceAfter=10)
sub = ParagraphStyle("Sub", parent=styles["Normal"], fontSize=12, leading=16, alignment=TA_CENTER, spaceAfter=14)
h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=15, leading=18, textColor=colors.HexColor("#174AA8"), spaceBefore=8, spaceAfter=7)
body = ParagraphStyle("Body", parent=styles["BodyText"], fontSize=10.5, leading=14, textColor=colors.black)
small = ParagraphStyle("Small", parent=body, fontSize=9.5, leading=12.5)

def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8.5)
    canvas.setFillColor(colors.HexColor("#444444"))
    canvas.drawString(0.65 * inch, 0.42 * inch, "Photo Notes Basic testing")
    canvas.drawRightString(7.85 * inch, 0.42 * inch, f"Page {doc.page}")
    canvas.restoreState()

def checklist(items, start):
    rows = []
    for number, (name, instruction) in enumerate(items, start):
        rows.append([Paragraph("&#9744;", body), Paragraph(f"<b>{number}. {name}</b><br/>{instruction}", body)])
    table = Table(rows, colWidths=[0.34 * inch, 6.66 * inch], hAlign="LEFT", repeatRows=0)
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#9AA7B8")),
        ("INNERGRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#CBD2DC")),
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return table

for person, (focus, summary, extra) in ASSIGNMENTS.items():
    filename = OUT / f"Photo_Notes_Basic_Testing_Assignment_{person}.pdf"
    doc = SimpleDocTemplate(str(filename), pagesize=letter, rightMargin=0.65*inch, leftMargin=0.65*inch, topMargin=0.58*inch, bottomMargin=0.62*inch, title=f"Photo Notes Basic Testing Assignment - {person}", author="Zukor AI")
    story = [
        Paragraph("PHOTO NOTES <font color='#E8231A'>AI</font>", title),
        Paragraph(f"Testing Assignment for {person}<br/><b>{focus}</b>", sub),
        Paragraph("How completion works", h2),
        Paragraph("Use this PDF as your reference, but record your work inside Photo Notes. Open the account circle at the top, choose <b>My Testing Assignment</b>, and check each item as you finish it. Photo Notes saves your progress. When every item is checked, press <b>Submit Assignment Complete</b>. You do not need to email or message Sam afterward.", body),
        Spacer(1, 8),
        Paragraph("If something fails", h2),
        Paragraph("Use <b>Report an Issue</b> on the page where the problem happened. Briefly say what you were trying to do, what went wrong, and what you expected. The page and device details are attached automatically. Submit each separate problem as its own report.", body),
        Spacer(1, 8),
        Paragraph("Shared Basic check", h2),
        checklist(COMMON, 1),
        PageBreak(),
        Paragraph(f"{person}'s focus: {focus}", h2),
        Paragraph(summary, body),
        Spacer(1, 8),
        checklist(extra, len(COMMON) + 1),
        Spacer(1, 14),
        KeepTogether([
            Paragraph("Finish", h2),
            Paragraph("Return to <b>My Testing Assignment</b>. Confirm every item is checked, add any overall note you want the administrator to see, and press <b>Submit Assignment Complete</b>. Any issue that needs action should also have its own Report an Issue submission.", body),
        ]),
        Spacer(1, 12),
        Paragraph("Website: https://photonotesapp.com", small),
    ]
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(filename)
