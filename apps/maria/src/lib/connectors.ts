// Catalogue des connecteurs : des serveurs MCP que le worker branche sur Claude Code pendant les missions.
// Partagé par l'interface (page Connecteurs) et le worker (configuration MCP de chaque mission).
// Les secrets ne quittent jamais la machine du worker : on ne déclare ici que le NOM des variables d'environnement.

export type ConnectorCategory = 'code' | 'data' | 'communication' | 'organisation' | 'custom';

export interface ConnectorDef {
  id: string;
  name: string;
  description: string;
  category: ConnectorCategory;
  /** Commande lancée par Claude Code ; ${VAR} est remplacé par la variable d'environnement du worker. */
  command: string;
  args: string[];
  /** Variables d'environnement requises (dans .env.local du worker). */
  env: string[];
  /** Où obtenir le jeton. */
  setup: string;
  /** Exemples d'outils exposés (indicatif). */
  tools: string[];
  /** Couleur de la tuile. */
  color: string;
}

export const CATALOG: ConnectorDef[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Issues, pull requests, revues et fichiers des dépôts GitHub.',
    category: 'code',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    setup: 'Crée un jeton sur github.com → Settings → Developer settings → Personal access tokens (droits repo).',
    tools: ['create_issue', 'create_pull_request', 'get_file_contents', 'search_code'],
    color: '#8b8b96',
  },
  {
    id: 'playwright',
    name: 'Navigateur (Playwright)',
    description: 'Ouvre des pages, clique, remplit des formulaires et fait des captures pour tester un site.',
    category: 'code',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
    env: [],
    setup: 'Aucun jeton : Playwright télécharge son navigateur au premier lancement.',
    tools: ['browser_navigate', 'browser_click', 'browser_snapshot', 'browser_take_screenshot'],
    color: '#2ead6d',
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'Lecture seule d’une base Postgres : schéma et requêtes SQL.',
    category: 'data',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', '${DATABASE_URL}'],
    env: ['DATABASE_URL'],
    setup: 'URL de connexion postgres://utilisateur:motdepasse@hôte:5432/base (idéalement un utilisateur en lecture seule).',
    tools: ['query'],
    color: '#4f7cc4',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Lire les canaux et publier des messages (ex. un rapport de fin de mission).',
    category: 'communication',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],
    setup: 'Crée une app Slack (api.slack.com/apps), ajoute les droits chat:write et channels:read, installe-la et copie le « Bot User OAuth Token » (xoxb-…) et l’ID de l’espace (T…).',
    tools: ['slack_post_message', 'slack_list_channels', 'slack_get_channel_history'],
    color: '#c6488f',
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Chercher, lire et écrire des pages et bases Notion.',
    category: 'organisation',
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    env: ['NOTION_TOKEN'],
    setup: 'Crée une intégration sur notion.so/my-integrations, copie son jeton (ntn_…) et partage-lui les pages concernées.',
    tools: ['API-post-search', 'API-retrieve-a-page', 'API-patch-page'],
    color: '#9ca3af',
  },
];

export const CATEGORY_LABEL: Record<ConnectorCategory, string> = {
  code: 'Code',
  data: 'Données',
  communication: 'Communication',
  organisation: 'Organisation',
  custom: 'Personnalisés',
};

/** Réglages d'un connecteur, enregistrés dans maria.connectors. */
export interface ConnectorConfig {
  id: string;
  enabled: boolean;
  /** ask = chaque outil passe par la fenêtre d'autorisation ; allow = tous ses outils sont pré-autorisés. */
  policy: 'ask' | 'allow';
  /** Outils toujours autorisés même en mode « ask ». */
  allowed_tools: string[];
  /** Agents pour lesquels le connecteur est chargé (mission qui les mentionne) ; null = toutes les missions. */
  agents: string[] | null;
  /** Serveur MCP personnalisé (sinon : entrée du catalogue). */
  custom: { name: string; description: string; command: string; args: string[]; env: string[] } | null;
  updated_at?: string;
}

/** Définition effective : catalogue, ou serveur personnalisé déclaré dans la page. */
export function resolveDef(config: ConnectorConfig): ConnectorDef | null {
  if (config.custom) {
    return {
      id: config.id,
      name: config.custom.name || config.id,
      description: config.custom.description || 'Serveur MCP personnalisé.',
      category: 'custom',
      command: config.custom.command,
      args: config.custom.args,
      env: config.custom.env,
      setup: 'Serveur déclaré à la main dans MarIA.',
      tools: [],
      color: '#9d7bff',
    };
  }
  return CATALOG.find((c) => c.id === config.id) ?? null;
}

/** Remplace ${VAR} dans les arguments par les valeurs fournies. */
export function expandArgs(args: string[], env: Record<string, string | undefined>): string[] {
  return args.map((a) => a.replace(/\$\{([A-Z0-9_]+)\}/g, (_, v: string) => env[v] ?? ''));
}

/** État du worker publié dans maria.workspaces.health (aucun secret, seulement des présences). */
export interface WorkerHealth {
  checked_at: string;
  node: string;
  claude: string | null;
  gh: { installed: boolean; logged_in: boolean; account: string | null };
  ruflo: { initialized: boolean; memory: boolean };
  /** Serveurs MCP déclarés par le projet (.mcp.json du dossier). */
  project_mcp: string[];
  /** Variables d'environnement présentes parmi celles demandées par les connecteurs. */
  env_present: string[];
}
