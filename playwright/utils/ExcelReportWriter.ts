/**
 * CSV Report Writer Utility
 * 
 * A utility class for generating structured CSV reports with test case separators
 * for Playwright test results. Supports multiple test cases in a single CSV file.
 * 
 * Features:
 * - Single CSV file output
 * - Test case separators for multi-sheet data
 * - Proper CSV escaping
 * - Data type formatting
 * - Error handling
 * - Backward compatibility with Excel API
 */

import fs from 'fs';
import path from 'path';

// ============================================================================
// TYPES
// ============================================================================

export interface CsvColumn {
    /** Column header name */
    header: string;
    /** Column key/field name in data */
    key: string;
    /** Column width (optional, ignored in CSV but kept for compatibility) */
    width?: number;
    /** Data type for formatting */
    type?: 'string' | 'number' | 'date' | 'url' | 'boolean';
    /** Whether this column should be formatted as hyperlinks (ignored in CSV but kept for compatibility) */
    isHyperlink?: boolean;
}

export interface CsvSheetData {
    /** Test case name (used as separator in CSV) */
    name: string;
    /** Column definitions */
    columns: CsvColumn[];
    /** Data rows */
    data: any[];
    /** Optional styling (ignored in CSV but kept for compatibility) */
    style?: {
        headerBackgroundColor?: string;
        headerFontColor?: string;
        alternateRowColor?: string;
    };
}

export interface CsvReportOptions {
    /** Report title (used in filename and metadata) */
    title: string;
    /** Output directory path */
    outputDir?: string;
    /** Whether to include timestamp in filename */
    includeTimestamp?: boolean;
    /** Custom filename (overrides title-based naming) */
    customFilename?: string;
    /** Metadata to include as CSV comments */
    metadata?: {
        subject?: string;
        description?: string;
        testDescription?: string; // Test file comment/description from top of test file
    };
    /** Optional lines appended at end of CSV (e.g. QA instructions) */
    footerInstructions?: string[];
}

// Backward compatibility aliases
export type ExcelColumn = CsvColumn;
export type ExcelSheetData = CsvSheetData;
export type ExcelReportOptions = CsvReportOptions;

// ============================================================================
// MAIN CLASS
// ============================================================================

export class CsvReportWriter {
    private sheets: CsvSheetData[];
    private options: CsvReportOptions;

    constructor(options: CsvReportOptions) {
        this.options = {
            outputDir: 'test-reports',
            includeTimestamp: true,
            ...options
        };
        this.sheets = [];
    }

    /**
     * Adds a sheet (test case) to the CSV report
     * @param sheetData Sheet configuration and data
     */
    addSheet(sheetData: CsvSheetData): void {
        const { name, columns, data, style } = sheetData;

        // Log warning if styling is used (not supported in CSV)
        if (style && Object.keys(style).length > 0) {
            console.warn(`Styling options are not supported in CSV format for sheet "${name}". Styling will be ignored.`);
        }

        // Store the sheet data
        this.sheets.push({
            name,
            columns,
            data,
            style
        });
        
        console.log(`Added test case "${name}" with ${data.length} rows and ${columns.length} columns`);
    }

    /**
     * Adds multiple sheets (test cases) to the CSV report
     * @param sheetsData Array of sheet configurations
     */
    addSheets(sheetsData: CsvSheetData[]): void {
        sheetsData.forEach(sheetData => this.addSheet(sheetData));
    }

    /**
     * Adds a summary sheet with aggregated data
     * @param summaryData Summary statistics and information
     */
    addSummarySheet(summaryData: { [key: string]: any }): void {
        const summaryRows = Object.entries(summaryData).map(([key, value]) => [key, value]);
        
        const summarySheet: CsvSheetData = {
            name: 'Summary',
            columns: [
                { header: 'Metric', key: 'metric', type: 'string' },
                { header: 'Value', key: 'value', type: 'string' }
            ],
            data: summaryRows.map(([metric, value]) => ({ metric, value }))
        };

        this.addSheet(summarySheet);
    }

    /**
     * Saves the CSV report to a file
     * @returns The path to the saved file
     */
    async saveToFile(): Promise<string> {
        const filename = this.generateFilename();
        const outputDir = this.options.outputDir!;
        
        // Ensure output directory exists
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        const filePath = path.join(outputDir, filename);
        
        try {
            // Generate CSV content
            const csvContent = this.generateCsvContent();
            
            // Write the file
            fs.writeFileSync(filePath, '\uFEFF' + csvContent, 'utf8');
            console.log(`CSV report saved: ${filePath}`);
            return filePath;
        } catch (error) {
            console.error('Failed to save CSV report:', error);
            throw new Error(`Failed to save CSV report to ${filePath}: ${error}`);
        }
    }

    /**
     * Gets the current sheets data (for advanced operations)
     */
    getSheets(): CsvSheetData[] {
        return this.sheets;
    }

    // ============================================================================
    // PRIVATE HELPER METHODS
    // ============================================================================

    /**
     * Generates CSV content from all sheets
     */
    private generateCsvContent(): string {
        if (this.sheets.length === 0) {
            return '';
        }

        // Use the first sheet's columns as the header
        const columns = this.sheets[0].columns;
        let csvContent = '';

        // Add header row
        const headers = columns.map(col => this.escapeCsvValue(col.header));
        csvContent += headers.join(',') + '\n';

        // Combine all data rows from all sheets
        this.sheets.forEach(sheet => {
            sheet.data.forEach(row => {
                const values = columns.map(col => {
                    const value = this.formatCellValue(row[col.key], col.type);
                    return this.escapeCsvValue(value);
                });
                csvContent += values.join(',') + '\n';
            });
        });

        // Append QA instructions footer if provided
        if (this.options.footerInstructions && this.options.footerInstructions.length > 0) {
            csvContent += '\n';
            this.options.footerInstructions.forEach(line => {
                const cells = [this.escapeCsvValue(line), ...Array(columns.length - 1).fill(this.escapeCsvValue(''))];
                csvContent += cells.join(',') + '\n';
            });
        }

        return csvContent;
    }

