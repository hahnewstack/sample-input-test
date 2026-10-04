import { join } from 'path';
import { mkdirSync } from 'fs';

/**
 * Centralized configuration for all test report paths
 * This ensures consistency across all test files
 */

// Base directory for all test reports
export const TEST_REPORTS_BASE = join(process.cwd(), 'test-reports');

// CSV reports are saved to the root of test-reports for easy access
export const CSV_REPORTS_DIR = TEST_REPORTS_BASE;

// Screenshots live under test-reports so one folder (or zip) contains report + CSVs + images
export const SCREENSHOTS_DIR = join(TEST_REPORTS_BASE, 'playwright-report-images');
/** Path relative to test-reports/ for use in CSV and HTML (e.g. playwright-report-images/1-foo.jpg) */
export const SCREENSHOTS_RELATIVE = 'playwright-report-images';

// Subdirectories for different test types (HTML reports, traces, etc.)
export const REPORT_PATHS = {
  // E2E Validation Reports
  E2E: {
    BASE: join(TEST_REPORTS_BASE, 'e2e-validation'),
    PRODUCT_URLS: join(TEST_REPORTS_BASE, 'e2e-validation', 'product-urls'),
    CATEGORY_LINKS: join(TEST_REPORTS_BASE, 'e2e-validation', 'category-links'),
    IMAGE_CHECKING: join(TEST_REPORTS_BASE, 'e2e-validation', 'image-checking'),
    LINK_VALIDATION: join(TEST_REPORTS_BASE, 'e2e-validation', 'link-validation'),
    URL_STATUS: join(TEST_REPORTS_BASE, 'e2e-validation', 'url-status'),
    ERROR_404: join(TEST_REPORTS_BASE, 'e2e-validation', '404-pages')
  },

  // Frontend Regression Reports  
  FRONTEND: {
    BASE: join(TEST_REPORTS_BASE, 'frontend-regressions'),
    CART: join(TEST_REPORTS_BASE, 'frontend-regressions', 'cart'),
    PRICING: join(TEST_REPORTS_BASE, 'frontend-regressions', 'pricing'),
    CURRENCY: join(TEST_REPORTS_BASE, 'frontend-regressions', 'currency'),
    LANGUAGE: join(TEST_REPORTS_BASE, 'frontend-regressions', 'language')
  },

  // Data Validation Reports
  DATA: {
    BASE: join(TEST_REPORTS_BASE, 'data-validation'),
    PRODUCTS: join(TEST_REPORTS_BASE, 'data-validation', 'products'),
    CATEGORIES: join(TEST_REPORTS_BASE, 'data-validation', 'categories'),
    STOCK: join(TEST_REPORTS_BASE, 'data-validation', 'stock')
  },

  // GA4 Analytics Reports
  GA4: {
    BASE: join(TEST_REPORTS_BASE, 'ga4-analytics'),
    EVENTS: join(TEST_REPORTS_BASE, 'ga4-analytics', 'events'),
    TRACKING: join(TEST_REPORTS_BASE, 'ga4-analytics', 'tracking')
  },

  // Checkout Process Reports
  CHECKOUT: {
    BASE: join(TEST_REPORTS_BASE, 'checkout'),
    GUEST: join(TEST_REPORTS_BASE, 'checkout', 'guest'),
    PAYMENT: join(TEST_REPORTS_BASE, 'checkout', 'payment')
  },

  // Performance Reports
  PERFORMANCE: {
    BASE: join(TEST_REPORTS_BASE, 'performance'),
    CACHE: join(TEST_REPORTS_BASE, 'performance', 'cache-warming'),
    MEMORY: join(TEST_REPORTS_BASE, 'performance', 'memory')
  },

  // Special Test Reports
  SPECIAL: {
    BASE: join(TEST_REPORTS_BASE, 'special'),
    MIGRATION: join(TEST_REPORTS_BASE, 'special', 'migration'),
    SECURITY: join(TEST_REPORTS_BASE, 'special', 'security')
  }
};

/**
 * Ensures a report directory exists, creating it if necessary
 */
export function ensureReportDirectory(path: string): void {
  try {
    mkdirSync(path, { recursive: true });
  } catch (error) {
    // Directory might already exist, ignore error
  }
}

/**
 * Gets the appropriate report path for a test type and creates the directory
 */
export function getReportPath(testType: string, subCategory?: string): string {
  let basePath: string;
  
  switch (testType.toLowerCase()) {
    case '404':
    case '404-pages':
      basePath = REPORT_PATHS.E2E.ERROR_404;
      break;
    case 'url-validation':
    case 'url-status':
      basePath = REPORT_PATHS.E2E.URL_STATUS;
      break;
    case 'product-urls':
      basePath = REPORT_PATHS.E2E.PRODUCT_URLS;
      break;
    case 'category-links':
      basePath = REPORT_PATHS.E2E.CATEGORY_LINKS;
      break;
    case 'frontend':
    case 'frontend-regression':
      basePath = REPORT_PATHS.FRONTEND.BASE;
      break;
    case 'data-validation':
      basePath = REPORT_PATHS.DATA.BASE;
      break;
    case 'ga4':
    case 'analytics':
      basePath = REPORT_PATHS.GA4.BASE;
      break;
    case 'checkout':
      basePath = REPORT_PATHS.CHECKOUT.BASE;
      break;
    case 'performance':
      basePath = REPORT_PATHS.PERFORMANCE.BASE;
      break;
    case 'special':
      basePath = REPORT_PATHS.SPECIAL.BASE;
      break;
    default:
      basePath = join(TEST_REPORTS_BASE, 'misc');
  }

  const finalPath = subCategory ? join(basePath, subCategory) : basePath;
  ensureReportDirectory(finalPath);
  return finalPath;
}

/**
 * Generates a standard report filename
 */
export function generateReportFilename(
  testType: string, 
  language?: string, 
  timestamp?: Date,
  extension: 'html' | 'csv' | 'json' = 'html'
): string {
  const date = timestamp || new Date();
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
  
  let filename = `${testType}`;
  if (language) filename += `_${language}`;
  filename += `_${dateStr}_${timeStr}.${extension}`;
  
  return filename;
}

/**
 * Gets the full path for a report file
 */
export function getFullReportPath(
  testType: string,
  language?: string,
  subCategory?: string,
  extension: 'html' | 'csv' | 'json' = 'html'
): string {
  const reportDir = getReportPath(testType, subCategory);
  const filename = generateReportFilename(testType, language, new Date(), extension);
  return join(reportDir, filename);
} 