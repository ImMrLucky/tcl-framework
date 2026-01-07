/**
 * Audit Pack Generator
 * Creates defensible export bundles (PDF + JSON + CSV) for compliance
 */
import PDFDocument from 'pdfkit';
import { createHash } from 'crypto';
/**
 * Generate audit pack (PDF + JSON + CSV bundle)
 */
export async function generateAuditPack(options, orgId, supabaseAdmin) {
    // Fetch evaluations based on options
    let query = supabaseAdmin
        .from('evaluations')
        .select('*')
        .eq('org_id', orgId);
    if (options.evaluationId) {
        query = query.eq('id', options.evaluationId);
    }
    else {
        if (options.dateFrom) {
            query = query.gte('created_at', options.dateFrom);
        }
        if (options.dateTo) {
            query = query.lte('created_at', options.dateTo);
        }
    }
    if (options.projectId) {
        query = query.eq('project_id', options.projectId);
    }
    if (options.env) {
        query = query.eq('env', options.env);
    }
    const { data: evaluations, error } = await query.order('created_at', { ascending: false });
    if (error) {
        throw new Error(`Failed to fetch evaluations: ${error.message}`);
    }
    if (!evaluations || evaluations.length === 0) {
        throw new Error('No evaluations found for the specified criteria');
    }
    // Extract all issues from evaluations
    const allIssues = [];
    let executiveSummary = {
        totalEvaluations: evaluations.length,
        totalIssues: 0,
        highCriticalCount: 0,
        verifiedCount: 0,
        transcriptOnlyCount: 0,
        unverifiedCount: 0,
        avgRiskScore: 0,
        dateRange: {
            from: evaluations[evaluations.length - 1]?.created_at,
            to: evaluations[0]?.created_at,
        },
    };
    for (const eval_ of evaluations) {
        const report = eval_.report;
        const issues = options.includeAllIssues
            ? (report?.allIssuesV2 || report?.topIssuesV2 || report?.issues || [])
            : (report?.topIssuesV2 || report?.issues || []);
        for (const issue of issues) {
            allIssues.push({
                ...issue,
                evaluationId: eval_.id,
                evaluationCreatedAt: eval_.created_at,
            });
            executiveSummary.totalIssues++;
            const severityDisplay = issue.severityDisplay || issue.severity;
            if (severityDisplay === 'high' || severityDisplay === 'critical') {
                executiveSummary.highCriticalCount++;
            }
            const verificationLevel = issue.verification?.level;
            if (verificationLevel === 'EXTERNAL_VERIFIED') {
                executiveSummary.verifiedCount++;
            }
            else if (verificationLevel === 'TRANSCRIPT_ONLY') {
                executiveSummary.transcriptOnlyCount++;
            }
            else {
                executiveSummary.unverifiedCount++;
            }
        }
    }
    // Sort issues by riskScore (descending)
    allIssues.sort((a, b) => {
        const scoreA = a.score ?? (a.riskScore ?? 0) * 100;
        const scoreB = b.score ?? (b.riskScore ?? 0) * 100;
        return scoreB - scoreA;
    });
    // Calculate average risk score
    const totalScore = allIssues.reduce((sum, issue) => {
        return sum + (issue.score ?? (issue.riskScore ?? 0) * 100);
    }, 0);
    executiveSummary.avgRiskScore = allIssues.length > 0 ? totalScore / allIssues.length : 0;
    // Get first evaluation for integrity info
    const firstEval = evaluations[0];
    const firstReport = firstEval.report;
    const runInfo = firstReport?.run || firstReport?.manifest || {};
    // Generate files
    const pdfBuffer = await generatePDF(executiveSummary, allIssues, runInfo, evaluations);
    const jsonContent = generateJSON(allIssues, runInfo, evaluations);
    const csvContent = generateCSV(allIssues);
    // Compute checksums
    const pdfChecksum = createHash('sha256').update(pdfBuffer).digest('hex');
    const jsonChecksum = createHash('sha256').update(jsonContent).digest('hex');
    const csvChecksum = createHash('sha256').update(csvContent).digest('hex');
    const combinedChecksum = createHash('sha256')
        .update(pdfChecksum + jsonChecksum + csvChecksum)
        .digest('hex');
    // Generate pack ID
    const packId = `pack-${Date.now()}-${combinedChecksum.substring(0, 8)}`;
    // Upload to Supabase Storage
    const bucket = 'exports';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const basePath = `${orgId}/audit-packs/${packId}`;
    // Upload PDF
    const pdfFilename = `audit-pack-${timestamp}.pdf`;
    const pdfPath = `${basePath}/${pdfFilename}`;
    const { error: pdfError } = await supabaseAdmin.storage
        .from(bucket)
        .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: false,
    });
    if (pdfError) {
        throw new Error(`Failed to upload PDF: ${pdfError.message}`);
    }
    // Upload JSON
    const jsonFilename = `audit-pack-${timestamp}.json`;
    const jsonPath = `${basePath}/${jsonFilename}`;
    const { error: jsonError } = await supabaseAdmin.storage
        .from(bucket)
        .upload(jsonPath, jsonContent, {
        contentType: 'application/json',
        upsert: false,
    });
    if (jsonError) {
        throw new Error(`Failed to upload JSON: ${jsonError.message}`);
    }
    // Upload CSV
    const csvFilename = `audit-pack-${timestamp}.csv`;
    const csvPath = `${basePath}/${csvFilename}`;
    const { error: csvError } = await supabaseAdmin.storage
        .from(bucket)
        .upload(csvPath, csvContent, {
        contentType: 'text/csv',
        upsert: false,
    });
    if (csvError) {
        throw new Error(`Failed to upload CSV: ${csvError.message}`);
    }
    // Get public URLs
    const { data: pdfUrlData } = supabaseAdmin.storage.from(bucket).getPublicUrl(pdfPath);
    const { data: jsonUrlData } = supabaseAdmin.storage.from(bucket).getPublicUrl(jsonPath);
    const { data: csvUrlData } = supabaseAdmin.storage.from(bucket).getPublicUrl(csvPath);
    // Create a zip bundle URL (for now, return individual URLs)
    // In production, you might want to create an actual zip file
    const downloadUrl = pdfUrlData.publicUrl;
    return {
        packId,
        downloadUrl,
        checksum: combinedChecksum,
        files: {
            pdf: pdfUrlData.publicUrl,
            json: jsonUrlData.publicUrl,
            csv: csvUrlData.publicUrl,
        },
    };
}
/**
 * Generate PDF document
 */
