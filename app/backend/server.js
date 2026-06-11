const http = require('http');
const os = require('os');
const crypto = require('crypto');

const port = Number(process.env.PORT || 3000);

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(payload, null, 2));
}

function buildOrderResponse(url) {
  const customer = url.searchParams.get('customer') || 'Guest';
  const item = url.searchParams.get('item') || 'Cloud meal';
  const quantity = Number(url.searchParams.get('quantity') || 1);
  const requestId = crypto.randomUUID().slice(0, 8);
  const estimatedMinutes = 8 + Math.min(quantity, 6) * 2;

  return {
    requestId,
    status: 'accepted',
    message: `Backend accepted ${quantity} order(s) of ${item} for ${customer}.`,
    order: {
      customer,
      item,
      quantity,
      estimatedMinutes
    },
    backend: {
      service: 'gitops-demo-backend',
      hostname: os.hostname(),
      version: 'v1.0.0'
    },
    handledAt: new Date().toISOString()
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/health') {
    return sendJson(res, 200, {
      status: 'ok',
      service: 'gitops-demo-backend',
      hostname: os.hostname()
    });
  }

  if (url.pathname === '/api/order') {
    return sendJson(res, 200, buildOrderResponse(url));
  }

  return sendJson(res, 404, {
    status: 'not_found',
    path: url.pathname
  });
});

server.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
