import { normalizeSupportdogDatacenter } from "@/lib/supportdogDatacenter";

/**
 * Step 3 — SupportDog MCP not connected (playbook wording + PAL app hint).
 * @param {string | null | undefined} datacenter
 */
export function supportdogPlaybookConnectivityMessage(datacenter) {
  const dc = (normalizeSupportdogDatacenter(datacenter) || "US1").toLowerCase();
  const host =
    dc === "staging"
      ? "https://supportdog-mcp.mcp.us1.staging.dog:443/internal/mcp"
      : `https://supportdog-mcp.mcp.${dc}.prod.dog:443/internal/mcp`;
  return (
    `The SupportDog MCP for **${dc.toUpperCase()}** is not connected or returned an auth error.\n\n` +
    `**In this app:** use **Connect** (or **Connect all**) for **${dc.toUpperCase()}** in the SupportDog panel at the top of the page, then run **Show** again.\n\n` +
    `**In Cursor / Claude Code (terminal):**\n\`\`\`bash\n` +
    `claude mcp add supportdog-mcp-${dc} --transport http --scope user \\\n` +
    `  "${host}"\n\`\`\`\n` +
    `Then restart Claude Code and run \`/mcp\` to authenticate.`
  );
}

/** Step 5 — Glean not connected (playbook wording + PAL app hint). */
export function gleanPlaybookConnectivityMessage() {
  return (
    "The Glean MCP is not connected or returned an error.\n\n" +
    "**In this app:** sign in with **Glean** in the header (or set `GLEAN_API_TOKEN` / server OAuth in `.env.local`).\n\n" +
    "**In Claude Code:** open https://app.glean.com/settings/install?mcpConfigure&mcpHost=claude-code&mcpServer=default " +
    "and follow the instructions, then restart Claude Code."
  );
}
