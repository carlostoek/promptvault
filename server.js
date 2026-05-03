const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL connection (Railway sets DATABASE_URL automatically)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Create table if it doesn't exist
async function initDB() {
  // Crear tabla si no existe
  await pool.query(`
    CREATE TABLE IF NOT EXISTS prompts (
      id          TEXT PRIMARY KEY,
      title       TEXT,
      description TEXT,
      content     TEXT NOT NULL,
      type        TEXT    DEFAULT 'uncategorized',
      subtype     TEXT    DEFAULT 'other',
      tags        JSONB   DEFAULT '[]',
      confidence  REAL    DEFAULT 0.5,
      attributes  JSONB   DEFAULT '{}',
      favorite    BOOLEAN DEFAULT FALSE,
      image       TEXT,
      created     TIMESTAMPTZ DEFAULT NOW(),
      updated     TIMESTAMPTZ DEFAULT NOW(),
      usage_count INTEGER DEFAULT 0
    )
  `);

  // Índice GIN para búsquedas atómicas en attributes->image
  await pool.query(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prompts_attributes_image ON prompts USING GIN ((attributes -> 'image') jsonb_path_ops)
  `);

  // Agregar columna image si no existe (para tablas existentes)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'prompts' AND column_name = 'image') THEN
        ALTER TABLE prompts ADD COLUMN image TEXT;
      END IF;
    END $$
  `);

  // Crear tabla workflows si no existe
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workflows (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      created     TIMESTAMPTZ DEFAULT NOW(),
      updated     TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Crear tabla workflow_nodes si no existe
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workflow_nodes (
      workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      prompt_id   TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
      position    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (workflow_id, prompt_id)
    )
  `);

  // Crear índice para lookup rápido de prompts → workflows
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_workflow_nodes_prompt_id ON workflow_nodes(prompt_id)
  `);

  console.log('✅ DB ready');
}

// Aumentar límite para imágenes base64 (4MB)
app.use(express.json({ limit: '4mb' }));

// Serve the frontend from /public
app.use(express.static(path.join(__dirname, 'public')));

// ─── API ROUTES ───────────────────────────────────────────────────────────────

