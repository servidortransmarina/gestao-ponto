/* FRONTEND — GitHub Pages. Atualize esta URL após uma NOVA implantação do Apps Script. */
const API_URL = 'https://script.google.com/macros/s/AKfycbwUH3n8zl4g_kgxvfSxmXW0qZQ4pi_SuZ-EOM0B86KkM23kSca4n41PZyC-ABhkj3zI/exec';
const STORAGE_KEY = 'transmarina_gestao_sessao_v2';
const APP = {sessao:null, cartas:[], pendentes:[], acoesCartas:[], assinaturasResponsaveis:[], saldos:[], funcionarios:[], folgas:[], selecionadas:new Set(), aba:'horas', subaba:'controle', cartaEditando:null, usuarios:{pendentes:[],ativos:[],recusados:[]}};
const $ = id => document.getElementById(id);
const norm = x => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
// (FALTA) identifica o tipo da carta, mas a busca de empresa e responsável
// usa o nome real do colaborador, sem exigir um novo cadastro no MobPonto.
function separarNomeCarta(valor) {
  const texto=String(valor??'').trim();
  // Compatível também com as cartas antigas do Excel: "NOME(FALTA)".
  const inicio=/^\(\s*FALTA\s*\)\s*/i;
  const fim=/\s*\(\s*FALTA\s*\)$/i;
  const falta=inicio.test(texto)||fim.test(texto);
  const nomeBase=texto.replace(inicio,'').replace(fim,'').replace(/\s+/g,' ').trim();
  return {falta,nomeBase};
}
function formatarNomeCarta(nomeBase,falta=false) {
  const nome=String(nomeBase??'').replace(/\s+/g,' ').trim();
  return falta&&nome?`(FALTA) ${nome}`:nome;
}

// V30.12 — Padronização pelo nome completo oficial quando a identificação for única.
// (FALTA) indica somente o tipo de carta, preservado no histórico individual.
// Não inventar a identidade de colaboradores antigos fora da base.
const partículasNomeCarta=new Set(['DA','DE','DO','DAS','DOS','E']);
function partesNomeCarta(valor) {
  return norm(separarNomeCarta(valor).nomeBase)
    .replace(/[^A-Z0-9\s]/g,' ').split(/\s+/)
    .filter(p=>p&&!partículasNomeCarta.has(p));
}
function correspondeAbreviacaoCarta(informado,oficial) {
  const a=partesNomeCarta(informado),b=partesNomeCarta(oficial);
  if(a.length<2||a.length>b.length||b.length<2||a[0]!==b[0])return false;
  const equiv=(curto,longo)=>curto===longo||(curto.length===1&&longo.startsWith(curto));
  // Nome completo ou prefixo inequívoco, por exemplo José Carlos → José Carlos Vieira.
  if(a.every((parte,i)=>equiv(parte,b[i])))return true;
  // A abreviação também pode omitir um nome intermediário, desde que mantenha
  // o último sobrenome: "José F. Santos" → "José Fernando Silva Santos".
  if(a.length<3||a[a.length-1]!==b[b.length-1])return false;
  let pos=1;
  for(let i=1;i<a.length-1;i++) {
    while(pos<b.length-1&&!equiv(a[i],b[pos]))pos++;
    if(pos>=b.length-1)return false;
    pos++;
  }
  return true;
}
function localizarNomeCartaNaBase(nome) {
  const fontes=APP.funcionarios.length?APP.funcionarios:APP.saldos;
  const chave=norm(separarNomeCarta(nome).nomeBase).replace(/\s+/g,' ');
  const matchesExatos=fontes.filter(f=>norm(f.nome).replace(/\s+/g,' ')===chave);
  const matches=matchesExatos.length?matchesExatos:
    fontes.filter(f=>correspondeAbreviacaoCarta(nome,f.nome));
  // Evitar adivinhar a empresa entre homônimos ou abreviações ambíguas.
  const unicos=[...new Map(matches.map(f=>[
    norm(f.nome)+'|'+norm(f.empresa),f
  ])).values()];
  return {registro:unicos.length===1?unicos[0]:null,ambiguo:unicos.length>1};
}
function chaveFuncionarioCarta(nome) {
  const base=norm(separarNomeCarta(nome).nomeBase).replace(/\s+/g,' ');
  const localizado=localizarNomeCartaNaBase(nome);
  return localizado.registro?'OFICIAL|'+norm(localizado.registro.nome)+'|'+norm(localizado.registro.empresa):
    'LIVRE|'+base;
}
// Ao selecionar um funcionário, usar sempre o nome COMPLETO da base.
// Jamais reaproveitar uma abreviação histórica na sugestão do formulário.
function nomeHistoricoPreferidoCarta(nome) {
  const {falta,nomeBase}=separarNomeCarta(nome);
  const localizado=localizarNomeCartaNaBase(nomeBase);
  return formatarNomeCarta(localizado.registro?.nome||nomeBase,falta);
}

