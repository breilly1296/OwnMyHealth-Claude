# E2E Fixtures

Sample files referenced by Playwright specs in `../*.spec.ts`.

## Required files

| Path | Used by | Notes |
|---|---|---|
| `sample-lab-report.pdf` | (future lab-upload spec) | Minimum valid PDF — backend enforces `%PDF-` magic bytes via `validatePdfHeader`. |
| `sample-sbc.pdf` | (future SBC-upload spec) | Same PDF header requirement. |

Neither is currently referenced by the existing specs (manual-entry biomarker
spec uses the Add Measurement modal, not an upload). Drop real PDFs here
before writing upload specs.

## Creating a minimal valid PDF

```bash
# The absolute minimum that passes the magic-byte check + pdf-parse sanity:
printf '%%PDF-1.4\n%%\xe2\xe3\xcf\xd3\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000104 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n164\n%%%%EOF\n' > sample-lab-report.pdf
```

Real lab-report content isn't needed — upload specs only exercise the upload
path, not extraction quality.
