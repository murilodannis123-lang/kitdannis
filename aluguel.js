/* KitDannis — Aluguéis: 7 kitnets, inquilinos, recebimentos, contrato e retorno do investimento.
 * Tudo fica numa linha da tabela config (chave "aluguel"), só visível para o dono. */
"use strict";

const TOTAL_KITS = 7;
let kitSel = null;          // kitnet aberta
let kitModo = "ver";        // ver | contrato | pagar | kit
let pagEdit = null;
let cfgAberto = false;      // formulário "dados do contrato"

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const novoId = () => (crypto.randomUUID ? crypto.randomUUID() : "id" + Date.now().toString(36) + Math.random().toString(36).slice(2));
const so = s => String(s || "").replace(/\D/g, "");
const r2 = v => Math.round(v * 100) / 100;

function dadosAluguel() {
  if (!aluguel || typeof aluguel !== "object") aluguel = {};
  if (!aluguel.kits) aluguel.kits = {};
  for (let i = 1; i <= TOTAL_KITS; i++) {
    const k = aluguel.kits[i] || (aluguel.kits[i] = {});
    if (!Array.isArray(k.historico)) k.historico = [];
    if (k.mobiliada == null) k.mobiliada = true;
    [k.atual, ...k.historico].filter(Boolean).forEach(c => {
      if (!Array.isArray(c.pags)) c.pags = [];
      c.ocupantes = (c.ocupantes || []).map(o => typeof o === "string" ? { nome: o, doc: "", rel: "" } : o);
    });
  }
  const cf = aluguel.contrato || (aluguel.contrato = {});
  cf.loc = cf.loc || { nome: aluguel.locador?.nome || "", cpf: aluguel.locador?.cpf || "", nac: "brasileiro" };
  cf.imovel = cf.imovel || { cidade: "Sumaré/SP" };
  if (!cf.iptu) cf.iptu = `1/${TOTAL_KITS}`;
  if (!cf.visitas) cf.visitas = 15;
  if (!cf.silencio) cf.silencio = "22h e 7h";
  return aluguel;
}
async function salvarAluguel(msg) {
  try { setStatus("Salvando"); await salvarConfig("aluguel", aluguel); setStatus("Sincronizado", "on"); if (msg) toast(msg); }
  catch (e) { setStatus("Sem conexão", "off"); toast("Não consegui salvar. Confira a internet e tente de novo."); throw e; }
}

