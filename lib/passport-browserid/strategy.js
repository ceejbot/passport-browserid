/**
 * Module dependencies.
 */
var passport = require('passport')
  , https = require('https')
  , querystring = require('querystring')
  , util = require('util')
  , BadRequestError = require('./errors/badrequesterror')
  , VerificationError = require('./errors/verificationerror');


/**
 * `Strategy` constructor.
 *
 * The BrowserID authentication strategy authenticates requests using the
 * BrowserID JavaScript API and Verified Email Protocol (VEP).
 *
 * BrowserID provides a federated and decentralized universal login system for
 * the web, based on email addresses as an identity token.  Authenticating in
 * this this manner involves a sequence of events, including prompting the user,
 * via their user agent, for an assertion of email address ownership.  Once this
 * assertion is obtained, it can be verified and the user can be authenticated.
 *
 * Applications must supply a `verify` callback which accepts an `email`
 * address, and then calls the `done` callback supplying a `user`, which should
 * be set to `false` if the credentials are not valid.  If an exception occured,
 * `err` should be set.
 *
 * Options:
 *   - `audience`        the website requesting and verifying an identity assertion
 *   - `assertionField`  field name where the assertion is found, defaults to 'assertion'
 *   - `passReqToCallback`     when `true`, `req` is the first argument to the verify callback (default: `false`)
 *
 * Examples:
 *
 *     passport.use(new BrowserIDStrategy({
 *         audience: 'http://www.example.com'
 *       },
 *       function(email, done) {
 *         User.findByEmail(email, function (err, user) {
 *           done(err, user);
 *         });
 *       }
 *     ));
 *
 * @param {Object} options
 * @param {Function} verify
 * @api public
 */
function Strategy(options, verify) {
  if (!options.audience) throw new Error('BrowserID authentication requires an audience option');
  if (!verify) throw new Error('BrowserID authentication strategy requires a verify function');

  passport.Strategy.call(this);
  this.name = 'browserid';
  this._verify = verify;
  this._passReqToCallback = options.passReqToCallback;

  this._audience = options.audience;
  this._assertionField = options.assertionField || 'assertion';

  // options used to inject mock objects for testing purposes
  this._https = options.transport || https;
}

/**
 * Inherit from `passport.Strategy`.
 */
util.inherits(Strategy, passport.Strategy);


/**
 * Authenticate request by using browserid.org as a trusted secondary authority
 * for verifying email assertions.
 *
 * @param {Object} req
 * @api protected
 */
Strategy.prototype.authenticate = function(req) {
  var self = this;

  if (!req.body || !req.body[this._assertionField]) {
    return this.fail(new BadRequestError('Missing assertion'));
  }

  var assertion = req.body[this._assertionField];

  var query = querystring.stringify({ assertion: assertion, audience: this._audience });
  var headers = {};
  headers['Host'] = 'verifier.login.persona.org';
  headers['Content-Type'] = 'application/x-www-form-urlencoded';
  headers['Content-Length'] = query.length;

  var options = {
    host: 'verifier.login.persona.org',
    path: '/verify',
    method: 'POST',
    headers: headers
  };
  var vreq = this._https.request(options, function(res) {
    var data = '';
    res.on('data', function(chunk) {
      data += chunk;
    });
    res.on('end', function() {
      try {
        var result = JSON.parse(data);
        if (result.status === 'okay') {
          return verified(result)
        } else {
          return self.error(new VerificationError(result.reason));
        }
      } catch(e) {
        return self.error(e);
      }
    });
    res.on('error', function(err) {
      return self.error(err);
    });
  });
  vreq.end(query, 'utf8');

  // TODO: Check that the audience matches this server, according to the Host
  //       header.  Also, implement an option to disable this check (defaulting
  //       to false).

  function verified(result) {
    function done(err, user, info) {
      if (err) { return self.error(err); }
      if (!user) { return self.fail(info); }
      self.success(user, info);
    }

    if (self._passReqToCallback) {
      self._verify(req, result.email, done);
    } else {
      self._verify(result.email, done);
    }
  }
}


/**
 * Expose `Strategy`.
 */
module.exports = Strategy;
