function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  return next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.redirect('/login');
    }

    if (!roles.includes(req.session.user.role)) {
      return res.status(403).render('dashboard/forbidden', {
        title: 'Access Denied',
        user: req.session.user
      });
    }

    return next();
  };
}

module.exports = {
  requireAuth,
  requireRole
};
