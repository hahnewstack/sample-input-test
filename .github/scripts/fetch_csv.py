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

Writes the CSV to OUT_PATH and, for the workflow, the row count and the base URL
of the first From link to GITHUB_OUTPUT.
"""
import csv
import io
import json
import os
import re
import sys
import urllib.error
import urllib.request
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

    reader = csv.DictReader(io.StringIO(text))
    headers = {h.strip().lower() for h in reader.fieldnames or []}
    missing = {"lang", "from", "to"} - headers
    if missing:
        fail(f"CSV is missing column(s) {sorted(missing)}; its header row is {reader.fieldnames}. "
             "Expected: Sources,Lang,From,To")
    rows = [r for r in reader if any((v or "").strip() for v in r.values())]
    if not rows:
        fail("CSV has a header row but no data rows.")

    first_from = next((v for r in rows for k, v in r.items() if k and k.strip().lower() == "from" and v), "")
    parsed = urlparse(first_from.strip())
    base_url = f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else ""

    with open(out_path, "w", encoding="utf-8", newline="") as f:
        f.write(text)
    with open(os.environ.get("GITHUB_OUTPUT", os.devnull), "a", encoding="utf-8") as f:
        f.write(f"rows={len(rows)}\nbase_url={base_url}\n")
    print(f"Downloaded {len(rows)} rows to {out_path}; first From host: {base_url or '(none)'}")


if __name__ == "__main__":
    main()
