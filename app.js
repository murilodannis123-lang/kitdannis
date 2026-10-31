/* KitDannis — gestão da obra
 * Site estático (GitHub Pages) + Supabase (login, banco, arquivos e função de IA).
 */
"use strict";

const CATS = [
  { id: "material",   nome: "Material" },
  { id: "mao",        nome: "Mão de obra" },
  { id: "eletrica",   nome: "Elétrica e hidráulica" },
  { id: "acabamento", nome: "Acabamento" },
  { id: "projeto",    nome: "Projeto e documentação" },
  { id: "locacao",    nome: "Ferramentas e locação" },
  { id: "outros",     nome: "Outros" },
];
const PAGTOS = ["Pix", "Dinheiro", "Cartão", "Boleto", "Transferência"];
const catById = Object.fromEntries(CATS.map(c => [c.id, c]));
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const MES_CURTO = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
const DIAS_SEMANA = ["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"];
const VIEWS = ["inicio", "lancar", "pedreiro", "gastos", "notas", "aluguel"];
const BUCKET = "notas";
const $ = id => document.getElementById(id);

const CFG = window.KITDANNIS_CONFIG || {};
const configurado = /^https:\/\/.+/.test(CFG.SUPABASE_URL || "") && (CFG.SUPABASE_ANON_KEY || "").length > 20;
const sb = configurado ? supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "kitdannis-auth" },
}) : null;

let usuario = null;
let gastos = [];
let notas = [];
let acordo = null;
let orcamento = null;
let aluguel = null;
let filtro = "todos";
let rascunho = [];
let editandoId = null;
let notaEdit = null;
let nfTocados = new Set();
const urlsAssinadas = new Map(); // caminho -> {url, expira}

/* ---------- Utilidades ---------- */
function hoje() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function parseBRL(v) {
  if (typeof v === "number") return v;
  if (v == null) return NaN;
  let s = String(v).replace(/R\$|\s/gi, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ""); // "1.150" = mil cento e cinquenta
  return Number(s);
}
function fmtValorInput(n) { return (typeof n === "number" && isFinite(n)) ? n.toFixed(2).replace(".", ",") : ""; }
function corCat(id) { return `var(--c-${catById[id] ? id : "outros"})`; }
function fmtDia(iso) { const [, m, d] = (iso || "").split("-"); return d ? `${d}/${m}` : (iso || ""); }
function fmtDiaLongo(iso) { const [y, m, d] = (iso || "").split("-"); return d ? `${Number(d)} ${MES_CURTO[Number(m) - 1]} ${y}` : ""; }
function dataBR(iso) { const [y, m, d] = (iso || "").split("-"); return d ? `${d}/${m}/${y}` : ""; }
function setMsg(t, tipo) { const m = $("msgLanc"); m.textContent = t || ""; m.className = "msg" + (tipo ? " " + tipo : ""); }
function msgNota(t, tipo) { const m = $("msgNota"); m.textContent = t || ""; m.className = "msg" + (tipo ? " " + tipo : ""); }
let toastT;
function toast(t) { const el = $("toast"); el.textContent = t; el.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 2600); }
function setStatus(t, estado) { $("statusTxt").textContent = t; $("status").className = "sync" + (estado ? " " + estado : ""); }
function iniciais(s) { return (s || "?").trim().split(/\s+/).slice(0, 2).map(p => p[0]).join("").toUpperCase() || "?"; }
const num = v => (v == null || v === "" ? null : Number(v));

/* ---------- Banco: conversão entre colunas e objetos ---------- */
const deGasto = r => ({
  id: r.id, descricao: r.descricao || "", valor: num(r.valor) || 0, categoria: r.categoria || "outros",
  fornecedor: r.fornecedor || "", data: r.data || "", pagamento: r.pagamento || "", pedreiro: !!r.pedreiro,
  criadoEm: r.criado_em || "", editadoEm: r.editado_em || "",
});
const deNota = r => ({
  id: r.id, arquivo: r.arquivo, tipo: r.tipo || "", nomeArquivo: r.nome_arquivo || "", fornecedor: r.fornecedor || "",
  valor: num(r.valor), data: r.data || "", numero: r.numero || "", gastoId: r.gasto_id || "", criadoEm: r.criado_em || "",
});

async function carregar() {
  if (!sb || !usuario) return;
  const [g, n, c] = await Promise.all([
    sb.from("gastos").select("*").order("data", { ascending: false }),
    sb.from("notas").select("*").order("data", { ascending: false }),
    sb.from("config").select("chave, valor"),
  ]);
  if (g.error || n.error || c.error) { setStatus("Sem conexão", "off"); return; }
  gastos = g.data.map(deGasto);
  notas = n.data.map(deNota);
  const cfg = Object.fromEntries(c.data.map(x => [x.chave, x.valor]));
  acordo = cfg.pedreiro || null;
  orcamento = cfg.obra?.orcamento > 0 ? Number(cfg.obra.orcamento) : null;
  aluguel = cfg.aluguel || null;
  setStatus("Sincronizado", "on");
  await assinarUrls();
  render();
}
async function salvarConfig(chave, valor) {
  const { error } = await sb.from("config").upsert({ user_id: usuario.id, chave, valor }, { onConflict: "user_id,chave" });
  if (error) throw error;
}

/* ---------- Navegação por abas ---------- */
function viewAtual() { const h = location.hash.slice(1); return VIEWS.includes(h) ? h : "inicio"; }
function mostrarView() {
  const v = viewAtual();
  document.querySelectorAll(".view").forEach(s => { s.hidden = s.dataset.view !== v; });
  const aba = v === "notas" ? "gastos" : v;
  document.querySelectorAll(".tab").forEach(t => { if (t.dataset.go === aba) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current"); });
  document.querySelectorAll(".seg [data-go]").forEach(t => t.setAttribute("aria-pressed", t.dataset.go === v ? "true" : "false"));
  window.scrollTo({ top: 0 });
  if (v === "lancar" && rascunho.length === 0) { try { $("falado").focus({ preventScroll: true }); } catch {} }
}
function ir(v) { if (location.hash === "#" + v) mostrarView(); else location.hash = v; }
document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => ir(b.dataset.go)));
window.addEventListener("hashchange", mostrarView);

