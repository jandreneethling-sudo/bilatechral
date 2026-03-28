require('dotenv').config();
require('express-async-errors');
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Tokens = require('csrf');

// Only load PostgreSQL session store if DATABASE_URL is configured
let sessionStore = null;
if (process.env.DATABASE_URL) {
  try {
    const pgSession = require('connect-pg-simple')(session);
    const pool = require('./db/pool');
    sessionStore = new pgSession({
      pool,
      tableName: 'session',
      createTableIfMissing: true,
      errorLog: console.error.bind(console)
    });
    console.log('Using PostgreSQL session store');
  } catch (err) {
    console.error('Failed to initialize PostgreSQL session store:', err.message);
    console.log('Falling back to memory session store');
  }
} else {
  console.log('No DATABASE_URL configured, using memory session store');
}

const publicRoutes = require('./routes/publicRoutes');
const authRoutes = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const { startMonthlySummaryScheduler } = require('./services/monthlySummaryJob');

const app = express();
const csrfTokens = new Tokens();
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
  app.set('trust proxy', 1);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use('/assets', express.static(path.join(__dirname, '..', 'public')));
app.use('/images', express.static(path.join(__dirname, '..', 'public', 'images')));
app.use('/artwork', express.static(path.join(__dirname, '..', 'artwork')));
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'artwork', 'Logo-Master.png'));
});

app.use(express.urlencoded({ extended: true }));

// Session configuration - uses PostgreSQL if available, memory otherwise
const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'unsafe-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8,
    httpOnly: true,
    sameSite: isProduction ? 'strict' : 'lax',
    secure: isProduction
  }
};

if (sessionStore) {
  sessionConfig.store = sessionStore;
}

app.use(session(sessionConfig));

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method !== 'POST',
  message: 'Too many login attempts. Please try again later.'
});

app.use('/login', loginRateLimiter);

app.use((req, res, next) => {
  if (!req.session.csrfSecret) {
    req.session.csrfSecret = csrfTokens.secretSync();
  }

  res.locals.csrfToken = csrfTokens.create(req.session.csrfSecret);
  next();
});

app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const token = req.body?._csrf || req.get('x-csrf-token');
  const isValid = token && req.session.csrfSecret
    ? csrfTokens.verify(req.session.csrfSecret, token)
    : false;

  if (!isValid) {
    const error = new Error('Invalid CSRF token.');
    error.code = 'EBADCSRFTOKEN';
    return next(error);
  }

  return next();
});

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

app.use(publicRoutes);
app.use(authRoutes);
app.use(dashboardRoutes);

app.use((req, res) => {
  res.status(404).render('dashboard/not-found', {
    title: 'Page Not Found',
    user: req.session.user || null
  });
});

app.use((error, req, res, next) => {
  if (error.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('dashboard/forbidden', {
      title: 'Invalid Request',
      user: req.session.user || null
    });
  }

  console.error('Unhandled application error:', error);

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).render('dashboard/server-error', {
    title: 'Server Error',
    user: req.session.user || null
  });
});

const port = Number(process.env.PORT || 3000);
if (require.main === module) {
  app.listen(port, () => {
    console.log(`Bilatechral app running on http://localhost:${port}`);
    console.log(`Server source file: ${__filename}`);
    startMonthlySummaryScheduler();
  });
} else {
  console.log(`Bilatechral app loaded via module: ${__filename}`);
  startMonthlySummaryScheduler();
}

module.exports = app;
