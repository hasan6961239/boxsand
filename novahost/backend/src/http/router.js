/**
 * A small pattern router.
 *
 * Supports exactly what this project needs and nothing more:
 *   /api/projects              literal segments
 *   /api/projects/:id          named parameter, captured into ctx.params
 *   /s/:slug/*                 trailing wildcard, captured as ctx.params['*']
 *
 * Routes are matched in registration order. Static segments are compared before
 * parameters at the same position, so /api/projects/search never gets swallowed
 * by /api/projects/:id regardless of which was registered first.
 */

function compile(pattern) {
  const segments = pattern.split('/').filter((s) => s.length > 0);
  return segments.map((segment) => {
    if (segment === '*') return { type: 'wildcard' };
    if (segment.startsWith(':')) return { type: 'param', name: segment.slice(1) };
    return { type: 'static', value: segment };
  });
}

function splitPath(path) {
  const out = [];
  for (const raw of path.split('/')) {
    if (raw.length === 0) continue;
    try {
      out.push(decodeURIComponent(raw));
    } catch {
      out.push(raw);
    }
  }
  return out;
}

function match(compiled, segments) {
  const params = {};
  for (let i = 0; i < compiled.length; i++) {
    const token = compiled[i];
    if (token.type === 'wildcard') {
      params['*'] = segments.slice(i).join('/');
      return params;
    }
    if (i >= segments.length) return null;
    if (token.type === 'static') {
      if (token.value !== segments[i]) return null;
    } else {
      if (segments[i] === '') return null;
      params[token.name] = segments[i];
    }
  }
  return compiled.length === segments.length ? params : null;
}

/** Score used to prefer more specific routes — static beats param beats wildcard. */
function specificity(compiled) {
  let score = compiled.length * 10;
  for (const token of compiled) {
    if (token.type === 'static') score += 3;
    else if (token.type === 'param') score += 2;
    else score -= 5;
  }
  return score;
}

export function createRouter() {
  const routes = [];

  function add(method, pattern, handler) {
    const compiled = compile(pattern);
    routes.push({ method, pattern, compiled, handler, score: specificity(compiled) });
    routes.sort((a, b) => b.score - a.score);
  }

  return {
    get: (p, h) => add('GET', p, h),
    post: (p, h) => add('POST', p, h),
    put: (p, h) => add('PUT', p, h),
    patch: (p, h) => add('PATCH', p, h),
    delete: (p, h) => add('DELETE', p, h),
    head: (p, h) => add('HEAD', p, h),
    all: (p, h) => add('*', p, h),

    /**
     * Find a handler for the request.
     * Returns { handler, params } or, when the path exists under other methods,
     * { methodNotAllowed: [...] } so the caller can answer 405 with an Allow
     * header instead of a misleading 404.
     */
    find(method, path) {
      const segments = splitPath(path);
      const pathMatches = [];

      for (const route of routes) {
        const params = match(route.compiled, segments);
        if (!params) continue;
        pathMatches.push(route);
        if (route.method === method || route.method === '*') {
          return { handler: route.handler, params, pattern: route.pattern };
        }
        // HEAD falls back to GET; Node suppresses the body automatically.
        if (method === 'HEAD' && route.method === 'GET') {
          return { handler: route.handler, params, pattern: route.pattern };
        }
      }

      if (pathMatches.length > 0) {
        const allowed = [...new Set(pathMatches.map((r) => r.method))].filter((m) => m !== '*');
        return { methodNotAllowed: allowed };
      }
      return null;
    },

    list() {
      return routes.map((r) => ({ method: r.method, pattern: r.pattern }));
    },
  };
}
