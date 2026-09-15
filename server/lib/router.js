/** Juda yengil router: `GET /api/chats/:id` uslubidagi yo'llar. */
import { notFound } from './http.js';

export class Router {
  constructor(prefix = '') { this.prefix = prefix; this.routes = []; }

  add(method, pattern, ...handlers) {
    const full = (this.prefix + pattern).replace(/\/+$/, '') || '/';
    const params = [];
    const rx = new RegExp('^' + full.replace(/\/:([A-Za-z0-9_]+)/g, (_, p) => { params.push(p); return '/([^/]+)'; }) + '/?$');
    this.routes.push({ method, rx, params, handlers });
    return this;
  }
  get(p, ...h)    { return this.add('GET', p, ...h); }
  post(p, ...h)   { return this.add('POST', p, ...h); }
  patch(p, ...h)  { return this.add('PATCH', p, ...h); }
  put(p, ...h)    { return this.add('PUT', p, ...h); }
  delete(p, ...h) { return this.add('DELETE', p, ...h); }

  use(router) { this.routes.push(...router.routes); return this; }

  match(method, pathname) {
    let pathExists = false;
    for (const r of this.routes) {
      const m = pathname.match(r.rx);
      if (!m) continue;
      pathExists = true;
      if (r.method !== method) continue;
      const params = {};
      r.params.forEach((p, i) => { params[p] = decodeURIComponent(m[i + 1]); });
      return { handlers: r.handlers, params };
    }
    if (pathExists) return { methodMismatch: true };
    return null;
  }

  /** Handler zanjirini ketma-ket bajaradi (middleware uslubi). */
  async dispatch(ctx) {
    const found = this.match(ctx.method, ctx.pathname);
    if (!found || found.methodMismatch) throw notFound('Bunday endpoint mavjud emas');
    for (const h of found.handlers) {
      ctx.params = found.params;
      const stop = await h(ctx);
      if (stop === false || ctx.res.writableEnded) return;
    }
  }
}
