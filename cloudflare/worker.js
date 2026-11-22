// KitDannis — servidor no Cloudflare (Worker + D1 + KV).
// Substitui o Supabase: login, dados (gastos, notas, config), arquivos das notas e a IA "separar".
// Ligações (bindings) esperadas: DB (D1), ARQUIVOS (KV).
// Segredos: ANTHROPIC_API_KEY, SETUP_TOKEN (só para criar o 1º acesso). ASSINATURA é opcional: sem ela, o servidor cria e guarda uma chave própria.
// Variável: ORIGENS (sites que podem usar a API, separados por vírgula).

const MODELO = "claude-haiku-5-5";
const DIAS_SESSAO = 60;
// Senha: PBKDF2-SHA256. No plano grátis cada pedido tem ~10 ms de CPU; 50 mil rodadas levam ~7 ms.
// O número fica gravado junto com o hash, então dá para subir depois (variável ITERACOES) sem perder o acesso.
const ITERACOES_PADRAO = 50000;
const ITER_CODIGO = 10000; // o código de recuperação já é aleatório (80 bits); não precisa de tantas rodadas

/* ---------- utilitários ---------- */
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const aleatorio = (n = 32) => hex(crypto.getRandomValues(new Uint8Array(n)));
const uuid = () => crypto.randomUUID();
const agora = () => Date.now();
async function sha256(txt) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(txt))); }
async function pbkdf2(senha, salt, iter) {
  const chave = await crypto.subtle.importKey("raw", enc.encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: iter }, chave, 256);
  return hex(bits);
}
const iterSenha = env => Math.min(Math.max(Number(env.ITERACOES) || ITERACOES_PADRAO, 10000), 100000);
async function gerarHash(segredo, iter) { const salt = aleatorio(16); return { hash: `${iter}$${await pbkdf2(segredo, salt, iter)}`, salt }; }
async function confere(segredo, salt, guardado) {
  const [it, h] = String(guardado).includes("$") ? guardado.split("$") : [100000, guardado];
  return iguais(await pbkdf2(segredo, salt, Number(it)), h);
}
function iguais(a, b) { // comparação em tempo constante
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0;
}
let assinaturaCache = null;
async function chaveAssinatura(env) {
  if (env.ASSINATURA) return env.ASSINATURA;
  if (assinaturaCache) return assinaturaCache;
  let k = await env.ARQUIVOS.get("__sistema/assinatura"); // fora da pasta de qualquer usuário
  if (!k) { k = aleatorio(32); await env.ARQUIVOS.put("__sistema/assinatura", k); }
  return (assinaturaCache = k);
}
async function hmac(segredo, txt) {
  const k = await crypto.subtle.importKey("raw", enc.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(txt)));
}
function codigoRecuperacao() { // 4 grupos de 4, sem letras confusas
  const alf = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", b = crypto.getRandomValues(new Uint8Array(16));
  return [0, 4, 8, 12].map(i => [...b.slice(i, i + 4)].map(x => alf[x % alf.length]).join("")).join("-");
}
const normEmail = e => String(e || "").trim().toLowerCase();

/* ---------- respostas e CORS ---------- */
function corsDe(req, env) {
  const origem = req.headers.get("Origin") || "";
  const ok = (env.ORIGENS || "https://murilodannis123-lang.github.io").split(",").map(s => s.trim()).filter(Boolean);
  const h = { "Access-Control-Allow-Headers": "authorization, content-type, x-upsert", "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS", "Access-Control-Max-Age": "86400", "Vary": "Origin" };
  if (ok.includes(origem)) h["Access-Control-Allow-Origin"] = origem;
  return h;
}
const json = (req, env, corpo, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { ...corsDe(req, env), "Content-Type": "application/json; charset=utf-8" } });
const erro = (req, env, msg, status = 400, extra = {}) => json(req, env, { error: { message: msg, ...extra } }, status);

