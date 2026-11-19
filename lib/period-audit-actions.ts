import type { PeriodAuditIssue } from "./local-storage";

/** Mostrar solo acciones pertinentes al periodo, sin modificar los datos. */
export function getPeriodAuditActions(issues: ReadonlyArray<Pick<PeriodAuditIssue, "id" | "detail">>) {
  const needsRecalculation = issues.some(issue =>
    issue.id.startsWith("journey-rate-") ||
    (issue.id.startsWith("missing-oob-") && issue.detail.startsWith("Día completo")),
  );
  const needsReview = issues.some(issue =>
    !(issue.id.startsWith("journey-rate-") ||
      (issue.id.startsWith("missing-oob-") && issue.detail.startsWith("Día completo"))),
  );
  return { needsReview, needsRecalculation };
}
