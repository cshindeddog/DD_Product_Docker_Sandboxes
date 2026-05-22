const CUSTOMER_REPORT_DASHBOARD_BASE =
  "https://metabase-analytics.us1.prod.dog/dashboard/54438-customer-report";

/**
 * Metabase **Customer report** dashboard — KPI summary tab for a Datadog org.
 * @param {string | null | undefined} datadogOrgId
 * @param {string | null | undefined} [zendeskOrgName]
 * @returns {string | null}
 */
export function buildCustomerReportKpiDashboardUrl(datadogOrgId, zendeskOrgName = "") {
  const orgId = String(datadogOrgId || "").trim();
  if (!orgId) return null;

  const params = new URLSearchParams({
    datadog_org_id: orgId,
    date: "",
    is_cx_escalated: "",
    is_premier_support_customer: "true",
    max_impact: "",
    salesforce_mrr_bucket: "",
    source: "",
    tab: "1117-kpi-summary",
    time_grouping: "month",
    zendesk_org_name: String(zendeskOrgName || "").trim(),
  });

  return `${CUSTOMER_REPORT_DASHBOARD_BASE}?${params.toString()}`;
}
