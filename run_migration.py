"""Run the migration redirections test on GitHub Actions with a CSV kept on this machine.

Reads the local CSV, gzips + base64-encodes it into the workflow's csv_data
input and dispatches .github/workflows/migration-redirections.yml with the gh
CLI, so updated CSVs never need to be committed to input/.

Needs: gh installed and logged in (gh auth login), and the workflow file pushed
to the repo's default branch (GitHub only dispatches workflows it can see there).

Usage:
    python run_migration.py --site lemeu --env production
    python run_migration.py --site lemeu --env production --max-rows 5 --watch
    python run_migration.py --csv D:/other/redirects.csv --base-url https://www.example.com --repo OWNER/REPO
"""
import argparse
import base64
import csv
import gzip
import io
import json
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse

# Relative to the home folder, so it works for whoever runs the script.
DEFAULT_CSV = Path.home() / "Desktop" / "temp" / "sample-input" / "migration_redirections.csv"
WORKFLOW = "migration-redirections.yml"
REPO_ROOT = Path(__file__).resolve().parent
# GitHub rejects a dispatch whose inputs total more than 65,535 characters; keep room for the others.
MAX_ENCODED_CHARS = 60_000


def read_csv(path: Path) -> tuple[str, int, str]:
    """Return (CSV text, row count, base URL of the first From link), after checking the columns the spec needs."""
    # utf-8-sig drops an Excel BOM, which would otherwise turn the first header into "\ufeffSources".
    text = path.read_text(encoding="utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    headers = {h.strip().lower() for h in reader.fieldnames or []}
    missing = {"from", "to"} - headers
    if missing:
        sys.exit(f"CSV is missing column(s) {sorted(missing)}; found {reader.fieldnames}")
    rows = list(reader)
    first_from = next((v for r in rows for k, v in r.items() if k and k.strip().lower() == "from" and v), "")
    parsed = urlparse(first_from)
    base_url = f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else ""
    return text, len(rows), base_url


def gh(gh_path: str, args: list[str], repo: str | None, stdin: str | None = None, check: bool = True) -> str:
    cmd = [gh_path, *args, *(["--repo", repo] if repo else [])]
    result = subprocess.run(cmd, cwd=REPO_ROOT, input=stdin, capture_output=True, text=True)
    if check and result.returncode != 0:
        sys.exit(f"gh {' '.join(args[:2])} failed:\n{result.stderr.strip()}")
    return result.stdout


def find_run(gh_path: str, repo: str | None, request_id: str) -> dict | None:
    """The dispatch API returns no run id, so look the run up by the request_id in its run-name."""
    for _ in range(20):
        out = gh(gh_path, ["run", "list", "--workflow", WORKFLOW, "--event", "workflow_dispatch",
                           "--limit", "20", "--json", "databaseId,displayTitle,url"], repo)
        for run in json.loads(out or "[]"):
            if request_id in run["displayTitle"]:
                return run
        time.sleep(3)
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Dispatch the migration redirections test on GitHub with a local CSV.")
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV, help=f"CSV file (default: {DEFAULT_CSV})")
    parser.add_argument("--base-url", help="Base URL for relative 'To' paths (default: host of the first 'From' URL)")
    parser.add_argument("--site", default="mgl", help="Site code for the report filename, e.g. lemeu (default: mgl)")
    parser.add_argument("--env", choices=["stage", "production"], default="stage", help="Environment label (default: stage)")
    parser.add_argument("--max-rows", type=int, default=0, help="Only check the first N rows (default: all)")
    parser.add_argument("--delay-ms", type=int, default=1000, help="Delay between requests in ms (default: 1000)")
    parser.add_argument("--max-minutes", type=int, default=300, help="Job timeout in minutes (default: 300)")
    parser.add_argument("--repo", help="OWNER/REPO on GitHub (default: this checkout's git remote)")
    parser.add_argument("--ref", help="Branch to run the workflow from (default: the repo's default branch)")
    parser.add_argument("--watch", action="store_true", help="Wait for the run, then download its reports")
    args = parser.parse_args()

    csv_path = args.csv.expanduser().resolve()
    if not csv_path.is_file():
        sys.exit(f"CSV not found: {csv_path}")
    text, row_count, csv_base_url = read_csv(csv_path)
    base_url = (args.base_url or csv_base_url).rstrip("/")
    if not base_url:
        sys.exit("Could not work out a base URL from the CSV; pass --base-url")

    csv_data = base64.b64encode(gzip.compress(text.encode("utf-8"), 9)).decode("ascii")
    if len(csv_data) > MAX_ENCODED_CHARS:
        sys.exit(f"CSV is {len(csv_data):,} chars after compression; GitHub's dispatch limit allows about "
                 f"{MAX_ENCODED_CHARS:,}. Split the CSV into smaller files and run each one.")

    gh_path = shutil.which("gh")
    if not gh_path:
        sys.exit("gh CLI not found; install it from https://cli.github.com and run: gh auth login")

    request_id = uuid.uuid4().hex[:8]
    inputs = {
        "base_url": base_url,
        "catalog_id": args.site,
        "test_env": args.env,
        "csv_data": csv_data,
        "max_rows": str(args.max_rows),
        "request_delay_ms": str(args.delay_ms),
        "max_minutes": str(args.max_minutes),
        "request_id": request_id,
    }

    print(f"CSV:      {csv_path} ({row_count} rows, {len(csv_data):,} chars encoded)")
    print(f"Base URL: {base_url}")
    print(f"Site/env: {args.site} / {args.env}" + (f", first {args.max_rows} rows" if args.max_rows else ""))

    # --json reads the inputs from stdin, which avoids Windows' command-line length limit.
    gh(gh_path, ["workflow", "run", WORKFLOW, "--json", *(["--ref", args.ref] if args.ref else [])],
       args.repo, stdin=json.dumps(inputs))
    print(f"Dispatched (request {request_id}); looking up the run...")

    run = find_run(gh_path, args.repo, request_id)
    if not run:
        sys.exit(f"Dispatched, but could not find the run yet. Check the Actions tab for request {request_id}.")
    print(f"Run:      {run['url']}")
    if not args.watch:
        return

    run_id = str(run["databaseId"])
    watch = subprocess.run([gh_path, "run", "watch", run_id, "--exit-status",
                            *(["--repo", args.repo] if args.repo else [])], cwd=REPO_ROOT)
    out_dir = REPO_ROOT / "test-reports" / f"github-run-{run_id}"
    gh(gh_path, ["run", "download", run_id, "--dir", str(out_dir)], args.repo, check=False)
    print(f"\nReports downloaded to: {out_dir}")
    sys.exit(watch.returncode)


if __name__ == "__main__":
    main()
