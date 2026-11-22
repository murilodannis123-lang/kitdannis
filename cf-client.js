// Cliente do servidor KitDannis no Cloudflare.
// Imita as partes da biblioteca do Supabase que o app usa, para o app.js mudar o mínimo.
(function () {
  const CHAVE = "kitdannis-cf";
  function createClient(base) {
    base = base.replace(/\/+$/, "");
    const ouvintes = new Set();
    let sessao = null;
    try { sessao = JSON.parse(localStorage.getItem(CHAVE) || "null"); } catch {}
    const emitir = (ev, s) => ouvintes.forEach(fn => { try { fn(ev, s); } catch (e) { console.error(e); } });
    function guardar(s) {
      sessao = s;
      try { s ? localStorage.setItem(CHAVE, JSON.stringify(s)) : localStorage.removeItem(CHAVE); } catch {}
    }
    const deResposta = j => ({ access_token: j.token, user: j.user });
    function expirou() { if (sessao) { guardar(null); emitir("SIGNED_OUT", null); } }

    async function req(metodo, caminho, corpo, extra = {}) {
      const h = { ...(extra.headers || {}) };
      if (sessao?.access_token) h.Authorization = "Bearer " + sessao.access_token;
      let body;
      if (corpo instanceof Blob || corpo instanceof ArrayBuffer) body = corpo;
      else if (corpo !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(corpo); }
      let r;
      try { r = await fetch(base + caminho, { method: metodo, headers: h, body }); }
      catch (e) { return { data: null, error: { message: "Sem conexão com o servidor.", status: 0 } }; }
      if (extra.blob && r.ok) return { data: await r.blob(), error: null };
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        if (r.status === 401 && !caminho.startsWith("/api/auth/")) expirou();
        return { data: null, error: { message: j?.error?.message || `Erro ${r.status}`, status: r.status } };
      }
      return { data: j, error: null };
    }

    class Consulta {
      constructor(t) { this.t = t; this.metodo = "GET"; this.params = new URLSearchParams(); this.corpo = undefined; this.headers = {}; this.uma = false; }
      select() { if (this.metodo === "GET") this.metodo = "GET"; return this; }
      order(col, op = {}) { this.params.set("order", `${col}.${op.ascending === false ? "desc" : "asc"}`); return this; }
      eq(col, v) { this.params.append("eq." + col, v); return this; }
      insert(o) { this.metodo = "POST"; this.corpo = o; return this; }
      upsert(o) { this.metodo = "POST"; this.corpo = o; this.headers["x-upsert"] = "1"; return this; }
      update(o) { this.metodo = "PATCH"; this.corpo = o; return this; }
      delete() { this.metodo = "DELETE"; return this; }
      single() { this.uma = true; return this; }
      async run() {
        const q = this.params.toString();
        const r = await req(this.metodo, `/api/t/${this.t}${q ? "?" + q : ""}`, this.corpo, { headers: this.headers });
        if (!r.error && this.uma) r.data = Array.isArray(r.data) ? r.data[0] ?? null : r.data;
        return r;
      }
      then(ok, falha) { return this.run().then(ok, falha); }
    }
    const caminhoArq = p => "/api/arq/" + p.split("/").map(encodeURIComponent).join("/");

    return {
      modo: "cloudflare",
      from: t => new Consulta(t),
      auth: {
        async getSession() {
          if (!sessao) return { data: { session: null }, error: null };
          const r = await req("GET", "/api/auth/sessao");
          if (r.error && r.error.status === 401) { guardar(null); return { data: { session: null }, error: null }; }
          if (r.data?.user) guardar({ ...sessao, user: r.data.user });
          return { data: { session: sessao }, error: null }; // sem internet: mantém a sessão guardada
        },
        onAuthStateChange(fn) { ouvintes.add(fn); return { data: { subscription: { unsubscribe: () => ouvintes.delete(fn) } } }; },
        async signInWithPassword({ email, password }) {
          const r = await req("POST", "/api/auth/login", { email, senha: password });
          if (r.error) return { data: null, error: r.error };
          guardar(deResposta(r.data)); emitir("SIGNED_IN", sessao);
          return { data: { session: sessao, user: sessao.user }, error: null };
        },
        async signOut() {
          if (sessao) await req("POST", "/api/auth/sair");
          guardar(null); emitir("SIGNED_OUT", null);
          return { error: null };
        },
        async updateUser({ password }) {
          const r = await req("POST", "/api/auth/senha", { senha: password });
          return r.error ? { data: null, error: r.error } : { data: { user: r.data.user }, error: null };
        },
        // Cloudflare: em vez do link por e-mail, o código de recuperação
        async recuperar({ email, codigo, password }) {
          const r = await req("POST", "/api/auth/recuperar", { email, codigo, senha: password });
          if (r.error) return { data: null, error: r.error };
          guardar(deResposta(r.data)); emitir("SIGNED_IN", sessao);
          return { data: { session: sessao }, error: null };
        },
        async novoCodigo() { return req("POST", "/api/auth/novo-codigo", {}); },
        async criarAcesso({ email, password, setup }) {
          const r = await req("POST", "/api/auth/setup", { email, senha: password, setup });
          if (r.error) return { data: null, error: r.error };
          guardar(deResposta(r.data)); emitir("SIGNED_IN", sessao);
          return { data: { session: sessao, codigo: r.data.codigo }, error: null };
        },
        async resetPasswordForEmail() { return { error: { message: "Use o código de recuperação." } }; },
      },
      functions: {
        async invoke(nome, { body } = {}) {
          const r = await req("POST", "/api/" + nome, body);
          if (r.error) { const msg = r.error.message; r.error.context = { json: async () => ({ erro: msg }) }; }
          return r;
        },
      },
      storage: {
        from: () => ({
          createSignedUrls: (paths, segundos) => req("POST", "/api/arq/assinar", { paths, segundos }),
          async upload(path, blob, op = {}) {
            const r = await req("PUT", caminhoArq(path) + (op.upsert ? "?upsert=1" : ""), blob, { headers: { "Content-Type": op.contentType || blob.type || "application/octet-stream" } });
            return r.error ? r : { data: { path }, error: null };
          },
          remove: paths => req("POST", "/api/arq/apagar", { paths }),
          download: path => req("GET", caminhoArq(path), undefined, { blob: true }),
        }),
      },
      aquecer() { fetch(base + "/api/saude").catch(() => {}); },
    };
  }
  window.kitCloud = { createClient };
})();
