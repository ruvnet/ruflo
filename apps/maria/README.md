# MarIA

Interface « Agent OS » au-dessus de Ruflo et de Claude Code. On décrit une mission dans le navigateur. Un worker sur ta machine la confie à Claude Code (`claude -p`) dans un dossier de projet initialisé avec Ruflo. Le fil d'activité, les fichiers modifiés, les agents, la mémoire Ruflo et les demandes d'autorisation s'affichent en direct.

MarIA ne modifie pas le cœur de Ruflo. Tout le code est dans `apps/maria/`.

```
Navigateur ──► Vercel (Next.js, apps/maria)
                    │  lecture/écriture (clé anon + RLS)
                    ▼
               Supabase (schéma `maria` : missions, événements, autorisations, mémoire…)
                    ▲  clé service_role
                    │
               Worker local (ton PC) ──► claude -p ──► ton projet Ruflo
```

- **Vercel** n'héberge que l'interface. Il ne lance jamais `claude`.
- **Le worker** tourne sur la machine qui contient tes projets et Claude Code. Sans lui, les missions restent « en attente ».
- **Pas de serveur Ruflo à déployer.** Ruflo est un outil (CLI, MCP, `.claude-flow/`, `.swarm/`) utilisé par Claude Code dans le dossier du projet.

---

## Installer MarIA sur une nouvelle machine

### 1. Prérequis

- **Linux** avec systemd. C'est le mode d'emploi testé, pour l'utilisateur `rintio`.
- **Node.js 22.13 ou plus.** supabase-js a besoin du WebSocket natif, et la vue Mémoire de `node:sqlite`.
  ```bash
  nvm install 22 && nvm use 22
  ```
- **Claude Code installé et connecté avec le Node 22 actif.** Sinon le worker affiche `spawn claude ENOENT`.
  ```bash
  npm install -g @anthropic-ai/claude-code
  claude   # se connecter une fois, puis quitter
  ```
- **git**, plus un ou plusieurs dossiers de projet initialisés avec Ruflo (`npx ruflo@latest init`).

### 2. Récupérer le code

```bash
git clone https://github.com/dr-phil-2004/MarIA.git
cd MarIA/apps/maria
npm install
```

### 3. Supabase (une seule fois par projet Supabase)

Si le projet Supabase existe déjà, avec ses migrations et ton compte membre, passe directement à l'étape 4.

1. **Exposer le schéma.** Dans *Project Settings → API → Exposed schemas*, ajoute `maria`.
2. **Appliquer les migrations.** Dans le *SQL Editor*, exécute **dans l'ordre** les fichiers de `supabase/migrations/` :
   `0001_maria_init.sql` → `0012_agent_studio.sql`.
   Termine par :
   ```sql
   notify pgrst, 'reload schema';
   ```
3. **Te donner l'accès.** Ton compte doit d'abord exister dans *Authentication → Users* : connecte-toi une fois, ou crée l'utilisateur. Puis :
   ```sql
   insert into maria.members (user_id)
   select id from auth.users where email = 'ton@email.com';
   ```
4. **Autoriser les adresses de connexion.** Dans *Authentication → URL Configuration* :
   - **Site URL** : `https://mar-ia-orpin.vercel.app`
   - **Redirect URLs** :
     - `https://mar-ia-orpin.vercel.app/**`
     - `https://*-dr-phil-2004s-projects.vercel.app/**` (prévisualisations)
     - `http://localhost:3000/**`

### 4. Configurer le worker : `apps/maria/.env.local`

Ce fichier n'est **jamais** commité. Recrée-le sur chaque machine :

```bash
# Supabase (Project Settings → API)
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...          # secret : uniquement ici, jamais sur Vercel

# Dossiers de projet que MarIA peut piloter : nom affiché -> chemin absolu
MARIA_WORKSPACES={"mon-projet":"/home/rintio/projets/mon-projet"}

# Outils autorisés sans demander (les autres passent par la fenêtre Autoriser/Refuser)
MARIA_ALLOWED_TOOLS=Read,Glob,Grep,Edit,Write,Bash(git status),Bash(git diff:*),Bash(npm test:*)
```

<details>
<summary>Variables facultatives (valeurs par défaut)</summary>