/* ---------- Pedreiro ---------- */
function isoToUTC(iso) { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); }
function utcToIso(t) { const d = new Date(t); return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0"); }
function addDias(iso, n) { return utcToIso(isoToUTC(iso) + n * 86400000); }
function fimDoMes(iso) { const [y, m] = iso.split("-").map(Number); return utcToIso(Date.UTC(y, m, 0)); }
function gerarQuinzenas(a) {
  if (!a?.inicio || !/^\d{4}-\d{2}-\d{2}$/.test(a.inicio)) return [];
  const hj = hoje();
  const limite = a.fim && a.fim < hj ? a.fim : hj;
  const out = [];
  let ini = a.inicio;
  while (ini <= limite && out.length < 200) {
    let fim = a.contagem === "mes" ? (Number(ini.slice(8)) <= 15 ? ini.slice(0, 8) + "15" : fimDoMes(ini)) : addDias(ini, 14);
    if (a.fim && fim > a.fim) fim = a.fim;
    out.push({ ini, fim, fechada: fim < hj || (a.fim && fim === a.fim && a.fim <= hj) });
    ini = addDias(fim, 1);
  }
  return out;
}
function calcCombinado(a) {
  if (!a || !(a.valor > 0)) return 0;
  if (a.tipo === "diaria") return (a.dias || []).length * a.valor;
  if (a.tipo === "quinzena") return gerarQuinzenas(a).filter(q => q.fechada).length * a.valor;
  return a.valor;
}
function contasPedreiro() {
  const pags = gastos.filter(g => g.pedreiro).sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  const pago = pags.reduce((s, g) => s + (Number(g.valor) || 0), 0);
  const tem = !!(acordo && acordo.valor > 0);
  const comb = tem ? calcCombinado(acordo) : 0;
  return { pags, pago, tem, comb, saldo: comb - pago };
}
function linhaGasto(g, opts = {}) {
  const b = document.createElement("button"); b.type = "button"; b.className = "row";
  const titulo = g.descricao || g.fornecedor || "(sem descrição)";
  const cat = g.pedreiro ? "Pedreiro" : (catById[g.categoria]?.nome || "Outros");
  b.innerHTML = `<div class="ico"></div><div class="desc"><b></b><span></span></div>
    <div class="val"><b class="num"></b><span class="num"></span></div>`;
  b.querySelector(".ico").style.background = corCat(g.categoria);
  b.querySelector(".ico").textContent = iniciais(g.fornecedor || g.descricao || cat);
  b.querySelector(".desc b").textContent = titulo;
  b.querySelector(".desc span").textContent = [cat, g.descricao ? g.fornecedor : "", g.pagamento].filter(Boolean).join(" · ");
  if (notas.some(n => n.gastoId === g.id)) { const c = document.createElement("span"); c.className = "clip"; c.textContent = " · com nota"; b.querySelector(".desc span").appendChild(c); }
  b.querySelector(".val b").textContent = brl.format(Number(g.valor) || 0);
  b.querySelector(".val span").textContent = opts.dataLonga ? fmtDiaLongo(g.data) : fmtDia(g.data);
  b.setAttribute("aria-label", `Editar ${titulo}, ${brl.format(Number(g.valor) || 0)}`);
  b.onclick = () => abrirEdicao(g);
  return b;
}
function renderPedreiro() {
  const { pags, pago, tem, comb, saldo } = contasPedreiro();
  $("pedVazio").hidden = tem || !$("acordoForm").hidden;
  $("btnAcordo").textContent = tem ? "Editar acordo" : "Definir acordo";
  $("btnAcordo").hidden = !$("acordoForm").hidden;
  $("pedResumo").hidden = !tem;
  $("pedResumo").style.display = tem ? "flex" : "none";
  $("pedDias").hidden = !(tem && acordo.tipo === "diaria");
  $("pedQuinz").hidden = !(tem && acordo.tipo === "quinzena");
  $("pedNome").textContent = acordo?.nome || "Contas com o pedreiro";
  $("pedIni").textContent = acordo?.nome ? iniciais(acordo.nome) : "P";
  if (!tem) $("pedSub").textContent = "Nenhum acordo definido";
  if (tem) {
    const dias = acordo.dias || [];
    let sub;
    if (acordo.tipo === "diaria") sub = `Diária de ${brl.format(acordo.valor)} · ${dias.length} ${dias.length === 1 ? "dia" : "dias"}`;
    else if (acordo.tipo === "quinzena") sub = `Quinzena de ${brl.format(acordo.valor)}` + (acordo.inicio ? ` · desde ${fmtDiaLongo(acordo.inicio)}` : "");
    else sub = `Empreitada de ${brl.format(acordo.valor)}`;
    $("pedSub").textContent = sub;
    $("pedComb").textContent = brl.format(comb);
    $("pedPago").textContent = brl.format(pago);
    $("pedSaldoLbl").textContent = saldo >= -0.004 ? "Falta pagar" : "Pago a mais";
    $("pedSaldo").textContent = brl.format(Math.abs(saldo));
    $("pedSaldo").className = "num " + (Math.abs(saldo) < 0.005 ? "saldo-zero" : "saldo-pos");
    $("pedBarra").style.width = (comb > 0 ? Math.min(100, pago / comb * 100) : 0) + "%";
    if (acordo.tipo === "quinzena") {
      const box = $("quinzLista"); box.innerHTML = "";
      const qs = gerarQuinzenas(acordo);
      if (!qs.length) box.innerHTML = '<div class="vazio">Informe no acordo a data em que ele começou para gerar as quinzenas.</div>';
      let resto = pago;
      const NOMES = { paga: "Paga", parcial: "Parcial", aberto: "Em aberto", andamento: "Em andamento" };
      qs.map((q, i) => {
        let st, falta = 0;
        if (!q.fechada) st = "andamento";
        else if (resto >= acordo.valor - 0.004) { st = "paga"; resto -= acordo.valor; }
        else if (resto > 0.004) { st = "parcial"; falta = acordo.valor - resto; resto = 0; }
        else { st = "aberto"; falta = acordo.valor; }
        return { ...q, n: i + 1, st, falta };
      }).reverse().forEach(q => {
        const el = document.createElement("div"); el.className = "qz";
        el.innerHTML = `<b>Quinzena ${q.n}</b><span class="per num">${fmtDia(q.ini)} a ${fmtDia(q.fim)}</span>
          <div class="tag"><span class="pill ${q.st}">${NOMES[q.st]}</span><span class="num">${q.st === "parcial" || q.st === "aberto" ? "falta " + brl.format(q.falta) : brl.format(acordo.valor)}</span></div>`;
        box.appendChild(el);
      });
    }
    if (acordo.tipo === "diaria") {
      $("pedDiasLbl").textContent = `Dias trabalhados: ${dias.length}`;
      const box = $("diasLista"); box.innerHTML = "";
      dias.slice().sort().reverse().forEach(d => {
        const c = document.createElement("span"); c.className = "dia-chip num";
        c.innerHTML = `<span></span><button type="button">×</button>`;
        c.firstChild.textContent = fmtDia(d);
        c.querySelector("button").setAttribute("aria-label", "Desmarcar " + fmtDia(d));
        c.querySelector("button").onclick = () => salvarAcordo({ ...acordo, dias: dias.filter(x => x !== d) });
        box.appendChild(c);
      });
    }
  }
  const lista = $("pagLista"); lista.innerHTML = "";
  $("pagTit").textContent = tem && acordo.tipo === "empreitada" ? "Extrato do pedreiro" : "Pagamentos";
  if (!pags.length) { lista.innerHTML = '<div class="vazio">Nenhum pagamento ainda. Também dá para falar no Lançar: <b>"pedreiro, 5.000 no Pix"</b>.</div>'; return; }
  if (!(tem && acordo.tipo === "empreitada")) { pags.forEach(g => lista.appendChild(linhaGasto(g, { dataLonga: true }))); return; }
  // Empreitada: extrato do mais antigo para o mais novo, com o saldo devedor caindo
  const ini = document.createElement("div"); ini.className = "row ext-ini";
  ini.innerHTML = `<div class="ico">R$</div><div class="desc"><b>Valor combinado</b><span></span></div><div class="val"><b class="num"></b><span class="saldo">saldo inicial</span></div>`;
  ini.querySelector(".desc span").textContent = acordo.inicio ? "obra iniciada em " + fmtDiaLongo(acordo.inicio) : "empreitada";
  ini.querySelector(".val b").textContent = brl.format(acordo.valor);
  lista.appendChild(ini);
  let saldoCorr = acordo.valor;
  pags.slice().sort((a, b) => (a.data || "").localeCompare(b.data || "") || (a.criadoEm || "").localeCompare(b.criadoEm || "")).forEach(g => {
    saldoCorr -= Number(g.valor) || 0;
    const r = linhaGasto(g);
    const [, , dd] = (g.data || "--").split("-");
    r.querySelector(".ico").textContent = dd || "?";
    r.querySelector(".desc b").textContent = fmtDiaLongo(g.data) || "Sem data";
    r.querySelector(".desc span").textContent = [g.descricao, g.pagamento].filter(Boolean).join(" · ");
    const vb = r.querySelector(".val b"); vb.textContent = "− " + brl.format(Number(g.valor) || 0); vb.classList.add("menos");
    const vs = r.querySelector(".val span"); vs.className = "saldo num"; vs.textContent = "saldo " + brl.format(saldoCorr);
    lista.appendChild(r);
  });
  const fim = document.createElement("div"); fim.className = "ext-fim";
  fim.innerHTML = `<span>${saldoCorr >= -0.004 ? "Saldo devedor" : "Pago a mais"}</span><strong class="num"></strong>`;
  fim.querySelector("strong").textContent = brl.format(Math.abs(saldoCorr));
  if (Math.abs(saldoCorr) < 0.005) fim.querySelector("strong").style.color = "var(--ok)";
  lista.appendChild(fim);
}
async function salvarAcordo(novo) {
  try { await salvarConfig("pedreiro", novo); acordo = novo; render(); return true; }
  catch { toast("Não consegui salvar. Tente de novo."); return false; }
}
function atualizaLblAcordo() {
  const t = $("acTipo").value;
  $("acValorLbl").textContent = t === "diaria" ? "Valor da diária (R$)" : t === "quinzena" ? "Valor da quinzena (R$)" : "Valor total combinado (R$)";
  document.querySelectorAll("[data-q]").forEach(el => { el.hidden = t !== "quinzena"; });
  document.querySelectorAll("[data-qe]").forEach(el => { el.hidden = t === "diaria"; });
}
$("acTipo").onchange = atualizaLblAcordo;
$("btnAcordo").onclick = () => {
  $("acNome").value = acordo?.nome || ""; $("acTipo").value = acordo?.tipo || "empreitada";
  $("acValor").value = acordo?.valor ? fmtValorInput(acordo.valor) : "";
  $("acInicio").value = acordo?.inicio || ""; $("acFim").value = acordo?.fim || "";
  $("acContagem").value = acordo?.contagem || "corrida";
  atualizaLblAcordo();
  $("acordoForm").hidden = false; renderPedreiro(); $("acNome").focus();
};
$("btnAcCancelar").onclick = () => { $("acordoForm").hidden = true; renderPedreiro(); };
$("btnAcSalvar").onclick = async () => {
  const v = parseBRL($("acValor").value);
  if (!(v > 0)) { $("acValor").focus(); return; }
  const tipo = $("acTipo").value;
  if (tipo === "quinzena" && !$("acInicio").value) { $("acInicio").focus(); return; }
  $("acordoForm").hidden = true;
  const ok = await salvarAcordo({
    nome: $("acNome").value.trim(), tipo, valor: Math.round(v * 100) / 100, dias: acordo?.dias || [],
    inicio: $("acInicio").value || "", fim: $("acFim").value || "", contagem: $("acContagem").value,
  });
  if (ok) toast("Acordo salvo"); else $("acordoForm").hidden = false;
};
$("diaInput").value = hoje();
$("btnDia").onclick = async () => {
  const d = $("diaInput").value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !acordo) return;
  const dias = acordo.dias || [];
  if (dias.includes(d)) { toast(`O dia ${fmtDia(d)} já está marcado`); return; }
  if (await salvarAcordo({ ...acordo, dias: [...dias, d] })) toast(`Dia ${fmtDia(d)} marcado`);
};
$("btnPagar").onclick = () => {
  editandoId = null;
  rascunho = [novoItem({ descricao: acordo?.tipo === "quinzena" ? "Quinzena pedreiro" : "Pagamento pedreiro", categoria: "mao", pedreiro: true, fornecedor: acordo?.nome || "", valor: acordo?.tipo === "quinzena" ? acordo.valor : null })];
  setMsg(""); renderRascunho(); ir("lancar");
};