// GET all prompts (with pagination)
app.get('/api/prompts', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = parseInt(req.query.offset) || 0;

  try {
    const [result, countResult] = await Promise.all([
      pool.query('SELECT * FROM prompts ORDER BY created DESC LIMIT $1 OFFSET $2', [limit, offset]),
      pool.query('SELECT COUNT(*) FROM prompts')
    ]);
    const total = parseInt(countResult.rows[0].count);
    res.json({
      prompts: result.rows,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + result.rows.length < total
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

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
      ORDER BY usage_count DESC, created DESC
      LIMIT 100
    `);

    const scored = results.rows.map(prompt => {
      let score = 0;
      let reason = 'text_match';

      // Title/description match (weight 1) - spec: combined 1x
      const titleMatch = (prompt.title || '').toLowerCase().includes(query);
      const descMatch = (prompt.description || '').toLowerCase().includes(query);
      if (titleMatch || descMatch) score += 1;

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

// POST bulk import — must be BEFORE /:id routes
app.post('/api/prompts/bulk', async (req, res) => {
  const { prompts, merge } = req.body;
  if (!Array.isArray(prompts)) return res.status(400).json({ error: 'prompts must be an array' });
  try {
    if (!merge) await pool.query('DELETE FROM prompts');
    for (const p of prompts) {
      await pool.query(
        `INSERT INTO prompts
           (id, title, description, content, type, subtype, tags, confidence, attributes, favorite, image, created, updated, usage_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO NOTHING`,
        [
          p.id, p.title, p.description, p.content,
          p.type || 'uncategorized', p.subtype || 'other',
          JSON.stringify(p.tags || []),
          p.confidence || 0.5,
          JSON.stringify(p.attributes || {}),
          p.favorite || false,
          p.image || null,
          p.created || new Date().toISOString(),
          p.updated || new Date().toISOString(),
          p.usage_count || 0
        ]
      );
    }
    const result = await pool.query('SELECT * FROM prompts ORDER BY created DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST create prompt (upsert — safe for auto-save flow)
app.post('/api/prompts', async (req, res) => {
  const { id, title, description, content, type, subtype, tags, confidence, attributes, favorite, image, created, updated, usage_count } = req.body;
  if (!content) return res.status(400).json({ error: 'content is required' });
  try {
    const result = await pool.query(
      `INSERT INTO prompts
         (id, title, description, content, type, subtype, tags, confidence, attributes, favorite, image, created, updated, usage_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET
         title=EXCLUDED.title, description=EXCLUDED.description, content=EXCLUDED.content,
         type=EXCLUDED.type, subtype=EXCLUDED.subtype, tags=EXCLUDED.tags,
         confidence=EXCLUDED.confidence, attributes=EXCLUDED.attributes,
         favorite=EXCLUDED.favorite, image=EXCLUDED.image, updated=EXCLUDED.updated, usage_count=EXCLUDED.usage_count
       RETURNING *`,
      [
        id, title, description, content,
        type || 'uncategorized', subtype || 'other',
        JSON.stringify(tags || []),
        confidence || 0.5,
        JSON.stringify(attributes || {}),
        favorite || false,
        image || null,
        created || new Date().toISOString(),
        updated || new Date().toISOString(),
        usage_count || 0
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PUT update prompt
app.put('/api/prompts/:id', async (req, res) => {
  const { id } = req.params;
  const { title, description, content, type, subtype, tags, confidence, attributes, favorite, image, updated, usage_count } = req.body;
  try {
    const result = await pool.query(
      `UPDATE prompts
       SET title=$1, description=$2, content=$3, type=$4, subtype=$5,
           tags=$6, confidence=$7, attributes=$8, favorite=$9, image=$10, updated=$11, usage_count=$12
       WHERE id=$13 RETURNING *`,
      [
        title, description, content,
        type || 'uncategorized', subtype || 'other',
        JSON.stringify(tags || []),
        confidence, JSON.stringify(attributes || {}),
        favorite, image || null, updated || new Date().toISOString(),
        usage_count, id
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH toggle favorite
app.patch('/api/prompts/:id/favorite', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE prompts SET favorite = NOT favorite, updated = NOW() WHERE id=$1 RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH increment usage_count
app.patch('/api/prompts/:id/use', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE prompts SET usage_count = usage_count + 1, updated = NOW() WHERE id=$1 RETURNING *`,
      [id]
    );
    res.json(result.rows[0] || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE prompt
app.delete('/api/prompts/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM prompts WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── WORKFLOW ROUTES ─────────────────────────────────────────────────────────

// GET all workflows (with node count)
app.get('/api/workflows', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT w.*, COUNT(wn.prompt_id) as node_count
      FROM workflows w
      LEFT JOIN workflow_nodes wn ON w.id = wn.workflow_id
      GROUP BY w.id
      ORDER BY w.created DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST create workflow
app.post('/api/workflows', async (req, res) => {
  const { name, description, promptIds } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const id = `wf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  try {
    await pool.query(
      'INSERT INTO workflows (id, name, description) VALUES ($1, $2, $3)',
      [id, name, description || null]
    );
    if (Array.isArray(promptIds)) {
      for (let i = 0; i < promptIds.length; i++) {
        await pool.query(
          'INSERT INTO workflow_nodes (workflow_id, prompt_id, position) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [id, promptIds[i], i]
        );
      }
    }
    const result = await pool.query('SELECT * FROM workflows WHERE id=$1', [id]);
    const countResult = await pool.query('SELECT COUNT(*) FROM workflow_nodes WHERE workflow_id=$1', [id]);
    res.json({ ...result.rows[0], node_count: parseInt(countResult.rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET single workflow with ordered nodes
app.get('/api/workflows/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const wfResult = await pool.query('SELECT * FROM workflows WHERE id=$1', [id]);
    if (wfResult.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const nodesResult = await pool.query(`
      SELECT p.*, wn.position
      FROM workflow_nodes wn
      JOIN prompts p ON wn.prompt_id = p.id
      WHERE wn.workflow_id = $1
      ORDER BY wn.position ASC
    `, [id]);
    res.json({ ...wfResult.rows[0], nodes: nodesResult.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PUT update workflow name/description
app.put('/api/workflows/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;
  try {
    const result = await pool.query(
      'UPDATE workflows SET name=$1, description=$2, updated=NOW() WHERE id=$3 RETURNING *',
      [name, description || null, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE workflow
app.delete('/api/workflows/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM workflows WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH reorder/add/remove workflow nodes
app.patch('/api/workflows/:id/nodes', async (req, res) => {
  const { id } = req.params;
  const { action, promptIds, orderedIds } = req.body;
  try {
    if (action === 'add' && Array.isArray(promptIds)) {
      const maxPos = await pool.query('SELECT COALESCE(MAX(position), -1) as m FROM workflow_nodes WHERE workflow_id=$1', [id]);
      let pos = maxPos.rows[0].m + 1;
      for (const pid of promptIds) {
        await pool.query(
          'INSERT INTO workflow_nodes (workflow_id, prompt_id, position) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [id, pid, pos++]
        );
      }
    } else if (action === 'remove' && Array.isArray(promptIds)) {
      await pool.query('DELETE FROM workflow_nodes WHERE workflow_id=$1 AND prompt_id = ANY($2)', [id, promptIds]);
    } else if (action === 'reorder' && Array.isArray(orderedIds)) {
      await pool.query('DELETE FROM workflow_nodes WHERE workflow_id=$1', [id]);
      for (let i = 0; i < orderedIds.length; i++) {
        await pool.query(
          'INSERT INTO workflow_nodes (workflow_id, prompt_id, position) VALUES ($1, $2, $3)',
          [id, orderedIds[i], i]
        );
      }
    }
    const wfResult = await pool.query('SELECT * FROM workflows WHERE id=$1', [id]);
    if (wfResult.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const nodesResult = await pool.query(`
      SELECT p.*, wn.position
      FROM workflow_nodes wn
      JOIN prompts p ON wn.prompt_id = p.id
      WHERE wn.workflow_id = $1
      ORDER BY wn.position ASC
    `, [id]);
    res.json({ ...wfResult.rows[0], nodes: nodesResult.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET workflows containing a specific prompt
app.get('/api/workflows/prompt/:promptId', async (req, res) => {
  const { promptId } = req.params;
  try {
    const result = await pool.query(`
      SELECT w.*, wn.position
      FROM workflows w
      JOIN workflow_nodes wn ON w.id = wn.workflow_id
      WHERE wn.prompt_id = $1
      ORDER BY wn.position ASC
    `, [promptId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Fallback: serve index.html for any non-API route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── START ────────────────────────────────────────────────────────────────────

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 PromptVault running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
