#!/usr/bin/env node

const http = require('http');
const { URL } = require('url');

require('dotenv').config();

const slackHandler = require('./api/slack');

const PORT = parseInt(process.env.PORT || '3000', 10);

function decorateResponse(res) {
  res.status = code => {
    res.statusCode = code;
    return res;
  };

  res.json = body => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(body));
  };

  return res;
}

const server = http.createServer(async (req, res) => {
  decorateResponse(res);

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/healthz') {
    res.setHeader('Content-Type', 'text/plain');
    return res.end('ok\n');
  }

  if (url.pathname === '/slack' || url.pathname === '/api/slack') {
    try {
      return await slackHandler(req, res);
    } catch (err) {
      console.error('Slack handler error:', err);
      if (!res.headersSent) return res.status(500).json({ error: 'internal server error' });
      return res.end();
    }
  }

  return res.status(404).json({ error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`Lunch bot listening on port ${PORT}`);
});