/* ---------- Render geral ---------- */
function render() {
  renderPedreiro();
  renderNotas();
  if (typeof renderAluguel === "function") renderAluguel();
  const total = gastos.reduce((s, g) => s + (Number(g.valor) || 0), 0);
  $("total").textContent = brl.format(total);

  if (orcamento > 0) {
    const rest = orcamento - total, pct = Math.round(total / orcamento * 100);
    $("orcBloco").hidden = false;
    $("barraOrc").classList.toggle("estouro", rest < 0);
    $("barraOrcFill").style.width = Math.min(100, total / orcamento * 100) + "%";
    $("orcInfo").innerHTML = rest >= 0
      ? `<b class="num">${pct}%</b> de ${brl.format(orcamento)} · restam <b class="num">${brl.format(rest)}</b>`
      : `<b class="num" style="color:var(--bad)">${brl.format(-rest)} acima</b> do orçamento de ${brl.format(orcamento)}`;
    $("btnOrc").textContent = "Alterar";
  } else {
    $("orcBloco").hidden = true; $("orcInfo").textContent = "Nenhum orçamento definido"; $("btnOrc").textContent = "Definir orçamento";
  }

  const mesAtual = hoje().slice(0, 7);
  const doMes = gastos.filter(g => (g.data || "").startsWith(mesAtual));
  $("stMes").textContent = brl.format(doMes.reduce((s, g) => s + (Number(g.valor) || 0), 0));
  $("stMesLbl").textContent = MESES[Number(mesAtual.slice(5)) - 1] + ` · ${doMes.length} ${doMes.length === 1 ? "lançamento" : "lançamentos"}`;
  $("stQtd").textContent = gastos.length;
  const ordenados = gastos.slice().sort((a, b) => (b.data || "").localeCompare(a.data || "") || (b.criadoEm || "").localeCompare(a.criadoEm || ""));
  $("stUlt").textContent = ordenados[0] ? "último em " + fmtDia(ordenados[0].data) : "nenhum ainda";
  const ped = contasPedreiro();
  if (ped.tem) {
    $("stPed").textContent = brl.format(Math.abs(ped.saldo));
    $("stPed").style.color = Math.abs(ped.saldo) < 0.005 ? "var(--ok)" : "var(--bad)";
    $("stPedLbl").textContent = ped.saldo >= -0.004 ? (Math.abs(ped.saldo) < 0.005 ? "em dia" : "falta pagar") : "pago a mais";
  } else { $("stPed").textContent = "—"; $("stPed").style.color = ""; $("stPedLbl").textContent = "definir acordo"; }

  const porCat = {};
  gastos.forEach(g => { const c = catById[g.categoria] ? g.categoria : "outros"; porCat[c] = (porCat[c] || 0) + (Number(g.valor) || 0); });
  const cats = $("cats"); cats.innerHTML = "";
  const usadas = CATS.filter(c => porCat[c.id]).sort((a, b) => porCat[b.id] - porCat[a.id]);
  if (!usadas.length) cats.innerHTML = '<div class="vazio">Os totais por categoria aparecem aqui conforme você lança os gastos.</div>';
  else {
    const max = porCat[usadas[0].id];
    usadas.forEach(c => {
      const row = document.createElement("div"); row.className = "cat-row";
      const pct = total ? Math.round(porCat[c.id] / total * 100) : 0;
      row.innerHTML = `<div class="nome"><span class="dot"></span><span></span></div>
        <div class="valor num">${brl.format(porCat[c.id])}<span class="pct">${pct}%</span></div>
        <div class="bar"><span></span></div>`;
      row.querySelector(".dot").style.background = corCat(c.id);
      row.querySelector(".bar span").style.cssText = `width:${porCat[c.id] / max * 100}%;background:${corCat(c.id)}`;
      row.querySelector(".nome span:last-child").textContent = c.nome;
      cats.appendChild(row);
    });
  }

  const ult = $("ultimos"); ult.innerHTML = "";
  if (!ordenados.length) ult.innerHTML = '<div class="vazio">Nenhum gasto lançado ainda. Toque em <b>Lançar</b> e fale, por exemplo, <b>"1.200 no Areal São José, Pix"</b>.</div>';
  else ordenados.slice(0, 5).forEach(g => ult.appendChild(linhaGasto(g)));

  if (filtro !== "todos" && !porCat[filtro]) filtro = "todos";
  const f = $("filtros"); f.innerHTML = "";
  [{ id: "todos", nome: "Todos" }, ...usadas].forEach(c => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.textContent = c.nome;
    b.setAttribute("aria-pressed", String(filtro === c.id));
    b.onclick = () => { filtro = c.id; render(); };
    f.appendChild(b);
  });
  $("btnCsv").hidden = !gastos.length;
  const lista = $("lista"); lista.innerHTML = "";
  const vis = ordenados.filter(g => filtro === "todos" || (catById[g.categoria] ? g.categoria : "outros") === filtro);
  if (!vis.length) { lista.innerHTML = '<div class="vazio">Nenhum lançamento ainda.</div>'; return; }
  const grupos = new Map();
  vis.forEach(g => { const k = (g.data || "sem-data").slice(0, 7); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(g); });
  grupos.forEach((itens, k) => {
    const [ano, m] = k.split("-");
    const head = document.createElement("div"); head.className = "mes-head";
    head.innerHTML = `<h3></h3><span class="num">${brl.format(itens.reduce((s, g) => s + (Number(g.valor) || 0), 0))}</span>`;
    head.querySelector("h3").textContent = m ? `${MESES[Number(m) - 1]} de ${ano}` : "Sem data";
    const rows = document.createElement("div"); rows.className = "rows";
    itens.forEach(g => rows.appendChild(linhaGasto(g)));
    lista.appendChild(head); lista.appendChild(rows);
  });
}

