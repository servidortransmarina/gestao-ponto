/* FRONTEND — GitHub Pages. Atualize esta URL após uma NOVA implantação do Apps Script. */
const API_URL = 'https://script.google.com/macros/s/AKfycbwUH3n8zl4g_kgxvfSxmXW0qZQ4pi_SuZ-EOM0B86KkM23kSca4n41PZyC-ABhkj3zI/exec';
const STORAGE_KEY = 'transmarina_gestao_sessao_v2';
const APP = {sessao:null, cartas:[], pendentes:[], saldos:[], funcionarios:[], folgas:[], selecionadas:new Set(), aba:'horas', subaba:'controle', cartaEditando:null, usuarios:{pendentes:[],ativos:[],recusados:[]}};
const $ = id => document.getElementById(id);
const norm = x => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
const esc = v => String(v == null?'':v).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => {const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
const mesAtual = () => today().slice(0,7);
function ontem() {
  const d=new Date(); d.setDate(d.getDate()-1);
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
// Alguns navegadores interpretam o ano digitado "26" como 0026 no input date.
function normalizarAnoDaData(input) {
  if(!input?.value)return true;
  const v=input.value, m=v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m)return false;
  const ano=Number(m[1]);
  if(ano>=0&&ano<=99)input.value=String(2000+ano)+'-'+m[2]+'-'+m[3];
  return /^\d{4}-\d{2}-\d{2}$/.test(input.value);
}
// Converte datas para a apresentação brasileira, sem mudar o formato enviado à API.
// Aceita datas do Sheets, ISO, dd/mm/aaaa, timestamps e Date.toString() em inglês.
const formatoDiaBR = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric'
});
const formatoHoraBR = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
function formatarDataBR(valor, incluirHora = false) {
  if (valor === null || valor === undefined || String(valor).trim() === '') return '—';
  const texto = String(valor).trim();
  // As datas sem fuso não podem ser convertidas com Date('AAAA-MM-DD'),
  // pois isso pode subtrair um dia no fuso brasileiro.
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/i);
  if (iso) {
    const [, ano, mes, dia, hora, minuto, fuso] = iso;
    if (fuso) {
      const instante = new Date(texto.replace(' ', 'T'));
      if (!Number.isNaN(instante.getTime())) {
        return formatoDiaBR.format(instante) + (incluirHora ? ' ' + formatoHoraBR.format(instante) : '');
      }
    }
    return `${dia}/${mes}/${ano}` + (incluirHora && hora ? ` ${hora}:${minuto}` : '');
  }
  const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ ,T]+(\d{2}):(\d{2}))?/);
  if (br) return `${br[1]}/${br[2]}/${br[3]}` + (incluirHora && br[4] ? ` ${br[4]}:${br[5]}` : '');
  // Exemplo: 'Thu Oct 29 2026 11:21:00 GMT-0300 (Brasilia Standard Time)'.
  const instante = new Date(texto);
  if (!Number.isNaN(instante.getTime())) {
    return formatoDiaBR.format(instante) + (incluirHora ? ' ' + formatoHoraBR.format(instante) : '');
  }
  return texto; // Não inventar uma data quando a origem é desconhecida.
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

