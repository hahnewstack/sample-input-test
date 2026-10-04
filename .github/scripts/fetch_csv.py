"""Download the migration CSV for .github/workflows/migration-redirections.yml.

CSV_URL can be:
  - a Google Sheet link, as copied from the browser or the Share button
    (https://docs.google.com/spreadsheets/d/<id>/edit#gid=<tab>); the tab in the
    link is the one exported
  - a "Publish to web" Google Sheet link (.../spreadsheets/d/e/<id>/pubhtml or pub?output=csv)
  - any http(s) URL that returns the CSV file itself

A Google Sheet must either be shared as "Anyone with the link: Viewer", or be
shared with the service account whose JSON key is in the
GOOGLE_SERVICE_ACCOUNT_JSON repo secret.

The sheet's columns may be Sources,Lang,From,To in any case, or the older
"Redirect from,to" layout with no Lang column; then each row's language is taken
from the start of its From URL (/fr/... -> fr).

Writes the CSV to OUT_PATH as Sources,Lang,From,To and, for the workflow, the
row count and the base URL of the first From link to GITHUB_OUTPUT.
"""
import csv
import io
import json
import os
import re
import sys
import urllib.error
import urllib.request
from collections import Counter
from urllib.parse import parse_qs, urlparse

SHEET_RE = re.compile(r"^https://docs\.google\.com/spreadsheets/d/([A-Za-z0-9_-]+)")
PUBLISHED_RE = re.compile(r"^https://docs\.google\.com/spreadsheets/d/e/([A-Za-z0-9_-]+)")


def fail(message: str) -> None:
    print(f"::error::{message}")
    sys.exit(1)


def to_download_url(url: str) -> str:
    """Turn a Google Sheet link into its CSV export URL; leave other URLs alone."""
    parsed = urlparse(url)
    gid = parse_qs(parsed.query).get("gid", [""])[0] or parse_qs(parsed.fragment).get("gid", [""])[0]
    published = PUBLISHED_RE.match(url)
    if published:
        tab = f"&gid={gid}" if gid else ""
        return f"https://docs.google.com/spreadsheets/d/e/{published.group(1)}/pub?output=csv{tab}"
    sheet = SHEET_RE.match(url)
    if sheet:
        tab = f"&gid={gid}" if gid else ""
        return f"https://docs.google.com/spreadsheets/d/{sheet.group(1)}/export?format=csv{tab}"
    return url


def google_token() -> str | None:
    """Access token for the service account in GOOGLE_SERVICE_ACCOUNT_JSON, if that secret is set."""
    key = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if not key:
        return None
    # Imported here so public links need no extra packages; the workflow installs these only when the secret exists.
    from google.oauth2 import service_account
    import google.auth.transport.requests

    creds = service_account.Credentials.from_service_account_info(
        json.loads(key), scopes=["https://www.googleapis.com/auth/drive.readonly"]
    )
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def download(url: str) -> str:
    is_google = url.startswith("https://docs.google.com/")
    headers = {"User-Agent": "migration-redirections-workflow"}
    token = google_token() if is_google else None
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as resp:
            body = resp.read()
            content_type = resp.headers.get("Content-Type", "")
            final_url = resp.geturl()
    except urllib.error.HTTPError as e:
        if is_google and e.code in (401, 403, 404):
            fail(f"Google returned {e.code} for the sheet. Share it as 'Anyone with the link: Viewer', "
                 "or share it with the service account in the GOOGLE_SERVICE_ACCOUNT_JSON secret.")
        fail(f"Download failed: HTTP {e.code} from {url}")
    except urllib.error.URLError as e:
        fail(f"Could not reach {url}: {e.reason}. The server must be reachable from the internet.")

    # A private Google Sheet answers with its sign-in page (200, HTML) instead of an error.
    if "accounts.google.com" in final_url or "text/html" in content_type or body.lstrip()[:1] == b"<":
        if is_google:
            fail("Google returned a sign-in page, so the sheet is not readable by the workflow. Share it as "
                 "'Anyone with the link: Viewer', or share it with the service account in the "
                 "GOOGLE_SERVICE_ACCOUNT_JSON secret.")
        fail(f"{url} returned a web page, not a CSV file. Use a link that downloads the CSV directly.")
    # utf-8-sig drops an Excel BOM, which would otherwise turn the first header into "﻿Sources".
    return body.decode("utf-8-sig")