/* ---------- Rascunho (revisão antes de salvar) ---------- */
function novoItem(base = {}) {
  return {
    descricao: base.descricao || "",
    valor: typeof base.valor === "number" && isFinite(base.valor) ? base.valor : null,
    categoria: base.pedreiro === true ? "mao" : (catById[base.categoria] ? base.categoria : "material"),
    fornecedor: base.fornecedor || "",
    data: /^\d{4}-\d{2}-\d{2}$/.test(base.data || "") ? base.data : hoje(),
    pagamento: PAGTOS.includes(base.pagamento) ? base.pagamento : "",
    pedreiro: base.pedreiro === true,
  };
}
function renderRascunho() {
  const box = $("rascunho"); box.innerHTML = "";
  const ativo = rascunho.length > 0;
  box.hidden = !ativo; $("acoesRasc").hidden = !ativo;
  $("acoesRapido").hidden = ativo; $("rapido").hidden = ativo; $("dicaVoz").hidden = ativo;
  $("dicaColar").hidden = true;
  $("hLanc").textContent = editandoId ? "Editar lançamento" : ativo ? "Confira e salve" : "Novo lançamento";
  $("btnExcluir").hidden = !editandoId; $("btnAddItem").hidden = !!editandoId;
  $("btnExcluir").classList.remove("armado"); $("btnExcluir").textContent = "Excluir";
  $("btnSalvar").textContent = editandoId ? "Salvar alteração" : (rascunho.length > 1 ? `Salvar ${rascunho.length} gastos` : "Salvar gasto");
  rascunho.forEach((it, i) => {
    const el = document.createElement("div"); el.className = "item";
    el.style.borderLeftColor = corCat(it.categoria);
    const p = `it${i}`;
    el.innerHTML = `
      <div class="item-top"><span>${editandoId ? "Lançamento" : "Item " + (i + 1)}</span>${rascunho.length > 1 ? '<button type="button" class="btn sm" data-rm>Remover</button>' : ""}</div>
      <label class="full" for="${p}f">Local / quem recebeu<input id="${p}f" data-k="fornecedor" placeholder="Ex.: Casa do Construtor"></label>
      <label for="${p}v">Valor (R$)<input id="${p}v" data-k="valor" inputmode="decimal" placeholder="0,00"></label>
      <label for="${p}dt">Data<input id="${p}dt" type="date" data-k="data"></label>
      <label for="${p}c">Categoria<select id="${p}c" data-k="categoria">${CATS.map(c => `<option value="${c.id}">${c.nome}</option>`).join("")}</select></label>
      <label for="${p}p">Pagamento<select id="${p}p" data-k="pagamento"><option value="">Não informado</option>${PAGTOS.map(x => `<option>${x}</option>`).join("")}</select></label>
      <label class="full" for="${p}d">Descrição<input id="${p}d" data-k="descricao" placeholder="Opcional"></label>
      <label class="check full" for="${p}pd"><input type="checkbox" id="${p}pd" data-k="pedreiro"> Pagamento ao pedreiro</label>`;
    el.querySelectorAll("[data-k]").forEach(inp => {
      const k = inp.dataset.k;
      if (k === "pedreiro") {
        inp.checked = !!it.pedreiro;
        inp.addEventListener("change", () => {
          it.pedreiro = inp.checked;
          if (inp.checked) { it.categoria = "mao"; el.querySelector('[data-k="categoria"]').value = "mao"; el.style.borderLeftColor = corCat("mao"); }
        });
        return;
      }
      inp.value = k === "valor" ? fmtValorInput(it.valor) : (it[k] || "");
      inp.addEventListener("input", () => {
        it[k] = k === "valor" ? parseBRL(inp.value) : inp.value;
        if (k === "categoria") el.style.borderLeftColor = corCat(inp.value);
      });
    });
    const rm = el.querySelector("[data-rm]");
    if (rm) rm.onclick = () => { rascunho.splice(i, 1); renderRascunho(); };
    box.appendChild(el);
  });
}
function fecharRascunho() { rascunho = []; editandoId = null; renderRascunho(); }
function abrirEdicao(g) { editandoId = g.id; rascunho = [novoItem(g)]; setMsg(""); renderRascunho(); ir("lancar"); }