async function generatePDF(summary, issues, runInfo, evaluations) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50 });
        const buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', reject);
        // Title
        doc.fontSize(20).text('ProtectQA Audit Pack', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Generated: ${new Date().toISOString()}`, { align: 'center' });
        doc.moveDown(2);
        // Executive Summary
        doc.fontSize(16).text('Executive Summary', { underline: true });
        doc.moveDown();
        doc.fontSize(11);
        doc.text(`Total Evaluations: ${summary.totalEvaluations}`);
        doc.text(`Total Issues: ${summary.totalIssues}`);
        doc.text(`High/Critical Issues: ${summary.highCriticalCount}`);
        const totalIssues = summary.totalIssues || 1;
        doc.text(`Verified Issues: ${summary.verifiedCount} (${((summary.verifiedCount / totalIssues) * 100).toFixed(1)}%)`);
        doc.text(`Transcript-Only Issues: ${summary.transcriptOnlyCount} (${((summary.transcriptOnlyCount / totalIssues) * 100).toFixed(1)}%)`);
        doc.text(`Unverified Issues: ${summary.unverifiedCount} (${((summary.unverifiedCount / totalIssues) * 100).toFixed(1)}%)`);
        doc.text(`Average Risk Score: ${summary.avgRiskScore.toFixed(1)}`);
        doc.text(`Date Range: ${summary.dateRange.from} to ${summary.dateRange.to}`);
        doc.moveDown(2);
        // Verification Coverage
        doc.fontSize(16).text('Verification Coverage', { underline: true });
        doc.moveDown();
        doc.fontSize(11);
        doc.text(`External Verified: ${summary.verifiedCount} issues`);
        doc.text(`Transcript-Only: ${summary.transcriptOnlyCount} issues (not externally verified)`);
        doc.text(`Unverified: ${summary.unverifiedCount} issues (no evidence)`);
        doc.moveDown(2);
        // Top Issues
        doc.fontSize(16).text('Top Issues (Ranked by Risk Score)', { underline: true });
        doc.moveDown();
        const topIssues = issues.slice(0, 50); // Limit to top 50 for PDF
        for (let i = 0; i < topIssues.length; i++) {
            const issue = topIssues[i];
            const score = issue.score ?? (issue.riskScore ?? 0) * 100;
            // Issue header
            doc.fontSize(12).font('Helvetica-Bold');
            doc.text(`Issue #${i + 1}: ${issue.type} - ${issue.category}`, { continued: false });
            doc.fontSize(10).font('Helvetica');
            doc.text(`Risk Score: ${score.toFixed(1)} | Severity: ${issue.severityDisplay || issue.severity} | Verification: ${issue.verification?.level || 'NONE'}`);
            doc.moveDown(0.5);
            // What/Why/Where
            doc.fontSize(11).font('Helvetica-Bold');
            doc.text('Summary:', { continued: false });
            doc.fontSize(10).font('Helvetica');
            doc.text(issue.what?.issueSummary || 'N/A', { indent: 20 });
            doc.moveDown(0.5);
            doc.fontSize(11).font('Helvetica-Bold');
            doc.text('Detail:', { continued: false });
            doc.fontSize(10).font('Helvetica');
            doc.text(issue.what?.issueDetail || 'N/A', { indent: 20 });
            doc.moveDown(0.5);
            // Score breakdown
            if (issue.scoring) {
                doc.fontSize(11).font('Helvetica-Bold');
                doc.text('Score Breakdown:', { continued: false });
                doc.fontSize(10).font('Helvetica');
                if (issue.scoring.components) {
                    doc.text(`Impact: ${((issue.scoring.components.impact01 || 0) * 100).toFixed(1)}% (weight: ${((issue.scoring.weights?.impact || 0) * 100).toFixed(0)}%)`, { indent: 20 });
                    doc.text(`Evidence: ${((issue.scoring.components.evidence01 || 0) * 100).toFixed(1)}% (weight: ${((issue.scoring.weights?.evidence || 0) * 100).toFixed(0)}%)`, { indent: 20 });
                    doc.text(`Signal: ${((issue.scoring.components.signal01 || 0) * 100).toFixed(1)}% (weight: ${((issue.scoring.weights?.signal || 0) * 100).toFixed(0)}%)`, { indent: 20 });
                    doc.text(`Category: ${((issue.scoring.components.category01 || 0) * 100).toFixed(1)}% (weight: ${((issue.scoring.weights?.category || 0) * 100).toFixed(0)}%)`, { indent: 20 });
                }
                if (issue.scoring.reasons && issue.scoring.reasons.length > 0) {
                    doc.text('Reasons:', { indent: 20 });
                    issue.scoring.reasons.forEach((reason) => {
                        doc.text(`  • ${reason}`, { indent: 30 });
                    });
                }
                doc.moveDown(0.5);
            }
            // Evidence quotes
            if (issue.evidence?.refs && issue.evidence.refs.length > 0) {
                doc.fontSize(11).font('Helvetica-Bold');
                doc.text('Evidence Quotes:', { continued: false });
                doc.fontSize(10).font('Helvetica');
                issue.evidence.refs.slice(0, 3).forEach((ref) => {
                    doc.text(`[${ref.sourceType}] ${ref.sourceId}`, { indent: 20 });
                    doc.text(`"${ref.quote.substring(0, 200)}${ref.quote.length > 200 ? '...' : ''}"`, { indent: 30 });
                    if (ref.turnIndex !== undefined) {
                        doc.text(`Turn: ${ref.turnIndex + 1}`, { indent: 30 });
                    }
                });
                doc.moveDown(0.5);
            }
            // Edges
            if (issue.evidence?.edges && issue.evidence.edges.length > 0) {
                doc.fontSize(11).font('Helvetica-Bold');
                doc.text('Graph Edges:', { continued: false });
                doc.fontSize(10).font('Helvetica');
                issue.evidence.edges.slice(0, 3).forEach((edge) => {
                    doc.text(`${edge.kind}: ${edge.claimA} ${edge.claimB ? '↔ ' + edge.claimB : ''} (weight: ${(edge.weight * 100).toFixed(1)}%)`, { indent: 20 });
                });
                doc.moveDown(0.5);
            }
            // Policy refs (if any)
            if (issue.compliance?.impactedPolicies && issue.compliance.impactedPolicies.length > 0) {
                doc.fontSize(11).font('Helvetica-Bold');
                doc.text('Impacted Policies:', { continued: false });
                doc.fontSize(10).font('Helvetica');
                issue.compliance.impactedPolicies.forEach((policy) => {
                    doc.text(`${policy.policyId}${policy.section ? ' - Section ' + policy.section : ''}`, { indent: 20 });
                });
                doc.moveDown(0.5);
            }
            // Verification level
            doc.fontSize(11).font('Helvetica-Bold');
            doc.text('Verification Level:', { continued: false });
            doc.fontSize(10).font('Helvetica');
            doc.text(`${issue.verification?.level || 'NONE'}`, { indent: 20 });
            if (issue.verification?.reasonCodes && issue.verification.reasonCodes.length > 0) {
                doc.text(`Reason Codes: ${issue.verification.reasonCodes.join(', ')}`, { indent: 20 });
            }
            doc.moveDown(1);
            // Page break if needed
            if (i < topIssues.length - 1 && doc.y > 700) {
                doc.addPage();
            }
        }
        // Run Integrity
        doc.addPage();
        doc.fontSize(16).text('Run Integrity & Reproducibility', { underline: true });
        doc.moveDown();
        doc.fontSize(11);
        doc.text(`Input Hash: ${runInfo.inputHash || 'N/A'}`);
        doc.text(`Config Hash: ${runInfo.configHash || 'N/A'}`);
        doc.text(`Engine Version: ${runInfo.engineVersion || 'N/A'}`);
        doc.text(`Model Fingerprint: ${JSON.stringify(runInfo.modelFingerprint || {})}`);
        doc.text(`Code Version: ${runInfo.codeVersion || 'N/A'}`);
        doc.text(`Evidence Mode: ${runInfo.evidenceMode || 'N/A'}`);
        doc.moveDown();
        doc.text(`Total Evaluations in Pack: ${evaluations.length}`);
        doc.text(`Evaluation IDs: ${evaluations.map((e) => e.id).join(', ')}`);
        doc.end();
    });
}
/**
 * Generate JSON export
 */
