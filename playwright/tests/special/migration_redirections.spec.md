#### Folder: special

#### Test Name: migration_redirections.spec.ts

#### Short Description / Script Goal:
Verifies URL redirections after migrating a site to the React stack by checking that URLs redirect to their corresponding new paths and return 200 status codes.

#### What does the script do and how does it do it?
- Reads a CSV file containing URL mappings with the following columns:
  - Sources: Source of the URL (e.g., Sitemap)
  - Lang: Language code (e.g., en, fr, de, es)
  - From: Original URL to check redirection from
  - To: Target path or URL to check redirection to
- Uses a configurable base URL for relative target paths
- Splits URLs into language-specific chunks based on the Lang column
- For each language:
  - Sets appropriate browser locale
  - Checks redirections from "From" URLs to "To" URLs
  - Verifies 200 status code on target URLs
- Logs any failures in redirection or non-200 status codes
- Requires headless mode to be disabled
- Has a 5-hour timeout to accommodate large URL lists

#### What does it not do?
- Does not handle dynamic URL generation
- Does not verify content on the redirected pages
- Does not work in headless mode
- Does not handle authentication or protected URLs
- Does not verify SEO metadata or other page attributes

#### Configuration:
- CSV file path: Set via MIGRATION_CSV_PATH environment variable (default: inputs/migration_redirections.csv)
- Base URL: Set via BASE_URL environment variable (default: https://www.mgalleryboutique.com)
- Request delay: Set via REQUEST_DELAY_MS environment variable (default: 1000ms)
- Test timeout: Set via TEST_TIMEOUT_MS environment variable (default: 5 hours)
- Maximum rows: Set via MAX_ROWS environment variable (default: 0 = unlimited)
  - Set to a number (e.g., 5) to test only the first N rows
  - Set to 0 or leave unset to test all rows

#### Command to run the test:
### This runs the test in headed mode only with Chromium
yarn playwright test migration_redirections.spec.ts --headed --project=Chromium

#### Confluence doc
For more information on how this script is used, see: https://hotelsathome.atlassian.net/wiki/spaces/EU/pages/4454285313/Running+Migration+Redirections+Test+with+Playwright+-+M2+React

#### Questions/Concerns/Comments? 