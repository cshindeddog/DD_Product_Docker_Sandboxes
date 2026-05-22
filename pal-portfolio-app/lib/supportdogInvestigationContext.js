import {
  callSupportdogTool,
  findSupportdogToolName,
  listSupportdogTools,
  supportdogConnectInstructions,
} from "@/lib/supportdogMcpClient";
import { normalizeSupportdogDatacenter } from "@/lib/supportdogDatacenter";
import {
  extractZendeskTicketAttributes,
  formatZendeskConversationMarkdown,
  inferSupportdogDatacenter,
  supportdogDatacenterProbeOrder,
} from "@/lib/supportdogTicketParse";

/**
 * @param {unknown} v
 */
function pickStr(...values) {
  for (const v of values) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

/**
 * @param {unknown} node
 * @param {number} depth
 */
function walkFindOrgId(node, depth = 0) {
  if (depth > 12 || node == null) return "";
  if (typeof node === "number" && node > 1000) return String(Math.floor(node));
  if (typeof node === "string") {
    const m = node.match(/\borg[_\s-]?id["\s:]*(\d{4,})\b/i) || node.match(/\b(\d{6,})\b/);
    if (m) return m[1];
    return "";
  }
  if (typeof node === "object") {
    const o = /** @type {Record<string, unknown>} */ (node);
    const direct = pickStr(
      o.datadog_org_id,
      o.datadogOrgId,
      o.org_id,
      o.orgId,
      o.organization_id
    );
    if (direct && /^\d+$/.test(direct)) return direct;

    if (Array.isArray(o.custom_fields)) {
      for (const f of o.custom_fields) {
        if (!f || typeof f !== "object") continue;
        const row = /** @type {Record<string, unknown>} */ (f);
        const id = String(row.id || row.field_id || "");
        const val = row.value;
        if (id === "8365470248091" && val != null && String(val).trim()) return String(val).trim();
        if (/datadog.*org.*id/i.test(String(row.name || "")) && val != null) return String(val).trim();
      }
    }

    for (const v of Object.values(o)) {
      const found = walkFindOrgId(v, depth + 1);
      if (found) return found;
    }
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = walkFindOrgId(item, depth + 1);
      if (found) return found;
    }
  }
  return "";
}

/**
 * @param {string} datacenter
 * @param {string} toolName
 * @param {Record<string, unknown>[]} argVariants
 * @param {Request | null | undefined} request
 */
async function callFirstWorkingTool(datacenter, toolName, argVariants, request) {
  let lastMsg = `All argument variants failed for ${toolName}.`;
  for (const args of argVariants) {
    const res = await callSupportdogTool(datacenter, toolName, args, request);
    if (res.ok && res.text?.trim()) return res;
    if (!res.ok && res.message) lastMsg = res.message;
  }
  return { ok: false, message: lastMsg };
}

/**
 * @param {string} dc
 * @param {string} id
 * @param {Request | null | undefined} request
 */
async function fetchTicketOnDatacenter(dc, id, request) {
  const toolsListed = await listSupportdogTools(dc, request);
  if (!toolsListed.ok) {
    return {
      ok: false,
      code: toolsListed.code || "mcp_error",
      message: toolsListed.message,
      datacenter: dc,
      setupHint: supportdogConnectInstructions(dc),
    };
  }

  const tools = toolsListed.tools;
  const getTicketTool =
    findSupportdogToolName(tools, /^saturn_GetZendeskTicket$/i) ||
    findSupportdogToolName(tools, /GetZendeskTicket/i) ||
    findSupportdogToolName(tools, /zendesk.*ticket/i);

  if (!getTicketTool) {
    return {
      ok: false,
      code: "no_tool",
      message: "SupportDog MCP did not expose a GetZendeskTicket tool.",
      datacenter: dc,
      tools: tools.map((t) => t.name).slice(0, 40),
    };
  }

  const ticketRes = await callFirstWorkingTool(
    dc,
    getTicketTool,
    [
      { ticket_id: Number(id) || id },
      { ticket_id: id },
      { ticketId: Number(id) || id },
      { ticket_number: Number(id) || id },
      { id: Number(id) || id },
    ],
    request
  );

  if (!ticketRes.ok) {
    return {
      ok: false,
      code: "ticket_fetch_failed",
      message: ticketRes.message || "Failed to fetch Zendesk ticket from SupportDog.",
      datacenter: dc,
      setupHint: supportdogConnectInstructions(dc),
    };
  }

  return {
    ok: true,
    datacenter: dc,
    getTicketTool,
    ticketRes,
    tools,
  };
}

/**
 * Investigation playbook Step 4 — SupportDog ticket + org context.
 * Probes other datacenters if the preferred MCP cannot fetch the ticket.
 * @param {string} ticketId
 * @param {string | null | undefined} preferredDatacenter
 * @param {Request | null | undefined} request
 */
export async function fetchSupportdogInvestigationContext(ticketId, preferredDatacenter, request) {
  const preferred = normalizeSupportdogDatacenter(preferredDatacenter);
  const id = String(ticketId || "").trim();
  if (!id) {
    return { ok: false, code: "missing_ticket", message: "Ticket id required.", datacenter: preferred || "US1" };
  }

  let fetched = null;
  let autoDetectedDc = false;
  const probeErrors = [];

  for (const dc of supportdogDatacenterProbeOrder(preferred)) {
    const attempt = await fetchTicketOnDatacenter(dc, id, request);
    if (attempt.ok) {
      fetched = attempt;
      autoDetectedDc = dc !== preferred;
      break;
    }
    probeErrors.push(`${dc}: ${attempt.message || attempt.code}`);
  }

  if (!fetched?.ok) {
    return {
      ok: false,
      code: "ticket_fetch_failed",
      message: probeErrors.slice(0, 4).join("; ") || "Ticket not found on any SupportDog MCP datacenter.",
      datacenter: preferred || "US1",
      setupHint: supportdogConnectInstructions(preferred || "US1"),
    };
  }

  const dc = fetched.datacenter;
  const getTicketTool = fetched.getTicketTool;
  const ticketRes = fetched.ticketRes;
  const tools = fetched.tools;

  const conversationMd = formatZendeskConversationMarkdown(ticketRes.parsed, id);
  const attachmentsNote = extractAttachmentsNote(ticketRes.parsed);

  /** @type {Record<string, unknown>[]} */
  const blocks = [
    {
      title: "Zendesk conversation (from SupportDog comments)",
      body: conversationMd,
    },
    {
      title: `SupportDog: ${getTicketTool}`,
      tool: getTicketTool,
      body: ticketRes.text,
    },
  ];

  const parsed = ticketRes.parsed;
  let orgId = walkFindOrgId(parsed);
  let orgName = "";
  let orgParsed = null;

  if (parsed && typeof parsed === "object") {
    const p = /** @type {Record<string, unknown>} */ (parsed);
    orgName = pickStr(
      p.organization_name,
      p.organizationName,
      p.org_name,
      p.zendesk_organization_name
    );
    if (p.organization && typeof p.organization === "object") {
      const org = /** @type {Record<string, unknown>} */ (p.organization);
      orgName = pickStr(orgName, org.name, org.organization_name);
    }
  }

  const orgSearchTool =
    findSupportdogToolName(tools, /^pluto_orgs-search-details$/i) ||
    findSupportdogToolName(tools, /orgs-search-details/i) ||
    findSupportdogToolName(tools, /orgs.*search/i);

  const orgGetTool =
    findSupportdogToolName(tools, /^pluto_orgs-get-details$/i) ||
    findSupportdogToolName(tools, /orgs-get-details/i) ||
    findSupportdogToolName(tools, /get.*org.*detail/i) ||
    (orgSearchTool ? null : findSupportdogToolName(tools, /pluto.*org/i));

  const downloadAttachmentTool = findSupportdogToolName(tools, /download_zendesk_attachment/i);

  if (!orgId && orgSearchTool && orgName) {
    const searchRes = await callSupportdogTool(
      dc,
      orgSearchTool,
      {
        organization_name: orgName,
        query: orgName,
        name: orgName,
      },
      request
    );
    if (searchRes.ok && searchRes.text) {
      blocks.push({ title: `SupportDog: ${orgSearchTool}`, tool: orgSearchTool, body: searchRes.text });
      orgParsed = searchRes.parsed;
      orgId = walkFindOrgId(searchRes.parsed) || orgId;
    }
  }

  if (orgId && orgGetTool) {
    const orgRes = await callFirstWorkingTool(
      dc,
      orgGetTool,
      [
        { org_id: Number(orgId) || orgId },
        { organization_id: Number(orgId) || orgId },
        { id: Number(orgId) || orgId },
        { datadog_org_id: Number(orgId) || orgId },
      ],
      request
    );
    if (orgRes.ok && orgRes.text) {
      blocks.push({ title: `SupportDog: ${orgGetTool}`, tool: orgGetTool, body: orgRes.text });
      orgParsed = orgRes.parsed;
    }
  }

  if (downloadAttachmentTool && attachmentsNote.attachmentIds.length > 0) {
    const attId = attachmentsNote.attachmentIds[0];
    const attRes = await callFirstWorkingTool(
      dc,
      downloadAttachmentTool,
      [
        { attachment_id: attId },
        { attachment_id: Number(attId) || attId },
        { id: attId },
      ],
      request
    );
    if (attRes.ok && attRes.text) {
      blocks.push({
        title: `SupportDog: ${downloadAttachmentTool} (first attachment)`,
        tool: downloadAttachmentTool,
        body: attRes.text.slice(0, 40_000),
      });
    }
  }

  const inferredDc = inferSupportdogDatacenter(parsed, orgParsed);
  const resolvedDatacenter = inferredDc || dc;
  const datacenterMismatch =
    preferred !== resolvedDatacenter
      ? `UI/preferred datacenter was **${preferred}**; SupportDog query used **${dc}**; org/ticket site implies **${resolvedDatacenter}**.`
      : autoDetectedDc
        ? `Ticket fetched from **${dc}** (auto-detected; preferred was **${preferred}**).`
        : null;

  const markdown = [
    datacenterMismatch ? `> ${datacenterMismatch}\n` : "",
    blocks
      .map((b) => {
        if (b.title.includes("conversation")) {
          return `### ${b.title}\n\n${String(b.body)}`;
        }
        return `### ${b.title}\n\n\`\`\`json\n${String(b.body).slice(0, 120_000)}\n\`\`\``;
      })
      .join("\n\n"),
  ]
    .filter(Boolean)
    .join("\n");

  const ticketContextSummary = buildTicketOrgContextSummary({
    ticketId: id,
    parsed,
    orgId,
    orgName,
    attachmentsNote,
    resolvedDatacenter,
    dc,
  });

  return {
    ok: true,
    datacenter: dc,
    resolvedDatacenter,
    preferredDatacenter: preferred,
    datacenterMismatch,
    ticketTool: getTicketTool,
    orgId: orgId || null,
    orgName: orgName || null,
    markdown,
    ticketContextSummary,
    conversationMarkdown: conversationMd,
    rawTicketText: ticketRes.text,
    attachmentsNote,
  };
}

/**
 * @param {unknown} parsed
 */
function extractAttachmentsNote(parsed) {
  const attrs = extractZendeskTicketAttributes(parsed);
  /** @type {string[]} */
  const names = [];
  /** @type {string[]} */
  const attachmentIds = [];
  if (!attrs) return { names, attachmentIds, summary: "No attachments noted." };

  const att = attrs.attachments ?? attrs.attachment;
  const list = Array.isArray(att) ? att : att ? [att] : [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const a = /** @type {Record<string, unknown>} */ (item);
    const name = pickStr(a.file_name, a.filename, a.name, a.title);
    const id = pickStr(a.id, a.attachment_id);
    if (name) names.push(name);
    if (id) attachmentIds.push(id);
  }

  const summary =
    names.length > 0
      ? `Attachments (${names.length}): ${names.slice(0, 8).join(", ")}${names.length > 8 ? "…" : ""}`
      : "No attachments on ticket.";
  return { names, attachmentIds, summary };
}

/**
 * @param {object} p
 */
function buildTicketOrgContextSummary(p) {
  const attrs = extractZendeskTicketAttributes(p.parsed);
  const subject = attrs ? pickStr(attrs.subject, attrs.title) : "";
  const status = attrs ? pickStr(attrs.status, attrs.state) : "";
  const description = attrs
    ? pickStr(attrs.description, attrs.body, attrs.details)?.slice(0, 1500)
    : "";
  const tags = attrs && Array.isArray(attrs.tags) ? attrs.tags.map(String).slice(0, 20).join(", ") : "";

  return [
    `**Ticket #${p.ticketId}** (SupportDog Step 4 brief)`,
    `- **Subject:** ${subject || "—"}`,
    `- **Status:** ${status || "—"}`,
    `- **Tags:** ${tags || "—"}`,
    `- **Zendesk org:** ${p.orgName || "—"}`,
    `- **Datadog org ID:** ${p.orgId || "—"} (custom field → description → pluto search)`,
    `- **Datacenter:** ${p.resolvedDatacenter || p.dc} (MCP query: ${p.dc})`,
    `- **Attachments:** ${p.attachmentsNote.summary}`,
    description ? `- **Description (excerpt):** ${description}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
