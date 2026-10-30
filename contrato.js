/* KitDannis — contrato de locação preenchido com os dados do app (imprimir, salvar PDF ou baixar para Word). */
"use strict";

/* Valor por extenso em reais */
function extenso(valor) {
  const U = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
  const D = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
  const C = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];
  const ate999 = n => {
    if (n === 100) return "cem";
    const c = Math.floor(n / 100), r = n % 100, p = [];
    if (c) p.push(C[c]);
    if (r) p.push(r < 20 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? " e " + U[r % 10] : ""));
    return p.join(" e ");
  };
  const inteiro = n => {
    if (n === 0) return "zero";
    const mi = Math.floor(n / 1e6), mil = Math.floor((n % 1e6) / 1000), r = n % 1000, p = [];
    if (mi) p.push(mi === 1 ? "um milhão" : ate999(mi) + " milhões");
    if (mil) p.push(mil === 1 ? "mil" : ate999(mil) + " mil");
    if (r) p.push(ate999(r));
    if (p.length > 1) { const ult = p.pop(); return p.join(", ") + ((r && (r < 100 || r % 100 === 0)) || (!r && mil) ? " e " : " ") + ult; }
    return p[0];
  };
  const v = Math.round((Number(valor) || 0) * 100), reais = Math.floor(v / 100), cent = v % 100;
  const partes = [];
  if (reais) partes.push(inteiro(reais) + (reais === 1 ? " real" : (reais % 1e6 === 0 ? " de reais" : " reais")));
  if (cent) partes.push(inteiro(cent) + (cent === 1 ? " centavo" : " centavos"));
  return partes.join(" e ") || "zero reais";
}