/* ---------- sessão ---------- */
async function criarSessao(env, userId) {
  const token = aleatorio(32);
  await env.DB.prepare("INSERT INTO sessoes (token_hash, user_id, expira) VALUES (?, ?, ?)").bind(await sha256(token), userId, agora() + DIAS_SESSAO * 864e5).run();
  return token;
}
async function usuarioDaSessao(req, env) {
  const a = req.headers.get("Authorization") || "";
  if (!a.startsWith("Bearer ")) return null;
  const th = await sha256(a.slice(7).trim());
  const s = await env.DB.prepare("SELECT s.user_id, s.expira, u.email FROM sessoes s JOIN usuarios u ON u.id = s.user_id WHERE s.token_hash = ?").bind(th).first();
  if (!s || s.expira < agora()) return null;
  if (s.expira - agora() < (DIAS_SESSAO - 1) * 864e5) // renova uma vez por dia
    await env.DB.prepare("UPDATE sessoes SET expira = ? WHERE token_hash = ?").bind(agora() + DIAS_SESSAO * 864e5, th).run();
  return { id: s.user_id, email: s.email };
}
async function muitasFalhas(env, chave) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM falhas WHERE chave = ? AND ts > ?").bind(chave, agora() - 15 * 60e3).first();
  return (r?.n || 0) >= 8;
}
async function registrarFalha(env, chave) {
  await env.DB.prepare("INSERT INTO falhas (chave, ts) VALUES (?, ?)").bind(chave, agora()).run();
  await env.DB.prepare("DELETE FROM falhas WHERE ts < ?").bind(agora() - 24 * 3600e3).run();
}
const senhaFraca = s => typeof s !== "string" || s.length < 8 || s.length > 200;

