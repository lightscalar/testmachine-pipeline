#!/usr/bin/env node

const express = require('express');
const path = require('path');
const { pool } = require('../database/connection');
require('dotenv').config();

const app = express();
const PORT = process.env.WEB_PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Segment table config ───────────────────────────────────────────────────
const SEGMENT_TABLES = [
  { table: 'exchanges', segment: 'Exchanges' },
  { table: 'auditors', segment: 'Auditors' },
  { table: 'large_auditors', segment: 'Large Auditors' },
  { table: 'defi', segment: 'DeFi Protocols' },
  { table: 'rwa_tokenization', segment: 'RWA/Tokenization' }
];

// Editable columns (short name → display label)
const EDITABLE_COLUMNS = {
  n: 'Name', s: 'Stage', c: 'Connection', r: 'Role',
  o: 'Owner', w: 'Website', t: 'Timing', prov: 'Provider',
  l: 'Listings', lc: 'Lead Context', bo: 'Background/Org',
  sp: 'Security Posture', sb: 'Security Budget'
};

// ─── Ensure contact_notes table exists ──────────────────────────────────────
async function ensureContactNotesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contact_notes (
      id SERIAL PRIMARY KEY,
      segment_table TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      contact_date DATE NOT NULL,
      discussion TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Add index for fast lookups
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_contact_notes_entity
    ON contact_notes (segment_table, entity_id)
  `);
}

// ─── API: List all entities across segments ─────────────────────────────────
app.get('/api/entities', async (req, res) => {
  try {
    const { segment, search, stage, sort } = req.query;
    const results = [];

    const tables = segment
      ? SEGMENT_TABLES.filter(t => t.table === segment)
      : SEGMENT_TABLES;

    for (const { table, segment: segName } of tables) {
      let query = `SELECT id, n, s, c, r, o, w, t, prov, l, lc, bo, sp, sb,
                          engagement_score, engagement_level, confidence_score,
                          hubspot_company_id, last_hubspot_sync
                   FROM ${table} WHERE 1=1`;
      const params = [];

      if (search) {
        params.push(`%${search}%`);
        query += ` AND (n ILIKE $${params.length} OR c ILIKE $${params.length} OR w ILIKE $${params.length})`;
      }
      if (stage) {
        params.push(stage);
        query += ` AND s = $${params.length}`;
      }

      query += ' ORDER BY engagement_score DESC NULLS LAST, n ASC';

      const rows = await pool.query(query, params);
      rows.rows.forEach(row => {
        row._segment = segName;
        row._table = table;
      });
      results.push(...rows.rows);
    }

    // Global sort if requested
    if (sort === 'name') results.sort((a, b) => (a.n || '').localeCompare(b.n || ''));
    if (sort === 'engagement') results.sort((a, b) => (b.engagement_score || 0) - (a.engagement_score || 0));

    res.json({ entities: results, total: results.length });
  } catch (err) {
    console.error('GET /api/entities error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Get single entity ─────────────────────────────────────────────────
app.get('/api/entities/:table/:id', async (req, res) => {
  try {
    const { table, id } = req.params;
    if (!SEGMENT_TABLES.find(t => t.table === table)) {
      return res.status(400).json({ error: 'Invalid segment table' });
    }
    const result = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Inline update a single field ──────────────────────────────────────
app.patch('/api/entities/:table/:id', async (req, res) => {
  try {
    const { table, id } = req.params;
    const { field, value } = req.body;

    if (!SEGMENT_TABLES.find(t => t.table === table)) {
      return res.status(400).json({ error: 'Invalid segment table' });
    }
    if (!EDITABLE_COLUMNS[field]) {
      return res.status(400).json({ error: `Field '${field}' is not editable` });
    }

    await pool.query(
      `UPDATE ${table} SET ${field} = $1, updated_at = NOW() WHERE id = $2`,
      [value, id]
    );
    res.json({ success: true, field, value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Contact Notes CRUD ────────────────────────────────────────────────
app.get('/api/contact-notes/:table/:id', async (req, res) => {
  try {
    const { table, id } = req.params;
    const result = await pool.query(
      `SELECT * FROM contact_notes
       WHERE segment_table = $1 AND entity_id = $2
       ORDER BY contact_date DESC, created_at DESC`,
      [table, id]
    );
    res.json({ notes: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/contact-notes/:table/:id', async (req, res) => {
  try {
    const { table, id } = req.params;
    const { contact_date, discussion } = req.body;

    if (!contact_date || !discussion) {
      return res.status(400).json({ error: 'contact_date and discussion are required' });
    }
    if (!SEGMENT_TABLES.find(t => t.table === table)) {
      return res.status(400).json({ error: 'Invalid segment table' });
    }

    const result = await pool.query(
      `INSERT INTO contact_notes (segment_table, entity_id, contact_date, discussion)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [table, id, contact_date, discussion]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/contact-notes/:noteId', async (req, res) => {
  try {
    const { noteId } = req.params;
    const { contact_date, discussion } = req.body;
    const result = await pool.query(
      `UPDATE contact_notes SET contact_date = $1, discussion = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [contact_date, discussion, noteId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Note not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/contact-notes/:noteId', async (req, res) => {
  try {
    const { noteId } = req.params;
    const result = await pool.query('DELETE FROM contact_notes WHERE id = $1 RETURNING id', [noteId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Note not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Pipeline stats ────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
    const stats = {};
    for (const { table, segment } of SEGMENT_TABLES) {
      const total = await pool.query(`SELECT COUNT(*) as c FROM ${table}`);
      const engaged = await pool.query(
        `SELECT COUNT(*) as c FROM ${table} WHERE engagement_score > 0`
      );
      const stages = await pool.query(
        `SELECT s, COUNT(*) as c FROM ${table} GROUP BY s`
      );
      stats[segment] = {
        total: parseInt(total.rows[0].c),
        engaged: parseInt(engaged.rows[0].c),
        stages: Object.fromEntries(stages.rows.map(r => [r.s || 'Unknown', parseInt(r.c)]))
      };
    }
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SPA fallback ───────────────────────────────────────────────────────────
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ──────────────────────────────────────────────────────────────────
async function start() {
  await ensureContactNotesTable();
  app.listen(PORT, () => {
    console.log(`\n🚀 Pipeline Interface running at http://localhost:${PORT}`);
    console.log(`   API: http://localhost:${PORT}/api/entities`);
    console.log(`   Stats: http://localhost:${PORT}/api/stats\n`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

module.exports = app;
