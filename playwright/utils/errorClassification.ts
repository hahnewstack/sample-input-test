export interface TestFailureResult {
  success: boolean;
  errorMessage?: string;
  screenshotPath?: string;
  failureType?: 'functional' | 'infrastructure';
  /**
   * The check could not be exercised on this product (e.g. no configurable option is
   * rendered). Distinct from success: callers must move on to the next product rather
   * than record a pass, so an inapplicable product cannot produce a vacuous green.
   */
  notApplicable?: boolean;
  /**
   * The product itself could not be exercised because it is no longer purchasable
   * (out of stock, or its PDP no longer loads). Distinct from a functional failure:
   * the storefront is behaving correctly and the *pin* has gone stale.
   *
   * Only this flag lets a pinned run advance to its configured fallback product. A
   * reachable, in-stock product whose Add to Cart fails is a real defect and must stay
   * red — see the fallback rules in config/add-to-cart-products.json.
   */
  unavailable?: boolean;
}

export interface ErrorClassification {
  category: FailureCategory;
  severity: FailureSeverity;
  cleanMessage: string;
}

export type FailureCategory =
  | 'timeout'
  | 'browserContextClosed'
  | 'locatorTiming'
  | 'pageNotReady'
  | 'navigationError'
  | 'api'
  | 'scriptBug'
  | 'functional'
  | 'dataValidation'
  | 'dataHygiene'
  | 'pageCrash'
  | 'unknown';

export enum FailureSeverity {
  LOW = 1,        // Minor validation mismatch, non-blocking issue
  MEDIUM = 2,     // Functional issue but not system-breaking
  HIGH = 3,       // Core feature broken (e.g. add-to-cart fails)
  CRITICAL = 4    // System-level failure, navigation crash, test infrastructure issue
}

export interface CollectedTestFailure {
  category: FailureCategory
  // 🔹 Core identity
  testName: string;          // e.g. "Add To Cart - Simple"
  language: string;          // EN, ES, FR (cross-cutting)

  // 🔹 Structured classification
  severity: FailureSeverity; // LOW | MEDIUM | HIGH | CRITICAL
  message: string;           // Clean summarized message for QA mode
  originalError: Error;      // Full error object for DEV mode

  // 🔹 Flexible test-specific metadata
  context?: Record<string, string>;

  // 🔹 Optional operational metadata
  timestamp: string;
}

/**
 * Error classification for test result reporting.
 * Used so spec-summary-reporter can classify timeouts/script errors vs assertion failures.
 */

/**
 * Derive stored error name from caught error so afterAll can rethrow and reporter classifies correctly.
 * Returns 'TimeoutError' for Playwright timeouts or message matching timeout/exceeded; otherwise undefined.
 */
export function getStoredErrorName(error: unknown): string | undefined {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return 'TimeoutError';
    const msg = error.message || '';
    if (/timeout|exceeded/i.test(msg)) return 'TimeoutError';
  }
  return undefined;
}

export function selectMostSevereError(
  failures: CollectedTestFailure[]
): CollectedTestFailure | undefined {

  if (!failures.length) return;

  return failures.reduce((prev, current) =>
    current.severity > prev.severity ? current : prev
  );
}

export function collectTestFailure(
  params: {
    testName: string;
    language: string;
    originalError: Error;
    context?: Record<string, string>;
  }
): CollectedTestFailure {
  const classification = classifyError(params.originalError);
  return {
    category: classification.category,
    testName: params.testName,
    language: params.language,
    severity: classification.severity,
    message: classification.cleanMessage,
    originalError: params.originalError,
    context: params.context ?? {},
    timestamp: new Date().toISOString(),
  };
}

