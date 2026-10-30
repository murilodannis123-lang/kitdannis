/* KitDannis — Aluguéis: 7 kitnets, inquilinos, recebimentos e retorno do investimento.
 * Tudo fica numa linha da tabela config (chave "aluguel"), só visível para o dono. */
"use strict";

const TOTAL_KITS = 7;
let kitSel = null;          // kitnet aberta
let kitModo = "ver";        // ver | contrato | pagar | vaga
let pagEdit = null;         // pagamento aberto (recibo/excluir)

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const novoId = () => (crypto.randomUUID ? crypto.randomUUID() : "id" + Date.now().toString(36) + Math.random().toString(36).slice(2));
const so = s => String(s || "").replace(/\D/g, "");

function dadosAluguel() {
  if (!aluguel || typeof aluguel !== "object") aluguel = {};
  if (!aluguel.kits) aluguel.kits = {};
  for (let i = 1; i <= TOTAL_KITS; i++) {
    const k = aluguel.kits[i] || (aluguel.kits[i] = {});
    if (!Array.isArray(k.historico)) k.historico = [];
    if (k.atual && !Array.isArray(k.atual.pags)) k.atual.pags = [];
  }
  return aluguel;
}
async function salvarAluguel(msg) {
  try { setStatus("Salvando"); await salvarConfig("aluguel", aluguel); setStatus("Sincronizado", "on"); if (msg) toast(msg); }
  catch (e) { setStatus("Sem conexão", "off"); toast("Não consegui salvar. Confira a internet e tente de novo."); throw e; }
}

