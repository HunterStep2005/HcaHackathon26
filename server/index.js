// server/index.js — Express entry point
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const { authLimiter, apiLimiter } = require('./middleware/rateLimit');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware — allow GitHub Pages + localhost
app.use(cors({
  origin: [
    'https://hunterstep2005.github.io',
    'https://hunterstep2005.github.io/HcaHackathon26',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ],
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Rate limiting
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/', apiLimiter);

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/preferences', require('./routes/preferences'));
app.use('/api/roles', require('./routes/roles'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/divisions', require('./routes/divisions'));
app.use('/api/share', require('./routes/share'));

// Serve static files (index.html, JSON data, etc.)
app.use(express.static(path.join(__dirname, '..'), {
  index: 'index.html'
}));

// SPA fallback
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Async startup
async function start() {
  const getDb = require('./db');
  await getDb();
  console.log('Database initialized');

  app.listen(PORT, () => {
    console.log('HCA Dashboard Server running on port ' + PORT);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
