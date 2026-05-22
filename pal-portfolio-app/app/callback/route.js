/**
 * Ticino mcp-common OAuth callback — must be http://localhost:PORT/callback (not a nested API path).
 * Re-uses SupportDog token exchange handler.
 */
export { GET } from "@/app/api/pal-portfolio/supportdog/oauth/callback/route";

export const dynamic = "force-dynamic";