/* ---------- IA (função "separar" no Supabase, que chama a API da Anthropic) ---------- */
async function chamarIA(corpo) {
  const { data, error } = await sb.functions.invoke("separar", { body: corpo });
  if (error) {
    let detalhe = "";
    try { detalhe = (await error.context?.json())?.erro || ""; } catch {}
    throw new Error(detalhe || error.message || "falha");
  }
  return data;
}
async function separar() {
  const texto = $("falado").value.trim();
  if (!texto) { setMsg("Fale ou digite o gasto antes de separar.", "erro"); $("falado").focus(); return; }
  const btn = $("btnSeparar"); btn.disabled = true; btn.textContent = "Separando…"; setMsg("");
  try {
    const d = new Date();
    const res = await chamarIA({ modo: "gastos", texto, hoje: hoje(), diaSemana: DIAS_SEMANA[d.getDay()], pedreiro: acordo?.nome || "" });
    const itens = Array.isArray(res?.itens) ? res.itens : [];
    if (!itens.length) throw new Error("vazio");
    rascunho = itens.map(x => novoItem({ ...x, valor: x.valor == null ? null : parseBRL(x.valor) }));
    editandoId = null;
    renderRascunho();
    const semValor = rascunho.filter(x => !(x.valor > 0)).length;
    setMsg(semValor ? `${semValor === 1 ? "Um item ficou" : semValor + " itens ficaram"} sem valor. Complete antes de salvar.` : "");
  } catch (e) {
    setMsg(`Não consegui separar esse texto (${e?.message || "erro"}). Tente de novo ou toque em Preencher na mão.`, "erro");
    console.warn("separar:", e);
  } finally { btn.disabled = false; btn.textContent = "Separar gastos"; }
}

/* ---------- Salvar / excluir gasto ---------- */
async function salvar() {
  for (const [i, it] of rascunho.entries()) {
    const qual = rascunho.length > 1 ? " do item " + (i + 1) : "";
    if (!it.descricao.trim() && !(it.fornecedor || "").trim()) { setMsg(`Informe o local ou a descrição${qual}.`, "erro"); return; }
    if (!(Number(it.valor) > 0)) { setMsg(`Falta o valor${qual}.`, "erro"); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(it.data)) { setMsg(`Data inválida${qual}.`, "erro"); return; }
  }
  const btn = $("btnSalvar"); btn.disabled = true;
  try {
    const linhas = rascunho.map(it => ({
      descricao: it.descricao.trim(), valor: Math.round(Number(it.valor) * 100) / 100,
      categoria: it.pedreiro ? "mao" : it.categoria, fornecedor: (it.fornecedor || "").trim(),
      data: it.data, pagamento: it.pagamento || "", pedreiro: !!it.pedreiro,
    }));
    const r = editandoId
      ? await sb.from("gastos").update({ ...linhas[0], editado_em: new Date().toISOString() }).eq("id", editandoId)
      : await sb.from("gastos").insert(linhas);
    if (r.error) throw r.error;
    const n = rascunho.length, ed = !!editandoId, foiPedreiro = rascunho.every(x => x.pedreiro);
    fecharRascunho(); $("falado").value = ""; setMsg("");
    toast(ed ? "Alteração salva" : (n > 1 ? `${n} gastos salvos` : "Gasto salvo"));
    await carregar();
    ir(foiPedreiro && !ed ? "pedreiro" : "inicio");
  } catch (e) {
    console.warn(e);
    setMsg("Não consegui salvar. Confira a internet e tente de novo.", "erro");
  } finally { btn.disabled = false; }
}
async function excluir() {
  const b = $("btnExcluir");
  if (!b.classList.contains("armado")) { b.classList.add("armado"); b.textContent = "Toque de novo para excluir"; return; }
  const { error } = await sb.from("gastos").delete().eq("id", editandoId);
  if (error) { setMsg("Não consegui excluir. Tente de novo.", "erro"); return; }
  fecharRascunho(); toast("Gasto excluído"); await carregar(); ir("gastos");
}

/* ---------- Orçamento ---------- */
$("btnOrc").onclick = () => { $("orcEdit").hidden = false; $("orcLine").hidden = true; $("orcInput").value = orcamento > 0 ? fmtValorInput(orcamento) : ""; $("orcInput").focus(); };
$("btnOrcCancelar").onclick = () => { $("orcEdit").hidden = true; $("orcLine").hidden = false; };
$("btnOrcSalvar").onclick = async () => {
  const v = parseBRL($("orcInput").value);
  if (!(v >= 0)) { $("orcInput").focus(); return; }
  try { await salvarConfig("obra", { orcamento: v }); orcamento = v > 0 ? v : null; $("orcEdit").hidden = true; $("orcLine").hidden = false; render(); toast("Orçamento salvo"); }
  catch { toast("Não consegui salvar. Tente de novo."); }
};