/* ---------- Datas ---------- */
const refDe = iso => iso.slice(0, 7);
function refMais(ref, n) { let [y, m] = ref.split("-").map(Number); m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${String(m).padStart(2, "0")}`; }
function addMeses(iso, n) { // mesmo dia n meses depois (ajusta fim de mês)
  const [y, m, d] = iso.split("-").map(Number);
  const alvo = refMais(`${y}-${String(m).padStart(2, "0")}`, n);
  const ult = Number(fimDoMes(alvo + "-01").slice(8));
  return `${alvo}-${String(Math.min(d, ult)).padStart(2, "0")}`;
}
function vencDe(ref, dia) { const ult = Number(fimDoMes(ref + "-01").slice(8)); return `${ref}-${String(Math.min(Number(dia) || 10, ult)).padStart(2, "0")}`; }
const nomeRef = ref => `${MESES[Number(ref.slice(5)) - 1]}/${ref.slice(0, 4)}`;
const nomeRefCurto = ref => `${MES_CURTO[Number(ref.slice(5)) - 1]}/${ref.slice(2, 4)}`;
const diasEntre = (a, b) => Math.round((isoToUTC(b) - isoToUTC(a)) / 86400000);

/* ---------- Contas de um contrato ---------- */
function mesesDoContrato(c) {
  if (!c?.inicio) return [];
  const hj = hoje();
  const ultimo = c.encerradoEm ? refDe(c.encerradoEm) : refDe(hj);
  const out = [];
  for (let ref = refDe(c.inicio); ref <= ultimo && out.length < 240; ref = refMais(ref, 1)) {
    const pags = c.pags.filter(p => p.ref === ref);
    const pago = pags.reduce((s, p) => s + (Number(p.valor) || 0), 0);
    const venc = vencDe(ref, c.venc);
    const quitado = pags.some(p => p.quita) || pago >= (Number(c.valor) || 0) - 0.005;
    const falta = quitado ? 0 : Math.max(0, (Number(c.valor) || 0) - pago);
    const atrasado = !quitado && hj > venc;
    out.push({ ref, venc, pags, pago, quitado, falta, atrasado, status: quitado ? "paga" : atrasado ? (pago > 0 ? "parcial" : "aberto") : "andamento" });
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

/* ---------- Detalhe da kitnet ---------- */
function campo(id, rotulo, valor = "", extra = "") { return `<label for="${id}">${rotulo}<input id="${id}" value="${esc(valor)}" ${extra}></label>`; }
function renderDetalhe() {
  const box = $("kitDet");
  if (!kitSel) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  const n = kitSel, k = aluguel.kits[n], c = k.atual, s = situacao(n);
  let h = `<div class="card-head"><div class="ped-head"><div class="ico kit-ico ${s.st}">${n}</div><div><h2>Kitnet ${n}${c ? " · " + esc(c.nome) : ""}</h2><p>${c ? esc(s.txt) : "Vaga"}</p></div></div>
    <button type="button" class="btn sm" id="kdFechar">Fechar</button></div>`;

  if (kitModo === "contrato") {
    const v = c || {};
    const inicio = v.inicio || hoje();
    h += `<div class="form-grid">
      ${campo("kfNome", "Nome do inquilino", v.nome, 'autocomplete="off"').replace("<label", '<label class="full"')}
      ${campo("kfCpf", "CPF", v.cpf, 'inputmode="numeric" autocomplete="off"')}
      ${campo("kfTel", "WhatsApp", v.tel, 'inputmode="tel" autocomplete="off" placeholder="(19) 99999-9999"')}
      ${campo("kfOc2", "2º morador (opcional)", (v.ocupantes || [])[0])}
      ${campo("kfOc3", "3º morador (opcional)", (v.ocupantes || [])[1])}
      ${campo("kfValor", "Aluguel (R$)", fmtValorInput(Number(v.valor ?? k.valor) || null), 'inputmode="decimal" placeholder="0,00"')}
      ${campo("kfVenc", "Dia do vencimento", v.venc || 10, 'inputmode="numeric"')}
      ${campo("kfInicio", "Início do contrato", inicio, 'type="date"')}
      ${campo("kfMeses", "Prazo (meses)", v.meses || 30, 'inputmode="numeric"')}
      <label for="kfGar">Garantia<select id="kfGar"><option value="sem">Sem garantia (aluguel adiantado)</option><option value="caucao">Caução em dinheiro</option></select></label>
      ${campo("kfCau", "Valor da caução (R$)", fmtValorInput(Number(v.caucao) || null), 'inputmode="decimal" placeholder="até 3 aluguéis"')}
      <p class="dica full" id="kfFim"></p>
      <div class="acoes full"><button type="button" class="btn prim" id="kfSalvar">${c ? "Salvar alterações" : "Cadastrar inquilino"}</button><button type="button" class="btn" id="kfCancelar">Cancelar</button></div>
      <p class="msg full" id="kfMsg" role="status"></p></div>`;
    box.innerHTML = h;
    $("kfGar").value = v.garantia || "sem";
    const fimTxt = () => {
      const ini = $("kfInicio").value, m = parseInt($("kfMeses").value, 10);
      $("kfCau").closest("label").hidden = $("kfGar").value !== "caucao";
      $("kfFim").innerHTML = ini && m > 0 ? `Termina em <b>${dataBR(addMeses(ini, m))}</b>.` + (m < 30 ? " Com menos de 30 meses o contrato se prorroga sozinho e fica mais difícil retomar a kitnet." : "") : "";
    };
    ["kfInicio", "kfMeses", "kfGar"].forEach(id => $(id).addEventListener("input", fimTxt)); fimTxt();
    $("kfCancelar").onclick = () => { kitModo = "ver"; renderDetalhe(); };
    $("kfSalvar").onclick = salvarContrato;
  } else if (kitModo === "pagar" && c) {
    const abertos = mesesDoContrato(c).filter(m => !m.quitado);
    const ref = pagEdit?.ref || abertos[0]?.ref || refDe(hoje());
    const falta = mesesDoContrato(c).find(m => m.ref === ref)?.falta;
    h += `<div class="form-grid">
      ${campo("kpRef", "Mês de referência", ref, 'type="month"')}
      ${campo("kpValor", "Valor recebido (R$)", fmtValorInput(falta || Number(c.valor) || null), 'inputmode="decimal"')}
      ${campo("kpData", "Data do pagamento", hoje(), 'type="date"')}
      <label class="check full" for="kpQuita"><input type="checkbox" id="kpQuita"> Dar o mês por quitado mesmo com valor menor (ex.: primeiro mês proporcional)</label>
      <div class="acoes full"><button type="button" class="btn prim" id="kpSalvar">Registrar pagamento</button><button type="button" class="btn" id="kpCancelar">Cancelar</button></div></div>`;
    box.innerHTML = h;
    $("kpCancelar").onclick = () => { kitModo = "ver"; pagEdit = null; renderDetalhe(); };
    $("kpSalvar").onclick = async () => {
      const r = $("kpRef").value, v = parseBRL($("kpValor").value), d = $("kpData").value;
      if (!/^\d{4}-\d{2}$/.test(r) || !(v > 0) || !d) { toast("Preencha mês, valor e data."); return; }
      c.pags.push({ id: novoId(), ref: r, valor: Math.round(v * 100) / 100, data: d, quita: $("kpQuita").checked });
      kitModo = "ver"; pagEdit = null;
      await salvarAluguel("Pagamento registrado"); renderAluguel();
    };
  } else if (c) {
    const meses = mesesDoContrato(c).slice().reverse();
    const d = debito(c);
    const fim = c.fim || "";
    const prox = (() => { for (let a = 1; a <= 10; a++) { const r = addMeses(c.inicio, 12 * a); if (r >= hoje()) return r; } return ""; })();
    const avisos = [];
    if (d.linhas.length) avisos.push(`<div class="aviso ruim"><b>${brl.format(d.principal)} em atraso</b> (${d.linhas.map(l => nomeRefCurto(l.ref)).join(", ")}). Com multa de 10% e juros de 1% ao mês: <b>${brl.format(d.total)}</b>.</div>`);
    if (fim && diasEntre(hoje(), fim) <= 60 && diasEntre(hoje(), fim) >= -30) avisos.push(`<div class="aviso">Contrato termina em <b>${dataBR(fim)}</b>. Combine a renovação ou a saída.</div>`);
    if (prox && diasEntre(hoje(), prox) <= 30) avisos.push(`<div class="aviso">Reajuste anual pelo IPCA em <b>${dataBR(prox)}</b>.</div>`);
    h += avisos.join("");
    h += `<div class="kv">
      <div><span class="label">Aluguel</span><b class="num">${brl.format(Number(c.valor) || 0)}</b></div>
      <div><span class="label">Vence todo dia</span><b class="num">${esc(c.venc)}</b></div>
      <div><span class="label">Contrato</span><b class="num">${dataBR(c.inicio)} a ${dataBR(fim)}</b></div>
      <div><span class="label">Garantia</span><b>${c.garantia === "caucao" ? "Caução " + brl.format(Number(c.caucao) || 0) : "Sem garantia"}</b></div>
      <div class="full"><span class="label">Moradores</span><b>${[c.nome, ...(c.ocupantes || [])].filter(Boolean).map(esc).join(", ")}</b></div>
      ${c.tel || c.cpf ? `<div class="full"><span class="label">Contato</span><b>${[c.tel && esc(c.tel), c.cpf && "CPF " + esc(c.cpf)].filter(Boolean).join(" · ")}</b></div>` : ""}
    </div>
    <div class="acoes">
      <button type="button" class="btn prim" id="kdPagar">Registrar pagamento</button>
      ${d.linhas.length && so(c.tel) ? `<button type="button" class="btn" id="kdZap">Cobrar no WhatsApp</button>` : ""}
      ${d.linhas.length ? `<button type="button" class="btn" id="kdAdv">Resumo para o advogado</button>` : ""}
      <button type="button" class="btn" id="kdEditar">Editar dados</button>
      <button type="button" class="btn perigo" id="kdEncerrar">Encerrar contrato</button>
    </div>
    <div class="card-head" style="margin-top:4px"><h2>Mês a mês</h2></div>
    <div class="meses">${meses.map(m => `
      <div class="mes ${m.status}">
        <div class="mes-top"><b>${nomeRef(m.ref)}</b><span class="pill ${m.status}">${m.quitado ? "Pago" : m.atrasado ? (m.pago > 0 ? "Parcial" : "Em aberto") : "A vencer"}</span></div>
        <div class="mes-sub">vence ${dataBR(m.venc)}${m.falta > 0 && m.pago > 0 ? ` · falta ${brl.format(m.falta)}` : ""}</div>
        ${m.pags.map(p => `<button type="button" class="pag" data-pag="${esc(p.id)}"><span>${brl.format(Number(p.valor) || 0)} em ${dataBR(p.data)}</span><span class="pag-acao">Recibo</span></button>`).join("")}
      </div>`).join("") || `<div class="vazio">Nenhum mês ainda.</div>`}</div>`;
    if (k.historico.length) h += historicoHtml(k);
    box.innerHTML = h;
    $("kdPagar").onclick = () => { kitModo = "pagar"; pagEdit = null; renderDetalhe(); };
    $("kdEditar").onclick = () => { kitModo = "contrato"; renderDetalhe(); };
    const enc = $("kdEncerrar");
    enc.onclick = async () => {
      if (!enc.classList.contains("armado")) { enc.classList.add("armado"); enc.textContent = "Toque de novo para encerrar"; setTimeout(() => { enc.classList.remove("armado"); enc.textContent = "Encerrar contrato"; }, 4000); return; }
      c.encerradoEm = hoje(); k.historico.unshift(c); k.atual = null; k.valor = Number(c.valor) || k.valor || 0;
      await salvarAluguel(`Kitnet ${n} está vaga`); renderAluguel();
    };
    if ($("kdZap")) $("kdZap").onclick = () => cobrarZap(n, c, d);
    if ($("kdAdv")) $("kdAdv").onclick = () => resumoAdvogado(n, c, d);
    box.querySelectorAll("[data-pag]").forEach(b => b.onclick = () => abrirPagamento(n, c, b.dataset.pag, b));
  } else {
    h += `<div class="vazio">Kitnet vaga. Cadastre o inquilino quando assinar o contrato.</div>
      <div class="form-grid">${campo("kvValor", "Aluguel pedido (R$)", fmtValorInput(Number(k.valor) || null), 'inputmode="decimal" placeholder="0,00"')}
      <div class="acoes" style="align-self:end"><button type="button" class="btn" id="kvSalvar">Salvar valor</button></div></div>
      <div class="acoes"><button type="button" class="btn prim" id="kvNovo">Cadastrar inquilino</button></div>`;
    if (k.historico.length) h += historicoHtml(k);
    box.innerHTML = h;
    $("kvSalvar").onclick = async () => { const v = parseBRL($("kvValor").value); k.valor = v > 0 ? Math.round(v * 100) / 100 : 0; await salvarAluguel("Valor salvo"); renderAluguel(); };
    $("kvNovo").onclick = () => { kitModo = "contrato"; renderDetalhe(); };
  }
  $("kdFechar").onclick = () => { kitSel = null; kitModo = "ver"; renderAluguel(); };
}
function historicoHtml(k) {
  return `<div class="card-head" style="margin-top:4px"><h2>Inquilinos anteriores</h2></div><div class="rows">` + k.historico.map(c => {
    const tot = c.pags.reduce((s, p) => s + (Number(p.valor) || 0), 0);
    return `<div class="row ext-ini"><div class="ico" style="background:var(--c-outros)">${esc(iniciais(c.nome))}</div><div class="desc"><b>${esc(c.nome)}</b><span>${dataBR(c.inicio)} a ${dataBR(c.encerradoEm)}</span></div><div class="val"><b class="num">${brl.format(tot)}</b><span>recebido</span></div></div>`;
  }).join("") + `</div>`;
}

async function salvarContrato() {
  const k = aluguel.kits[kitSel];
  const nome = $("kfNome").value.trim(), valor = parseBRL($("kfValor").value), inicio = $("kfInicio").value;
  const venc = parseInt($("kfVenc").value, 10), meses = parseInt($("kfMeses").value, 10);
  const msg = t => { const m = $("kfMsg"); m.textContent = t; m.className = "msg full erro"; };
  if (!nome) return msg("Coloque o nome do inquilino.");
  if (!(valor > 0)) return msg("Coloque o valor do aluguel.");
  if (!inicio) return msg("Coloque a data de início.");
  if (!(venc >= 1 && venc <= 31)) return msg("Dia do vencimento entre 1 e 31.");
  if (!(meses >= 1 && meses <= 120)) return msg("Prazo entre 1 e 120 meses.");
  const garantia = $("kfGar").value, caucao = parseBRL($("kfCau").value);
  if (garantia === "caucao" && caucao > valor * 3 + 0.005) return msg("A caução não pode passar de 3 aluguéis (art. 38, § 2º, da Lei do Inquilinato).");
  const c = k.atual || { id: novoId(), pags: [] };
  Object.assign(c, {
    nome, cpf: $("kfCpf").value.trim(), tel: $("kfTel").value.trim(),
    ocupantes: [$("kfOc2").value.trim(), $("kfOc3").value.trim()].filter(Boolean),
    valor: Math.round(valor * 100) / 100, venc, inicio, meses, fim: addMeses(inicio, meses),
    garantia, caucao: garantia === "caucao" && caucao > 0 ? Math.round(caucao * 100) / 100 : 0,
  });
  k.atual = c; kitModo = "ver";
  await salvarAluguel(`Kitnet ${kitSel}: ${primeiroNome(nome)} cadastrado`); renderAluguel();
}

/* ---------- Cobrança, recibo e resumo ---------- */
function cobrarZap(n, c, d) {
  const meses = d.linhas.map(l => `${nomeRef(l.ref)} (venc. ${dataBR(l.venc)}): ${brl.format(l.falta)}`).join("\n");
  const txt = `Olá, ${primeiroNome(c.nome)}. Tudo bem? Consta em aberto o aluguel da Kitnet ${n}:\n${meses}\n\nPode me enviar o comprovante quando pagar? Obrigado.`;
  let tel = so(c.tel); if (tel.length <= 11) tel = "55" + tel;
  window.open(`https://wa.me/${tel}?text=${encodeURIComponent(txt)}`, "_blank", "noopener");
}
function reciboTexto(n, c, p) {
  const loc = aluguel.locador || {};
  return [
    "RECIBO DE ALUGUEL",
    "",
    `Recebi de ${c.nome}${c.cpf ? ", CPF " + c.cpf : ""}, a quantia de ${brl.format(Number(p.valor) || 0)}, referente ao aluguel da Kitnet nº ${n} do conjunto KitDannis, mês de ${nomeRef(p.ref)}${p.quita && Number(p.valor) < Number(c.valor) ? " (valor proporcional)" : ""}.`,
    "",
    `Discriminação: aluguel ${brl.format(Number(p.valor) || 0)}.`,
    `Pago em ${dataBR(p.data)}.`,
    "",
    `Sumaré/SP, ${dataBR(p.data)}.`,
    "",
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
  if ((c.ocupantes || []).length) L.push(`Demais moradores: ${c.ocupantes.join(", ")}`);
  if (c.tel) L.push(`Telefone: ${c.tel}`);
  L.push(`Vigência: ${dataBR(c.inicio)} a ${dataBR(c.fim)} (${c.meses || "?"} meses)`);
  L.push(`Aluguel: ${brl.format(Number(c.valor) || 0)} – vencimento todo dia ${c.venc}`);
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
  $("raNome").value = aluguel.locador?.nome || "";
  $("raCpf").value = aluguel.locador?.cpf || "";
}
$("btnRetAjustar").onclick = () => abrirAjustes(true);
$("raCancelar").onclick = () => abrirAjustes(false);
$("raSalvar").onclick = async () => {
  const cu = parseBRL($("raCusto").value), de = parseBRL($("raDesp").value);
  aluguel.custoObra = cu > 0 ? Math.round(cu * 100) / 100 : null;
  aluguel.despesasMes = de > 0 ? Math.round(de * 100) / 100 : 0;
  aluguel.locador = { nome: $("raNome").value.trim(), cpf: $("raCpf").value.trim() };
  await salvarAluguel("Ajustes salvos"); abrirAjustes(false); renderAluguel();
};

function renderAluguel() {
  dadosAluguel();
  renderCasas();
  renderDetalhe();
  renderRetorno();
}
