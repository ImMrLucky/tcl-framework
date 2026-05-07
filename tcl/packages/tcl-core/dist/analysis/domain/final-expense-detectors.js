import { finalExpensePack } from "../../domain-packs/final-expense.js";
import { runDomainPack } from "../../domain-packs/registry.js";
/**
 * Backward-compatible wrapper. The implementation is now driven entirely by
 * the final-expense domain pack so adding/changing rules is a one-file change.
 */
export function detectFinalExpenseComplianceIssues(claims, context) {
    return runDomainPack(finalExpensePack, claims, context).issues;
}
