# Intention + Smart Search + UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar campo `intention` a metadata de prompts, implementar búsqueda inteligente con sugerencias, y rediseñar la UI de búsqueda.

**Architecture:** El campo `intention` se almacenará en `attributes.image.intention` siguiendo el patrón existente. La búsqueda inteligente usa scoring ponderado multi-campo en el servidor. La UI se rediseña con filtros collapsables, pills de intención, y dropdown de sugerencias.

**Tech Stack:** Node.js/Express (server.js), PostgreSQL (jsonb queries), HTML5/Tailwind/vanilla JS (frontend)

---

## File Structure

| File | Responsibility |
|------|----------------|
| `server.js` | Endpoint `/api/prompts/suggest` con búsqueda inteligente |
| `public/index.html` | System prompt actualizado, UI de búsqueda rediseñada, badges de intención |

---

## Task 1: Update System Prompt for Intention Extraction

**Files:**
- Modify: `public/index.html:1218-1310` (systemPrompt variable)

**Context:** The system prompt needs a new `intention` field in `attributes.image` with mandatory extraction and examples.

- [ ] **Step 1: Locate system prompt and add intention field**

Find the section around line 1290 (after `"post_processing"` block and before the closing `}` of `attributes.image`). Add the intention field:

```javascript
// AFTER line 1302 (after "post_processing" block), add:
"intention": "create | modify | improve | restyle | restore | adapt",
"intention_confidence": 0.9
```

- [ ] **Step 2: Add intention examples section**

After the JSON STRUCTURE block (around line 1307, before `PROMPT TO ANALYZE:`), add:

```javascript
INTENTION EXAMPLES:
- "Create a cinematic portrait of a woman in a forest" → intention: "create", intention_confidence: 0.95
- "Add dramatic lighting to this portrait" → intention: "modify", intention_confidence: 0.88
- "Enhance the colors and reduce grain" → intention: "improve", intention_confidence: 0.92
- "Give this photo a vintage 1970s aesthetic" → intention: "restyle", intention_confidence: 0.90
- "Make this portrait look like aged film from the 1950s" → intention: "restore", intention_confidence: 0.85
- "Convert this horizontal image to vertical for Instagram" → intention: "adapt", intention_confidence: 0.93

INTENTION RULES:
- "intention" is mandatory. Infer from action verbs: create/make/generate → create; add/change/modify → modify; enhance/improve/refine → improve; style/aesthetic/look like → restyle; age/deteriorate/worn → restore; convert/resize/reformat → adapt
- If ambiguous, set to null and intention_confidence to 0.3
- "intention_confidence" reflects certainty (0.0-1.0)
```

- [ ] **Step 3: Update confidence badge logic to include intention**

