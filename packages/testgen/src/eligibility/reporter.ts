// ---------------------------------------------------------------------------
// Eligibility Engine — Scan Report Generator
// ---------------------------------------------------------------------------
//
// Produces structured reports (JSON and Markdown) from eligibility results.
// ---------------------------------------------------------------------------

import path from 'node:path';
import type {
    FileEligibilityResult,
    EligibilityScanReport,
    SkipEntry,
    ManualReviewEntry,
} from './types';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a structured scan report from an array of eligibility results.
 */
export function buildScanReport(
    results: FileEligibilityResult[],
    packageRoot: string = process.cwd(),
): EligibilityScanReport {
    const generateFullTest: string[] = [];
    const generateMinimalTest: string[] = [];
    const mergeWithExistingTest: string[] = [];
    const skipSafe: SkipEntry[] = [];
    const manualReview: ManualReviewEntry[] = [];

    for (const r of results) {
        const relPath = toRelative(r.filePath, packageRoot);
        switch (r.action) {
            case 'generate-full-test':
                generateFullTest.push(relPath);
                break;
            case 'generate-minimal-test':
                generateMinimalTest.push(relPath);
                break;
            case 'merge-with-existing-test':
                mergeWithExistingTest.push(relPath);
                break;
            case 'skip-safe':
                skipSafe.push({ filePath: relPath, reason: r.reasons[0] ?? 'unknown' });
                break;
            case 'manual-review':
                manualReview.push({
                    filePath: relPath,
                    reason: r.reasons.join('; '),
                    complexityScore: r.complexityScore,
                });
                break;
        }
    }

    return {
        timestamp: new Date().toISOString(),
        totalFiles: results.length,
        results,
        summary: {
            generateFullTest,
            generateMinimalTest,
            mergeWithExistingTest,
            skipSafe,
            manualReview,
        },
    };
}

/**
 * Format the scan report as a JSON string.
 */
export function formatReportAsJson(report: EligibilityScanReport): string {
    // Produce a slimmed JSON with just the summary (not full results with signals)
    const slim = {
        timestamp: report.timestamp,
        totalFiles: report.totalFiles,
        summary: {
            generateFullTest: report.summary.generateFullTest,
            generateMinimalTest: report.summary.generateMinimalTest,
            mergeWithExistingTest: report.summary.mergeWithExistingTest,
            skipSafe: report.summary.skipSafe,
            manualReview: report.summary.manualReview,
        },
    };
    return JSON.stringify(slim, null, 2);
}

/**
 * Format the scan report as a Markdown document.
 */
