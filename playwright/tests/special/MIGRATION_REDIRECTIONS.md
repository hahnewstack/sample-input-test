# Migration Redirections Test

Checks that, after a site is migrated onto the React stack, every old URL redirects to the
right new URL and that the new URL loads (HTTP 200).

The test runs entirely in **GitHub Actions**. You start it from the GitHub website and give it a
**link to the CSV**: a Google Sheet, or a CSV file on another server. The workflow downloads the
CSV and runs the test in the same run. Nothing runs on your PC, and the CSV is never committed to
the repo.

## What the test checks

For each row in the CSV, the test:

1. Opens the **From** URL in Chromium, using the browser language that matches the row's **Lang**
   (`en`, `fr`, `de` or `es`). Rows with any other language are skipped.
2. Follows the redirects and compares where it ended up with the **To** URL. Trailing slashes and
   the `referrer` / `rdflag` query parameters are ignored when comparing.
3. Checks that the final page returned status **200**.

A row fails if it lands on a different URL, returns a status other than 200, or errors out (for
example, a redirect loop). One failing row does not stop the others from being checked.

What it does **not** check: page content, SEO metadata, or pages behind a login.

## The CSV

One header row, then one row per URL:

| Sources | Lang | From | To |
|---|---|---|---|
| Sitemap | de | https://www.mgalleryboutique.com/de/c/memorable-bed-bett | /de/c/memorable-bed-bett |
| GSC | es | https://europe.shoplemeridien.com/es/p/set-de-cuerpo-y-bano-malin-goetz | /es/p/bano/malinplusgoetz/set-de-cuerpo-y-bano-le-meridien |

| Column | Required | Meaning |
|---|---|---|
| `Sources` | No | Where the URL came from (Sitemap, GSC, ...). For your reference only. |
| `Lang` | Yes | `en`, `fr`, `de` or `es`. |
| `From` | Yes | The old URL. Use a full URL (`https://...`). |
| `To` | Yes | The expected new URL. A full URL, or a path like `/de/c/...` that is added to the base URL. |

Column names are not case-sensitive (`From` or `from`). Empty rows are ignored.

`input/migration_redirections.csv` in the repo is only a **format sample**. The workflow never
uses it.

### Where to put the CSV

**Option A: Google Sheet (recommended)**

1. Create a Google Sheet, or open your CSV in Google Sheets (File > Import), with the columns above
   in row 1.
2. Make the sheet readable by the workflow, in one of two ways:
   - **Share > General access > Anyone with the link > Viewer.** Simplest; anyone who has the link
     can read the URL list.
   - **Keep the sheet private** and share it with a Google service account instead. See
     [Private Google Sheets](#private-google-sheets).
3. Copy the link from the browser's address bar while the right tab is open. The link includes the
   tab (`#gid=...`), and that tab is the one tested.

Each new migration can be a new tab or a new sheet; just paste the matching link when you run.

**Option B: a CSV file on another server**

Any `https://` link that downloads the CSV file itself works, for example a file on a company web
server or a storage bucket. The server must be reachable from the internet without a login, since
GitHub's servers download it. A link that opens a web page (a preview or sign-in page) does not
work.

A file path on your PC (`C:\Users\...`) does **not** work: GitHub's servers can't read your PC.

## How to run it

1. In GitHub, open the repo's **Actions** tab.
2. Choose **Migration Redirections Test** on the left.
3. Click **Run workflow** and fill in:

   | Field | What to enter |
   |---|---|
   | `csv_url` | The Google Sheet link, or the link to the CSV file. **Required.** |
   | `catalog_id` | Site code, used in the report filename, e.g. `lemeu`, `sof`, `mareu`. |
   | `test_env` | `stage` or `production`, used in the report filename. |
   | `base_url` | Leave empty to use the host of the first `From` link (e.g. `https://europe.shoplemeridien.com`). Fill in only if relative `To` paths belong to a different host. |
   | `max_rows` | `0` checks every row. Use e.g. `5` for a quick check of a new CSV. |
   | `request_delay_ms` | Pause between URLs in milliseconds. Default `1000`. |
   | `max_minutes` | Time limit for the job. Default `300`. |

4. Click the green **Run workflow** button. The run appears in the list after a few seconds.

The first step downloads and checks the CSV, so a wrong link, a sheet that isn't shared, or a
missing column fails within seconds, before anything is installed.

**How long it takes:** at the default 1-second delay, allow a few seconds per row, plus a couple
of minutes of setup. As a rough estimate, 340 rows takes about 15–30 minutes. Try `max_rows` = `5`
first to check a new CSV.

## Reading the results

- **Pass / fail:** the run is green when every row redirected correctly, red when any row failed.
- **Run summary:** the run's page shows the CSV link, row count, base URL, result, and how many
  rows failed.
- **Failure report:** a CSV listing only the failed rows, named
  `migration-redirections-<site>-<env>-<date>.csv`. Its columns are Language, From URL,
  Expected To URL, Actual To URL, Status, Severity, Category and Error Message.
- **Download:** at the bottom of the run's page, under **Artifacts**, download
  `migration-redirections-<site>-<env>-<run id>`. It holds the failure report and the Playwright
  HTML report. Artifacts are kept for 14 days.

## Private Google Sheets

To keep the sheet private, a repo admin sets this up once:

1. In Google Cloud, create a service account and a JSON key for it. Enable the **Google Drive
   API** in that Google Cloud project.
2. In the GitHub repo, go to **Settings > Secrets and variables > Actions** and add a secret named
   `GOOGLE_SERVICE_ACCOUNT_JSON` containing the whole JSON key.
3. Share each migration sheet with the service account's email address
   (`...@....iam.gserviceaccount.com`) as **Viewer**.

When the secret exists, the workflow uses it to read Google Sheets. Links to other servers are
unaffected.

## Notes

- **US runners:** GitHub's runners are mostly in the US. The test sets an `rdflag=1` cookie so the
  EU sites don't redirect them to the North America site.
- **Calling from another workflow:** the workflow also accepts `workflow_call` with the same
  inputs, and an optional `GOOGLE_SERVICE_ACCOUNT_JSON` secret.

## Troubleshooting

Errors appear on the run's page, at the **Download input CSV** step.

| Message | What to do |
|---|---|
| `csv_url must be a link starting with https://` | A file path or other text was entered. Paste a Google Sheet link or a CSV download link. |
| `Google returned a sign-in page` or `Google returned 401/403/404` | The sheet isn't readable: share it as "Anyone with the link: Viewer", or with the service account. Check the link is complete. |
| `... returned a web page, not a CSV file` | The link opens a page instead of downloading the file. Use the direct download link. |
| `Download failed: HTTP <code>` / `Could not reach` | The server refused the download or isn't reachable from the internet. |
| `CSV is missing column(s)` | Fix row 1; it needs `Lang`, `From` and `To` columns. |
| `CSV has a header row but no data rows` | The sheet tab in the link is empty; check `#gid=` points at the right tab. |
| `Could not work out a base URL` | The first `From` value isn't a full URL; fix it, or fill in `base_url`. |

## Files

| File | Purpose |
|---|---|
| `.github/workflows/migration-redirections.yml` | The GitHub workflow: downloads the CSV, runs the test, uploads the reports. |
| `.github/scripts/fetch_csv.py` | Downloads the CSV from the link and checks its columns. Used by the workflow. |
| `playwright/tests/special/migration_redirections.spec.ts` | The Playwright test itself. |
| `playwright/tests/special/migration_redirections.spec.md` | The test's original description from react-testing. |
| `input/migration_redirections.csv` | Format sample only; not used by the workflow. |
