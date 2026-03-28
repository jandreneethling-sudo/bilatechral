const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');

const router = express.Router();
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().toLowerCase();
}

router.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }

  return res.render('auth/login', {
    title: 'Login',
    error: null
  });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const safeEmail = normalizeEmail(email);
  const safePassword = typeof password === 'string' ? password : '';

  if (!EMAIL_REGEX.test(safeEmail) || safePassword.length < 8 || safePassword.length > 128) {
    return res.status(400).render('auth/login', {
      title: 'Login',
      error: 'Invalid email or password.'
    });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1 AND is_active = TRUE', [
      safeEmail
    ]);

    const user = result.rows[0];

    if (!user) {
      return res.status(401).render('auth/login', {
        title: 'Login',
        error: 'Invalid email or password.'
      });
    }

    const isValid = await bcrypt.compare(safePassword, user.password_hash);

    if (!isValid) {
      return res.status(401).render('auth/login', {
        title: 'Login',
        error: 'Invalid email or password.'
      });
    }

    req.session.user = {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      role: user.role
    };

    return res.redirect('/dashboard');
  } catch (error) {
    return res.status(500).render('auth/login', {
      title: 'Login',
      error: 'Could not sign in. Please try again.'
    });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

module.exports = router;
