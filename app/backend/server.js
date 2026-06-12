const http = require('http');
const os = require('os');
const crypto = require('crypto');

const port = Number(process.env.PORT || 3000);
const errorRate = Number(process.env.ERROR_RATE || 0);
const version = process.env.VERSION || 'v1.0.0';
let totalRequests = 0;
let orderRequests = 0;
let healthRequests = 0;
let metricsRequests = 0;
const httpRequests = {};

function recordMetric(route, statusCode) {
  const key = `${route}|${statusCode}`;
  httpRequests[key] = (httpRequests[key] || 0) + 1;
}

function sendJson(res, statusCode, payload) {
  recordMetric(payload.route || 'unknown', statusCode);
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
      version
    },
    handledAt: new Date().toISOString()
  };
}

function renderHttpMetrics() {
  return Object.entries(httpRequests)
    .map(([key, count]) => {
      const [route, status] = key.split('|');
      return `gitops_demo_http_requests_total{route="${route}",status="${status}"} ${count}`;
    })
    .join('\n');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  totalRequests += 1;

  if (url.pathname === '/api/health') {
    healthRequests += 1;
    return sendJson(res, 200, {
      status: 'ok',
      service: 'gitops-demo-backend',
      hostname: os.hostname(),
      route: '/api/health'
    });
  }

  if (url.pathname === '/api/order') {
    orderRequests += 1;
    if (Math.random() < errorRate) {
      return sendJson(res, 500, {
        status: 'error',
        message: 'Injected error for canary analysis.',
        backend: {
          service: 'gitops-demo-backend',
          hostname: os.hostname(),
          version
        },
        route: '/api/order'
      });
    }

    return sendJson(res, 200, {
      ...buildOrderResponse(url),
      route: '/api/order'
    });
  }

  if (url.pathname === '/metrics') {
    metricsRequests += 1;
    res.writeHead(200, {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    return res.end(`# HELP gitops_demo_requests_total Total HTTP requests handled by the backend.
# TYPE gitops_demo_requests_total counter
gitops_demo_requests_total{route="all"} ${totalRequests}
gitops_demo_requests_total{route="/api/order"} ${orderRequests}
gitops_demo_requests_total{route="/api/health"} ${healthRequests}
gitops_demo_requests_total{route="/metrics"} ${metricsRequests}
# HELP gitops_demo_http_requests_total Total HTTP requests by route and status code.
# TYPE gitops_demo_http_requests_total counter
${renderHttpMetrics()}
# HELP gitops_demo_build_info Backend build information.
# TYPE gitops_demo_build_info gauge
gitops_demo_build_info{service="gitops-demo-backend",version="${version}",hostname="${os.hostname()}"} 1
`);
  }

  return sendJson(res, 404, {
    status: 'not_found',
    path: url.pathname,
    route: 'unknown'
  });
});

server.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
