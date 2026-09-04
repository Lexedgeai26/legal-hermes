# Matter Workspaces

Matter Workspaces let a lawyer connect LexEdge to an existing folder for a specific legal matter. They provide a bounded working context without uploading or copying the source folder into a separate LexEdge document store.

## What a Matter Workspace stores

LexEdge stores profile-local metadata and a lightweight file index under the active Hermes profile. A record can include:

- matter name and client name;
- matter type;
- court, tribunal, regulator, or other authority;
- the side or role represented;
- matter status and internal notes;
- the path of the selected local folder;
- indexed file names, extensions, sizes, and modified times.

The source files remain in the selected folder. Removing the Matter Workspace record does not delete that folder or its documents.

## Supported matter types and roles

Built-in matter types:

- general;
- GST/indirect tax;
- civil litigation;
- criminal litigation;
- contracts;
- corporate/MCA;
- income tax;
- labour/employment;
- intellectual property;
- arbitration.

Built-in roles include advocate, petitioner, respondent, applicant, accused, complainant, department, and in-house counsel.

## Supported files

The current local index recognises:

```text
CSV, DOC, DOCX, JPEG, JPG, Markdown, PDF, PNG,
PPT, PPTX, RTF, TXT, XLS, and XLSX
```

Indexing is intentionally bounded. It scans up to four folder levels and indexes up to 500 supported files. Hidden folders, source-control folders, virtual environments, `node_modules`, and unsupported files are skipped. The UI reports indexed and skipped counts.

Indexing records file metadata; it is not a guarantee that every format can be fully parsed by every model or tool. Scanned PDFs and images may require OCR.

## Create a Matter Workspace

1. Open **Matters** in the desktop sidebar.
2. Enter the matter and client names.
3. Select the matter type and your role.
4. Add the court or authority when relevant.
5. Choose the existing local matter folder.
6. Add internal notes or special instructions.
7. Select **Create matter**.

LexEdge indexes the supported files and opens the matter summary. Use **Re-index** after adding or changing documents.

## Work with a matter in chat

Select the matter and choose **Open in chat**. LexEdge starts a new session with a structured matter block containing the matter metadata and indexed file context. This helps keep the request anchored to the selected matter.

Example requests:

```text
Build a chronology from this matter. Separate facts supported by documents from facts that still need confirmation.
```

```text
Prepare a hearing brief for advocate review. Identify missing orders, authorities, dates, and procedural information before drafting.
```

```text
Compare the latest agreement with the previous version and produce a clause-by-clause risk table. Do not send the result.
```

## Good folder structure

A consistent structure makes human and automated review safer:

```text
MAT-2026-001/
├── 00-intake/
├── 01-pleadings/
├── 02-orders/
├── 03-evidence/
├── 04-research/
├── 05-correspondence/
├── 06-drafts/
└── 07-final/
```

Keep final documents distinct from drafts. Use stable names, dates in ISO format (`YYYY-MM-DD`), and version labels. Do not rely on the AI to infer which unsigned draft became final.

## Confidentiality and matter separation

- Use a separate folder and, where appropriate, a separate LexEdge profile for unrelated clients or teams.
- Apply operating-system permissions and full-disk encryption.
- Do not place a matter folder in a consumer sync service unless the firm's policy permits it.
- Review model and connector settings before asking LexEdge to process confidential content.
- Treat indexed names and metadata as confidential even when document bodies are not copied.
- Run conflict checks and professional-responsibility procedures independently of the assistant.

## Limits and professional review

A Matter Workspace narrows context but does not establish legal completeness. It cannot prove that all documents were collected, that a scan was readable, that an authority remains good law, or that a deadline calculation is correct. Lawyers remain responsible for the record, sources, advice, filings, and communications.