    /**
     * Generates CSV content for a single sheet
     */
    private generateSheetCsv(sheet: CsvSheetData): string {
        const { columns, data } = sheet;
        let csvContent = '';

        // Add header row
        const headers = columns.map(col => this.escapeCsvValue(col.header));
        csvContent += headers.join(',') + '\n';

        // Add data rows
        data.forEach(row => {
            const values = columns.map(col => {
                const value = this.formatCellValue(row[col.key], col.type);
                return this.escapeCsvValue(value);
            });
            csvContent += values.join(',') + '\n';
        });

        return csvContent;
    }

    /**
     * Formats cell values based on data type for CSV
     */
    private formatCellValue(value: any, type?: string): string {
        if (value === null || value === undefined) {
            return '';
        }

        switch (type) {
            case 'date':
                const date = value instanceof Date ? value : new Date(value);
                return date.toISOString();
            case 'number':
                return String(typeof value === 'number' ? value : parseFloat(value) || 0);
            case 'boolean':
                return String(Boolean(value));
            case 'url':
                return String(value);
            case 'string':
            default:
                return String(value);
        }
    }

    /**
     * Escapes CSV values to handle commas, quotes, and newlines
     */
    private escapeCsvValue(value: string): string {
        if (value === null || value === undefined) {
            return '';
        }

        const stringValue = String(value);
        
        // If value contains comma, quote, or newline, wrap in quotes and escape internal quotes
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n') || stringValue.includes('\r')) {
            return `"${stringValue.replace(/"/g, '""')}"`;
        }
        
        return stringValue;
    }

    /**
     * Generates filename based on options
     */
    private generateFilename(): string {
        if (this.options.customFilename) {
            return this.options.customFilename.endsWith('.csv') 
                ? this.options.customFilename 
                : `${this.options.customFilename}.csv`;
        }

        const sanitizedTitle = this.options.title
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');

        const timestamp = this.options.includeTimestamp 
            ? `-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)}`
            : '';

        return `${sanitizedTitle}${timestamp}.csv`;
    }
}

// Backward compatibility class alias
export class ExcelReportWriter extends CsvReportWriter {}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Creates a simple CSV report with a single test case
 * @param title Report title
 * @param columns Column definitions
 * @param data Data rows
 * @param outputDir Output directory (optional)
 * @returns Path to the saved file
 */
export async function createSimpleCsvReport(
    title: string,
    columns: CsvColumn[],
    data: any[],
    outputDir?: string
): Promise<string> {
    const writer = new CsvReportWriter({
        title,
        outputDir
    });

    writer.addSheet({
        name: title,
        columns,
        data
    });

    return await writer.saveToFile();
}

/**
 * Creates a CSV report with multiple test cases
 * @param title Report title
 * @param sheets Array of test case configurations
 * @param options Additional options
 * @returns Path to the saved file
 */
export async function createMultiSheetCsvReport(
    title: string,
    sheets: CsvSheetData[],
    options?: Partial<CsvReportOptions>
): Promise<string> {
    const writer = new CsvReportWriter({
        title,
        ...options
    });

    writer.addSheets(sheets);

    return await writer.saveToFile();
}

// Backward compatibility function aliases
export const createSimpleExcelReport = createSimpleCsvReport;
export const createMultiSheetExcelReport = createMultiSheetCsvReport;

// ============================================================================
// USAGE EXAMPLES
// ============================================================================

/*
// Basic usage:
const writer = new CsvReportWriter({
    title: 'Test Results Report',
    outputDir: 'test-reports'
});

writer.addSheet({
    name: 'Test Results',
    columns: [
        { header: 'Test Name', key: 'testName', type: 'string' },
        { header: 'Status', key: 'status', type: 'string' },
        { header: 'URL', key: 'url', type: 'url' },
        { header: 'Duration', key: 'duration', type: 'number' },
        { header: 'Timestamp', key: 'timestamp', type: 'date' }
    ],
    data: [
        { testName: 'Login Test', status: 'PASSED', url: 'https://example.com', duration: 1.5, timestamp: new Date() },
        { testName: 'Checkout Test', status: 'FAILED', url: 'https://example.com/checkout', duration: 3.2, timestamp: new Date() }
    ]
});

const filePath = await writer.saveToFile();
console.log('CSV report saved to:', filePath);

// Simple report:
const filePath = await createSimpleCsvReport(
    'Simple Test Report',
    [
        { header: 'Test', key: 'test', type: 'string' },
        { header: 'Result', key: 'result', type: 'string' }
    ],
    [
        { test: 'Test 1', result: 'PASSED' },
        { test: 'Test 2', result: 'FAILED' }
    ],
    'reports'
);

// Multi-sheet report with test case separators:
const filePath = await createMultiSheetCsvReport(
    'Multi Test Case Report',
    [
        {
            name: 'Login Tests',
            columns: [{ header: 'Test', key: 'test' }, { header: 'Status', key: 'status' }],
            data: [{ test: 'Valid Login', status: 'PASSED' }]
        },
        {
            name: 'Checkout Tests', 
            columns: [{ header: 'Test', key: 'test' }, { header: 'Status', key: 'status' }],
            data: [{ test: 'Add to Cart', status: 'PASSED' }]
        }
    ]
);
*/
