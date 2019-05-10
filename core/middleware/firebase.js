const admin = require('firebase-admin');

const dbFieldDefault = 'db';
const authFiledDefault = 'auth';

function initialize(options) {
  admin.initializeApp({
    credential: admin.credential.cert(options.credential),
    databaseURL: `https://${options.databaseName}.firebaseio.com`
  });
  return (req, res, next) => {
    req[options.databaseFiled || dbFieldDefault] = admin.database();
    req[options.authenticationField || authFiledDefault] = admin.auth();
    next();
  };
}

const sessionUserSecret = '_uid';
const sessionTokenSecret = '_token';
const requestProperty = 'user';

function getToken(req) {
  const token = {};
  const auth = req.headers.authorization;
  if (auth && auth.length > 1) {
    const [tokenType, accessToken] = auth.trim().split(' ');
    if (tokenType !== 'Bearer') {
      throw new Error('Invalid request');
    }
    token.type = tokenType;
    token.accessToken = accessToken;
  } else if (req.query && req.query.token) {
    token.accessToken = req.query.token;
  }
  return token;
}

async function Authentication(req, res, next) {
  const token = getToken(req);
  const sessionToken = req.session[sessionTokenSecret];
  if (sessionToken && sessionToken === token.accessToken) {
    const ref = req.db.ref(`/users/${req.session[sessionUserSecret]}`);
    const snapshot = await ref.once('value')
    req[requestProperty] = snapshot.val();
    ref.off();
    next();
  }
  else if (token.accessToken) {
    try {
      const { uid } = await req.auth.verifyIdToken(token.accessToken);
      const ref = req.db.ref(`/users/${uid}`);
      req.session[sessionUserSecret] = uid;
      req.session[sessionTokenSecret] = token.accessToken;
      const snapshot = await ref.once('value');
      req[requestProperty] = snapshot.val();
      ref.off();
      next();
    } catch (err) {
      delete req.session[sessionUserSecret];
      delete req.session[sessionTokenSecret];
      res.json({ error: err.message });
    }
  } else {
    throw new Error('Invalid token!');
  }

  res.prototype.isAuthenticated = function () {
    return this.user !== undefined && this.user !== null;
  };
}

exports.getToken = getToken;
exports.JWTAuthentication = Authentication;
exports.initialize = initialize;
