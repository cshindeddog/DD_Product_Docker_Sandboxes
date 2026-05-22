import TicketAnalysisClient from "./TicketAnalysisClient";
import { zendeskAgentTicketsBaseFromEnv } from "@/lib/gleanZendeskIndexFetch";
import { isGleanOAuthEnvConfigured } from "@/lib/gleanOAuthSession";

export async function generateMetadata({ params }) {
  const { ticketId } = await params;
  return {
    title: `Ticket ${ticketId} · Summary · PAL ticket review`,
    description: "Ticket export context and Glean-generated PSE-style summary",
  };
}

export default async function TicketAnalysisPage({ params }) {
  const { ticketId } = await params;
  const agentTicketBase = zendeskAgentTicketsBaseFromEnv();
  const gleanSearchBase = process.env.NEXT_PUBLIC_GLEAN_SEARCH_URL || "";

  return (
    <div style={{ padding: "1.5rem clamp(1rem, 3vw, 2rem)" }}>
      <TicketAnalysisClient
        ticketId={String(ticketId)}
        agentTicketBase={agentTicketBase}
        gleanSearchBase={gleanSearchBase}
        gleanOauthEnabled={isGleanOAuthEnvConfigured()}
      />
    </div>
  );
}