def main() -> None:
    url = os.environ.get("CSV_URL", "").strip()
    out_path = os.environ["OUT_PATH"]
    if not url.startswith(("http://", "https://")):
        fail(f"csv_url must be a link starting with https:// (got '{url}'). GitHub cannot read files on a PC; "
             "put the CSV in a Google Sheet or on a server and paste its link.")

    download_url = to_download_url(url)
    if download_url != url:
        print(f"Google Sheet export URL: {download_url}")
    text = download(download_url)

    rows, inferred_lang = normalize(text)
    if not rows:
        fail("CSV has a header row but no data rows.")

    parsed = urlparse(rows[0]["From"])
    base_url = f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else ""

    # Always written as Sources,Lang,From,To, whatever the sheet's own headers were.
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["Sources", "Lang", "From", "To"])
        writer.writeheader()
        writer.writerows(rows)
    with open(os.environ.get("GITHUB_OUTPUT", os.devnull), "a", encoding="utf-8") as f:
        f.write(f"rows={len(rows)}\nbase_url={base_url}\n")

    langs = Counter(r["Lang"] or "(none)" for r in rows)
    print(f"Downloaded {len(rows)} rows to {out_path}; first From host: {base_url or '(none)'}")
    print(f"Languages{' (taken from the URLs)' if inferred_lang else ''}: {dict(langs)}")
    skipped = sum(n for lang, n in langs.items() if lang not in SUPPORTED_LANGS)
    if skipped:
        print(f"::warning::{skipped} row(s) have a language other than {'/'.join(SUPPORTED_LANGS)} "
              "and will be skipped by the test.")


# Header names seen in the migration sheets, matched case-insensitively.
COLUMN_ALIASES = {
    "Sources": {"sources", "source"},
    "Lang": {"lang", "language"},
    "From": {"from", "redirect from", "old url"},
    "To": {"to", "redirect to", "new url"},
}
SUPPORTED_LANGS = ("en", "fr", "de", "es")  # the languages the spec's LANGUAGE_CONFIG knows


def lang_from_url(url: str) -> str:
    """First path segment when it looks like a language code: /fr/literie/... -> fr."""
    path = urlparse(url).path if "://" in url else url.split("?")[0]
    match = re.match(r"^/?([A-Za-z]{2})(?:/|$)", path)
    return match.group(1).lower() if match else ""


def normalize(text: str) -> tuple[list[dict], bool]:
    """Map the sheet's columns onto Sources,Lang,From,To; fill Lang from the From URL when there is no Lang column."""
    reader = csv.DictReader(io.StringIO(text))
    found = {}
    for header in reader.fieldnames or []:
        for name, aliases in COLUMN_ALIASES.items():
            if header and header.strip().lower() in aliases and name not in found:
                found[name] = header
    missing = [name for name in ("From", "To") if name not in found]
    if missing:
        fail(f"CSV is missing column(s) {missing}; its header row is {reader.fieldnames}. "
             "Expected: Sources,Lang,From,To (Lang optional; 'Redirect from' accepted for From)")
    infer_lang = "Lang" not in found

    rows = []
    for raw in reader:
        row = {name: (raw.get(header) or "").strip() for name, header in found.items()}
        if not row["From"] and not row["To"]:
            continue
        # A host without a scheme (www.example.com/...) would otherwise be read as a relative path.
        for key in ("From", "To"):
            if row[key].lower().startswith("www."):
                row[key] = "https://" + row[key]
        if infer_lang:
            # Old store codes like /gb/ or /uk/ aren't test languages; their To URL (/en/...) is.
            candidates = [lang_from_url(row["From"]), lang_from_url(row["To"])]
            row["Lang"] = next((c for c in candidates if c in SUPPORTED_LANGS), next((c for c in candidates if c), ""))
        else:
            row["Lang"] = row["Lang"].lower()
        rows.append({"Sources": row.get("Sources", ""), "Lang": row["Lang"], "From": row["From"], "To": row["To"]})
    return rows, infer_lang


if __name__ == "__main__":
    main()
