# Analyse comparative et feuille de route d'amélioration pour `camofox-mcp`

> **Note méthodologique.** Ce rapport synthétise (1) l'état de l'art 2025-2026 sur le contournement des systèmes anti-bot haut de gamme, (2) les patterns de conception d'outils pour agents navigateurs LLM, et (3) une analyse du dépôt `redf0x1/camofox-mcp` à partir de son README, de l'arborescence publiée, du package npm et du dépôt sœur `camofox-browser`. Toute affirmation est sourcée par URL. Les techniques surévaluées ou non prouvées sont signalées explicitement.

---

## Partie 0 — Synthèse exécutive

`camofox-mcp` est un serveur MCP TypeScript qui expose **35 outils** (navigation, interaction, observation, sessions, recherches, profils) en s'appuyant sur un serveur HTTP REST distinct (`camofox-browser`, port 9377), lui-même bâti sur le moteur Camoufox (fork Firefox avec spoofing C++) — voir le README officiel et le package npm (https://github.com/redf0x1/camofox-mcp ; https://www.npmjs.com/package/camofox-mcp). L'architecture est saine et le projet adopte déjà deux bonnes pratiques de l'état de l'art : **snapshots d'arbre d'accessibilité avec refs `eN` stables** (à la Playwright MCP / Vercel agent-browser) et **fallback CSS**.

Cependant, par rapport à la frontière 2025-2026, il manque :

1. **Côté anti-bot** : pas d'humanisation comportementale (souris, frappe), pas de validation de cohérence de fingerprint, pas d'intégration TLS HTTP-only (curl_cffi), pas de stratégie de rotation/rejeu de profils, pas de gestion d'échecs Turnstile/DataDome.
2. **Côté outils agent** : pas de Set-of-Marks visuel, pas d'option vision (OmniParser/UI-TARS), pas de compression DOM avancée façon `browser-use`, pas de primitive sémantique unifiée (`act/extract/observe`), pas de gestion explicite du budget tokens (les snapshots peuvent devenir gros), pas de cache d'actions déterministes (à la Stagehand).
3. **Manque de granularité de l'API** : les 35 outils sont tous "atomiques bas niveau" (Playwright-like), aucun outil composite ne porte d'intent (`extract(query, schema)`, `find_and_click(description)`).