function encerrarSessaoLocal() {
  APP.sessao=null;localStorage.removeItem(STORAGE_KEY);telaLogin(true);$('login-senha').value='';
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
  try {
    const salvo=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
    if(!salvo?.token || salvo.dataLogin!==today())return encerrarSessaoLocal();
    APP.sessao=salvo;
    const r=await api('validarSessao');
    APP.sessao.perfil=r.perfil;APP.sessao.usuario=r.usuario;
    localStorage.setItem(STORAGE_KEY,JSON.stringify(APP.sessao));
    await iniciarPainel();
  }catch(e){console.warn('Sessão não validada:',e.message);encerrarSessaoLocal();}
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
  const operacoes=[carregarSaldos(),carregarFolgas(),carregarPendentes()];
  if(adm)operacoes.push(carregarCartas(),carregarFuncionarios(),carregarUsuarios());
  await Promise.allSettled(operacoes);
}
function escolherAba(tab) {
  if(['cartas','usuarios'].includes(tab)&&APP.sessao?.perfil!=='ADM')return;
  APP.aba=tab;
  document.querySelectorAll('.nav-button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id==='sec-'+tab));
  $('titulo-pagina').textContent=mensagens[tab]||'Gestão de ponto';
  if(tab==='cartas')escolherSubaba(APP.subaba);
}
function escolherSubaba(sub) {
  APP.subaba=sub;
  document.querySelectorAll('.subnav-btn').forEach(b=>b.classList.toggle('active',b.dataset.sub===sub));
  document.querySelectorAll('.subpage').forEach(p=>p.classList.toggle('active',p.id==='sub-'+sub));
  if(sub==='capa')renderCapa();
  if(sub==='relatorios')renderRelatorios();
  if(sub==='resumo')renderResumoBanco();
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
  $('badge-usuarios').textContent=String(pendentes.length);
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
    await carregarUsuarios();
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
async function sincronizar() {
  if(APP.sessao?.perfil!=='ADM')return;
  try {
    const r=await api('sincronizarMobPonto');
    const [atualizouSaldos]=await Promise.all([carregarSaldos(),carregarFuncionarios()]);
    if(atualizouSaldos===false) {showMessage('MobPonto sincronizado, mas não foi possível recarregar o painel. Use Recarregar painel.','Atualização parcial',true);return false;}
    showMessage(`${r.resultado.total} funcionários sincronizados nas duas empresas.`,'Sincronização concluída');
    return true;
  }catch(e){showMessage(e.message,'Não foi possível sincronizar',true);return false;}
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
    lista.innerHTML=opcoes.map((f,i)=>`<div class="carta-sugestao-item" id="folga-sugestao-${i}" role="option" data-index="${i}" aria-selected="${i===0}"><strong>${esc(f.nome)}</strong><small class="block">${esc(f.empresa)}</small></div>`).join('');
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
  }catch(e){console.warn(e.message);}
}
function encontrarFuncionario(nome,empresa) {
  return APP.funcionarios.find(f=>norm(f.nome)===norm(nome)&&(!empresa||f.empresa===empresa))||APP.saldos.find(f=>norm(f.nome)===norm(nome)&&(!empresa||f.empresa===empresa));
}
async function salvarFolga(e) {
  e.preventDefault();
  try{
    const nome=$('folga-funcionario').value.trim(),empresa=$('folga-empresa').value;
    // A empresa vem do cadastro; não aceitar funcionários não identificados.
    const funcionario=funcionariosParaFolga().find(f=>norm(f.nome)===norm(nome)&&f.empresa===empresa);
    if(!funcionario){atualizarEmpresaFolga();throw Error('Selecione um funcionário da lista para identificar a empresa.');}
    if(!normalizarAnoDaData($('folga-data')))throw Error('Confira a data da folga.');
    const dados={funcionario:funcionario.nome,empresa:funcionario.empresa,cpf:funcionario.cpf||'',dataFolga:$('folga-data').value,
      horasPlanejadas:$('folga-horas').value.trim(),observacoes:$('folga-obs').value.trim()};
    await api('salvarFolga',{dados});
    $('form-folga').reset();$('folga-horas').value='08:00';
    atualizarEmpresaFolga();
    await carregarFolgas();showMessage('Folga registrada como PLANEJADA.','Planejamento salvo');
  }catch(err){showMessage(err.message,'Não foi possível registrar',true);}
}
async function carregarFolgas() {
  try{APP.folgas=(await api('getFolgas')).dados||[];renderFolgas();}
  catch(e){$('tbody-folgas').innerHTML=`<tr><td colspan="6" class="empty">${esc(e.message)}</td></tr>`;}
}
function renderFolgas() {
  const status=$('filtro-folga-status').value;
  const items=APP.folgas.filter(f=>!status||f.status===status);
  $('tbody-folgas').innerHTML=items.length?items.map(f=>{
    const op=f.status==='PLANEJADA'?`<button class="btn tiny primary folga-status" data-id="${esc(f.id)}" data-status="CONCEDIDA">Concedida</button><button class="btn tiny subtle folga-status" data-id="${esc(f.id)}" data-status="CANCELADA">Cancelar</button>`:'—';
    return `<tr><td><strong>${esc(f.funcionario)}</strong><small class="block">${esc(f.empresa||'')}</small></td><td>${fmtData(f.dataFolga)}</td><td class="mono">${esc(f.horasPlanejadas)}</td><td><span class="status ${esc(f.status.toLowerCase())}">${esc(f.status)}</span></td><td>${esc(f.responsavel)}</td><td><div class="cell-actions">${op}</div></td></tr>`;
  }).join(''):'<tr><td colspan="6" class="empty">Nenhuma folga registrada neste filtro.</td></tr>';
}
async function mudarStatusFolga(id,status) {
  try{await api('alterarFolga',{idFolga:id,status});await carregarFolgas();showMessage('Status atualizado para '+status+'.');}
  catch(e){showMessage(e.message,'Falha ao atualizar',true);}
}

async function carregarCartas() {
  if(APP.sessao?.perfil!=='ADM')return;
  try{APP.cartas=(await api('getDadosADM')).dados||[];renderCartas();if(APP.subaba==='capa')renderCapa();if(APP.subaba==='relatorios')renderRelatorios();atualizarResponsaveis();return true;}
  catch(e){$('tbody-cartas').innerHTML=`<tr><td colspan="7" class="empty">${esc(e.message)}</td></tr>`;return false;}
}
function atualizarResponsaveis() {
  const lista=[...new Set(APP.cartas.map(x=>x.responsavel).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  $('lista-responsaveis').innerHTML=lista.map(s=>`<option value="${esc(s)}"></option>`).join('');
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
function renderCartas() {
  $('cartas-total').textContent=APP.cartas.length;
  $('cartas-pendentes').textContent=APP.cartas.filter(c=>c.status!=='SIM').length;
  $('cartas-assinadas').textContent=APP.cartas.filter(c=>c.status==='SIM').length;
  const lista=filtroDeCartas({texto:$('filtro-cartas').value,status:$('filtro-cartas-status').value,mes:$('filtro-cartas-mes').value});
  const exibidas=lista.slice(0,200);
  $('tbody-cartas').innerHTML=exibidas.length?exibidas.map(c=>`<tr><td class="mono">${fmtData(c.dataOcorrencia)}</td><td><strong>${esc(c.funcionario)}</strong></td><td>${esc(c.responsavel||'—')}</td><td class="mono">${fmtData(c.dataCorrecao)}</td><td><span class="status ${c.status==='SIM'?'concedida':'planejada'}">${esc(c.status)}</span></td><td>${esc(textoComplementarCarta(c)||'—')}</td><td><div class="cell-actions carta-acoes">${c.status!=='SIM'?`<button class="btn tiny subtle carta-assinar" data-id="${esc(c.id)}">Confirmar</button>`:''}<button class="btn tiny secondary carta-editar" data-id="${esc(c.id)}" type="button">Editar</button><button class="btn tiny carta-excluir" data-id="${esc(c.id)}" type="button" aria-label="Excluir carta de ${esc(c.funcionario)}">Excluir</button></div></td></tr>`).join(''):'<tr><td colspan="7" class="empty">Nenhuma carta encontrada.</td></tr>';
  if(lista.length>exibidas.length)$('tbody-cartas').innerHTML+=`<tr><td colspan="7" class="empty">Exibindo ${exibidas.length} de ${lista.length} cartas. Use os filtros para localizar outros registros.</td></tr>`;
}
function identificarFuncionarioCarta(nome) {
  const chave=norm(nome);
  if(!chave)return {erro:'Selecione um colaborador cadastrado para identificar a empresa.'};
  const pessoas=APP.funcionarios.filter(f=>norm(f.nome)===chave);
  const saldos=APP.saldos.filter(f=>norm(f.nome)===chave);
  const registros=pessoas.length?pessoas:saldos;
  if(!registros.length)return {erro:'Funcionário não encontrado na base atual.'};
  const empresas=[...new Set(registros.map(f=>f.empresa).filter(Boolean))];
  if(empresas.length!==1)return {erro:'Nome cadastrado em mais de uma empresa. Verifique o cadastro.'};
  return {nome:registros[0].nome,empresa:empresas[0]};
}
function atualizarEmpresaCarta() {
  const nome=$('carta-funcionario').value.trim(),ident=identificarFuncionarioCarta(nome);
  const legado=APP.cartaEditando&&APP.cartas.find(c=>c.id===APP.cartaEditando);
  const podePreservar=legado&&norm(legado.funcionario)===norm(nome);
  const empresa=ident.empresa||(podePreservar?legado.empresa:'');
  const p=$('carta-empresa-info');
  p.textContent=empresa?'Empresa identificada automaticamente: '+empresa:(podePreservar?'Carta histórica sem empresa informada. É possível editar mantendo a informação original.':(nome?ident.erro:'Selecione um colaborador cadastrado para identificar a empresa.'));
  p.classList.toggle('carta-empresa-aviso',!empresa&&!!nome);
  return empresa;
}
function definirModoCarta(c=null) {
  fecharSugestoesCarta.forEach(fechar=>fechar());
  APP.cartaEditando=c?.id||null;
  $('titulo-form-carta').textContent=c?'Editar carta de ponto':'Registrar nova carta';
  $('btn-salvar-carta').textContent=c?'Salvar alterações':'Salvar carta';
  $('btn-cancelar-edicao-carta').hidden=!c;
  $('form-carta').reset();
  $('carta-funcionario').value=c?.funcionario||'';
  $('carta-ocorrencia').value=c?.dataOcorrencia||ontem();
  $('carta-correcao').value=c?c.dataCorrecao||'':today();
  $('carta-responsavel').value=c?.responsavel||'';
  $('carta-assinado').value=c?.status||'NÃO';
  $('carta-obs').value=c?textoComplementarCarta(c):'';
  atualizarEmpresaCarta();
  if(c){$('form-carta').scrollIntoView({behavior:'smooth',block:'center'});$('carta-funcionario').focus({preventScroll:true});}
}
function reexibirCartasLocais() {
  renderCartas();if(APP.subaba==='capa')renderCapa();if(APP.subaba==='relatorios')renderRelatorios();atualizarResponsaveis();
  if(APP.sessao?.perfil==='ADM'){
    APP.pendentes=APP.cartas.filter(c=>c.status!=='SIM');
    $('badge-pendentes').textContent=APP.pendentes.length;
    renderPendentes();
  }
}
async function salvarCarta(e) {
  e?.preventDefault();
  try {
    if(!normalizarAnoDaData($('carta-ocorrencia'))||!normalizarAnoDaData($('carta-correcao')))throw Error('Confira as datas informadas.');
    const nome=$('carta-funcionario').value.trim(), ident=identificarFuncionarioCarta(nome);
    const anterior=APP.cartaEditando&&APP.cartas.find(c=>c.id===APP.cartaEditando);
    const mesmoNome=anterior&&norm(anterior.funcionario)===norm(nome);
    const empresa=ident.empresa||(mesmoNome?anterior.empresa:'');
    if(!empresa&&!mesmoNome)throw Error(ident.erro||'Selecione um funcionário cadastrado.');
    const dados={funcionario:ident.nome||nome,empresa,
      dataOcorrencia:$('carta-ocorrencia').value,responsavel:$('carta-responsavel').value.trim(),
      dataCorrecao:$('carta-correcao').value,assinado:$('carta-assinado').value,
      observacoes:$('carta-obs').value.trim()};
    if(!dados.dataOcorrencia)throw Error('Informe a data da ocorrência.');
    const editando=APP.cartaEditando;
    const r=editando?await api('editarCarta',{idCarta:editando,dados}):await api('salvarNovaCarta',{dados});
    if(!r.carta)throw Error('O servidor não retornou os dados da carta. Atualize o histórico antes de continuar.');
    if(editando){const idx=APP.cartas.findIndex(c=>c.id===editando);if(idx!==-1)APP.cartas[idx]=r.carta;else APP.cartas.unshift(r.carta);}
    else APP.cartas.unshift(r.carta);
    definirModoCarta();reexibirCartasLocais();
    feedbackAtualizacao(editando?'Carta atualizada com sucesso.':'Carta registrada com sucesso.');
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
async function carregarPendentes() {
  try{
    APP.pendentes=((await api('getDadosEncarregado')).dados||[]).filter(c=>c.status!=='SIM');
    $('badge-pendentes').textContent=APP.pendentes.length;renderPendentes();return true;
  }catch(e){$('lista-pendentes').innerHTML=`<p class="empty">${esc(e.message)}</p>`;return false;}
}
function renderPendentes() {
  $('lista-pendentes').innerHTML=APP.pendentes.length?APP.pendentes.map(c=>`<article class="pending-item"><div><span class="pending-date">${fmtData(c.dataOcorrencia)}</span><h4>${esc(c.funcionario)}</h4><p>${esc(c.motivo||'Carta aguardando assinatura')}${c.responsavel?' • Responsável: '+esc(c.responsavel):''}</p></div><button class="btn primary carta-assinar" data-id="${esc(c.id)}">Confirmar assinatura</button></article>`).join(''):'<div class="empty tall">Nenhuma carta pendente de assinatura.</div>';
}
async function confirmarCarta(id) {
  try{await api('confirmarCarta',{idCarta:id});await Promise.all([carregarPendentes(),carregarCartas()]);showMessage('Assinatura confirmada e registrada no histórico.');}
  catch(e){showMessage(e.message,'Não foi possível confirmar',true);}
}

function cartasCapaFiltradas() {
  return filtroDeCartas({texto:$('filtro-capa').value,mes:$('filtro-capa-mes').value})
    .filter(c=>norm(c.status)==='NAO');
}
function atualizarTotalSelecionadas() {$('total-selecionadas').textContent=APP.selecionadas.size;}
function renderCapa() {
  // Nunca deixe cartas assinadas na seleção, mesmo que sejam confirmadas após selecionar.
  const aindaPendentes=new Set(APP.cartas.filter(c=>norm(c.status)==='NAO').map(c=>c.id));
  for(const id of APP.selecionadas)if(!aindaPendentes.has(id))APP.selecionadas.delete(id);
  const filtradas=cartasCapaFiltradas(),arr=filtradas.slice(0,250);
  $('tbody-capa').innerHTML=arr.length?arr.map(c=>`<tr><td><input type="checkbox" class="check-capa" data-id="${esc(c.id)}" ${APP.selecionadas.has(c.id)?'checked':''} aria-label="Selecionar ${esc(c.funcionario)}"></td><td class="mono">${fmtData(c.dataOcorrencia)}</td><td><strong>${esc(c.funcionario)}</strong></td><td>${esc(c.responsavel||'—')}</td><td class="mono">${fmtData(c.dataCorrecao)}</td><td>${esc(c.status)}</td></tr>`).join(''):'<tr><td colspan="6" class="empty">Nenhuma carta neste filtro.</td></tr>';
  if(filtradas.length>arr.length)$('tbody-capa').innerHTML+=`<tr><td colspan="6" class="empty">Exibindo ${arr.length} de ${filtradas.length} cartas. Filtre por mês ou nome para localizar outros registros.</td></tr>`;
  $('check-todas-capa').checked=arr.length>0&&arr.every(c=>APP.selecionadas.has(c.id));
  atualizarTotalSelecionadas();
  $('imprimir-capa').disabled=APP.selecionadas.size===0;
}
function imprimirCapa() {
  // Apenas cartas não assinadas podem ser incluídas na capa.
  const itens=APP.cartas.filter(c=>norm(c.status)==='NAO'&&APP.selecionadas.has(c.id))
    .sort((a,b)=>String(a.dataOcorrencia||'').localeCompare(String(b.dataOcorrencia||'')));
  if(!itens.length)return showMessage('Selecione pelo menos uma carta não assinada.','Atenção',true);

  const win=window.open('','_blank');
  if(!win)return showMessage('Seu navegador bloqueou a janela de impressão. Libere pop-ups para este site.','Impressão bloqueada',true);

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
  @media print { body { print-color-adjust:exact; -webkit-print-color-adjust:exact; } }
  </style></head><body>
    <main class="documento">
      <h1>CONTROLE DE RECEBIMENTO CORREÇÃO DE PONTO</h1>
      <table><thead><tr><th>DATA DA OCORRÊNCIA</th><th>COLABORADORES</th>
        <th>RESPONSÁVEL OP</th><th>DATA ALTERAÇÃO</th></tr></thead>
        <tbody>${linhas}</tbody></table>
      <div class="assinatura"><div>Responsável pela entrega</div><div>Responsável pelo recebimento</div></div>
    </main>
    <footer class="emissao">Emissão: ${esc(emissao)}</footer>
    <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),300));</script>
  </body></html>`;
  win.document.open();win.document.write(html);win.document.close();
}

const chartColors=['#1f4e78','#4f83b7','#77a6cc','#ec9845','#4e9d93','#7465ab','#d46f83','#8492a6','#90b67d','#c59759','#6f8796','#cbb2d9'];
function filtrarPeriodoRelatorio() {const mes=$('filtro-relatorio-mes').value;return APP.cartas.filter(c=>!mes||c.dataOcorrencia.slice(0,7)===mes);}
function renderRelatorios() {
  const data=filtrarPeriodoRelatorio(),mes=$('filtro-relatorio-mes').value;
  const periodo=mes?`${mes.slice(5,7)}/${mes.slice(0,4)}`:'TODO O PERÍODO';
  const ranking=new Map();for(const c of data){const k=norm(c.funcionario);if(!k)continue;const o=ranking.get(k)||{nome:c.funcionario,total:0};o.total++;ranking.set(k,o);}
  const arr=[...ranking.values()].sort((a,b)=>b.total-a.total||a.nome.localeCompare(b.nome,'pt-BR'));
  $('titulo-ranking').textContent='RANKING DE CARTAS — '+periodo.toUpperCase();
  $('titulo-barras').textContent='QUANTIDADE DE CARTAS DE PONTO POR FUNCIONÁRIO — '+periodo.toUpperCase();
  $('tbody-ranking').innerHTML=arr.length?arr.map((f,i)=>`<tr><td class="rank-num">${i+1}º</td><td><strong class="ranking-nome">${esc(f.nome)}</strong></td><td><strong class="ranking-quantidade">${f.total}</strong></td></tr>`).join(''):'<tr><td colspan="3" class="empty">Sem cartas para o período selecionado.</td></tr>';
  const top=arr.slice(0,10),max=top[0]?.total||1;
  $('grafico-barras').innerHTML=top.length?`<div class="bars">${top.map((x,i)=>`<div class="bar-row"><span class="bar-name" title="${esc(x.nome)}">${esc(x.nome)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(1,x.total/max*100)}%;background:${chartColors[i%chartColors.length]}"></div></div><b class="bar-count">${x.total}</b></div>`).join('')}</div><p class="chart-caption">Top 10 • ranking completo na tabela à esquerda</p>`:'<p class="empty">Sem dados para construir o gráfico.</p>';
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
  const ranking=new Map();
  for(const c of filtrarPeriodoRelatorio()) {
    const k=norm(c.funcionario);if(!k)continue;
    const r=ranking.get(k)||{nome:c.funcionario,total:0};r.total++;ranking.set(k,r);
  }
  return [...ranking.values()].sort((a,b)=>b.total-a.total||a.nome.localeCompare(b.nome,'pt-BR'));
}
// PNG gerado no próprio navegador, sem bibliotecas externas ou envio de dados a serviços de terceiros.
function construirImagemResumo(tipo) {
  const ehBanco=tipo==='banco',periodo=obterPeriodoResumo();
  if(ehBanco&&!periodo.valido)throw Error(periodo.alerta);
  const linhas=ehBanco?resumoBancoLinhas(periodo):[];
  const grupos=ehBanco?agruparResumoParaImagem(linhas):[];
  const lista=ehBanco?linhas:rankingParaCompartilhar().slice(0,15);
  if(!lista.length)throw Error('Não há registros para compartilhar.');
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
    const headerH=46,cabH=50,grupoH=26,rowH=31,footerH=50;
    const totalRows=grupos.reduce((s,g)=>s+g.linhas.length,0);
    const h=topo+headerH+cabH+grupos.length*grupoH+totalRows*rowH+footerH+18;
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
    const footerY=y+18;
    ctx.fillStyle='#555';ctx.font='10px Arial';ctx.textAlign='left';
    ctx.fillText('Destaque amarelo = funcionário com folga livre. Valores exibem os 3 meses sincronizados.',x0,footerY);
    return canvas;
  }
  const W=1500, margem=52,inicioY=230,rowH=49,cabH=48,h=Math.max(530,inicioY+cabH+rowH*lista.length+160);
  canvas.width=W;canvas.height=h;
  ctx.fillStyle='#f5f8fb';ctx.fillRect(0,0,W,h);
  ctx.fillStyle='#1f4e78';ctx.fillRect(0,0,W,130);
  ctx.fillStyle='#fff';ctx.font='700 33px Arial';ctx.fillText('TRANSMARINA  |  GESTÃO DE PONTO',margem,57);
  ctx.font='21px Arial';ctx.fillText('RANKING DE CARTAS DE PONTO',margem,97);
  ctx.fillStyle='#152f45';ctx.font='700 28px Arial';
  const subtitulo=$('filtro-relatorio-mes').value?$('filtro-relatorio-mes').value.slice(5,7)+'/'+$('filtro-relatorio-mes').value.slice(0,4):'TODO O HISTÓRICO';
  ctx.fillText(subtitulo,margem,173);
  ctx.fillStyle='#596c80';ctx.font='20px Arial';ctx.fillText(`${lista.length} primeiras posições`,margem,205);
  const x0=margem,y0=inicioY,widths=[120,1050,226],titles=['POSIÇÃO','FUNCIONÁRIO','CARTAS'];
  ctx.fillStyle='#dce9f5';ctx.fillRect(x0,y0,W-2*margem,cabH);
  let xx=x0;
  titles.forEach((titulo,i)=>{ctx.fillStyle='#274d71';ctx.font='700 16px Arial';ctx.fillText(titulo,xx+12,y0+30);xx+=widths[i];});
  let y=y0+cabH;
  lista.forEach((r,i)=>{
    ctx.fillStyle=i%2===0?'#fff':'#edf3f8';ctx.fillRect(x0,y,W-2*margem,rowH);
    ctx.fillStyle='#172e43';ctx.font='700 18px Arial';
    ctx.fillText(`${i+1}º`,x0+15,y+31);
    ctx.fillText(cortarTexto(r.nome,1010),x0+135,y+31);
    ctx.fillStyle='#0b735a';ctx.font='700 27px Arial';ctx.fillText(String(r.total),x0+1190,y+33);
    y+=rowH;
  });
  const footer=y+38;
  ctx.fillStyle='#657689';ctx.font='20px Arial';ctx.fillText('Contagem de cartas de correção de ponto; não representa necessariamente faltas ao trabalho.',margem,footer);
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
  const editar=e.target.closest('.carta-editar');if(editar){const carta=APP.cartas.find(c=>c.id===editar.dataset.id);if(carta)definirModoCarta(carta);return;}
  const excluir=e.target.closest('.carta-excluir');if(excluir){
    const carta=APP.cartas.find(c=>c.id===excluir.dataset.id);
    if(!carta){showMessage('Carta não encontrada. Atualize o histórico.','Aviso',true);return;}
    confirmarExclusaoCarta(carta.funcionario).then(confirmou=>{
      if(confirmou)comBotaoCarregando(excluir,()=>excluirCarta(carta.id),'Excluindo…');
    });
    return;
  }
  const assinar=e.target.closest('.carta-assinar');if(assinar)return comBotaoCarregando(assinar,()=>confirmarCarta(assinar.dataset.id),'Confirmando…');
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
    const resultados=await Promise.all([carregarCartas(),carregarPendentes()]);
    return resultados.every(Boolean);
  },'Atualizando cartas…','Cartas de ponto atualizadas.'));
}
// Sugestões próprias para que Enter selecione o nome, sem submeter o formulário.
const fecharSugestoesCarta=[];
function configurarSugestaoCarta(idInput,idLista,obterValores,aposSelecionar=()=>{}) {
  const campo=$(idInput),lista=$(idLista);
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
    campo.value=escolhido;
    campo.dispatchEvent(new Event('input',{bubbles:true}));
    campo.dispatchEvent(new Event('change',{bubbles:true}));
    fechar();aposSelecionar();
    campo.focus({preventScroll:true});
  }
  function atualizar() {
    const busca=norm(campo.value);
    if(!busca){fechar();return;}
    opcoes=[...new Map(obterValores().filter(Boolean).map(nome=>[norm(nome),nome])).values()]
      .filter(nome=>norm(nome).includes(busca)&&norm(nome)!==busca)
      .sort((a,b)=>{
        const aIni=norm(a).startsWith(busca)?0:1,bIni=norm(b).startsWith(busca)?0:1;
        return aIni-bIni||a.localeCompare(b,'pt-BR');
      }).slice(0,8);
    if(!opcoes.length){fechar();return;}
    indice=0;
    lista.innerHTML=opcoes.map((nome,i)=>`<div class="carta-sugestao-item" id="${idLista}-op-${i}" role="option" aria-selected="${i===0}" data-index="${i}">${esc(nome)}</div>`).join('');
    lista.hidden=false;campo.setAttribute('aria-expanded','true');marcarAtiva();
  }
  campo.addEventListener('input',atualizar);
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
function configurarEnterEntreCamposCarta(idFormulario='form-carta',idBotao='btn-salvar-carta') {
  const form=$(idFormulario);
  // Enter em texto/select/data avança, somente o clique em Salvar (ou foco nele + Enter) grava.
  form.addEventListener('keydown',e=>{
    if(e.key!=='Enter'||e.isComposing||e.ctrlKey||e.metaKey||e.altKey)return;
    const atual=e.target;
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
  $('form-login').addEventListener('submit',e=>{e.preventDefault();login(e);});
  configurarAcessoEmail();
  configurarGestaoUsuarios();
  $('msg-fechar').addEventListener('click',fecharMensagem);
  $('btn-sair').addEventListener('click',()=>comBotaoCarregando($('btn-sair'),logout,'Saindo…'));
  document.querySelectorAll('.nav-button').forEach(b=>b.addEventListener('click',()=>escolherAba(b.dataset.tab)));
  document.querySelectorAll('.subnav-btn').forEach(b=>b.addEventListener('click',()=>escolherSubaba(b.dataset.sub)));
  $('btn-recarregar-horas').addEventListener('click',()=>comBotaoCarregando($('btn-recarregar-horas'),carregarSaldos,'Atualizando painel…','Painel atualizado com os últimos dados salvos.'));
  $('enc-recarregar-horas').addEventListener('click',()=>comBotaoCarregando($('enc-recarregar-horas'),carregarSaldos,'Atualizando lista…','Lista de funcionários atualizada.'));
  $('enc-busca-funcionario').addEventListener('input',renderFolgasEncarregado);
  $('btn-sincronizar').addEventListener('click',()=>comBotaoCarregando($('btn-sincronizar'),sincronizar,'Sincronizando MobPonto…'));
  ['filtro-horas','filtro-empresa-horas','filtro-saldo'].forEach(id=>$(id).addEventListener(id==='filtro-horas'?'input':'change',renderSaldos));
  $('form-folga').addEventListener('submit',e=>{e.preventDefault();comBotaoCarregando($('salvar-folga'),()=>salvarFolga(e),'Salvando folga…');});
  $('filtro-folga-status').addEventListener('change',renderFolgas);
  $('form-carta').addEventListener('submit',e=>{e.preventDefault();comBotaoCarregando($('btn-salvar-carta'),()=>salvarCarta(e),'Salvando carta…');});
  ['filtro-cartas','filtro-cartas-status','filtro-cartas-mes'].forEach(id=>$(id).addEventListener(id==='filtro-cartas'?'input':'change',renderCartas));
  $('limpar-filtro-cartas').addEventListener('click',()=>{$('filtro-cartas').value='';$('filtro-cartas-status').value='';$('filtro-cartas-mes').value='';renderCartas();});
  ['filtro-capa','filtro-capa-mes'].forEach(id=>$(id).addEventListener(id==='filtro-capa'?'input':'change',renderCapa));
  $('check-todas-capa').addEventListener('change',e=>{for(const c of cartasCapaFiltradas().slice(0,250))if(e.target.checked)APP.selecionadas.add(c.id);else APP.selecionadas.delete(c.id);renderCapa();});
  $('tbody-capa').addEventListener('change',e=>{if(!e.target.matches('.check-capa'))return;if(e.target.checked)APP.selecionadas.add(e.target.dataset.id);else APP.selecionadas.delete(e.target.dataset.id);renderCapa();});
  $('selecionar-visiveis').addEventListener('click',()=>{cartasCapaFiltradas().slice(0,250).forEach(c=>APP.selecionadas.add(c.id));renderCapa();});
  $('limpar-selecao').addEventListener('click',()=>{APP.selecionadas.clear();renderCapa();});
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
  configurarEnterEntreCamposCarta('form-folga','salvar-folga');
  ['folga-data'].forEach(id=>{const input=$(id);input.addEventListener('change',()=>normalizarAnoDaData(input));input.addEventListener('blur',()=>normalizarAnoDaData(input));});
  $('carta-funcionario').addEventListener('input',atualizarEmpresaCarta);
  $('carta-funcionario').addEventListener('change',atualizarEmpresaCarta);
  configurarSugestaoCarta('carta-funcionario','carta-sugestoes-funcionario',()=>[
    ...APP.funcionarios.map(f=>f.nome),...APP.saldos.map(f=>f.nome)
  ],atualizarEmpresaCarta);
  configurarSugestaoCarta('carta-responsavel','carta-sugestoes-responsavel',()=>APP.cartas.map(c=>c.responsavel));
  configurarEnterEntreCamposCarta();
  $('btn-cancelar-edicao-carta').addEventListener('click',()=>definirModoCarta());
  ['carta-ocorrencia','carta-correcao'].forEach(id=>{const input=$(id);input.addEventListener('change',()=>normalizarAnoDaData(input));input.addEventListener('blur',()=>normalizarAnoDaData(input));});
}
document.addEventListener('DOMContentLoaded',()=>{
  registrarEventos();definirModoCarta();$('filtro-relatorio-mes').value=mesAtual();
  // A faixa de meses é definida pelos dados efetivamente sincronizados em renderResumoBanco().
  setInterval(()=>{if(APP.sessao&&APP.sessao.dataLogin!==today())encerrarSessaoLocal();},20000);
  verificarSessao();
});
