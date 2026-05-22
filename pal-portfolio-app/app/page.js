import PalPortfolioExplorer from "@/components/PalPortfolioExplorer";
import { zendeskAgentTicketsBaseFromEnv } from "@/lib/gleanZendeskIndexFetch";
import { isGleanOAuthEnvConfigured } from "@/lib/gleanOAuthSession";

export default function HomePage() {
  const agentTicketBase = zendeskAgentTicketsBaseFromEnv();
  const gleanOauthEnabled = isGleanOAuthEnvConfigured();

  return (
    <div style={{ padding: "1.5rem clamp(1rem, 3vw, 2rem)" }}>
      <PalPortfolioExplorer agentTicketBase={agentTicketBase} gleanOauthEnabled={gleanOauthEnabled} />
    </div>
  );
}