| Variable | Défaut | Rôle |
|---|---|---|
| `MARIA_PERMISSION_MODE` | `acceptEdits` | Mode de permission de Claude Code (`acceptEdits`, `auto`, `bypassPermissions`, `dontAsk`, `plan`) |
| `MARIA_INTERACTIVE_PERMISSIONS` | activé | `0` = refuser automatiquement les actions non autorisées, sans fenêtre |
| `MARIA_PERMISSION_TIMEOUT_MS` | `600000` | Délai de réponse aux fenêtres d'autorisation et de question |
| `MARIA_MODEL` | (celui de Claude Code) | Modèle utilisé pour les missions |
| `MARIA_CLAUDE_BIN` | `claude` | Chemin de l'exécutable Claude Code |
| `MARIA_MAX_PARALLEL` | `3` | Missions « branche isolée » simultanées par dossier |
| `MARIA_WORKTREE_DIR` | `~/.maria/worktrees` | Emplacement des worktrees |
| `MARIA_WORKTREE_LINKS` | `.claude-flow,.swarm,node_modules` | Éléments reliés (symlink) dans chaque worktree |
| `MARIA_WORKTREE_COPY` | `.mcp.json,.claude,CLAUDE.md` | Éléments copiés dans chaque worktree |
| `MARIA_MEMORY_DB` | `.swarm/memory.db` | Base mémoire Ruflo lue dans chaque dossier (`0` = désactivé) |
| `MARIA_RUFLO_CMD` | `npx -y ruflo@latest` | Commande Ruflo pour lire le registre d'agents |
| `MARIA_IGNORE_PATHS` | `.claude-flow/,.swarm/` | Préfixes exclus de la liste des fichiers modifiés |
| `MARIA_POLL_MS` | `2000` | Fréquence de recherche de nouvelles missions |
| `MARIA_TICKET_PR` | activé | `0` = ne pas pousser la branche d’un ticket ni ouvrir sa PR GitHub |

</details>

### 5. Lancer le worker

**À la main**, pour tester :

```bash
npm run worker
```

**En service automatique** (recommandé). Il démarre avec la session, redémarre s'il plante et s'arrête proprement. À lancer **dans un terminal où `node -v` donne la 22 et où `claude` fonctionne**, car le service fige ces chemins :

```bash
npm run service -- install
sudo loginctl enable-linger $USER   # facultatif : tourne aussi sans session ouverte, dès l'allumage du PC
```

| Commande (depuis `apps/maria`) | Effet |
|---|---|
| `npm run service -- logs` | Journal du worker en direct (Ctrl+C pour quitter) |
| `npm run service -- status` | Le worker tourne-t-il ? |
| `npm run service -- restart` | Redémarrer (à faire après chaque `git pull`) |
| `npm run service -- install` | Réinstaller (après un changement de version de Node ou de `claude`) |
| `npm run service -- uninstall` | Supprimer le service |
| `npm run service -- print` | Afficher le fichier de service sans rien installer |

Ne lance pas `npm run worker` en même temps que le service : deux workers se partageraient les missions.

### 6. L'interface