export function formatReportAsMarkdown(
    report: EligibilityScanReport,
    packageRoot: string = process.cwd(),
): string {
    const lines: string[] = [];
    const { summary } = report;

    lines.push('# Testgen Eligibility Scan Report');
    lines.push('');
    lines.push(`**Date:** ${report.timestamp}`);
    lines.push(`**Total files scanned:** ${report.totalFiles}`);
    lines.push('');

    // Counts
    const fullCount = summary.generateFullTest.length;
    const minimalCount = summary.generateMinimalTest.length;
    const mergeCount = summary.mergeWithExistingTest.length;
    const skipCount = summary.skipSafe.length;
    const reviewCount = summary.manualReview.length;

    lines.push('## Summary');
    lines.push('');
    lines.push(`| Action | Count |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Generate full test | ${fullCount} |`);
    lines.push(`| Generate minimal test | ${minimalCount} |`);
    lines.push(`| Merge with existing test | ${mergeCount} |`);
    lines.push(`| Skipped (safe) | ${skipCount} |`);
    lines.push(`| Manual review | ${reviewCount} |`);
    lines.push('');

    // ── Generate full test ────────────────────────────────────────────────
    if (fullCount > 0) {
        lines.push('## Generate Full Test');
        lines.push('');
        for (const f of summary.generateFullTest) {
            const r = findResult(report, f, packageRoot);
            const kind = r ? `(${r.fileKind})` : '';
            lines.push(`- ${f} ${kind}`);
        }
        lines.push('');
    }

    // ── Generate minimal test ─────────────────────────────────────────────
    if (minimalCount > 0) {
        lines.push('## Generate Minimal Test');
        lines.push('');
        for (const f of summary.generateMinimalTest) {
            const r = findResult(report, f, packageRoot);
            const reason = r ? ` — ${r.reasons[0]}` : '';
            lines.push(`- ${f}${reason}`);
        }
        lines.push('');
    }

    // ── Merge mode ────────────────────────────────────────────────────────
    if (mergeCount > 0) {
        lines.push('## Merge With Existing Test');
        lines.push('');
        for (const f of summary.mergeWithExistingTest) {
            lines.push(`- ${f}`);
        }
        lines.push('');
    }

    // ── Skipped ───────────────────────────────────────────────────────────
    if (skipCount > 0) {
        lines.push('## Skipped (Safe)');
        lines.push('');
        for (const entry of summary.skipSafe) {
            lines.push(`- **${entry.filePath}** — ${entry.reason}`);
        }
        lines.push('');
    }

    // ── Manual review ─────────────────────────────────────────────────────
    if (reviewCount > 0) {
        lines.push('## Manual Review Required');
        lines.push('');
        for (const entry of summary.manualReview) {
            lines.push(`- **${entry.filePath}** (complexity: ${entry.complexityScore})`);
            lines.push(`  ${entry.reason}`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * Print an inline console summary during CLI execution.
 * This provides immediate feedback about each file's eligibility.
 */
export function printEligibilitySummary(results: FileEligibilityResult[], packageRoot: string): void {
    const actionCounts = {
        'generate-full-test': 0,
        'generate-minimal-test': 0,
        'merge-with-existing-test': 0,
        'skip-safe': 0,
        'manual-review': 0,
    };

    for (const r of results) {
        actionCounts[r.action]++;
    }

    const header = '═'.repeat(72);
    const divider = '─'.repeat(72);

    console.log(`\n${header}`);
    console.log(' TESTGEN ELIGIBILITY SCAN');
    console.log(header);
    console.log(`  Files scanned:       ${results.length}`);
    console.log(`  Generate full test:  ${actionCounts['generate-full-test']}`);
    console.log(`  Generate minimal:    ${actionCounts['generate-minimal-test']}`);
    console.log(`  Merge existing:      ${actionCounts['merge-with-existing-test']}`);
    console.log(`  Skipped (safe):      ${actionCounts['skip-safe']}`);
    console.log(`  Manual review:       ${actionCounts['manual-review']}`);
    console.log(divider);

    // Print skipped files with reasons
    const skipped = results.filter(r => r.action === 'skip-safe');
    if (skipped.length > 0) {
        console.log('');
        for (const r of skipped) {
            const rel = toRelative(r.filePath, packageRoot);
            console.log(`  SKIPPED: ${rel}`);
            console.log(`  Reason:  ${r.reasons[0] ?? 'unknown'}`);
            console.log('');
        }
    }

    // Print manual-review files with reasons
    const review = results.filter(r => r.action === 'manual-review');
    if (review.length > 0) {
        for (const r of review) {
            const rel = toRelative(r.filePath, packageRoot);
            console.log(`  MANUAL REVIEW: ${rel}`);
            console.log(`  Reason:  ${r.reasons.join('; ')}`);
            console.log(`  Complexity: ${r.complexityScore}  |  Confidence: ${r.confidence}`);
            console.log('');
        }
    }

    console.log(header);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRelative(filePath: string, packageRoot: string): string {
    return path.relative(packageRoot, filePath).replaceAll('\\', '/');
}

function findResult(
    report: EligibilityScanReport,
    relPath: string,
    packageRoot: string,
): FileEligibilityResult | undefined {
    return report.results.find(
        (r) => toRelative(r.filePath, packageRoot) === relPath,
    );
}