export function classifyError(error: Error, status?: string): ErrorClassification {
  let category: FailureCategory = 'unknown';
  const name = (error?.name ?? '').toLowerCase();
  const msg = (error?.message ?? '').toLowerCase();

  // Timeouts (Playwright TimeoutError or message hints)
  if (name === 'timeouterror' || /timeout|exceeded/i.test(msg) || status === 'timeout') {
    category = 'timeout';
  }
  // Browser / context closed, target closed, protocol errors, or renderer crash
  else if (/context.*closed|browser context closed|browser has disconnected|browser closed|target closed|protocol error|renderer process|crash(ed)?/i.test(msg)) {
    category = 'browserContextClosed';
  }
  // Explicit page/renderer crash or disconnects (map to pageCrash for clarity)
  else if (/target closed|page crashed|page crash|disconnected from the browser/i.test(msg)) {
    category = 'pageCrash';
  }
  // Navigation-level problems: net:: errors, DNS, HTTP status errors
  else if (/navigation|net::|err_name_not_resolved|err_connection_refused|err_connection_timed_out|status 404|status 500|502|503|err_ssl/i.test(msg)) {
    category = 'navigationError';
  }
  // Locator timing / actionability failures
  else if (/locator.*timeout|strict mode violation|waiting for element|intercepts pointer events|retrying click|waiting for selector|element is not visible/i.test(msg)) {
    category = 'locatorTiming';
  }
  // API / network fetch failures (incl. GraphQL client errors without explicit HTTP status in message)
  else if (
    /econnreset|fetch failed|502|503|504|network request failed|network error|socket hang up|connection reset/i.test(
      msg
    ) ||
    /graphql|gql\b|request failed after|failed after \d+ attempt|operation has timed out|upstream.*error/i.test(msg)
  ) {
    category = 'api';
  }
  // Script/runtime errors in test code or app code
  else if (/typeerror|referenceerror|is not a function|assignment to constant|protocol error/i.test(msg)) {
    category = 'scriptBug';
  }
  // Assertion / expectation failures
  else if (/expected|tobe|toequal|assert|expect\(/i.test(msg)) {
    category = 'functional';
  }
  // Data hygiene: catalog completeness gaps not proven to affect any storefront
  // surface (e.g. Magento's base `image` role, unconsumed by the FE per
  // TW#49254233's investigation). Real, but shouldn't page backoffice_data at
  // dataValidation's severity. Checked BEFORE the broader dataValidation regex
  // below — messages like "missing image.url" would otherwise match
  // `variant.*missing` there and get the wrong (higher) severity.
  else if (/\bdata[\s_-]*hygiene\b/i.test(msg)) {
    category = 'dataHygiene';
  }
  // Data/validation domain problems (images missing, csv mismatch, validation failed).
  //
  // Match on message TEXT, not on the check-category names the specs use — those
  // never appear in the message. `inverse.*stock` below is an example of that
  // mistake surviving: it was written for product-data-integrity's
  // `inverse-stock-mismatch` check, whose message reads "has qty=5 but
  // stock_status is OUT_OF_STOCK" and contains no "inverse" at all. Kept, since
  // other specs may rely on it, with the real phrasing added alongside.
  //
  // Audited 2026-08-20 against every addIssue() call site in
  // product-data-integrity.spec.ts: 15 of 29 message shapes were falling through
  // to `unknown` (HIGH), outranking the MEDIUM checks around them and skewing which
  // failure selectMostSevereError surfaces as the representative one. Note this was
  // NOT affecting Teamwork severity — classify-failures.js rescues anything under
  // data_validation/ via a folder fallback — but that rescue is blunt and does not
  // cover specs outside that folder.
  else if (/missing .*image|og:image|found english label|missing webp|validation failed|data mismatch|csv mismatch|invalid data|schema validation|has empty.*url_key|has malformed.*url_key|has empty hreflang|has malformed hreflang|configurable.*variant|variant.*missing|variant.*incomplete|variant.*attribute|variant.*regular|variant.*final.*price|duplicate.*variant|duplicate.*attribute|duplicate.*combination|empty.*option|has no configurable_options|option.*has no values|has 0 variants|below parent regular|exceeds.*parent|phantom availability|inverse.*stock|parent.*child.*inconsistency|lists itself as an upsell|upsell\b.*is missing|no url_rewrite carrying a category|not present in the catalog|is missing from the .* catalog|is missing required field|sku containing spaces|but stock_status is OUT_OF_STOCK|final_price.*> regular_price|but min final_price is|mixed currencies across price_range|eco_fee/i.test(msg)) {
    category = 'dataValidation';
  }
  // Frame / readiness issues
  else if (/frame.*detached|frame detached|frame is detached|page not ready|document is not ready/i.test(msg)) {
    category = 'pageNotReady';
  }

  // If still unknown, emit a visible warning so unknown classifications are discoverable in logs.
  const severity = mapCategoryToSeverity(category);
  const cleanMessage = buildCleanMessage(category, error);

  if (category === 'unknown') {
    // Lightweight guardrail: ensure unknowns are discoverable in logs/CI output.
    // Teams can replace this console.warn with a telemetry call.
    // Keep message short to avoid noisy logs.
    // eslint-disable-next-line no-console
    console.warn(`[errorClassification] unknown category -> severity=${severity} message="${truncateForLog(error.message)}"`);
  }

  return { category, severity, cleanMessage };
}

const FALLBACK_SEVERITY = FailureSeverity.HIGH;

function mapCategoryToSeverity(category: FailureCategory): FailureSeverity {
  switch (category) {

    case 'functional':
      return FailureSeverity.CRITICAL;

    case 'timeout':
    case 'api':
    case 'locatorTiming':
    case 'pageCrash':
    case 'browserContextClosed':
    case 'unknown':
      return FailureSeverity.HIGH;

    case 'dataValidation':
    case 'pageNotReady':
    case 'navigationError':
      return FailureSeverity.MEDIUM;

    case 'dataHygiene':
    case 'scriptBug':
      return FailureSeverity.LOW;

    default:
      return FALLBACK_SEVERITY;
  }
}

export function buildCleanMessage(category: FailureCategory, error: Error): string {
  return `[${category}] ${error.message}`;
}

/** small helper to keep logs tidy */
function truncateForLog(s: string | undefined, max = 240) {
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}