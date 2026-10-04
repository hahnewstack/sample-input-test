# sample-input-test

Standalone copy of `playwright/tests/special/migration_redirections.spec.ts` from
`react-testing`, with only the helpers it needs.

## Setup

```sh
npm install
npx playwright install chromium
```

## Run

```sh
# uses input/migration_redirections.csv by default
npm run test:migration

# override inputs
MIGRATION_CSV_PATH=input/my.csv BASE_URL=https://www.example.com MAX_ROWS=5 npm run test:migration
```

Env vars: `MIGRATION_CSV_PATH`, `BASE_URL`, `REQUEST_DELAY_MS`, `TEST_TIMEOUT_MS`,
`MAX_ROWS`, `TEST_ENV`, `CATALOG_ID`, `VERBOSE_LOGS=true` (helper logging).

Failures are written to `test-reports/migration-redirections-<site>-<env>-<date>.csv`.
See `playwright/tests/special/migration_redirections.spec.md` for the full test description.

## What was copied

- Verbatim: the spec + `.spec.md`, `utils/errorClassification.ts`, `utils/failureHelpers.ts`,
  `utils/sharedCsvReporter.ts`, `utils/ExcelReportWriter.ts`, `utils/csvReportRegistry.ts`,
  `tests/utils/reportPaths.ts`, `tests/utils/logger.ts`.
- Trimmed: `tests/utils/navigation.ts` keeps only `gotoWithRetry()` (verbatim) with `TIMING`
  and `sanitizeFilename` inlined, to avoid pulling in GraphQL and other unrelated helpers.
