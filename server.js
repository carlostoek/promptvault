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
  // Agregar columna image si no existe (para backward compatibility)
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
      image       TEXT    DEFAULT NULL,
      created     TIMESTAMPTZ DEFAULT NOW(),
      updated     TIMESTAMPTZ DEFAULT NOW(),
      usage_count INTEGER DEFAULT 0
    )
  `);
  console.log('✅ DB ready');
}

app.use(express.json());

// Serve the frontend from /public
app.use(express.static(path.join(__dirname, 'public')));

// ─── API ROUTES ───────────────────────────────────────────────────────────────

// GET all prompts
app.get('/api/prompts', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM prompts ORDER BY created DESC');
    res.json(result.rows);
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
