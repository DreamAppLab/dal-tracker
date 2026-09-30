// Mission Control — quote messages subcollection proxy for dal-website-c9dd8
// GET  /api/quotes/messages?id=xxx
// POST /api/quotes/messages?id=xxx

const quotesHandler = require('../quotes');

module.exports = async (req, res) => {
  req._dalMessages = true;
  return quotesHandler(req, res);
};
