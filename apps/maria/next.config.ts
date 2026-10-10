import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Ne pas générer AGENTS.md / CLAUDE.md à chaque `next dev`.
  agentRules: false,
};

export default nextConfig;
