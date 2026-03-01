// server/index.js — Express entry point
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: ['https://hunterstep2005.github.io', 'http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// All API routes live in one file
app.use('/api', require('./routes'));

// Serve static files
app.use(express.static(path.join(__dirname, '..'), { index: 'index.html' }));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) res.sendFile(path.join(__dirname, '..', 'index.html'));
  else res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Internal server error' }); });

async function start() {
  await require('./db')();
  app.listen(PORT, () => console.log('HCA Dashboard running on port ' + PORT));
}
start().catch(err => { console.error(err); process.exit(1); });