- **En ligne** : https://mar-ia-orpin.vercel.app, déployée par Vercel à chaque fusion sur `main`.
  - Projet Vercel : *Root Directory* = `apps/maria`.
  - Variables Vercel : uniquement `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- **En local** : `npm run dev`, puis http://localhost:3000.

Dans le menu des dossiers, un point plein ● veut dire que le worker est en ligne : il s'est signalé il y a moins de 90 s.

---

## Utilisation

- **Mission** : choisis le dossier et décris la tâche. Ctrl+Entrée lance la mission.
- **Branche isolée** : la mission travaille dans son propre worktree git, en parallèle des autres. Tu la fusionnes ou l'abandonnes ensuite depuis la mission.
- **Chaîne d'agents** : `@system-architect @coder @tester Ajoute…` n'utilise que ces agents, dans cet ordre, l'un après l'autre. Taper `@` propose les agents du dossier (`.claude/agents`). Les noms avec espaces s'écrivent avec des tirets, par exemple `@Benchmark-Suite`.
- **Autorisations et questions** : une fenêtre s'ouvre dans MarIA quand l'agent veut faire une action non pré-autorisée, ou quand il te pose une question.
- **Continuer** : relance la même conversation Claude Code avec une nouvelle consigne.
- **Tickets** : vues Tableau (Kanban), Liste et Tableur. « Lancer l’agent » exécute le ticket avec l’agent assigné sur la branche `maria/T-<numéro>-…` ; à la fin, le worker pousse la branche et ouvre la PR avec la CLI GitHub (`gh`, à installer et connecter une fois avec `gh auth login` sur la machine du worker), puis le ticket passe « En revue » avec le lien de la PR.
- **Atelier d'agents** : « + » à côté de *Agents* dans la barre latérale (ou « Modifier l’agent » sur sa page) crée ou modifie un agent : nom, description (« quand l’utiliser »), modèle, couleur, outils autorisés, connecteurs et instructions, avec des modèles de départ (Relecteur, Testeur, Documentaliste). Le worker écrit le fichier dans `.claude/agents/` du dossier choisi ; les champs d’en-tête qu’il ne gère pas (ceux des agents Ruflo, par exemple) sont conservés. Un agent de `~/.claude/agents` modifié depuis MarIA est recopié dans le dossier ; les agents intégrés à Claude Code ne sont pas modifiables.
- **Connecteurs** : état de la machine du worker (Claude Code, GitHub CLI, Ruflo, serveurs MCP du projet) et serveurs MCP à brancher sur les missions (GitHub, navigateur Playwright, PostgreSQL, Slack, Notion ou serveur personnalisé). Pour chacun : activation, « Demander » ou « Toujours autoriser », outils pré-autorisés et agents concernés (le connecteur n'est alors chargé que si la mission mentionne un de ces agents). Les jetons vont dans `.env.local` du worker (ex. `GITHUB_PERSONAL_ACCESS_TOKEN=…`), puis `npm run service -- restart` ; MarIA n'enregistre que le nom des variables. Un connecteur dont un jeton manque est ignoré, avec un avertissement dans le fil de la mission.
- **Mémoire** : l'onglet affiche la mémoire Ruflo du dossier (`.swarm/memory.db`), recopiée par le worker toutes les 30 s.

## Dépannage

| Symptôme | Cause / solution |
|---|---|
| `Missing script: "worker"` | Tu n'es pas dans `apps/maria`, ou pas sur la bonne branche |
| `native WebSocket not found` / Node 20 | `nvm use 22`, puis relancer (ou `npm run service -- install`) |
| `Invalid schema: maria` | Ajouter `maria` aux *Exposed schemas*, puis `notify pgrst, 'reload schema';` |
| « Accès refusé » à la connexion | Ton compte n'est pas dans `maria.members` (étape 3.3) |
| `spawn claude ENOENT` | Claude Code n'est pas installé pour le Node 22 actif (`npm i -g @anthropic-ai/claude-code`) |
| Pas de fenêtre d'autorisation | Retirer `MARIA_INTERACTIVE_PERMISSIONS=0` de `.env.local` et redémarrer le worker |
| Erreur `... applique la migration 0006…0012` | Exécuter la migration indiquée dans Supabase |
| Le lien de connexion renvoie vers localhost | Adresse Vercel absente des *Redirect URLs* Supabase (étape 3.4) |
| Connecteur « À configurer » | Un jeton manque dans `.env.local` du worker ; l'ajouter puis `npm run service -- restart` (l'état se met à jour au redémarrage, puis toutes les 10 min) |
| L’atelier reste sur « Enregistrement… » | Le worker est arrêté ou ancien : `git pull` puis `npm run service -- restart` (la demande est appliquée à son retour) |
| Onglet Mémoire vide | La base Ruflo n'existe pas encore dans ce dossier (`npx ruflo@latest memory init`) |

## Sécurité

- `SUPABASE_SERVICE_ROLE_KEY` contourne toutes les règles d'accès. Elle reste dans `.env.local` sur la machine du worker : jamais sur Vercel, jamais dans une variable `NEXT_PUBLIC_*`, jamais dans git.
- L'interface n'utilise que la clé anon. La RLS du schéma `maria` limite tout aux membres de `maria.members`.
