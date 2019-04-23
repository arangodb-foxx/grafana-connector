"use strict";
// Note: this behavior is natively available via the `req.auth` property in
// ArangoDB 3.5 and later.
/**
 * @param {Foxx.Request} req
 * @returns {null | {bearer?: string; basic?: { username?: string; password?: string }}}
 */
exports.getAuth = function getAuth(req) {
  const header = req.get("authorization") || "";
  let match = header.match(/^Bearer (.*)$/);
  if (match) {
    return { bearer: match[1] };
  }
  match = header.match(/^Basic (.*)$/);
  if (match) {
    let credentials = "";
    try {
      credentials = new Buffer(match[1], "base64").toString("utf-8");
    } catch (e) {}
    if (!credentials) return { basic: {} };
    const i = credentials.indexOf(":");
    if (i === -1) {
      return { basic: { username: credentials } };
    }
    return {
      basic: {
        username: credentials.slice(0, i),
        password: credentials.slice(i + 1)
      }
    };
  }
};