/* ---------- Arquivos: baixar ou compartilhar ---------- */
async function entregarArquivo(nome, blob) {
  const file = new File([blob], nome, { type: blob.type || "application/octet-stream" });
  const celular = matchMedia("(pointer: coarse)").matches;
  if (celular && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: nome }); return; }
    catch (e) { if (e?.name === "AbortError") return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function csvDe(linhas) { return "﻿" + linhas.map(l => l.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n"); }
function csvGastos() {
  const linhas = [["Data", "Local", "Descrição", "Categoria", "Pagamento", "Pedreiro", "Nota fiscal", "Valor"]];
  gastos.slice().sort((a, b) => (a.data || "").localeCompare(b.data || "")).forEach(g => {
    const nf = notas.filter(x => x.gastoId === g.id).map(x => x.numero ? "NF " + x.numero : "sim").join(", ");
    linhas.push([dataBR(g.data), g.fornecedor || "", g.descricao || "", catById[g.categoria]?.nome || "Outros", g.pagamento || "", g.pedreiro ? "Sim" : "", nf, (Number(g.valor) || 0).toFixed(2).replace(".", ",")]);
  });
  return csvDe(linhas);
}
$("btnCsv").onclick = () => entregarArquivo(`gastos-kitdannis-${hoje()}.csv`, new Blob([csvGastos()], { type: "text/csv" }));

/* ---------- Notas fiscais ---------- */
function slug(s) { return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40); }
function extDe(tipo, nome) { if (tipo === "application/pdf") return "pdf"; const m = (nome || "").match(/\.([a-z0-9]{2,5})$/i); if (m) return m[1].toLowerCase(); return (tipo || "").split("/")[1]?.replace("jpeg", "jpg") || "bin"; }
function nomeArquivoNota(n, i) {
  const partes = [n.data || "sem-data", slug(n.fornecedor) || "nota", n.valor ? n.valor.toFixed(2).replace(".", ",") : "", n.numero ? "nf" + slug(n.numero) : ""].filter(Boolean);
  return partes.join("_") + (i != null ? "_" + (i + 1) : "") + "." + extDe(n.tipo, n.nomeArquivo);
}
async function assinarUrls() {
  const agora = Date.now();
  const faltam = notas.filter(n => (n.tipo || "").startsWith("image/") && !(urlsAssinadas.get(n.arquivo)?.expira > agora + 60000)).map(n => n.arquivo);
  if (!faltam.length) return;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(faltam, 3600);
  if (error || !data) return;
  data.forEach(x => { if (x.signedUrl) urlsAssinadas.set(x.path, { url: x.signedUrl, expira: agora + 3600 * 1000 }); });
}
function renderNotas() {
  $("btnZip").hidden = !notas.length;
  const lista = $("notasLista"); lista.innerHTML = "";
  if (!notas.length) { lista.innerHTML = '<div class="vazio">Nenhuma nota guardada ainda. Toque em <b>Adicionar nota</b> e tire uma foto ou escolha o PDF.</div>'; return; }
  notas.slice().sort((a, b) => (b.data || "").localeCompare(a.data || "") || (b.criadoEm || "").localeCompare(a.criadoEm || "")).forEach(n => {
    const b = document.createElement("button"); b.type = "button"; b.className = "row nota";
    const url = urlsAssinadas.get(n.arquivo)?.url;
    b.innerHTML = `${url ? `<img class="thumb" alt="" loading="lazy">` : `<div class="thumb">${(n.tipo || "").startsWith("image/") ? "FOTO" : "PDF"}</div>`}
      <div class="desc"><b></b><span></span></div>
      <div class="val"><b class="num"></b><span class="num"></span></div>`;
    if (url) b.querySelector("img").src = url;
    b.querySelector(".desc b").textContent = n.fornecedor || "Nota sem emitente";
    const g = n.gastoId ? gastos.find(x => x.id === n.gastoId) : null;
    b.querySelector(".desc span").textContent = [n.numero ? "NF " + n.numero : "", g ? "vinculada a " + (g.descricao || g.fornecedor || "gasto") : ""].filter(Boolean).join(" · ") || "Toque para editar";
    b.querySelector(".val b").textContent = n.valor ? brl.format(n.valor) : "";
    b.querySelector(".val span").textContent = fmtDia(n.data);
    b.onclick = () => abrirNota({ ...n, novo: false });
    lista.appendChild(b);
  });
}
function opcoesGasto(sel) {
  const s = $("nfGasto"); s.innerHTML = '<option value="">Nenhum</option>';
  gastos.slice().sort((a, b) => (b.data || "").localeCompare(a.data || "")).slice(0, 120).forEach(g => {
    const o = document.createElement("option"); o.value = g.id;
    o.textContent = `${fmtDia(g.data)} · ${g.descricao || g.fornecedor || "gasto"} · ${brl.format(Number(g.valor) || 0)}`;
    s.appendChild(o);
  });
  s.value = sel || "";
}
function sugerirGasto() {
  if (nfTocados.has("nfGasto") || $("nfGasto").value) return;
  const v = parseBRL($("nfValor").value), d = $("nfData").value || hoje();
  if (!(v > 0)) return;
  const ja = new Set(notas.map(n => n.gastoId).filter(Boolean));
  const cands = gastos.filter(g => Math.abs((Number(g.valor) || 0) - v) < 0.01 && !ja.has(g.id));
  if (!cands.length) return;
  cands.sort((a, b) => Math.abs(isoToUTC(a.data || d) - isoToUTC(d)) - Math.abs(isoToUTC(b.data || d) - isoToUTC(d)));
  $("nfGasto").value = cands[0].id;
}
function abrirNota(n) {
  notaEdit = n; nfTocados = new Set();
  $("notaForm").hidden = false; $("uploadBox").hidden = true;
  $("notaFormTit").textContent = n.novo ? "Nova nota" : "Editar nota";
  $("nfForn").value = n.fornecedor || ""; $("nfValor").value = n.valor ? fmtValorInput(n.valor) : "";
  $("nfData").value = n.data || hoje(); $("nfNum").value = n.numero || "";
  opcoesGasto(n.gastoId);
  const prev = $("notaPrev"); prev.innerHTML = "";
  const url = n.previa || urlsAssinadas.get(n.arquivo)?.url;
  if ((n.tipo || "").startsWith("image/") && url) {
    const img = document.createElement("img"); img.className = "preview"; img.alt = "Foto da nota"; img.src = url; prev.appendChild(img);
  } else {
    prev.innerHTML = '<div class="pdfbox"><div class="thumb">PDF</div><span></span></div>';
    prev.querySelector("span").textContent = n.nomeArquivo || "Arquivo";
  }
  $("btnNfExcluir").hidden = n.novo; $("btnNfExcluir").classList.remove("armado"); $("btnNfExcluir").textContent = "Excluir";
  $("btnNfBaixar").hidden = n.novo;
  msgNota("");
  if (!n.novo) return;
  sugerirGasto();
  if (n.paraIA) lerNota(n);
}
["nfForn", "nfValor", "nfData", "nfNum", "nfGasto"].forEach(id => $(id).addEventListener("input", () => { nfTocados.add(id); $("nfPergunta").hidden = true; $("btnNfSalvar").hidden = false; if (id === "nfValor" || id === "nfData") sugerirGasto(); }));
async function lerNota(n) {
  $("notaLendo").hidden = false;
  try {
    const r = await chamarIA({ modo: "nota", arquivo: n.paraIA });
    if (notaEdit !== n) return;
    if (r?.fornecedor && !nfTocados.has("nfForn")) $("nfForn").value = String(r.fornecedor);
    const v = parseBRL(r?.valor);
    if (v > 0 && !nfTocados.has("nfValor")) $("nfValor").value = fmtValorInput(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(r?.data || "") && !nfTocados.has("nfData")) $("nfData").value = r.data;
    if (r?.numero && !nfTocados.has("nfNum")) $("nfNum").value = String(r.numero).replace(/\D/g, "");
    sugerirGasto();
    msgNota("Confira os dados lidos da nota.");
  } catch (e) {
    if (notaEdit !== n) return;
    console.warn("ler nota:", e);
    msgNota("Não consegui ler a nota. Preencha os campos.");
  } finally { if (notaEdit === n) $("notaLendo").hidden = true; }
}
function carregarImagem(file) {
  return new Promise((ok, erro) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { ok(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    img.onerror = () => { URL.revokeObjectURL(url); erro(new Error("imagem")); };
    img.src = url;
  });
}
function reduzir(img, lado, qualidade) {
  const esc = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * esc); c.height = Math.round(img.naturalHeight * esc);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return new Promise(ok => c.toBlob(ok, "image/jpeg", qualidade));
}
function paraBase64(blob) {
  return new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = erro; r.readAsDataURL(blob); });
}
$("notaFile").addEventListener("change", async () => {
  const f = $("notaFile").files[0]; $("notaFile").value = "";
  if (!f) return;
  const ehImg = f.type.startsWith("image/"), ehPdf = f.type === "application/pdf";
  if (!ehImg && !ehPdf) { msgNota("Use uma foto ou um PDF.", "erro"); return; }
  if (f.size > 25 * 1024 * 1024) { msgNota("Arquivo acima de 25 MB. Tire a foto com menos zoom ou reduza o PDF.", "erro"); return; }
  msgNota("Enviando arquivo…");
  try {
    let blob = f, tipo = f.type, paraIA = null, previa = null;
    if (ehImg) {
      const img = await carregarImagem(f);
      blob = await reduzir(img, 2400, 0.85); tipo = "image/jpeg";
      paraIA = { tipo: "image/jpeg", dados: await paraBase64(await reduzir(img, 1568, 0.82)) };
      previa = URL.createObjectURL(blob);
    } else if (f.size <= 8 * 1024 * 1024) {
      paraIA = { tipo: "application/pdf", dados: await paraBase64(f) };
    }
    const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
    const caminho = `${usuario.id}/${id}.${ehPdf ? "pdf" : "jpg"}`;
    const { error } = await sb.storage.from(BUCKET).upload(caminho, blob, { contentType: tipo, upsert: false });
    if (error) throw error;
    abrirNota({ novo: true, arquivo: caminho, tipo, nomeArquivo: f.name, previa, paraIA });
  } catch (e) {
    console.warn(e);
    msgNota("Não consegui enviar o arquivo. Confira a internet e tente de novo.", "erro");
  }
});
function fecharNota() { notaEdit = null; $("nfPergunta").hidden = true; $("btnNfSalvar").hidden = false; $("notaForm").hidden = true; $("uploadBox").hidden = false; $("notaLendo").hidden = true; renderNotas(); }
$("btnNfCancelar").onclick = async () => {
  const n = notaEdit; fecharNota(); msgNota("");
  if (n?.novo) await sb.storage.from(BUCKET).remove([n.arquivo]);
};
function corpoNota(gastoId) {
  const v = parseBRL($("nfValor").value);
  return {
    arquivo: notaEdit.arquivo, tipo: notaEdit.tipo || "", nome_arquivo: notaEdit.nomeArquivo || "",
    fornecedor: $("nfForn").value.trim(), valor: v > 0 ? Math.round(v * 100) / 100 : null,
    data: $("nfData").value || null, numero: $("nfNum").value.trim(), gasto_id: gastoId || null,
  };
}
async function gravarNota(gastoId) {
  const r = notaEdit.id ? await sb.from("notas").update(corpoNota(gastoId)).eq("id", notaEdit.id) : await sb.from("notas").insert(corpoNota(gastoId));
  if (r.error) throw r.error;
}
function travarNota(sim) { ["btnNfSalvar", "nfSim", "nfNao"].forEach(id => { $(id).disabled = sim; }); }
$("btnNfSalvar").onclick = async () => {
  if (!notaEdit) return;
  const v = parseBRL($("nfValor").value);
  // Nota nova sem gasto vinculado: pergunta se é para somar o valor nos gastos
  if (notaEdit.novo && !$("nfGasto").value && v > 0) {
    $("nfPergTxt").innerHTML = `Quer somar <b>${brl.format(v)}</b>${$("nfForn").value.trim() ? ` (${esc($("nfForn").value.trim())})` : ""} nos gastos da obra?`;
    const sel = $("nfCat"); if (!sel.options.length) CATS.forEach(c => { const o = document.createElement("option"); o.value = c.id; o.textContent = c.nome; sel.appendChild(o); });
    sel.value = "material";
    $("nfPergunta").hidden = false; $("btnNfSalvar").hidden = true;
    $("nfPergunta").scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }
  travarNota(true);
  try { await gravarNota($("nfGasto").value); fecharNota(); msgNota(""); toast("Nota salva"); await carregar(); }
  catch (e) { console.warn(e); msgNota("Não consegui salvar a nota. Tente de novo.", "erro"); }
  finally { travarNota(false); }
};
$("nfNao").onclick = async () => {
  travarNota(true);
  try { await gravarNota(null); fecharNota(); msgNota(""); toast("Nota salva (sem lançar nos gastos)"); await carregar(); }
  catch (e) { console.warn(e); msgNota("Não consegui salvar a nota. Tente de novo.", "erro"); }
  finally { travarNota(false); }
};
$("nfSim").onclick = async () => {
  const v = parseBRL($("nfValor").value);
  if (!(v > 0)) { msgNota("Coloque o valor da nota.", "erro"); return; }
  travarNota(true);
  try {
    const g = await sb.from("gastos").insert({
      descricao: "", valor: Math.round(v * 100) / 100, categoria: $("nfCat").value || "material",
      fornecedor: $("nfForn").value.trim(), data: $("nfData").value || hoje(), pagamento: "", pedreiro: false,
    }).select("id").single();
    if (g.error) throw g.error;
    await gravarNota(g.data?.id);
    fecharNota(); msgNota(""); toast(`Nota salva e ${brl.format(v)} lançado nos gastos`); await carregar();
  } catch (e) { console.warn(e); msgNota("Não consegui salvar. Confira a internet e tente de novo.", "erro"); }
  finally { travarNota(false); }
};
$("btnNfExcluir").onclick = async () => {
  const b = $("btnNfExcluir");
  if (!b.classList.contains("armado")) { b.classList.add("armado"); b.textContent = "Toque de novo para excluir"; return; }
  const n = notaEdit;
  const { error } = await sb.from("notas").delete().eq("id", n.id);
  if (error) { msgNota("Não consegui excluir. Tente de novo.", "erro"); return; }
  await sb.storage.from(BUCKET).remove([n.arquivo]);
  fecharNota(); toast("Nota excluída"); await carregar();
};
async function baixarArquivo(caminho) {
  const { data, error } = await sb.storage.from(BUCKET).download(caminho);
  if (error) throw error;
  return data;
}
$("btnNfBaixar").onclick = async () => {
  const n = notaEdit; if (!n) return;
  try {
    const nome = nomeArquivoNota({ ...n, fornecedor: $("nfForn").value, valor: parseBRL($("nfValor").value) || null, data: $("nfData").value, numero: $("nfNum").value });
    await entregarArquivo(nome, await baixarArquivo(n.arquivo));
  } catch { toast("Não consegui baixar o arquivo"); }
};
function carregarJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return new Promise((ok, erro) => {
    const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
    s.onload = () => ok(window.JSZip); s.onerror = erro; document.head.appendChild(s);
  });
}
$("btnZip").onclick = async () => {
  const btn = $("btnZip"); btn.disabled = true; btn.textContent = "Preparando…";
  try {
    const JSZip = await carregarJSZip();
    const zip = new JSZip(), pasta = zip.folder("notas");
    const idx = [["Arquivo", "Data", "Emitente", "Número", "Valor", "Gasto vinculado"]];
    const usados = new Set();
    let falhas = 0;
    const ord = notas.slice().sort((a, b) => (a.data || "").localeCompare(b.data || ""));
    for (const [i, n] of ord.entries()) {
      let nome = nomeArquivoNota(n); if (usados.has(nome)) nome = nomeArquivoNota(n, i); usados.add(nome);
      try { pasta.file(nome, await baixarArquivo(n.arquivo)); } catch { falhas++; continue; }
      const g = n.gastoId ? gastos.find(x => x.id === n.gastoId) : null;
      idx.push([nome, dataBR(n.data), n.fornecedor || "", n.numero || "", n.valor ? n.valor.toFixed(2).replace(".", ",") : "", g ? `${dataBR(g.data)} ${g.descricao || g.fornecedor || ""} ${(Number(g.valor) || 0).toFixed(2).replace(".", ",")}` : ""]);
    }
    zip.file("notas.csv", csvDe(idx));
    zip.file("gastos.csv", csvGastos());
    await entregarArquivo(`kitdannis-notas-${hoje()}.zip`, await zip.generateAsync({ type: "blob" }));
    if (falhas) toast(`${falhas} ${falhas === 1 ? "arquivo não pôde" : "arquivos não puderam"} ser incluídos`);
  } catch (e) { console.warn(e); toast("Não consegui gerar o .zip. Tente de novo."); }
  finally { btn.disabled = false; btn.textContent = "Exportar tudo (.zip)"; }
};

