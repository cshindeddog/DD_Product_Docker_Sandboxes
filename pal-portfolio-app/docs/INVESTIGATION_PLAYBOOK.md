# Investigation playbook (experiment app)

Ticket analysis in this folder follows the **investigation-playbook** skill (SupportDog MCP + optional Glean + Claude).

Skill source: TS AI Marketplace `investigation-playbook` (same steps as `/investigation-playbook` in Cursor).

Implementation:

- `lib/supportdogInvestigationContext.js` — Step 4 (ticket + org via MCP)
- `lib/claudeInvestigationPlaybook.js` — Claude synthesis + optional Glean search
- `lib/investigationPlaybookPrompt.js` — Step 9 output format
- `app/api/pal-portfolio/ticket/[ticketId]/analyze/route.js` — API entry