/* ---------- Datas ---------- */
const refDe = iso => iso.slice(0, 7);
function refMais(ref, n) { let [y, m] = ref.split("-").map(Number); m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${String(m).padStart(2, "0")}`; }
function addMeses(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const alvo = refMais(`${y}-${String(m).padStart(2, "0")}`, n);
  const ult = Number(fimDoMes(alvo + "-01").slice(8));
  return `${alvo}-${String(Math.min(d, ult)).padStart(2, "0")}`;
}
const diasNoMes = ref => Number(fimDoMes(ref + "-01").slice(8));
function vencDe(ref, dia) { return `${ref}-${String(Math.min(Number(dia) || 10, diasNoMes(ref))).padStart(2, "0")}`; }
const FERIADOS_FIXOS = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"];
function sextoDiaUtil(ref) { // dias úteis = seg a sex, sem os feriados nacionais de data fixa
  let n = 0;
  for (let d = 1; d <= diasNoMes(ref); d++) {
    const iso = `${ref}-${String(d).padStart(2, "0")}`;
    const sem = new Date(isoToUTC(iso)).getUTCDay();
    if (sem === 0 || sem === 6 || FERIADOS_FIXOS.includes(iso.slice(5))) continue;
    if (++n === 6) return iso;
  }
  return `${ref}-10`;
}
const nomeRef = ref => `${MESES[Number(ref.slice(5)) - 1]}/${ref.slice(0, 4)}`;
const nomeRefCurto = ref => `${MES_CURTO[Number(ref.slice(5)) - 1]}/${ref.slice(2, 4)}`;
const diasEntre = (a, b) => Math.round((isoToUTC(b) - isoToUTC(a)) / 86400000);
const dataExtenso = iso => { const [y, m, d] = iso.split("-").map(Number); return `${d} de ${MESES[m - 1]} de ${y}`; };

/* Aluguel proporcional do 1º mês: aluguel ÷ dias do mês × dias de ocupação (contando o dia de entrada) */
function proporcional(valor, inicio) {
  if (!(valor > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(inicio || "")) return null;
  const ref = refDe(inicio), diasMes = diasNoMes(ref), dia = Number(inicio.slice(8));
  if (dia === 1) return null;
  const dias = diasMes - dia + 1;
  return { valor: r2(valor / diasMes * dias), dias, diasMes };
}

/* ---------- Contas de um contrato ---------- */
function devidoNoMes(c, ref) { return ref === refDe(c.inicio) && c.prop?.valor > 0 ? Number(c.prop.valor) : Number(c.valor) || 0; }
function vencimentoDoMes(c, ref) {
  if (c.garantia === "caucao") return vencDe(refMais(ref, 1), c.venc);   // paga depois de usar
  if (ref === refDe(c.inicio)) return c.inicio;                          // 1º mês: na entrega das chaves
  return sextoDiaUtil(ref);                                              // sem garantia: adiantado (art. 42)
}
function mesesDoContrato(c) {
  if (!c?.inicio) return [];
  const hj = hoje();
  const ultimo = c.encerradoEm ? refDe(c.encerradoEm) : refDe(hj);
  const out = [];
  for (let ref = refDe(c.inicio); ref <= ultimo && out.length < 240; ref = refMais(ref, 1)) {
    const pags = c.pags.filter(p => p.ref === ref);
    const pago = pags.reduce((s, p) => s + (Number(p.valor) || 0), 0);
    const devido = devidoNoMes(c, ref);
    const venc = vencimentoDoMes(c, ref);
    const quitado = pags.some(p => p.quita) || pago >= devido - 0.005;
    const falta = quitado ? 0 : Math.max(0, devido - pago);
    const atrasado = !quitado && hj > venc;
    out.push({ ref, venc, devido, pags, pago, quitado, falta, atrasado, status: quitado ? "paga" : atrasado ? (pago > 0 ? "parcial" : "aberto") : "andamento" });
  }
  return out;
}
function debito(c) {
  const hj = hoje();
  const linhas = mesesDoContrato(c).filter(m => m.atrasado).map(m => {
    const dias = Math.max(0, diasEntre(m.venc, hj));
    const multa = m.falta * 0.10, juros = m.falta * 0.01 * dias / 30;
    return { ...m, dias, multa, juros, total: m.falta + multa + juros };
  });
  return { linhas, principal: linhas.reduce((s, l) => s + l.falta, 0), total: linhas.reduce((s, l) => s + l.total, 0) };
}
function situacao(n) {
  const k = dadosAluguel().kits[n];
  if (!k.atual) return { st: "vaga", txt: "Vaga" };
  const d = debito(k.atual);
  if (d.linhas.length) return { st: "atraso", txt: d.linhas.length === 1 ? "1 mês atrasado" : `${d.linhas.length} meses atrasados`, d };
  return { st: "ok", txt: "Em dia" };
}
function primeiroNome(s) { return (s || "").trim().split(/\s+/)[0] || ""; }

/* ---------- Casinhas ---------- */
const CASA_SVG = n => `<svg viewBox="0 0 100 100" aria-hidden="true"><path class="casa-forma" d="M50 7 L93 43 H84 V93 H16 V43 H7 Z"/><text x="50" y="76" text-anchor="middle">${n}</text></svg>`;
function renderCasas() {
  const box = $("casas"); box.innerHTML = "";
  let alugadas = 0, renda = 0, atrasos = 0;
  for (let n = 1; n <= TOTAL_KITS; n++) {
    const k = aluguel.kits[n], s = situacao(n);
    if (k.atual) { alugadas++; renda += Number(k.atual.valor) || 0; }
    if (s.st === "atraso") atrasos++;
    const b = document.createElement("button");
    b.type = "button"; b.className = `casa ${s.st}` + (kitSel === n ? " sel" : "");
    b.innerHTML = CASA_SVG(n) + `<b></b><small></small>`;
    b.querySelector("b").textContent = k.atual ? primeiroNome(k.atual.nome) : "Vaga";
    b.querySelector("small").textContent = k.atual ? (s.st === "atraso" ? s.txt : brl.format(Number(k.atual.valor) || 0)) : (k.valor > 0 ? brl.format(k.valor) : "sem inquilino");
    b.setAttribute("aria-label", `Kitnet ${n}: ${k.atual ? k.atual.nome + ", " + s.txt : "vaga"}`);
    b.setAttribute("aria-pressed", kitSel === n ? "true" : "false");
    b.onclick = () => { kitSel = kitSel === n ? null : n; kitModo = "ver"; pagEdit = null; renderAluguel(); if (kitSel) setTimeout(() => $("kitDet").scrollIntoView({ behavior: "smooth", block: "start" }), 30); };
    box.appendChild(b);
  }
  $("alugSub").innerHTML = `<b class="num">${alugadas}</b> de ${TOTAL_KITS} alugadas · <b class="num">${brl.format(renda)}</b>/mês` +
    (atrasos ? ` · <span style="color:var(--bad);font-weight:600">${atrasos} com atraso</span>` : "");
}

/* ---------- Formulários ---------- */
function campo(id, rotulo, valor = "", extra = "", full = false) { return `<label for="${id}"${full ? ' class="full"' : ""}>${rotulo}<input id="${id}" value="${esc(valor)}" ${extra}></label>`; }
function seletor(id, rotulo, opcoes, valor, full = false) {
  return `<label for="${id}"${full ? ' class="full"' : ""}>${rotulo}<select id="${id}">${opcoes.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(valor ?? "") ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
}
const ESTADO_CIVIL = [["", "—"], ["solteiro", "Solteiro(a)"], ["casado", "Casado(a)"], ["divorciado", "Divorciado(a)"], ["viúvo", "Viúvo(a)"], ["em união estável", "União estável"]];
const val = id => ($(id)?.value || "").trim();

/* ---------- Detalhe da kitnet ---------- */
function renderDetalhe() {
  const box = $("kitDet");
  if (!kitSel) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  const n = kitSel, k = aluguel.kits[n], c = k.atual, s = situacao(n);
  let h = `<div class="card-head"><div class="ped-head"><div class="ico kit-ico ${s.st}">${n}</div><div><h2>Kitnet ${n}${c ? " · " + esc(c.nome) : ""}</h2><p>${c ? esc(s.txt) : "Vaga"} · ${k.mobiliada ? "mobiliada" : "sem mobília"}</p></div></div>
    <button type="button" class="btn sm" id="kdFechar">Fechar</button></div>`;

  if (kitModo === "contrato") h += formContrato(k, c);
  else if (kitModo === "kit") h += formKit(k);
  else if (kitModo === "pagar" && c) h += formPagar(c);
  else if (c) h += verContrato(n, k, c);
  else {
    h += `<div class="vazio">Kitnet vaga${k.valor > 0 ? `, aluguel pedido de <b>${brl.format(k.valor)}</b>` : ""}. Cadastre o inquilino quando fechar o negócio; o contrato sai pronto.</div>
      <div class="acoes"><button type="button" class="btn prim" id="kvNovo">Cadastrar inquilino</button><button type="button" class="btn" id="kvKit">Dados da kitnet</button></div>`;
    if (k.historico.length) h += historicoHtml(k);
  }
  box.innerHTML = h;
  $("kdFechar").onclick = () => { kitSel = null; kitModo = "ver"; renderAluguel(); };
  if (kitModo === "contrato") ligarContrato(k, c);
  else if (kitModo === "kit") ligarKit(k);
  else if (kitModo === "pagar" && c) ligarPagar(c);
  else if (c) ligarVer(n, k, c);
  else { $("kvNovo").onclick = () => { kitModo = "contrato"; renderDetalhe(); }; $("kvKit").onclick = () => { kitModo = "kit"; renderDetalhe(); }; }
}

function formKit(k) {
  return `<div class="form-grid">
    ${campo("kkValor", "Aluguel pedido (R$)", fmtValorInput(Number(k.valor) || null), 'inputmode="decimal" placeholder="0,00"')}
    ${seletor("kkMob", "Entregue", [["sim", "Mobiliada"], ["nao", "Sem mobília"]], k.mobiliada ? "sim" : "nao")}
    <label for="kkItens" class="full" id="kkItensL">Móveis e eletrodomésticos (um por linha, com marca/modelo se quiser)
      <textarea id="kkItens" placeholder="Cama de casal com colchão&#10;Geladeira Consul 300 L&#10;Fogão 4 bocas&#10;Guarda-roupa 3 portas">${esc(k.itens || "")}</textarea></label>
    <div class="acoes full"><button type="button" class="btn prim" id="kkSalvar">Salvar</button><button type="button" class="btn" id="kkCancelar">Cancelar</button></div></div>`;
}
function ligarKit(k) {
  const mostra = () => { $("kkItensL").hidden = $("kkMob").value !== "sim"; };
  $("kkMob").onchange = mostra; mostra();
  $("kkCancelar").onclick = () => { kitModo = "ver"; renderDetalhe(); };
  $("kkSalvar").onclick = async () => {
    const v = parseBRL($("kkValor").value);
    k.valor = v > 0 ? r2(v) : 0; k.mobiliada = $("kkMob").value === "sim"; k.itens = $("kkItens").value.trim();
    kitModo = "ver"; await salvarAluguel("Dados da kitnet salvos"); renderAluguel();
  };
}

function formContrato(k, c) {
  const v = c || { nac: "brasileiro", meses: 30, garantia: "sem", venc: 10 };
  const oc = v.ocupantes || [];
  const ocupante = i => `<div class="oc-linha full">
      ${campo(`kfOc${i}n`, `${i + 2}º morador`, oc[i]?.nome, 'autocomplete="off" placeholder="Nome (opcional)"')}
      ${campo(`kfOc${i}d`, "CPF ou RG", oc[i]?.doc, 'autocomplete="off"')}
      ${campo(`kfOc${i}r`, "Relação", oc[i]?.rel, 'placeholder="Esposa, filho…"')}</div>`;
  return `<div class="form-grid">
    <p class="sec full">Inquilino(a)</p>
    ${campo("kfNome", "Nome completo", v.nome, 'autocomplete="off"', true)}
    ${seletor("kfGen", "No contrato, tratar como", [["m", "Ele (inscrito, domiciliado)"], ["f", "Ela (inscrita, domiciliada)"]], v.gen || "m")}
    ${campo("kfNac", "Nacionalidade", v.nac || "brasileiro")}
    ${seletor("kfCivil", "Estado civil", ESTADO_CIVIL, v.civil)}
    ${campo("kfProf", "Profissão", v.prof)}
    ${campo("kfRg", "RG", v.rg, 'autocomplete="off"')}
    ${campo("kfCpf", "CPF", v.cpf, 'inputmode="numeric" autocomplete="off"')}
    ${campo("kfEnd", "Endereço atual (antes da kitnet)", v.end, 'autocomplete="off"', true)}
    ${campo("kfTel", "WhatsApp", v.tel, 'inputmode="tel" autocomplete="off" placeholder="(19) 99999-9999"')}
    ${campo("kfEmail", "E-mail", v.email, 'inputmode="email" autocomplete="off"')}
    <p class="sec full">Moradores (máximo 3 com o inquilino)</p>
    ${ocupante(0)}${ocupante(1)}
    <p class="sec full">Valores e prazo</p>
    ${campo("kfValor", "Aluguel mensal (R$)", fmtValorInput(Number(v.valor ?? k.valor) || null), 'inputmode="decimal" placeholder="0,00"')}
    ${campo("kfInicio", "Entrada (início do contrato)", v.inicio || hoje(), 'type="date"')}
    ${campo("kfMeses", "Prazo (meses)", v.meses || 30, 'inputmode="numeric"')}
    ${seletor("kfGar", "Garantia", [["sem", "Sem garantia (aluguel adiantado)"], ["caucao", "Caução em dinheiro"]], v.garantia || "sem")}
    ${campo("kfVenc", "Dia do vencimento", v.venc || 10, 'inputmode="numeric"')}
    ${campo("kfCau", "Valor da caução (R$)", fmtValorInput(Number(v.caucao) || null), 'inputmode="decimal" placeholder="até 3 aluguéis"')}
    <p class="sec full">Contas (o que foi combinado)</p>
    ${seletor("kfLuz", "Energia elétrica", [["ind", "Independente (medidor da kitnet)"], ["rat", "Rateio (medidor comum)"]], v.luz || "ind")}
    ${seletor("kfAgua", "Água e esgoto", [["ind", "Independente (medidor da kitnet)"], ["rat", "Rateio (medidor comum)"]], v.agua || "ind")}
    ${campo("kfRat", "Critério do rateio", v.rateio, 'placeholder="partes iguais entre as kitnets ocupadas"', true)}
    ${seletor("kfComum", "Despesas comuns (luz/limpeza de área comum)", [["nao", "Não há"], ["sim", "Rateadas entre as kitnets"]], v.comum || "nao")}
    ${campo("kfComumTxt", "Valor ou critério das despesas comuns", v.comumTxt, 'placeholder="R$ 30,00 por mês / partes iguais"')}
    <div class="calc full" id="kfCalc"></div>
    <div class="acoes full"><button type="button" class="btn prim" id="kfSalvar">${c ? "Salvar alterações" : "Cadastrar inquilino"}</button><button type="button" class="btn" id="kfCancelar">Cancelar</button></div>
    <p class="msg full" id="kfMsg" role="status"></p></div>`;
}
function ligarContrato(k, c) {
  const atualiza = () => {
    const ini = $("kfInicio").value, m = parseInt($("kfMeses").value, 10), valor = parseBRL($("kfValor").value);
    const gar = $("kfGar").value;
    $("kfCau").closest("label").hidden = gar !== "caucao";
    $("kfVenc").closest("label").hidden = gar !== "caucao";
    $("kfRat").closest("label").hidden = $("kfLuz").value !== "rat" && $("kfAgua").value !== "rat";
    $("kfComumTxt").closest("label").hidden = $("kfComum").value !== "sim";
    const linhas = [];
    if (ini && m > 0) linhas.push(`Contrato de <b>${dataBR(ini)}</b> a <b>${dataBR(addMeses(ini, m))}</b>.` + (m < 30 ? ` <span style="color:var(--bad)">Com menos de 30 meses o contrato se prorroga sozinho e fica mais difícil retomar a kitnet.</span>` : ""));
    const p = proporcional(valor, ini);
    if (p) linhas.push(`1º mês proporcional: <b>${brl.format(p.valor)}</b> (${p.dias} de ${p.diasMes} dias de ${MESES[Number(ini.slice(5, 7)) - 1]}).`);
    else if (valor > 0 && ini) linhas.push(`Entrando no dia 1º, o 1º mês é cheio: <b>${brl.format(valor)}</b>.`);
    if (ini && valor > 0) linhas.push(gar === "caucao"
      ? `Pagamento depois do uso: cada mês vence no dia escolhido do mês seguinte.`
      : `Pagamento adiantado: 1º mês na entrega das chaves; depois, até o 6º dia útil de cada mês (art. 42).`);
    $("kfCalc").innerHTML = linhas.map(l => `<p>${l}</p>`).join("");
  };
  ["kfInicio", "kfMeses", "kfGar", "kfValor"].forEach(id => $(id).addEventListener("input", atualiza));
  ["kfGar", "kfLuz", "kfAgua", "kfComum"].forEach(id => $(id).addEventListener("change", atualiza));
  atualiza();
  $("kfCancelar").onclick = () => { kitModo = "ver"; renderDetalhe(); };
  $("kfSalvar").onclick = () => salvarContrato(k, c);
}
async function salvarContrato(k, cAntigo) {
  const nome = val("kfNome"), valor = parseBRL($("kfValor").value), inicio = $("kfInicio").value;
  const venc = parseInt($("kfVenc").value, 10), meses = parseInt($("kfMeses").value, 10), garantia = $("kfGar").value;
  const msg = t => { const m = $("kfMsg"); m.textContent = t; m.className = "msg full erro"; };
  if (!nome) return msg("Coloque o nome do inquilino.");
  if (!(valor > 0)) return msg("Coloque o valor do aluguel.");
  if (!inicio) return msg("Coloque a data de entrada.");
  if (!(meses >= 1 && meses <= 120)) return msg("Prazo entre 1 e 120 meses.");
  if (garantia === "caucao" && !(venc >= 1 && venc <= 31)) return msg("Dia do vencimento entre 1 e 31.");
  const caucao = parseBRL($("kfCau").value);
  if (garantia === "caucao" && caucao > valor * 3 + 0.005) return msg("A caução não pode passar de 3 aluguéis (art. 38, § 2º, da Lei do Inquilinato).");
  const ocupantes = [0, 1].map(i => ({ nome: val(`kfOc${i}n`), doc: val(`kfOc${i}d`), rel: val(`kfOc${i}r`) })).filter(o => o.nome);
  const c = cAntigo || { id: novoId(), pags: [] };
  Object.assign(c, {
    nome, gen: $("kfGen").value, nac: val("kfNac"), civil: $("kfCivil").value, prof: val("kfProf"), rg: val("kfRg"), cpf: val("kfCpf"),
    end: val("kfEnd"), tel: val("kfTel"), email: val("kfEmail"), ocupantes,
    valor: r2(valor), venc: garantia === "caucao" ? venc : null, inicio, meses, fim: addMeses(inicio, meses),
    garantia, caucao: garantia === "caucao" && caucao > 0 ? r2(caucao) : 0, prop: proporcional(valor, inicio),
    luz: $("kfLuz").value, agua: $("kfAgua").value, rateio: val("kfRat"), comum: $("kfComum").value, comumTxt: val("kfComumTxt"),
  });
  k.atual = c; kitModo = "ver";
  await salvarAluguel(`Kitnet ${kitSel}: ${primeiroNome(nome)} cadastrado`); renderAluguel();
}

function formPagar(c) {
  const meses = mesesDoContrato(c);
  const abertos = meses.filter(m => !m.quitado);
  const ref = abertos[0]?.ref || refDe(hoje());
  const m = meses.find(x => x.ref === ref);
  return `<div class="form-grid">
    ${campo("kpRef", "Mês de referência", ref, 'type="month"')}
    ${campo("kpValor", "Valor recebido (R$)", fmtValorInput(m?.falta || devidoNoMes(c, ref) || null), 'inputmode="decimal"')}
    ${campo("kpData", "Data do pagamento", hoje(), 'type="date"')}
    <p class="dica full" id="kpInfo"></p>
    <label class="check full" for="kpQuita"><input type="checkbox" id="kpQuita"> Dar o mês por quitado mesmo com valor menor (desconto combinado)</label>
    <div class="acoes full"><button type="button" class="btn prim" id="kpSalvar">Registrar pagamento</button><button type="button" class="btn" id="kpCancelar">Cancelar</button></div></div>`;
}
function ligarPagar(c) {
  const info = () => {
    const r = $("kpRef").value; if (!/^\d{4}-\d{2}$/.test(r)) { $("kpInfo").textContent = ""; return; }
    const m = mesesDoContrato(c).find(x => x.ref === r);
    const dev = devidoNoMes(c, r);
    $("kpInfo").innerHTML = `Devido em ${nomeRef(r)}: <b>${brl.format(dev)}</b>${r === refDe(c.inicio) && c.prop ? ` (proporcional, ${c.prop.dias} dias)` : ""}${m && m.pago > 0 ? ` · já pago ${brl.format(m.pago)}` : ""}.`;
  };
  $("kpRef").addEventListener("input", () => { const r = $("kpRef").value; const m = mesesDoContrato(c).find(x => x.ref === r); $("kpValor").value = fmtValorInput(m ? (m.falta || m.devido) : devidoNoMes(c, r)); info(); });
  info();
  $("kpCancelar").onclick = () => { kitModo = "ver"; renderDetalhe(); };
  $("kpSalvar").onclick = async () => {
    const r = $("kpRef").value, v = parseBRL($("kpValor").value), d = $("kpData").value;
    if (!/^\d{4}-\d{2}$/.test(r) || !(v > 0) || !d) { toast("Preencha mês, valor e data."); return; }
    c.pags.push({ id: novoId(), ref: r, valor: r2(v), data: d, quita: $("kpQuita").checked });
    kitModo = "ver";
    await salvarAluguel("Pagamento registrado"); renderAluguel();
  };
}

function verContrato(n, k, c) {
  const meses = mesesDoContrato(c).slice().reverse();
  const d = debito(c);
  const prox = (() => { for (let a = 1; a <= 10; a++) { const r = addMeses(c.inicio, 12 * a); if (r >= hoje()) return r; } return ""; })();
  const avisos = [];
  if (d.linhas.length) avisos.push(`<div class="aviso ruim"><b>${brl.format(d.principal)} em atraso</b> (${d.linhas.map(l => nomeRefCurto(l.ref)).join(", ")}). Com multa de 10% e juros de 1% ao mês: <b>${brl.format(d.total)}</b>.</div>`);
  if (c.fim && diasEntre(hoje(), c.fim) <= 60 && diasEntre(hoje(), c.fim) >= -30) avisos.push(`<div class="aviso">Contrato termina em <b>${dataBR(c.fim)}</b>. Combine a renovação ou a saída.</div>`);
  if (prox && diasEntre(hoje(), prox) <= 30) avisos.push(`<div class="aviso">Reajuste anual pelo IPCA em <b>${dataBR(prox)}</b>.</div>`);
  const pagto = c.garantia === "caucao" ? `Dia ${c.venc} do mês seguinte` : "Adiantado, até o 6º dia útil";
  let h = avisos.join("");
  h += `<div class="kv">
    <div><span class="label">Aluguel</span><b class="num">${brl.format(Number(c.valor) || 0)}</b></div>
    <div><span class="label">Vencimento</span><b>${pagto}</b></div>
    ${c.prop ? `<div><span class="label">1º mês (proporcional)</span><b class="num">${brl.format(c.prop.valor)}</b><small class="mini">${c.prop.dias} de ${c.prop.diasMes} dias</small></div>` : ""}
    <div><span class="label">Contrato</span><b class="num">${dataBR(c.inicio)} a ${dataBR(c.fim)}</b></div>
    <div><span class="label">Garantia</span><b>${c.garantia === "caucao" ? "Caução " + brl.format(Number(c.caucao) || 0) : "Sem garantia"}</b></div>
    <div class="full"><span class="label">Moradores</span><b>${[c.nome, ...c.ocupantes.map(o => o.nome)].filter(Boolean).map(esc).join(", ")}</b></div>
    ${c.tel || c.cpf ? `<div class="full"><span class="label">Contato</span><b>${[c.tel && esc(c.tel), c.cpf && "CPF " + esc(c.cpf)].filter(Boolean).join(" · ")}</b></div>` : ""}
  </div>
  <div class="acoes">
    <button type="button" class="btn prim" id="kdPagar">Registrar pagamento</button>
    <button type="button" class="btn" id="kdDoc">Gerar contrato</button>
    ${d.linhas.length && so(c.tel) ? `<button type="button" class="btn" id="kdZap">Cobrar no WhatsApp</button>` : ""}
    ${d.linhas.length ? `<button type="button" class="btn" id="kdAdv">Resumo para o advogado</button>` : ""}
    <button type="button" class="btn" id="kdEditar">Editar inquilino</button>
    <button type="button" class="btn" id="kdKit">Dados da kitnet</button>
    <button type="button" class="btn perigo" id="kdEncerrar">Encerrar contrato</button>
  </div>
  <div class="card-head" style="margin-top:4px"><h2>Mês a mês</h2></div>
  <div class="meses">${meses.map(m => `
    <div class="mes ${m.status}">
      <div class="mes-top"><b>${nomeRef(m.ref)}</b><span class="pill ${m.status}">${m.quitado ? "Pago" : m.atrasado ? (m.pago > 0 ? "Parcial" : "Em aberto") : "A vencer"}</span></div>
      <div class="mes-sub">${brl.format(m.devido)}${m.ref === refDe(c.inicio) && c.prop ? " (proporcional)" : ""} · vence ${dataBR(m.venc)}${m.falta > 0 && m.pago > 0 ? ` · falta ${brl.format(m.falta)}` : ""}</div>
      ${m.pags.map(p => `<button type="button" class="pag" data-pag="${esc(p.id)}"><span>${brl.format(Number(p.valor) || 0)} em ${dataBR(p.data)}</span><span class="pag-acao">Recibo</span></button>`).join("")}
    </div>`).join("") || `<div class="vazio">Nenhum mês ainda.</div>`}</div>`;
  if (k.historico.length) h += historicoHtml(k);
  return h;
}
function ligarVer(n, k, c) {
  $("kdPagar").onclick = () => { kitModo = "pagar"; renderDetalhe(); };
  $("kdEditar").onclick = () => { kitModo = "contrato"; renderDetalhe(); };
  $("kdKit").onclick = () => { kitModo = "kit"; renderDetalhe(); };
  $("kdDoc").onclick = () => abrirContratoDoc(n);
  const enc = $("kdEncerrar");
  enc.onclick = async () => {
    if (!enc.classList.contains("armado")) { enc.classList.add("armado"); enc.textContent = "Toque de novo para encerrar"; setTimeout(() => { enc.classList.remove("armado"); enc.textContent = "Encerrar contrato"; }, 4000); return; }
    c.encerradoEm = hoje(); k.historico.unshift(c); k.atual = null; k.valor = Number(c.valor) || k.valor || 0;
    await salvarAluguel(`Kitnet ${n} está vaga`); renderAluguel();
  };
  const d = debito(c);
  if ($("kdZap")) $("kdZap").onclick = () => cobrarZap(n, c, d);
  if ($("kdAdv")) $("kdAdv").onclick = () => resumoAdvogado(n, c, d);
  $("kitDet").querySelectorAll("[data-pag]").forEach(b => b.onclick = () => abrirPagamento(n, c, b.dataset.pag, b));
}
function historicoHtml(k) {
  return `<div class="card-head" style="margin-top:4px"><h2>Inquilinos anteriores</h2></div><div class="rows">` + k.historico.map(c => {
    const tot = c.pags.reduce((s, p) => s + (Number(p.valor) || 0), 0);
    return `<div class="row ext-ini"><div class="ico" style="background:var(--c-outros)">${esc(iniciais(c.nome))}</div><div class="desc"><b>${esc(c.nome)}</b><span>${dataBR(c.inicio)} a ${dataBR(c.encerradoEm)}</span></div><div class="val"><b class="num">${brl.format(tot)}</b><span>recebido</span></div></div>`;
  }).join("") + `</div>`;
}

/* ---------- Cobrança, recibo e resumo ---------- */
function cobrarZap(n, c, d) {
  const meses = d.linhas.map(l => `${nomeRef(l.ref)} (venc. ${dataBR(l.venc)}): ${brl.format(l.falta)}`).join("\n");
  const txt = `Olá, ${primeiroNome(c.nome)}. Tudo bem? Consta em aberto o aluguel da Kitnet ${n}:\n${meses}\n\nPode me enviar o comprovante quando pagar? Obrigado.`;
  let tel = so(c.tel); if (tel.length <= 11) tel = "55" + tel;
  window.open(`https://wa.me/${tel}?text=${encodeURIComponent(txt)}`, "_blank", "noopener");
}
function reciboTexto(n, c, p) {
  const loc = aluguel.contrato?.loc || {};
  const prop = p.ref === refDe(c.inicio) && c.prop;
  return [
    "RECIBO DE ALUGUEL", "",
    `Recebi de ${c.nome}${c.cpf ? ", CPF " + c.cpf : ""}, a quantia de ${brl.format(Number(p.valor) || 0)} (${extenso(Number(p.valor) || 0)}), referente ao aluguel da Kitnet nº ${n} do conjunto KitDannis, mês de ${nomeRef(p.ref)}${prop ? ` (proporcional a ${c.prop.dias} dias)` : ""}.`, "",
    `Discriminação: aluguel ${brl.format(Number(p.valor) || 0)}.`,
    `Pago em ${dataBR(p.data)}.`, "",
    `Sumaré/SP, ${dataExtenso(p.data)}.`, "",
    loc.nome ? `${loc.nome}${loc.cpf ? " – CPF " + loc.cpf : ""}` : "_____________________________",
    "Locador",
  ].join("\n");
}
function abrirPagamento(n, c, id, botao) {
  const p = c.pags.find(x => x.id === id); if (!p) return;
  const wrap = botao.parentElement;
  wrap.querySelectorAll(".pag-menu").forEach(e => e.remove());
  const m = document.createElement("div"); m.className = "acoes pag-menu";
  m.innerHTML = `<button type="button" class="btn sm">Enviar recibo</button><button type="button" class="btn sm perigo">Apagar pagamento</button>`;
  botao.after(m);
  const [bRec, bDel] = m.querySelectorAll("button");
  bRec.onclick = async () => {
    const txt = reciboTexto(n, c, p);
    if (navigator.share) { try { await navigator.share({ text: txt }); return; } catch (e) { if (e?.name === "AbortError") return; } }
    try { await navigator.clipboard.writeText(txt); toast("Recibo copiado. É só colar no WhatsApp."); } catch { entregarArquivo(`recibo-kitnet-${n}-${p.ref}.txt`, new Blob([txt], { type: "text/plain;charset=utf-8" })); }
  };
  bDel.onclick = async () => {
    if (!bDel.classList.contains("armado")) { bDel.classList.add("armado"); bDel.textContent = "Toque de novo para apagar"; return; }
    c.pags = c.pags.filter(x => x.id !== id);
    await salvarAluguel("Pagamento apagado"); renderAluguel();
  };
}
function resumoAdvogado(n, c, d) {
  const L = [];
  L.push(`RESUMO PARA AÇÃO DE DESPEJO E COBRANÇA – KITNET Nº ${n} (KitDannis)`, `Gerado em ${dataBR(hoje())}`, "");
  L.push("CONTRATO");
  L.push(`Locatário(a): ${c.nome}${c.cpf ? " – CPF " + c.cpf : ""}`);
  if (c.ocupantes.length) L.push(`Demais moradores: ${c.ocupantes.map(o => o.nome).join(", ")}`);
  if (c.tel) L.push(`Telefone: ${c.tel}`);
  L.push(`Vigência: ${dataBR(c.inicio)} a ${dataBR(c.fim)} (${c.meses || "?"} meses)`);
  L.push(`Aluguel: ${brl.format(Number(c.valor) || 0)} – ${c.garantia === "caucao" ? `vencimento todo dia ${c.venc} do mês seguinte` : "pagamento adiantado até o 6º dia útil do mês"}`);
  L.push(`Garantia: ${c.garantia === "caucao" ? "caução em dinheiro de " + brl.format(Number(c.caucao) || 0) : "NENHUMA (contrato sem garantia)"}`, "");
  L.push("DEMONSTRATIVO DO DÉBITO (multa 10% e juros 1% ao mês pro rata; sem correção monetária)");
  d.linhas.forEach(l => L.push(`- ${nomeRef(l.ref)} | venc. ${dataBR(l.venc)} | em aberto ${brl.format(l.falta)} | ${l.dias} dias | multa ${brl.format(l.multa)} | juros ${brl.format(l.juros)} | total ${brl.format(l.total)}`));
  L.push(`Principal: ${brl.format(d.principal)}`, `TOTAL ATUALIZADO: ${brl.format(d.total)}`, "");
  L.push("PAGAMENTOS JÁ RECEBIDOS");
  c.pags.slice().sort((a, b) => a.data.localeCompare(b.data)).forEach(p => L.push(`- ${dataBR(p.data)}: ${brl.format(Number(p.valor) || 0)} (ref. ${nomeRef(p.ref)})`));
  if (!c.pags.length) L.push("- nenhum");
  L.push("");
  if (c.garantia !== "caucao") {
    L.push("OBSERVAÇÃO: contrato sem garantia. Cabe pedido de liminar para desocupação em 15 dias (Lei 8.245/91, art. 59, § 1º, IX),",
      `mediante caução de 3 aluguéis prestada pelo locador: ${brl.format((Number(c.valor) || 0) * 3)}.`,
      "O locatário pode evitar a desocupação depositando o total devido em 15 dias (art. 59, § 3º).");
  } else {
    L.push("OBSERVAÇÃO: contrato com caução; a liminar do art. 59, § 1º, IX, da Lei 8.245/91 não se aplica (exige contrato sem garantia).");
  }
  L.push("", "Anexar: contrato assinado, Anexo I (vistoria), comprovantes e conversas de cobrança.");
  entregarArquivo(`despejo-kitnet-${n}-${slug(c.nome)}.txt`, new Blob([L.join("\r\n")], { type: "text/plain;charset=utf-8" }));
}

/* ---------- Dados fixos do contrato (você e o imóvel) ---------- */
function renderCfgContrato() {
  const cf = aluguel.contrato, l = cf.loc, im = cf.imovel;
  const faltam = [!l.nome && "seu nome", !l.cpf && "seu CPF", !im.end && "endereço do imóvel", !cf.pix && "chave Pix"].filter(Boolean);
  $("cfgResumo").innerHTML = faltam.length ? `Falta preencher: <b>${faltam.join(", ")}</b>. Sem isso o contrato sai com campos em branco.` : `Locador: <b>${esc(l.nome)}</b> · ${esc(im.end)}`;
  $("cfgForm").hidden = !cfgAberto; $("btnCfg").textContent = cfgAberto ? "Fechar" : "Editar";
  if (!cfgAberto) { $("cfgForm").innerHTML = ""; return; }
  $("cfgForm").innerHTML = `
    <p class="sec full">Você (locador)</p>
    ${campo("cfNome", "Nome completo", l.nome, 'autocomplete="name"', true)}
    ${campo("cfNac", "Nacionalidade", l.nac || "brasileiro")}
    ${seletor("cfCivil", "Estado civil", ESTADO_CIVIL, l.civil)}
    ${campo("cfProf", "Profissão", l.prof)}
    ${campo("cfRg", "RG", l.rg)}
    ${campo("cfCpf", "CPF", l.cpf, 'inputmode="numeric"')}
    ${campo("cfEnd", "Seu endereço", l.end, "", true)}
    ${campo("cfTel", "Seu WhatsApp", l.tel, 'inputmode="tel"')}
    ${campo("cfEmail", "Seu e-mail", l.email, 'inputmode="email"')}
    <p class="sec full">Imóvel</p>
    ${campo("cfImEnd", "Endereço do conjunto (rua, nº, bairro)", im.end, "", true)}
    ${campo("cfImCidade", "Cidade/UF", im.cidade || "Sumaré/SP")}
    ${campo("cfImCep", "CEP", im.cep, 'inputmode="numeric"')}
    ${campo("cfImMat", "Matrícula nº", im.matricula)}
    ${campo("cfImCri", "Cartório (Registro de Imóveis)", im.cri, 'placeholder="Oficial de Registro de Imóveis de Sumaré"')}
    <p class="sec full">Regras e cobrança</p>
    ${campo("cfPix", "Chave Pix para o aluguel", cf.pix, "", true)}
    ${campo("cfIptu", "Parte do IPTU de cada kitnet", cf.iptu, 'placeholder="1/7"')}
    ${campo("cfVis", "Visitante pode ficar até (dias no mês)", cf.visitas, 'inputmode="numeric"')}
    ${campo("cfSil", "Silêncio entre", cf.silencio, 'placeholder="22h e 7h"')}
    ${campo("cfRegras", "Outras regras de convivência (opcional)", cf.regras, "", true)}
    <div class="acoes full"><button type="button" class="btn prim" id="cfSalvar">Salvar dados</button></div>`;
  $("cfSalvar").onclick = async () => {
    Object.assign(cf.loc, { nome: val("cfNome"), nac: val("cfNac"), civil: $("cfCivil").value, prof: val("cfProf"), rg: val("cfRg"), cpf: val("cfCpf"), end: val("cfEnd"), tel: val("cfTel"), email: val("cfEmail") });
    Object.assign(cf.imovel, { end: val("cfImEnd"), cidade: val("cfImCidade"), cep: val("cfImCep"), matricula: val("cfImMat"), cri: val("cfImCri") });
    Object.assign(cf, { pix: val("cfPix"), iptu: val("cfIptu"), visitas: parseInt(val("cfVis"), 10) || 15, silencio: val("cfSil") || "22h e 7h", regras: val("cfRegras") });
    cfgAberto = false; await salvarAluguel("Dados do contrato salvos"); renderAluguel();
  };
}
$("btnCfg").onclick = () => { cfgAberto = !cfgAberto; renderCfgContrato(); };

/* ---------- Retorno do investimento ---------- */
function renderRetorno() {
  const a = aluguel;
  const gastoObra = gastos.reduce((s, g) => s + (Number(g.valor) || 0), 0);
  const ped = contasPedreiro();
  const saldoPed = ped.tem && acordo?.tipo === "empreitada" ? Math.max(0, ped.saldo) : 0;
  const custoAuto = gastoObra + saldoPed;
  // custo final informado > orçamento estimado da obra (Visão geral) > o que já foi gasto/contratado
  const fonte = a.custoObra > 0 ? "final" : orcamento > custoAuto ? "orcamento" : "auto";
  const custo = fonte === "final" ? Number(a.custoObra) : fonte === "orcamento" ? Number(orcamento) : custoAuto;
  let recebido = 0, renda = 0, rendaCheia = 0;
  for (let n = 1; n <= TOTAL_KITS; n++) {
    const k = a.kits[n];
    [k.atual, ...k.historico].filter(Boolean).forEach(c => c.pags.forEach(p => { recebido += Number(p.valor) || 0; }));
    if (k.atual) renda += Number(k.atual.valor) || 0;
    rendaCheia += Number(k.atual?.valor || k.valor) || 0;
  }
  const desp = Number(a.despesasMes) || 0;
  const falta = Math.max(0, custo - recebido);
  const prazo = liq => {
    if (falta <= 0) return "Investimento recuperado";
    if (!(liq > 0)) return "—";
    const m = Math.ceil(falta / liq), anos = Math.floor(m / 12), r = m % 12;
    const quando = refMais(refDe(hoje()), m);
    return `${anos ? anos + (anos === 1 ? " ano" : " anos") : ""}${anos && r ? " e " : ""}${r ? r + (r === 1 ? " mês" : " meses") : ""} <small>(${nomeRefCurto(quando)})</small>`;
  };
  $("retCusto").textContent = brl.format(custo);
  const contas = `${brl.format(gastoObra)} já gastos${saldoPed ? ` + ${brl.format(saldoPed)} que falta pagar ao pedreiro` : ""}`;
  $("retCustoLbl").textContent = (fonte === "final" ? "custo final informado" : fonte === "orcamento" ? `orçamento estimado da obra (até agora: ${contas})` : contas) + ` · ${brl.format(custo / TOTAL_KITS)} por kitnet`;
  $("retRecebido").textContent = brl.format(recebido);
  $("retFalta").textContent = brl.format(falta);
  $("retBarra").style.width = (custo > 0 ? Math.min(100, recebido / custo * 100) : 0) + "%";
  $("retPct").textContent = custo > 0 ? `${(recebido / custo * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% recuperado` : "";
  $("retAgora").innerHTML = prazo(renda - desp);
  $("retAgoraLbl").textContent = `com ${brl.format(renda)}/mês de aluguel${desp ? ` − ${brl.format(desp)} de despesas` : ""}`;
  $("retCheio").innerHTML = rendaCheia > 0 ? prazo(rendaCheia - desp) : "<small>Defina o aluguel das vagas</small>";
  $("retCheioLbl").textContent = `com as ${TOTAL_KITS} alugadas: ${brl.format(rendaCheia)}/mês`;
  const rent = custo > 0 && rendaCheia > 0 ? (rendaCheia - desp) * 12 / custo * 100 : 0;
  $("retRend").textContent = rent ? `Rende ${rent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% ao ano sobre o custo da obra com tudo alugado.` : "";
}
function abrirAjustes(abrir) {
  $("retForm").hidden = !abrir; $("btnRetAjustar").hidden = abrir;
  if (!abrir) return;
  $("raCusto").value = fmtValorInput(Number(aluguel.custoObra) || null);
  $("raDesp").value = fmtValorInput(Number(aluguel.despesasMes) || null);
}
$("btnRetAjustar").onclick = () => abrirAjustes(true);
$("raCancelar").onclick = () => abrirAjustes(false);
$("raSalvar").onclick = async () => {
  const cu = parseBRL($("raCusto").value), de = parseBRL($("raDesp").value);
  aluguel.custoObra = cu > 0 ? r2(cu) : null;
  aluguel.despesasMes = de > 0 ? r2(de) : 0;
  await salvarAluguel("Ajustes salvos"); abrirAjustes(false); renderAluguel();
};

function renderAluguel() {
  dadosAluguel();
  renderCasas();
  renderDetalhe();
  renderCfgContrato();
  renderRetorno();
}