/* Monta o HTML do contrato. Campos sem dado saem como linha em branco para preencher à mão. */
function htmlContrato(n, k, c, cf) {
  const B = (v, larg = 10) => (v != null && String(v).trim() !== "") ? esc(v) : `<span class="branco">${"_".repeat(larg)}</span>`;
  const X = sim => sim ? "( X )" : "(&nbsp;&nbsp;&nbsp;)";
  const fem = c.gen === "f";
  const civil = (s, f) => s ? (f ? s.replace(/o$/, "a").replace("viúvo", "viúva") : s) : "";
  const l = cf.loc || {}, im = cf.imovel || {};
  const valor = Number(c.valor) || 0;
  const qual = (p, f) => `${B(p.nome, 30)}, ${B(p.nac && f ? p.nac.replace(/o$/, "a") : p.nac, 12)}, ${B(civil(p.civil, f), 12)}, ${B(p.prof, 14)}, regularmente ${f ? "inscrita" : "inscrito"} no RG nº ${B(p.rg, 14)} e ${f ? "inscrita" : "inscrito"} no CPF nº ${B(p.cpf, 14)}, ${f ? "residente e domiciliada" : "residente e domiciliado"} em ${B(p.end, 40)}`;
  const ender = `${B(im.end, 30)}, ${B(im.cidade || "Sumaré/SP", 10)}, CEP ${B(im.cep, 9)}`;
  const semGar = c.garantia !== "caucao";
  const itens = String(k.itens || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const oc = [{ nome: c.nome, doc: c.cpf || c.rg, rel: "Locatário(a)" }, ...(c.ocupantes || [])];
  while (oc.length < 3) oc.push({});
  const p = c.prop;
  const cl = (t) => `<h3>${t}</h3>`;
  const par = t => `<p>${t}</p>`;
  const sub = t => `<p class="rec">${t}</p>`;
  const fimTxt = c.fim ? dataBR(c.fim) : B("", 10);

  const corpo = `
<h1>CONTRATO DE LOCAÇÃO RESIDENCIAL</h1>
<h2>KITNET Nº ${n} – KITDANNIS</h2>
${par("Pelo presente instrumento particular, as partes abaixo qualificadas celebram o presente Contrato de Locação Residencial, regido pela Lei nº 8.245, de 18 de outubro de 1991 (Lei do Inquilinato), e pelas cláusulas seguintes:")}
${par(`<b>LOCADOR:</b> ${qual(l, false)}.`)}
${par(`<b>LOCATÁRI${fem ? "A" : "O"}:</b> ${qual(c, fem)}.`)}

${cl("CLÁUSULA 1ª – DO IMÓVEL")}
${par(`1.1. O objeto desta locação é a <b>Kitnet nº ${n}</b> do conjunto residencial KitDannis, <b>unidade residencial independente, com entrada própria e 1 (uma) vaga de garagem de uso exclusivo</b>, situada na ${ender}, imóvel objeto da matrícula nº ${B(im.matricula, 8)} do ${B(im.cri, 24)}.`)}
${par(`1.2. A kitnet é entregue:`)}
${sub(`${X(k.mobiliada)} <b>mobiliada</b>, com os móveis, eletrodomésticos e utensílios relacionados no Anexo I;`)}
${sub(`${X(!k.mobiliada)} <b>sem mobília</b>.`)}
${par("1.3. Em qualquer caso, o estado do imóvel na entrega das chaves consta do <b>Anexo I (Laudo de Vistoria)</b>, que integra este contrato juntamente com as fotografias tiradas na entrega. O(A) LOCATÁRIO(A) declara que vistoriou a kitnet e, se for o caso, os bens do Anexo I, e que os recebe em bom estado de conservação e funcionamento, salvo as ressalvas anotadas no próprio Anexo I.")}

${cl("CLÁUSULA 2ª – DA FINALIDADE E DA GARAGEM")}
${par("2.1. A locação destina-se <b>exclusivamente à moradia</b> do(a) LOCATÁRIO(A) e dos ocupantes autorizados na Cláusula 3ª, sendo vedado qualquer uso comercial, profissional, de hospedagem ou de locação por temporada a terceiros (inclusive por aplicativos e plataformas).")}
${par("2.2. São vedadas a cessão da locação, a sublocação e o empréstimo do imóvel, total ou parcial, sem consentimento prévio e escrito do LOCADOR, nos termos do art. 13 da Lei nº 8.245/1991.")}
${par("2.3. A vaga de garagem destina-se exclusivamente à guarda de 1 (um) veículo de passeio ou motocicleta do(a) LOCATÁRIO(A) ou dos ocupantes autorizados, vedados seu uso como depósito e sua cessão ou locação a terceiros. O LOCADOR não responde por furtos, roubos ou danos a veículos e bens deixados na garagem.")}

${cl("CLÁUSULA 3ª – DOS OCUPANTES")}
${par("3.1. A kitnet poderá ser ocupada por, <b>no máximo, 3 (três) pessoas</b>, incluído(a) o(a) LOCATÁRIO(A), exclusivamente as relacionadas abaixo:")}
<table><tr><th>Nome completo</th><th>CPF ou RG</th><th>Relação com o(a) locatário(a)</th></tr>
${oc.slice(0, 4).map(o => `<tr><td>${B(o.nome, 20)}</td><td>${B(o.doc, 12)}</td><td>${B(o.rel, 12)}</td></tr>`).join("")}</table>
${par("3.2. A kitnet foi <b>projetada e construída para ocupação reduzida</b>: sua área, suas instalações elétricas e hidráulicas, o sistema de esgoto e a ventilação foram dimensionados para, no máximo, 3 (três) moradores. Por isso, o limite do item 3.1 é condição essencial deste contrato, adotada por critério técnico de capacidade do imóvel, e não em razão de quem sejam os moradores.")}
${par("3.3. A inclusão de qualquer novo morador depende de autorização prévia e escrita do LOCADOR e não poderá ultrapassar o limite do item 3.1, ressalvado o disposto no item 3.4.")}
${par("3.4. O nascimento ou a adoção de filho do(a) LOCATÁRIO(A) durante a locação não constitui infração contratual, ainda que ultrapassado o limite do item 3.1, devendo o novo morador ser comunicado ao LOCADOR para inclusão no quadro acima.")}
${par(`3.5. Visitas eventuais são livres. A permanência de visitante por mais de ${esc(cf.visitas || 15)} (${extensoNum(cf.visitas || 15)}) dias, seguidos ou alternados, dentro do mesmo mês será considerada ocupação não autorizada, configurando infração contratual.`)}

${cl("CLÁUSULA 4ª – DOS ANIMAIS")}
${par("4.1. É <b>proibido</b> manter, criar, abrigar ou hospedar animais de qualquer espécie na kitnet, na garagem e na área externa da unidade, ainda que temporariamente.")}
${par("4.2. Excetua-se da proibição o cão-guia ou cão de assistência de pessoa com deficiência que resida no imóvel, mediante comunicação prévia ao LOCADOR.")}
${par("4.3. O descumprimento desta cláusula, não corrigido em até 10 (dez) dias após notificação, constitui infração contratual para os fins do art. 9º, inciso II, da Lei nº 8.245/1991, sem prejuízo da multa da Cláusula 13ª e da reparação de danos causados pelo animal.")}

${cl("CLÁUSULA 5ª – DO PRAZO")}
${par(`5.1. A locação vigorará pelo prazo de <b>${esc(c.meses || 30)} (${extensoNum(c.meses || 30)}) meses</b>, com início em ${c.inicio ? dataBR(c.inicio) : B("", 10)} e término em ${fimTxt}, data em que o(a) LOCATÁRIO(A) deverá restituir o imóvel livre de pessoas e bens${Number(c.meses || 30) >= 30 ? ", independentemente de notificação ou aviso, conforme o art. 46 da Lei nº 8.245/1991" : ""}.`)}
${Number(c.meses || 30) >= 30 ? par("5.2. Findo o prazo, se o(a) LOCATÁRIO(A) continuar na posse do imóvel por mais de 30 (trinta) dias sem oposição do LOCADOR, a locação será prorrogada por prazo indeterminado, mantidas as demais cláusulas, podendo o LOCADOR denunciá-la a qualquer tempo, concedido o prazo de 30 (trinta) dias para desocupação (art. 46, §§ 1º e 2º, da Lei nº 8.245/1991).") : ""}

${cl("CLÁUSULA 6ª – DO ALUGUEL E DO PAGAMENTO")}
${par(`6.1. O aluguel mensal é de <b>${valor ? brl.format(valor) : "R$ " + B("", 10)}</b> (${valor ? extenso(valor) : B("", 24)}).`)}
${semGar
  ? par("6.2. Não havendo garantia locatícia, o aluguel e os encargos de cada mês serão pagos <b>antecipadamente, até o 6º (sexto) dia útil do próprio mês de uso</b>, conforme autoriza o art. 42 da Lei nº 8.245/1991.")
  : par(`6.2. O aluguel e os encargos de cada mês serão pagos até o dia <b>${B(c.venc, 3)}</b> do mês seguinte ao vencido.`)}
${par(`6.3. O pagamento será feito por Pix para a chave ${B(cf.pix, 20)}, de titularidade do LOCADOR. O comprovante de transferência identificado e o recibo emitido pelo LOCADOR servirão como quitação do mês a que se referem.`)}
${par("6.4. O LOCADOR fornecerá recibo discriminado dos valores pagos, vedada a quitação genérica (art. 22, inciso VI, da Lei nº 8.245/1991).")}
${p ? par(`6.5. O aluguel do primeiro mês é <b>proporcional aos dias de ocupação</b>: ${brl.format(valor)} ÷ ${p.diasMes} dias × ${p.dias} dias = <b>${brl.format(p.valor)}</b> (${extenso(p.valor)}), ${semGar ? "pago na entrega das chaves" : "pago no primeiro vencimento"}.`)
  : par(`6.5. Iniciada a locação no dia 1º, o primeiro aluguel é integral${semGar ? " e será pago na entrega das chaves" : ""}.`)}

${cl("CLÁUSULA 7ª – DO REAJUSTE")}
${par("7.1. O aluguel será reajustado a cada 12 (doze) meses, contados do início da locação, pela variação acumulada do <b>IPCA/IBGE</b> no período ou, na sua extinção, pelo índice oficial que o substituir. Variação negativa não reduzirá o aluguel.")}

${cl("CLÁUSULA 8ª – DO ATRASO")}
${par("8.1. O pagamento após o vencimento sujeitará o(a) LOCATÁRIO(A) a <b>multa moratória de 10% (dez por cento)</b> sobre o valor em atraso, acrescida de <b>juros de 1% (um por cento) ao mês</b>, calculados dia a dia, e de correção monetária pelo IPCA/IBGE.")}
${par("8.2. A tolerância do LOCADOR quanto a atrasos ou ao descumprimento de qualquer cláusula será mera liberalidade e não implicará novação nem alteração do contrato.")}

${cl("CLÁUSULA 9ª – DOS ENCARGOS")}
${par("9.1. Além do aluguel, cabem ao(à) LOCATÁRIO(A), a partir da entrega das chaves, as contas de consumo da kitnet (art. 23, inciso VIII, da Lei nº 8.245/1991) e os encargos abaixo, na forma combinada entre as partes:")}
${sub(`a) <b>Energia elétrica:</b> ${X(c.luz !== "rat")} independente – medidor próprio da kitnet, com a conta em nome do(a) LOCATÁRIO(A) ou paga diretamente por ele(a); ${X(c.luz === "rat")} rateio – medição comum, com o valor rateado entre as unidades conforme ${B(c.luz === "rat" ? c.rateio : "", 20)}, mediante apresentação da conta;`)}
${sub(`b) <b>Água e esgoto:</b> ${X(c.agua !== "rat")} independente – medidor próprio da kitnet, com a conta em nome do(a) LOCATÁRIO(A) ou paga diretamente por ele(a); ${X(c.agua === "rat")} rateio – medição comum, com o valor rateado entre as unidades conforme ${B(c.agua === "rat" ? c.rateio : "", 20)}, mediante apresentação da conta;`)}
${sub("c) <b>Gás e internet:</b> contratados e pagos diretamente pelo(a) LOCATÁRIO(A);")}
${sub(`d) <b>IPTU:</b> a parcela do IPTU e das taxas municipais correspondente à kitnet, na proporção de ${B(cf.iptu, 5)} do lançamento do imóvel, paga junto com o aluguel, conforme permite o art. 22, inciso VIII, da Lei nº 8.245/1991;`)}
${sub(`e) <b>Despesas comuns</b> (iluminação, limpeza e manutenção de áreas de uso comum, se houver): ${X(c.comum !== "sim")} não há; ${X(c.comum === "sim")} rateadas entre as unidades, desde que comprovadas, conforme ${B(c.comum === "sim" ? c.comumTxt : "", 20)}.`)}
${par("9.2. O seguro contra incêndio do imóvel será contratado pelo LOCADOR.")}

${cl("CLÁUSULA 10ª – DA GARANTIA")}
${semGar
  ? par("10.1. A presente locação é celebrada <b>sem garantia locatícia</b>. As partes declaram ciência de que, nessa condição, o aluguel é pago antecipadamente (art. 42 da Lei nº 8.245/1991) e de que, na ação de despejo fundada exclusivamente na falta de pagamento de aluguel e acessórios, poderá ser concedida liminar para desocupação em 15 (quinze) dias, nos termos do art. 59, § 1º, inciso IX, da mesma Lei.")
  : par(`10.1. Em garantia das obrigações deste contrato, o(a) LOCATÁRIO(A) entrega ao LOCADOR caução em dinheiro de <b>${c.caucao ? brl.format(c.caucao) : "R$ " + B("", 10)}</b>${c.caucao ? ` (${extenso(c.caucao)})` : ""}, não excedendo o limite de 3 (três) meses de aluguel, a ser depositada em caderneta de poupança, revertendo em benefício do(a) LOCATÁRIO(A) os rendimentos, na forma do art. 38, § 2º, da Lei nº 8.245/1991. A caução será devolvida em até 30 (trinta) dias após a entrega das chaves e a vistoria final, abatidos aluguéis, encargos, multas e reparos de danos eventualmente devidos.`)}

${cl("CLÁUSULA 11ª – DA CONSERVAÇÃO, DOS MÓVEIS E DAS BENFEITORIAS")}
${par("11.1. O(A) LOCATÁRIO(A) usará a kitnet, a garagem e, se houver, os bens do Anexo I com o cuidado de quem cuida do que é seu, obrigando-se a restituí-los, ao fim da locação, no estado em que os recebeu, salvo as deteriorações decorrentes do uso normal (art. 23, incisos II e III, da Lei nº 8.245/1991).")}
${par("11.2. Danos causados pelo(a) LOCATÁRIO(A), seus ocupantes ou visitantes serão reparados imediatamente às suas custas (art. 23, inciso V). Bem do Anexo I perdido ou danificado sem conserto será reposto por outro equivalente, novo, ou indenizado pelo valor de mercado de um bem novo equivalente.")}
${par("11.3. O(A) LOCATÁRIO(A) comunicará imediatamente ao LOCADOR qualquer dano ou defeito cuja reparação caiba a este (art. 23, inciso IV). Cabem ao LOCADOR os reparos estruturais e os decorrentes de defeitos anteriores à locação ou do desgaste natural dos bens.")}
${par("11.4. É vedado modificar a forma interna ou externa da kitnet, furar paredes ou azulejos, pintar, trocar fechaduras ou retirar móveis do imóvel sem consentimento prévio e escrito do LOCADOR (art. 23, inciso VI).")}
${par("11.5. Quaisquer benfeitorias, ainda que necessárias ou autorizadas, incorporam-se ao imóvel, <b>renunciando o(a) LOCATÁRIO(A) à indenização e ao direito de retenção</b>, conforme permite o art. 35 da Lei nº 8.245/1991. As voluptuárias poderão ser retiradas ao final, desde que sem dano ao imóvel (art. 36).")}

${cl("CLÁUSULA 12ª – DA VISTORIA E DA CONVIVÊNCIA")}
${par("12.1. O LOCADOR poderá vistoriar a kitnet mediante combinação prévia de dia e hora (art. 23, inciso IX), salvo emergência que ameace o imóvel ou as unidades vizinhas.")}
${par(`12.2. O(A) LOCATÁRIO(A) e seus ocupantes observarão as regras de boa vizinhança: silêncio entre ${esc(cf.silencio || "22h e 7h")}; lixo acondicionado e colocado nos dias de coleta; uso da garagem conforme o item 2.3${cf.regras ? "; " + esc(cf.regras) : ""}.`)}

${cl("CLÁUSULA 13ª – DAS INFRAÇÕES E DA RESCISÃO")}
${par("13.1. A locação poderá ser desfeita por mútuo acordo, por infração legal ou contratual, por falta de pagamento do aluguel e encargos ou para reparações urgentes determinadas pelo Poder Público (art. 9º da Lei nº 8.245/1991).")}
${par("13.2. A infração de qualquer cláusula sujeitará a parte infratora à multa de <b>1 (um) aluguel vigente</b>, sem prejuízo da rescisão do contrato e da reparação de danos.")}
${par("13.3. Se o(a) LOCATÁRIO(A) devolver o imóvel antes do término do prazo, pagará <b>multa de 3 (três) aluguéis vigentes, proporcional ao período de cumprimento do contrato</b> (art. 4º da Lei nº 8.245/1991), mediante aviso por escrito com 30 (trinta) dias de antecedência. A multa será dispensada na hipótese de transferência pelo empregador, prevista no parágrafo único do art. 4º, com notificação escrita de 30 (trinta) dias.")}

${cl("CLÁUSULA 14ª – DA DEVOLUÇÃO DAS CHAVES")}
${par("14.1. A devolução das chaves e do controle do portão será feita mediante vistoria final, comparada ao Anexo I, com apresentação das contas de consumo quitadas até a data da saída. A entrega das chaves sem vistoria, ou deixadas no imóvel ou com terceiros, não exonera o(a) LOCATÁRIO(A) das obrigações vencidas e dos danos apurados.")}

${cl("CLÁUSULA 15ª – DAS COMUNICAÇÕES")}
${par("15.1. As comunicações entre as partes serão válidas quando enviadas por escrito, inclusive por e-mail ou WhatsApp, aos contatos abaixo, que cada parte manterá atualizados:")}
${sub(`LOCADOR: e-mail ${B(l.email, 20)} – WhatsApp ${B(l.tel, 15)}`)}
${sub(`LOCATÁRIO(A): e-mail ${B(c.email, 20)} – WhatsApp ${B(c.tel, 15)}`)}

${cl("CLÁUSULA 16ª – DOS DADOS PESSOAIS")}
${par("16.1. Os dados pessoais do(a) LOCATÁRIO(A) e dos ocupantes serão utilizados pelo LOCADOR somente para a execução deste contrato, cobranças, cumprimento de obrigações legais e fiscais e defesa de direitos, podendo ser armazenados em sistema de controle de aluguéis de uso do LOCADOR, e não serão compartilhados com terceiros, salvo por obrigação legal ou para análise de crédito, seguro e cobrança relacionados a esta locação.")}

${cl("CLÁUSULA 17ª – DA ASSINATURA ELETRÔNICA")}
${par("17.1. As partes admitem como válida e eficaz a assinatura deste contrato e de seus anexos por <b>assinatura eletrônica gov.br</b> ou outro meio eletrônico que comprove a autoria e a integridade do documento, nos termos do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001, dispensado o reconhecimento de firma.")}
${par("17.2. O contrato considera-se celebrado na data da última assinatura, e sua integridade poderá ser conferida no validador oficial do ITI (validar.iti.gov.br).")}

${cl("CLÁUSULA 18ª – DO FORO")}
${par("18.1. Fica eleito o foro da Comarca de Sumaré/SP, local do imóvel, para dirimir quaisquer questões decorrentes deste contrato.")}

${par("E, por estarem de acordo, as partes assinam o presente instrumento, juntamente com o Anexo I.")}
<p class="dir">Sumaré/SP, ${dataExtenso(hoje())}.</p>
<div class="ass"><div>__________________________________________<br><b>${B(l.nome, 30)}</b><br>LOCADOR</div>
<div>__________________________________________<br><b>${B(c.nome, 30)}</b><br>LOCATÁRI${fem ? "A" : "O"}</div></div>

<div class="quebra"></div>
<h1>ANEXO I</h1>
<h2>LAUDO DE VISTORIA${k.mobiliada ? " E INVENTÁRIO DE MÓVEIS" : ""}</h2>
${par(`Kitnet nº ${n} – KitDannis – ${ender}. Vistoria de: ( &nbsp; ) entrada &nbsp;( &nbsp; ) saída. Data: ____/____/________.`)}
${k.mobiliada ? `<h3>1. Móveis, eletrodomésticos e utensílios</h3>
<table><tr><th style="width:45%">Item</th><th>Qtd.</th><th>Estado</th><th>Observações</th></tr>
${(itens.length ? itens : Array(8).fill("")).map(i => `<tr><td>${B(i, 20)}</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>`).join("")}</table>` : ""}
<h3>${k.mobiliada ? "2" : "1"}. Estado do imóvel</h3>
<table><tr><th style="width:38%">Parte</th><th>Estado</th><th>Observações (riscos, manchas, trincas)</th></tr>
${["Paredes e pintura", "Piso e rodapés", "Portas, fechaduras e janelas", "Banheiro (louças, metais, box)", "Cozinha (pia, torneira, azulejos)", "Instalação elétrica (tomadas, lâmpadas)", "Instalação hidráulica (vazamentos)", "Entrada, portão e garagem"].map(x => `<tr><td>${x}</td><td>&nbsp;</td><td>&nbsp;</td></tr>`).join("")}</table>
<h3>${k.mobiliada ? "3" : "2"}. Chaves e medidores</h3>
<table><tr><th style="width:50%">Item</th><th>Registro</th></tr>
<tr><td>Chaves entregues</td><td>&nbsp;</td></tr><tr><td>Controle do portão</td><td>&nbsp;</td></tr>
<tr><td>Leitura do medidor de energia</td><td>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; kWh</td></tr><tr><td>Leitura do medidor de água</td><td>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; m³</td></tr></table>
${par("As fotografias tiradas nesta vistoria, com data, integram este laudo. Ressalvas do(a) locatário(a): ____________________________________________.")}
<div class="ass"><div>__________________________________________<br><b>${B(l.nome, 30)}</b><br>LOCADOR</div>
<div>__________________________________________<br><b>${B(c.nome, 30)}</b><br>LOCATÁRI${fem ? "A" : "O"}</div></div>`;
  return corpo;
}
function extensoNum(n) { return extenso(Number(n) || 0).replace(/ reais?$/, "").replace(" de", ""); }