// Contador do menu; no celular o selo some quando o valor é zero.
function definirBadge(id,n){const el=$(id);if(!el)return;el.textContent=String(n);el.dataset.zero=Number(n)>0?'0':'1';}
const esc = v => String(v == null?'':v).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => {const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
const mesAtual = () => today().slice(0,7);
function ontem() {
  const d=new Date(); d.setDate(d.getDate()-1);
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
// V30.14 — O campo nativo type=date do Chrome pode completar o ano antes
// do fim da digitação (por exemplo, 2026 virava 2006). Para entrada manual,
// usar texto DD/MM/AAAA; converter para AAAA-MM-DD apenas ao chamar a API.
function dataParaISO(valor) {
  const texto=String(valor??'').trim();
  if(!texto)return '';
  let ano,mes,dia;
  let m=texto.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if(m){ano=Number(m[1]);mes=Number(m[2]);dia=Number(m[3]);}
  else {
    m=texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if(m){
      dia=Number(m[1]);mes=Number(m[2]);
      ano=m[3].length===2?2000+Number(m[3]):Number(m[3]);
    }else{
      // Algumas datas antigas do Google Sheets chegam como Date.toString()
      // em inglês (ex.: "Wed Nov 04 2026 00:00:00 GMT-0300").
      // Converter para a data LOCAL de São Paulo antes de preencher o campo.
      const d=new Date(texto);
      if(Number.isNaN(d.getTime()))return '';
      const partes=new Intl.DateTimeFormat('en-GB',{
        timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric'
      }).formatToParts(d);
      const valor=tipo=>Number(partes.find(p=>p.type===tipo)?.value);
      dia=valor('day');mes=valor('month');ano=valor('year');
    }
  }
  if(ano<1900||ano>2100||mes<1||mes>12||dia<1||dia>31)return '';
  const ultimoDia=new Date(ano,mes,0).getDate();
  if(dia>ultimoDia)return '';
  return `${String(ano).padStart(4,'0')}-${String(mes).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
}
function dataISOParaCampo(valor) {
  const texto=String(valor??'').trim();
  const iso=dataParaISO(texto);
  if(!iso)return texto;
  const [ano,mes,dia]=iso.split('-');
  return `${dia}/${mes}/${ano.slice(-2)}`;
}
function normalizarAnoDaData(input) {
  if(!input)return false;
  if(!String(input.value||'').trim())return !input.required;
  const iso=dataParaISO(input.value);
  if(!iso)return false;
  input.value=dataISOParaCampo(iso);
  return true;
}
function configurarCampoDataBR(id) {
  const input=$(id);
  if(!input)return;
  input.placeholder='DD/MM/AA';
  input.addEventListener('input',()=>{
    // A máscara insere as barras sem alterar o ano enquanto a pessoa digita.
    const valor=input.value.trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(valor)){
      input.value=dataISOParaCampo(valor);return;
    }
    const numeros=valor.replace(/\D/g,'').slice(0,8);
    input.value=numeros.length>4
      ?`${numeros.slice(0,2)}/${numeros.slice(2,4)}/${numeros.slice(4)}`
      :numeros.length>2?`${numeros.slice(0,2)}/${numeros.slice(2)}`:numeros;
  });
  input.addEventListener('blur',()=>normalizarAnoDaData(input));
  input.addEventListener('change',()=>normalizarAnoDaData(input));
}
// Converte datas para a apresentação brasileira, sem mudar o formato enviado à API.
// Aceita datas do Sheets, ISO, dd/mm/aaaa, timestamps e Date.toString() em inglês.
const formatoDiaBR = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit'
});
const formatoHoraBR = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
function formatarDataBR(valor, incluirHora = false) {
  if(valor === null || valor === undefined || String(valor).trim() === '')return '—';
  const texto=String(valor).trim();

  // Datas ISO sem fuso são datas de calendário: NÃO passar por Date(),
  // pois 00:00 UTC pode virar o dia anterior no Brasil.
  const iso=texto.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/i);
  if(iso){
    const [,ano,mes,dia,hora,minuto,fuso]=iso;
    if(fuso){
      const instante=new Date(texto.replace(' ','T'));
      if(!Number.isNaN(instante.getTime())){
        return formatoDiaBR.format(instante)+(incluirHora?' '+formatoHoraBR.format(instante):'');
      }
    }
    return `${dia}/${mes}/${ano.slice(-2)}`+(incluirHora&&hora?` ${hora}:${minuto}`:'');
  }

  const br=texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:[ ,T]+(\d{2}):(\d{2}))?$/);
  if(br){
    const [,dia,mes,ano,hora,minuto]=br;
    const valido=dataParaISO(`${dia}/${mes}/${ano}`);
    if(valido)return `${dia.padStart(2,'0')}/${mes.padStart(2,'0')}/${valido.slice(2,4)}`+
      (incluirHora&&hora?` ${hora}:${minuto}`:'');
  }

  // O Google Sheets pode devolver a data no formato textual inglês.
  const instante=new Date(texto);
  if(!Number.isNaN(instante.getTime())){
    return formatoDiaBR.format(instante)+(incluirHora?' '+formatoHoraBR.format(instante):'');
  }
  console.warn('Formato de data não reconhecido:',texto);
  return '—';
}
const fmtData = x => formatarDataBR(x);
const fmtDataHora = x => formatarDataBR(x, true);
const fmtDia = () => formatoDiaBR.format(new Date());
const mensagens = {horas:'Banco de horas — 3 meses',folgas:'Planejamento de folgas',cartas:'Controle de cartas de ponto',pendentes:'Assinaturas pendentes',usuarios:'Gerenciar usuários'};

async function api(acao, extras={}) {
  if(!API_URL.startsWith('https://script.google.com/macros/s/'))throw Error('Configure a URL do Apps Script.');
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),55000);
  try {
    const res=await fetch(API_URL,{
      method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({acao,token:APP.sessao?.token||'',...extras}),signal:controller.signal,redirect:'follow'
    });
    if(!res.ok)throw Error('Falha HTTP '+res.status+' ao consultar o Apps Script.');
    let dados;try{dados=await res.json();}catch(err){throw Error('A API não retornou JSON válido. Confira a implantação e o acesso ao script.');}
    if(!dados.sucesso) {
      const erro=String(dados.erro||dados.mensagem||'Falha não identificada.');
      if(/sessão.*(inválid|expirad|ausente|encontrada)|usuário desativado/i.test(erro))encerrarSessaoLocal();
      throw Error(erro);
    }
    return dados;
  } catch(e){if(e.name==='AbortError')throw Error('O servidor demorou demais para responder. Tente novamente.');throw e;}
  finally{clearTimeout(timeout);}
}
function showMessage(msg,titulo='Aviso',erro=false) {
  $('msg-titulo').textContent=titulo;$('msg-texto').textContent=String(msg);
  $('msg-icon').textContent=erro?'!':'✓';$('msg-icon').classList.toggle('is-error',erro);
  $('modal-mensagem').hidden=false;
}
// Feedback discreto, sem modal, para as atualizações manuais.
let tmAvisoTimer;
function feedbackAtualizacao(texto,erro=false) {
  let aviso=$('tm-feedback-atualizacao');
  if(!aviso){
    aviso=document.createElement('div');aviso.id='tm-feedback-atualizacao';
    aviso.className='tm-feedback-atualizacao';aviso.setAttribute('role','status');
    aviso.setAttribute('aria-live','polite');document.body.appendChild(aviso);
  }
  aviso.textContent=(erro?'⚠ ':'✓ ')+texto;
  aviso.classList.toggle('tm-feedback-erro',erro);
  aviso.classList.add('tm-feedback-visivel');
  clearTimeout(tmAvisoTimer);
  tmAvisoTimer=setTimeout(()=>aviso.classList.remove('tm-feedback-visivel'),3200);
}

// Executa a ação real; a logo se desloca enquanto a Promise não foi concluída.
// Não exibe porcentagens fictícias nem encerra o carregamento antes da resposta.
async function comBotaoCarregando(botao, executar, texto='Carregando…', sucesso='') {
  if(!botao)return executar();
  if(botao.dataset.tmLoading==='1')return false;
  const conteudoOriginal=botao.innerHTML;
  const desabilitadoAntes=botao.disabled;
  const ariaAnterior=botao.getAttribute('aria-label');
  botao.dataset.tmLoading='1';botao.disabled=true;
  botao.classList.add('tm-carregando');botao.setAttribute('aria-busy','true');
  botao.setAttribute('aria-label',texto);
  botao.innerHTML=`<span class="tm-carregando-texto">${esc(texto)}</span><span class="tm-logo-pista" aria-hidden="true"><span class="tm-logo-viagem"><img src="logotrm.png" alt="" onerror="this.parentElement.classList.add('tm-logo-indisponivel')"></span></span>`;
  try{
    const resultado=await executar();
    if(sucesso){
      if(resultado===false)feedbackAtualizacao('Não foi possível atualizar. Confira a mensagem na tela.',true);
      else feedbackAtualizacao(sucesso);
    }
    return resultado;
  }catch(e){
    showMessage(e.message||'Não foi possível concluir a operação.','Falha na operação',true);
    return false;
  }finally{
    botao.innerHTML=conteudoOriginal;botao.disabled=desabilitadoAntes;
    botao.classList.remove('tm-carregando');botao.removeAttribute('aria-busy');
    if(ariaAnterior===null)botao.removeAttribute('aria-label');
    else botao.setAttribute('aria-label',ariaAnterior);
    delete botao.dataset.tmLoading;
  }
}
function fecharMensagem(){$('modal-mensagem').hidden=true;}
function telaLogin(mostrar) {
  $('modal-login').hidden=!mostrar;$('shell').hidden=mostrar;
  if(mostrar)mostrarTelaAcesso('login');
}
function mostrarTelaAcesso(modo) {
  const dados={
    login:['Bem-vindo de volta','Entre com seu usuário e senha para acessar seu painel.'],
    recuperar:['Redefinir senha','Enviaremos um código ao e-mail cadastrado para confirmar sua identidade.'],
    cadastro:['Criar uma conta','Confirme seu e-mail, informe seu nome e CPF e receba um usuário automático.']
  };
  if(!dados[modo])return;
  ['login','recuperar','cadastro'].forEach(p=>$('auth-painel-'+p).hidden=(p!==modo));
  $('auth-titulo').textContent=dados[modo][0];$('auth-subtitulo').textContent=dados[modo][1];
  ['login-erro','recuperar-erro','cadastro-erro'].forEach(id=>$(id).hidden=true);
}
function mensagemAcesso(modo,mensagem,erro=false) {
  const el=$(modo+'-'+(erro?'erro':'info'));
  el.textContent=mensagem;el.hidden=false;
  $(modo+'-'+(erro?'info':'erro')).hidden=true;
}
async function operacaoAcesso(botao,executar) {
  if(botao.disabled)return;
  const original=botao.textContent;botao.disabled=true;botao.textContent='Aguarde…';
  try{await executar();}
  catch(e){
    const modo=botao.id.startsWith('recuperar-')?'recuperar':'cadastro';
    mensagemAcesso(modo,e.message||'Não foi possível concluir a solicitação.',true);
  }finally{botao.disabled=false;botao.textContent=original;}
}
// Política do formulário: o backend sempre valida novamente (_senhaForte).
function erroSenhaNova(senha) {
  if(typeof senha!=='string'||senha.length<8||senha.length>128||/[\r\n]/.test(senha))
    return 'A senha deve ter entre 8 e 128 caracteres.';
  if(!/[A-Z]/.test(senha))return 'Inclua pelo menos uma letra maiúscula.';
  if(!/[a-z]/.test(senha))return 'Inclua pelo menos uma letra minúscula.';
  if(!/[0-9]/.test(senha))return 'Inclua pelo menos um número.';
  if(!/[^\p{L}\p{N}\s]/u.test(senha))
    return 'Inclua pelo menos um símbolo, como !, @, # ou $.';
  return '';
}

function ligarOlhosDeSenha() {
  document.querySelectorAll('[data-olho]').forEach(botao=>botao.addEventListener('click',()=>{
    const campo=$(botao.dataset.olho),revelar=campo.type==='password';
    campo.type=revelar?'text':'password';
    botao.setAttribute('aria-pressed',String(revelar));
    botao.setAttribute('aria-label',revelar?'Ocultar senha':'Mostrar senha');
    botao.title=revelar?'Ocultar senha':'Mostrar senha';
    campo.focus({preventScroll:true});
  }));
}
function configurarAcessoEmail(){
  ligarOlhosDeSenha();
  $('auth-abrir-recuperar').addEventListener('click',()=>{
    if($('login-usuario').value.includes('@'))$('recuperar-email').value=$('login-usuario').value;
    mostrarTelaAcesso('recuperar');$('recuperar-email').focus();
  });
  $('auth-abrir-cadastro').addEventListener('click',()=>{mostrarTelaAcesso('cadastro');$('form-cadastro').hidden=false;$('cadastro-concluido').hidden=true;$('cadastro-voltar').hidden=false;$('cadastro-email').focus();});
  $('recuperar-voltar').addEventListener('click',()=>mostrarTelaAcesso('login'));
  $('cadastro-voltar').addEventListener('click',()=>mostrarTelaAcesso('login'));
  ['recuperar','cadastro'].forEach(modo=>{
    $(modo+'-email').addEventListener('input',()=>{
      $(modo+'-etapa2').hidden=true;
      $(modo+'-info').hidden=true;$(modo+'-erro').hidden=true;
    });
    $(modo+'-enviar').addEventListener('click',()=>{
      const email=$(modo+'-email');
      if(!email.reportValidity())return;
      operacaoAcesso($(modo+'-enviar'),async()=>{
        const acao=modo==='recuperar'?'solicitarCodigoRecuperacao':'solicitarCodigoCadastro';
        const r=await api(acao,{email:email.value.trim()});
        $(modo+'-etapa2').hidden=false;
        mensagemAcesso(modo,r.mensagem||'Se o e-mail estiver disponível, um código será enviado.');
        $(modo+'-codigo').focus();
      });
    });
  });
  $('form-recuperar').addEventListener('submit',e=>{
    e.preventDefault();
    const erroSenha=erroSenhaNova($('recuperar-senha').value);
    if(erroSenha){mensagemAcesso('recuperar',erroSenha,true);return;}
    if($('recuperar-senha').value!==$('recuperar-confirmar').value){
      mensagemAcesso('recuperar','As senhas informadas não são iguais.',true);return;
    }
    operacaoAcesso($('recuperar-confirmar-botao'),async()=>{
      await api('redefinirSenhaEmail',{
        email:$('recuperar-email').value.trim(),codigo:$('recuperar-codigo').value.trim(),senhaNova:$('recuperar-senha').value
      });
      $('form-recuperar').reset();$('recuperar-etapa2').hidden=true;
      mostrarTelaAcesso('login');
      feedbackAtualizacao('Senha alterada! Entre com sua nova senha.');
    });
  });
  $('cadastro-ir-login').addEventListener('click',()=>mostrarTelaAcesso('login'));
  $('cadastro-copiar-usuario').addEventListener('click',async()=>{
    const input=$('cadastro-usuario-gerado');
    input.focus();input.select();
    try{
      await navigator.clipboard.writeText(input.value);
      $('cadastro-copiar-usuario').textContent='Copiado!';
    }catch(_){
      // A seleção também permite Ctrl+C se o navegador bloquear a área de transferência.
      $('cadastro-copiar-usuario').textContent='Selecione e copie';
    }
  });
  $('cadastro-cpf').addEventListener('input',e=>{
    const d=e.target.value.replace(/\D/g,'').slice(0,11);
    let valor=d.slice(0,3);
    if(d.length>3)valor+='.'+d.slice(3,6);
    if(d.length>6)valor+='.'+d.slice(6,9);
    if(d.length>9)valor+='-'+d.slice(9,11);
    e.target.value=valor;
  });
  $('form-cadastro').addEventListener('submit',e=>{
    e.preventDefault();
    const erroSenha=erroSenhaNova($('cadastro-senha').value);
    if(erroSenha){mensagemAcesso('cadastro',erroSenha,true);return;}
    if($('cadastro-senha').value!==$('cadastro-confirmar').value){
      mensagemAcesso('cadastro','As senhas informadas não são iguais.',true);return;
    }
    operacaoAcesso($('cadastro-confirmar-botao'),async()=>{
      const cpf=$('cadastro-cpf').value.replace(/\D/g,'');
      if(cpf.length!==11)throw Error('Digite os 11 números do CPF.');
      const resposta=await api('concluirCadastroEmail',{
        email:$('cadastro-email').value.trim(),codigo:$('cadastro-codigo').value.trim(),
        cpf,nome:$('cadastro-nome').value.trim(),senhaNova:$('cadastro-senha').value
      });
      if(!resposta.usuario)throw Error('Não foi possível obter o usuário gerado.');
      $('login-usuario').value=resposta.usuario;
      $('cadastro-usuario-gerado').value=resposta.usuario;
      $('form-cadastro').reset();$('cadastro-etapa2').hidden=true;
      $('form-cadastro').hidden=true;
      $('cadastro-voltar').hidden=true;
      $('cadastro-concluido').hidden=false;
    });
  });
}

// O servidor usa o dia de Brasília. Datas locais do navegador podem ser diferentes
// em viagens, fusos e computadores com horários desajustados.
function diaSessaoBrasil() {
  const partes=new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date());
  const p=Object.fromEntries(partes.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
// Enquanto o Apps Script valida o token salvo, não mostrar um formulário de
// login que dá a impressão de que F5 desconectou o usuário.
function mostrarRestauracaoSessao(mostrar, falhou=false) {
  const form=$('form-login');
  if(!form)return;
  let area=$('tm-restaurando-sessao');
  if(!area) {
    area=document.createElement('div');
    area.id='tm-restaurando-sessao';
    area.setAttribute('role','status');
    area.setAttribute('aria-live','polite');
    area.style.cssText='text-align:center;padding:18px 8px 24px;color:#294967;line-height:1.6';
    form.parentElement.insertBefore(area,form);
  }
  area.replaceChildren();
  if(mostrar) {
    const titulo=document.createElement('strong');
    titulo.textContent=falhou?'Não foi possível verificar sua sessão.':'Restaurando seu acesso…';
    area.appendChild(titulo);
    if(falhou) {
      const dica=document.createElement('p');
      dica.textContent='A sessão foi preservada. Tente novamente quando a conexão estiver normal.';
      area.appendChild(dica);
      const tentar=document.createElement('button');
      tentar.type='button';tentar.className='btn primary';
      tentar.textContent='Tentar novamente';
      tentar.addEventListener('click',verificarSessao);
      area.appendChild(tentar);
      const trocar=document.createElement('button');
      trocar.type='button';trocar.className='btn subtle';
      trocar.textContent='Entrar com outra conta';
      trocar.style.marginLeft='8px';
      trocar.addEventListener('click',encerrarSessaoLocal);
      area.appendChild(trocar);
    }
  }
  area.hidden=!mostrar;
  form.hidden=mostrar;
}
function encerrarSessaoLocal() {
  APP.sessao=null;localStorage.removeItem(STORAGE_KEY);
  mostrarRestauracaoSessao(false);
  telaLogin(true);$('login-senha').value='';
}
async function logout() {
  try{await api('logout');}catch(e){console.warn('Logout remoto:',e.message);}
  encerrarSessaoLocal();
}
async function login(event) {
  event?.preventDefault();
  const usuario=$('login-usuario').value.trim(),senha=$('login-senha').value;
  $('login-erro').hidden=true;
  try{
    const r=await api('login',{usuario,senha});
    APP.sessao={token:r.token,perfil:r.perfil,usuario:r.usuario,dataLogin:r.dataLogin};
    localStorage.setItem(STORAGE_KEY,JSON.stringify(APP.sessao));
    await iniciarPainel();
  }catch(e){$('login-erro').textContent=e.message;$('login-erro').hidden=false;}
}
async function verificarSessao() {
  let salvo;
  try {salvo=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');}
  catch(e){return encerrarSessaoLocal();}
  // O login vale até 23:59:59 do dia de Brasília, incluindo quantos F5 desejar.
  if(!salvo?.token || (salvo.dataLogin && salvo.dataLogin!==diaSessaoBrasil()))
    return encerrarSessaoLocal();
  APP.sessao=salvo;
  telaLogin(true);
  mostrarRestauracaoSessao(true);
  try {
    const r=await api('validarSessao');
    // Só o Apps Script decide se o token continua válido. Não usar uma sessão
    // que o servidor informou estar vencida ou sem perfil.
    if(r.dataLogin!==diaSessaoBrasil() || !['ADM','ENCARREGADO'].includes(r.perfil)) {
      encerrarSessaoLocal();return;
    }
    // Preservar o Nome Exibição usado pela fila de cartas rápidas. A API
    // validarSessao responde com login técnico; trocá-lo pelo nome de login
    // faria os envios pendentes parecerem de outra conta depois do F5.
    APP.sessao={...salvo,perfil:r.perfil,usuario:salvo.usuario||r.usuario,dataLogin:r.dataLogin};
    localStorage.setItem(STORAGE_KEY,JSON.stringify(APP.sessao));
    mostrarRestauracaoSessao(false);
    await iniciarPainel();
  } catch(e) {
    console.warn('Não foi possível restaurar a sessão:',e.message);
    // Rejeição explícita da sessão ou bloqueio da conta: exigir login novamente.
    // Falha temporária, timeout ou erro ao carregar o painel: NÃO apagar token.
    if(/sessão.*(inválid|expirad|ausente|encontrada)|usuário desativado/i.test(String(e.message)))
      return encerrarSessaoLocal();
    telaLogin(true);
    mostrarRestauracaoSessao(true,true);
  }
}
async function iniciarPainel() {
  telaLogin(false);
  const adm=APP.sessao.perfil==='ADM';
  document.querySelectorAll('[data-admin]').forEach(el=>el.hidden=!adm);
  $('visao-horas-adm').hidden=!adm;
  $('visao-horas-encarregado').hidden=adm;
  $('perfil-tag').textContent=adm?'ADMINISTRADOR':'ENCARREGADO';
  $('usuario-nome').textContent=APP.sessao.usuario;$('avatar').textContent=(APP.sessao.usuario||'GP').split(' ').slice(0,2).map(s=>s[0]).join('').toUpperCase();
  $('data-hoje').textContent=fmtDia();
  escolherAba('horas');
  const operacoes=[carregarSaldos(),carregarFolgas()];
  if(adm){retomarSincronizacao();operacoes.push(carregarCartas(),carregarAcoesCartas(),carregarAssinaturasResponsaveis(),carregarFuncionarios(),carregarUsuarios());}
  else operacoes.push(carregarPendentes());
  await Promise.allSettled(operacoes);
  if(adm){
    // As consultas de cartas, assinaturas e funcionários chegam em paralelo.
    // Refazer a associação ao fim para não perder sugestões por ordem de rede.
    reconstruirHistoricoResponsaveisCarta();
    reativarFilaDeCartas();
  }
}
function escolherAba(tab) {
  if(['cartas','usuarios'].includes(tab)&&APP.sessao?.perfil!=='ADM')return;
  APP.aba=tab;
  document.querySelectorAll('.nav-button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id==='sec-'+tab));
  $('titulo-pagina').textContent=mensagens[tab]||'Gestão de ponto';
  if(tab==='cartas')escolherSubaba(APP.subaba);
  // Tela própria: atualiza só pendências em vez do histórico de todas as cartas.
  if(tab==='pendentes'&&APP.sessao?.perfil==='ADM')carregarPendentes();
}
function escolherSubaba(sub) {
  APP.subaba=sub;
  document.querySelectorAll('.subnav-btn').forEach(b=>b.classList.toggle('active',b.dataset.sub===sub));
  document.querySelectorAll('.subpage').forEach(p=>p.classList.toggle('active',p.id==='sub-'+sub));
  if(sub==='capa')renderCapa();
  if(sub==='relatorios')renderRelatorios();
  if(sub==='resumo')renderResumoBanco();
  if(sub==='banco')ebAoAbrir();
}

// Administração de contas — leitura e decisões sempre validadas no Apps Script.
async function carregarUsuarios() {
  if(APP.sessao?.perfil!=='ADM')return false;
  try {
    const r=await api('getGestaoUsuarios');
    APP.usuarios=r.dados||{pendentes:[],ativos:[],recusados:[]};
    renderUsuarios();return true;
  } catch(e) {
    $('usuarios-pendentes').innerHTML=`<p class="empty">${esc(e.message)}</p>`;
    return false;
  }
}
function renderUsuarios() {
  const dados=APP.usuarios;
  const pendentes=dados.pendentes||[],ativos=dados.ativos||[],recusados=dados.recusados||[];
  definirBadge('badge-usuarios',pendentes.length);
  $('quantidade-usuarios-pendentes').textContent=String(pendentes.length);
  $('quantidade-usuarios-ativos').textContent=String(ativos.length);
  $('quantidade-usuarios-recusados').textContent=String(recusados.length);
  const meta=u=>`<div class="tm-usuario-meta"><span>Usuário: <strong>${esc(u.usuario)}</strong></span><span>${esc(u.email||'E-mail não informado')}</span>${u.empresa?`<span>Empresa: ${esc(u.empresa)}</span>`:''}</div>`;
  $('usuarios-pendentes').innerHTML=pendentes.length?pendentes.map(u=>`
    <article class="tm-usuario-card">
      <div class="tm-usuario-info"><strong class="tm-usuario-nome">${esc(u.nome)}</strong>${meta(u)}
        <span class="tm-usuario-data">Solicitado em ${esc(fmtDataHora(u.solicitadoEm))}</span></div>
      <div class="tm-usuario-acoes">
        <button class="btn tm-btn-danger" type="button" data-usuario-acao="recusar" data-email="${esc(u.email)}">Recusar</button>
        <button class="btn primary" type="button" data-usuario-acao="aprovar" data-email="${esc(u.email)}">Aprovar</button>
      </div>
    </article>`).join(''):'<p class="empty">Nenhum cadastro aguardando aprovação.</p>';
  $('usuarios-ativos').innerHTML=ativos.length?ativos.map(u=>`
    <article class="tm-usuario-card">
      <div class="tm-usuario-info"><strong class="tm-usuario-nome">${esc(u.nome)}</strong>${meta(u)}</div>
      <div class="tm-usuario-perfil-edicao">
        <span class="tm-usuario-tag">${u.perfil==='ADM'?'Administrador':'Encarregado'}</span>
        <label class="tm-usuario-perfil-label">Alterar perfil
          <select class="tm-usuario-perfil-select" aria-label="Novo perfil de ${esc(u.nome)}" ${u.podeAlterarPerfil===false?'disabled':''}>
            <option value="ENCARREGADO" ${u.perfil==='ENCARREGADO'?'selected':''}>Encarregado</option>
            <option value="ADM" ${u.perfil==='ADM'?'selected':''}>Administrador</option>
          </select>
        </label>
        <button class="btn secondary tm-alterar-perfil" type="button" data-usuario-acao="perfil" data-usuario="${esc(u.usuario)}" ${u.podeAlterarPerfil===false?'disabled title="Não é possível alterar seu próprio perfil"':''}>Salvar perfil</button>
      </div>
    </article>`).join(''):'<p class="empty">Nenhum usuário ativo.</p>';
  $('usuarios-recusados').innerHTML=recusados.length?recusados.map(u=>`
    <article class="tm-usuario-card"><div class="tm-usuario-info"><strong class="tm-usuario-nome">${esc(u.nome)}</strong>${meta(u)}</div>
      <span class="tm-usuario-tag tm-usuario-recusado">Recusado</span></article>`).join(''):
      '<p class="empty">Nenhuma solicitação recusada.</p>';
}
function abrirAlteracaoPerfil(botao) {
  if(APP.sessao?.perfil!=='ADM')return;
  const usuario=botao.dataset.usuario;
  const atual=(APP.usuarios.ativos||[]).find(u=>u.usuario===usuario);
  const seletor=botao.closest('.tm-usuario-card')?.querySelector('.tm-usuario-perfil-select');
  const perfil=seletor?.value;
  if(!atual||!['ADM','ENCARREGADO'].includes(perfil)||atual.podeAlterarPerfil===false)return;
  if(atual.perfil===perfil){feedbackAtualizacao('Esse usuário já possui o perfil selecionado.');return;}
  decisaoUsuario={tipo:'perfil',usuario,perfil};
  $('tm-pergunta-usuario').textContent=`Alterar o perfil de '${atual.nome}' para ${perfil==='ADM'?'Administrador':'Encarregado'}?`;
  const confirmar=$('tm-confirmar-decisao');
  confirmar.textContent='Alterar perfil';
  confirmar.classList.remove('tm-btn-danger');
  confirmar.classList.add('primary');
  $('tm-erro-usuario').hidden=true;
  $('modal-decisao-usuario').showModal();
}
let decisaoUsuario=null;
function abrirDecisaoUsuario(tipo,email) {
  if(APP.sessao?.perfil!=='ADM')return;
  const usuario=(APP.usuarios.pendentes||[]).find(u=>u.email===email);
  if(!usuario||!['aprovar','recusar'].includes(tipo))return;
  decisaoUsuario={tipo,email};
  $('tm-pergunta-usuario').textContent=tipo==='aprovar'
    ?`Aprovar o acesso de '${usuario.nome}'?`
    :`Recusar o cadastro de '${usuario.nome}'?`;
  const confirmar=$('tm-confirmar-decisao');
  confirmar.textContent=tipo==='aprovar'?'Aprovar':'Recusar';
  confirmar.classList.toggle('tm-btn-danger',tipo==='recusar');
  confirmar.classList.toggle('primary',tipo==='aprovar');
  $('tm-erro-usuario').hidden=true;
  $('modal-decisao-usuario').showModal();
}
async function confirmarDecisaoUsuario() {
  if(!decisaoUsuario)return;
  const {tipo,email,usuario,perfil}=decisaoUsuario;
  const botao=$('tm-confirmar-decisao');
  if(botao.disabled)return;
  const label=botao.textContent;
  botao.disabled=true;botao.textContent='Processando…';
  $('tm-cancelar-decisao').disabled=true;
  try {
    const r=tipo==='perfil'
      ?await api('alterarPerfilUsuario',{usuario,perfil})
      :await api(tipo==='aprovar'?'aprovarCadastro':'recusarCadastro',{email});
    $('modal-decisao-usuario').close();decisaoUsuario=null;
    feedbackAtualizacao(r.mensagem+(r.notificacao===false?' Não foi possível enviar a notificação por e-mail.':''));
    if(tipo==='perfil') {
      const conta=(APP.usuarios.ativos||[]).find(u=>u.usuario===usuario);
      if(conta)conta.perfil=perfil;
    } else {
      const lista=APP.usuarios.pendentes||[];
      const conta=lista.find(u=>u.email===email);
      APP.usuarios.pendentes=lista.filter(u=>u.email!==email);
      if(conta){
        if(tipo==='aprovar') {conta.perfil='ENCARREGADO';APP.usuarios.ativos.unshift(conta);}
        else APP.usuarios.recusados.unshift(conta);
      }
    }
    renderUsuarios();
  } catch(e) {
    $('tm-erro-usuario').textContent=e.message||'Não foi possível concluir a solicitação.';
    $('tm-erro-usuario').hidden=false;
  } finally {
    botao.disabled=false;botao.textContent=label;
    $('tm-cancelar-decisao').disabled=false;
  }
}
function configurarGestaoUsuarios() {
  $('btn-atualizar-usuarios').addEventListener('click',()=>comBotaoCarregando(
    $('btn-atualizar-usuarios'),carregarUsuarios,'Atualizando usuários…','Lista de usuários atualizada.'));
  $('usuarios-pendentes').addEventListener('click',event=>{
    const b=event.target.closest('[data-usuario-acao]');
    if(b)abrirDecisaoUsuario(b.dataset.usuarioAcao,b.dataset.email);
  });
  $('usuarios-ativos').addEventListener('click',event=>{
    const botao=event.target.closest('[data-usuario-acao="perfil"]');
    if(botao)abrirAlteracaoPerfil(botao);
  });
  $('tm-cancelar-decisao').addEventListener('click',()=>$('modal-decisao-usuario').close());
  $('tm-confirmar-decisao').addEventListener('click',confirmarDecisaoUsuario);
  $('modal-decisao-usuario').addEventListener('close',()=>{
    decisaoUsuario=null;$('tm-erro-usuario').hidden=true;
  });
}

function extrairHorarioBruto(v) {
  if(v===null || v===undefined) return '';
  if(typeof v==='number' && Number.isFinite(v)) {
    if(Math.abs(v) < 1000) {
      const sinal=v<0?'-':'';
      const total=Math.round(Math.abs(v)*24*60);
      return `${sinal}${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;
    }
    return String(v);
  }
  const valor=String(v).trim().replace('−','-');
  if(!valor) return '';
  // Casos normais: 08:14, +00:11, -12:06, 190:40:00
  let m=valor.match(/^([+-]?)(\d{1,5}):(\d{2})(?::(\d{2}))?$/);
  if(m) {
    const sinal=m[1]==='-'?'-':(m[1]==='+'?'+':'');
    const horas=String(Number(m[2])).padStart(2,'0');
    const minutos=String(Number(m[3])).padStart(2,'0');
    const segundos=Number(m[4]||0);
    let total=Number(horas)*60+Number(minutos)+(segundos>=30?1:0);
    const hh=String(Math.floor(total/60)).padStart(2,'0');
    const mm=String(total%60).padStart(2,'0');
    return `${sinal}${hh}:${mm}`;
  }
  // Quando o Sheets serializa hora como data histórica: Sun Jan 07 1900 01:55:00 GMT-0306 (...)
  m=valor.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))\b/);
  if(m && /(1899|1900)|GMT|Bras/i.test(valor)) {
    let total=Number(m[1])*60+Number(m[2])+(Number(m[3]||0)>=30?1:0);
    return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;
  }
  return valor;
}
function formatarCampoHora(v, fallback='—') {
  const bruto=extrairHorarioBruto(v);
  if(!bruto || ['SEM DADOS','—','-','N/D','NULL'].includes(norm(bruto))) return fallback;
  return bruto;
}
function minutos(s) {
  const valor=extrairHorarioBruto(s);
  // Não transformar falta de informação em saldo zero: isso afetaria decisões de folga.
  if(!valor || ['SEM DADOS','—','-','N/D','NULL'].includes(norm(valor)))return null;
  const match=String(valor).trim().match(/^([+-]?)(\d{1,5}):(\d{2})$/);
  if(match)return (match[1]==='-'?-1:1)*(Number(match[2])*60+Number(match[3]));
  if(/^-?\d+(\.\d+)?$/.test(valor))return Math.round(Number(valor)*60);
  return null;
}
function horas(m) {const sign=m<0?'-':'';const a=Math.abs(m);return sign+String(Math.floor(a/60)).padStart(2,'0')+':'+String(a%60).padStart(2,'0');}
function definirOptions(id,valores,placeholder,manter='') {
  const el=$(id),atual=manter || el.value;
  el.replaceChildren(new Option(placeholder,''));
  [...new Set(valores.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR')).forEach(v=>el.add(new Option(v,v)));
  if([...el.options].some(o=>o.value===atual))el.value=atual;
}
function atualizarEmpresas() {
  const empresas=[...APP.saldos.map(x=>x.empresa),...APP.funcionarios.map(x=>x.empresa)].filter(Boolean);
  definirOptions('filtro-empresa-horas',empresas,'Todas as empresas');
}
async function carregarSaldos() {
  try{
    const r=await api('getSaldoHoras');APP.saldos=r.dados||[];
    atualizarEmpresas();renderSaldos();renderResumoBanco();renderFolgasEncarregado();
    return true;
  }catch(e){$('tbody-horas').innerHTML=`<tr><td colspan="13" class="empty">${esc(e.message)}</td></tr>`;if(APP.sessao?.perfil==='ENCARREGADO')$('enc-lista-folgas').innerHTML=`<p class="empty">${esc(e.message)}</p>`;return false;}
}
// Horas extras do período; NÃO são saldo acumulado disponível para folga.
function extrasDoMes(f) {
  const normal=minutos(f.extrasNormais),fds=minutos(f.extrasFdsFeriado);
  return normal===null||fds===null?null:normal+fds;
}
function renderSaldos() {
  const dados=APP.saldos;
  // Os nomes dos meses acompanham o período efetivamente sincronizado.
  [['horas-mes-0',0],['horas-mes-1',-1],['horas-mes-2',-2]].forEach(([id,offset])=>{if($(id))$(id).textContent=mesDoRelatorio(offset);});
  $('stat-ativos').textContent=dados.length;
  const saldosPositivos=dados.filter(f=>(minutos(f.saldo)??0)>0);
  $('stat-positivos').textContent=saldosPositivos.length;
  $('stat-horas').textContent=horas(saldosPositivos.reduce((a,f)=>a+minutos(f.saldo),0));
  $('stat-atualizacao').textContent=dados[0]?.atualizadoEm ? fmtDataHora(dados[0].atualizadoEm) : 'Não sincronizado';
  const periodo=dados.find(f=>f.periodoBanco)?.periodoBanco||'Ainda não sincronizado';
  $('periodo-saldos').textContent='Período do banco: '+periodo;
  const busca=norm($('filtro-horas').value),empresa=$('filtro-empresa-horas').value,modo=$('filtro-saldo').value;
  const filtrados=dados.filter(f=>{
    const saldo=minutos(f.saldo);
    return (!empresa||f.empresa===empresa)&&(!busca||norm(f.nome).includes(busca))&&
      (modo==='todos'||(modo==='positivo'&&saldo!==null&&saldo>0)||
       (modo==='negativo'&&saldo!==null&&saldo<0)||
       (modo==='zero'&&saldo===0)||(modo==='sem-dados'&&saldo===null));
  }).sort((a,b)=>(minutos(b.saldo)??-9999999)-(minutos(a.saldo)??-9999999)||a.nome.localeCompare(b.nome,'pt-BR'));
  const pill=(valor)=>{
    const m=minutos(valor),classe=m===null?'unknown':m>0?'positive':m<0?'negative':'neutral';
    return `<span class="saldo ${classe}">${m===null?'SEM DADOS':esc(valor)}</span>`;
  };
  $('tbody-horas').innerHTML=filtrados.length?filtrados.map(f=>{
    const extra=extrasDoMes(f);
    const key=encodeURIComponent(JSON.stringify({nome:f.nome,empresa:f.empresa,cpf:f.cpf}));
    return `<tr><td><strong>${esc(f.nome)}</strong></td><td>${esc(f.empresa||'—')}</td>
      <td>${pill(f.saldo)}</td><td>${pill(f.saldoMesAtual)}</td><td>${pill(f.saldoMesAnterior)}</td><td>${pill(f.saldoMes2Anterior)}</td>
      <td class="mono">${esc(formatarCampoHora(f.horasTrabalhadas))}</td><td class="mono">${esc(formatarCampoHora(f.extrasNormais))}</td>
      <td class="mono">${esc(formatarCampoHora(f.extrasFdsFeriado))}</td><td>${pill(extra===null?'SEM DADOS':horas(extra))}</td>
      <td class="mono">${esc(formatarCampoHora(f.atrasosFaltas))}</td><td class="mono">${esc(formatarCampoHora(f.adicionalNoturno))}</td>
      <td><button type="button" class="btn tiny subtle acao-planejar" data-employee="${esc(key)}">Planejar folga</button></td></tr>`;
  }).join(''):'<tr><td colspan="13" class="empty">Nenhum funcionário encontrado. Verifique a sincronização ou os filtros.</td></tr>';
}

function preencherPlanejamento(f) {
  escolherAba('folgas');
  $('folga-funcionario').value=f.nome;
  $('folga-empresa').value=f.empresa||'';
  atualizarEmpresaFolga(f);
  $('folga-data').focus();
}
// V30.17: o botão não espera a sincronização inteira na mesma requisição.
// Cada consulta ao estado dura poucos segundos; uma tarefa demorada não
// estoura o limite de 55 segundos do fetch nem é disparada duas vezes.
let tmSyncMonitor=0;
let tmSyncIdAtivo='';
let tmSyncIniciando=false;
let tmSyncUltimoEstado=null;
const TEXTO_BOTAO_SINCRONIZAR='Sincronizar MobPonto';
const SYNC_POLL_MS=6000;
// Mesma animação da logo usada em comBotaoCarregando. O markup só é recriado
// quando o texto muda, para a logo não reiniciar a cada consulta de progresso.
function animarBotaoSincronizacao(botao,texto) {
  const carregando=Boolean(texto);
  if(carregando) {
    if(botao.dataset.tmSyncTexto===texto)return;
    botao.dataset.tmSyncTexto=texto;
    botao.classList.add('tm-carregando');
    botao.setAttribute('aria-busy','true');botao.setAttribute('aria-label',texto);
    botao.innerHTML=`<span class="tm-carregando-texto">${esc(texto)}</span><span class="tm-logo-pista" aria-hidden="true"><span class="tm-logo-viagem"><img src="logotrm.png" alt="" onerror="this.parentElement.classList.add('tm-logo-indisponivel')"></span></span>`;
  } else if(botao.dataset.tmSyncTexto!==undefined||botao.textContent!==TEXTO_BOTAO_SINCRONIZAR) {
    delete botao.dataset.tmSyncTexto;
    botao.classList.remove('tm-carregando');
    botao.removeAttribute('aria-busy');botao.removeAttribute('aria-label');
    botao.textContent=TEXTO_BOTAO_SINCRONIZAR;
  }
}
function atualizarVisualSincronizacao(estado) {
  if(APP.sessao?.perfil!=='ADM')return;
  tmSyncUltimoEstado=estado;
  const botao=$('btn-sincronizar'),area=$('tm-estado-sincronizacao');
  if(!botao||!area)return;
  const ativo=['AGENDADA','EXECUTANDO'].includes(estado?.estado);
  botao.disabled=ativo||tmSyncIniciando;
  animarBotaoSincronizacao(botao,tmSyncIniciando?'Solicitando…':ativo?'Sincronização em andamento…':'');
  if(!estado||estado.estado==='NAO_INICIADA'){area.hidden=!tmSyncIniciando; if(tmSyncIniciando){area.textContent='Solicitando sincronização ao Apps Script…';area.className='tm-estado-sincronizacao tm-sync-ativo';}return;}
  area.hidden=false;
  const p=estado.progresso||{};
  if(ativo){
    const conteudo=p.total>0?` — ${p.feitos||0}/${p.total} consultas`:' ';
    area.textContent=`${estado.estado==='AGENDADA'?'Aguardando início no Apps Script':(p.etapa||'Processando')} ${conteudo}. Pode atualizar a página: o processo continuará sem duplicar.`;
    area.className='tm-estado-sincronizacao tm-sync-ativo';
  }else if(estado.estado==='CONCLUIDA'){
    area.textContent=`Concluída em ${estado.atualizadoEm||''}. Os saldos foram atualizados.`;
    area.className='tm-estado-sincronizacao tm-sync-ok';
  }else{
    area.textContent=estado.estado==='FALHOU'?'Falha: '+(estado.erro||'Confira as mensagens do Apps Script.'):'Nenhuma sincronização em andamento.';
    area.className='tm-estado-sincronizacao tm-sync-falha';
  }
}
async function acompanharSincronizacao(estado,mostraConclusao=false) {
  const monitor=++tmSyncMonitor;
  tmSyncIdAtivo=estado.id;
  const usuario=APP.sessao?.usuario,token=APP.sessao?.token;
  atualizarVisualSincronizacao(estado);
  let espera=2500; // primeira consulta rápida; depois, ritmo normal
  while(['AGENDADA','EXECUTANDO'].includes(estado.estado)&&monitor===tmSyncMonitor){
    await new Promise(resolve=>setTimeout(resolve,espera));
    espera=SYNC_POLL_MS;
    if(!APP.sessao||APP.sessao.usuario!==usuario||APP.sessao.token!==token)return;
    try {
      estado=await api('estadoSincronizacaoMob',{id:tmSyncIdAtivo});
      atualizarVisualSincronizacao(estado);
    }catch(e){
      const area=$('tm-estado-sincronizacao');
      if(area){area.hidden=false;area.className='tm-estado-sincronizacao tm-sync-ativo';area.textContent='Sem resposta momentânea do servidor. O processo não será reiniciado; tentando reconectar…';}
      continue;
    }
  }
  if(monitor!==tmSyncMonitor)return;
  tmSyncIdAtivo='';
  if(estado.estado==='CONCLUIDA') {
    const [carregado]=await Promise.all([carregarSaldos(),carregarFuncionarios()]);
    if(mostraConclusao)feedbackAtualizacao(carregado===false?'Sincronização terminou. Recarregue o painel para atualizar a visualização.':'Sincronização concluída e saldos atualizados.',carregado===false);
  } else if(estado.estado==='FALHOU'){
    showMessage(estado.erro||'A sincronização não foi concluída. Dados anteriores preservados.','Falha na sincronização',true);
  }
}
async function retomarSincronizacao() {
  if(APP.sessao?.perfil!=='ADM')return;
  try {
    const estado=await api('estadoSincronizacaoMob');
    atualizarVisualSincronizacao(estado);
    if(['AGENDADA','EXECUTANDO'].includes(estado.estado))acompanharSincronizacao(estado,true);
  }catch(e){
    const area=$('tm-estado-sincronizacao');
    if(area){area.hidden=false;area.textContent='Não foi possível consultar o andamento. Tente atualizar o painel.';}
  }
}
async function sincronizar() {
  if(APP.sessao?.perfil!=='ADM'||tmSyncIniciando||tmSyncIdAtivo)return false;
  tmSyncIniciando=true;atualizarVisualSincronizacao(null);
  try {
    const estado=await api('iniciarSincronizacaoMob');
    if(!estado.id)throw Error('O Apps Script não confirmou o agendamento.');
    atualizarVisualSincronizacao(estado);
    if(['AGENDADA','EXECUTANDO'].includes(estado.estado))acompanharSincronizacao(estado,true);
    else if(estado.estado==='CONCLUIDA'){await Promise.all([carregarSaldos(),carregarFuncionarios()]);}
    else if(estado.estado==='FALHOU')throw Error(estado.erro||'Falha na sincronização.');
    feedbackAtualizacao(estado.jaEmAndamento?'Retomando a sincronização já iniciada.':'Sincronização agendada. Você pode usar outras abas ou atualizar a página.');
    return true;
  }catch(e){showMessage(e.message,'Não foi possível sincronizar',true);return false;}
  finally{tmSyncIniciando=false;atualizarVisualSincronizacao(tmSyncUltimoEstado);}
}
// V26 — folgas no mesmo padrão visual das cartas, com empresa vinda da base.
// Combina nome + empresa para não confundir homônimos das duas empresas.
function funcionariosParaFolga() {
  const unicos=new Map();
  for(const f of [...APP.funcionarios,...APP.saldos]) {
    if(!f?.nome||!f?.empresa)continue;
    const chave=norm(f.nome)+'|'+norm(f.empresa);
    // Prioriza dados da aba FUNCIONARIOS; complementa CPF quando necessário.
    if(!unicos.has(chave))unicos.set(chave,{nome:f.nome,empresa:f.empresa,cpf:f.cpf||''});
    else if(!unicos.get(chave).cpf&&f.cpf)unicos.get(chave).cpf=f.cpf;
  }
  return [...unicos.values()].sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR')||a.empresa.localeCompare(b.empresa,'pt-BR'));
}
function atualizarEmpresaFolga(escolhido=null) {
  const campo=$('folga-funcionario'),empresa=$('folga-empresa'),info=$('folga-empresa-info');
  const encontrados=funcionariosParaFolga().filter(f=>norm(f.nome)===norm(campo.value));
  const atual=escolhido&&encontrados.find(f=>f.empresa===escolhido.empresa);
  const selecionado=atual||(encontrados.length===1?encontrados[0]:encontrados.find(f=>f.empresa===empresa.value));
  empresa.value=selecionado?.empresa||'';
  info.textContent=selecionado?'Empresa identificada: '+selecionado.empresa:
    encontrados.length>1?'Há mais de uma empresa para esse nome. Selecione o colaborador na lista.':
    'Selecione um colaborador cadastrado para identificar a empresa.';
  info.classList.toggle('carta-empresa-aviso',!selecionado);
  return !!selecionado;
}
function configurarSugestaoFolga() {
  const campo=$('folga-funcionario'),lista=$('folga-sugestoes-funcionario');
  let opcoes=[],indice=0;
  function fechar(){lista.hidden=true;lista.replaceChildren();opcoes=[];campo.setAttribute('aria-expanded','false');campo.removeAttribute('aria-activedescendant');}
  function marcar(){
    [...lista.children].forEach((item,i)=>{item.classList.toggle('ativa',i===indice);item.setAttribute('aria-selected',String(i===indice));});
    if(opcoes.length)campo.setAttribute('aria-activedescendant','folga-sugestao-'+indice);
    lista.children[indice]?.scrollIntoView({block:'nearest'});
  }
  function selecionar(i){
    const f=opcoes[i];if(!f)return;
    campo.value=f.nome;$('folga-empresa').value=f.empresa;
    atualizarEmpresaFolga(f);fechar();campo.focus({preventScroll:true});
  }
  function atualizar(){
    const busca=norm(campo.value);
    if(!busca){fechar();return;}
    const todos=funcionariosParaFolga();
    const exatos=todos.filter(f=>norm(f.nome)===busca);
    // Mostrar os homônimos mesmo quando o nome completo já foi digitado.
    opcoes=todos.filter(f=>(norm(f.nome).includes(busca)||norm(f.empresa+' '+f.nome).includes(busca))&&
      (norm(f.nome)!==busca||exatos.length>1))
      .sort((a,b)=>(norm(a.nome).startsWith(busca)?0:1)-(norm(b.nome).startsWith(busca)?0:1)||a.nome.localeCompare(b.nome,'pt-BR'))
      .slice(0,8);
    if(!opcoes.length){fechar();return;}
    indice=0;
    lista.innerHTML=opcoes.map((f,i)=>`<div class="carta-sugestao-item" id="folga-sugestao-${i}" role="option" data-index="${i}" aria-selected="${i===0}"><strong style="display:inline-block;margin-right:12px;vertical-align:middle;">${esc(f.nome)}</strong><small style="display:inline-block;vertical-align:middle;color:#5f6f86;font-weight:600;letter-spacing:.01em;">${esc(f.empresa)}</small></div>`).join('');
    lista.hidden=false;campo.setAttribute('aria-expanded','true');marcar();
  }
  campo.addEventListener('input',()=>{$('folga-empresa').value='';atualizarEmpresaFolga();atualizar();});
  campo.addEventListener('focus',atualizar);
  campo.addEventListener('change',atualizarEmpresaFolga);
  campo.addEventListener('keydown',e=>{
    if(e.isComposing||e.key==='Process')return;
    if(e.key==='Escape'&&!lista.hidden){e.preventDefault();e.stopPropagation();fechar();return;}
    if((e.key==='ArrowDown'||e.key==='ArrowUp')&&!lista.hidden){
      e.preventDefault();e.stopPropagation();indice=(indice+(e.key==='ArrowDown'?1:-1)+opcoes.length)%opcoes.length;marcar();return;
    }
    if(e.key==='Enter'&&!lista.hidden&&opcoes.length){e.preventDefault();e.stopPropagation();selecionar(indice);}
  });
  lista.addEventListener('pointerdown',e=>{const item=e.target.closest('.carta-sugestao-item');if(item){e.preventDefault();selecionar(Number(item.dataset.index));}});
  campo.addEventListener('blur',()=>setTimeout(()=>{if(document.activeElement!==campo)fechar();},0));
}

async function carregarFuncionarios() {
  try{
    const r=await api('getFuncionarios');APP.funcionarios=r.dados||[];
    $('lista-funcionarios').innerHTML=APP.funcionarios.map(x=>`<option value="${esc(x.nome)}" label="${esc(x.empresa)}"></option>`).join('');
    atualizarEmpresas();atualizarEmpresaCarta();
    if(APP.cartas.length){
      reconstruirHistoricoResponsaveisCarta();
      if(APP.subaba==='relatorios')renderRelatorios();
      if(APP.subaba==='capa')renderCapa();
    }
  }catch(e){console.warn(e.message);}
}
function encontrarFuncionario(nome,empresa) {
  return APP.funcionarios.find(f=>norm(f.nome)===norm(nome)&&(!empresa||f.empresa===empresa))||APP.saldos.find(f=>norm(f.nome)===norm(nome)&&(!empresa||f.empresa===empresa));
}
async function salvarFolga(e) {
  e.preventDefault();
  try{
    const nome=$('folga-funcionario').value.trim(),empresa=$('folga-empresa').value;
    const funcionario=funcionariosParaFolga().find(f=>norm(f.nome)===norm(nome)&&f.empresa===empresa);
    if(!funcionario){atualizarEmpresaFolga();throw Error('Selecione um funcionário da lista para identificar a empresa.');}
    if(!normalizarAnoDaData($('folga-data')))throw Error('Confira a data da folga.');
    const dados={funcionario:funcionario.nome,empresa:funcionario.empresa,cpf:funcionario.cpf||'',
      dataFolga:dataParaISO($('folga-data').value),horasPlanejadas:$('folga-horas').value.trim(),
      observacoes:$('folga-obs').value.trim()};
    const r=await api('salvarFolga',{dados});
    if(!r.folga)throw Error('A gravação não foi confirmada com os dados da folga. Atualize a lista para verificar.');
    APP.folgas.unshift(r.folga);renderFolgas();
    $('form-folga').reset();prepararCamposFormularioFolga();atualizarEmpresaFolga();
    feedbackAtualizacao('Folga salva no Google Sheets.');return true;
  }catch(err){showMessage(err.message,'Não foi possível registrar',true);return false;}
}
async function carregarFolgas() {
  try{APP.folgas=(await api('getFolgas')).dados||[];renderFolgas();}
  catch(e){$('tbody-folgas').innerHTML=`<tr><td colspan="7" class="empty">${esc(e.message)}</td></tr>`;}
}
// V30.18 — A data do Histórico de decisões sempre vem em DD/MM/AA.
// O campo 'Data Folga' da planilha é devolvido como ISO pelo Apps Script,
// mas também aceitamos formatos antigos em inglês sem exibi-los na tabela.
function formatarDataHistoricoFolga(valor) {
  const iso=dataParaISO(valor);
  if(!iso)return '—';
  return `${iso.slice(8,10)}/${iso.slice(5,7)}/${iso.slice(2,4)}`;
}
// V30.19 — "Horas previstas" não é uma data. Trata HH:MM e legados do Sheets
// que chegam indevidamente como texto "Sat Dec 30 1899 08:48:00 GMT-0306".
function formatarHorasHistoricoFolga(valor) {
  const texto=String(valor??'').trim();
  if(!texto)return '—';
  let m=texto.match(/^(\d{1,3}):([0-5]\d)(?::[0-5]\d)?$/);
  if(m)return `${String(Number(m[1])).padStart(2,'0')}:${m[2]}`;
  m=texto.match(/\b(?:1899|1900)\s+(\d{1,2}):([0-5]\d):[0-5]\d\b/i);
  if(m)return `${m[1].padStart(2,'0')}:${m[2]}`;
  // Valor bruto numérico de hora do Google Sheets (fração de um dia).
  if(/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(texto)){
    const minutos=Math.round(Number(texto)*24*60);
    return `${String(Math.floor(minutos/60)).padStart(2,'0')}:${String(minutos%60).padStart(2,'0')}`;
  }
  console.warn('Horas de folga não reconhecidas:',texto);
  return '—';
}
function renderFolgas() {
  const status=$('filtro-folga-status').value;
  const items=APP.folgas.filter(f=>!status||f.status===status);
  $('tbody-folgas').innerHTML=items.length?items.map(f=>{
    const op=f.status==='PLANEJADA' ? (APP.sessao?.perfil==='ADM'?`<button type="button" class="btn tiny primary folga-status" data-id="${esc(f.id)}" data-status="CONCEDIDA">Concedida</button><button type="button" class="btn tiny subtle folga-status" data-id="${esc(f.id)}" data-status="CANCELADA">Recusar</button>`:'<span class="tm-folga-aguarda">Aguardando aprovação do ADM</span>') : '<span class="tm-folga-concluida">—</span>';
    const observacao=String(f.observacoes||'').trim();
    return `<tr class="tm-folga-linha">
      <td class="tm-folga-pessoa"><strong>${esc(f.funcionario)}</strong><small class="block">${esc(f.empresa||'—')}</small></td>
      <td><span class="tm-folga-destaque tm-folga-data mono">${esc(formatarDataHistoricoFolga(f.dataFolga))}</span></td>
      <td><span class="tm-folga-destaque tm-folga-horas mono">${esc(formatarHorasHistoricoFolga(f.horasPlanejadas))}</span></td>
      <td><span class="status ${esc(String(f.status||'').toLowerCase())}">${esc(f.status)}</span></td>
      <td><span class="tm-folga-destaque tm-folga-responsavel">${esc(f.responsavel||'—')}</span></td>
      <td><div class="tm-folga-observacao${observacao?'':' tm-folga-sem-observacao'}">${observacao?esc(observacao):'—'}</div></td>
      <td class="tm-folga-acoes"><div class="cell-actions tm-folga-botoes">${op}</div></td>
    </tr>`;
  }).join(''):'<tr><td colspan="7" class="empty">Nenhuma folga registrada neste filtro.</td></tr>';
}
async function mudarStatusFolga(id,status) {
  if(APP.sessao?.perfil!=='ADM'){showMessage('Somente o administrador pode aceitar ou recusar folgas.','Acesso restrito',true);return false;}
  try{
    const r=await api('alterarFolga',{idFolga:id,status});
    if(r.status!==status)throw Error('O status não foi confirmado pelo servidor. Atualize a lista.');
    const folga=APP.folgas.find(f=>f.id===id);
    if(folga)folga.status=r.status;
    renderFolgas();feedbackAtualizacao('Status atualizado para '+status+'.');return true;
  }catch(e){showMessage(e.message,'Falha ao atualizar',true);return false;}
}

// Ordem original do cadastro, inclusive em caso de falha e reenvio posterior.
function dataOrdemCarta(carta) {
  const valor=String(carta?.ordemLancamento||carta?.criadoEm||carta?.dados?.ordemCriacao||'');
  // Texto do servidor = horário de Brasília; fila do navegador = ISO UTC.
  if(!valor)return 0;
  const instante=/^\d{4}-\d{2}-\d{2}T/.test(valor)?Date.parse(valor):
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(valor)?
      Date.parse(valor.replace(' ','T')+'-03:00'):Date.parse(valor);
  return Number.isFinite(instante)?instante:0;
}
function ordenarCartasPorLancamento(cartas) {
  return cartas.sort((a,b)=>dataOrdemCarta(b)-dataOrdemCarta(a));
}
async function carregarCartas() {
  if(APP.sessao?.perfil!=='ADM')return false;
  try{
    APP.cartas=ordenarCartasPorLancamento((await api('getDadosADM')).dados||[]);
    renderCartas();
    if(APP.subaba==='capa')renderCapa();
    if(APP.subaba==='relatorios')renderRelatorios();
    atualizarResponsaveis();
    // Dados frescos do servidor devem prevalecer sobre o cache da lista.
    APP.pendentes=[];
    atualizarPendentesAdmLocal();
    return true;
  }catch(e){$('tbody-cartas').innerHTML=`<tr><td colspan="7" class="empty">${esc(e.message)}</td></tr>`;return false;}
}
function atualizarPendentesAdmLocal() {
  if(APP.sessao?.perfil!=='ADM')return;
  const anteriores=new Map(APP.pendentes.map(c=>[c.id,c]));
  APP.pendentes=APP.cartas.filter(c=>c.status!=='SIM').map(c=>{
    const antigo=anteriores.get(c.id);
    return {...c,controleEncarregado:antigo?.controleEncarregado||c.controleEncarregado,
      assinaturaMarcadaPor:antigo?.assinaturaMarcadaPor||c.assinaturaMarcadaPor||''};
  });
  definirBadge('badge-pendentes',APP.pendentes.length);
  renderPendentes();
}
// V31.11 — sugestões fundamentadas em ASSINADA no controle do encarregado.
// Inclui cartas normais e (FALTA) pela mesma identidade do funcionário.
let historicoResponsaveisCarta=new Map();
const estadoSugestaoCarta={colaborador:'',automatico:'',editadoManualmente:false};
function chaveAprendizadoCarta(nome,empresa='') {
  const base=norm(separarNomeCarta(nome).nomeBase).replace(/\s+/g,' ');
  const emp=norm(empresa);
  if(emp&&base)return 'OFICIAL|'+base+'|'+emp;
  return chaveFuncionarioCarta(nome);
}
function construirHistoricoResponsaveisCarta(assinaturas) {
  const eventosPorFuncionario=new Map();
  const adicionar=(chave,assinatura,i)=>{
    if(!chave)return;
    if(!eventosPorFuncionario.has(chave))eventosPorFuncionario.set(chave,[]);
    eventosPorFuncionario.get(chave).push({
      nome:String(assinatura.marcadoPor||'').trim(),
      quando:String(assinatura.quando||''),ordem:i
    });
  };
  (assinaturas||[]).forEach((a,i)=>{
    const responsavel=String(a.marcadoPor||'').trim();
    if(!responsavel||!a.funcionario)return;
    const chave=chaveAprendizadoCarta(a.funcionario,a.empresa);
    adicionar(chave,a,i);
    // Compatibilidade com cartas históricas sem empresa: a associação livre
    // só será usada quando não houver homônimos de empresas diferentes.
    if(!a.empresa){
      const livre='LIVRE|'+norm(separarNomeCarta(a.funcionario).nomeBase).replace(/\s+/g,' ');
      if(livre!==chave)adicionar(livre,a,i);
    }
  });
  const padroes=new Map();
  for(const [funcionario,eventos] of eventosPorFuncionario) {
    const recentes=eventos.sort((a,b)=>b.quando.localeCompare(a.quando)||b.ordem-a.ordem).slice(0,12);
    // O último encarregado que marcou ASSINADA tem prioridade sobre a frequência.
    const ultimo=recentes[0];
    padroes.set(funcionario,{total:recentes.length,ultimo,confiavel:!!ultimo});
  }
  return padroes;
}
function sugestaoResponsavelAprendida(nome,empresa='') {
  const especifica=historicoResponsaveisCarta.get(chaveAprendizadoCarta(nome,empresa));
  if(especifica)return especifica;
  const base=norm(separarNomeCarta(nome).nomeBase).replace(/\s+/g,' ');
  if(!base)return null;
  // Sem empresa no evento antigo: só inferir se houver um vínculo identificável
  // de maneira única. Nomes iguais em empresas diferentes não são unidos.
  const empresas=new Set([...APP.funcionarios,...APP.saldos,...APP.cartas].filter(x=>
    norm(separarNomeCarta(x.nome||x.funcionario||'').nomeBase).replace(/\s+/g,' ')===base&&x.empresa
  ).map(x=>norm(x.empresa)));
  if(empresas.size>1||(empresas.size===1&&empresa&&!empresas.has(norm(empresa))))return null;
  return historicoResponsaveisCarta.get('LIVRE|'+base)||null;
}
function reconstruirHistoricoResponsaveisCarta() {
  historicoResponsaveisCarta=construirHistoricoResponsaveisCarta(APP.assinaturasResponsaveis);
  aplicarAprendizadoResponsavelCarta();
}
async function carregarAssinaturasResponsaveis() {
  if(APP.sessao?.perfil!=='ADM')return false;
  try {
    const resposta=await api('getAssinaturasResponsaveisADM');
    APP.assinaturasResponsaveis=Array.isArray(resposta.dados)?resposta.dados:[];
    reconstruirHistoricoResponsaveisCarta();
    return true;
  }catch(err){
    console.warn('Sugestões de responsáveis indisponíveis:',err.message);
    return false; // A falha de sugestões não pode impedir o cadastro de cartas.
  }
}
function aplicarAprendizadoResponsavelCarta() {
  const funcionario=$('carta-funcionario'),responsavel=$('carta-responsavel');
  const aviso=$('carta-responsavel-aprendizado');
  if(!funcionario||!responsavel||!aviso)return;
  const ident=identificarFuncionarioCarta(funcionario.value);
  const nome=ident.nome?chaveAprendizadoCarta(ident.nome,ident.empresa):'';
  if(nome!==estadoSugestaoCarta.colaborador) {
    if(!estadoSugestaoCarta.editadoManualmente&&estadoSugestaoCarta.automatico&&
       responsavel.value===estadoSugestaoCarta.automatico)responsavel.value='';
    estadoSugestaoCarta.colaborador=nome;
    estadoSugestaoCarta.automatico='';
  }
  if(APP.cartaEditando||!nome) {aviso.hidden=true;aviso.textContent='';return;}
  const padrao=sugestaoResponsavelAprendida(ident.nome,ident.empresa);
  aviso.hidden=false;aviso.classList.remove('carta-aprendizado-confiavel');
  if(!padrao){aviso.textContent='Sem confirmação anterior de assinatura pelo encarregado para sugerir um responsável.';return;}
  const ultimo=padrao.ultimo;
  if(!estadoSugestaoCarta.editadoManualmente&&!responsavel.value.trim()) {
    responsavel.value=ultimo.nome;estadoSugestaoCarta.automatico=ultimo.nome;
  }
  aviso.classList.add('carta-aprendizado-confiavel');
  aviso.textContent=`Última assinatura recebida por: ${ultimo.nome}. Pode alterar o responsável manualmente.`;
}

function atualizarResponsaveis() {
  const lista=[...new Set([...APP.cartas.map(x=>x.responsavel),
    ...APP.assinaturasResponsaveis.map(x=>x.marcadoPor)].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  $('lista-responsaveis').innerHTML=lista.map(s=>`<option value="${esc(s)}"></option>`).join('');
  reconstruirHistoricoResponsaveisCarta();
}
function filtroDeCartas({texto='',status='',mes=''}={}) {
  const busca=norm(texto);
  return APP.cartas.filter(c=>(!status||c.status===status)&&(!mes||c.dataOcorrencia.slice(0,7)===mes)&&
      (!busca||norm(c.funcionario+' '+c.responsavel+' '+c.motivo+' '+c.adicional+' '+c.observacoes).includes(busca)));
}
function textoComplementarCarta(c) {
  const adicional=(c.adicional||'').trim(), obs=(c.observacoes||'').trim();
  return obs&&adicional&&norm(obs)!==norm(adicional)?`${adicional} | ${obs}`:obs||adicional;
}
// O botão de atribuição só aparece se a última ação do encarregado foi
// ASSINADA. O servidor valida novamente o evento antes de alterar a planilha.
function nomeEncarregadoAssinatura(carta) {
  if(carta.status==='SIM'||carta.controleEncarregado!=='ASSINADA')return '';
  const nome=String(carta.assinaturaMarcadaPor||'').trim();
  return nome&&norm(nome)!==norm(carta.responsavel)?nome:'';
}
function botoesConfirmacaoCarta(carta,curto=false) {
  const nome=nomeEncarregadoAssinatura(carta);
  const id=esc(carta.id);
  const rotulo=curto?'Confirmar':'Confirmar assinatura';
  return `<button type="button" class="btn ${curto?'tiny subtle':'primary'} carta-assinar" data-id="${id}">${rotulo}</button>`+
    (nome?`<button type="button" class="btn ${curto?'tiny':'secondary'} carta-assinar-atribuir" data-id="${id}" title="Confirmar assinatura e trocar o responsável para ${esc(nome)}">Confirmar + ${esc(nome)}</button>`:'');
}
function renderCartas() {
  $('cartas-total').textContent=APP.cartas.length;
  $('cartas-pendentes').textContent=APP.cartas.filter(c=>c.status!=='SIM').length;
  $('cartas-assinadas').textContent=APP.cartas.filter(c=>c.status==='SIM').length;
  const lista=filtroDeCartas({texto:$('filtro-cartas').value,status:$('filtro-cartas-status').value,mes:$('filtro-cartas-mes').value});
  const salvas=lista.map(c=>({ordem:dataOrdemCarta(c),conteudo:`<tr><td class="mono">${fmtData(c.dataOcorrencia)}</td><td><strong>${esc(c.funcionario)}</strong></td><td>${esc(c.responsavel||'—')}</td><td class="mono">${fmtData(c.dataCorrecao)}</td><td><span class="status ${c.status==='SIM'?'concedida':'planejada'}">${esc(c.status)}</span></td><td>${esc(textoComplementarCarta(c)||'—')}</td><td><div class="cell-actions carta-acoes">${c.status!=='SIM'?botoesConfirmacaoCarta(c,true):''}<button class="btn tiny secondary carta-editar" data-id="${esc(c.id)}" type="button">Editar</button><button class="btn tiny carta-excluir" data-id="${esc(c.id)}" type="button" aria-label="Excluir carta de ${esc(c.funcionario)}">Excluir</button></div></td></tr>`}));
  const locais=cartasEmEnvioVisiveis().map(item=>({ordem:dataOrdemCarta(item),conteudo:linhaCartaEmEnvio(item)}));
  const linhas=[...salvas,...locais].sort((a,b)=>b.ordem-a.ordem);
  $('tbody-cartas').innerHTML=linhas.length?linhas.slice(0,200).map(x=>x.conteudo).join(''):
    '<tr><td colspan="7" class="empty">Nenhuma carta encontrada.</td></tr>';
  if(linhas.length>200)$('tbody-cartas').innerHTML+=`<tr><td colspan="7" class="empty">Exibindo 200 de ${linhas.length} cartas. Use os filtros para localizar outros registros.</td></tr>`;
}
function identificarFuncionarioCarta(nome) {
  const {falta,nomeBase}=separarNomeCarta(nome);
  const nomeLimpo=nomeBase.replace(/\s+/g,' ').trim();
  if(!nomeLimpo)return {erro:'Informe o nome do funcionário após (FALTA).'};
  // Uma escolha explícita do menu vence ambiguidade de nomes entre empresas.
  if(funcionarioCartaSelecionado&&norm(funcionarioCartaSelecionado.nome)===norm(nomeLimpo)) {
    const escolhido=funcionarioCartaSelecionado;
    return {nome:formatarNomeCarta(escolhido.nome,falta),empresa:escolhido.empresa,
      nomeOficial:escolhido.nome};
  }
  const localizado=localizarNomeCartaNaBase(nomeLimpo);
  if(localizado.ambiguo) return {erro:'Esse nome abreviado corresponde a mais de um funcionário. Digite mais partes do nome.'};
  if(!localizado.registro) {
    // Colaboradores antigos/avulsos continuam permitidos, sem inventar empresa.
    return {nome:formatarNomeCarta(nomeLimpo,falta),empresa:'',naoCadastrado:true};
  }
  return {nome:formatarNomeCarta(localizado.registro.nome,falta),empresa:localizado.registro.empresa,
    nomeOficial:localizado.registro.nome};
}
function atualizarEmpresaCarta() {
  const nome=$('carta-funcionario').value.trim(),ident=identificarFuncionarioCarta(nome);
  const legado=APP.cartaEditando&&APP.cartas.find(c=>c.id===APP.cartaEditando);
  const podePreservar=legado&&norm(legado.funcionario)===norm(nome);
  const empresa=ident.empresa||(podePreservar?legado.empresa:'');
  const p=$('carta-empresa-info');
  p.textContent=empresa?'Empresa identificada automaticamente: '+empresa:(podePreservar?'Carta histórica sem empresa informada. É possível editar mantendo a informação original.':(ident.naoCadastrado?'Nome não encontrado na base: é permitido salvar a carta sem empresa identificada.':(nome?ident.erro:'Digite o nome do funcionário. As sugestões são opcionais.')));
  p.classList.toggle('carta-empresa-aviso',!empresa&&!!nome);
  aplicarAprendizadoResponsavelCarta();
  return empresa;
}
function definirModoCarta(c=null) {
  funcionarioCartaSelecionado=null;
  fecharSugestoesCarta.forEach(fechar=>fechar());
  APP.cartaEditando=c?.id||null;
  estadoSugestaoCarta.colaborador='';
  estadoSugestaoCarta.automatico='';
  estadoSugestaoCarta.editadoManualmente=false;
  $('titulo-form-carta').textContent=c?'Editar carta de ponto':'Registrar nova carta';
  $('btn-salvar-carta').textContent=c?'Salvar alterações':'Salvar carta';
  $('btn-cancelar-edicao-carta').hidden=!c;
  $('form-carta').reset();
  $('carta-funcionario').value=c?.funcionario||'';
  $('carta-ocorrencia').value=dataISOParaCampo(c?.dataOcorrencia||ontem());
  $('carta-correcao').value=dataISOParaCampo(c?c.dataCorrecao||'':today());
  $('carta-responsavel').value=c?.responsavel||'';
  $('carta-assinado').value=c?.status||'NÃO';
  $('carta-obs').value=c?textoComplementarCarta(c):'';
  atualizarEmpresaCarta();
  if(c){$('form-carta').scrollIntoView({behavior:'smooth',block:'center'});$('carta-funcionario').focus({preventScroll:true});}
}
function reexibirCartasLocais() {
  renderCartas();if(APP.subaba==='capa')renderCapa();if(APP.subaba==='relatorios')renderRelatorios();atualizarResponsaveis();
  atualizarPendentesAdmLocal();
}
// V30.2 — registro imediato no navegador; a confirmação vem somente do servidor.
// Persistir a fila permite recuperar envios interrompidos sem duplicar cartas.
const CHAVE_FILA_CARTAS='transmarina_cartas_envio_v30_2';
let filaCartas=[];
let envioCartasAtivo=false;
let tmEnvioCartasTimer=null;
function prepararFilaCartas() {
  try {
    const salvas=JSON.parse(localStorage.getItem(CHAVE_FILA_CARTAS)||'[]');
    filaCartas=Array.isArray(salvas)?salvas.filter(x=>x&&/^CP-[0-9A-F]{32}$/.test(x.id)&&
      typeof x.usuario==='string'&&x.dados&&typeof x.dados==='object').slice(0,80).map(x=>({
        ...x,estado:x.estado==='erro'?'erro':'pendente'})):[];
  } catch(_){filaCartas=[];}
}
function salvarFilaCartas() {
  localStorage.setItem(CHAVE_FILA_CARTAS,JSON.stringify(filaCartas));
}
function filaCartasDaConta() {return filaCartas.filter(x=>x.usuario===APP.sessao?.usuario);}
function criarIdentificadorCarta() {
  // GitHub Pages usa HTTPS; gera 122 bits aleatórios sem reutilizar o CPF.
  if(!crypto?.randomUUID)throw Error('O navegador não permite gerar um identificador seguro para a carta.');
  return 'CP-'+crypto.randomUUID().replace(/-/g,'').toUpperCase();
}
function renderFilaCartas() {
  const area=$('tm-fila-cartas');if(!area)return;
  const items=filaCartasDaConta();area.hidden=!items.length;
  if(!items.length){area.innerHTML='';return;}
  const ocupadas=items.filter(x=>x.estado!=='erro');
  const erros=items.filter(x=>x.estado==='erro');
  area.innerHTML=`<div class="tm-fila-resumo">${ocupadas.length?'<span class="tm-spinner" aria-hidden="true"></span>':''}<span>${ocupadas.length?`${ocupadas.length} carta(s) aguardando confirmação no Google Sheets`:'Nenhum envio em andamento'}${erros.length?` · ${erros.length} com falha`:''}</span></div>`+
    erros.map(x=>`<div class="tm-fila-erro"><div><strong>Não salva: ${esc(x.dados.funcionario)}</strong><small>${esc(x.erro||'Confira a conexão e tente novamente.')}</small></div><button type="button" class="btn tiny secondary tm-repetir-carta" data-id="${esc(x.id)}">Tentar novamente</button></div>`).join('');
}
function cartasEmEnvioVisiveis() {
  const texto=norm($('filtro-cartas').value),status=$('filtro-cartas-status').value,mes=$('filtro-cartas-mes').value;
  return filaCartasDaConta().filter(x=>{
    const d=x.dados||{};
    return (!status||d.assinado===status)&&(!mes||String(d.dataOcorrencia||'').slice(0,7)===mes)&&
      (!texto||norm([d.funcionario,d.responsavel,d.observacoes].join(' ')).includes(texto));
  });
}
function linhaCartaEmEnvio(item) {
  const d=item.dados,erro=item.estado==='erro';
  return `<tr class="tm-carta-linha-pendente ${erro?'tm-carta-com-erro':''}"><td class="mono">${fmtData(d.dataOcorrencia)}</td><td><strong>${esc(d.funcionario)}</strong></td><td>${esc(d.responsavel||'—')}</td><td class="mono">${fmtData(d.dataCorrecao)}</td><td><span class="tm-situacao-envio">${erro?'Falha ao salvar':'Enviando…'}</span></td><td>${esc(d.observacoes||'—')}</td><td>${erro?`<button type="button" class="btn tiny secondary tm-repetir-carta" data-id="${esc(item.id)}">Reenviar</button>`:'Aguardando confirmação'}</td></tr>`;
}
function agendarEnvioCartas() {
  if(tmEnvioCartasTimer||envioCartasAtivo)return;
  tmEnvioCartasTimer=setTimeout(()=>{tmEnvioCartasTimer=null;enviarFilaCartas();},230);
}
async function enviarFilaCartas() {
  if(envioCartasAtivo||!APP.sessao||APP.sessao.perfil!=='ADM')return;
  const lote=filaCartasDaConta().filter(x=>x.estado==='pendente').slice(0,12);
  if(!lote.length)return;
  envioCartasAtivo=true;
  lote.forEach(x=>x.estado='enviando');salvarFilaCartas();renderFilaCartas();renderCartas();
  try {
    const r=await api('salvarCartasLote',{cartas:lote.map(x=>({id:x.id,dados:x.dados}))});
    if(!Array.isArray(r.resultados))throw Error('Resposta do servidor incompleta. Reenvie para conferir a gravação.');
    const respostas=new Map(r.resultados.map(x=>[x.id,x]));
    let gravadas=0;
    for(const item of lote) {
      const resposta=respostas.get(item.id);
      if(!resposta){item.estado='erro';item.erro='O servidor não confirmou esta carta.';continue;}
      if(resposta.sucesso&&resposta.carta){
        filaCartas=filaCartas.filter(x=>x.id!==item.id);
        const idx=APP.cartas.findIndex(c=>c.id===resposta.carta.id);
        if(idx>=0)APP.cartas[idx]=resposta.carta;
        else APP.cartas.unshift(resposta.carta);
        ordenarCartasPorLancamento(APP.cartas);
        gravadas++;
      }else{item.estado='erro';item.erro=resposta.erro||'Não foi possível gravar esta carta.';}
    }
    if(gravadas)feedbackAtualizacao(gravadas===1?'Carta salva no Google Sheets.':`${gravadas} cartas salvas no Google Sheets.`);
  }catch(err){
    // Não criar nova carta com outro ID: reenvios do mesmo ID são idempotentes.
    lote.forEach(x=>{x.estado='erro';x.erro=err.message||'Erro de conexão.';});
    feedbackAtualizacao('Envio não confirmado. Use “Tentar novamente”.',true);
  }finally{
    envioCartasAtivo=false;
    salvarFilaCartas();renderFilaCartas();reexibirCartasLocais();
    if(filaCartasDaConta().some(x=>x.estado==='pendente'))agendarEnvioCartas();
  }
}
function reenviarCartaPendente(id) {
  const carta=filaCartasDaConta().find(x=>x.id===id);
  if(!carta)return;
  carta.estado='pendente';carta.erro='';salvarFilaCartas();renderFilaCartas();renderCartas();agendarEnvioCartas();
}
function reativarFilaDeCartas() {
  // Chamado só depois de carregar o histórico: descarta pedidos já confirmados.
  const existentes=new Set(APP.cartas.map(c=>c.id));
  filaCartas=filaCartas.filter(x=>x.usuario!==APP.sessao.usuario||!existentes.has(x.id));
  salvarFilaCartas();renderFilaCartas();renderCartas();agendarEnvioCartas();
}

async function salvarCarta(e) {
  e?.preventDefault();
  try {
    if(!normalizarAnoDaData($('carta-ocorrencia'))||!normalizarAnoDaData($('carta-correcao')))throw Error('Confira as datas informadas.');
    const nome=$('carta-funcionario').value.trim(), ident=identificarFuncionarioCarta(nome);
    const anterior=APP.cartaEditando&&APP.cartas.find(c=>c.id===APP.cartaEditando);
    const mesmoNome=anterior&&norm(anterior.funcionario)===norm(nome);
    const empresa=ident.empresa||(mesmoNome?anterior.empresa:'');
    if(ident.erro)throw Error(ident.erro);
    const dados={funcionario:ident.nome||nome,empresa,
      dataOcorrencia:dataParaISO($('carta-ocorrencia').value),responsavel:$('carta-responsavel').value.trim(),
      dataCorrecao:dataParaISO($('carta-correcao').value),assinado:$('carta-assinado').value,
      observacoes:$('carta-obs').value.trim(),
      ordemCriacao:new Date().toISOString()};
    if(!dados.dataOcorrencia)throw Error('Informe a data da ocorrência.');
    const editando=APP.cartaEditando;
    if(editando){
      const r=await api('editarCarta',{idCarta:editando,dados});
      if(!r.carta)throw Error('O servidor não retornou a carta editada. Atualize o histórico.');
      const idx=APP.cartas.findIndex(c=>c.id===editando);
      if(idx!==-1)APP.cartas[idx]=r.carta;else APP.cartas.unshift(r.carta);
      ordenarCartasPorLancamento(APP.cartas);
      definirModoCarta();reexibirCartasLocais();
      feedbackAtualizacao('Alterações da carta salvas no Google Sheets.');
      return true;
    }
    // Não bloquear o formulário enquanto o Apps Script grava a carta.
    if(filaCartasDaConta().length>=60)throw Error('Há muitos lançamentos pendentes. Confira a conexão antes de continuar.');
    const id=criarIdentificadorCarta();
    filaCartas.push({id,usuario:APP.sessao.usuario,dados,estado:'pendente',erro:''});
    try{salvarFilaCartas();}catch(err){filaCartas=filaCartas.filter(x=>x.id!==id);throw Error('Sem espaço para armazenar o envio com segurança.');}
    const dataOcorrencia=dados.dataOcorrencia,dataCorrecao=dados.dataCorrecao;
    definirModoCarta();
    // Facilita inserir várias cartas do mesmo dia, como no Excel.
    $('carta-ocorrencia').value=dataISOParaCampo(dataOcorrencia);$('carta-correcao').value=dataISOParaCampo(dataCorrecao);
    $('carta-funcionario').focus({preventScroll:true});
    renderFilaCartas();renderCartas();agendarEnvioCartas();
    return true;
  }catch(err){showMessage(err.message,'Falha ao salvar a carta',true);return false;}
}
// Caixa de confirmação integrada ao visual do site. O backend já exclui em definitivo.
function confirmarExclusaoCarta(nome) {
  const modal=$('modal-excluir-carta');
  if(modal.open)return Promise.resolve(false);
  $('tm-confirma-exclusao-texto').textContent=`Certeza que deseja excluir '${nome}'?`;
  const focoAnterior=document.activeElement;
  return new Promise(resolve=>{
    let finalizado=false;
    const cancelar=$('tm-cancelar-exclusao');
    const confirmar=$('tm-confirmar-exclusao');
    function finalizar(confirmou){
      if(finalizado)return;
      finalizado=true;
      cancelar.removeEventListener('click',aoCancelar);
      confirmar.removeEventListener('click',aoConfirmar);
      modal.removeEventListener('cancel',aoEscape);
      modal.removeEventListener('close',aoFechar);
      modal.removeEventListener('click',aoFundo);
      if(modal.open)modal.close();
      if(focoAnterior?.isConnected)focoAnterior.focus({preventScroll:true});
      resolve(confirmou);
    }
    const aoCancelar=()=>finalizar(false);
    const aoConfirmar=()=>finalizar(true);
    const aoEscape=e=>{e.preventDefault();finalizar(false);};
    const aoFechar=()=>finalizar(false);
    const aoFundo=e=>{if(e.target===modal)finalizar(false);};
    cancelar.addEventListener('click',aoCancelar);
    confirmar.addEventListener('click',aoConfirmar);
    modal.addEventListener('cancel',aoEscape);
    modal.addEventListener('close',aoFechar);
    modal.addEventListener('click',aoFundo);
    modal.showModal();
    cancelar.focus();
  });
}
async function excluirCarta(id) {
  try {
    await api('excluirCarta',{idCarta:id});
    APP.cartas=APP.cartas.filter(c=>c.id!==id);
    APP.selecionadas.delete(id);
    if(APP.cartaEditando===id)definirModoCarta();
    reexibirCartasLocais();feedbackAtualizacao('Carta excluída com sucesso.');
    return true;
  }catch(e){showMessage(e.message,'Falha ao excluir carta',true);return false;}
}
let carregamentoPendentesEmCurso=null;
function carregarPendentes() {
  // Dois cliques seguidos ou o auto-refresh não iniciam duas consultas iguais.
  if(carregamentoPendentesEmCurso)return carregamentoPendentesEmCurso;
  carregamentoPendentesEmCurso=(async()=>{
    try {
      const admin=APP.sessao?.perfil==='ADM';
      const r=await api(admin?'getPendentesADM':'getDadosEncarregado');
      APP.pendentes=Array.isArray(r.dados)?r.dados:[];
      renderPendentes();
      return true;
    }catch(e){
      const lista=$('lista-pendentes');
      if(lista&&!APP.pendentes.length)lista.innerHTML=`<p class="empty">${esc(e.message)}</p>`;
      else feedbackAtualizacao('Não foi possível atualizar as pendências. A lista anterior foi mantida.',true);
      return false;
    }
  })().finally(()=>{carregamentoPendentesEmCurso=null;});
  return carregamentoPendentesEmCurso;
}
// V31.12 — buscar e ordenar no navegador: sem alterar o banco de dados
// e sem pedir novas consultas ao Apps Script a cada tecla.
function filtrarEOrdenarCartasPendentes(cartas,config) {
  const termo=norm(config?.busca||'').replace(/\s+/g,' ');
  const tipo=config?.ordem||'DATA_ASC';
  const filtradas=cartas.filter(c=>{
    const nome=norm(c.funcionario||'').replace(/\s+/g,' ');
    const nomeBase=norm(separarNomeCarta(c.funcionario).nomeBase).replace(/\s+/g,' ');
    return !termo||nome.includes(termo)||nomeBase.includes(termo);
  });
  const chaveData=c=>dataParaISO(c.dataOcorrencia)||''; // AAAA-MM-DD: ordenação cronológica
  const chaveNome=c=>norm(separarNomeCarta(c.funcionario).nomeBase);
  const anterior=(a,b)=>dataOrdemCarta(b)-dataOrdemCarta(a); // desempate estável
  const comparar=(a,b)=>{
    if(tipo==='NOME_ASC'||tipo==='NOME_DESC'){
      const dif=chaveNome(a).localeCompare(chaveNome(b),'pt-BR',{sensitivity:'base',numeric:true});
      if(dif)return tipo==='NOME_ASC'?dif:-dif;
      const dataA=chaveData(a),dataB=chaveData(b);
      if(dataA&&dataB&&dataA!==dataB)return dataA<dataB?-1:1;
      return anterior(a,b);
    }
    const da=chaveData(a),db=chaveData(b);
    if(da&&db&&da!==db)return tipo==='DATA_DESC'?(da>db?-1:1):(da<db?-1:1);
    // Datas vazias ou inválidas sempre no fim, independentemente da direção.
    if(!da&&db)return 1;
    if(da&&!db)return -1;
    return chaveNome(a).localeCompare(chaveNome(b),'pt-BR',{sensitivity:'base',numeric:true})||anterior(a,b);
  };
  return filtradas.sort(comparar);
}
function renderPendentes() {
  const filtro=$('filtro-controle-enc')?.value||'PENDENTE';
  const pendentes=APP.pendentes.filter(c=>c.controleEncarregado!=='ASSINADA').length;
  definirBadge('badge-pendentes',pendentes);
  const ehAdm=APP.sessao?.perfil==='ADM';
  const descricao=$('descricao-cartas-pendentes');
  if(descricao)descricao.textContent=ehAdm
    ?'Confirme as assinaturas registradas. Só o administrador altera o responsável e a situação oficial da carta.'
    :'Registre assinaturas e pedidos de reimpressão. A assinatura atualiza o responsável, mas a confirmação oficial (SIM) é exclusiva do administrador.';
  const filtros=$('filtro-controle-enc')?.closest('.tm-pendente-status');
  if(filtros)filtros.hidden=ehAdm;
  const cartasStatus=ehAdm?APP.pendentes:APP.pendentes.filter(c=>filtro==='TODAS'||(filtro==='ASSINADA'
    ?c.controleEncarregado==='ASSINADA':c.controleEncarregado!=='ASSINADA'));
  const exibidas=filtrarEOrdenarCartasPendentes(cartasStatus,{
    busca:$('busca-cartas-pendentes')?.value||'',ordem:$('ordenar-cartas-pendentes')?.value||'DATA_ASC'
  });
  const contador=$('contador-cartas-pendentes');
  if(contador)contador.textContent=`Exibindo ${exibidas.length} de ${cartasStatus.length} ${cartasStatus.length===1?'carta':'cartas'}`;
  $('lista-pendentes').innerHTML=exibidas.length?exibidas.map(c=>{
    const assinatura=c.controleEncarregado==='ASSINADA';
    const reimpressao=c.controleEncarregado==='REIMPRESSAO';
    const via=Math.max(1,Number(c.via)||1);
    const rotuloVia=via>=2?` · ${via}ª via`:'';
    return `<article class="pending-item tm-carta-encarregado">
      <div class="tm-pendente-info"><span class="pending-date">${esc(fmtData(c.dataOcorrencia))}</span>
        <h4>${esc(c.funcionario)}</h4>
        <p>${esc(c.motivo||'Carta de ponto')}${c.responsavel?' • Entregue a: '+esc(c.responsavel):''}</p>
        <span class="tm-mov-status ${assinatura?'tm-enc-assinada':reimpressao?'tm-enc-reimpressao':'tm-enc-pendente'}">${assinatura?'Assinatura recebida':reimpressao?'Reimpressão solicitada':'Aguardando assinatura'+rotuloVia}</span>
      </div><div class="tm-pendente-acoes">
        ${ehAdm?botoesConfirmacaoCarta(c):
          `${!assinatura?`<button type="button" class="btn primary tm-enc-registrar" data-id="${esc(c.id)}" data-status="ASSINADA">Marcar assinatura recebida</button>`:''}
          <button type="button" class="btn secondary tm-enc-registrar" data-id="${esc(c.id)}" data-status="REIMPRESSAO" ${reimpressao?'disabled title="Já existe solicitação de reimpressão"':''}>Solicitar reimpressão</button>`}
      </div></article>`;
  }).join(''):`<div class="empty tall">${$('busca-cartas-pendentes')?.value?.trim()?'Nenhuma carta encontrada para esse nome.':'Nenhuma carta neste filtro.'}</div>`;
}
const acoesEncarregadoEmCurso=new Set();
async function registrarAcaoCartaEncarregado(id,status) {
  if(APP.sessao?.perfil!=='ENCARREGADO'||acoesEncarregadoEmCurso.has(id))return false;
  acoesEncarregadoEmCurso.add(id);
  try {
    const idSolicitacao=crypto.randomUUID?.()||('ENC-'+Date.now()+'-'+Math.random().toString(36).slice(2));
    const r=await api('registrarAcaoCartaEncarregado',{idCarta:id,status,idSolicitacao});
    if(!r.evento||r.estado!==status)throw Error('A ação não foi confirmada pelo servidor. Atualize a lista.');
    const carta=APP.pendentes.find(c=>c.id===id);
    if(carta){
      carta.controleEncarregado=r.estado;
      if(status==='ASSINADA'&&r.carta?.responsavel)carta.responsavel=r.carta.responsavel;
    }
    renderPendentes();
    feedbackAtualizacao(status==='ASSINADA'?
      `Assinatura recebida; responsável atualizado para ${r.carta?.responsavel||r.evento.marcadoPor}. A carta continua NÃO até confirmação do administrador.`:
      'Reimpressão solicitada e enviada ao painel do administrador.');
    return true;
  }catch(e){showMessage(e.message,'Não foi possível registrar a ação',true);return false;}
  finally{acoesEncarregadoEmCurso.delete(id);}
}
const confirmacoesCartaEmCurso=new Set();
async function confirmarCarta(id,usarNomeDoEncarregado=false,idAcaoAssinada='') {
  if(APP.sessao?.perfil!=='ADM'||confirmacoesCartaEmCurso.has(id))return false;
  confirmacoesCartaEmCurso.add(id);
  try {
    const r=await api('confirmarCarta',{idCarta:id,usarNomeDoEncarregado,idAcaoAssinada});
    if(!r.carta)throw Error('O servidor não confirmou a carta. Recarregue o histórico.');
    // O nome é obtido e validado pelo Apps Script, nunca enviado pelo navegador.
    if(usarNomeDoEncarregado&&idAcaoAssinada){
      const origem=(APP.acoesCartas||[]).find(a=>a.id===idAcaoAssinada&&a.idCarta===id);
      if(origem&&norm(r.carta.responsavel)!==norm(origem.marcadoPor))
        throw Error('A confirmação não atribuiu o responsável esperado. Atualize as ações.');
    }
    const idx=APP.cartas.findIndex(c=>c.id===id);
    if(idx>=0)APP.cartas[idx]=r.carta;else APP.cartas.unshift(r.carta);
    APP.pendentes=APP.pendentes.filter(c=>c.id!==id);
    // Uma assinatura atribuída deixa a fila de ações do ADM imediatamente.
    if(usarNomeDoEncarregado){
      APP.acoesCartas=(APP.acoesCartas||[]).filter(a=>a.idCarta!==id);
      renderAcoesCartas();
    }
    reexibirCartasLocais();
    feedbackAtualizacao(usarNomeDoEncarregado?
      `Assinatura SIM; responsável atualizado para ${r.carta.responsavel}.`:
      'Assinatura SIM confirmada; responsável mantido.');
    return true;
  }catch(e){showMessage(e.message,'Não foi possível confirmar',true);return false;}
  finally{confirmacoesCartaEmCurso.delete(id);}
}

let atualizandoAcoesCartas=false;
let acoesCartasJaConsultadas=false;
async function carregarAcoesCartas() {
  if(APP.sessao?.perfil!=='ADM'||atualizandoAcoesCartas)return false;
  atualizandoAcoesCartas=true;
  try {
    const anteriores=new Set((APP.acoesCartas||[]).map(a=>a.id));
    const acoes=(await api('getAcoesCartasADM')).dados||[];
    APP.acoesCartas=acoes;
    renderAcoesCartas();
    const assinaturasNovas=acoesCartasJaConsultadas&&acoes.some(a=>
      a.status==='ASSINADA'&&!anteriores.has(a.id));
    acoesCartasJaConsultadas=true;
    if(assinaturasNovas&&APP.cartas.length){
      // Recarrega a fonte oficial somente quando surgir nova assinatura.
      // O responsável no painel ADM muda sem precisar dar F5.
      await Promise.all([carregarCartas(),carregarAssinaturasResponsaveis()]);
    }
    return true;
  }catch(e){$('tm-lista-acoes-cartas').innerHTML=`<p class="empty">${esc(e.message)}</p>`;return false;}
  finally{atualizandoAcoesCartas=false;}
}
function renderAcoesCartas() {
  const lista=$('tm-lista-acoes-cartas');if(!lista)return;
  const acoes=APP.acoesCartas||[];
  $('tm-total-acoes-cartas').textContent=String(acoes.length);
  lista.innerHTML=acoes.length?acoes.map(a=>`<article class="tm-aviso-carta">
    <div class="tm-aviso-nome"><strong title="${esc(a.funcionario)}">${esc(a.funcionario)}</strong>
      <small>Carta: ${esc(fmtData(a.dataOcorrencia))}</small></div>
    <div class="tm-aviso-quem" title="Registrado em ${esc(fmtDataHora(a.quando))}">${esc(a.marcadoPor||'—')}</div>
    <div class="tm-aviso-acao"><span class="tm-aviso-situacao ${a.status==='ASSINADA'?'tm-aviso-assinada':'tm-aviso-reimpressao'}">${a.status==='ASSINADA'?'Assinada':'Reimpressão'}</span>
      ${a.status==='ASSINADA'&&APP.sessao?.perfil==='ADM'?`<button type="button" class="btn tiny primary tm-aviso-confirmar-assinatura" data-id="${esc(a.idCarta)}" data-acao="${esc(a.id)}" title="Marcar SIM e atribuir o responsável a ${esc(a.marcadoPor)}" aria-label="Confirmar assinatura de ${esc(a.funcionario)} e atribuir a ${esc(a.marcadoPor)}">Confirmar</button>`:''}
      ${a.status==='REIMPRESSAO'?`<button type="button" class="btn tiny primary tm-reimpressao-ok" data-id="${esc(a.idCarta)}" title="Reimpressão feita: devolve a carta ao encarregado" aria-label="Marcar reimpressão de ${esc(a.funcionario)} como feita">✓ OK</button>`:''}</div>
  </article>`).join(''):'<p class="tm-avisos-vazio">Nenhuma movimentação registrada pelos encarregados.</p>';
}
async function concluirReimpressao(idCarta) {
  if(APP.sessao?.perfil!=='ADM')return false;
  try {
    const idSolicitacao=crypto.randomUUID?.()||('ADM-'+Date.now()+'-'+Math.random().toString(36).slice(2));
    const r=await api('concluirReimpressaoCarta',{idCarta,idSolicitacao});
    if(!r.evento||r.estado!=='REIMPRESSAO_FEITA')throw Error('A ação não foi confirmada pelo servidor. Atualize a lista.');
    APP.acoesCartas=(APP.acoesCartas||[]).filter(a=>a.idCarta!==idCarta);
    renderAcoesCartas();
    feedbackAtualizacao((r.via?r.via+'ª via':'Reimpressão')+' marcada como feita. A carta voltou às pendências do encarregado.');
    return true;
  }catch(e){showMessage(e.message,'Não foi possível concluir a reimpressão',true);carregarAcoesCartas();return false;}
}
function cartasCapaFiltradas() {
  return filtroDeCartas({texto:$('filtro-capa').value,mes:$('filtro-capa-mes').value})
    .filter(c=>norm(c.status)==='NAO');
}
// V30.9 — Âncora da última caixa marcada, para Shift+clique como no Windows.
// O Set controla apenas quais cartas estão selecionadas. A ordem de impressão
// é definida separadamente: lançamento + agrupamento por funcionário.
let ultimaCartaCapaMarcada = null;
function alterarSelecaoCapa(id, marcar, comShift=false) {
  const visiveis=cartasCapaFiltradas().slice(0,250);
  const destino=visiveis.findIndex(c=>c.id===id);
  const origem=comShift?visiveis.findIndex(c=>c.id===ultimaCartaCapaMarcada):-1;
  if(origem>=0&&destino>=0) {
    const passo=origem<=destino?1:-1;
    // Parte da âncora rumo à carta clicada: isso preserva a ordem dos cliques
    // inclusive ao selecionar de baixo para cima.
    for(let i=origem;;i+=passo) {
      const cartaId=visiveis[i].id;
      if(marcar)APP.selecionadas.add(cartaId);
      else APP.selecionadas.delete(cartaId);
      if(i===destino)break;
    }
  } else {
    if(marcar)APP.selecionadas.add(id);
    else APP.selecionadas.delete(id);
  }
  ultimaCartaCapaMarcada=id;
  renderCapa();
}
function atualizarTotalSelecionadas() {$('total-selecionadas').textContent=APP.selecionadas.size;}
function renderCapa() {
  // Nunca deixe cartas assinadas na seleção, mesmo que sejam confirmadas após selecionar.
  const aindaPendentes=new Set(APP.cartas.filter(c=>norm(c.status)==='NAO').map(c=>c.id));
  for(const id of APP.selecionadas)if(!aindaPendentes.has(id))APP.selecionadas.delete(id);
  if(ultimaCartaCapaMarcada&&!aindaPendentes.has(ultimaCartaCapaMarcada))ultimaCartaCapaMarcada=null;
  const filtradas=cartasCapaFiltradas(),arr=filtradas.slice(0,250);
  $('tbody-capa').innerHTML=arr.length?arr.map(c=>`<tr><td><input type="checkbox" class="check-capa" data-id="${esc(c.id)}" ${APP.selecionadas.has(c.id)?'checked':''} aria-label="Selecionar ${esc(c.funcionario)}" title="Shift + clique: selecionar intervalo"></td><td class="mono">${fmtData(c.dataOcorrencia)}</td><td><strong>${esc(c.funcionario)}</strong></td><td>${esc(c.responsavel||'—')}</td><td class="mono">${fmtData(c.dataCorrecao)}</td><td>${esc(c.status)}</td></tr>`).join(''):'<tr><td colspan="6" class="empty">Nenhuma carta neste filtro.</td></tr>';
  if(filtradas.length>arr.length)$('tbody-capa').innerHTML+=`<tr><td colspan="6" class="empty">Exibindo ${arr.length} de ${filtradas.length} cartas. Filtre por mês ou nome para localizar outros registros.</td></tr>`;
  $('check-todas-capa').checked=arr.length>0&&arr.every(c=>APP.selecionadas.has(c.id));
  atualizarTotalSelecionadas();
  $('imprimir-capa').disabled=APP.selecionadas.size===0;
}
// V30.10 — Os cartões vêm do backend em ordem inversa ao lançamento
// (o mais recente primeiro). A capa deve seguir a sequência ORIGINAL de
// lançamento, mas aproximando todas as cartas de um mesmo funcionário.
// (FALTA) é um tipo de carta, não um funcionário diferente.
function agruparCartasCapaPorLancamento(cartas) {
  const porFuncionario=new Map();
  for(const carta of cartas) {
    const nomeBase=separarNomeCarta(carta.funcionario).nomeBase;
    // Nome abreviado e completo devem ficar no mesmo grupo de impressão.
    const grupo=nomeBase?chaveFuncionarioCarta(nomeBase):`CARTA:${carta.id}`;
    if(!porFuncionario.has(grupo))porFuncionario.set(grupo,[]);
    porFuncionario.get(grupo).push(carta);
  }
  return [...porFuncionario.values()].flat();
}
function imprimirCapa() {
  // Imprimir apenas as cartas NÃO assinadas que foram marcadas.
  // APP.cartas vem em ordem decrescente de lançamento; reverter recoloca
  // na ordem original da planilha (do lançamento mais antigo ao mais novo).
  // O Map preserva a posição da primeira carta de cada colaborador e agrupa
  // as demais, mantendo a ordem de lançamento dentro de cada grupo.
  const itens=agruparCartasCapaPorLancamento(APP.cartas.slice().reverse()
    .filter(c=>norm(c.status)==='NAO'&&APP.selecionadas.has(c.id)));
  if(!itens.length)return showMessage('Selecione pelo menos uma carta não assinada.','Atenção',true);

  const win=window.open('','_blank');
  if(!win)return showMessage('Seu navegador bloqueou a janela de impressão. Libere pop-ups para este site.','Impressão bloqueada',true);

  // Apenas confirmação explícita limpa a seleção. O navegador não distingue
  // 'Imprimir' de 'Cancelar' no diálogo nativo (ambos disparam afterprint).
  const identificadorImpressao=crypto.randomUUID?.()||String(Date.now());
  const idsImpressos=new Set(itens.map(c=>c.id));
  const receberConfirmacao=evento=>{
    if(evento.source!==win||evento.origin!==location.origin||
       evento.data?.tipo!=='TM_CARTAS_IMPRESSAO_CONFIRMADA'||
       evento.data?.id!==identificadorImpressao)return;
    for(const id of idsImpressos)APP.selecionadas.delete(id);
    ultimaCartaCapaMarcada=null;
    renderCapa();
    window.removeEventListener('message',receberConfirmacao);
  };
  window.addEventListener('message',receberConfirmacao);
  // Evita listener órfão quando a guia é fechada sem imprimir.
  const monitorJanela=setInterval(()=>{
    if(!win.closed)return;
    clearInterval(monitorJanela);window.removeEventListener('message',receberConfirmacao);
  },1500);
  const linhas=itens.map(c=>`<tr><td>${esc(fmtData(c.dataOcorrencia))}</td><td>${esc(c.funcionario)}</td><td>${esc(c.responsavel||'—')}</td><td>${esc(fmtData(c.dataCorrecao))}</td></tr>`).join('');
  const emissao=new Intl.DateTimeFormat('pt-BR',{
    timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).format(new Date()).replace(',', '');

  // O CSS @page com margem 0 evita os cabeçalhos e rodapés automáticos
  // em navegadores compatíveis. Caso apareçam, desative "Cabeçalhos e rodapés"
  // na janela de impressão; esses textos são controlados pelo navegador.
  const html=`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title></title>
  <style>
  @page { size:A4 portrait; margin:0; }
  * { box-sizing:border-box; }
  html,body { margin:0; padding:0; }
  body { font-family:Arial,Helvetica,sans-serif; color:#111; font-size:10px; font-weight:700; background:white; }
  .documento { padding:14mm 12mm 25mm; }
  h1 { margin:0 0 5mm; border:2px solid #222; padding:9px 6px;
       font-size:15px; font-weight:800; text-align:center; }
  table { border-collapse:collapse; width:100%; table-layout:fixed; }
  thead { display:table-header-group; }
  th,td { border:1px solid #222; padding:5px 4px; text-align:center;
          font-weight:700; overflow-wrap:anywhere; vertical-align:middle; }
  th { background:#e8ebef; font-size:10px; font-weight:800; }
  th:nth-child(1) { width:18%; } th:nth-child(2) { width:38%; }
  th:nth-child(3) { width:24%; } th:nth-child(4) { width:20%; }
  tbody tr { break-inside:avoid; page-break-inside:avoid; }
  .assinatura { display:flex; gap:24px; margin-top:15mm;
               break-inside:avoid; page-break-inside:avoid; }
  .assinatura div { border-top:1px solid #222; padding-top:6px;
                   flex:1; text-align:center; font-size:10px; font-weight:700; }
  .emissao { position:fixed; bottom:11mm; left:12mm; right:12mm;
             text-align:left; font-size:10px; font-weight:700; }
  .tm-pos-impressao { position:fixed;top:0;left:0;right:0;background:#f4f8fc;
      border-bottom:2px solid #1f4e78;padding:12px 18px;z-index:100;
      font:13px/1.5 Arial,sans-serif;font-weight:400;display:flex;
      gap:12px;align-items:center;justify-content:center;flex-wrap:wrap; }
  .tm-pos-impressao[hidden] { display:none; }
  .tm-pos-impressao button { cursor:pointer;padding:8px 13px;border:0;border-radius:7px;
      background:#1f4e78;color:white;font-size:12px;font-weight:700; }
  .tm-pos-impressao button.secundario { background:white;color:#1f4e78;border:1px solid #1f4e78; }
  @media print { body { print-color-adjust:exact; -webkit-print-color-adjust:exact; }
    .tm-pos-impressao { display:none!important; } }
  </style></head><body>
    <main class="documento">
      <h1>CONTROLE DE RECEBIMENTO CORREÇÃO DE PONTO</h1>
      <table><thead><tr><th>DATA DA OCORRÊNCIA</th><th>COLABORADORES</th>
        <th>RESPONSÁVEL OP</th><th>DATA ALTERAÇÃO</th></tr></thead>
        <tbody>${linhas}</tbody></table>
      <div class="assinatura"><div>Responsável pela entrega</div><div>Responsável pelo recebimento</div></div>
    </main>
    <footer class="emissao">Emissão: ${esc(emissao)}</footer>
    <div class="tm-pos-impressao" id="tm-pos-impressao" hidden>
      <strong>Você imprimiu ou salvou o documento em PDF?</strong>
      <button type="button" id="tm-confirmar-impressao">Sim — concluir e desmarcar</button>
      <button type="button" class="secundario" id="tm-cancelar-impressao">Não — manter seleção</button>
    </div>
    <script>
      (()=>{
        const painel=document.getElementById('tm-pos-impressao');
        document.getElementById('tm-confirmar-impressao').addEventListener('click',()=>{
          try{window.opener?.postMessage({tipo:'TM_CARTAS_IMPRESSAO_CONFIRMADA',
            id:${JSON.stringify(identificadorImpressao)}},location.origin);}catch(_){ }
          window.close();
        });
        document.getElementById('tm-cancelar-impressao').addEventListener('click',()=>window.close());
        window.addEventListener('afterprint',()=>{painel.hidden=false;});
        window.addEventListener('load',()=>setTimeout(()=>window.print(),300));
      })();
    <\/script>
  </body></html>`;
  win.document.open();win.document.write(html);win.document.close();
}

// V30.5 — relatórios por colaborador: (FALTA) é um tipo de carta, não outra pessoa.
// A chave ignora acentos, caixa e espaços extras. O histórico das cartas permanece intacto.
function agruparCartasPorFuncionario(cartas) {
  const grupos=new Map();
  for(const carta of cartas) {
    const {falta,nomeBase}=separarNomeCarta(carta.funcionario);
    const nome=nomeBase.replace(/\s+/g,' ').trim();
    if(!nome)continue;
    const chave=chaveFuncionarioCarta(nome);
    let registro=grupos.get(chave);
    if(!registro){
      const oficial=localizarNomeCartaNaBase(nome).registro;
      registro={nome:oficial?.nome||nome,total:0,normais:0,faltas:0};
      grupos.set(chave,registro);
    }
    registro.total++;
    if(falta)registro.faltas++;
    else registro.normais++;
  }
  return [...grupos.values()].sort((a,b)=>
    b.total-a.total||a.nome.localeCompare(b.nome,'pt-BR'));
}
const detalharCartas = r => `${r.normais} normais · ${r.faltas} faltas`;

const chartColors=['#1f4e78','#4f83b7','#77a6cc','#ec9845','#4e9d93','#7465ab','#d46f83','#8492a6','#90b67d','#c59759','#6f8796','#cbb2d9'];
function filtrarPeriodoRelatorio() {const mes=$('filtro-relatorio-mes').value;return APP.cartas.filter(c=>!mes||c.dataOcorrencia.slice(0,7)===mes);}
function renderRelatorios() {
  const data=filtrarPeriodoRelatorio(),mes=$('filtro-relatorio-mes').value;
  const periodo=mes?`${mes.slice(5,7)}/${mes.slice(0,4)}`:'TODO O PERÍODO';
  // Top 15 idêntico na tabela, gráfico e imagem para manter a leitura no celular.
  const arr=agruparCartasPorFuncionario(data).slice(0,15);
  $('titulo-ranking').textContent='RANKING DE CARTAS — '+periodo.toUpperCase();
  $('titulo-barras').textContent='QUANTIDADE DE CARTAS DE PONTO POR FUNCIONÁRIO — '+periodo.toUpperCase();
  $('tbody-ranking').innerHTML=arr.length?arr.map((f,i)=>`<tr><td class="rank-num">${i+1}º</td><td><strong class="ranking-nome">${esc(f.nome)}</strong><small class="block">${esc(detalharCartas(f))}</small></td><td><strong class="ranking-quantidade">${f.total}</strong></td></tr>`).join(''):'<tr><td colspan="3" class="empty">Sem cartas para o período selecionado.</td></tr>';
  const top=arr,max=top[0]?.total||1;
  $('grafico-barras').innerHTML=top.length?`<div class="bars">${top.map((x,i)=>`<div class="bar-row"><span class="bar-name" title="${esc(x.nome+' — '+detalharCartas(x))}">${esc(x.nome)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(1,x.total/max*100)}%;background:${chartColors[i%chartColors.length]}"></div></div><b class="bar-count" title="${esc(detalharCartas(x))}">${x.total}</b></div>`).join('')}</div><p class="chart-caption">Top 15 • cartas normais e faltas somadas por funcionário • detalhamento no ranking</p>`:'<p class="empty">Sem dados para construir o gráfico.</p>';
  const porResponsavel=new Map();for(const c of data){const nome=c.responsavel.trim()||'NÃO INFORMADO';const k=norm(nome);const o=porResponsavel.get(k)||{nome,total:0};o.total++;porResponsavel.set(k,o);}
  const responsaveis=[...porResponsavel.values()].sort((a,b)=>b.total-a.total);
  const total=responsaveis.reduce((s,v)=>s+v.total,0);
  let ang=-Math.PI/2;
  const partes=responsaveis.map((r,i)=>{
    const delta=2*Math.PI*r.total/total,inicio=ang,fim=ang+delta;ang=fim;
    const col=chartColors[i%chartColors.length];const cx=150,cy=150,rr=108;
    const ponto=t=>[cx+rr*Math.cos(t),cy+rr*Math.sin(t)];
    let shape;
    if(responsaveis.length===1)shape=`<circle cx="150" cy="150" r="108" fill="${col}"/>`;
    else{const a=ponto(inicio),b=ponto(fim);shape=`<path d="M150 150 L${a[0].toFixed(3)} ${a[1].toFixed(3)} A108 108 0 ${delta>Math.PI?1:0} 1 ${b[0].toFixed(3)} ${b[1].toFixed(3)} Z" fill="${col}" stroke="white" stroke-width="1.8"/>`;}
    const mid=inicio+delta/2;const pct=r.total/total*100;
    const x=150+69*Math.cos(mid),y=150+69*Math.sin(mid);
    const label=pct>=6?`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="middle" dominant-baseline="middle" fill="white" font-weight="700" font-size="13">${pct.toFixed(1).replace('.',',')}%</text>`:'';
    return {shape,label,nome:r.nome,pct,count:r.total,color:col};
  });
  $('grafico-pizza').innerHTML=partes.length?`<svg viewBox="0 0 300 300" aria-hidden="true">${partes.map(p=>p.shape).join('')}${partes.map(p=>p.label).join('')}</svg>`:'<div class="empty">Sem dados.</div>';
  $('legenda-pizza').innerHTML=partes.map(p=>`<div class="legend-item"><span class="legend-dot" style="background:${p.color}"></span><span class="legend-name">${esc(p.nome)}</span><strong>${p.pct.toFixed(1).replace('.',',')}%</strong><small>(${p.count})</small></div>`).join('');
}

// RESUMO PARA COMPARTILHAR — a API SALDOS_MES não possui filtro diário comprovado.
const MESES_ABREV=['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
function mesDoRelatorio(indice) {
  const base=APP.saldos.find(x=>x.atualizadoEm)?.atualizadoEm;
  const m=String(base||today()).match(/^(\d{4})-(\d{2})/);
  const y=m?Number(m[1]):new Date().getFullYear(),mes=m?Number(m[2]):new Date().getMonth()+1;
  const d=new Date(y,mes-1+indice,1);
  return `${MESES_ABREV[d.getMonth()]}/${d.getFullYear()}`;
}
// Regra reproduzida do CalcularFolgasDefinitivo do Excel (VBA):
// (1) Soma os 3 saldos, com seus sinais, em minutos;
// (2) Arredonda o total para horas inteiras: minutos restantes >= 30 -> +1 hora;
// (3) Divide pela jornada: 08:48 para os 3 funcionários abaixo, 07:20 para demais;
// (4) Na fração de dias, >= 0,5 arredonda para cima; abaixo trunca;
// (5) Total negativo ou zero nunca concede dias de folga.
// ATENÇÃO: 00:30 isolados viram 1 hora, mas NÃO 1 dia de folga nesta regra.
const JORNADA_ESPECIAL = new Set([
  'JOÃO PAULO SAID FRAGA LIMA',
  'JONAS HENRIQUE BENFICA DE SOUZA',
  'LUIS ARTUR FRAGA VIEIRA'
].map(norm));
function jornadaHorasDoFuncionario(nome) {
  // Evita comparar em maiúsculas com acentos/espaços inconsistentes.
  return JORNADA_ESPECIAL.has(norm(nome)) ? 8.8 : (7 + 20 / 60);
}
function calcularDiasFolgaVBA(nome, saldoTotalMinutos) {
  if(saldoTotalMinutos===null || !Number.isFinite(saldoTotalMinutos)) return null;
  if(saldoTotalMinutos<=0) return 0;
  const horasInteiras=Math.floor(saldoTotalMinutos/60);
  const minutosRestantes=saldoTotalMinutos%60;
  const horasArredondadas=horasInteiras+(minutosRestantes>=30 ? 1 : 0);
  const diasExatos=horasArredondadas/jornadaHorasDoFuncionario(nome);
  const diasInteiros=Math.floor(diasExatos);
  // Pequena tolerância evita erro de ponto flutuante em valores como 1,5.
  return diasInteiros+((diasExatos-diasInteiros)>=0.5-1e-10 ? 1 : 0);
}
// V7 — visão compacta: não confundir saldo ausente com zero.
function renderFolgasEncarregado() {
  const lista=$('enc-lista-folgas');
  if(!lista || APP.sessao?.perfil!=='ENCARREGADO') return;
  const busca=norm($('enc-busca-funcionario')?.value||'');
  const pessoas=APP.saldos.filter(f=>!busca||norm(f.nome).includes(busca)).map(f=>{
    const meses=[f.saldoMesAtual,f.saldoMesAnterior,f.saldoMes2Anterior].map(minutos);
    const completos=meses.every(m=>m!==null && Number.isFinite(m));
    const saldo=completos?meses.reduce((a,b)=>a+b,0):null;
    return {nome:f.nome,empresa:f.empresa,dias:calcularDiasFolgaVBA(f.nome,saldo),saldo};
  }).sort((a,b)=>{
    // Mais dias primeiro; em empates, mais horas positivas no banco.
    // SEM DADOS fica por último para não parecer saldo zerado.
    if(a.dias===null)return b.dias===null?a.nome.localeCompare(b.nome,'pt-BR'):1;
    if(b.dias===null)return -1;
    return b.dias-a.dias || b.saldo-a.saldo || a.nome.localeCompare(b.nome,'pt-BR');
  });
  lista.innerHTML=pessoas.length?pessoas.map(f=>`<div class="enc-linha-folga"><span class="enc-nome">${esc(f.nome)}</span><span class="enc-dias${f.dias===null?' sem-dados':''}" aria-label="${f.dias===null?'Não informado':f.dias+' dias'}">${f.dias===null?'SEM DADOS':f.dias+'*'}</span></div>`).join(''):
    '<p class="empty">Nenhum funcionário encontrado.</p>';
}

// Referência VISUAL para o mês mais recente — não representa um corte diário da API.
// Do dia 02 em diante: 01 do mês atual até ontem. No dia 01: mês anterior completo.
// Calendário ancorado no fuso da operação, sem subtrair milissegundos de datas locais.
function referenciaAutomaticaResumo(agora=new Date()) {
  const partes=new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(agora);
  const info=Object.fromEntries(partes.filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  const ontem=new Date(Date.UTC(info.year,info.month-1,info.day-1));
  const ano=ontem.getUTCFullYear(),mes=ontem.getUTCMonth()+1,dia=ontem.getUTCDate();
  const dois=n=>String(n).padStart(2,'0');
  const inicio=`01/${dois(mes)}/${ano}`,fim=`${dois(dia)}/${dois(mes)}/${ano}`;
  return {inicio,fim,rotulo:`${inicio} a ${fim}`,mesReferencia:`${dois(mes)}/${ano}`};
}
function obterPeriodoResumo() {
  const ref=referenciaAutomaticaResumo();
  const meses=[-2,-1,0];
  if(!APP.saldos.length)return {valido:false,alerta:'Carregue os dados sincronizados antes de gerar o resumo.',meses,referencia:ref};
  return {
    valido:true,meses,referencia:ref,
    aviso:'O resumo usa três meses. No mês atual, o cálculo considera a jornada prevista até ontem quando a escala é identificada e existe leitura matinal válida; caso contrário, aparece SEM DADOS. Os valores brutos da API ficam separados para conferência. Compensações e prescrições ainda não foram validadas.'
  };
}
function resumoBancoLinhas(periodo=obterPeriodoResumo()) {
  const busca=norm($('resumo-busca')?.value),empresa=$('resumo-empresa')?.value||'';
  return APP.saldos.filter(x=>(!busca||norm(x.nome).includes(busca))&&(!empresa||empresa===x.empresa))
    .map(x=>{
      const mesesResumo=[-2,-1,0].map((offset,idx)=>{
        const incluido=true;
        const valor=[x.saldoMes2Anterior,x.saldoMesAnterior,x.saldoMesAtual][idx];
        return {incluido,min:minutos(valor)};
      });
      const selecionados=mesesResumo.filter(m=>m.incluido);
      const completo=selecionados.length>0&&selecionados.every(m=>m.min!==null&&Number.isFinite(m.min));
      const total=completo?selecionados.reduce((s,m)=>s+m.min,0):null;
      return {...x,mesesResumo,min:total,dias:calcularDiasFolgaVBA(x.nome,total)};
    })
    .sort((a,b)=>(b.min??-99999999)-(a.min??-99999999)||a.nome.localeCompare(b.nome,'pt-BR'));
}
function renderResumoBanco() {
  if(!$('tbody-resumo-grupo'))return;
  const empresas=[...new Set(APP.saldos.map(x=>x.empresa).filter(Boolean))];
  definirOptions('resumo-empresa',empresas,'Todas as empresas');
  $('resumo-mes-2').textContent=mesDoRelatorio(-2);
  $('resumo-mes-1').textContent=mesDoRelatorio(-1);
  $('resumo-mes-0').textContent=mesDoRelatorio(0);
  const periodo=obterPeriodoResumo();
  $('resumo-titulo-meses').textContent=`Banco de horas — ${mesDoRelatorio(-2)} a ${mesDoRelatorio(0)}`;
  $('resumo-periodo-automatico').textContent=`Período considerado no mês mais recente (quando validado): ${periodo.referencia.rotulo}`;
  $('resumo-atualizado').textContent=APP.saldos[0]?.atualizadoEm?'Atualizado: '+fmtDataHora(APP.saldos[0].atualizadoEm):'Aguardando sincronização';
  $('aviso-corte-resumo').textContent=periodo.alerta||periodo.aviso;
  $('aviso-corte-resumo').classList.toggle('invalido',!periodo.valido);
  const linhas=periodo.valido?resumoBancoLinhas(periodo):[];
  const fmtSaldo=m=>m===null?'<span class="saldo unknown">SEM DADOS</span>':`<span class="saldo ${m>0?'positive':m<0?'negative':'neutral'}">${esc(horas(m))}</span>`;
  $('tbody-resumo-grupo').innerHTML=linhas.length?linhas.map(x=>{
    const colunas=x.mesesResumo.map(m=>m.incluido?`<td>${fmtSaldo(m.min)}</td>`:'<td class="mes-excluido" title="Mês fora do período selecionado">—</td>').join('');
    return `<tr><td><strong>${esc(x.nome)}</strong><small class="block">${esc(x.empresa||'')}</small></td>${colunas}<td>${fmtSaldo(x.min)}</td><td><strong class="folga-dia ${x.dias===null?'indefinido':''}">${x.dias===null?'—':String(x.dias)}</strong></td></tr>`;
  }).join(''):`<tr><td colspan="6" class="empty">${esc(periodo.alerta||'Nenhum funcionário encontrado. Confira os filtros ou a sincronização.')}</td></tr>`;
  $('compartilhar-resumo').disabled=$('baixar-resumo').disabled=!periodo.valido||!linhas.length;
}
function agruparResumoParaImagem(linhas) {
  const obterGrupo=e=>{
    const texto=norm(e||'');
    if(texto.includes('BRAULIO')||texto.includes('TRANSMARINA'))return {ordem:0,nome:'TRANSMARINA'};
    if(texto.includes('FILIPPINI'))return {ordem:1,nome:'FILIPPINI'};
    return {ordem:2,nome:e||'OUTRAS EMPRESAS'};
  };
  const resultado=new Map();
  linhas.forEach(linha=>{
    const grupo=obterGrupo(linha.empresa),chave=grupo.ordem+'|'+grupo.nome;
    if(!resultado.has(chave))resultado.set(chave,{...grupo,linhas:[]});
    resultado.get(chave).linhas.push(linha);
  });
  return [...resultado.values()].sort((a,b)=>a.ordem-b.ordem||a.nome.localeCompare(b.nome,'pt-BR'))
    .map(g=>({...g,linhas:g.linhas.sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR',{sensitivity:'base'}))}));
}
function rankingParaCompartilhar() {
  // A imagem compartilhada usa a mesma contagem da tabela e do gráfico.
  return agruparCartasPorFuncionario(filtrarPeriodoRelatorio()).slice(0,15);
}
// PNG gerado no próprio navegador, sem bibliotecas externas ou envio de dados a serviços de terceiros.
function construirImagemResumo(tipo) {
  const ehBanco=tipo==='banco',periodo=obterPeriodoResumo();
  if(ehBanco&&!periodo.valido)throw Error(periodo.alerta);
  const linhas=ehBanco?resumoBancoLinhas(periodo):[];
  // No PNG do grupo, ocultar SOMENTE linhas com saldo mensal incompleto.
  // Ex.: Wagner: NOV sem leitura; não existe cálculo confiável dos dias de folga.
  // A tabela do site continua exibindo essas pessoas como SEM DADOS para conferência.
  // Nunca substituir um mês desconhecido por 00:00 ou dias de folga por zero.
  const linhasImagem=ehBanco?linhas.filter(r=>r.dias!==null):[];
  const grupos=ehBanco?agruparResumoParaImagem(linhasImagem):[];
  // Para a imagem continuar legível, o ranking tem o MESMO top 15 da tabela e do gráfico.
  const lista=ehBanco?linhasImagem:rankingParaCompartilhar();
  if(!lista.length)throw Error(ehBanco?'Não há funcionários com os três saldos válidos para compartilhar. Confira a sincronização.':'Não há registros para compartilhar.');
  const canvas=document.createElement('canvas');
  const ctx=canvas.getContext('2d');
  if(!ctx)throw Error('Seu navegador não oferece suporte à geração de imagens.');
  function cortarTexto(s,largura){let t=String(s);while(t.length>2&&ctx.measureText(t).width>largura)t=t.slice(0,-2)+'…';return t;}
  function nomeEmLinhas(nome,largura,maxLinhas=2){
    const palavras=String(nome).trim().split(/\s+/).filter(Boolean),linhas=[''];
    for(const p of palavras){
      const atual=linhas.length-1,teste=(linhas[atual]?linhas[atual]+' ':'')+p;
      if(linhas[atual]&&ctx.measureText(teste).width>largura){linhas.push(p);}else{linhas[atual]=teste;}
    }
    if(linhas.length>maxLinhas){
      const primeira=linhas[0],restante=linhas.slice(1).join(' ');
      return [primeira,cortarTexto(restante,largura)];
    }
    return linhas;
  }
  if(ehBanco){
    const margem=16,topo=16,scale=2;
    const widths=[390,124,124,124,104];
    const colTotal=widths.reduce((a,b)=>a+b,0);
    const headerH=46,cabH=50,grupoH=26,rowH=31;
    const totalRows=grupos.reduce((s,g)=>s+g.linhas.length,0);
    // A imagem termina junto da tabela: sem legendas nem faixa branca de rodapé.
    // Contar também os espaçamentos de 10px entre os grupos para não cortar linhas.
    const separadores=Math.max(0,grupos.length-1)*10;
    const h=topo+headerH+cabH+grupos.length*grupoH+totalRows*rowH+separadores+margem;
    const logicalW=margem*2+colTotal, logicalH=h;
    canvas.width=logicalW*scale;canvas.height=logicalH*scale;
    canvas.style.width=logicalW+'px';canvas.style.height=logicalH+'px';
    ctx.scale(scale,scale);
    const W=logicalW;
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,h);
    ctx.strokeStyle='#1f1f1f';ctx.lineWidth=1;ctx.strokeRect(0.5,0.5,W-1,h-1);
    ctx.fillStyle='#3d3a3a';ctx.fillRect(0,0,W,headerH);
    ctx.fillStyle='#ffffff';ctx.font='700 22px Arial';ctx.textAlign='center';
    ctx.fillText(`SALDOS ${periodo.referencia.inicio} ATÉ ${periodo.referencia.fim}`,W/2,29);
    const x0=margem,y0=topo+headerH;
    ctx.fillStyle='#3d3a3a';ctx.fillRect(x0,y0,colTotal,cabH);
    const titles=['Funcionário',`SALDO\n${mesDoRelatorio(0)}`,`SALDO\n${mesDoRelatorio(-1)}`,`SALDO\n${mesDoRelatorio(-2)}`,'Dias de\nFolga'];
    let xx=x0;
    ctx.textAlign='center';
    for(let i=0;i<titles.length;i++){
      ctx.strokeStyle='#1f1f1f';ctx.strokeRect(xx+0.5,y0+0.5,widths[i],cabH);
      ctx.fillStyle='#ffffff';
      const parts=titles[i].split('\n');
      if(i===0){ctx.font='700 19px Arial';ctx.fillText(parts[0],xx+widths[i]/2,y0+31);}else{ctx.font='700 12px Arial';ctx.fillText(parts[0],xx+widths[i]/2,y0+19);ctx.font='700 21px Arial';ctx.fillText(parts[1],xx+widths[i]/2,y0+38);} 
      xx+=widths[i];
    }
    let y=y0+cabH;
    ctx.textAlign='left';
    for(const grupo of grupos){
      ctx.fillStyle='#f0f0f0';ctx.fillRect(x0,y,colTotal,grupoH);
      ctx.strokeStyle='#9f9f9f';ctx.strokeRect(x0+0.5,y+0.5,colTotal,grupoH);
      ctx.fillStyle='#3b3b3b';ctx.font='700 12px Arial';
      ctx.fillText(grupo.nome,y===y0+cabH?x0+8:x0+8,y+16);
      y+=grupoH;
      for(const r of grupo.linhas){
        const destaque=r.dias!==null&&r.dias>0;
        ctx.fillStyle=destaque?'#ffef57':'#ffffff';ctx.fillRect(x0,y,colTotal,rowH);
        ctx.strokeStyle='#c8c8c8';ctx.strokeRect(x0+0.5,y+0.5,colTotal,rowH);
        let pos=x0;
        // nome
        ctx.fillStyle='#1f1f1f';ctx.font='700 12px Arial';
        const nomeLinhas=nomeEmLinhas(r.nome,widths[0]-10,2);
        if(nomeLinhas.length===1)ctx.fillText(cortarTexto(nomeLinhas[0],widths[0]-10),pos+6,y+19);
        else {ctx.fillText(cortarTexto(nomeLinhas[0],widths[0]-10),pos+6,y+13);ctx.fillText(cortarTexto(nomeLinhas[1],widths[0]-10),pos+6,y+25);}
        pos+=widths[0];
        const ordem=[2,1,0];
        ordem.forEach((idx,colIdx)=>{
          const m=r.mesesResumo[idx];
          const txt=m.min===null?' - ':horas(m.min);
          ctx.fillStyle=m.min===null?'#666666':m.min<0?'#c62828':m.min>0?'#0b8f3e':'#333333';
          ctx.font='700 12px Arial';ctx.textAlign='center';
          ctx.fillText(txt,pos+widths[colIdx+1]/2,y+19);
          pos+=widths[colIdx+1];
        });
        ctx.textAlign='center';
        ctx.fillStyle=destaque?'#000000':'#2d2d2d';ctx.font='700 17px Arial';
        ctx.fillText(r.dias===null?'':String(r.dias),pos+widths[4]/2,y+20);
        ctx.textAlign='left';
        y+=rowH;
      }
      if(grupo!==grupos[grupos.length-1]){ctx.fillStyle='#f6f6f6';ctx.fillRect(x0,y,colTotal,10);y+=10;}
    }
    return canvas;
  }
  const W=1500, margem=52,inicioY=230,rowH=60,cabH=48,h=Math.max(530,inicioY+cabH+rowH*lista.length+160);
  canvas.width=W;canvas.height=h;
  ctx.fillStyle='#f5f8fb';ctx.fillRect(0,0,W,h);
  ctx.fillStyle='#1f4e78';ctx.fillRect(0,0,W,130);
  ctx.fillStyle='#fff';ctx.font='700 33px Arial';ctx.fillText('TRANSMARINA  |  GESTÃO DE PONTO',margem,57);
  ctx.font='21px Arial';ctx.fillText('RANKING DE CARTAS DE PONTO',margem,97);
  ctx.fillStyle='#152f45';ctx.font='700 28px Arial';
  const subtitulo=$('filtro-relatorio-mes').value?$('filtro-relatorio-mes').value.slice(5,7)+'/'+$('filtro-relatorio-mes').value.slice(0,4):'TODO O HISTÓRICO';
  ctx.fillText(subtitulo,margem,173);
  ctx.fillStyle='#596c80';ctx.font='20px Arial';ctx.fillText(`TOP ${lista.length} — funcionários com mais cartas`,margem,205);
  const x0=margem,y0=inicioY,widths=[120,1050,226],titles=['POSIÇÃO','FUNCIONÁRIO','CARTAS'];
  ctx.fillStyle='#dce9f5';ctx.fillRect(x0,y0,W-2*margem,cabH);
  let xx=x0;
  titles.forEach((titulo,i)=>{ctx.fillStyle='#274d71';ctx.font='700 16px Arial';ctx.fillText(titulo,xx+12,y0+30);xx+=widths[i];});
  let y=y0+cabH;
  lista.forEach((r,i)=>{
    ctx.fillStyle=i%2===0?'#fff':'#edf3f8';ctx.fillRect(x0,y,W-2*margem,rowH);
    ctx.fillStyle='#172e43';ctx.font='700 18px Arial';
    ctx.fillText(`${i+1}º`,x0+15,y+36);
    ctx.fillText(cortarTexto(r.nome,1010),x0+135,y+26);
    ctx.fillStyle='#66798b';ctx.font='15px Arial';
    ctx.fillText(detalharCartas(r),x0+135,y+48);
    ctx.fillStyle='#0b735a';ctx.font='700 27px Arial';ctx.fillText(String(r.total),x0+1190,y+38);
    y+=rowH;
  });
  const footer=y+38;
  ctx.fillStyle='#657689';ctx.font='20px Arial';ctx.fillText('Total por funcionário = cartas normais + cartas (FALTA).',margem,footer);
  return canvas;
}
async function obterBlobPNG(canvas){return new Promise((ok,erro)=>canvas.toBlob(blob=>blob?ok(blob):erro(Error('Falha ao gerar PNG.')),'image/png'));}
async function compartilharImagem(tipo,modo='compartilhar'){
  try{
    const canvas=construirImagemResumo(tipo),blob=await obterBlobPNG(canvas);
    const nome=tipo==='banco'?'transmarina_resumo_banco_horas.png':'transmarina_ranking_cartas.png';
    if(modo==='compartilhar'&&navigator.share&&navigator.canShare){
      const arquivo=new File([blob],nome,{type:'image/png'});
      if(navigator.canShare({files:[arquivo]})){
        try{await navigator.share({files:[arquivo],title:'Gestão de Ponto — Transmarina'});return;}
        catch(e){if(e.name==='AbortError')return;}
      }
    }
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=nome;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),5000);
    if(modo==='compartilhar')showMessage('Imagem PNG gerada. Você pode enviá-la no grupo pelo WhatsApp ou outro aplicativo.','Imagem pronta');
  }catch(e){showMessage(e.message,'Não foi possível gerar a imagem',true);}
}

function onClickDelegado(e) {
  const reenviar=e.target.closest('.tm-repetir-carta');
  if(reenviar){e.preventDefault();reenviarCartaPendente(reenviar.dataset.id);return;}

  const editar=e.target.closest('.carta-editar');if(editar){const carta=APP.cartas.find(c=>c.id===editar.dataset.id);if(carta)definirModoCarta(carta);return;}
  const excluir=e.target.closest('.carta-excluir');if(excluir){
    const carta=APP.cartas.find(c=>c.id===excluir.dataset.id);
    if(!carta){showMessage('Carta não encontrada. Atualize o histórico.','Aviso',true);return;}
    confirmarExclusaoCarta(carta.funcionario).then(confirmou=>{
      if(confirmou)comBotaoCarregando(excluir,()=>excluirCarta(carta.id),'Excluindo…');
    });
    return;
  }
  const confirmarAviso=e.target.closest('.tm-aviso-confirmar-assinatura');
  if(confirmarAviso)return comBotaoCarregando(confirmarAviso,
    ()=>confirmarCarta(confirmarAviso.dataset.id,true,confirmarAviso.dataset.acao),
    'Confirmando…');
  const reimpOk=e.target.closest('.tm-reimpressao-ok');
  if(reimpOk)return comBotaoCarregando(reimpOk,()=>concluirReimpressao(reimpOk.dataset.id),'Salvando…');
  const novoControle=e.target.closest('.tm-enc-registrar');
  if(novoControle)return comBotaoCarregando(novoControle,()=>registrarAcaoCartaEncarregado(novoControle.dataset.id,novoControle.dataset.status),'Registrando…');
  const atribuir=e.target.closest('.carta-assinar-atribuir');
  if(atribuir)return comBotaoCarregando(atribuir,()=>confirmarCarta(atribuir.dataset.id,true),'Confirmando e atribuindo…');
  const assinar=e.target.closest('.carta-assinar');
  if(assinar)return comBotaoCarregando(assinar,()=>confirmarCarta(assinar.dataset.id,false),'Confirmando…');
  const folga=e.target.closest('.folga-status');if(folga)return comBotaoCarregando(folga,()=>mudarStatusFolga(folga.dataset.id,folga.dataset.status),'Salvando…');
  const planejar=e.target.closest('.acao-planejar');
  if(planejar) {try{preencherPlanejamento(JSON.parse(decodeURIComponent(planejar.dataset.employee)));}catch(e){showMessage('Não foi possível selecionar o funcionário.','Erro',true);}}
}
// A área de cartas não tinha um botão próprio de atualização.
function instalarAtualizacaoDeCartas(){
  const cabecalho=document.querySelector('#sec-cartas > .section-header');
  if(!cabecalho||$('btn-atualizar-cartas'))return;
  const acoes=document.createElement('div');acoes.className='actions';
  const botao=document.createElement('button');botao.type='button';botao.id='btn-atualizar-cartas';
  botao.className='btn secondary';botao.textContent='Atualizar cartas';
  botao.title='Recarregar as cartas da planilha, inclusive as assinaturas';
  acoes.appendChild(botao);cabecalho.appendChild(acoes);
  botao.addEventListener('click',()=>comBotaoCarregando(botao,async()=>{
    const [cartas,acoes]=await Promise.all([carregarCartas(),carregarAcoesCartas()]);
    return cartas&&acoes;
  },'Atualizando cartas…','Cartas de ponto atualizadas.'));
}
// Sugestões próprias para que Enter selecione o nome, sem submeter o formulário.
const fecharSugestoesCarta=[];
// V31.12.3 — restaurar lista de colaboradores com nome + empresa na carta.
// Priorizamos FUNCIONARIOS/MobPonto, com histórico de cartas como reserva.
let funcionarioCartaSelecionado=null;
function colaboradoresParaSugestaoCarta() {
  const unicos=new Map();
  for(const f of [...funcionariosParaFolga(),...APP.cartas.map(c=>({
    nome:separarNomeCarta(c.funcionario).nomeBase,empresa:c.empresa||''
  }))]) {
    const nome=String(f?.nome||'').trim(),empresa=String(f?.empresa||'').trim();
    // Não mostrar cadastros incompletos vindos de cartas históricas.
    // O cadastro atual do MobPonto tem prioridade; cartas antigas só
    // complementam a lista quando têm uma empresa de fato informada.
    if(!nome||!empresa)continue;
    const chave=norm(nome)+'|'+norm(empresa);
    if(!unicos.has(chave))unicos.set(chave,{nome,empresa});
  }
  return [...unicos.values()];
}
function configurarSugestaoCarta(idInput,idLista,obterValores,aposSelecionar=()=>{}) {
  const campo=$(idInput),lista=$(idLista);
  const eFuncionario=idInput==='carta-funcionario';
  let opcoes=[],indice=0;
  function fechar() {
    lista.hidden=true;lista.replaceChildren();opcoes=[];
    campo.setAttribute('aria-expanded','false');campo.removeAttribute('aria-activedescendant');
  }
  fecharSugestoesCarta.push(fechar);
  function marcarAtiva() {
    [...lista.children].forEach((item,i)=>{
      const ativa=i===indice;
      item.classList.toggle('ativa',ativa);
      item.setAttribute('aria-selected',String(ativa));
    });
    if(opcoes.length)campo.setAttribute('aria-activedescendant',`${idLista}-op-${indice}`);
    lista.children[indice]?.scrollIntoView({block:'nearest'});
  }
  function selecionar(i) {
    const escolhido=opcoes[i];if(!escolhido)return;
    if(eFuncionario) {
      // Empresa escolhida é preservada inclusive para homônimos entre filiais.
      funcionarioCartaSelecionado={nome:escolhido.nome,empresa:escolhido.empresa};
      campo.value=formatarNomeCarta(escolhido.nome,separarNomeCarta(campo.value).falta);
    } else campo.value=escolhido;
    campo.dispatchEvent(new Event('input',{bubbles:true}));
    campo.dispatchEvent(new Event('change',{bubbles:true}));
    fechar();aposSelecionar();
    campo.focus({preventScroll:true});
  }
  function atualizar() {
    const nomeDigitado=eFuncionario?separarNomeCarta(campo.value):{nomeBase:campo.value};
    const busca=norm(nomeDigitado.nomeBase);
    if(!busca){fechar();return;}
    if(eFuncionario) {
      const todos=colaboradoresParaSugestaoCarta();
      const exatos=todos.filter(f=>norm(f.nome)===busca);
      opcoes=todos.filter(f=>(norm(f.nome).includes(busca)||norm(f.empresa+' '+f.nome).includes(busca))&&
        (norm(f.nome)!==busca||exatos.length>1))
        .sort((a,b)=>(norm(a.nome).startsWith(busca)?0:1)-(norm(b.nome).startsWith(busca)?0:1)||
          a.nome.localeCompare(b.nome,'pt-BR')||a.empresa.localeCompare(b.empresa,'pt-BR'))
        .slice(0,8);
      if(!opcoes.length){fechar();return;}
      lista.innerHTML=opcoes.map((f,i)=>`<div class="carta-sugestao-item" id="${idLista}-op-${i}" role="option" aria-selected="${i===0}" data-index="${i}"><strong style="display:inline-block;margin-right:12px;vertical-align:middle;">${esc(f.nome)}</strong><small style="display:inline-block;vertical-align:middle;color:#5f6f86;font-weight:600;letter-spacing:.01em;">${esc(f.empresa)}</small></div>`).join('');
    } else {
      opcoes=[...new Map(obterValores().filter(Boolean).map(nome=>[norm(nome),nome])).values()]
        .filter(nome=>norm(nome).includes(busca)&&norm(nome)!==busca)
        .sort((a,b)=>(norm(a).startsWith(busca)?0:1)-(norm(b).startsWith(busca)?0:1)||a.localeCompare(b,'pt-BR'))
        .slice(0,8);
      if(!opcoes.length){fechar();return;}
      lista.innerHTML=opcoes.map((nome,i)=>`<div class="carta-sugestao-item" id="${idLista}-op-${i}" role="option" aria-selected="${i===0}" data-index="${i}">${esc(nome)}</div>`).join('');
    }
    indice=0;
    lista.hidden=false;campo.setAttribute('aria-expanded','true');marcarAtiva();
  }
  campo.addEventListener('input',e=>{
    // Ao alterar o nome manualmente, remover vínculo com sugestão anterior.
    if(eFuncionario&&e.isTrusted)funcionarioCartaSelecionado=null;
    atualizar();
  });
  campo.addEventListener('focus',atualizar);
  campo.addEventListener('keydown',e=>{
    if(e.isComposing||e.key==='Process')return;
    if(e.key==='Escape'&&!lista.hidden){e.preventDefault();e.stopPropagation();fechar();return;}
    if((e.key==='ArrowDown'||e.key==='ArrowUp')&&!lista.hidden){
      e.preventDefault();e.stopPropagation();
      indice=(indice+(e.key==='ArrowDown'?1:-1)+opcoes.length)%opcoes.length;
      marcarAtiva();return;
    }
    if(e.key==='Enter'&&!lista.hidden&&opcoes.length){
      e.preventDefault();e.stopPropagation();selecionar(indice);
    }
  });
  lista.addEventListener('pointerdown',e=>{
    const item=e.target.closest('.carta-sugestao-item');
    if(!item)return;
    e.preventDefault();selecionar(Number(item.dataset.index));
  });
  campo.addEventListener('blur',()=>{setTimeout(()=>{if(document.activeElement!==campo)fechar();},0);});
}
function prepararMascaraHora(input,padrao='07:20') {
  if(!input)return;
  const formatar=valor=>{
    const digitos=String(valor??'').replace(/\D/g,'').slice(0,4);
    if(!digitos)return '';
    if(digitos.length<=2)return digitos;
    return digitos.slice(0,digitos.length-2)+':'+digitos.slice(-2);
  };
  const normalizar=valor=>{
    const texto=formatar(valor);
    if(!texto)return padrao;
    if(!texto.includes(':'))return `${texto.padStart(2,'0')}:00`;
    let [h,m]=texto.split(':');
    h=h.padStart(2,'0').slice(-2);
    m=(m||'').padEnd(2,'0').slice(0,2);
    const min=Math.min(59,Math.max(0,Number(m)||0));
    return `${h}:${String(min).padStart(2,'0')}`;
  };
  input.setAttribute('inputmode','numeric');
  input.setAttribute('placeholder',padrao);
  input.addEventListener('input',()=>{
    const anterior=input.selectionStart||input.value.length;
    const tamanhoAnterior=input.value.length;
    input.value=formatar(input.value);
    const ajuste=input.value.length-tamanhoAnterior;
    const pos=Math.max(0,anterior+ajuste);
    try{input.setSelectionRange(pos,pos);}catch(_){ }
  });
  input.addEventListener('blur',()=>{input.value=normalizar(input.value);});
  input.addEventListener('focus',()=>{if(!input.value.trim())input.value=padrao;});
}
function prepararCamposFormularioFolga() {
  const horas=$('folga-horas'),obs=$('folga-obs');
  if(horas){
    horas.value=horas.value.trim()||'07:20';
    horas.setAttribute('placeholder','07:20');
  }
  if(obs)obs.setAttribute('placeholder','Banco de Horas');
}

function configurarEnterEntreCamposCarta(idFormulario='form-carta',idBotao='btn-salvar-carta') {
  const form=$(idFormulario);
  // Enter em texto/select/data avança, somente o clique em Salvar (ou foco nele + Enter) grava.
  form.addEventListener('keydown',e=>{
    if(e.key!=='Enter'||e.isComposing||e.ctrlKey||e.metaKey||e.altKey)return;
    const atual=e.target;
    // No cadastro/edição de cartas, Enter nas observações avança até Salvar;
    // Shift+Enter mantém a quebra de linha. Nunca envia ao pressionar Enter no texto.
    if(idFormulario==='form-carta' && atual.id==='carta-obs'){
      if(e.shiftKey)return;
      e.preventDefault();
      $(idBotao).focus();
      return;
    }
    if(!atual.matches('input,select')||atual.type==='submit')return;
    e.preventDefault();
    const campos=[...form.querySelectorAll('input,select,textarea')]
      .filter(c=>!c.disabled&&c.tabIndex!==-1&&c.getClientRects().length);
    const proximo=campos[campos.indexOf(atual)+1]||$(idBotao);
    proximo.focus();
  });
}
function registrarEventos() {
  instalarAtualizacaoDeCartas();
  $('form-login').addEventListener('submit',e=>{e.preventDefault();comBotaoCarregando($('botao-login'),()=>login(e),'Entrando no sistema…');});
  configurarAcessoEmail();
  configurarGestaoUsuarios();
  $('msg-fechar').addEventListener('click',fecharMensagem);
  $('btn-sair').addEventListener('click',()=>comBotaoCarregando($('btn-sair'),logout,'Saindo…'));
  document.querySelectorAll('.nav-button').forEach(b=>b.addEventListener('click',()=>escolherAba(b.dataset.tab)));
  document.querySelectorAll('.subnav-btn').forEach(b=>b.addEventListener('click',()=>escolherSubaba(b.dataset.sub)));
  $('btn-recarregar-horas').addEventListener('click',()=>comBotaoCarregando($('btn-recarregar-horas'),carregarSaldos,'Atualizando painel…','Painel atualizado com os últimos dados salvos.'));
  $('enc-recarregar-horas').addEventListener('click',()=>comBotaoCarregando($('enc-recarregar-horas'),carregarSaldos,'Atualizando lista…','Lista de funcionários atualizada.'));
  $('enc-busca-funcionario').addEventListener('input',renderFolgasEncarregado);
  $('btn-sincronizar').addEventListener('click',sincronizar);
  ['filtro-horas','filtro-empresa-horas','filtro-saldo'].forEach(id=>$(id).addEventListener(id==='filtro-horas'?'input':'change',renderSaldos));
  $('form-folga').addEventListener('submit',e=>{e.preventDefault();comBotaoCarregando($('salvar-folga'),()=>salvarFolga(e),'Salvando folga…');});
  $('filtro-folga-status').addEventListener('change',renderFolgas);
  $('filtro-controle-enc').addEventListener('change',renderPendentes);
  $('busca-cartas-pendentes').addEventListener('input',renderPendentes);
  $('ordenar-cartas-pendentes').addEventListener('change',renderPendentes);
  $('form-carta').addEventListener('submit',e=>{e.preventDefault();if(APP.cartaEditando)comBotaoCarregando($('btn-salvar-carta'),()=>salvarCarta(e),'Salvando alterações…');else salvarCarta(e);});
  ['filtro-cartas','filtro-cartas-status','filtro-cartas-mes'].forEach(id=>$(id).addEventListener(id==='filtro-cartas'?'input':'change',renderCartas));
  $('limpar-filtro-cartas').addEventListener('click',()=>{$('filtro-cartas').value='';$('filtro-cartas-status').value='';$('filtro-cartas-mes').value='';renderCartas();});
  ['filtro-capa','filtro-capa-mes'].forEach(id=>$(id).addEventListener(id==='filtro-capa'?'input':'change',renderCapa));
  $('check-todas-capa').addEventListener('change',e=>{
    for(const c of cartasCapaFiltradas().slice(0,250))
      if(e.target.checked)APP.selecionadas.add(c.id);else APP.selecionadas.delete(c.id);
    ultimaCartaCapaMarcada=null;
    renderCapa();
  });
  // A tecla Shift é informada pelo evento click, não pelo change da checkbox.
  // Preservar esse dado na própria caixa até a mudança efetiva do estado.
  $('tbody-capa').addEventListener('click',e=>{
    const caixa=e.target.closest?.('.check-capa');
    if(caixa)caixa.dataset.selecionarIntervalo=e.shiftKey?'1':'0';
  });
  $('tbody-capa').addEventListener('change',e=>{
    if(!e.target.matches('.check-capa'))return;
    alterarSelecaoCapa(e.target.dataset.id,e.target.checked,e.target.dataset.selecionarIntervalo==='1');
  });
  $('selecionar-visiveis').addEventListener('click',()=>{
    cartasCapaFiltradas().slice(0,250).forEach(c=>APP.selecionadas.add(c.id));
    ultimaCartaCapaMarcada=null;
    renderCapa();
  });
  $('limpar-selecao').addEventListener('click',()=>{
    APP.selecionadas.clear();
    ultimaCartaCapaMarcada=null;
    renderCapa();
  });
  $('imprimir-capa').addEventListener('click',imprimirCapa);
  $('filtro-relatorio-mes').addEventListener('change',renderRelatorios);
  $('relatorio-todos').addEventListener('click',()=>{$('filtro-relatorio-mes').value='';renderRelatorios();});
  $('resumo-empresa').addEventListener('change',renderResumoBanco);
  $('resumo-busca').addEventListener('input',renderResumoBanco);
  $('baixar-resumo').addEventListener('click',()=>comBotaoCarregando($('baixar-resumo'),()=>compartilharImagem('banco','baixar'),'Gerando PNG…'));
  $('compartilhar-resumo').addEventListener('click',()=>comBotaoCarregando($('compartilhar-resumo'),()=>compartilharImagem('banco'),'Preparando imagem…'));
  $('baixar-ranking').addEventListener('click',()=>comBotaoCarregando($('baixar-ranking'),()=>compartilharImagem('ranking','baixar'),'Gerando PNG…'));
  $('compartilhar-ranking').addEventListener('click',()=>comBotaoCarregando($('compartilhar-ranking'),()=>compartilharImagem('ranking'),'Preparando imagem…'));
  $('btn-recarregar-pendentes').addEventListener('click',()=>comBotaoCarregando($('btn-recarregar-pendentes'),carregarPendentes,'Atualizando pendentes…','Cartas pendentes atualizadas.'));
  document.addEventListener('click',onClickDelegado);
  configurarSugestaoFolga();
  prepararCamposFormularioFolga();
  configurarBancoHorasUI();
  prepararMascaraHora($('folga-horas'),'07:20');
  configurarEnterEntreCamposCarta('form-folga','salvar-folga');
  configurarCampoDataBR('folga-data');
  $('carta-funcionario').addEventListener('input',atualizarEmpresaCarta);
  $('carta-funcionario').addEventListener('change',atualizarEmpresaCarta);
  configurarSugestaoCarta('carta-funcionario','carta-sugestoes-funcionario',()=>[
    ...APP.funcionarios.map(f=>f.nome),...APP.saldos.map(f=>f.nome)
  ],atualizarEmpresaCarta);
  configurarSugestaoCarta('carta-responsavel','carta-sugestoes-responsavel',()=>APP.cartas.map(c=>c.responsavel));
  $('carta-responsavel').addEventListener('input',()=>{
    estadoSugestaoCarta.editadoManualmente=true;
    aplicarAprendizadoResponsavelCarta();
  });
  configurarEnterEntreCamposCarta();
  $('btn-cancelar-edicao-carta').addEventListener('click',()=>definirModoCarta());
  ['carta-ocorrencia','carta-correcao'].forEach(configurarCampoDataBR);
}
// V31 — no celular as tabelas viram cartões; cada célula recebe o nome da coluna.
function rotularTabelasCartoes() {
  document.querySelectorAll('table.tabela-cartoes').forEach(tabela=>{
    const cab=[...tabela.querySelectorAll('thead th')].map(th=>th.textContent.trim());
    tabela.querySelectorAll('tbody tr').forEach(tr=>{
      if(tr.dataset.rotulado==='1')return;
      tr.dataset.rotulado='1';
      if(tr.children.length!==cab.length)return; // linhas de aviso (colspan)
      [...tr.children].forEach((td,i)=>{td.dataset.label=cab[i];});
    });
  });
}
function instalarRotulosDeTabela() {
  let agendado=false;
  const rodar=()=>{if(agendado)return;agendado=true;requestAnimationFrame(()=>{agendado=false;rotularTabelasCartoes();});};
  const observador=new MutationObserver(rodar);
  document.querySelectorAll('table.tabela-cartoes tbody').forEach(tb=>observador.observe(tb,{childList:true}));
  rodar();
}
document.addEventListener('DOMContentLoaded',()=>{
  instalarRotulosDeTabela();
  prepararFilaCartas();
  registrarEventos();definirModoCarta();$('filtro-relatorio-mes').value=mesAtual();
  // Novas solicitações de reimpressão e assinaturas aparecem no painel do ADM sem exigir F5.
  setInterval(()=>{if(APP.sessao?.perfil==='ADM'&&APP.aba==='cartas'&&APP.subaba==='controle'&&!document.hidden)carregarAcoesCartas();},45000);
  // A faixa de meses é definida pelos dados efetivamente sincronizados em renderResumoBanco().
  setInterval(()=>{if(APP.sessao&&APP.sessao.dataLogin!==diaSessaoBrasil())encerrarSessaoLocal();},20000);
  // Encarregado: 2ª vias concluídas pelo ADM aparecem sem precisar clicar em Atualizar.
  setInterval(()=>{if(APP.sessao?.perfil==='ENCARREGADO'&&APP.aba==='pendentes'&&!document.hidden)carregarPendentes();},60000);
  verificarSessao();
});

// Se o navegador permitir, avisa sobre envios que ainda não foram confirmados.
window.addEventListener('beforeunload',e=>{
  if(!filaCartasDaConta().length)return;
  e.preventDefault();e.returnValue='';
});



// V31.6 — Extrato MobPonto por empresa, funcionários e intervalo multianual.
// Nenhuma chamada desta tela grava movimentos no banco de horas ou no MobPonto.
const EB={pessoas:[],selecionados:new Set(),extratos:[],anoAtual:new Date().getFullYear(),
  carregandoOpcoes:false,opcoesCarregadas:false,pendente:false,resultado:null};
const EB_MESES=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
function ebAtivosFiltrados(){
  const empresa=$('eb-empresa').value,termo=norm($('eb-busca').value);
  return EB.pessoas.filter(p=>(!empresa||p.empresa===empresa)&&(!termo||norm(p.nome).includes(termo)));
}
function ebAtualizarContagem(){
  const visiveis=EB.pessoas.filter(p=>!$('eb-empresa').value||p.empresa===$('eb-empresa').value);
  const n=visiveis.filter(p=>EB.selecionados.has(p.id)).length;
  $('eb-contador').textContent=n+' selecionado(s) de '+visiveis.length;
}
function ebRenderLista(){
  const pessoas=ebAtivosFiltrados(),box=$('eb-lista');box.replaceChildren();
  if(!pessoas.length){const p=document.createElement('p');p.className='empty';p.textContent='Nenhum funcionário ativo corresponde ao filtro.';box.appendChild(p);}
  pessoas.forEach(p=>{
    const label=document.createElement('label'),input=document.createElement('input'),nome=document.createElement('span');
    input.type='checkbox';input.value=p.id;input.checked=EB.selecionados.has(p.id);
    input.setAttribute('aria-label','Selecionar '+p.nome+' — '+p.empresa);
    input.addEventListener('change',()=>{if(input.checked)EB.selecionados.add(p.id);else EB.selecionados.delete(p.id);ebAtualizarContagem();ebLimparResultados();});
    nome.textContent=p.nome+($('eb-empresa').value?'':' — '+p.empresa);
    label.append(input,nome);box.appendChild(label);
  });
  ebAtualizarContagem();
}
function ebTrocarEmpresa(){
  // Seleção é exclusiva da empresa escolhida, para impedir mistura acidental.
  EB.selecionados.clear();ebRenderLista();ebLimparResultados();
}
function ebLimparResultados(){
  EB.extratos=[];EB.resultado=null;$('eb-resultados').replaceChildren();
  $('eb-csv').disabled=true;$('eb-imprimir').disabled=true;
}
async function ebCarregarOpcoes(){
  if(EB.carregandoOpcoes)return;
  EB.carregandoOpcoes=true;
  try{
    const r=await api('getOpcoesExtratoBanco');
    EB.pessoas=r.dados.pessoas||[];EB.anoAtual=r.dados.anoAtual||EB.anoAtual;
    for(const id of ['eb-ano-inicial','eb-ano-final']){
      $(id).max=String(EB.anoAtual);
      if(!$(id).value)$(id).value=String(EB.anoAtual);
    }
    const selecao=$('eb-empresa'),atual=selecao.value;
    selecao.replaceChildren(new Option('Todas as empresas',''));
    [...new Set(EB.pessoas.map(p=>p.empresa))].sort((a,b)=>a.localeCompare(b,'pt-BR'))
      .forEach(e=>selecao.add(new Option(e,e)));
    if([...selecao.options].some(o=>o.value===atual))selecao.value=atual;
    EB.opcoesCarregadas=true;ebRenderLista();
    $('eb-estado').textContent=EB.pessoas.length+' vínculo(s) ativo(s) no cadastro. Histórico de empresas anteriores não é exibido.';
  }catch(e){$('eb-estado').textContent='Erro ao carregar funcionários: '+e.message;throw e;}
  finally{EB.carregandoOpcoes=false;}
}
function ebAoAbrir(){if(!EB.opcoesCarregadas)ebCarregarOpcoes().catch(()=>{});}
function ebSelecionarTodos(){
  // Seleciona TODOS da empresa, inclusive os que não aparecem no campo de busca.
  const empresa=$('eb-empresa').value;
  EB.pessoas.filter(p=>!empresa||p.empresa===empresa).forEach(p=>EB.selecionados.add(p.id));
  ebRenderLista();ebLimparResultados();
}
function ebMinutos(v){const m=String(v||'').match(/^([+-]?)(\d{1,5}):([0-5]\d)$/);return m?(m[1]==='-'?-1:1)*(Number(m[2])*60+Number(m[3])):null;}
function ebFormatarMinutos(n,sinal=false){if(!Number.isFinite(n))return '—';const z=Math.abs(n);return (n<0?'-':sinal&&n>0?'+':'')+String(Math.floor(z/60)).padStart(2,'0')+':'+String(z%60).padStart(2,'0');}
function ebSomarCampo(meses,campo,sinal){
  // Soma apenas dados realmente válidos dentro do vínculo atual; meses
  // anteriores à admissão e respostas ausentes nunca viram zero fictício.
  const valores=meses.filter(r=>!r.foraDoVinculo).map(r=>ebMinutos(r[campo])).filter(v=>v!==null);
  return valores.length?ebFormatarMinutos(valores.reduce((a,b)=>a+b,0),sinal):'—';
}
function ebClasseSaldo(s){return s.startsWith('-')?'eb-negativo':s.startsWith('+')?'eb-positivo':s==='SEM DADOS'?'eb-sem-dados':'';}
function ebDataLeitura(valor){
  const m=String(valor||'').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m?m[3]+'/'+m[2]+'/'+m[1]:String(valor||'');
}
function ebTabelaHTML(extrato){
  const linhas=extrato.meses.map(r=>{
    const mes=EB_MESES[Number(r.mes.slice(0,2))-1]+'/'+r.mes.slice(3);
    const campos=['previsto','trabalhado','extra','extraFds','adn','saldo'];
    // Avisos de auditoria não integram o demonstrativo apresentado/impresso.
    // As versões e a indicação houveAlteracao continuam preservadas no backend.
    if(r.foraDoVinculo)return '<tr><td>'+esc(mes)+'</td>'+campos.map(()=>'<td class="eb-sem-dados">—</td>').join('')+
      '<td class="eb-anotacao-vazia">Anterior à admissão no vínculo atual</td></tr>';
    return '<tr><td>'+esc(mes)+'</td>'+campos.map(c=>'<td class="'+ebClasseSaldo(r[c])+'">'+esc(r[c]||'SEM DADOS')+'</td>').join('')+
      '<td class="'+(r.anotacao?'':'eb-anotacao-vazia')+'"'+(r.anotacaoCapturadaEm?
      ' title="Anotação arquivada em '+esc(ebDataLeitura(r.anotacaoCapturadaEm))+'"':'')+'>'+esc(r.anotacao||'Sem anotação arquivada')+'</td></tr>';
  }).join('');
  const soma=['previsto','trabalhado','extra','extraFds','adn','saldo'].map((c,i)=>'<td>'+esc(ebSomarCampo(extrato.meses,c,i>=2&&i!==4))+'</td>').join('');
  const parciais=extrato.meses.some(r=>!r.foraDoVinculo&&
    ['previsto','trabalhado','extra','extraFds','adn','saldo'].some(k=>ebMinutos(r[k])===null));
  const primeiroVinculo=extrato.admissao?'Admissão neste vínculo: '+ebDataLeitura(extrato.admissao):
    'Data de admissão não informada pelo MobPonto; confirme antes de usar os totais';
  return '<article class="eb-extrato"><header><div><span class="eb-kicker">TRANSMARINA / BANCO DE HORAS — REFERÊNCIA HISTÓRICA</span><h4>'+esc(extrato.nome)+
    '</h4><span class="eb-empresa">'+esc(extrato.empresa)+' — '+esc(primeiroVinculo)+'</span></div><span class="eb-etiqueta">Período '+
    esc(extrato.anoInicial===extrato.anoFinal?String(extrato.anoInicial):extrato.anoInicial+'–'+extrato.anoFinal)+'</span></header>'+
    '<div class="eb-tabela-wrap"><table class="eb-tabela"><thead><tr><th>Mês/Ano</th><th>Horas a trabalhar<br>no mês</th><th>Horas<br>trabalhadas</th><th>Extra<br>Seg–Sáb</th><th>Extra<br>Dom/Fer</th><th>Adicional<br>noturno</th><th>Saldo<br>banco</th><th>Anotação</th></tr></thead><tbody>'+linhas+
    '<tr class="eb-total"><td>SOMA DO VÍNCULO ATUAL'+(parciais?' (parcial)':'')+'</td>'+soma+'<td>—</td></tr></tbody></table></div>'+
    '<p class="eb-resumo-aviso">Soma dos meses com leitura no vínculo atual; não é o saldo disponível para folgas.</p></article>';
}
async function ebCarregar(){
  const emp=$('eb-empresa').value;
  const anoInicial=Number($('eb-ano-inicial').value),anoFinal=Number($('eb-ano-final').value);
  if(!Number.isInteger(anoInicial)||!Number.isInteger(anoFinal)||
      anoInicial<2000||anoFinal>EB.anoAtual||anoInicial>anoFinal)
    throw Error('Selecione um intervalo válido: ano inicial até ano final, sem anos futuros.');
  if(anoFinal-anoInicial>5)throw Error('Consulte até 6 anos consecutivos por vez.');
  const ids=EB.pessoas.filter(p=>(!emp||p.empresa===emp)&&EB.selecionados.has(p.id)).map(p=>p.id);
  if(!ids.length)throw Error('Selecione pelo menos um funcionário.');
  $('eb-estado').textContent='Consultando '+ids.length+' funcionário(s)...';ebLimparResultados();
  try{
    const r=await api('getExtratosBanco',{empresa:emp,anoInicial,anoFinal,ids});EB.resultado=r.dados;EB.extratos=r.dados.extratos||[];
    $('eb-resultados').innerHTML=EB.extratos.map(ebTabelaHTML).join('');
    const mesesSem=EB.extratos.reduce((s,x)=>s+x.meses.filter(y=>y.situacao==='SEM LEITURA').length,0);
    $('eb-estado').textContent=EB.extratos.length+' extrato(s) carregado(s) — '+
      (anoInicial===anoFinal?anoInicial:anoInicial+'–'+anoFinal)+'. '+
      (mesesSem?mesesSem+' competência(s) sem leitura. ':'')+
      'Só o vínculo atual entra na soma; meses anteriores à admissão ficam fora. Descrições das anotações são literais, quando disponíveis.';
    $('eb-csv').disabled=!EB.extratos.length;$('eb-imprimir').disabled=!EB.extratos.length;
  }catch(e){$('eb-estado').textContent='Não foi possível carregar: '+e.message;throw e;}
  return true;
}
function ebCSV(){
  if(!EB.extratos.length)throw Error('Carregue os extratos primeiro.');
  const colunas=['Empresa','Funcionário','Ano','Mês/Ano','Horas a trabalhar','Horas trabalhadas','Extra Seg-Sáb',
    'Extra Dom/Fer','Adicional noturno','Saldo de referência histórica','Anotação','Situação',
    'Fonte','Data da primeira leitura','Extra Seg-Sáb na última leitura','Saldo na última leitura','Alteração após referência','Tipo de referência', 'Anotação arquivada em', 'Origem da anotação', 'Admissão vínculo atual'];
  const linhas=[colunas];
  EB.extratos.forEach(e=>e.meses.forEach(r=>linhas.push([e.empresa,e.nome,r.mes.slice(3),r.mes,r.previsto,r.trabalhado,
    r.extra,r.extraFds,r.adn,r.saldo,r.anotacao||'Sem anotação arquivada',r.situacao,r.origem,
    r.referenciaEm||'',r.extraAtual||'',r.saldoAtual||'',r.houveAlteracao?'SIM':'NÃO',r.modoLeitura||'SEM LEITURA',r.anotacaoCapturadaEm||'',r.anotacaoOrigem||'',e.admissao||''])));
  const txt='\ufeffsep=;\r\n'+linhas.map(r=>r.map(ebCSVSeguro).join(';')).join('\r\n');
  const periodo=EB.resultado.anoInicial===EB.resultado.anoFinal?String(EB.resultado.anoInicial):
    EB.resultado.anoInicial+'-'+EB.resultado.anoFinal;
  const nome='Transmarina_Extratos_Banco_Historico_'+periodo+'.csv';
  const blob=new Blob([txt],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=nome;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function ebCSVSeguro(valor){
  let s=String(valor??'');
  if(/^[=+@\-\t\r]/.test(s))s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
}
// Metadados de procedência para a impressão. A referência é a primeira
// captura disponível de cada competência, não necessariamente pré-abatimento.
function ebIntervaloCapturas(extratos){
  const datas=extratos.flatMap(e=>(e.meses||[])
    .map(m=>String(m.referenciaEm||'').trim())
    .filter(d=>/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}:\d{2})?$/.test(d)))
    .sort();
  if(!datas.length)return 'Sem data de leitura arquivada disponível';
  const inicio=ebDataLeitura(datas[0]),fim=ebDataLeitura(datas[datas.length-1]);
  return inicio===fim?inicio:inicio+' a '+fim;
}
function ebImprimir(){
  if(!EB.extratos.length)throw Error('Carregue os extratos primeiro.');
  const popup=window.open('','_blank');if(!popup)throw Error('Permita pop-ups para imprimir os extratos.');
  const periodo=EB.resultado.anoInicial===EB.resultado.anoFinal?String(EB.resultado.anoInicial):
    EB.resultado.anoInicial+'–'+EB.resultado.anoFinal;
  const emitidoEm=new Intl.DateTimeFormat('pt-BR',{
    timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',
    hour:'2-digit',minute:'2-digit',hour12:false
  }).format(new Date());
  // Cada funcionário recebe o próprio rodapé logo após sua tabela.
  // Não há aviso técnico, nem rodapé fixo que empurre o conteúdo à página seguinte.
  const demonstrativos=EB.extratos.map(extrato=>{
    const leitura=ebIntervaloCapturas([extrato]);
    const semLeitura=(extrato.meses||[]).filter(m=>m.situacao==='SEM LEITURA').length;
    const rodape='<footer class="eb-rodape-fonte">'+
      '<div><strong>Fonte dos dados: API do MobPonto — Sistema de Controle de Jornada.</strong> ' +
      'Demonstrativo histórico produzido pelo GESTÃO PONTO — Transmarina (controle interno).</div>'+ 
      '<div>Leituras arquivadas utilizadas: '+esc(leitura)+
      ' &nbsp;|&nbsp; Emitido em: '+esc(emitidoEm)+' (Brasília)'+
      (semLeitura?' &nbsp;|&nbsp; <strong>'+semLeitura+' competência(s) sem leitura; total parcial.</strong>':'')+
      '</div></footer>';
    return ebTabelaHTML(extrato).replace('</article>',rodape+'</article>');
  }).join('');
  // A janela criada pelo navegador não recebe o ponto.css do site.
  // Manter os estilos de impressão neste bloco para funcionar no GitHub Pages.
  const cssImpressao=`
    @page { size: A4 portrait; margin: 9mm 8mm 10mm; }
    *,*::before,*::after { box-sizing: border-box; }
    html,body { padding:0; margin:0; width:100%; }
    body { font: 10px/1.25 Arial,sans-serif; color:#172d40; }
    article.eb-extrato { margin:0; padding:0; border:0; box-shadow:none;
      break-after:page; page-break-after:always; }
    article.eb-extrato:last-of-type { break-after:auto; page-break-after:auto; }
    article.eb-extrato>header { display:flex; align-items:flex-start;
      justify-content:space-between; gap:6px; margin:0 0 5px; padding:0; }
    .eb-kicker { font-size:9px; letter-spacing:.15px; font-weight:800; }
    h4 { font-size:16px; line-height:1.1; margin:2px 0; }
    .eb-empresa { display:block; font-size:10px; line-height:1.2; }
    .eb-etiqueta { font-size:10px; font-weight:800; white-space:nowrap; }
    .eb-tabela-wrap { overflow:visible; width:100%; }
    table.eb-tabela { width:100%; max-width:100%; min-width:0; table-layout:fixed;
      border-collapse:collapse; border-spacing:0; margin:0; font-variant-numeric:tabular-nums; }
    .eb-tabela thead { display:table-header-group; }
    .eb-tabela tr { break-inside:avoid; page-break-inside:avoid; }
    .eb-tabela th,.eb-tabela td { border:1px solid #b3c2d1; padding:4px 3px;
      text-align:center; line-height:1.22; vertical-align:middle; overflow-wrap:anywhere; }
    .eb-tabela th { background:#aec5d8 !important; color:#17334e; font-size:9px; font-weight:800; }
    .eb-tabela td { background:#f4f8fc !important; font-size:10px; color:#172d40; font-weight:700; }
    .eb-tabela tr:nth-child(even) td { background:#dfeaf4 !important; }
    .eb-tabela td:first-child,.eb-tabela td:last-child { text-align:left; }
    .eb-tabela th:nth-child(1),.eb-tabela td:nth-child(1) { width:16%; }
    .eb-tabela th:nth-child(2),.eb-tabela td:nth-child(2) { width:12%; }
    .eb-tabela th:nth-child(3),.eb-tabela td:nth-child(3) { width:12%; }
    .eb-tabela th:nth-child(4),.eb-tabela td:nth-child(4) { width:10%; }
    .eb-tabela th:nth-child(5),.eb-tabela td:nth-child(5) { width:10%; }
    .eb-tabela th:nth-child(6),.eb-tabela td:nth-child(6) { width:10%; }
    .eb-tabela th:nth-child(7),.eb-tabela td:nth-child(7) { width:10%; }
    .eb-tabela th:nth-child(8),.eb-tabela td:nth-child(8) { width:20%; }
    .eb-tabela .eb-total td { background:#c5d9e9 !important; font-weight:900; border-top:1.5px solid #214e73; }
    .eb-tabela .eb-positivo { color:#145a41; font-weight:900; }
    .eb-tabela .eb-negativo { color:#962d2d; font-weight:900; }
    .eb-tabela .eb-sem-dados,.eb-tabela .eb-anotacao-vazia { color:#576a7d; font-weight:600; font-style:italic; }
    /* Rodapé integra cada demonstrativo, sem posição fixa nem reserva excessiva. */
    .eb-rodape-fonte { margin:2px 0 0; padding:5px 6px 4px;
      border:1px solid #b3c2d1; border-top:2px solid #214e73;
      background:#eaf1f7 !important; color:#2c4359; font-size:8.5px; line-height:1.3;
      break-inside:avoid; page-break-inside:avoid; }
    .eb-rodape-fonte div + div { margin-top:2px; }
    .eb-rodape-fonte strong { font-weight:800; }
    @media print {
      body { print-color-adjust:exact; -webkit-print-color-adjust:exact; }
    }
    @media screen {
      body { padding:10mm; max-width:900px; margin:0 auto; }
      article.eb-extrato { margin-bottom:15mm; }
    }
  `;
  const html='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Banco de horas — '+
    esc(periodo)+'</title><style>'+cssImpressao+'</style></head><body>'+demonstrativos+'</body></html>';
  popup.addEventListener('afterprint',()=>{
    setTimeout(()=>{if(!popup.closed)popup.close();},120);
  },{once:true});
  popup.document.open();popup.document.write(html);popup.document.close();popup.focus();
  setTimeout(()=>{if(!popup.closed)popup.print();},400);
}
function configurarBancoHorasUI(){
  for(const id of ['eb-ano-inicial','eb-ano-final']){
    $(id).value=String(id==='eb-ano-inicial'?Math.max(2022,EB.anoAtual-5):EB.anoAtual);
    $(id).addEventListener('change',ebLimparResultados);
  }
  $('eb-empresa').addEventListener('change',ebTrocarEmpresa);
  $('eb-busca').addEventListener('input',ebRenderLista);
  $('eb-selecionar-todos').addEventListener('click',ebSelecionarTodos);
  $('eb-limpar').addEventListener('click',()=>{EB.selecionados.clear();ebRenderLista();ebLimparResultados();});
  $('eb-carregar').addEventListener('click',()=>comBotaoCarregando($('eb-carregar'),ebCarregar,'Carregando extratos...'));
  $('eb-csv').addEventListener('click',()=>{try{ebCSV();}catch(e){showMessage(e.message,'Exportação',true);}});
  $('eb-imprimir').addEventListener('click',()=>{try{ebImprimir();}catch(e){showMessage(e.message,'Impressão',true);}});
}