La feuille de route ci-après priorise par ratio impact/effort : quick wins (souris humaine, validation fingerprint, vérif TLS HTTP), puis upgrades structurelles (SoM, vision-grounding optionnel, primitive `extract`, cache d'actions), puis options long terme (RL fingerprints, hybrid pure-vision).

---

## Partie 1 — État de l'art 2025-2026 du contournement anti-bot

### 1.1 Vecteurs de fingerprinting & contremesures

#### TLS / JA3 / JA4

Les WAF modernes (Cloudflare, DataDome, Akamai) inspectent le **ClientHello TLS** dès la poignée de main. JA3 (hash de 5 champs) est désormais fragile à cause du *ClientHello permutation* introduit par Chrome 110+, ce qui a poussé l'industrie vers **JA4/JA4+** (extensions triées alphabétiquement, ALPN, SNI, distinction TCP/QUIC) — voir https://scrapfly.io/web-scraping-tools/ja3-fingerprint et https://www.tapscape.com/cloudflare-turnstile-bypass-2026-the-core-level-stealth-guide/. Cloudflare corrèle JA4 avec User-Agent et ASN ; un mismatch (JA4 Python + UA Chrome) entraîne un blocage immédiat.

La librairie de référence pour reproduire un ClientHello réaliste hors navigateur est **curl_cffi** (fork de curl-impersonate, https://github.com/lexiforest/curl_cffi), qui supporte Chrome 99→146, Firefox, Safari, Edge, et expose un paramètre `impersonate=` plus des hooks `extra_fp` pour personnaliser JA3/Akamai/HTTP/2 SETTINGS. Pour les contextes navigateur, **Camoufox hérite du ClientHello Firefox réel** (puisque c'est un Firefox compilé), donc le problème TLS ne se pose pas tant qu'on reste dans le navigateur — la documentation deepwiki sur Camoufox confirme que Spidermonkey + Gecko évitent les détections "engine integrity" Chromium-spécifiques (https://deepwiki.com/daijro/camoufox).

En revanche, **Cloudflare utilise depuis 2025 du monitoring eBPF côté réseau** pour détecter des incohérences kernel Linux vs UA Windows (https://www.tapscape.com/cloudflare-turnstile-bypass-2026-the-core-level-stealth-guide/). Le seul remède pratique reste l'usage de proxys résidentiels/mobiles dont le système hôte est cohérent.

#### HTTP/2 fingerprinting (Akamai)

L'empreinte Akamai HTTP/2 encode `SETTINGS` (HEADER_TABLE_SIZE, INITIAL_WINDOW_SIZE…), `WINDOW_UPDATE`, `PRIORITY` et `pseudo-headers order` (https://curl-cffi.readthedocs.io/en/latest/impersonate/customize.html). curl_cffi expose `CurlOpt.HTTP2_PSEUDO_HEADERS_ORDER` (`masp` non-standard) pour reproduire l'ordre Chrome.

#### Canvas, WebGL, AudioContext, polices

Camoufox modifie ces points au niveau C++ (`ClientWebGLContext`, `nsScreen`, `nsGlobalWindowInner`), ce qui rend les valeurs natives à toute inspection JavaScript (incluant `Function.prototype.toString`) — voir le README Camoufox (https://github.com/daijro/camoufox) et l'analyse deepwiki. La distribution est statistique via **BrowserForge** : 5% Linux, 95% Windows/macOS, avec sous-distributions cohérentes (GPU × écran × OS). C'est l'approche la plus solide actuellement, mais **Camoufox a connu un trou de maintenance d'environ un an** (relève fin 2025 / début 2026, v146.0.1-beta.25 en janvier 2026) et reste explicitement en bêta — voir https://www.proxies.sx/blog/ai-browser-automation-camoufox-nodriver-2026.

#### Client Hints (Sec-CH-UA), navigator.webdriver, Closed Shadow Roots

Côté Chromium, **Patchright** (https://github.com/Kaliiiiiiiiii-Vinyzu/patchright) reste la référence open-source : il évite `Runtime.enable` (signe le plus utilisé pour détecter Playwright/Puppeteer), retire `--enable-automation`, ajoute `--disable-blink-features=AutomationControlled`, et permet d'interagir avec des Closed Shadow Roots. **Nodriver** (successeur officiel d'undetected-chromedriver, async-only) parle CDP directement et passe des challenges Cloudflare là où Patchright échoue, selon les benchmarks publiés (https://roundproxies.com/blog/best-patchright-alternatives/). À l'inverse, **undetected-chromedriver est désormais largement détecté** et **puppeteer-stealth a été déprécié en février 2025** — la recommandation industrielle est de migrer (https://scrapfly.io/blog/posts/how-to-bypass-cloudflare-anti-scraping).

### 1.2 Évasion biométrique comportementale

#### Trajectoires de souris

Cloudflare Turnstile et DataDome traquent les `mousemove` events : trajectoire linéaire ou Bézier "trop parfaite" → fail (https://www.tapscape.com/cloudflare-turnstile-bypass-2026-the-core-level-stealth-guide/ ; https://substack.thewebscraping.club/p/bypass-datadome-mouse-movements-in-playwright). La référence open-source est **Ghost Cursor** (Bézier + loi de Fitts, ~62k téléchargements npm/semaine ; https://github.com/Xetera/ghost-cursor), qui simule overshoot, hésitation, accélération non uniforme.

**Limite académique honnête** : un papier 2024 (DMTG, https://arxiv.org/html/2410.18233v1) montre que les trajectoires Ghost-cursor sont **détectables par classifieurs ML profonds** (LSTM, BiLSTM, TCN) car concentrées à un bord de la distribution humaine. Les modèles de diffusion à entropie contrôlée (DMTG) font mieux mais ne sont pas encore packagés. Pratiquement : Ghost Cursor reste suffisant face aux systèmes de production déployés en 2026, mais il faut s'attendre à ce que la barre monte. Camoufox annonce des "human-like mouse movements natively" au niveau Juggler patch, ce qui est intéressant à exploiter (https://github.com/daijro/camoufox#features).

#### Cadence de frappe

Les intervalles fixes (`type_text` avec un seul `delay`) sont un signal "low-sophistication". Il faut des distributions de **dwell time** (touche enfoncée) et **flight time** (entre touches) gaussiennes ou log-normales basées sur des datasets humains type SapiMouse — peu de bibliothèques le proposent directement, c'est typiquement un patch interne.

### 1.3 Vendeurs anti-bot et signaux 2025-2026

| Vendeur | Signaux clés | Approches de bypass éprouvées |
|---|---|---|
| **Cloudflare Turnstile** | JA4+ TLS, eBPF TCP/IP stack, Canvas/WebGL/AudioContext, navigation timing, mouse trajectory, AI Labyrinth (mars 2025) | Camoufox ou Nodriver + résidentiels + Ghost Cursor ; Pre-Clearance cookie sur SPA (https://developers.cloudflare.com/turnstile/) |
| **DataDome** | JS injection deep fingerprinting, JA3, comportement (jitter, scroll, hover duration), event timing | Camoufox + Ghost Cursor uniquement (Patchright échoue d'après Roundproxies, https://roundproxies.com/blog/best-patchright-alternatives/) |
| **Akamai Bot Manager** | HTTP/2 SETTINGS+PRIORITY+WINDOW_UPDATE, sensor data, abck cookie | curl_cffi `akamai=` ou navigateur réel |
| **PerimeterX / HUMAN** | `_px*` cookies via Worker challenges, comportement | Navigateur réel + résidentiels |
| **Kasada** | `x-kpsdk-*` headers, payload encodé, VM JS challenge | Très difficile sans solveur dédié — pas de solution open-source totalement fiable |
| **F5 / Shape** | Sensor JS, bot score | Idem, navigateur réel |
| **reCAPTCHA v3 / Enterprise** | Score basé fingerprint + historique cookie + comportement | Maintenir cookies/profil chaud + comportement |
| **hCaptcha** | Image challenge + fingerprint | Solveurs payants (2Captcha, CapSolver) |

### 1.4 Couche réseau

- **Résidentiels > ISP > datacenter** pour les sites protégés ; les fournisseurs (Decodo, Bright Data, Oxylabs) offrent des sticky sessions par "backconnect gateway".
- **GeoIP cohérence** : Camoufox calcule automatiquement timezone/locale/Intl spoofing à partir de l'IP du proxy (`PROXY_STRATEGY=backconnect` activé dans `camofox-browser`, https://github.com/jo-inc/camofox-browser).
- **DoH leaks** : un Camoufox dans Docker peut faire fuiter des requêtes DNS vers le résolveur de l'hôte si non configuré ; il faut router DNS via le proxy (SOCKS5 supporte UDP) ou utiliser `network.trr.mode=3` côté Firefox.
- **WebRTC leaks** : Camoufox spoof WebRTC au niveau C++ ; il faut vérifier sur des sites comme browserleaks.com/webrtc.

### 1.5 Frameworks open-source — recap honnête

| Outil | Statut 2026 | Forces | Faiblesses |
|---|---|---|---|
| **Camoufox** | Beta active (v146 janv. 2026) | Spoofing C++ engine-level, BrowserForge, GeoIP auto | Trou de maintenance 2024-2025, lock-in Firefox, certaines incohérences fingerprint résiduelles, rebase coûteux à chaque release Mozilla (https://deepwiki.com/daijro/camoufox) |
| **Patchright** (py/node) | Maintenu | Drop-in Playwright Chromium, évite Runtime.enable, Closed Shadow Roots | Chromium uniquement, ne couvre pas le fingerprint canvas/webgl |
| **Nodriver / Zendriver** | Actif, async | CDP minimal, contourne Patchright sur certains sites | Async-only, peu de tutoriels |
| **rebrowser-patches** | Actif | Patches de Puppeteer/Playwright | Niche |
| **undetected-chromedriver** | Vieillissant | API simple Selenium | Largement détecté en 2026 |
| **botright** | Actif | Solveurs CAPTCHA intégrés | Moins éprouvé que Camoufox |
| **curl-impersonate / curl_cffi** | Très actif (v0.15+) | Bypass TLS/HTTP2 sans navigateur | Pas de JS, donc pas de challenges Turnstile |
| **SeleniumBase UC Mode** | Maintenu | Reconnect trick, intégration Selenium | Détection Cloudflare en hausse |
| **browserforge** | Actif | Distribution statistique de fingerprints | Library brique, pas un framework complet |

---

## Partie 2 — État de l'art : conception d'outils pour agents navigateurs LLM

### 2.1 Représentation de la page : DOM brut vs A11y tree vs screenshot vs Set-of-Marks

#### Mesures empiriques de coût en tokens

Plusieurs benchmarks récents convergent : **HTML brut ≈ 4,8× plus lourd qu'un snapshot d'arbre d'accessibilité** sur une page d'exemple (https://www.webfuse.com/blog/agent-browser-vs-puppeteer-and-playwright). Vercel `agent-browser` revendique **93% de réduction de contexte** vs Playwright MCP (https://paddo.dev/blog/agent-browser-context-efficiency/) en exposant uniquement les éléments interactifs sous forme `@e1: button "Sign In"`. Un snapshot typique fait **200-400 tokens** au lieu de plusieurs milliers (https://dev.to/chen_zhang_bac430bc7f6b95/why-vercels-agent-browser-is-winning-the-token-efficiency-war-for-ai-browser-automation-4p87). Le seul Playwright MCP **paie ~13 700 tokens rien que pour les définitions d'outils** à chaque tour (https://medium.com/@serkan_ozal/browser-devtools-mcp-78-fewer-tokens-vs-playwright-mcp-faster-and-more-consistent-32f314004d30).

**Conclusion robuste** : l'arbre d'accessibilité avec refs `eN` est aujourd'hui la meilleure représentation par défaut pour la plupart des LLM ≥ GPT-4o-mini / Claude 3.5 Sonnet / Gemini Flash.

#### Set-of-Marks (SoM)

Le papier fondateur **"Set-of-Mark Prompting Unleashes Extraordinary Visual Grounding in GPT-4V"** (Yang et al., 2023, arXiv 2310.11441 ; https://arxiv.org/abs/2310.11441) montre qu'overlayer des marqueurs alphanumériques sur une image segmentée par SAM/SEEM permet à GPT-4V de **dépasser les modèles de référence supervisés** sur RefCOCOg en zero-shot. **WebVoyager** (He et al., ACL 2024 ; https://arxiv.org/abs/2401.13919) a popularisé l'usage du SoM pour les pages web, atteignant 59,1% sur leur benchmark. La technique est **scientifiquement prouvée** mais coûte un pass supplémentaire de segmentation et marquage (typiquement via le script `GPT-4V-ACT` qui détecte les éléments interactifs HTML — pas besoin d'un modèle de vision lourd si on a accès au DOM).

#### Vision pure / OmniParser v2 (Microsoft, 2025)

**OmniParser v2** (https://www.microsoft.com/en-us/research/articles/omniparser-v2-turning-any-llm-into-a-computer-use-agent/) est un pipeline en deux modèles : YOLOv8 fine-tuné (détection des régions interactives, dataset 67k screenshots) + Florence-2 fine-tuné (description fonctionnelle des icônes). Score **39,5% sur ScreenSpot Pro**, transforme GPT-4V de 70,5% à 93,8% sur ScreenSpot. Ouvert (icon_caption MIT, icon_detect AGPL) — utilisable comme étape de grounding visuel en complément ou substitut de l'a11y tree, surtout sur applications canvas/iframe/Shadow DOM. Coût : un pass GPU (~5s sur T4 selon Replicate, https://replicate.com/microsoft/omniparser-v2). **Trade-off** : réservé aux pages où le DOM ne suffit pas (Canvas-heavy, jeux, applications WebGL).

#### Approche pure-vision sans SoM

**Magnitude** (https://github.com/magnitudedev/browser-agent) atteint **93,9% sur WebVoyager** (le SOTA récent) avec une approche pure-vision basée Claude Sonnet 4 — sans annotation DOM. L'argument : "drawing numbered boxes around page elements doesn't generalize well due to complex modern sites" (https://github.com/sagekit/webvoyager). C'est une option crédible **uniquement avec un modèle de vision fortement grounded** (Sonnet 4, GPT-4.5, Qwen2.5-VL 72B) ; sur des modèles plus petits, SoM reste préférable.

#### Synthèse comparée

| Représentation | Tokens | Précision | Latence | Quand l'utiliser |
|---|---|---|---|---|
| HTML brut | énorme | médiocre (bruit) | faible | jamais pour un agent LLM |
| A11y tree + refs | 200-2k | bonne sur sites sémantiques | faible | défaut |
| A11y tree + refs + screenshot annoté (SoM) | +5-10k img | très bonne | moyenne | pages visuelles, formulaires complexes |
| OmniParser only | ~3k | très bonne en visuel | élevée (GPU) | Canvas, Shadow DOM fermé, iframes opaques |
| Vision pure (modèle grounded) | image only | meilleure (Magnitude 94%) | élevée | budget compute permettant Sonnet 4 |

### 2.2 Patterns d'API : `act / extract / observe / agent`

**Stagehand** (Browserbase, https://www.browserbase.com/blog/ai-web-agent-sdk ; https://github.com/browserbase/stagehand) a popularisé un quartet de primitives :
- `act("click on the comments link")` — action sémantique en langage naturel
- `extract("title and points", schema)` — extraction structurée typée Zod
- `observe()` — découverte d'actions disponibles, "preview" déterministe avant d'agir
- `agent()` — boucle autonome multi-step

Avec **caching d'actions** : la première exécution coûte un appel LLM, les suivantes rejouent en CDP pur (10-100× speedup, zéro token). C'est devenu un standard de fait.

**browser-use** (https://github.com/browser-use/browser-use) — atteint **89,1% sur WebVoyager** (https://browser-use.com/posts/sota-technical-report) — utilise un script `buildDomTree.js` injecté qui :
1. Détecte les éléments interactifs (incluant `getEventListeners` via CDP pour les `<div>` cliquables JS, https://deepwiki.com/browser-use/browser-use/5.3-interactive-element-detection)
2. Calcule visibilité, top-element, viewport expansion
3. Construit un `selector_map` index→DOMElementNode
4. Optionnellement highlight les éléments dans la page (debug visuel)

Le pipeline de sérialisation en 6 étapes prend 10-50ms sur des pages à 500+ éléments. Les drops d'éléments invisibles, les listbox toujours indexés (pour `select_dropdown`), la détection des click handlers JS sont les patterns à reprendre.

### 2.3 Granularité des outils : composite vs atomique

Le débat est tranché empiriquement par le post Vercel (https://paddo.dev/blog/agent-browser-context-efficiency/) : "Removing 80% of an agent's tools made it 3.5x faster with 100% success rate." Moins d'outils = moins de définitions en context = moins de confusion de l'agent. Le pattern gagnant 2026 :
- **3-5 outils sémantiques** (`act`, `extract`, `observe`, `navigate`, `wait`) plutôt que 30+ outils Playwright-bas-niveau
- **Outils composites** (`fill_form`, `navigate_and_snapshot`) pour les flux fréquents — déjà présents dans `camofox-mcp` ✓
- **Batch tool / `execute`** : Browser DevTools MCP (https://medium.com/@serkan_ozal/browser-devtools-mcp-78-fewer-tokens-vs-playwright-mcp-faster-and-more-consistent-32f314004d30) montre que regrouper plusieurs actions dans un seul appel réduit drastiquement les tours

### 2.4 Computer Use (Anthropic) et OpenAI Operator

**Anthropic Computer Use** (claude-3.5-sonnet, oct. 2024 ; claude-sonnet-4-5 en 2025-2026 ; https://www.anthropic.com/news/3-5-models-and-computer-use ; https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool) repose sur :
- Boucle `screenshot → action(coordonnées x,y) → screenshot`
- Modèle entraîné à compter les pixels depuis bords/repères (résolution recommandée XGA/WXGA pour limiter le scaling)
- Quatre actions : `screenshot`, `left_click(x,y)`, `type(text)`, `key(combo)`, `mouse_move`
- Pour `computer_20251124` : ajout de `zoom(region)` permettant d'inspecter une région à pleine résolution
- Score OSWorld 14,9% (toujours faible en absolu — le coordinate-clicking pur reste expérimental)

**OpenAI Operator / CUA** : architecture similaire (screenshot + action), pas de doc publique exhaustive ; a été dépassé par browser-use et Magnitude sur WebVoyager.

**Hermes Agent (Nous Research)** — la doc consultée (https://hermes-agent.nousresearch.com/ ; https://github.com/nousresearch/hermes-agent ; https://docs.browser-use.com/cloud/tutorials/integrations/hermes-agent) montre que Hermes utilise **browser-use comme backend par défaut** ou Browserbase via gateway, et expose **`browser_navigate`** + tools périphériques. Hermes peut router via **un backend Camofox local** en posant `CAMOFOX_URL` dans la config (https://github.com/mudrii/hermes-agent-docs) — c'est précisément le hook que `camofox-mcp` exploite. Hermes apporte par ailleurs un `ContextCompressor` (compression à 50% de la fenêtre) qui est un pattern à imiter.

### 2.5 Récap des patterns prouvés à reprendre

1. **Snapshot a11y avec refs courts (`e1`, `e2`)** — minimal (Playwright MCP, agent-browser, camofox-mcp ✓)
2. **`buildDomTree.js`-style avec CDP `getEventListeners`** — capture les divs cliquables non-sémantiques (browser-use)
3. **Set-of-Marks via overlay sur screenshot** — option pour modèles vision (WebVoyager)
4. **Cache d'actions déterministes** — gain 10-100× (Stagehand)
5. **Compression DOM dynamique selon viewport** — `viewport_expansion` paramétrable
6. **Primitives sémantiques `act / extract / observe`** — réduit les tours et la confusion
7. **Batch `execute([action1, action2])`** — réduit les round-trips
8. **`--output-mode=file`** : sauvegarder snapshots/screenshots sur disque, ne renvoyer que le chemin (Playwright MCP, https://dev.to/kuroko1t/how-accessibility-tree-formatting-affects-token-cost-in-browser-mcps-n2a)
9. **Vision-grounding optionnel par OmniParser v2** quand le DOM ne suffit pas
10. **Chunking + scroll-and-summarize** pour pages longues

---

## Partie 3 — Analyse de `camofox-mcp`

### 3.1 Architecture observée

```
Agent LLM
   │ MCP (stdio | streamable HTTP)
   ▼
camofox-mcp (TS)  ← 35 outils, package npm
   │ REST HTTP (port 9377)
   ▼
camofox-browser (TS Express)  ← service séparé
   │ Playwright juggler
   ▼
Camoufox (Firefox patché C++)
```

Source : README `camofox-mcp` (https://github.com/redf0x1/camofox-mcp) et README `camofox-browser` (https://github.com/redf0x1/camofox-browser ; https://github.com/jo-inc/camofox-browser — fork upstream Jo).

**Constats :**

- L'auteur a fait un choix architectural fort : **séparation MCP ↔ serveur navigateur via REST**. Avantage : le serveur navigateur est réutilisable hors MCP (CLI, OpenClaw, REST direct). Inconvénient : un saut HTTP par appel ajoute de la latence, et le protocole REST devient une API publique à maintenir.
- Le projet est jeune (publié npm en février 2026, 18 ⭐ GitHub, ~9,7k visiteurs estimés sur PulseMCP, https://www.pulsemcp.com/servers/redf0x1-camofox).
- Le code est en TypeScript ESM, Node 22+, vitest, MIT.
- Existe un fork concurrent **`baixianger/camoufox-mcp`** (33 outils, "direct browser", architecture différente) et **`whit3rabbit/camoufox-mcp`** (1 outil, obsolète) — le tableau comparatif est dans le README.

### 3.2 Inventaire des 35 outils exposés

D'après le README `camofox-mcp` (validation croisée avec mcp.so et glama) :

**Tab Management (3)** : `create_tab`, `close_tab`, `list_tabs`
**Presets (1)** : `list_presets` (`us-east`, `us-west`, `japan`, `uk`, `germany`, `vietnam`, `singapore`, `australia`)
**Navigation (4)** : `navigate`, `go_back`, `go_forward`, `refresh`
**Interaction (8)** : `click`, `type_text`, `camofox_press_key`, `scroll`, `camofox_scroll_element`, `camofox_hover`, `camofox_wait_for`, `camofox_evaluate_js` (gated API key)
**Batch / Composite (6)** : `fill_form`, `type_and_submit`, `navigate_and_snapshot`, `scroll_and_snapshot`, `camofox_scroll_element_and_snapshot`, `batch_click`
**Observation (4)** : `snapshot` (a11y), `screenshot` (PNG b64), `get_links`, `camofox_wait_for_text`
**Search (1)** : `web_search` (14 moteurs)
**Session (3)** : `import_cookies`, `get_stats`, `camofox_close_session`
**Session Profiles (4)** : `save_profile`, `load_profile`, `list_profiles`, `delete_profile`
**Health (1)** : `server_status`

### 3.3 Forces

1. **Snapshots tokens-efficient avec refs `eN`** — déjà l'état de l'art (équivalent Playwright MCP, agent-browser).
2. **Fallback CSS selector** — robustesse sur SPAs.
3. **Persistence de profils** (cookies, auto-save/auto-load) — bon pour sessions chaudes.
4. **GeoIP coherence** : le serveur Camoufox dérive timezone/locale automatiquement du proxy.
5. **Multi-session isolation** : 50 sessions, 10 onglets/session par défaut.
6. **Search macros** (Google, YouTube, Reddit, etc.) qui passent les blocages SERP — c'est un différenciateur réel pour les agents de recherche.
7. **API key optionnelle, gating cookie import / evaluate_js** — bonne pratique sécurité.

### 3.4 Lacunes vs état de l'art

| Domaine | Manque | Niveau de criticité |
|---|---|---|
| **Anti-bot — souris** | Aucune trajectoire humaine (Bezier, Fitts) ; clic direct sur coords. Camoufox annonce des mouvements humains côté Juggler mais ils ne sont pas exposés au MCP. | **Élevé** — DataDome bloque |
| **Anti-bot — frappe** | `type_text` semble appliquer un délai uniforme. Pas de dwell/flight times réalistes. | **Élevé** |
| **Anti-bot — validation fingerprint** | Pas d'outil `verify_fingerprint` (vs CreepJS, BrowserScan, browserleaks) avant action sensible. | Moyen |
| **Anti-bot — TLS HTTP-only** | Pas de fallback curl_cffi pour les endpoints qui n'ont pas besoin de JS. | Bas (nice-to-have) |
| **Anti-bot — détection challenge** | Pas d'outil `detect_challenge()` pour reconnaître Turnstile/DataDome et router vers une stratégie (résoudre, attendre, basculer profil). | Moyen |
| **Anti-bot — proxy rotation** | Le proxy est fixé via env vars au démarrage du serveur ; pas de rotation par tab/intent. | Moyen |
| **Tools — Set-of-Marks** | `screenshot` retourne un PNG brut, sans annotations numérotées. | Moyen |
| **Tools — Vision grounding** | Pas d'option `omniparser=true` pour Canvas/Shadow DOM/iframes. | Bas (avancé) |
| **Tools — primitive `extract`** | Pas d'outil `extract(query, schema)` qui combine snapshot + LLM + Zod. L'agent doit faire `snapshot` + parser lui-même. | **Élevé** — c'est le standard 2026 |
| **Tools — primitive `act` sémantique** | Le `click` exige un ref `eN` ou un CSS. Pas de `click("the comments link")`. | Moyen |
| **Tools — observe** | Pas de `observe()` qui retourne les actions exécutables suggérées. | Moyen |
| **Tools — cache d'actions** | Aucune. Chaque appel paie le LLM. | Moyen |
| **Tools — token budget** | Pas de `max_tokens` paramétrable sur snapshot, pas de chunking. Pages longues = explosion contexte. | **Élevé** |
| **Tools — output-mode=file** | Tout passe par stdio JSON-RPC ; pas d'option pour écrire snapshots/screenshots sur disque. | Moyen |
| **Tools — DOM event listeners detection** | Pas confirmé que les `<div>` cliquables JS sont indexés (browser-use le fait via CDP). | Moyen |
| **Tools — outils Playwright-bas-niveau** | 35 outils c'est beaucoup ; définitions chargées à chaque tour ≈ plusieurs milliers de tokens. | Moyen |
| **Sécurité agent** | Pas de garde-fou (`require_confirmation` pour navigation hors-domaine, paywall, paiement). | Moyen (selon usage) |

---

## Partie 4 — Feuille de route d'amélioration (priorisée)

### Légende

- 🟢 **Quick win** : <1 semaine de dev, gain net immédiat.
- 🟡 **Structurel** : 1-3 semaines, refactor partiel.
- 🔴 **Long terme / R&D** : >3 semaines, dépendances externes.

Chaque proposition indique : le pourquoi (papier/source), un signature MCP suggérée, le coût (latence/tokens/argent), et où insérer un éventuel appel LLM additionnel.

---

### 4.1 Anti-bot — Quick wins

#### 🟢 P1.1 — Trajectoires de souris humaines (Ghost Cursor + variabilité)

**Pourquoi** : Cloudflare Turnstile et DataDome détectent les trajectoires linéaires/Bézier-parfaites (https://www.tapscape.com/cloudflare-turnstile-bypass-2026-the-core-level-stealth-guide/). Ghost Cursor est la référence open-source (https://github.com/Xetera/ghost-cursor), avec validation expérimentale (https://substack.thewebscraping.club/p/bypass-datadome-mouse-movements-in-playwright). Le papier DMTG (https://arxiv.org/html/2410.18233v1) avertit que Ghost Cursor reste détectable par classifieurs LSTM, mais c'est suffisant face aux anti-bots de production 2026.

**Quoi modifier** : dans `camofox-browser`, intercepter les actions `click`, `hover`, `move` côté serveur et router via Ghost Cursor (port Playwright disponible : https://github.com/bn-l/ghost-cursor-play). Exposer un paramètre côté MCP :

```ts
click({
  ref: "e5",
  human_motion?: "off" | "ghost" | "ghost+overshoot",  // default "ghost"
  hesitation_ms?: number,
})
```

**Effort** : 3-5 jours. **Latence** : +50-300ms par clic.
**Coût LLM** : aucun.

#### 🟢 P1.2 — Frappe avec dwell/flight times réalistes

**Pourquoi** : la frappe à intervalles fixes est un signal "low-sophistication" (Tapscape, Kameleo). Distribution log-normale des dwell times humains (~80-150ms) et flight times (~80-200ms).

**Quoi** : modifier `type_text` pour échantillonner :
```ts
type_text({
  ref, text,
  cadence?: "instant" | "human" | "deliberate",
  typo_rate?: number  // 0.02 par défaut, simule corrections
})
```
Implémenter en JS dans le serveur ou via les patches Camoufox. Source : pratique standard évoquée dans https://kameleo.io/blog/guide-to-bypassing-datadome.

**Effort** : 2-3 jours.
**Latence** : +500ms-2s pour formulaire long.

#### 🟢 P1.3 — Vérification de cohérence de fingerprint (`verify_fingerprint`)

**Pourquoi** : BrowserForge dans Camoufox spoof statistiquement, mais "Camoufox doesn't always succeed" (README Camoufox : "anti-bot providers test Camoufox over and over again to find even 1 unique inconsistency"). Tester contre CreepJS / BrowserScan avant lancement de tâche évite des tabs grillés.

**Outil proposé** :
```ts
verify_fingerprint({
  tab_id, target?: "creepjs" | "browserscan" | "browserleaks"
}) -> {
  score: number,  // 0-100
  issues: Array<{property: string, expected: string, actual: string}>,
  os_match: boolean,
  webgl_renderer: string,
  ja3_hash: string
}
```
Le serveur ouvre la page de test, scrape le score JSON, ferme l'onglet de test. À utiliser une fois par profil/session.

**Effort** : 2 jours. **Latence** : 5-15s, à ne pas appeler par défaut.

#### 🟢 P1.4 — Détection de challenge anti-bot (`detect_challenge`)

**Pourquoi** : aujourd'hui l'agent ne sait pas qu'il est sur Turnstile / DataDome / Cloudflare interstitial — il enchaîne des clics. Détecter explicitement ces pages permet une stratégie de routage.

**Outil** :
```ts
detect_challenge(tab_id) -> {
  type: "none" | "cloudflare_managed" | "cloudflare_turnstile" | "datadome" | "perimeterx" | "recaptcha_v2" | "hcaptcha",
  iframe_src?: string,
  recommended_action: "wait" | "rotate_session" | "solve_external" | "manual"
}
```
Détection simple par CSS selectors connus (iframe `src*=challenges.cloudflare.com`, classe `dd-challenge`, etc.) ; combinable avec les classifications publiées par Scrapfly (https://scrapfly.io/blog/posts/how-to-bypass-cloudflare-turnstile).

**Effort** : 2 jours. **Coût** : nul.

#### 🟢 P1.5 — Rotation de profil sur échec

**Pourquoi** : un profil grillé reste grillé. Stratégie standard chez les fournisseurs cloud : rotation automatique sur 403/429/CAPTCHA.

**Outil** :
```ts
rotate_fingerprint({tab_id, preserve_cookies?: boolean})
```
Recrée le contexte Camoufox avec un nouveau fingerprint BrowserForge (et un nouveau sticky proxy si `PROXY_STRATEGY=backconnect`).

**Effort** : 1-2 jours.

---

### 4.2 Anti-bot — Structurel

#### 🟡 P1.6 — Intégration backend curl_cffi pour requêtes HTTP-only

**Pourquoi** : pour les endpoints API JSON, charger un navigateur complet est gaspilleur. curl_cffi reproduit JA3+JA4+HTTP/2 Chrome 145/146 avec une empreinte TLS fidèle (https://github.com/lexiforest/curl_cffi). On garde Camoufox pour la nav UI et on bascule sur curl_cffi pour des appels JSON.

**Outil** :
```ts
http_request({
  method, url, headers?, body?,
  impersonate?: "chrome146" | "firefox" | "safari" | "auto_match_tab"  // récupère le UA du tab et choisit
}) -> {status, headers, body}
```
Implémenter via une API REST côté `camofox-browser` qui appelle un binding curl_cffi (Node : `node-libcurl-impersonate`).

**Effort** : 1 semaine.
**Bénéfice** : 100× plus rapide qu'un onglet, contourne les WAF qui ne challengent pas les appels API directs.

#### 🟡 P1.7 — Mode résolution Turnstile passive

**Pourquoi** : Turnstile en mode "managed/non-interactive" se résout sans clic si fingerprint+comportement cohérents. La doc Cloudflare confirme l'approche par "small non-interactive JavaScript challenges" (https://developers.cloudflare.com/turnstile/). En pratique, attendre 3-7s puis vérifier le cookie `cf_clearance` suffit souvent. Pour les modes interactifs, l'open-source pur ne résout pas — recommander un solveur externe (CapSolver, 2Captcha) avec hook clair.

**Outil** :
```ts
solve_challenge({
  tab_id,
  strategy: "wait_passive" | "external_solver",
  solver_api_key?: string,
  timeout_ms?: number
})
```
Honnêtement signaler dans la doc que `external_solver` est payant et hors open-source. Ne pas réimplémenter de solveur visuel maison (sera caduc dans 3 mois).

**Effort** : 3-4 jours.

#### 🟡 P1.8 — Pool de profils & sticky-vs-rotate par intent

**Pourquoi** : un agent qui scrappe 100 produits sur Amazon doit rester sticky (même session, même IP) ; un agent qui googleise 100 requêtes différentes doit tourner. Aujourd'hui `camofox-mcp` ne distingue pas ces deux modes.

**Outil** :
```ts
create_tab({
  user_id, url,
  profile_strategy: "fresh" | "sticky" | "pooled",
  pool_name?: string,  // pour pooled : pioche dans un pool nommé
  preset?
})
```

**Effort** : 1 semaine, demande de revoir la persistance dans `camofox-browser`.

---

### 4.3 Tools agent — Quick wins

#### 🟢 P2.1 — Set-of-Marks intégré au `screenshot`

**Pourquoi** : le SoM est prouvé (Yang et al. 2023, arXiv 2310.11441 ; WebVoyager He et al. 2024). Le coût est ~5-10k tokens d'image en plus, mais sur formulaires complexes la précision passe de ~70% à ~94% (mesure ScreenSpot d'OmniParser, https://www.microsoft.com/en-us/research/articles/omniparser-v2-turning-any-llm-into-a-computer-use-agent/).

**Outil modifié** :
```ts
screenshot({
  tab_id,
  annotated?: boolean,   // overlay refs eN
  marks_filter?: "interactive" | "all" | "viewport"
}) -> {image_b64, marks_map: {e1: {role, name, bbox}}}
```
Implémentation : réutiliser le `buildDomTree.js` existant pour extraire les bbox, dessiner via Canvas ou Playwright `page.evaluate` puis screenshot. Pas besoin d'OmniParser pour les pages "DOM-friendly".

**Effort** : 4-5 jours.
**Latence** : +300-800ms par screenshot annoté.

#### 🟢 P2.2 — Primitive `extract(query, schema)`

**Pourquoi** : c'est la primitive Stagehand par excellence. Elle factorise le pattern "snapshot → parse → valider Zod" dans tous les agents Hermes/Claude/Cursor qui utilisent le serveur. Réduit drastiquement les tours.

**Outil** :
```ts
extract({
  tab_id,
  query: string,             // "extraire le titre, prix et description"
  schema: JsonSchema,        // schema Zod/JSON
  scope?: "viewport" | "page" | {ref: string},
  use_vision?: boolean       // ajoute screenshot annoté si true
}) -> {data: T, confidence: number}
```
Insère un appel LLM (paramétré par le client : Claude / GPT / Gemini / OpenRouter) côté serveur. **Choix d'architecture** : laisser le client passer son LLM via paramètre (ou via un endpoint sampling MCP, https://modelcontextprotocol.io/docs/concepts/sampling) plutôt que de hard-coder un provider. Hermes Agent gère déjà ce routing.

**Coût** : 1 appel LLM additionnel par extraction. Sur Sonnet 4.5 c'est ~$0.005-0.02. Largement compensé par le gain en tokens vs envoi du DOM brut au LLM principal.

**Effort** : 1 semaine.

#### 🟢 P2.3 — Primitive `observe()`

**Pourquoi** : Stagehand `observe()` retourne une liste d'actions exécutables suggérées (`{action, ref, description}`). C'est utilisé pour le "preview avant exécution" et pour cache invalidation. Réduit l'erreur de grounding.

**Outil** :
```ts
observe({tab_id, intent?: string}) -> Array<{
  action: "click" | "fill" | "select",
  ref: string,
  description: string,
  confidence: number
}>
```
Si `intent` fourni, un appel LLM léger filtre/range les candidats. Sans `intent`, retourne juste les top-N éléments interactifs.

**Effort** : 4-5 jours.

#### 🟢 P2.4 — Cap de tokens / chunking sur `snapshot`

**Pourquoi** : pages longues (Amazon catalogue, GitHub repo browser) explosent le contexte. Playwright MCP `--output-mode=file` (https://dev.to/kuroko1t/how-accessibility-tree-formatting-affects-token-cost-in-browser-mcps-n2a) sauve sur disque ; c'est complémentaire d'un cap de tokens.

**Outil modifié** :
```ts
snapshot({
  tab_id,
  max_tokens?: number,        // tronque ou pagine
  format?: "compact" | "full",
  output_mode?: "inline" | "file",
  filter?: "interactive_only" | "all" | {role: string[]},
  viewport_only?: boolean
}) -> {refs: ..., truncated: bool, file_path?}
```
Option `interactive_only` reproduit le mode Vercel agent-browser à 200-400 tokens (https://paddo.dev/blog/agent-browser-context-efficiency/).

**Effort** : 3-4 jours.

#### 🟢 P2.5 — Détection des éléments interactifs JS (CDP `getEventListeners`)

**Pourquoi** : browser-use note que beaucoup de `<div>` cliquables modernes (React/Vue) n'ont pas de role ARIA mais ont des handlers JS. CDP `getEventListeners` permet de les indexer (https://deepwiki.com/browser-use/browser-use/5.3-interactive-element-detection ; issue #832 https://github.com/browser-use/browser-use/issues/832). En Firefox/Camoufox, le protocole équivalent est Juggler — il faut vérifier l'API exposée.

**Effort** : 1 semaine (selon support Juggler).

---

### 4.4 Tools agent — Structurel

#### 🟡 P2.6 — Cache d'actions déterministes (à la Stagehand)

**Pourquoi** : Stagehand cache les actions LLM-discovered et les rejoue en CDP brut → 10-100× speedup, zéro tokens (https://deepwiki.com/browserbase/stagehand). Sur des flows répétitifs (login Amazon, recherche eBay), c'est un game-changer économique.

**Implémentation** :
- Hash (URL + DOM signature + intent) → action(s) à rejouer
- Stocker dans `~/.camofox-mcp/action-cache/`
- Self-healing : si le rejeu échoue, retomber sur LLM, re-cacher

**Outil** :
```ts
act({
  intent: string,
  cache?: boolean,    // default true
  cache_namespace?: string
})
```

**Effort** : 2 semaines.

#### 🟡 P2.7 — Vision grounding optionnel via OmniParser v2

**Pourquoi** : pour les pages Canvas-heavy, Shadow DOM fermés, iframes opaques, l'a11y tree échoue. OmniParser v2 (Microsoft, AGPL+MIT, https://github.com/microsoft/OmniParser) parse pixel→structured en ~5s sur GPU T4.

**Architecture** : déployer OmniParser comme service HTTP optionnel séparé (Docker, GPU local ou Replicate). Ajouter un mode :
```ts
snapshot({tab_id, mode: "dom" | "vision" | "hybrid"})
```
En `hybrid`, fusionner les bbox a11y + bbox OmniParser, dédupliquer.

**Effort** : 2 semaines + dépendance GPU.
**Coût** : ~$0.001/screenshot sur Replicate (https://replicate.com/microsoft/omniparser-v2), gratuit en local GPU.
**Trade-off honnête** : à activer uniquement quand `mode=dom` échoue, pas par défaut.

#### 🟡 P2.8 — Refactor en 5 outils sémantiques + alias bas-niveau

**Pourquoi** : Vercel a montré qu'un outillage "wide" coûte 13-17k tokens de définitions / tour (https://medium.com/@serkan_ozal/browser-devtools-mcp-78-fewer-tokens-vs-playwright-mcp-faster-and-more-consistent-32f314004d30). Sur 35 outils, à ~150 tokens/définition c'est ~5k tokens/tour. Refactor possible :

**Outils principaux exposés par défaut** :
- `navigate`
- `act(intent | ref, action_type)` — couvre click, type, select
- `extract(query, schema)`
- `observe(intent?)`
- `snapshot(options)`
- `screenshot(options)`
- `wait(condition)`
- `verify_fingerprint`
- `detect_challenge`

**Outils bas-niveau** disponibles via `--mode=full` ou MCP capability flag, pas chargés par défaut. Garder rétrocompatibilité avec les 35 outils existants pour ne pas casser les utilisateurs actuels.

**Effort** : 1-2 semaines (essentiellement de l'organisation + tests).

#### 🟡 P2.9 — Outil `execute(plan)` batch

**Pourquoi** : Browser DevTools MCP réduit de 78% les tokens en permettant à l'agent d'envoyer un plan de N actions en une seule fois. Réduit les round-trips et la latence.

**Outil** :
```ts
execute({
  tab_id,
  plan: Array<Action>,
  stop_on_error?: boolean,
  return_intermediate_snapshots?: boolean
}) -> Array<Result>
```

**Effort** : 1 semaine.

---

### 4.5 Long terme

#### 🔴 P3.1 — Apprentissage par renforcement / fingerprint-hardening

Les WAF mettent à jour leurs heuristiques en quelques semaines. Une boucle continue (canary jobs sur sites cibles, métriques de blocage, retraining BrowserForge) serait précieuse. Hors budget open-source typique mais à garder en tête.

#### 🔴 P3.2 — Hybrid agent pure-vision + DOM-augmented

Magnitude prouve qu'avec Sonnet 4 grounded, le pure-vision dépasse le DOM (94% vs 89% browser-use). Exposer un mode `agent_mode: "dom" | "vision_first" | "hybrid"` avec routage selon le type de page. Demande de l'éval approfondie.

#### 🔴 P3.3 — Replay/training trajectories

Hermes Agent collecte déjà des trajectoires ShareGPT pour entraînement (https://github.com/mudrii/hermes-agent-docs). `camofox-mcp` pourrait fournir un mode `record` pour générer des datasets d'agents navigateurs anti-bot — précieux pour la communauté de recherche.

---

### 4.6 Récap priorisé

| # | Proposition | Catégorie | Impact | Effort | Latence | Coût LLM ajouté |
|---|---|---|---|---|---|---|
| P1.1 | Souris Ghost Cursor | anti-bot | ⭐⭐⭐ | 🟢 | +100-300ms | 0 |
| P1.2 | Frappe humaine | anti-bot | ⭐⭐⭐ | 🟢 | variable | 0 |
| P1.3 | `verify_fingerprint` | anti-bot | ⭐⭐ | 🟢 | 5-15s on-demand | 0 |
| P1.4 | `detect_challenge` | anti-bot | ⭐⭐ | 🟢 | <100ms | 0 |
| P1.5 | `rotate_fingerprint` | anti-bot | ⭐⭐ | 🟢 | 2-5s | 0 |
| P2.1 | Set-of-Marks intégré | tools | ⭐⭐⭐ | 🟢 | +300-800ms | 0 (envoi vers LLM principal) |
| P2.2 | `extract(query, schema)` | tools | ⭐⭐⭐ | 🟢 | +1 tour LLM | 1 appel/extract |
| P2.3 | `observe(intent?)` | tools | ⭐⭐ | 🟢 | +1 tour si intent | 0-1 appel |
| P2.4 | Snapshot capping/chunking | tools | ⭐⭐⭐ | 🟢 | nul | 0 |
| P2.5 | Détection JS handlers (CDP) | tools | ⭐⭐ | 🟡 | +20-50ms snapshot | 0 |
| P1.6 | curl_cffi backend | anti-bot | ⭐⭐ | 🟡 | -90% sur API | 0 |
| P1.7 | Solveur Turnstile passif | anti-bot | ⭐⭐ | 🟡 | 3-10s | externe payant optionnel |
| P1.8 | Pool de profils | anti-bot | ⭐⭐ | 🟡 | nul | 0 |
| P2.6 | Cache d'actions | tools | ⭐⭐⭐ | 🟡 | -50-90% sur replays | 0 sur cache hit |
| P2.7 | OmniParser v2 hybrid | tools | ⭐⭐ | 🟡 | +5s GPU | optionnel |
| P2.8 | Refactor sémantique 5+alias | tools | ⭐⭐ | 🟡 | -5k tokens/tour | 0 |
| P2.9 | `execute(plan)` batch | tools | ⭐⭐ | 🟡 | -50% round-trips | 0 |

**Plan de bataille suggéré (3 mois)** :
- **Sprint 1 (semaine 1-2)** : P1.1, P1.2, P1.4, P2.4 — sécurise immédiatement la furtivité et le budget tokens.
- **Sprint 2 (semaine 3-5)** : P2.1, P2.2, P2.3 — modernise l'API agent au standard 2026.
- **Sprint 3 (semaine 6-8)** : P1.3, P1.5, P1.8, P2.5 — solidifie la rotation et la détection.
- **Sprint 4 (semaine 9-12)** : P2.6, P2.8, P2.9, P1.6 — perf et économie de tokens.

---

## Partie 5 — Annexes pratiques

### 5.1 Signatures cibles (style MCP / Python pseudo-code)

```python
# Primitives sémantiques (P2.2, P2.3, P2.8)
def observe(tab_id: str, intent: Optional[str] = None) -> List[Suggestion]: ...
def act(tab_id: str, intent_or_ref: Union[str, ElementRef], action: Optional[ActionType] = None) -> ActResult: ...
def extract(tab_id: str, query: str, schema: dict, use_vision: bool = False) -> ExtractResult: ...

# Snapshots optimisés (P2.1, P2.4, P2.5)
def snapshot(tab_id, max_tokens=4000, mode="dom", filter="interactive_only", output_mode="inline") -> Snapshot: ...
def screenshot(tab_id, annotated=False, marks_filter="interactive") -> Image: ...

# Anti-bot (P1.1-P1.8)
def click(ref, human_motion="ghost", hesitation_ms=None): ...
def type_text(ref, text, cadence="human", typo_rate=0.02): ...
def verify_fingerprint(tab_id, target="creepjs") -> FingerprintReport: ...
def detect_challenge(tab_id) -> ChallengeInfo: ...
def rotate_fingerprint(tab_id, preserve_cookies=False): ...
def http_request(method, url, impersonate="auto_match_tab", ...) -> HttpResponse: ...

# Batch (P2.9)
def execute(tab_id, plan: list[Action], stop_on_error=True) -> list[Result]: ...
```

### 5.2 Décisions à prendre par l'auteur

1. **Modèle LLM côté serveur ou côté client ?** Pour `extract` et `observe(intent)`, soit on délègue au client via MCP sampling (https://modelcontextprotocol.io/docs/concepts/sampling) — pur, économe — soit on prend en charge un client LLM côté serveur (cohérent avec le pattern Hermes Tool Gateway). Recommandation : **MCP sampling d'abord**, fallback config locale.
2. **OmniParser self-host ou Replicate API ?** Replicate pour la simplicité (~$0.001/img), self-host GPU pour le volume / privacy.
3. **Garder les 35 outils ?** Oui pour rétrocompatibilité, mais ajouter un mode `--profile=lean` qui n'expose que les 9 sémantiques.

### 5.3 Honnêteté sur les limites

- **Aucune solution open-source ne bypasse Kasada ou F5 Shape de manière fiable en 2026.** Recommander aux utilisateurs de rester réalistes sur le périmètre.
- **Camoufox est en bêta après un trou de maintenance.** Dépendre de lui implique d'avoir un plan B (Patchright + Nodriver) en standby.
- **Les trajectoires Bezier/Ghost Cursor sont détectables par classifieurs ML profonds** (DMTG paper). Suffisant pour 2026, à surveiller.
- **Le SoM ajoute de la latence et des tokens d'image**, ne pas l'activer par défaut sur petites pages.
- **Le cache d'actions est fragile** sur sites qui changent de DOM ; la self-healing à la Stagehand est nécessaire mais imparfaite.
- **Computer Use d'Anthropic reste expérimental** (OSWorld 14,9%) — ne pas s'inspirer de son paradigme coordonnées-pures pour un agent navigateur de production en 2026 ; l'a11y tree + SoM optionnel reste plus performant.

---

## Sources principales (URLs vérifiées dans la recherche)

- `redf0x1/camofox-mcp` — README, package npm, listing PulseMCP : https://github.com/redf0x1/camofox-mcp ; https://www.npmjs.com/package/camofox-mcp ; https://www.pulsemcp.com/servers/redf0x1-camofox
- `redf0x1/camofox-browser` et fork upstream `jo-inc/camofox-browser` : https://github.com/redf0x1/camofox-browser ; https://github.com/jo-inc/camofox-browser
- Camoufox : https://github.com/daijro/camoufox ; https://camoufox.com/ ; https://deepwiki.com/daijro/camoufox ; https://www.proxies.sx/blog/ai-browser-automation-camoufox-nodriver-2026 ; https://roundproxies.com/blog/camoufox/
- Cloudflare Turnstile / DataDome : https://developers.cloudflare.com/turnstile/ ; https://www.tapscape.com/cloudflare-turnstile-bypass-2026-the-core-level-stealth-guide/ ; https://scrapfly.io/bypass/cloudflare ; https://scrapfly.io/blog/posts/how-to-bypass-cloudflare-turnstile ; https://kameleo.io/blog/guide-to-bypassing-datadome
- TLS / curl-impersonate : https://github.com/lexiforest/curl_cffi ; https://curl-cffi.readthedocs.io/en/latest/impersonate/customize.html ; https://scrapfly.io/web-scraping-tools/ja3-fingerprint
- Patchright / Nodriver : https://github.com/Kaliiiiiiiiii-Vinyzu/patchright ; https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-python ; https://roundproxies.com/blog/best-patchright-alternatives/ ; https://www.zenrows.com/blog/undetected-chromedriver-alternatives
- Souris : https://github.com/Xetera/ghost-cursor ; https://deepwiki.com/Xetera/ghost-cursor ; https://arxiv.org/html/2410.18233v1 ; https://substack.thewebscraping.club/p/bypass-datadome-mouse-movements-in-playwright
- Set-of-Marks : Yang et al., arXiv 2310.11441 https://arxiv.org/abs/2310.11441 ; https://github.com/microsoft/SoM
- WebVoyager : He et al., ACL 2024 https://aclanthology.org/2024.acl-long.371/ ; https://arxiv.org/abs/2401.13919 ; https://github.com/sagekit/webvoyager
- OmniParser v2 : Lu et al., arXiv 2408.00203 ; https://www.microsoft.com/en-us/research/articles/omniparser-v2-turning-any-llm-into-a-computer-use-agent/ ; https://github.com/microsoft/OmniParser ; https://huggingface.co/microsoft/OmniParser-v2.0
- Browser-use : https://github.com/browser-use/browser-use ; https://browser-use.com/posts/sota-technical-report ; https://deepwiki.com/browser-use/browser-use/5.3-interactive-element-detection
- Stagehand / Browserbase : https://github.com/browserbase/stagehand ; https://www.browserbase.com/blog/ai-web-agent-sdk ; https://deepwiki.com/browserbase/stagehand
- Token efficiency : https://paddo.dev/blog/agent-browser-context-efficiency/ ; https://dev.to/chen_zhang_bac430bc7f6b95/why-vercels-agent-browser-is-winning-the-token-efficiency-war-for-ai-browser-automation-4p87 ; https://medium.com/@serkan_ozal/browser-devtools-mcp-78-fewer-tokens-vs-playwright-mcp-faster-and-more-consistent-32f314004d30 ; https://playwright.dev/mcp/introduction
- Anthropic Computer Use : https://www.anthropic.com/news/3-5-models-and-computer-use ; https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool ; https://simonwillison.net/2024/Oct/22/computer-use/
- Magnitude : https://github.com/magnitudedev/browser-agent ; https://github.com/sagekit/webvoyager
- Hermes Agent : https://hermes-agent.nousresearch.com/ ; https://github.com/nousresearch/hermes-agent ; https://docs.browser-use.com/cloud/tutorials/integrations/hermes-agent ; https://github.com/mudrii/hermes-agent-docs