const CSS_DOC = `
  .doc { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.5; color: #000; }
  .doc h1 { font-size: 14pt; text-align: center; margin: 0 0 2px; }
  .doc h2 { font-size: 12pt; text-align: center; margin: 0 0 18px; }
  .doc h3 { font-size: 11pt; margin: 16px 0 6px; page-break-after: avoid; }
  .doc p { text-align: justify; margin: 0 0 8px; }
  .doc p.rec { margin-left: 24px; }
  .doc p.dir { text-align: right; margin-top: 18px; }
  .doc table { width: 100%; border-collapse: collapse; margin: 4px 0 12px; font-size: 10pt; }
  .doc th, .doc td { border: 1px solid #777; padding: 5px 7px; text-align: left; vertical-align: top; }
  .doc th { background: #e9e9e9; }
  .doc .branco { color: #000; }
  .doc .ass { display: flex; flex-wrap: wrap; gap: 24px 40px; justify-content: space-around; margin-top: 44px; text-align: center; page-break-inside: avoid; }
  .doc .ass > div { min-width: 240px; }
  .doc .quebra { page-break-before: always; break-before: page; height: 0; margin-top: 32px; }`;

let docAtual = null;
function abrirContratoDoc(n) {
  const k = aluguel.kits[n], c = k.atual; if (!c) return;
  docAtual = { n, nome: c.nome, html: htmlContrato(n, k, c, aluguel.contrato) };
  $("docPapel").innerHTML = `<div class="doc">${docAtual.html}</div>`;
  const faltam = [];
  const cf = aluguel.contrato;
  if (!cf.loc.nome || !cf.loc.cpf) faltam.push("seus dados");
  if (!cf.imovel.end) faltam.push("endereço do imóvel");
  if (!cf.pix) faltam.push("chave Pix");
  if (!c.cpf || !c.rg || !c.prof || !c.civil) faltam.push("dados do inquilino");
  $("docAviso").textContent = faltam.length ? `Faltando: ${faltam.join(", ")}. Essas partes saem como linha em branco.` : "";
  $("docView").hidden = false; document.body.classList.add("doc-aberto");
  $("docView").scrollTop = 0;
}
function fecharDoc() { $("docView").hidden = true; document.body.classList.remove("doc-aberto"); }
$("docFechar").onclick = fecharDoc;
$("docImprimir").onclick = () => window.print();
$("docWord").onclick = () => {
  if (!docAtual) return;
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>Contrato Kitnet ${docAtual.n}</title>
<style>@page { size: 21cm 29.7cm; margin: 2.5cm 2cm 2cm 3cm; } body { font-family: Arial; font-size: 11pt; } ${CSS_DOC.replace(/\.doc /g, "")}</style></head><body><div class="doc">${docAtual.html}</div></body></html>`;
  entregarArquivo(`contrato-kitnet-${docAtual.n}-${slug(docAtual.nome)}.doc`, new Blob(["﻿" + html], { type: "application/msword" }));
};
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("docView").hidden) fecharDoc(); });
(() => { const s = document.createElement("style"); s.textContent = CSS_DOC; document.head.appendChild(s); })();