/* ---------- auth ---------- */
async function auth(req, env, acao) {
  const corpo = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  if (acao === "setup") {
    if (!env.SETUP_TOKEN || !iguais(String(corpo.setup || ""), env.SETUP_TOKEN)) return erro(req, env, "Link de criação inválido.", 403);
    const tem = await env.DB.prepare("SELECT COUNT(*) AS n FROM usuarios").first();
    if (tem.n > 0) return erro(req, env, "O acesso já foi criado. Entre com seu e-mail e senha.", 409);
    const email = normEmail(corpo.email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return erro(req, env, "E-mail inválido.");
    if (senhaFraca(corpo.senha)) return erro(req, env, "A senha precisa ter pelo menos 8 caracteres.");
    const id = uuid(), codigo = codigoRecuperacao();
    const s = await gerarHash(corpo.senha, iterSenha(env)), c = await gerarHash(codigo, ITER_CODIGO);
    await env.DB.prepare("INSERT INTO usuarios (id, email, senha_hash, senha_salt, cod_hash, cod_salt, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, email, s.hash, s.salt, c.hash, c.salt, new Date().toISOString()).run();
    return json(req, env, { token: await criarSessao(env, id), user: { id, email }, codigo });
  }
  if (acao === "login") {
    const email = normEmail(corpo.email), chave = "login:" + email;
    if (await muitasFalhas(env, chave)) return erro(req, env, "Muitas tentativas. Espere 15 minutos.", 429);
    const u = await env.DB.prepare("SELECT * FROM usuarios WHERE email = ?").bind(email).first();
    const certo = u ? await confere(String(corpo.senha || ""), u.senha_salt, u.senha_hash) : (await pbkdf2("x", "y", iterSenha(env)), false);
    if (!certo) { await registrarFalha(env, chave); return erro(req, env, "Invalid login credentials", 400); }
    return json(req, env, { token: await criarSessao(env, u.id), user: { id: u.id, email: u.email } });
  }
  if (acao === "recuperar") {
    const email = normEmail(corpo.email), chave = "rec:" + email;
    if (await muitasFalhas(env, chave)) return erro(req, env, "Muitas tentativas. Espere 15 minutos.", 429);
    if (senhaFraca(corpo.senha)) return erro(req, env, "A senha precisa ter pelo menos 8 caracteres.");
    const u = await env.DB.prepare("SELECT * FROM usuarios WHERE email = ?").bind(email).first();
    const cod = String(corpo.codigo || "").trim().toUpperCase().replace(/\s+/g, "");
    const certo = u ? await confere(cod, u.cod_salt, u.cod_hash) : (await pbkdf2("x", "y", ITER_CODIGO), false);
    if (!certo) { await registrarFalha(env, chave); return erro(req, env, "E-mail ou código de recuperação errado.", 400); }
    const s = await gerarHash(corpo.senha, iterSenha(env));
    await env.DB.prepare("UPDATE usuarios SET senha_hash = ?, senha_salt = ? WHERE id = ?").bind(s.hash, s.salt, u.id).run();
    await env.DB.prepare("DELETE FROM sessoes WHERE user_id = ?").bind(u.id).run();
    return json(req, env, { token: await criarSessao(env, u.id), user: { id: u.id, email: u.email } });
  }
  const user = await usuarioDaSessao(req, env);
  if (acao === "sessao") return user ? json(req, env, { user }) : erro(req, env, "Sessão expirada.", 401);
  if (!user) return erro(req, env, "Faça login no KitDannis.", 401);
  if (acao === "sair") {
    const a = req.headers.get("Authorization") || "";
    await env.DB.prepare("DELETE FROM sessoes WHERE token_hash = ?").bind(await sha256(a.slice(7).trim())).run();
    return json(req, env, { ok: true });
  }
  if (acao === "senha") {
    if (senhaFraca(corpo.senha)) return erro(req, env, "A senha precisa ter pelo menos 8 caracteres.");
    const s = await gerarHash(corpo.senha, iterSenha(env));
    await env.DB.prepare("UPDATE usuarios SET senha_hash = ?, senha_salt = ? WHERE id = ?").bind(s.hash, s.salt, user.id).run();
    return json(req, env, { user });
  }
  if (acao === "novo-codigo") {
    const codigo = codigoRecuperacao(), c = await gerarHash(codigo, ITER_CODIGO);
    await env.DB.prepare("UPDATE usuarios SET cod_hash = ?, cod_salt = ? WHERE id = ?").bind(c.hash, c.salt, user.id).run();
    return json(req, env, { codigo });
  }
  return erro(req, env, "Rota desconhecida.", 404);
}

/* ---------- tabelas ---------- */
const TABELAS = {
  gastos: { pk: "id", cols: ["id", "descricao", "valor", "categoria", "fornecedor", "data", "pagamento", "pedreiro", "criado_em", "editado_em"], bool: ["pedreiro"] },
  notas: { pk: "id", cols: ["id", "arquivo", "tipo", "nome_arquivo", "fornecedor", "valor", "data", "numero", "gasto_id", "criado_em"], bool: [] },
  config: { pk: null, cols: ["chave", "valor"], bool: [], json: ["valor"] },
};
function paraSaida(t, linha) {
  const o = {};
  for (const c of ["user_id", ...TABELAS[t].cols]) if (c in linha) o[c] = linha[c];
  TABELAS[t].bool.forEach(c => { if (c in o) o[c] = !!o[c]; });
  (TABELAS[t].json || []).forEach(c => { if (typeof o[c] === "string") { try { o[c] = JSON.parse(o[c]); } catch {} } });
  return o;
}
function paraBanco(t, obj) {
  const def = TABELAS[t], o = {};
  for (const c of def.cols) if (obj[c] !== undefined) o[c] = obj[c];
  def.bool.forEach(c => { if (c in o) o[c] = o[c] ? 1 : 0; });
  (def.json || []).forEach(c => { if (c in o) o[c] = JSON.stringify(o[c]); });
  return o;
}
function filtros(t, url) {
  const w = [], v = [];
  for (const [k, val] of url.searchParams) {
    if (!k.startsWith("eq.")) continue;
    const c = k.slice(3);
    if (!TABELAS[t].cols.includes(c)) throw new Error("coluna inválida");
    w.push(`${c} = ?`); v.push(val);
  }
  return { w, v };
}
async function tabela(req, env, user, t) {
  const def = TABELAS[t]; if (!def) return erro(req, env, "Tabela desconhecida.", 404);
  const url = new URL(req.url);
  let f; try { f = filtros(t, url); } catch (e) { return erro(req, env, e.message); }
  const onde = ["user_id = ?", ...f.w].join(" AND "), args = [user.id, ...f.v];
  if (req.method === "GET") {
    let sql = `SELECT * FROM ${t} WHERE ${onde}`;
    const ord = url.searchParams.get("order");
    if (ord) { const [c, dir] = ord.split("."); if (!def.cols.includes(c)) return erro(req, env, "ordem inválida"); sql += ` ORDER BY ${c} ${dir === "asc" ? "ASC" : "DESC"}`; }
    const r = await env.DB.prepare(sql).bind(...args).all();
    return json(req, env, r.results.map(l => paraSaida(t, l)));
  }
  if (req.method === "DELETE") {
    if (!f.w.length) return erro(req, env, "Apagar exige filtro.");
    await env.DB.prepare(`DELETE FROM ${t} WHERE ${onde}`).bind(...args).run();
    return json(req, env, []);
  }
  const corpo = await req.json().catch(() => null);
  if (!corpo || typeof corpo !== "object") return erro(req, env, "Corpo inválido.");
  if (req.method === "PATCH") {
    if (!f.w.length) return erro(req, env, "Alterar exige filtro.");
    const o = paraBanco(t, corpo); delete o.id;
    const cs = Object.keys(o); if (!cs.length) return json(req, env, []);
    await env.DB.prepare(`UPDATE ${t} SET ${cs.map(c => `${c} = ?`).join(", ")} WHERE ${onde}`).bind(...cs.map(c => o[c]), ...args).run();
    const r = await env.DB.prepare(`SELECT * FROM ${t} WHERE ${onde}`).bind(...args).all();
    return json(req, env, r.results.map(l => paraSaida(t, l)));
  }
  if (req.method === "POST") {
    const linhas = Array.isArray(corpo) ? corpo : [corpo];
    if (!linhas.length || linhas.length > 500) return erro(req, env, "Quantidade de linhas inválida.");
    const upsert = req.headers.get("x-upsert") === "1";
    const stmts = [], saida = [];
    for (const l of linhas) {
      const o = paraBanco(t, l);
      if (def.pk && !o.id) o.id = uuid();
      if (t !== "config" && !o.criado_em) o.criado_em = new Date().toISOString();
      if (t === "gastos" && !o.data) o.data = new Date().toISOString().slice(0, 10);
      o.user_id = user.id;
      const cs = Object.keys(o);
      let sql = `INSERT INTO ${t} (${cs.join(", ")}) VALUES (${cs.map(() => "?").join(", ")})`;
      if (upsert && t === "config") sql += " ON CONFLICT (user_id, chave) DO UPDATE SET valor = excluded.valor";
      stmts.push(env.DB.prepare(sql).bind(...cs.map(c => o[c])));
      saida.push(o);
    }
    try { await env.DB.batch(stmts); } catch (e) { return erro(req, env, "Não consegui gravar: " + (e.message || e)); }
    return json(req, env, saida.map(o => paraSaida(t, o)), 201);
  }
  return erro(req, env, "Método não permitido.", 405);
}

/* ---------- arquivos (KV) ---------- */
const caminhoOk = (user, p) => typeof p === "string" && p.startsWith(user.id + "/") && !p.includes("..") && p.length < 400;
async function arquivos(req, env, user, resto) {
  const url = new URL(req.url);
  if (resto === "assinar" && req.method === "POST") {
    const { paths = [], segundos = 3600 } = await req.json().catch(() => ({}));
    const exp = agora() + Math.min(Number(segundos) || 3600, 86400) * 1000;
    const base = `${url.origin}/api/arq/`;
    const data = [];
    for (const p of paths.slice(0, 500)) {
      if (!caminhoOk(user, p)) { data.push({ path: p, signedUrl: null, error: "caminho inválido" }); continue; }
      const sig = await hmac(await chaveAssinatura(env), `${p}|${exp}`);
      data.push({ path: p, signedUrl: `${base}${p.split("/").map(encodeURIComponent).join("/")}?exp=${exp}&sig=${sig}` });
    }
    return json(req, env, data);
  }
  if (resto === "apagar" && req.method === "POST") {
    const { paths = [] } = await req.json().catch(() => ({}));
    for (const p of paths) if (caminhoOk(user, p)) await env.ARQUIVOS.delete(p);
    return json(req, env, paths);
  }
  const p = resto.split("/").map(decodeURIComponent).join("/");
  if (!caminhoOk(user, p)) return erro(req, env, "Caminho inválido.", 403);
  if (req.method === "PUT") {
    const tipo = req.headers.get("content-type") || "application/octet-stream";
    const corpo = await req.arrayBuffer();
    if (corpo.byteLength > 24 * 1024 * 1024) return erro(req, env, "Arquivo grande demais (máx. 24 MB).", 413);
    if (url.searchParams.get("upsert") !== "1" && await env.ARQUIVOS.get(p, { type: "stream" })) return erro(req, env, "Arquivo já existe.", 409);
    await env.ARQUIVOS.put(p, corpo, { metadata: { tipo } });
    return json(req, env, { path: p });
  }
  if (req.method === "GET") return entregarArquivo(req, env, p);
  return erro(req, env, "Método não permitido.", 405);
}
async function entregarArquivo(req, env, p) {
  const r = await env.ARQUIVOS.getWithMetadata(p, { type: "stream" });
  if (!r.value) return erro(req, env, "Arquivo não encontrado.", 404);
  return new Response(r.value, { headers: { ...corsDe(req, env), "Content-Type": r.metadata?.tipo || "application/octet-stream", "Cache-Control": "private, max-age=3600" } });
}
async function arquivoAssinado(req, env, resto) {
  const url = new URL(req.url), exp = Number(url.searchParams.get("exp")), sig = url.searchParams.get("sig") || "";
  const p = resto.split("/").map(decodeURIComponent).join("/");
  if (!exp || exp < agora()) return erro(req, env, "Link vencido.", 403);
  if (!iguais(await hmac(await chaveAssinatura(env), `${p}|${exp}`), sig)) return erro(req, env, "Assinatura inválida.", 403);
  return entregarArquivo(req, env, p);
}

/* ---------- IA: separar ---------- */
const CATEGORIAS = `- material: Material (cimento, areia, brita, tijolo, bloco, ferro, madeira, telha, argamassa)
- mao: Mão de obra (pedreiro, servente, diária, empreitada, eletricista e encanador quando for serviço)
- eletrica: Elétrica e hidráulica (fio, cabo, disjuntor, tomada, quadro, cano, conexão, registro, caixa d'água)
- acabamento: Acabamento (piso, revestimento, porcelanato, tinta, louça, metais, porta, janela, vidro, gesso)
- projeto: Projeto e documentação (arquiteto, engenheiro, ART, alvará, prefeitura, taxas, cartório, habite-se)
- locacao: Ferramentas e locação (caçamba, betoneira, andaime, ferramentas, frete, aluguel de equipamento)
- outros: o que não se encaixar acima`;
function promptGastos(texto, hoje, diaSemana, pedreiro) {
  return `Você organiza gastos da construção das kitnets KitDannis a partir de um texto falado em português do Brasil (pode ter erros de ditado).
Hoje é ${hoje} (${diaSemana}).

Categorias válidas (responda com o id):
${CATEGORIAS}

Formas de pagamento válidas: Pix, Dinheiro, Cartão, Boleto, Transferência. Use "" se não for dita. "cartão de crédito/débito" = "Cartão".

Regras:
- Normalmente a pessoa fala só o VALOR e o LOCAL (loja, depósito ou pessoa). Um item para cada valor citado.
- "fornecedor": o local ou a pessoa que recebeu, com a grafia de nome próprio. "" se não dito.${pedreiro ? `\n- O pedreiro se chama "${pedreiro}".` : ""}
- "categoria": deduza pelo tipo de local. Depósito, loja de material de construção, areal, olaria = material. Loja elétrica ou hidráulica = eletrica. Loja de pisos, tintas, vidraçaria, marmoraria = acabamento. Locadora, caçamba, frete = locacao. Prefeitura, cartório, engenheiro, arquiteto = projeto. Pedreiro, servente, ajudante = mao. Sem pista nenhuma = outros.
- "pedreiro": true se for pagamento ao pedreiro (quinzena, vale, adiantamento, parcela do pedreiro); senão false. Quando true, categoria = mao.
- "descricao": só o que foi comprado, se for dito (ex.: "cimento"); senão "". Para pedreiro: "Pagamento pedreiro", "Quinzena pedreiro" ou "Vale pedreiro" conforme o que for dito.
- "valor" é número em reais (ex.: "mil e duzentos" = 1200, "680 conto" = 680, "1.200,50" = 1200.5, "5 mil" = 5000). Se não for dito, null.
- "data" no formato AAAA-MM-DD. Sem data dita, use hoje. "ontem", "sexta passada" etc. são relativos a hoje.

Responda SOMENTE com JSON neste formato, sem texto antes ou depois:
{"itens":[{"descricao":"","valor":0,"categoria":"material","fornecedor":"","data":"${hoje}","pagamento":"","pedreiro":false}]}

Texto falado:
"""${texto}"""`;
}
const PROMPT_NOTA = `O arquivo é uma nota fiscal ou cupom de compra brasileiro (NF-e/DANFE, NFC-e, cupom ou recibo) de uma obra.
Extraia os dados e responda SOMENTE com JSON, sem texto antes ou depois:
{"fornecedor":"nome fantasia ou razão social do emitente","valor":0,"data":"AAAA-MM-DD","numero":"número da nota"}
- "valor": o VALOR TOTAL da nota em reais, como número (ex.: 1234.5). null se não der para ler.
- "data": a data de emissão. "" se não der para ler.
- "numero": só os dígitos do número da nota. "" se não houver.
- Use "" ou null em vez de inventar.`;
function extrairJSON(texto) {
  const i = texto.indexOf("{"), f = texto.lastIndexOf("}");
  if (i < 0 || f < i) throw new Error("resposta sem JSON");
  return JSON.parse(texto.slice(i, f + 1));
}
async function separar(req, env) {
  const chave = (env.ANTHROPIC_API_KEY || "").replace(/[\s"'“”]/g, "");
  if (!chave) return erro(req, env, "Falta o segredo ANTHROPIC_API_KEY no Cloudflare.", 500);
  const corpo = await req.json().catch(() => null);
  const conteudo = [];
  if (corpo?.modo === "gastos") {
    const texto = String(corpo.texto || "").slice(0, 4000).trim();
    if (!texto) return erro(req, env, "Texto vazio.");
    const hoje = /^\d{4}-\d{2}-\d{2}$/.test(corpo.hoje || "") ? corpo.hoje : new Date().toISOString().slice(0, 10);
    conteudo.push({ type: "text", text: promptGastos(texto, hoje, String(corpo.diaSemana || "").slice(0, 20), String(corpo.pedreiro || "").slice(0, 80)) });
  } else if (corpo?.modo === "nota") {
    const tipo = String(corpo.arquivo?.tipo || ""), dados = String(corpo.arquivo?.dados || "");
    if (!dados || dados.length > 12_000_000) return erro(req, env, "Arquivo ausente ou grande demais.");
    if (tipo === "application/pdf") conteudo.push({ type: "document", source: { type: "base64", media_type: tipo, data: dados } });
    else if (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(tipo)) conteudo.push({ type: "image", source: { type: "base64", media_type: tipo, data: dados } });
    else return erro(req, env, "Tipo de arquivo não aceito.");
    conteudo.push({ type: "text", text: PROMPT_NOTA });
  } else return erro(req, env, "Modo inválido.");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "authorization": `Bearer ${chave}`, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODELO, max_tokens: 4096, output_config: { effort: "low" }, messages: [{ role: "user", content: conteudo }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error("Erro da API Anthropic", r.status, JSON.stringify(j).slice(0, 1000)); return erro(req, env, `API ${r.status}: ${j?.error?.message || "sem detalhe"}`, 502); }
  const texto = (j.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  try { return json(req, env, extrairJSON(texto)); }
  catch { return erro(req, env, `Não entendi a resposta da IA (${j.stop_reason || "?"}).`, 502); }
}

/* ---------- tabelas do banco: criadas sozinhas na primeira vez ---------- */
const TABELAS_SQL = [ "CREATE TABLE IF NOT EXISTS usuarios (\n  id TEXT PRIMARY KEY,\n  email TEXT NOT NULL UNIQUE,\n  senha_hash TEXT NOT NULL,\n  senha_salt TEXT NOT NULL,\n  cod_hash TEXT NOT NULL,\n  cod_salt TEXT NOT NULL,\n  criado_em TEXT NOT NULL\n)", "CREATE TABLE IF NOT EXISTS sessoes (\n  token_hash TEXT PRIMARY KEY,\n  user_id TEXT NOT NULL,\n  expira INTEGER NOT NULL\n)", "CREATE TABLE IF NOT EXISTS falhas (\n  chave TEXT NOT NULL,\n  ts INTEGER NOT NULL\n)", "CREATE INDEX IF NOT EXISTS falhas_chave ON falhas (chave, ts)", "CREATE TABLE IF NOT EXISTS gastos (\n  id TEXT PRIMARY KEY,\n  user_id TEXT NOT NULL,\n  descricao TEXT NOT NULL DEFAULT '',\n  valor REAL NOT NULL CHECK (valor > 0),\n  categoria TEXT NOT NULL DEFAULT 'outros',\n  fornecedor TEXT NOT NULL DEFAULT '',\n  data TEXT NOT NULL,\n  pagamento TEXT NOT NULL DEFAULT '',\n  pedreiro INTEGER NOT NULL DEFAULT 0,\n  criado_em TEXT NOT NULL,\n  editado_em TEXT\n)", "CREATE INDEX IF NOT EXISTS gastos_user_data ON gastos (user_id, data DESC)", "CREATE TABLE IF NOT EXISTS notas (\n  id TEXT PRIMARY KEY,\n  user_id TEXT NOT NULL,\n  arquivo TEXT NOT NULL,\n  tipo TEXT NOT NULL DEFAULT '',\n  nome_arquivo TEXT NOT NULL DEFAULT '',\n  fornecedor TEXT NOT NULL DEFAULT '',\n  valor REAL,\n  data TEXT,\n  numero TEXT NOT NULL DEFAULT '',\n  gasto_id TEXT,\n  criado_em TEXT NOT NULL\n)", "CREATE INDEX IF NOT EXISTS notas_user_data ON notas (user_id, data DESC)", "CREATE TABLE IF NOT EXISTS config (\n  user_id TEXT NOT NULL,\n  chave TEXT NOT NULL,\n  valor TEXT NOT NULL,\n  PRIMARY KEY (user_id, chave)\n)" ];
let tabelasOk = false;
async function garantirTabelas(env) {
  if (tabelasOk) return;
  await env.DB.batch(TABELAS_SQL.map(s => env.DB.prepare(s)));
  tabelasOk = true;
}

/* ---------- roteador ---------- */
export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsDe(req, env) });
    const url = new URL(req.url), p = url.pathname;
    try {
      await garantirTabelas(env);
      if (p === "/" || p === "/api/saude") {
        await env.DB.prepare("SELECT 1").first();
        return json(req, env, { ok: true, app: "KitDannis", hora: new Date().toISOString() });
      }
      if (p.startsWith("/api/auth/")) return await auth(req, env, p.slice(10));
      if (p.startsWith("/api/arq/") && req.method === "GET" && url.searchParams.has("sig")) return await arquivoAssinado(req, env, p.slice(9));
      const user = await usuarioDaSessao(req, env);
      if (!user) return erro(req, env, "Faça login no KitDannis.", 401);
      if (p.startsWith("/api/t/")) return await tabela(req, env, user, p.slice(7));
      if (p.startsWith("/api/arq/")) return await arquivos(req, env, user, p.slice(9));
      if (p === "/api/separar" && req.method === "POST") return await separar(req, env);
      return erro(req, env, "Rota desconhecida.", 404);
    } catch (e) {
      console.error(e);
      return erro(req, env, "Erro no servidor: " + (e.message || e), 500);
    }
  },
};