function generateJSON(issues, runInfo, evaluations) {
    const exportData = {
        exportedAt: new Date().toISOString(),
        packInfo: {
            totalIssues: issues.length,
            totalEvaluations: evaluations.length,
            evaluationIds: evaluations.map((e) => e.id),
        },
        reproducibility: {
            inputHash: runInfo.inputHash,
            configHash: runInfo.configHash,
            engineVersion: runInfo.engineVersion,
            modelFingerprint: runInfo.modelFingerprint,
            codeVersion: runInfo.codeVersion,
            evidenceMode: runInfo.evidenceMode,
        },
        issues: issues.map(issue => ({
            ...issue,
            // Ensure scoring.components and reasons are included
            scoring: issue.scoring || undefined,
        })),
    };
    return JSON.stringify(exportData, null, 2);
}
/**
 * Generate CSV export
 */
function generateCSV(issues) {
    const headers = [
        'Rank',
        'Issue ID',
        'Issue Key',
        'Evaluation ID',
        'Type',
        'Category',
        'Severity',
        'Severity Display',
        'Impact',
        'Risk Score',
        'Score',
        'Confidence',
        'Verification Level',
        'Verification Reason Codes',
        'Speaker',
        'Turn Index',
        'Primary Claim ID',
        'Related Claim IDs',
        'Issue Summary',
        'Issue Detail',
        'Evidence Count',
        'Edge Count',
        'Compliance Tags',
        'Impacted Policies',
        'Legal Hold Suggested',
        'Disclaimers',
        'Score Impact',
        'Score Evidence',
        'Score Signal',
        'Score Category',
        'Score Reasons',
        'Created At',
    ];
    const rows = issues.map((issue, idx) => {
        const score = issue.score ?? (issue.riskScore ?? 0) * 100;
        return [
            idx + 1,
            issue.issueId || '',
            issue.issueKey || '',
            issue.evaluationId || '',
            issue.type || '',
            issue.category || '',
            issue.severity || '',
            issue.severityDisplay || '',
            issue.impact || '',
            (issue.riskScore ?? 0) * 100,
            score,
            (issue.confidence ?? 0) * 100,
            issue.verification?.level || '',
            (issue.verification?.reasonCodes || []).join('; '),
            issue.who?.speaker || '',
            issue.who?.turnIndex || '',
            issue.what?.primaryClaimId || '',
            (issue.what?.relatedClaimIds || []).join('; '),
            (issue.what?.issueSummary || '').replace(/"/g, '""'),
            (issue.what?.issueDetail || '').replace(/"/g, '""'),
            (issue.evidence?.refs || []).length,
            (issue.evidence?.edges || []).length,
            (issue.compliance?.tags || []).join('; '),
            (issue.compliance?.impactedPolicies || []).map((p) => `${p.policyId}${p.section ? ':' + p.section : ''}`).join('; '),
            issue.compliance?.legalHoldSuggested ? 'Yes' : 'No',
            (issue.compliance?.disclaimers || []).join('; ').replace(/"/g, '""'),
            issue.scoring?.components?.impact01 ? (issue.scoring.components.impact01 * 100).toFixed(1) : '',
            issue.scoring?.components?.evidence01 ? (issue.scoring.components.evidence01 * 100).toFixed(1) : '',
            issue.scoring?.components?.signal01 ? (issue.scoring.components.signal01 * 100).toFixed(1) : '',
            issue.scoring?.components?.category01 ? (issue.scoring.components.category01 * 100).toFixed(1) : '',
            (issue.scoring?.reasons || []).join('; '),
            issue.evaluationCreatedAt || issue.audit?.createdAt || '',
        ];
    });
    const csv = [
        headers.map((h) => `"${h}"`).join(','),
        ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');
    return csv;
}
