// Medic1905 Virtual Hospital — main server
// SIMULATION PLATFORM: all patients are synthetic. Not connected to any
// real clinical system, prescribing service or medical device.
const express = require('express');
const path = require('path');
const fs = require('fs');

const { db } = require('./db');
const authRoutes = require('./routes/auth');
const coreRoutes = require('./routes/core');
const runRoutes = require('./routes/runs');
const adminRoutes = require('./routes/admin');

const app = express();
app.use(express.json({ limit: '4mb' }));

// Health (before route mounts)
app.get('/api/health', (req, res) => res.json({ ok: true, platform: 'Medic1905 Virtual Hospital', simulation: true }));

app.use('/api/auth', authRoutes.router);
app.use('/api', coreRoutes.router);
app.use('/api', runRoutes.router);
app.use('/api/admin', adminRoutes.router);

// Static client
const CLIENT_DIR = path.join(__dirname, '..', 'client');
app.use((req, res, next) => { res.setHeader('Cache-Control', 'no-cache'); next(); });
app.use(express.static(CLIENT_DIR));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const indexPath = path.join(CLIENT_DIR, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  res.status(200).send('Medic1905 API running. Client not built.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Medic1905 Virtual Hospital running on http://localhost:${PORT}`);
  console.log('EDUCATIONAL SIMULATION ONLY — synthetic patients, no real clinical data.');
});