Around line 1395-1401, the confidence badge code uses `confidence` from metadata. No changes needed there since we extract `confidence` at root level.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: add intention extraction to AI metadata system prompt"
```

---

## Task 2: Create `/api/prompts/suggest` Endpoint

**Files:**
- Modify: `server.js:113` (after GET /api/prompts endpoint)

**Context:** This endpoint receives a search query and returns up to 6 related prompts using weighted scoring.

- [ ] **Step 1: Add suggest endpoint after GET /api/prompts (line 112)**

```javascript
// GET suggest - intelligent search with weighted scoring
app.get('/api/prompts/suggest', async (req, res) => {
  const { q, limit = 6 } = req.query;
  if (!q || q.trim().length < 2) {
    return res.json({ suggestions: [] });
  }

  const query = q.trim().toLowerCase();
  const intentionMap = {
    'crear': 'create', 'generar': 'create', 'nuevo': 'create', 'new': 'create',
    'modificar': 'modify', 'cambiar': 'modify', 'añadir': 'modify', 'add': 'modify',
    'mejorar': 'improve', 'enhance': 'improve', 'refinar': 'improve',
    'estilo': 'restyle', 'aesthetic': 'restyle', 'vintage': 'restyle', 'cyberpunk': 'restyle',
    'vieja': 'restore', 'aging': 'restore', 'deteriorar': 'restore', 'old': 'restore',
    'adaptar': 'adapt', 'convertir': 'adapt', 'formato': 'adapt', 'resize': 'adapt'
  };

  let targetIntention = null;
  for (const [keyword, intention] of Object.entries(intentionMap)) {
    if (query.includes(keyword)) {
      targetIntention = intention;
      break;
    }
  }

  try {
    let results = await pool.query(`
      SELECT id, title, description, content, type, subtype, tags, attributes, confidence, favorite
      FROM prompts
      WHERE ($1 = 'uncategorized' OR type != 'uncategorized')
      ORDER BY usage_count DESC, created DESC
      LIMIT 100
    `, [query]);

    const scored = results.rows.map(prompt => {
      let score = 0;
      let reason = 'text_match';

      // Title/description match (weight 1)
      const titleMatch = (prompt.title || '').toLowerCase().includes(query);
      const descMatch = (prompt.description || '').toLowerCase().includes(query);
      if (titleMatch) score += 2;
      if (descMatch) score += 1;

      // Content match (weight 0.5)
      if ((prompt.content || '').toLowerCase().includes(query)) {
        score += 0.5;
      }

      // Tags match (weight 2)
      const tags = prompt.tags || [];
      const tagMatches = tags.filter(t => query.includes(t.toLowerCase())).length;
      score += tagMatches * 2;

      // Type/subtype match (weight 2)
      if ((prompt.type || '').toLowerCase().includes(query)) score += 2;
      if ((prompt.subtype || '').toLowerCase().includes(query)) score += 1;

      // Intention match (weight 3) - boosted if keyword detected
      const promptIntention = prompt.attributes?.image?.intention;
      if (targetIntention && promptIntention === targetIntention) {
        score += 6; // Double weight when explicit intention keyword in query
        reason = 'intention_match';
      } else if (promptIntention && query.includes(promptIntention)) {
        score += 3;
        reason = 'intention_hint';
      }

      // Favorite boost
      if (prompt.favorite) score += 0.5;

      return { ...prompt, _score: score, _reason: reason };
    });

    results = scored
      .filter(r => r._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, parseInt(limit));

    const suggestions = results.map(r => ({
      id: r.id,
      title: r.title || r.content.substring(0, 40) + '...',
      description: r.description || '',
      type: r.type,
      subtype: r.subtype,
      intention: r.attributes?.image?.intention || null,
      score: r._score,
      reason: r._reason,
      favorite: r.favorite
    }));

    res.json({ suggestions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Test the endpoint manually**

Run: `curl "http://localhost:3000/api/prompts/suggest?q=crear%20portrait"`
Expected: JSON with `suggestions` array (may be empty if no prompts match)

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add /api/prompts/suggest endpoint with intelligent scoring"
```

---

## Task 3: Update Frontend - Show Intention Badge

**Files:**
- Modify: `public/index.html:1988-2010` (renderPrompts function)
- Modify: `public/index.html:1403-1410` (attributes display in modal)

**Context:** Need to display intention badge on prompt cards and in the detail view.

- [ ] **Step 1: Find renderPrompts and add intention badge to card**

In the prompt card HTML (around line 1991-2010), add intention badge after the type badge:

```javascript
// Add intention badge in card - after type pill display
// Find where category pill is rendered and add intention badge after
const intentionBadge = prompt.attributes?.image?.intention
  ? `<span class="px-2 py-1 rounded-md text-xs font-medium ${getIntentionColor(prompt.attributes.image.intention)}">${prompt.attributes.image.intention}</span>`
  : '';
```

Add helper function for color:

```javascript
function getIntentionColor(intention) {
  const colors = {
    'create': 'bg-emerald-500/20 text-emerald-400',
    'modify': 'bg-amber-500/20 text-amber-400',
    'improve': 'bg-cyan-500/20 text-cyan-400',
    'restyle': 'bg-purple-500/20 text-purple-400',
    'restore': 'bg-orange-500/20 text-orange-400',
    'adapt': 'bg-pink-500/20 text-pink-400'
  };
  return colors[intention] || 'bg-gray-500/20 text-gray-400';
}
```

- [ ] **Step 2: Add intention display in modal view (around line 480)**

In the view modal, add intention badge after subtype:

```javascript
// After view-subtype span (line 480), add:
<span id="view-intention" class="px-2 py-1 rounded-md text-xs font-medium hidden"></span>
```

- [ ] **Step 3: Update viewPrompt function to show intention**

Find `function viewPrompt(id)` and add intention display logic when populating the view modal.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: display intention badge on prompt cards and detail view"
```

---

## Task 4: Redesign Search UI - Collapsible Filters + Intention Pills

**Files:**
- Modify: `public/index.html:146-204` (filters section)
- Modify: `public/index.html:724-730` (currentFilter object)

**Context:** Replace the always-visible atomic filters with a collapsible accordion and add intention pills.

- [ ] **Step 1: Replace filter section with collapsible version**

Replace lines 147-190 (the grid of atomic filters) with:

```html
<!-- Collapsible Filters Toggle -->
<div class="flex items-center justify-between mb-3">
  <button onclick="toggleFilters()" id="filters-toggle-btn"
    class="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 transition-colors">
    <svg class="w-4 h-4 transition-transform" id="filters-toggle-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
    </svg>
    <span>Filtros avanzados</span>
    <span id="active-filters-count" class="hidden px-1.5 py-0.5 rounded-full bg-accent-cyan/20 text-accent-cyan text-xs font-medium"></span>
  </button>
  <button onclick="clearAllFilters()" class="text-xs text-gray-500 hover:text-gray-300">Limpiar</button>
</div>

<!-- Collapsible Filters Panel -->
<div id="filters-panel" class="hidden mb-4">
  <div class="grid grid-cols-2 gap-2">
    <select id="filter-angle" onchange="applyAtomicFilter('camera_angle', this.value)" class="bg-dark-800 border border-dark-700 rounded-xl px-3 py-2 text-sm text-gray-300 focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan">
      <option value="">Ángulo</option>
      <option value="eye_level">Eye Level</option>
      <option value="low_angle">Low Angle</option>
      <option value="high_angle">High Angle</option>
      <option value="dutch_angle">Dutch Angle</option>
      <option value="birds_eye">Bird's Eye</option>
      <option value="worms_eye">Worm's Eye</option>
    </select>
    <select id="filter-timeofday" onchange="applyAtomicFilter('time_of_day', this.value)" class="bg-dark-800 border border-dark-700 rounded-xl px-3 py-2 text-sm text-gray-300 focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan">
      <option value="">Hora del día</option>
      <option value="morning">Morning</option>
      <option value="afternoon">Afternoon</option>
      <option value="golden_hour">Golden Hour</option>
      <option value="sunset">Sunset</option>
      <option value="blue_hour">Blue Hour</option>
      <option value="night">Night</option>
    </select>
    <select id="filter-location" onchange="applyAtomicFilter('location', this.value)" class="bg-dark-800 border border-dark-700 rounded-xl px-3 py-2 text-sm text-gray-300 focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan">
      <option value="">Ubicación</option>
      <option value="indoor">Indoor</option>
      <option value="outdoor">Outdoor</option>
      <option value="studio">Studio</option>
    </select>
    <select id="filter-lighting" onchange="applyAtomicFilter('lighting_source', this.value)" class="bg-dark-800 border border-dark-700 rounded-xl px-3 py-2 text-sm text-gray-300 focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan">
      <option value="">Iluminación</option>
      <option value="natural_sun">Natural Sun</option>
      <option value="artificial">Artificial</option>
      <option value="mixed">Mixed</option>
    </select>
  </div>
</div>
```

- [ ] **Step 2: Add intention pills after category pills (after line 200)**

```html
<!-- Intention Pills -->
<div class="flex gap-2 overflow-x-auto hide-scrollbar pb-2" id="intention-filters">
  <button onclick="filterByIntention('create')" class="intention-pill px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-medium whitespace-nowrap" data-intention="create">+ Crear</button>
  <button onclick="filterByIntention('modify')" class="intention-pill px-3 py-1.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-medium whitespace-nowrap" data-intention="modify">+ Modificar</button>
  <button onclick="filterByIntention('improve')" class="intention-pill px-3 py-1.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-xs font-medium whitespace-nowrap" data-intention="improve">+ Mejorar</button>
  <button onclick="filterByIntention('restyle')" class="intention-pill px-3 py-1.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 text-xs font-medium whitespace-nowrap" data-intention="restyle">+ Estilo</button>
  <button onclick="filterByIntention('restore')" class="intention-pill px-3 py-1.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20 text-xs font-medium whitespace-nowrap" data-intention="restore">+ Restaurar</button>
  <button onclick="filterByIntention('adapt')" class="intention-pill px-3 py-1.5 rounded-full bg-pink-500/10 text-pink-400 border border-pink-500/20 text-xs font-medium whitespace-nowrap" data-intention="adapt">+ Adaptar</button>
</div>
```

- [ ] **Step 3: Update currentFilter object (around line 724) to include intention**

```javascript
let currentFilter = { category: 'all', subcategory: null, tag: null, search: '', camera_angle: '', time_of_day: '', location: '', lighting_source: '', intention: null };
```

- [ ] **Step 4: Add toggleFilters and filterByIntention functions**

Add these functions to the JavaScript section:

```javascript
function toggleFilters() {
  const panel = document.getElementById('filters-panel');
  const icon = document.getElementById('filters-toggle-icon');
  panel.classList.toggle('hidden');
  icon.style.transform = panel.classList.contains('hidden') ? '' : 'rotate(180deg)';
}

function filterByIntention(intention) {
  const pills = document.querySelectorAll('.intention-pill');
  if (currentFilter.intention === intention) {
    currentFilter.intention = null;
    pills.forEach(p => p.classList.remove('active-filter'));
  } else {
    currentFilter.intention = intention;
    pills.forEach(p => {
      if (p.dataset.intention === intention) {
        p.classList.add('active-filter');
      } else {
        p.classList.remove('active-filter');
      }
    });
  }
  applyFiltersAndRender();
}
```

- [ ] **Step 5: Add active-filter style for intention pills**

Add to the CSS section (around line 86):

```css
.intention-pill.active-filter {
  background-color: rgba(255,255,255,0.15);
  border-color: rgba(255,255,255,0.3);
}
```

- [ ] **Step 6: Update applyFiltersAndRender to include intention filter**

Find `applyFiltersAndRender` or create it to filter by intention:

```javascript
function applyFiltersAndRender() {
  const filtered = allPrompts.filter(p => {
    if (currentFilter.category === 'favorites' && !p.favorite) return false;
    if (currentFilter.category !== 'all' && currentFilter.category !== 'favorites' && p.type !== currentFilter.category) return false;
    if (currentFilter.intention && p.attributes?.image?.intention !== currentFilter.intention) return false;
    return true;
  });
  renderPromptsList(filtered);
}
```

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: add collapsible filters and intention pills to search UI"
```

---

## Task 5: Add Smart Suggestions Dropdown in Search

**Files:**
- Modify: `public/index.html:148-156` (search input area)
- Add: JavaScript for suggestions (handleSearch update)

**Context:** When user types in search, show a dropdown with up to 4 intelligent suggestions.

- [ ] **Step 1: Add suggestions dropdown HTML after search input (line 156)**

```html
<!-- Suggestions Dropdown -->
<div id="suggestions-dropdown" class="hidden absolute z-50 left-0 right-0 mt-1 bg-dark-800 border border-dark-600 rounded-xl shadow-xl overflow-hidden">
  <div id="suggestions-list" class="max-h-64 overflow-y-auto"></div>
  <div id="suggestions-footer" class="hidden px-3 py-2 border-t border-dark-700 text-xs text-gray-500">
    Presiona <kbd class="px-1 py-0.5 rounded bg-dark-700 text-gray-300">ESC</kbd> para cerrar
  </div>
</div>
```

- [ ] **Step 2: Add debounced search with suggestions (replace handleSearch function)**

Replace the existing `handleSearch` function with:

```javascript
let searchTimeout;
let currentSuggestions = [];

function handleSearch(value) {
  clearTimeout(searchTimeout);
  const dropdown = document.getElementById('suggestions-dropdown');
  const list = document.getElementById('suggestions-list');

  if (value.trim().length < 2) {
    dropdown.classList.add('hidden');
    currentFilter.search = '';
    applyFiltersAndRender();
    return;
  }

  currentFilter.search = value;
  dropdown.classList.add('hidden');

  searchTimeout = setTimeout(async () => {
    try {
      const resp = await fetch(`/api/prompts/suggest?q=${encodeURIComponent(value)}&limit=4`);
      const data = await resp.json();
      currentSuggestions = data.suggestions || [];

      if (currentSuggestions.length === 0) {
        dropdown.classList.add('hidden');
        applyFiltersAndRender();
        return;
      }

      list.innerHTML = currentSuggestions.map(s => `
        <div onclick="selectSuggestion('${s.id}')" class="flex items-center gap-3 px-4 py-3 hover:bg-dark-700 cursor-pointer border-b border-dark-700 last:border-0 transition-colors">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-gray-200 truncate">${s.title || 'Sin título'}</span>
              ${s.intention ? `<span class="px-1.5 py-0.5 rounded text-xs ${getIntentionColor(s.intention)}">${s.intention}</span>` : ''}
            </div>
            ${s.description ? `<p class="text-xs text-gray-500 truncate mt-0.5">${s.description}</p>` : ''}
          </div>
          <span class="text-xs text-gray-600">${s.reason === 'intention_match' ? '🧠' : '📝'}</span>
        </div>
      `).join('');

      document.getElementById('suggestions-footer').classList.remove('hidden');
      dropdown.classList.remove('hidden');
      applyFiltersAndRender();
    } catch (err) {
      console.error('Suggestions error:', err);
      dropdown.classList.add('hidden');
      applyFiltersAndRender();
    }
  }, 300);
}

function selectSuggestion(promptId) {
  document.getElementById('suggestions-dropdown').classList.add('hidden');
  currentSuggestions = [];
  viewPrompt(promptId);
}

// Close suggestions on ESC
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.getElementById('suggestions-dropdown').classList.add('hidden');
  }
});

// Close suggestions when clicking outside
document.addEventListener('click', e => {
  if (!e.target.closest('#search-input') && !e.target.closest('#suggestions-dropdown')) {
    document.getElementById('suggestions-dropdown').classList.add('hidden');
  }
});
```

- [ ] **Step 3: Update search input style for better visibility**

Update the search input (line 154) to add z-index:

```html
<input type="text" id="search-input" placeholder="Buscar por intención, tags, contenido..."
  class="w-full bg-dark-800 border border-dark-700 rounded-xl pl-11 pr-4 py-3 text-sm placeholder-gray-500 focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan transition-all relative z-10"
```

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: add smart suggestions dropdown in search"
```

---

## Task 6: Improve Prompt Cards Visual Design

**Files:**
- Modify: `public/index.html:1988-2020` (renderPrompts card styling)

**Context:** Update card design with softer borders, better shadows, and intention badges.

- [ ] **Step 1: Find and update prompt card HTML**

The card is around line 1991. Update to:

```javascript
const card = `
<div onclick="viewPrompt('${prompt.id}')" class="prompt-card bg-dark-800/80 rounded-2xl p-4 mb-3 border border-dark-700/50 cursor-pointer relative overflow-hidden backdrop-blur-sm hover:border-dark-600 hover:shadow-lg hover:shadow-black/20 hover:-translate-y-0.5 transition-all duration-200">
  ${prompt.attributes?.image?.intention ? `
  <div class="absolute top-3 right-3">
    <span class="px-2 py-1 rounded-md text-xs font-medium ${getIntentionColor(prompt.attributes.image.intention)}">${prompt.attributes.image.intention}</span>
  </div>` : ''}
  <div class="flex items-center gap-2 mb-2">
    <span class="px-2 py-1 rounded-lg bg-dark-700 text-gray-300 text-xs capitalize">${prompt.type}</span>
    ${prompt.subtype !== 'other' ? `<span class="text-xs text-gray-500">${prompt.subtype}</span>` : ''}
    ${prompt.favorite ? '<span class="ml-auto text-sm">❤️</span>' : ''}
  </div>
  <h3 class="text-base font-semibold text-gray-200 mb-1 pr-16">${prompt.title || 'Sin título'}</h3>
  ${prompt.description ? `<p class="text-sm text-gray-400 mb-2 line-clamp-2">${prompt.description}</p>` : ''}
  ${(prompt.tags || []).length > 0 ? `
  <div class="flex flex-wrap gap-1 mt-2">
    ${prompt.tags.slice(0, 4).map(t => `<span class="px-1.5 py-0.5 rounded bg-dark-700 text-gray-400 text-xs">${t}</span>`).join('')}
  </div>` : ''}
</div>
`;
```

- [ ] **Step 2: Update CSS for softer look**

Replace `.prompt-card` styles (around line 86) with:

```css
.prompt-card {
  transition: all 0.2s ease;
  backdrop-filter: blur(8px);
}
.prompt-card:hover {
  box-shadow: 0 8px 32px rgba(0,0,0,0.3);
}
.prompt-card:active {
  transform: scale(0.98);
}
```

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: improve prompt card visual design with softer styling"
```

---

## Task 7: Add Clear All Filters Function

**Files:**
- Modify: `public/index.html` (add clearAllFilters)

- [ ] **Step 1: Add clearAllFilters function**

Add after `filterByIntention`:

```javascript
function clearAllFilters() {
  currentFilter = { category: 'all', subcategory: null, tag: null, search: '', camera_angle: '', time_of_day: '', location: '', lighting_source: '', intention: null };

  // Reset UI elements
  document.getElementById('search-input').value = '';
  document.getElementById('filter-angle').value = '';
  document.getElementById('filter-timeofday').value = '';
  document.getElementById('filter-location').value = '';
  document.getElementById('filter-lighting').value = '';

  // Reset category pills
  document.querySelectorAll('.category-pill').forEach(p => {
    p.classList.remove('bg-accent-cyan/20', 'text-accent-cyan', 'border-accent-cyan/30');
    p.classList.add('bg-dark-700', 'text-gray-300', 'border-dark-600');
  });
  document.querySelector('[data-category="all"]').classList.add('bg-accent-cyan/20', 'text-accent-cyan', 'border-accent-cyan/30');
  document.querySelector('[data-category="all"]').classList.remove('bg-dark-700', 'text-gray-300', 'border-dark-600');

  // Reset intention pills
  document.querySelectorAll('.intention-pill').forEach(p => p.classList.remove('active-filter'));

  // Hide active filters display
  document.getElementById('active-filters').classList.add('hidden');
  document.getElementById('active-filters').innerHTML = '';

  // Hide suggestions
  document.getElementById('suggestions-dropdown').classList.add('hidden');

  // Reset filters panel
  document.getElementById('filters-panel').classList.add('hidden');

  applyFiltersAndRender();
}
```

- [ ] **Step 2: Update filter functions to show active filters count**

Update `applyAtomicFilter` to update the active filters count badge:

```javascript
function updateFiltersCount() {
  const count = Object.values(currentFilter).filter(v => v && v !== 'all').length;
  const badge = document.getElementById('active-filters-count');
  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}
```

Call `updateFiltersCount()` at the end of each filter function.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: add clear all filters functionality"
```

---

## Spec Coverage Check

- [x] System prompt updated with intention field
- [x] Intention examples added to system prompt
- [x] `/api/prompts/suggest` endpoint created with weighted scoring
- [x] Intention badge displayed on cards
- [x] Collapsible filters UI implemented
- [x] Intention pills added as quick filters
- [x] Suggestions dropdown with debounce
- [x] Improved card visual design
- [x] Clear all filters function

---

## Execution Options

**Plan saved to:** `docs/superpowers/plans/2026-05-02-intention-search-ui-plan.md`

**1. Subagent-Driven (recommended)** - Dispatch fresh subagent per task for fast parallel iteration

**2. Inline Execution** - Execute tasks sequentially in this session using executing-plans

Which approach?