/* ---------- Eventos de lançamento ---------- */
$("btnSeparar").onclick = separar;
$("btnManual").onclick = () => { editandoId = null; rascunho = [novoItem({ fornecedor: $("falado").value.trim() })]; setMsg(""); renderRascunho(); };
$("btnAddItem").onclick = () => { rascunho.push(novoItem()); renderRascunho(); };
$("btnCancelar").onclick = () => { const ed = !!editandoId; fecharRascunho(); setMsg(""); if (ed) history.back(); };
$("btnSalvar").onclick = salvar;
$("btnExcluir").onclick = excluir;
$("falado").addEventListener("paste", () => {
  setTimeout(() => { if ($("falado").value.trim() && rascunho.length === 0 && !$("btnSeparar").disabled) separar(); }, 0);
});

/* ---------- Microfone ----------
 * 1º tenta gravar direto (reconhecimento de voz do navegador).
 * Se o aparelho não deixar (comum no iPhone, no app da tela de início), cai no ditado do teclado,
 * e lembra disso para, nas próximas vezes, já abrir o teclado direto. */
const Reconhecedor = window.SpeechRecognition || window.webkitSpeechRecognition;
let ouvindo = null;
const lerFlag = () => { try { return localStorage.getItem("kd-voz") || ""; } catch { return ""; } };
const gravarFlag = v => { try { localStorage.setItem("kd-voz", v); } catch {} };
function modoTeclado(motivo) {
  $("dicaTeclado").hidden = false;
  try { $("falado").focus(); } catch {}
  if (motivo) setMsg(motivo);
}
// Junta os resultados sem duplicar: se um trecho já contém o anterior (iPhone), substitui; senão, acrescenta (Chrome)
function juntarFala(results) {
  const norm = s => s.toLowerCase().replace(/[.,!?]/g, "").replace(/\s+/g, " ").trim();
  let out = "";
  for (let i = 0; i < results.length; i++) {
    const t = (results[i][0]?.transcript || "").trim();
    if (!t) continue;
    if (!out || norm(t).startsWith(norm(out))) out = t;
    else if (norm(out).endsWith(norm(t)) || norm(out).includes(norm(t))) continue;
    else out = out + " " + t;
  }
  return out;
}
function falar() {
  if (ouvindo) { try { ouvindo.stop(); } catch {} return; }
  if (location.hash !== "#lancar") location.hash = "lancar";
  document.querySelectorAll(".view").forEach(s => { s.hidden = s.dataset.view !== "lancar"; });
  if (rascunho.length) fecharRascunho();
  setMsg("");
  if (!Reconhecedor || lerFlag() === "teclado") { modoTeclado(); return; }
  const r = new Reconhecedor();
  r.lang = "pt-BR"; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
  const base = $("falado").value.trim();
  let final = "", ouviuAlgo = false, teveErro = false;
  let silencio = null;
  r.onresult = ev => {
    ouviuAlgo = true;
    // Remonta o texto inteiro a cada atualização (o iPhone reenvia trechos já ditos; somar repetia tudo)
    const texto = juntarFala(ev.results);
    final = [...ev.results].some(x => x.isFinal) ? texto : final;
    $("falado").value = [base, texto].filter(Boolean).join(" ");
    clearTimeout(silencio);
    silencio = setTimeout(() => { try { r.stop(); } catch {} }, 2500); // para sozinho após 2,5 s sem fala
  };
  r.onerror = ev => {
    if (ev.error === "no-speech" || ev.error === "aborted") return;
    teveErro = true; setMsg("");
    if (ev.error === "not-allowed" && lerFlag() !== "negado") {
      setMsg("O microfone foi bloqueado. Para liberar no iPhone: Ajustes → Apps → Safari → Microfone → Permitir. Por enquanto, use o microfone do teclado.", "erro");
      gravarFlag("negado");
    } else {
      gravarFlag("teclado");
    }
    modoTeclado();
  };
  r.onend = () => {
    ouvindo = null; clearTimeout(silencio);
    $("btnMic").classList.remove("gravando"); $("btnFalarHome").classList.remove("gravando"); $("btnFalarNav").classList.remove("gravando");
    $("btnMic").setAttribute("aria-label", "Falar");
    if (final.trim() && rascunho.length === 0) { gravarFlag("direto"); separar(); return; }
    if (!teveErro) setMsg("");
    if (!ouviuAlgo && !teveErro) {
      // gravou mas não veio nada: neste aparelho a gravação direta não funciona; usa o teclado
      if (lerFlag() !== "direto") gravarFlag("teclado");
      modoTeclado("Não consegui ouvir pela gravação direta. Toque no microfone do teclado e fale.");
    }
  };
  try {
    r.start(); ouvindo = r;
    $("btnMic").classList.add("gravando"); $("btnFalarHome").classList.add("gravando"); $("btnFalarNav").classList.add("gravando");
    $("btnMic").setAttribute("aria-label", "Parar de gravar");
    setMsg("Ouvindo… fale o valor e o local.");
  } catch { gravarFlag("teclado"); modoTeclado(); }
}
$("btnMic").onclick = falar;
$("btnFalarHome").onclick = falar;
$("btnFalarNav").onclick = falar;
$("falado").addEventListener("blur", () => { setTimeout(() => { $("dicaTeclado").hidden = true; }, 200); });

/* ---------- Siri: o atalho abre o site com ?falar=texto ---------- */
function textoDaSiri() {
  const p = new URLSearchParams(location.search);
  const t = (p.get("falar") || "").trim();
  if (!t) return "";
  p.delete("falar");
  const q = p.toString();
  history.replaceState(null, "", location.pathname + (q ? "?" + q : "") + "#lancar");
  return t;
}
const textoPendente = textoDaSiri();

/* ---------- Login ---------- */
function mostrarTela(qual) {
  $("telaConfig").hidden = qual !== "config";
  $("telaLogin").hidden = qual !== "login";
  $("appRoot").hidden = qual !== "app";
}
$("formLogin").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("lgEmail").value.trim(), senha = $("lgSenha").value;
  const m = $("msgLogin");
  if (!email || !senha) { m.className = "msg erro"; m.textContent = "Preencha e-mail e senha."; return; }
  $("btnEntrar").disabled = true; m.className = "msg"; m.textContent = "Entrando…";
  const { error } = await sb.auth.signInWithPassword({ email, password: senha });
  $("btnEntrar").disabled = false;
  if (error) { m.className = "msg erro"; m.textContent = "E-mail ou senha incorretos."; return; }
  m.textContent = "";
});
$("btnSair").onclick = async () => { await sb.auth.signOut(); };

let iniciado = false;
async function entrarNoApp(sessao) {
  usuario = sessao.user;
  mostrarTela("app");
  if (!iniciado) {
    iniciado = true;
    mostrarView();
    render();
    setStatus("Carregando");
  }
  await carregar();
  if (textoPendente && !entrarNoApp.usouTexto) {
    entrarNoApp.usouTexto = true;
    ir("lancar");
    $("falado").value = textoPendente;
    separar();
  }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && usuario) carregar(); });
window.addEventListener("online", () => { if (usuario) carregar(); });
window.addEventListener("offline", () => setStatus("Sem internet", "off"));

(async () => {
  if (!sb) { mostrarTela("config"); return; }
  const { data } = await sb.auth.getSession();
  if (data.session) entrarNoApp(data.session); else mostrarTela("login");
  sb.auth.onAuthStateChange((evento, sessao) => {
    if (evento === "SIGNED_IN" && sessao && !usuario) entrarNoApp(sessao);
    if (evento === "SIGNED_OUT") { usuario = null; gastos = []; notas = []; acordo = null; orcamento = null; aluguel = null; iniciado = false; mostrarTela("login"); }
  });
})();
