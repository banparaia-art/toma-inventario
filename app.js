/* Toma de inventario · F2b (conteo, registrar producto, alerta de vencimiento, escáner de cámara) */
(function () {
  'use strict';
  var CFG = window.CONFIG, VERSION = 'F3.1';
  var S = { ses: null, vista: 'login', datos: null, tab: null, zona: null, adminTab: 'avance', usuarios: null, historial: null,
            informe: null, ocupado: false, lentos: 0, errCarga: '', online: navigator.onLine, aviso: '', filtroHist: '' };
  var $app = document.getElementById('app'), $capa = document.getElementById('capa'), $aviso = document.getElementById('aviso');

  // ---------- utilidades ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; }
  }
  function fecha(iso) {
    if (!iso) return '—'; var d = new Date(iso); if (isNaN(d)) return String(iso);
    return d.toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  function hace(iso) {
    if (!iso) return ''; var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (isNaN(m)) return ''; if (m < 1) return 'hace un momento'; if (m < 60) return 'hace ' + m + ' min';
    var h = Math.floor(m / 60); return h < 24 ? 'hace ' + h + ' h' : 'hace ' + Math.floor(h / 24) + ' d';
  }
  function toast(msg) {
    $aviso.textContent = msg; $aviso.className = 'on'; clearTimeout(toast.t); toast.t = setTimeout(function () { $aviso.className = ''; }, 3600);
  }
  function cargando() {
    if (S.errCarga) return '<div class="vacio"><h2>No se pudo conectar</h2><p>' + esc(S.errCarga) + '</p><button class="btn rel" data-a="recargar">Reintentar</button></div>';
    return '<div class="centro"><span class="cargando" role="img" aria-label="Cargando"></span><div style="margin-top:10px">Cargando…</div></div>'; }
  function esActivo(v) { return v === true || String(v).toLowerCase() === 'true'; }

  // ---------- comunicación con el servicio ----------
  var LECTURAS = { avance: 1, cambiosUnidad: 1, articulos: 1, posicionesUnidad: 1, yo: 1, listarUnidades: 1, listarUsuarios: 1, historial: 1, validarDatos: 1 };
  var ESPERAS = [2000, 4000, 8000];            // pausas entre reintentos de lecturas (servidor dormido o celular sin red aún)
  function espera(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function pintarEstado() { var e = document.getElementById('estado'); if (e) e.className = S.lentos > 0 ? 'on' : ''; }
  // Una petición. Reintenta sola: "ocupado" (el servidor no hizo nada, es seguro) y lecturas que no llegaron.
  // Las escrituras que no llegan NO se repiten a ciegas: podrían haberse hecho ya.
  function intento(accion, p, n) {
    var body = { accion: accion, token: S.ses ? S.ses.token : undefined };
    for (var k in (p || {})) body[k] = p[k];
    var ctl = ('AbortController' in window) ? new AbortController() : null, to = setTimeout(function () { if (ctl) ctl.abort(); }, 30000);
    return fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined, redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        clearTimeout(to); S.online = true;
        if (j && j.error === 'ocupado' && n < 2) return espera(1500 * (n + 1)).then(function () { return intento(accion, p, n + 1); });
        if (j && accion !== 'login' && (j.error === 'sin_sesion' || j.error === 'sesion_vencida' || j.error === 'inactivo')) { salirLocal(j.mensaje); }
        return j || { ok: false, mensaje: 'Respuesta vacía.' };
      })
      .catch(function () {
        clearTimeout(to);
        if (LECTURAS[accion] && n < ESPERAS.length) return espera(ESPERAS[n]).then(function () { return intento(accion, p, n + 1); });
        S.online = false; return { ok: false, error: 'red', mensaje: 'Sin conexión con el servidor. Revisa tu señal e inténtalo otra vez.' };
      });
  }
  // Si tarda más de 4 s, avisa "Conectando…" en vez de dejar la pantalla muda.
  function api(accion, p) {
    var visible = false, t = setTimeout(function () { visible = true; S.lentos++; pintarEstado(); }, 4000);
    function fin() { clearTimeout(t); if (visible) { S.lentos--; pintarEstado(); } }
    return intento(accion, p, 0).then(function (r) { fin(); return r; }, function (e) { fin(); throw e; });
  }
  // Bloquea el botón y muestra qué está pasando mientras el servidor responde (evita dobles toques).
  function ocupar(b, txt) { if (!b) return; b.disabled = true; b.dataset.txt = b.textContent; b.textContent = txt; }
  function liberarBoton(b) { if (!b) return; b.disabled = false; if (b.dataset.txt) b.textContent = b.dataset.txt; }

  // ---------- sesión ----------
  function guardarSesion() { ls('ses', S.ses ? JSON.stringify(S.ses) : null); }
  function salirLocal(msg) {
    S.ses = null; CM = {}; CT.datos = null; S.errCarga = ''; S.datos = null; S.usuarios = null; S.historial = null; S.informe = null; guardarSesion();
    S.vista = 'login'; S.aviso = msg || ''; cerrarModal(); render();
  }
  function entrar() {
    S.datos = null; S.tab = null;
    S.vista = S.ses.debe ? 'pin' : 'home'; S.adminTab = 'avance'; render();
    if (!S.ses.debe) cargarSegunVista();
    cargarLocal();
  }

  // ---------- carga de datos ----------
  function cargarUnidades(silencioso) {
    var estabaOn = S.online;
    return api('listarUnidades').then(function (r) {
      if (!r.ok) {
        if (!S.datos) { S.errCarga = r.mensaje || 'No se pudo cargar.'; render(); }
        else { if (!silencioso) toast(r.mensaje || 'No se pudo cargar.'); if (estabaOn !== S.online) renderConScroll(); }
        return r;
      }
      S.errCarga = '';
      var antes = JSON.stringify(S.datos); S.datos = r;
      if (antes !== JSON.stringify(r) || !silencioso) renderConScroll();
      return r;
    });
  }
  function cargarSegunVista(silencioso) {
    if (!S.ses || S.vista !== 'home') return;
    if (S.ses.rol === 'administrador') {
      if (S.adminTab === 'usuarios') return api('listarUsuarios').then(function (r) { if (r.ok) { S.errCarga = ''; S.usuarios = r.usuarios; renderConScroll(); } else if (!S.usuarios) { S.errCarga = r.mensaje; render(); } else toast(r.mensaje); });
      if (S.adminTab === 'historial') return buscarHistorial();
      if (S.adminTab === 'avance') api('avance').then(function (r) { if (r.ok && r.toma_activa) { S.av = r; renderConScroll(); } });
    }
    return cargarUnidades(silencioso);
  }
  function buscarHistorial() {
    return api('historial', { filtro: S.filtroHist }).then(function (r) { if (r.ok) { S.errCarga = ''; S.historial = r.eventos; renderConScroll(); } else if (!S.historial) { S.errCarga = r.mensaje; render(); } else toast(r.mensaje); });
  }

  // ---------- piezas de pantalla ----------
  function cabecera(titulo, sub, teal, atras) {
    var ini = S.ses ? esc(S.ses.usuario.charAt(0).toUpperCase()) : '';
    return '<header class="cab' + (teal ? ' teal' : '') + '">' +
      (atras ? '<button class="batras" data-a="atras" aria-label="Volver atrás"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg><span>Atrás</span></button>' : '') +
      '<div class="t"><h1>' + esc(titulo) + '</h1><small>' + esc(sub || '') + '</small></div>' +
      (S.ses && S.vista === 'home' ? '<button class="ibtn" data-a="recargar" aria-label="Actualizar">↻</button>' : '') +
      '<span id="chip" class="' + chipTxt().c + '">' + esc(chipTxt().t) + '</span>' +
      (S.ses ? '<button class="ibtn" data-a="menu" aria-label="Menú de ' + esc(S.ses.usuario) + '">' + ini + '</button>' : '') + '</header>';
  }
  function modal(html, fija) {
    $capa.innerHTML = '<div class="hoja" role="dialog" aria-modal="true">' + html + '</div>'; $capa.className = 'on'; $capa.dataset.fija = fija ? '1' : '';
    var f = $capa.querySelector('input,select,button'); if (f) setTimeout(function () { try { f.focus(); } catch (e) {} }, 30);
  }
  function cerrarModal() { if (typeof detenerCamara === 'function') detenerCamara(); $capa.className = ''; $capa.innerHTML = ''; }
  $capa.addEventListener('click', function (e) { if (e.target === $capa && !$capa.dataset.fija) cerrarModal(); });

  function ordenNat(a, b) { return String(a).localeCompare(String(b), 'es', { numeric: true }); }

  // ---------- LOGIN y PIN ----------
  function vistaLogin() {
    return '<main class="pantalla"><div class="marca"><img class="logo" src="icon-192.png" alt=""><h1>Toma de inventario</h1><p>Ingresa con tu usuario y PIN.</p></div>' +
      '<form class="form" data-f="login" autocomplete="on" novalidate>' +
      (S.aviso ? '<div class="aviso" role="alert">' + esc(S.aviso) + '</div>' : '') +
      '<div class="campo"><label for="u">Usuario</label><input id="u" name="usuario" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required></div>' +
      '<div class="campo"><label for="p">PIN</label><input id="p" class="pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="10" required></div>' +
      '<div id="msg"></div><button class="btn rel ancho" type="submit">Entrar</button>' +
      '<p class="pie">¿No tienes usuario o olvidaste tu PIN? Pídelo al administrador.</p></form></main>';
  }
  function vistaPin() {
    var forzado = S.ses.debe;
    return '<main class="pantalla">' + cabecera('Cambiar PIN', forzado ? 'Obligatorio en tu primer ingreso' : S.ses.usuario, false, !forzado) +
      '<form class="form" data-f="pin" novalidate>' +
      (forzado ? '<div class="aviso">Tu PIN actual es temporal. Elige uno nuevo de 6 a 10 dígitos que solo tú conozcas.</div>' : '') +
      '<div class="campo"><label for="p0">PIN actual</label><input id="p0" class="pin" name="actual" type="password" inputmode="numeric" maxlength="10" autocomplete="current-password" required></div>' +
      '<div class="campo"><label for="p1">PIN nuevo (6 a 10 dígitos)</label><input id="p1" class="pin" name="nuevo" type="password" inputmode="numeric" maxlength="10" autocomplete="new-password" required></div>' +
      '<div class="campo"><label for="p2">Repite el PIN nuevo</label><input id="p2" class="pin" name="rep" type="password" inputmode="numeric" maxlength="10" autocomplete="new-password" required></div>' +
      '<div id="msg"></div><button class="btn rel ancho" type="submit">Guardar PIN</button>' +
      (forzado ? '<button class="btn gr ancho" type="button" data-a="salir">Cerrar sesión</button>' : '') + '</form></main>';
  }

  // ---------- CONTADOR / lista de unidades ----------
  function agrupar(un) {
    var tabs = [], naves = {}, hayTorres = false;
    un.forEach(function (u) {
      if (u.tipo === 'torre') hayTorres = true; else naves[u.nave] = 1;
    });
    if (hayTorres) tabs.push({ id: 'MOD', nombre: 'Modula' });
    Object.keys(naves).sort(ordenNat).forEach(function (n) { tabs.push({ id: 'N' + n, nombre: 'Nave ' + n }); });
    return tabs;
  }
  function unidadesDeTab(un, tab) {
    return un.filter(function (u) { return tab === 'MOD' ? u.tipo === 'torre' : (u.tipo !== 'torre' && 'N' + u.nave === tab); })
      .sort(function (a, b) { return ordenNat(a.tipo === 'torre' ? a.torre : a.pasillo, b.tipo === 'torre' ? b.torre : b.pasillo); });
  }
  function filaUnidad(u, modo, bloqueado) {
    var torre = u.tipo === 'torre', rotulo = torre ? u.torre : u.pasillo;
    var cls = 'u' + (u.mia ? ' mia' : '') + (u.estado === 'Cerrado' || u.estado === 'Ajustado' ? ' cerrado' : '') + (u.estado === 'En conteo' && !u.mia ? ' otro' : '');
    var det = torre ? (u.udcs + ' UDC · ' + u.filas + ' posiciones') : (u.filas + ' posiciones');
    var sub, acc = '';
    if (u.estado === 'En conteo') sub = '<b>En conteo</b> · ' + esc(u.mia ? 'tú' : u.operador); else sub = esc(det);
    if (u.estado === 'En conteo') det = det + (u.ultimo_movimiento ? ' · ' + hace(u.ultimo_movimiento) : '');
    if (modo === 'contador') {
      if (u.mia) acc = '<button class="btn rel" data-a="tomar" data-id="' + esc(u.id) + '">Continuar</button>';
      else if (u.estado === 'Pendiente') acc = '<button class="btn" data-a="pedirTomar" data-id="' + esc(u.id) + '"' + (bloqueado ? ' disabled' : '') + '>Tomar</button>';
      else if (u.estado === 'Cerrado' || u.estado === 'Ajustado' || u.estado === 'En ajuste') acc = '<span class="est ok">' + esc(u.estado) + '</span>';
      else acc = '<span class="est">Bloqueado</span>';
    } else if (modo === 'admin') {
      var hechas = S.av && S.av.contadas ? (S.av.contadas[u.id] || 0) : null, id = esc(u.id);
      if (hechas !== null && (u.estado === 'En conteo' || u.estado === 'Cerrado')) sub += ' · ' + hechas + ' de ' + u.filas;
      if (u.estado === 'En conteo') acc = '<div class="acc"><button class="btn peq" data-a="pedirCerrarAdm" data-id="' + id + '">Cerrar</button><button class="btn gr peq" data-a="verCambios" data-id="' + id + '">Cambios</button><button class="btn pel peq" data-a="pedirLiberar" data-id="' + id + '">Liberar</button></div>';
      else if (u.estado === 'Cerrado') acc = '<div class="acc"><span class="est ok">Cerrado</span><button class="btn gr peq" data-a="verCambios" data-id="' + id + '">Cambios</button><button class="btn peq" data-a="pedirReabrir" data-id="' + id + '">Reabrir</button></div>';
      else acc = '<span class="est' + (u.estado === 'Pendiente' ? '' : ' ok') + '">' + esc(u.estado) + '</span>';
    } else { acc = '<span class="est' + (u.estado === 'Pendiente' ? '' : ' ok') + '">' + esc(u.estado) + '</span>'; }
    return '<li class="' + cls + '"><div class="letra' + (torre ? ' torre' : '') + '" aria-hidden="true">' + esc(rotulo) + '</div>' +
      '<div class="info"><div class="nom">' + esc(torre ? ('Torre ' + u.torre) : ('Pasillo ' + u.pasillo) + (u.zona ? ' · ' + u.zona.charAt(0) + u.zona.slice(1).toLowerCase() : '')) + '</div><div class="det">' + sub + (u.estado === 'En conteo' ? ' · ' + esc(hace(u.ultimo_movimiento)) : '') + '</div></div>' + acc + '</li>';
  }
  function vacioToma() {
    return '<div class="vacio"><h2>No hay nada por hacer</h2><p>Todavía no hay una toma de inventario abierta. Cuando el administrador la abra, aparecerá aquí.</p><button class="btn" data-a="recargar">Actualizar</button></div>';
  }
  function resumenBarra(un) {
    var tot = un.length, cer = un.filter(function (u) { return u.estado === 'Cerrado' || u.estado === 'En ajuste' || u.estado === 'Ajustado'; }).length;
    var seg = un.length > 80 ? '' : un.map(function (u) { return '<i class="' + (u.estado === 'Pendiente' ? '' : u.estado === 'En conteo' ? 'a' : 'v') + '"></i>'; }).join('');
    return '<section class="resumen"><h2>' + cer + ' de ' + tot + ' cerradas</h2><div class="sub">' + (tot - cer) + ' por contar</div>' +
      (seg ? '<div class="barra" aria-hidden="true">' + seg + '</div>' : '') + '</section>';
  }
  function listaPorTabs(modo) {
    var un = S.datos.unidades, tabs = agrupar(un);
    if (!tabs.length) return vacioToma();
    if (!S.tab || !tabs.some(function (t) { return t.id === S.tab; })) {
      var mia = un.filter(function (u) { return u.mia; })[0];
      S.tab = mia ? (mia.tipo === 'torre' ? 'MOD' : 'N' + mia.nave) : tabs[0].id; S.zona = null;
    }
    var lista = unidadesDeTab(un, S.tab), zonas = [];
    lista.forEach(function (u) { if (u.zona && u.tipo !== 'torre' && zonas.indexOf(u.zona) < 0) zonas.push(u.zona); });
    if (zonas.length > 1) { if (!S.zona || zonas.indexOf(S.zona) < 0) S.zona = zonas[0]; lista = lista.filter(function (u) { return u.zona === S.zona; }); }
    var miUnidad = un.filter(function (u) { return u.mia; })[0], bloqueado = modo === 'contador' && !!miUnidad;
    return '<nav class="tabs" role="tablist">' + tabs.map(function (t) { return '<button class="tab" role="tab" aria-selected="' + (t.id === S.tab) + '" data-a="tab" data-id="' + t.id + '">' + esc(t.nombre) + '</button>'; }).join('') + '</nav>' +
      (zonas.length > 1 ? '<div class="seg" role="group">' + zonas.map(function (z) { return '<button aria-pressed="' + (z === S.zona) + '" data-a="zona" data-id="' + z + '">' + z.charAt(0) + z.slice(1).toLowerCase() + '</button>'; }).join('') + '</div>' : '') +
      (bloqueado ? '<div class="aviso" style="margin:12px 14px 0">Tienes en conteo <b>' + esc(miUnidad.nombre) + '</b>. Termínala antes de tomar otra.</div>' : '') +
      '<ul class="lista">' + lista.map(function (u) { return filaUnidad(u, modo, bloqueado); }).join('') + '</ul>' +
      (modo === 'contador' ? '<p class="pie">Un pasillo tomado queda bloqueado para los demás.</p>' : '');
  }
  function vistaContador() {
    var d = S.datos, cuerpo;
    if (!d) cuerpo = cargando(); else if (!d.toma_activa) cuerpo = vacioToma(); else cuerpo = resumenBarra(d.unidades) + listaPorTabs('contador');
    return '<main class="pantalla">' + cabecera('Pasillos', S.ses.usuario + ' · contador') + '<div class="cuerpo">' + cuerpo + '</div></main>';
  }
  // ---------- AJUSTADOR (solo lectura en F1) ----------
  function vistaAjustador() {
    var d = S.datos, cuerpo;
    if (!d) cuerpo = cargando(); else if (!d.toma_activa) cuerpo = vacioToma(); else cuerpo = resumenBarra(d.unidades) + listaPorTabs('lectura') + '<p class="pie">Aquí verás las posiciones confirmadas para ajustar en las próximas fases.</p>';
    return '<main class="pantalla">' + cabecera('Avance', S.ses.usuario + ' · ajustador') + '<div class="cuerpo">' + cuerpo + '</div></main>';
  }

  // ---------- ADMINISTRADOR ----------
  var ICONOS = {
    avance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    carga: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>',
    usuarios: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M17 4.5a3.5 3.5 0 010 7M21.5 20c0-2.8-1.5-4.7-3.8-5.6"/></svg>',
    historial: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 109-9 9 9 0 00-7 3.4M3 4v4h4M12 7v5l3 2"/></svg>'
  };
  function navAdmin() {
    var t = [['avance', 'Avance'], ['carga', 'Carga'], ['usuarios', 'Usuarios'], ['historial', 'Historial']];
    return '<nav class="nav" role="tablist">' + t.map(function (x) { return '<button role="tab" aria-selected="' + (S.adminTab === x[0]) + '" data-a="admtab" data-id="' + x[0] + '">' + ICONOS[x[0]] + x[1] + '</button>'; }).join('') + '</nav>';
  }
  function adminAvance() {
    var d = S.datos; if (!d) return cargando(); if (!d.toma_activa) return vacioToma().replace('Cuando el administrador la abra, aparecerá aquí.', 'Ve a la pestaña Carga para validar los datos y abrir la toma.');
    var un = d.unidades, c = { Pendiente: 0, 'En conteo': 0, cer: 0 };
    un.forEach(function (u) { if (u.estado === 'Pendiente') c.Pendiente++; else if (u.estado === 'En conteo') c['En conteo']++; else c.cer++; });
    var tabs = agrupar(un), secciones = tabs.map(function (t) {
      return '<div class="sec">' + esc(t.nombre) + '</div><ul class="lista">' + unidadesDeTab(un, t.id).map(function (u) { return filaUnidad(u, 'admin'); }).join('') + '</ul>';
    }).join('');
    var av = S.av, tot = av ? '<section class="resumen"><h2>' + av.total_contadas + ' de ' + av.total_filas + ' posiciones contadas</h2><div class="sub">' + (av.total_filas ? Math.round(av.total_contadas * 100 / av.total_filas) : 0) + ' % de la toma</div><div class="prbar"><i style="width:' + (av.total_filas ? Math.min(100, Math.round(av.total_contadas * 100 / av.total_filas)) : 0) + '%"></i></div></section>' : '';
    var ops = av && av.operadores && av.operadores.length ? '<div class="sec">Contadores</div><ul class="lista">' + av.operadores.map(function (o) {
      return '<li class="fila"><div class="info"><div class="nom">' + esc(o.usuario) + '</div><div class="det">' + o.en_conteo + ' en conteo · ' + o.cerradas + ' cerradas</div></div><b class="mono">' + o.posiciones + '</b></li>'; }).join('') + '</ul>' : '';
    return resumenBarra(un) + tot + '<div class="tarjetas"><div class="tj"><small>Pendientes</small><b>' + c.Pendiente + '</b></div><div class="tj amb"><small>En conteo</small><b>' + c['En conteo'] + '</b></div>' +
      '<div class="tj ver"><small>Cerradas</small><b>' + c.cer + '</b></div><div class="tj"><small>Unidades</small><b>' + un.length + '</b></div></div>' + ops + secciones;
  }
  function adminCarga() {
    var d = S.datos, abierta = d && d.toma_activa, inf = S.informe, h = '<div class="form">';
    if (!d) return cargando();
    if (abierta) {
      h += '<div class="ok"><b>Hay una toma abierta</b> con ' + d.unidades.length + ' unidades.</div>' +
        '<div class="aviso">Para sumar más naves o pasillos: cárgalos en el Google Sheet, valida y toca <b>Agregar a la toma</b>. Lo que ya se está contando no se toca.</div>';
    } else {
      h += '<div class="aviso">Antes de abrir la toma, valida los datos de las pestañas MODULA y MINORISTA Y MAYORISTA del Google Sheet.</div>';
    }
    h += '<button class="btn amb ancho" data-a="validar"' + (S.ocupado ? ' disabled' : '') + '>' + (S.ocupado ? 'Validando…' : 'Validar datos') + '</button>';
    if (inf) {
      h += '<div class="tarjetas" style="padding:0"><div class="tj"><small>Filas leídas</small><b>' + inf.informe.filas_leidas + '</b></div><div class="tj"><small>Unidades</small><b>' + inf.informe.unidades_conteo + '</b></div>' +
        '<div class="tj"><small>Pasillos</small><b>' + inf.informe.pasillos + '</b></div><div class="tj"><small>Torres Modula</small><b>' + inf.informe.torres + '</b></div></div>';
      if (inf.informe.errores.length) {
        h += '<div class="err"><b>' + inf.informe.errores.length + ' error(es) que corregir:</b><ul style="margin:8px 0 0;padding-left:18px">' +
          inf.informe.errores.slice(0, 30).map(function (e) { return '<li>' + esc(e.hoja) + (e.fila ? ' · fila ' + esc(e.fila) : '') + ': ' + esc(e.msg) + '</li>'; }).join('') + '</ul>' +
          (inf.informe.errores.length > 30 ? '<div style="margin-top:6px">…y ' + (inf.informe.errores.length - 30) + ' más.</div>' : '') + '</div>';
      } else if (abierta && inf.previa) {
        var pv = inf.previa;
        h += '<div class="ok">' + (pv.nuevas || pv.actualizar ? 'Se agregarán <b>' + pv.nuevas + '</b> unidades nuevas (' + pv.filas_nuevas + ' posiciones)' + (pv.actualizar ? ' y se actualizarán <b>' + pv.actualizar + '</b> pendientes' : '') + '.' : 'No hay unidades nuevas para agregar.') +
          (pv.intactas ? ' <b>' + pv.intactas + '</b> ya están en curso o cerradas y no se tocan.' : '') + '</div>';
      } else {
        h += '<div class="ok">Los datos están bien.' + (abierta ? '' : ' Puedes abrir la toma.') + '</div>';
      }
      if (inf.informe.advertencias.length) {
        h += '<div class="sec" style="padding:6px 0">Avisos (no bloquean)</div>' + inf.informe.advertencias.map(function (a) {
          return '<div class="fila" style="padding:8px 0"><div class="info">' + esc(a.texto) + '</div><b class="mono">' + esc(a.cantidad) + '</b></div>'; }).join('');
      }
      if (abierta) h += '<button class="btn rel ancho" data-a="pedirAgregar"' + (inf.ok && inf.previa && (inf.previa.nuevas || inf.previa.actualizar) ? '' : ' disabled') + '>Agregar a la toma</button>';
      else h += '<button class="btn rel ancho" data-a="pedirAbrir"' + (inf.ok ? '' : ' disabled') + '>Abrir toma</button>';
    }
    if (abierta) h += '<div class="sec" style="padding:14px 0 6px">Terminar todo el inventario</div><p class="pie" style="padding:0 0 8px">Cierra la toma cuando ya no se vaya a contar más. Lo contado se copia a la pestaña archivo_conteos antes de abrir otra toma.</p><button class="btn pel ancho" data-a="pedirCerrarToma">Cerrar toma</button>';
    return h + '</div>';
  }
  function adminUsuarios() {
    if (!S.usuarios) return cargando();
    return '<div style="padding:12px 14px"><button class="btn rel ancho" data-a="nuevoUsuario">Nuevo usuario</button></div>' + '<ul class="lista">' + S.usuarios.map(function (u) {
      var act = esActivo(u.activo), yo = u.usuario === S.ses.usuario, bloq = !!u.bloqueado;
      return '<li class="fila"><div class="info"><div class="nom">' + esc(u.usuario) + '<span class="pill ad">' + esc(u.rol) + '</span>' + (!act ? '<span class="pill rj">Inactivo</span>' : '') + (bloq ? '<span class="pill am">Bloqueado</span>' : '') + '</div>' +
        '<div class="det">Último acceso: ' + esc(fecha(u.ultimo_acceso)) + '</div></div><div class="acc">' +
        (bloq ? '<button class="btn peq" data-a="desbloquear" data-id="' + esc(u.usuario) + '">Desbloquear</button>' : '') +
        '<button class="btn peq gr" data-a="pedirReset" data-id="' + esc(u.usuario) + '">Nuevo PIN</button>' +
        (yo ? '' : '<button class="btn peq ' + (act ? 'pel' : '') + '" data-a="activar" data-id="' + esc(u.usuario) + '" data-v="' + (act ? 0 : 1) + '">' + (act ? 'Desactivar' : 'Activar') + '</button>') + '</div></li>';
    }).join('') + '</ul>';
  }
  function adminHistorial() {
    var h = '<form class="buscar" data-f="hist"><input type="search" name="q" placeholder="Filtrar por acción (ej. Tomó, Abrió)" value="' + esc(S.filtroHist) + '" aria-label="Filtrar historial"></form>';
    if (!S.historial) return h + cargando();
    if (!S.historial.length) return h + '<div class="vacio"><p>Sin eventos todavía.</p></div>';
    return h + '<ul class="lista hist">' + S.historial.map(function (e) {
      return '<li class="fila"><div class="info"><div class="nom">' + esc(e.accion) + '</div><div class="det">' + esc(e.usuario) + (e.detalle ? ' · ' + esc(e.detalle) : '') + '</div><div class="t">' + esc(fecha(e.ts)) + '</div></div></li>'; }).join('') + '</ul>';
  }
  function vistaAdmin() {
    var t = { avance: 'Avance', carga: 'Carga de datos', usuarios: 'Usuarios', historial: 'Historial' }[S.adminTab];
    var c = S.adminTab === 'avance' ? adminAvance() : S.adminTab === 'carga' ? adminCarga() : S.adminTab === 'usuarios' ? adminUsuarios() : adminHistorial();
    return '<main class="pantalla">' + cabecera(t, S.ses.usuario + ' · administrador') + '<div class="cuerpo">' + c + '</div>' + navAdmin() + '</main>';
  }

  // ======================================================================
  // CONTEO (F2a): guardar en el celular primero, enviar al Sheet en segundo plano
  // ======================================================================
  var CM = {};                                    // conteos locales: clave unidad|fila -> {k,fila,unidad,c,v,t,sync,usuario}  sync: 0 pendiente, 1 enviado, 2 rechazado
  var CT = { toma: '', datos: null, udc: null, filtro: 'todas', perdida: '', fuera: false };
  var SY = { timer: null, enCurso: false, fallos: 0, bloq: {} };
  var IDB = null, IDB_LISTO = null;

  function dbAbrir() {
    if (IDB_LISTO) return IDB_LISTO;
    IDB_LISTO = new Promise(function (ok) {
      try {
        var rq = indexedDB.open('inventario', 1);
        rq.onupgradeneeded = function () { var d = rq.result; d.createObjectStore('conteos', { keyPath: 'k' }); d.createObjectStore('pos', { keyPath: 'unidad' }); };
        rq.onsuccess = function () { IDB = rq.result; ok(IDB); };
        rq.onerror = function () { ok(null); };
        rq.onblocked = function () { ok(null); };
      } catch (e) { ok(null); }
    });
    return IDB_LISTO;
  }
  function dbPut(store, obj) {
    return dbAbrir().then(function (d) { if (!d) return; return new Promise(function (ok) { try { var tx = d.transaction(store, 'readwrite'); tx.objectStore(store).put(obj); tx.oncomplete = tx.onerror = tx.onabort = function () { ok(); }; } catch (e) { ok(); } }); });
  }
  function dbTodo(store) {
    return dbAbrir().then(function (d) { if (!d) return []; return new Promise(function (ok) { try { var rq = d.transaction(store).objectStore(store).getAll(); rq.onsuccess = function () { ok(rq.result || []); }; rq.onerror = function () { ok([]); }; } catch (e) { ok([]); } }); });
  }
  function dbUno(store, key) {
    return dbAbrir().then(function (d) { if (!d) return null; return new Promise(function (ok) { try { var rq = d.transaction(store).objectStore(store).get(key); rq.onsuccess = function () { ok(rq.result || null); }; rq.onerror = function () { ok(null); }; } catch (e) { ok(null); } }); });
  }
  /** Al entrar: recupera lo que este usuario dejó sin enviar (por ejemplo, si se cerró la app sin señal). */
  function cargarLocal() {
    CM = {};
    return dbTodo('conteos').then(function (l) {
      l.forEach(function (e) { if (S.ses && e.usuario === S.ses.usuario) CM[e.k] = e; });
      pintarChip(); if (pendientes().length) { programarFlush(); flush(); }
    });
  }
  function pendientes() { var u = S.ses && S.ses.usuario; return Object.keys(CM).map(function (k) { return CM[k]; }).filter(function (e) { return e.sync === 0 && e.usuario === u; }); }

  function fmtVcto(v) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : (v || ''); }
  function prepararFilas(d) {
    var f = d.filas, i = 0;
    while (i < f.length) {                                         // posiciones repetidas seguidas (misma UDC y POS): "1 de 2"
      var j = i; while (j + 1 < f.length && f[j + 1].udc === f[i].udc && f[j + 1].pos === f[i].pos) j++;
      for (var k = i; k <= j; k++) f[k].rep = (j > i) ? (k - i + 1) + ' de ' + (j - i + 1) : '';
      i = j + 1;
    }
    d.filas.forEach(function (x) { x.blanco = !x.codigo; });
  }
  function entradaDe(fila) { return CM[S.unidadActual + '|' + fila]; }
  function alcance() {
    var f = CT.datos ? CT.datos.filas : [];
    if (CT.datos && CT.datos.unidad.tipo === 'torre' && CT.udc) f = f.filter(function (x) { return x.udc === CT.udc; });
    return f;
  }
  function contadas(lista) { return lista.filter(function (x) { return entradaDe(x.id); }).length; }

  // ---------- abrir / cargar ----------
  function abrirConteo(id) {
    S.unidadActual = id; S.vista = 'contar'; CT.udc = null; CT.filtro = 'todas'; CT.perdida = ''; CT.fuera = false; S.errCarga = '';
    delete SY.bloq[id];
    if (!CT.datos || CT.datos.unidad.id !== id) CT.datos = null;
    render(); window.scrollTo(0, 0);
    cargarCatalogo();
    return cargarConteo();
  }
  // Lo contado en una toma anterior (el administrador la reabrió) no debe mezclarse con la nueva.
  function dbBorrar(store, key) { return dbAbrir().then(function (d) { if (!d) return; return new Promise(function (ok) { try { var tx = d.transaction(store, 'readwrite'); tx.objectStore(store).delete(key); tx.oncomplete = tx.onerror = tx.onabort = function () { ok(); }; } catch (e) { ok(); } }); }); }
  function descartarUnidad(id) { Object.keys(CM).forEach(function (k) { if (CM[k].unidad === id) { delete CM[k]; dbBorrar('conteos', k); } }); }
  function purgarOtraToma(id, toma) {
    if (!toma) return;
    var hay = false; Object.keys(CM).forEach(function (k) { var e = CM[k]; if (e.unidad === id && e.toma !== toma) { delete CM[k]; dbBorrar('conteos', k); hay = true; } });
    if (hay) pintarChip();
  }
  function fusionar(id, srv, toma) {
    Object.keys(srv || {}).forEach(function (fila) {
      var s = srv[fila], k = id + '|' + fila, l = CM[k];
      if (!l || Number(s.t) > l.t) { CM[k] = { k: k, fila: fila, unidad: id, c: Number(s.c), v: s.v ? 1 : 0, t: Number(s.t), sync: 1, usuario: S.ses.usuario, toma: toma };
      if (s.o) CM[k].o = s.o; if (s.k) { CM[k].cod = s.k; CM[k].lot = s.l || ''; CM[k].vc = s.x || ''; } dbPut('conteos', CM[k]); }
    });
  }
  function cargarConteo() {
    var id = S.unidadActual;
    function usar(d, desdeCache) {
      prepararFilas(d); CT.datos = d; if (d.toma) CT.toma = d.toma; CT.fuera = !!desdeCache; S.errCarga = '';
      if (S.vista === 'contar' && S.unidadActual === id) { render(); }
    }
    function cache(motivo) {
      return dbUno('pos', id).then(function (c) {
        if (c && c.usuario === S.ses.usuario) { usar({ unidad: c.info, filas: c.filas, toma: c.toma }, true); return { ok: true, cache: true }; }
        S.errCarga = motivo; if (S.vista === 'contar') render(); return { ok: false };
      });
    }
    if (!navigator.onLine) return cache('Sin conexión y esta unidad aún no se guardó en el celular. Conéctate una vez para descargarla.');
    return api('posicionesUnidad', { id: id }).then(function (r) {
      if (r.ok) {
        purgarOtraToma(id, r.toma); fusionar(id, r.conteos, r.toma); usar({ unidad: r.unidad, filas: r.filas, toma: r.toma }, false);
        dbPut('pos', { unidad: id, info: r.unidad, filas: r.filas, usuario: S.ses.usuario, toma: r.toma });
        pintarChip(); programarFlush(); return r;
      }
      if (r.error === 'no_tuya' || r.error === 'cerrada' || r.error === 'sin_toma' || r.error === 'no_existe') { CT.perdida = r.mensaje; CT.datos = null; if (S.vista === 'contar') render(); return r; }
      if (r.error === 'red') return cache(r.mensaje);
      S.errCarga = r.mensaje || 'No se pudo cargar.'; if (S.vista === 'contar') render(); return r;
    });
  }

  // ---------- pantalla ----------
  function chipTxt() {
    var p = pendientes().length;
    if (!S.online) return { t: 'Sin conexión' + (p ? ' · ' + p : ''), c: 'chip off' };
    if (p) return { t: p + ' sin enviar', c: 'chip pen' };
    return { t: S.vista === 'contar' ? 'Guardado' : 'En línea', c: 'chip' };
  }
  function pintarChip() { var e = document.getElementById('chip'); if (!e) return; var c = chipTxt(); e.textContent = c.t; e.className = c.c; }

  // ---------- vencimiento, catálogo y datos que se muestran en cada posición ----------
  var DIAS_ALERTA = 30;
  function diasHasta(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); if (!m) return null;
    var hoy = new Date(), a = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()), b = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    return Math.round((b - a) / 86400000);
  }
  function vencCorto(iso) { var d = diasHasta(iso); return d !== null && d < DIAS_ALERTA; }
  function vencTxt(iso) {
    var d = diasHasta(iso); if (d === null || d >= DIAS_ALERTA) return '';
    if (d < 0) return '<span class="venc rojo">Vencido hace ' + (-d) + (d === -1 ? ' día' : ' días') + '</span>';
    if (d === 0) return '<span class="venc rojo">Vence hoy</span>';
    return '<span class="venc">Vence en ' + d + (d === 1 ? ' día' : ' días') + '</span>';
  }
  var CAT = { barras: {}, desc: {}, n: {}, listo: false, cargando: false };
  function indexarCat() { CAT.n = {}; Object.keys(CAT.barras).forEach(function (b) { CAT.n[b.replace(/^0+/, '')] = CAT.barras[b]; }); }
  function cargarCatalogo() {
    if (CAT.listo || CAT.cargando) return Promise.resolve();
    CAT.cargando = true;
    return dbUno('pos', '__cat').then(function (c) {
      if (c && c.usuario === S.ses.usuario && !CAT.listo) { CAT.barras = c.barras || {}; CAT.desc = c.desc || {}; indexarCat(); CAT.listo = true; refrescarDescs(); }
      if (!navigator.onLine) { CAT.cargando = false; return; }
      return api('articulos').then(function (r) {
        CAT.cargando = false;
        if (r.ok) { CAT.barras = r.barras || {}; CAT.desc = r.desc || {}; indexarCat(); CAT.listo = true; dbPut('pos', { unidad: '__cat', usuario: S.ses.usuario, barras: CAT.barras, desc: CAT.desc }); refrescarDescs(); }
      });
    });
  }
  function descDe(cod) {
    if (CAT.desc[cod]) return CAT.desc[cod];
    var f = (CT.datos ? CT.datos.filas : []).filter(function (x) { return x.codigo === cod && x.descripcion; })[0];
    return f ? f.descripcion : '';
  }
  /** Código leído (barras de unidad o de caja, o el propio código del artículo) -> {a: artículo, caja: bool} */
  function resolverCodigo(v) {
    v = String(v || '').trim(); if (!v) return null;
    var r = CAT.barras[v] || CAT.n[v.replace(/^0+/, '')];
    if (r) return { a: r[0], caja: !!r[1] };
    if (CAT.desc[v] || descDe(v)) return { a: v, caja: false };
    return null;
  }
  /** Lo que se muestra en la posición: lo del sistema, o lo que registró el operario en una posición sin artículo. */
  function datosFila(f) {
    var e = entradaDe(f.id);
    if (f.blanco && e && e.cod) return { codigo: e.cod, desc: descDe(e.cod), lote: e.lot, vcto: e.vc, reg: true };
    return { codigo: f.codigo, desc: f.descripcion, lote: f.lote, vcto: f.vcto, reg: false };
  }
  function datHtml(f) {
    var d = datosFila(f), e = entradaDe(f.id), h;
    if (f.blanco && !d.reg) {
      h = '<div class="sinart">Sin artículo registrado</div><div class="lv">Lote <b>—</b> · Vcto <b>—</b></div><button class="regbtn" data-a="registrar" data-id="' + esc(f.id) + '">Registrar producto</button>';
    } else {
      h = '<div class="cod"><b>' + esc(d.codigo) + '</b>' + (d.reg ? '<span class="pill am">Registrado por ti</span>' : '') + '</div><div class="desc">' + esc(d.desc || (d.reg ? 'Artículo sin descripción' : '')) + '</div>' +
        '<div class="lv">Lote <b>' + esc(d.lote || '—') + '</b> · Vcto <b>' + esc(d.vcto ? fmtVcto(d.vcto) : '—') + '</b> ' + vencTxt(d.vcto) + '</div>';
      if (d.reg) h += '<button class="regbtn" data-a="registrar" data-id="' + esc(f.id) + '">Editar registro</button>';
    }
    if (e && e.o) h += '<div class="obs">Obs: ' + esc(e.o) + '</div>';
    return h;
  }
  function refrescarDescs() {
    if (!CT.datos || S.vista !== 'contar') return;
    CT.datos.filas.forEach(function (f) { if (f.blanco && entradaDe(f.id) && entradaDe(f.id).cod) { var li = document.querySelector('li.fc[data-fila="' + f.id + '"] .dat'); if (li) li.innerHTML = datHtml(f); } });
  }

  function filaHtml(f) {
    var e = entradaDe(f.id), val = e ? String(e.c) : '', cls = 'fc' + (e ? ' hecha' : '') + (f.blanco && !(e && e.cod) ? ' blanco' : '') + (e && e.v ? ' vacia' : '');
    return '<li class="' + cls + '" data-fila="' + esc(f.id) + '">' +
      '<div class="pos" aria-label="Posición ' + esc(f.pos) + '">' + esc(f.pos) + (f.rep ? '<small>' + esc(f.rep) + '</small>' : '') + '</div>' +
      '<div class="dat">' + datHtml(f) + '</div>' +
      '<div class="ent"><input class="q" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" enterkeyhint="next" data-q="' + esc(f.id) + '" value="' + esc(val) + '" placeholder="0" aria-label="Cantidad posición ' + esc(f.pos) + '">' +
      '<button class="vac" data-a="vacia" data-id="' + esc(f.id) + '">Vacía</button></div></li>';
  }
  function progresoHtml(lista, tit) {
    var n = contadas(lista), t = lista.length, pct = t ? Math.round(n * 100 / t) : 0;
    return '<section class="resumen" id="prog"><h2>' + n + ' de ' + t + ' contadas</h2><div class="sub">' + esc(tit) + '</div><div class="prbar"><i style="width:' + pct + '%"></i></div></section>';
  }
  function vistaContar() {
    var d = CT.datos, u = d && d.unidad, torre = u && u.tipo === 'torre';
    var titulo = u ? (torre ? 'Torre ' + u.torre : 'Pasillo ' + u.pasillo) : (nombreUnidad(unidadPorId(S.unidadActual)) || 'Conteo');
    var sub = u ? (torre ? 'Modula' : 'Nave ' + u.nave + (u.zona ? ' · ' + u.zona.charAt(0) + u.zona.slice(1).toLowerCase() : '')) : '';
    if (torre && CT.udc) sub = 'UDC ' + CT.udc;
    var cuerpo;
    if (CT.perdida) cuerpo = '<div class="vacio"><h2>' + (/cerrada/.test(CT.perdida) ? 'Esta unidad está cerrada' : 'Esta unidad ya no es tuya') + '</h2><p>' + esc(CT.perdida) + '</p>' + (pendientes().filter(function (e) { return e.unidad === S.unidadActual; }).length ? '<p>Lo que contaste sin enviar queda guardado en este celular. Avisa al administrador.</p>' : '') + '<button class="btn rel" data-a="atras">Volver a la lista</button></div>';
    else if (S.errCarga && !d) cuerpo = cargando();
    else if (!d) cuerpo = cargando();
    else if (torre && !CT.udc) cuerpo = cuerpoUdcs(d);
    else cuerpo = cuerpoPosiciones(d, torre);
    return '<main class="pantalla">' + cabecera(titulo, sub + (sub ? ' · ' : '') + S.ses.usuario, torre, true) + '<div class="cuerpo">' + cuerpo + '</div></main>';
  }
  function cuerpoUdcs(d) {
    var orden = [], mapa = {};
    d.filas.forEach(function (f) { if (!mapa[f.udc]) { mapa[f.udc] = []; orden.push(f.udc); } mapa[f.udc].push(f); });
    return (CT.fuera ? '<div class="aviso" style="margin:12px 14px 0">Sin conexión: se muestran los datos guardados en tu celular.</div>' : '') + progresoHtml(d.filas, 'Elige una UDC (bandeja)') +
      '<ul class="lista">' + orden.map(function (udc) {
        var l = mapa[udc], n = contadas(l), ok = n === l.length;
        return '<li class="u' + (ok ? ' cerrado' : '') + '"><div class="letra torre" aria-hidden="true">' + esc(String(udc).slice(-3)) + '</div><div class="info"><div class="nom">UDC ' + esc(udc) + '</div><div class="det">' + n + ' de ' + l.length + ' posiciones</div></div><button class="btn' + (ok ? ' gr' : ' rel') + '" data-a="udc" data-id="' + esc(udc) + '">' + (ok ? 'Revisar' : (n ? 'Seguir' : 'Contar')) + '</button></li>';
      }).join('') + '</ul>' + botonCerrar();
  }
  function cuerpoPosiciones(d, torre) {
    var f = alcance(), h = '', ult = null;
    f.forEach(function (x) {
      if (!torre) { var g = x.celda + '|' + x.udc; if (g !== ult) { ult = g; h += '<li class="grupo">' + (x.celda ? 'Celda <b>' + esc(x.celda) + '</b> · ' : '') + 'UDC <b>' + esc(x.udc) + '</b></li>'; } }
      h += filaHtml(x);
    });
    return (CT.fuera ? '<div class="aviso" style="margin:12px 14px 0">Sin conexión: se muestran los datos guardados en tu celular.</div>' : '') +
      progresoHtml(f, torre ? 'Escribe la cantidad o toca Vacía' : 'Escribe la cantidad o toca Vacía en cada posición') +
      (camaraDisponible() ? '<div class="barra-esc"><button class="btn gr ancho" data-a="escanear"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M7 12h10"/></svg> Escanear artículo</button></div>' : '') +
      '<div class="seg" role="group"><button data-a="filtro" data-id="todas" aria-pressed="' + (CT.filtro === 'todas') + '">Todas</button><button data-a="filtro" data-id="pend" aria-pressed="' + (CT.filtro === 'pend') + '">Pendientes</button></div>' +
      '<ul class="lista pos-lista' + (CT.filtro === 'pend' ? ' solopend' : '') + '" id="posl">' + h + '</ul>' +
      '<p class="pie">Se guarda en tu celular al instante y se envía sola. Si una posición está vacía, toca <b>Vacía</b>.</p>' + (torre ? '' : botonCerrar());
  }
  function botonCerrar() {
    var u = CT.datos && CT.datos.unidad; if (!u) return '';
    return '<div class="cierre"><button class="btn rel ancho" data-a="pedirCerrar">Terminar y cerrar ' + (u.tipo === 'torre' ? 'torre' : 'pasillo') + '</button></div>';
  }

  // ---------- registrar un conteo ----------
  function pintarFila(fila) {
    var li = document.querySelector('li.fc[data-fila="' + fila + '"]'); if (!li) return;
    var e = entradaDe(fila), f0 = filaDatos(fila); li.classList.toggle('hecha', !!e); li.classList.toggle('vacia', !!(e && e.v)); if (f0) { li.classList.toggle('blanco', !!(f0.blanco && !(e && e.cod))); var dd = li.querySelector('.dat'); if (dd) dd.innerHTML = datHtml(f0); }
    var inp = li.querySelector('input'); if (inp && e && document.activeElement !== inp) inp.value = String(e.c);
    if (inp && e && document.activeElement === inp && inp.value !== String(e.c)) inp.value = String(e.c);
    var p = document.getElementById('prog'); if (p && CT.datos) { var a = alcance(), n = contadas(a), pct = a.length ? Math.round(n * 100 / a.length) : 0; p.querySelector('h2').textContent = n + ' de ' + a.length + ' contadas'; p.querySelector('.prbar i').style.width = pct + '%'; }
  }
  function ponerConteo(fila, c, v, extra) {
    var k = S.unidadActual + '|' + fila, prev = CM[k]; extra = extra || {};
    var o = extra.o !== undefined ? extra.o : (prev && prev.o ? prev.o : '');
    var cod = '', lot = '', vc = '';
    if (extra.cod) { cod = extra.cod; lot = extra.lot || ''; vc = extra.vc || ''; }
    else if (prev && prev.cod && c > 0 && !v && extra.mantener) { cod = prev.cod; lot = prev.lot; vc = prev.vc; }
    if (prev && prev.c === c && prev.v === v && (prev.o || '') === o && (prev.cod || '') === cod && (prev.lot || '') === lot && (prev.vc || '') === vc) return;
    var t = Math.max(Date.now(), prev ? prev.t + 1 : 0);
    var e = { k: k, fila: fila, unidad: S.unidadActual, c: c, v: v, t: t, sync: 0, usuario: S.ses.usuario, toma: CT.toma };
    if (o) e.o = o; if (cod) { e.cod = cod; e.lot = lot; e.vc = vc; }
    CM[k] = e; dbPut('conteos', e); pintarFila(fila); pintarChip(); programarFlush();
  }
  function filaDatos(id) { return (CT.datos ? CT.datos.filas : []).filter(function (x) { return x.id === id; })[0]; }
  function leerCantidad(inp) {
    var fila = inp.dataset.q, txt = inp.value.trim(), e = entradaDe(fila), f = filaDatos(fila);
    function revertir() { inp.value = e ? String(e.c) : ''; }
    if (txt === '') { revertir(); return; }
    if (!/^\d{1,6}$/.test(txt)) { toast('Escribe solo números enteros.'); revertir(); return; }
    var n = parseInt(txt, 10);
    if (n > 0 && f && f.blanco && !(e && e.cod)) { revertir(); abrirRegistro(fila, { c: n }); return; }          // posición sin artículo: registrar producto
    if (n > 0) {
      var d = f ? datosFila(f) : null, previo = e && e.o ? e.o : '';
      if (d && vencCorto(d.vcto) && !previo) { revertir(); abrirObs(fila, n); return; }
    }
    ponerConteo(fila, n, 0, { mantener: true });
  }

  // ---------- observación obligatoria (vencimiento menor a 30 días) ----------
  function abrirObs(fila, n) {
    var f = filaDatos(fila), d = datosFila(f), dias = diasHasta(d.vcto);
    modal('<h3>' + (dias < 0 ? 'Producto vencido' : 'Revisar fecha de vencimiento') + '</h3><p>' + esc(d.codigo) + ' · Vcto ' + esc(fmtVcto(d.vcto)) + ' (' + (dias < 0 ? 'hace ' + (-dias) + ' d' : dias === 0 ? 'hoy' : 'en ' + dias + ' d') + '). Escribe una observación para guardar ' + n + ' unidades.</p>' +
      '<div class="campo"><label for="obs">Observación</label><input id="obs" maxlength="200" autocomplete="off" placeholder="Ej.: caja golpeada, se separó para devolución"></div><div id="msg"></div>' +
      '<div class="botones"><button class="btn gr" data-a="cerrarModal">Cancelar</button><button class="btn rel" data-a="guardarObs" data-id="' + esc(fila) + '" data-n="' + n + '">Guardar</button></div>', true);
  }

  // ---------- registrar producto en una posición sin artículo ----------
  var REG = { fila: '', cod: '', lot: '', vc: '', c: '', o: '' };
  function abrirRegistro(fila, ini) {
    var e = entradaDe(fila);
    if (ini) { REG = { fila: fila, cod: '', lot: '', vc: '', c: '', o: '' }; if (e && e.cod) { REG.cod = e.cod; REG.lot = e.lot; REG.vc = e.vc; REG.c = String(e.c); REG.o = e.o || ''; } if (ini.c) REG.c = String(ini.c); }
    var f = filaDatos(fila); cargarCatalogo();
    var desc = REG.cod ? descDe(REG.cod) : '';
    modal('<h3>Registrar producto</h3><p>Posición <b>' + esc(f ? f.pos : '') + '</b>. Escribe o escanea el artículo que encontraste.</p>' +
      '<div class="campo"><label for="rk">Código del artículo</label><div class="fila-in"><input id="rk" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="6" value="' + esc(REG.cod) + '">' +
      (camaraDisponible() ? '<button class="btn gr" data-a="escanearReg" type="button">Escanear</button>' : '') + '</div><div class="ayuda" id="rdesc">' + descReg(REG.cod) + '</div></div>' +
      '<div class="campo"><label for="rl">Lote</label><input id="rl" autocomplete="off" maxlength="30" value="' + esc(REG.lot) + '"></div>' +
      '<div class="campo"><label for="rv">Vencimiento</label><input id="rv" type="date" min="2000-01-01" max="2100-12-31" value="' + esc(REG.vc) + '"></div>' +
      '<div class="campo"><label for="rc">Cantidad (unidades)</label><input id="rc" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="6" value="' + esc(REG.c) + '"></div>' +
      '<div class="campo" id="robsw"' + (vencCorto(REG.vc) ? '' : ' hidden') + '><label for="ro">Observación (revisar fecha de vencimiento)</label><input id="ro" maxlength="200" autocomplete="off" value="' + esc(REG.o) + '"></div>' +
      '<div id="msg"></div><div class="botones"><button class="btn gr" data-a="cerrarModal">Cancelar</button><button class="btn rel" data-a="guardarReg" data-id="' + esc(fila) + '">Guardar</button></div>', true);
  }
  function descReg(cod) {
    if (!cod) return '';
    var d = descDe(cod); if (d) return esc(d);
    return CAT.listo ? '<span class="aviso-in">Ese código no está en el sistema. Puedes registrarlo igual.</span>' : '';
  }
  function leerRegistro() {
    var g = function (id) { var x = $capa.querySelector('#' + id); return x ? x.value.trim() : ''; };
    REG.cod = g('rk').toUpperCase(); REG.lot = g('rl'); REG.vc = g('rv'); REG.c = g('rc'); REG.o = g('ro');
  }

  // ---------- cámara: escáner de códigos de barra ----------
  var CAM = { stream: null, timer: 0, activo: false, volver: null };
  function camaraDisponible() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && 'BarcodeDetector' in window); }
  function detenerCamara() {
    CAM.activo = false; clearTimeout(CAM.timer);
    if (CAM.stream) { try { CAM.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} CAM.stream = null; }
  }
  function abrirCamara(titulo, alLeer, alCancelar) {
    if (!camaraDisponible()) { toast('Este celular no permite escanear con la cámara. Escribe el código.'); if (alCancelar) alCancelar(); return; }
    modal('<h3>' + esc(titulo) + '</h3><div class="visor"><video id="cam" playsinline muted autoplay></video><div class="mira" aria-hidden="true"></div></div><p id="camsub">Apunta la cámara al código de barras.</p><div id="msg"></div><div class="botones"><button class="btn gr" data-a="cerrarCamara">Cancelar</button></div>', true);
    CAM.volver = alCancelar || null; CAM.activo = true;
    var det; try { det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'] }); } catch (e) { try { det = new BarcodeDetector(); } catch (e2) { det = null; } }
    if (!det) { mostrarError(null, 'No se pudo iniciar el lector de códigos.'); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false }).then(function (stream) {
      if (!CAM.activo) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      CAM.stream = stream; var v = document.getElementById('cam'); if (!v) return; v.srcObject = stream; var p = v.play(); if (p && p.catch) p.catch(function () {});
      (function ciclo() {
        if (!CAM.activo) return;
        det.detect(v).then(function (cs) {
          if (!CAM.activo) return;
          if (cs && cs.length && cs[0].rawValue) { var val = cs[0].rawValue; try { navigator.vibrate && navigator.vibrate(60); } catch (e) {} detenerCamara(); cerrarModal(); alLeer(val); return; }
          CAM.timer = setTimeout(ciclo, 220);
        }, function () { CAM.timer = setTimeout(ciclo, 400); });
      })();
    }).catch(function () { mostrarError(null, 'No se pudo abrir la cámara. Revisa que la app tenga permiso de cámara.'); });
  }
  /** Escaneo suelto en la lista: ubica el artículo leído y lo marca. */
  function ubicarArticulo(valor) {
    cargarCatalogo().then(function () {
      var r = resolverCodigo(valor);
      if (!r) { toast('Código ' + valor + ' no encontrado en el catálogo.'); return; }
      var todas = CT.datos ? CT.datos.filas : [], enAlc = alcance();
      function coincide(f) { var d = datosFila(f); return d.codigo === r.a; }
      var cand = enAlc.filter(coincide); cand = cand.filter(function (f) { return !entradaDe(f.id); }).concat(cand);
      if (!cand.length) {
        var otra = todas.filter(coincide)[0];
        toast(otra && CT.datos.unidad.tipo === 'torre' ? 'El artículo ' + r.a + ' no está en esta UDC.' : 'El artículo ' + r.a + ' no está en esta unidad. Si lo encontraste en una posición vacía, usa Registrar producto.');
        return;
      }
      var li = document.querySelector('li.fc[data-fila="' + cand[0].id + '"]'); if (!li) return;
      if (CT.filtro === 'pend' && li.classList.contains('hecha')) { CT.filtro = 'todas'; var l = document.getElementById('posl'); if (l) l.classList.remove('solopend'); }
      li.scrollIntoView({ block: 'center' }); li.classList.add('resal'); setTimeout(function () { li.classList.remove('resal'); }, 2600);
      var i = li.querySelector('input'); if (i) { i.focus(); i.select(); }
      toast((r.caja ? 'Código de caja · ' : '') + 'Artículo ' + r.a + (cand.length > 1 ? ' (hay ' + cand.length + ' posiciones)' : ''));
    });
  }

  // ---------- envío en segundo plano ----------
  function programarFlush() {
    var p = pendientes().length; if (!p) return;
    if (p >= 5) { clearTimeout(SY.timer); SY.timer = setTimeout(function () { SY.timer = null; flush(); }, 1200); }
    else if (!SY.timer) SY.timer = setTimeout(function () { SY.timer = null; flush(); }, 30000);
  }
  function flush(forzar) {
    if (SY.enCurso || !S.ses) return Promise.resolve();
    if (!navigator.onLine) { pintarChip(); return Promise.resolve(); }
    var por = {}; pendientes().forEach(function (e) { if (!SY.bloq[e.unidad]) (por[e.unidad] = por[e.unidad] || []).push(e); });
    var unidades = Object.keys(por); if (!unidades.length) { pintarChip(); return Promise.resolve(); }
    SY.enCurso = true; clearTimeout(SY.timer); SY.timer = null;
    function siguiente(ui) {
      if (ui >= unidades.length) return Promise.resolve(true);
      var uid = unidades[ui], lista = por[uid].sort(function (a, b) { return a.t - b.t; });
      function lote(i) {
        if (i >= lista.length) return Promise.resolve(true);
        var parte = lista.slice(i, i + 100);
        function item(e) { var o = { fila: e.fila, cantidad: e.c, vacia: !!e.v, ts: e.t }; if (e.o) o.obs = e.o; if (e.cod) { o.codigo = e.cod; o.lote = e.lot; o.vcto = e.vc; } return o; }
        function enviar(p) {
          return api('guardarConteos', { id: uid, toma: p[0].toma || '', items: p.map(item) }).then(function (r) {
            if (r.ok) {
              SY.fallos = 0;
              p.forEach(function (e) { var cur = CM[e.k]; if (cur && cur.t === e.t) { cur.sync = 1; dbPut('conteos', cur); } });
              pintarChip(); return 'ok';
            }
            if (r.error === 'toma_distinta') { descartarUnidad(uid); toast('El administrador abrió una toma nueva. Se descartó lo contado antes.'); if (S.vista === 'contar' && S.unidadActual === uid) abrirConteo(uid); return 'otra'; }
            if (r.error === 'no_tuya' || r.error === 'cerrada' || r.error === 'sin_toma' || r.error === 'no_existe') {
              SY.bloq[uid] = true; if (S.vista === 'contar' && S.unidadActual === uid) { CT.perdida = r.mensaje; render(); } else toast(r.mensaje);
              return 'otra';
            }
            if (/^(fila_invalida|cantidad_invalida|lote_grande|falta_registro|registro_no_permitido|registro_sin_cantidad|codigo_invalido|lote_invalido|vcto_invalido|obs_requerida)$/.test(r.error)) {
              if (p.length > 1) {                                 // un conteo malo no debe frenar a los buenos: se envían de uno en uno
                var seq = Promise.resolve('ok');
                p.forEach(function (e) { seq = seq.then(function (est) { return est === 'ok' || est === 'mal' ? enviar([e]).then(function (x) { return x === 'mal' ? 'ok' : x; }) : est; }); });
                return seq;
              }
              var cur = CM[p[0].k]; if (cur && cur.t === p[0].t) { cur.sync = 2; dbPut('conteos', cur); }
              toast(r.mensaje || 'Un conteo fue rechazado.'); pintarChip(); return 'mal';
            }
            return 'red';                                          // sin red u ocupado: se reintenta luego
          });
        }
        return enviar(parte).then(function (est) { if (est === 'red') return false; if (est === 'otra') return siguiente2(ui); return lote(i + 100); });
      }
      function siguiente2(n) { return siguiente(n + 1); }
      return lote(0).then(function (ok) { return ok === false ? false : siguiente(ui + 1); });
    }
    return siguiente(0).then(function (ok) {
      SY.enCurso = false;
      if (ok === false) {
        SY.fallos++; var demora = Math.min(60000, 3000 * Math.pow(2, Math.min(SY.fallos, 5))) + Math.random() * 2000;
        clearTimeout(SY.timer); SY.timer = setTimeout(function () { SY.timer = null; flush(); }, demora);
      } else programarFlush();
      pintarChip();
    }, function () { SY.enCurso = false; pintarChip(); });
  }

  // ---------- render ----------
  function render() {
    var h;
    if (!S.ses) h = vistaLogin();
    else if (S.vista === 'pin') h = vistaPin();
    else if (S.vista === 'contar') h = vistaContar();
    else if (S.ses.rol === 'administrador') h = vistaAdmin();
    else if (S.ses.rol === 'contador') h = vistaContador();
    else if (S.ses.rol === 'ajustador') h = vistaAjustador();
    else h = '<main class="pantalla"><div class="vacio"><h2>Rol no reconocido</h2><p>Avisa al administrador.</p><button class="btn" data-a="salir">Cerrar sesión</button></div></main>';
    $app.innerHTML = h;
  }
  function renderConScroll() {
    if (S.vista === 'contar') { pintarChip(); return; }
    var y = window.scrollY, a = document.activeElement, enFiltro = a && a.name === 'q', v = enFiltro ? a.value : null;
    if (enFiltro) return;                         // no se redibuja mientras escribe
    render(); window.scrollTo(0, y);
  }

  // ---------- acciones ----------
  function mostrarError(el, msg) { var m = $app.querySelector('#msg') || $capa.querySelector('#msg'); if (m) m.innerHTML = '<div class="err" role="alert">' + esc(msg) + '</div>'; else toast(msg); }

  function confirmar(titulo, texto, etiqueta, accion, id, extra) {
    modal('<h3>' + esc(titulo) + '</h3><p>' + esc(texto) + '</p>' + (extra || '') + '<div id="msg"></div><div class="botones"><button class="btn gr" data-a="cerrarModal">Cancelar</button><button class="btn rel" data-a="' + accion + '" data-id="' + esc(id || '') + '">' + esc(etiqueta) + '</button></div>');
  }
  function unidadPorId(id) { return (S.datos ? S.datos.unidades : []).filter(function (u) { return u.id === id; })[0]; }
  function nombreUnidad(u) { return u ? (u.tipo === 'torre' ? 'Torre ' + u.torre : 'Pasillo ' + u.pasillo + ' · Nave ' + u.nave + (u.zona ? ' ' + u.zona.charAt(0) + u.zona.slice(1).toLowerCase() : '')) : ''; }

  var ACC = {
    tab: function (b) { S.tab = b.dataset.id; S.zona = null; render(); },
    zona: function (b) { S.zona = b.dataset.id; render(); },
    recargar: function () { if (S.vista === 'contar') { S.errCarga = ''; CT.datos = null; render(); cargarConteo(); return; } toast('Actualizando…'); S.errCarga = ''; render(); Promise.resolve(cargarSegunVista()).then(function () { if (S.online) toast('Lista al día.'); }); },
    admtab: function (b) { S.adminTab = b.dataset.id; S.filtroHist = ''; S.errCarga = ''; render(); window.scrollTo(0, 0); cargarSegunVista(); },
    atras: function () {
      if (S.vista === 'contar' && CT.datos && CT.datos.unidad.tipo === 'torre' && CT.udc) { CT.udc = null; render(); window.scrollTo(0, 0); return; }
      var venia = S.vista === 'contar'; S.vista = S.ses && S.ses.debe ? 'pin' : 'home'; render(); cargarSegunVista(); if (venia) flush(true);
    },
    udc: function (b) { CT.udc = b.dataset.id; render(); window.scrollTo(0, 0); },
    filtro: function (b) { CT.filtro = b.dataset.id; var l = document.getElementById('posl'); if (l) l.classList.toggle('solopend', CT.filtro === 'pend'); document.querySelectorAll('.seg [data-a=filtro]').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.id === CT.filtro)); }); },
    vacia: function (b) { var fila = b.dataset.id; ponerConteo(fila, 0, 1); var i = document.querySelector('input[data-q="' + fila + '"]'); if (i) i.value = '0'; },
    enviarYSalir: function (b) {
      ocupar(b, 'Enviando…');
      flush(true).then(function () { if (pendientes().length) { liberarBoton(b); mostrarError(null, 'No se pudo enviar. Revisa tu señal e inténtalo de nuevo.'); } else ACC.salir(); });
    },
    salirYa: function () { cerrarModal(); CM = {}; ACC.salir(true); },
    cerrarModal: cerrarModal,
    quedarme: cerrarModal,
    registrar: function (b) { abrirRegistro(b.dataset.id, {}); },
    escanear: function () { abrirCamara('Escanear artículo', ubicarArticulo); },
    escanearReg: function () { leerRegistro(); var fila = REG.fila; abrirCamara('Escanear código', function (v) { cargarCatalogo().then(function () { var r = resolverCodigo(v); REG.cod = r ? r.a : String(v).toUpperCase(); abrirRegistro(fila); if (!r) toast('Código leído: ' + v + '. No está en el catálogo.'); else if (r.caja) toast('Código de caja. Cuenta unidades sueltas.'); }); }, function () { abrirRegistro(fila); }); },
    cerrarCamara: function () { var v = CAM.volver; cerrarModal(); if (v) v(); },
    guardarObs: function (b) {
      var o = (($capa.querySelector('#obs') || {}).value || '').trim();
      if (o.length < 3) return mostrarError(null, 'Escribe una observación (mínimo 3 letras).');
      var fila = b.dataset.id, n = parseInt(b.dataset.n, 10); cerrarModal(); ponerConteo(fila, n, 0, { o: o, mantener: true });
      var i = document.querySelector('input[data-q="' + fila + '"]'); if (i) i.value = String(n);
    },
    guardarReg: function (b) {
      leerRegistro(); var fila = b.dataset.id, n = /^\d{1,6}$/.test(REG.c) ? parseInt(REG.c, 10) : 0;
      if (!/^[A-Za-z0-9]{6}$/.test(REG.cod)) return mostrarError(null, 'El código del artículo debe tener 6 caracteres, letras o números.');
      if (!REG.lot || REG.lot.length > 30) return mostrarError(null, 'Escribe el lote.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(REG.vc) || diasHasta(REG.vc) === null) return mostrarError(null, 'Escribe el vencimiento con día, mes y año.');
      if (n < 1) return mostrarError(null, 'La cantidad debe ser mayor a 0.');
      var corto = vencCorto(REG.vc); if (corto && REG.o.length < 3) { var w = $capa.querySelector('#robsw'); if (w) w.hidden = false; return mostrarError(null, 'Vence en menos de ' + DIAS_ALERTA + ' días o ya venció: escribe una observación.'); }
      cerrarModal(); ponerConteo(fila, n, 0, { cod: REG.cod, lot: REG.lot, vc: REG.vc, o: corto ? REG.o : '' });
      var i = document.querySelector('input[data-q="' + fila + '"]'); if (i) i.value = String(n);
    },
    salirApp: function () { SALIENDO = true; cerrarModal(); flush(true); history.go(-2); setTimeout(function () { try { window.close(); } catch (e) {} SALIENDO = false; }, 700); },
    salir: function (ya) {
      var p = pendientes().length;
      if (p && ya !== true) { modal('<h3>Tienes conteos sin enviar</h3><p>' + p + (p === 1 ? ' conteo todavía no llegó' : ' conteos todavía no llegaron') + ' al servidor. Si sales ahora quedan guardados en este celular y se enviarán cuando ingreses de nuevo con tu usuario.</p><div id="msg"></div><div class="botones"><button class="btn gr" data-a="cerrarModal">Cancelar</button><button class="btn rel" data-a="enviarYSalir">Enviar ahora</button></div><div style="margin-top:10px"><button class="btn pel ancho" data-a="salirYa">Salir sin enviar</button></div>'); return; }
      cerrarModal(); var t = S.ses && S.ses.token; api('logout', { token: t }).then(function () {}); S.aviso = ''; salirLocal(); CM = {}; },
    menu: function () {
      modal('<h3>' + esc(S.ses.usuario) + '</h3><p>' + esc(S.ses.rol) + ' · versión ' + VERSION + '</p><div style="display:flex;flex-direction:column;gap:10px"><button class="btn gr ancho" data-a="irPin">Cambiar mi PIN</button><button class="btn pel ancho" data-a="salir">Cerrar sesión</button><button class="btn gr ancho" data-a="cerrarModal">Cerrar</button></div>');
    },
    irPin: function () { cerrarModal(); S.vista = 'pin'; render(); },

    pedirTomar: function (b) { var u = unidadPorId(b.dataset.id); confirmar('¿Tomar ' + nombreUnidad(u) + '?', 'Quedará bloqueado para los demás operarios. Solo el administrador puede liberarlo.', 'Tomar', 'tomar', b.dataset.id); },
    tomar: function (b) {
      var id = b.dataset.id; ocupar(b, 'Tomando…');
      api('tomarUnidad', { id: id }).then(function (r) {
        if (!r.ok) { liberarBoton(b); if ($capa.className === 'on') mostrarError(null, r.mensaje); else toast(r.mensaje); if (r.error !== 'red') cargarUnidades(true); return; }
        cerrarModal(); abrirConteo(id);
      });
    },
    pedirLiberar: function (b) {
      var u = unidadPorId(b.dataset.id);
      confirmar('Liberar ' + nombreUnidad(u), 'Estaba en conteo con ' + (u && u.operador) + '. Escribe el motivo; queda en el historial.', 'Liberar', 'liberar', b.dataset.id,
        '<div class="campo"><label for="mot">Motivo</label><input id="mot" autocomplete="off"></div>');
    },
    liberar: function (b) {
      var mot = ($capa.querySelector('#mot') || {}).value || ''; ocupar(b, 'Liberando…');
      api('liberarUnidad', { id: b.dataset.id, motivo: mot }).then(function (r) {
        if (!r.ok) { liberarBoton(b); return mostrarError(null, r.mensaje); }
        cerrarModal(); toast('Unidad liberada.'); cargarUnidades();
      });
    },
    pedirCerrar: function () {
      var d = CT.datos, u = d && d.unidad; if (!u) return;
      var faltan = d.filas.length - contadas(d.filas), nom = u.tipo === 'torre' ? 'la torre ' + u.torre : 'el pasillo ' + u.pasillo;
      if (faltan > 0) modal('<h3>Faltan ' + faltan + ' posiciones</h3><p>Si cierras ' + nom + ' ahora, esas posiciones quedan sin contar y ya no podrás cambiar nada. Solo el administrador puede reabrirlo.</p><div id="msg"></div><div class="botones"><button class="btn gr" data-a="cerrarModal">Seguir contando</button><button class="btn pel" data-a="cerrarUnidad" data-f="1">Cerrar igual</button></div>');
      else modal('<h3>¿Cerrar ' + nom + '?</h3><p>Contaste todas las posiciones. Después de cerrar ya no podrás cambiarlas; solo el administrador puede reabrirlo.</p><div id="msg"></div><div class="botones"><button class="btn gr" data-a="cerrarModal">Cancelar</button><button class="btn rel" data-a="cerrarUnidad" data-f="0">Cerrar</button></div>');
    },
    cerrarUnidad: function (b) {
      var id = S.unidadActual, forzar = b.dataset.f === '1'; ocupar(b, 'Enviando…');
      flush(true).then(function () {
        if (pendientes().filter(function (e) { return e.unidad === id; }).length) { liberarBoton(b); return mostrarError(null, 'No se pudo enviar todo lo contado. Revisa tu señal e inténtalo de nuevo.'); }
        return api('cerrarUnidad', { id: id, forzar: forzar }).then(function (r) {
          if (r.error === 'faltan_posiciones') { liberarBoton(b); return modal('<h3>Faltan ' + r.faltan + ' posiciones</h3><p>El servidor cuenta ' + r.faltan + ' de ' + r.total + ' sin contar. Si cierras ahora quedan sin contar.</p><div id="msg"></div><div class="botones"><button class="btn gr" data-a="cerrarModal">Seguir contando</button><button class="btn pel" data-a="cerrarUnidad" data-f="1">Cerrar igual</button></div>'); }
          if (!r.ok) { liberarBoton(b); return mostrarError(null, r.mensaje); }
          cerrarModal(); toast('Unidad cerrada.'); CT.udc = null; CT.datos = null; S.vista = 'home'; render(); cargarSegunVista();
        });
      });
    },
    pedirCerrarAdm: function (b) {
      var u = unidadPorId(b.dataset.id);
      confirmar('Cerrar ' + nombreUnidad(u), 'Lo cierras en nombre de ' + (u && u.operador) + '. Ya no podrá cambiar sus conteos, salvo que la reabras.', 'Cerrar', 'cerrarAdm', b.dataset.id);
    },
    cerrarAdm: function (b) {
      ocupar(b, 'Cerrando…');
      api('cerrarUnidad', { id: b.dataset.id, forzar: b.dataset.f === '1' }).then(function (r) {
        if (r.error === 'faltan_posiciones') { liberarBoton(b); return modal('<h3>Faltan ' + r.faltan + ' de ' + r.total + ' posiciones</h3><p>Si la cierras así, esas posiciones quedan sin contar.</p><div id="msg"></div><div class="botones"><button class="btn gr" data-a="cerrarModal">Cancelar</button><button class="btn pel" data-a="cerrarAdm" data-f="1" data-id="' + esc(b.dataset.id) + '">Cerrar igual</button></div>'); }
        if (!r.ok) { liberarBoton(b); return mostrarError(null, r.mensaje); }
        cerrarModal(); toast('Unidad cerrada.'); cargarSegunVista();
      });
    },
    pedirReabrir: function (b) {
      var u = unidadPorId(b.dataset.id);
      confirmar('Reabrir ' + nombreUnidad(u), 'Vuelve a ' + (u && u.operador) + ' con los conteos como estaban. Escribe el motivo; queda en el historial.', 'Reabrir', 'reabrir', b.dataset.id,
        '<div class="campo"><label for="mot">Motivo</label><input id="mot" autocomplete="off"></div>');
    },
    reabrir: function (b) {
      var mot = ($capa.querySelector('#mot') || {}).value || ''; ocupar(b, 'Reabriendo…');
      api('reabrirUnidad', { id: b.dataset.id, motivo: mot }).then(function (r) {
        if (!r.ok) { liberarBoton(b); return mostrarError(null, r.mensaje); }
        cerrarModal(); toast('Unidad reabierta.'); cargarSegunVista();
      });
    },
    verCambios: function (b) {
      api('cambiosUnidad', { id: b.dataset.id }).then(function (r) {
        if (!r.ok) return toast(r.mensaje);
        var h = !r.cambios.length ? '<p>Nadie ha corregido posiciones en esta unidad.</p>' : '<div style="max-height:50vh;overflow:auto;margin-bottom:6px">' + r.cambios.map(function (c) {
          return '<div class="fila" style="padding:8px 0;align-items:flex-start"><div class="info"><div class="nom">UDC ' + esc(c.udc) + ' · ' + esc(c.pos) + '</div>' + c.versiones.map(function (v) {
            return '<div class="det">' + esc(fecha(v.ts)) + ' · ' + esc(v.usuario) + ': <b>' + (v.vacia ? 'Vacía' : v.cantidad) + '</b>' + (v.obs ? ' · ' + esc(v.obs) : '') + '</div>'; }).join('') + '</div></div>'; }).join('') + '</div>';
        modal('<h3>Cambios · ' + esc(r.unidad) + '</h3><p>' + (r.total ? r.total + ' posición(es) corregida(s). Se muestran todas las versiones, de la primera a la última.' : 'Sin correcciones.') + '</p>' + h + '<div class="botones"><button class="btn rel" data-a="cerrarModal">Listo</button></div>');
      });
    },
    pedirCerrarToma: function () {
      confirmar('¿Cerrar la toma?', 'Nadie podrá seguir contando. Si quieres sumar más pasillos sin parar a nadie, usa Agregar a la toma. Lo contado se conserva hasta que abras la siguiente toma y se copia a archivo_conteos.', 'Cerrar toma', 'cerrarToma');
    },
    cerrarToma: function (b) {
      ocupar(b, 'Cerrando…');
      api('cerrarToma', { forzar: b.dataset.f === '1' }).then(function (r) {
        if (r.error === 'hay_en_conteo') { liberarBoton(b); return modal('<h3>Hay ' + r.cantidad + ' unidad(es) en conteo</h3><p>' + r.en_conteo.map(function (x) { return esc(x.nombre) + ' (' + esc(x.operador) + ')'; }).join(', ') + '. Si cierras la toma, esos contadores no podrán enviar más conteos.</p><div id="msg"></div><div class="botones"><button class="btn gr" data-a="cerrarModal">Cancelar</button><button class="btn pel" data-a="cerrarToma" data-f="1">Cerrar igual</button></div>'); }
        if (!r.ok) { liberarBoton(b); return mostrarError(null, r.mensaje); }
        cerrarModal(); toast('Toma cerrada.'); S.datos = null; S.av = null; S.informe = null; S.adminTab = 'carga'; render(); cargarUnidades();
      });
    },
    validar: function () {
      S.ocupado = true; S.informe = null; render();
      api('validarDatos').then(function (r) {
        S.ocupado = false;
        if (r.ok === false && !r.informe) { toast(r.mensaje || 'No se pudo validar.'); } else S.informe = r;
        render();
      });
    },
    pedirAbrir: function () {
      var i = S.informe.informe; confirmar('¿Abrir la toma?', i.unidades_conteo + ' unidades y ' + i.filas_leidas + ' filas quedarán disponibles para los contadores.', 'Abrir toma', 'abrir');
    },
    abrir: function (b) {
      ocupar(b, 'Abriendo…');
      api('abrirToma').then(function (r) {
        if (!r.ok) { liberarBoton(b); return mostrarError(null, r.mensaje); }
        cerrarModal(); S.informe = null; toast('Toma abierta: ' + r.unidades + ' unidades.'); S.adminTab = 'avance'; S.datos = null; render(); cargarUnidades();
      });
    },
    pedirAgregar: function () {
      var pv = S.informe && S.informe.previa; if (!pv) return;
      confirmar('¿Agregar a la toma?', pv.nuevas + ' unidades nuevas (' + pv.filas_nuevas + ' posiciones)' + (pv.actualizar ? ' y ' + pv.actualizar + ' pendientes actualizadas' : '') + '. Los contadores que ya están contando no pierden nada.', 'Agregar', 'agregar');
    },
    agregar: function (b) {
      ocupar(b, 'Agregando…');
      api('agregarAToma').then(function (r) {
        if (!r.ok) { liberarBoton(b); return mostrarError(null, r.mensaje); }
        cerrarModal(); S.informe = null; toast(r.sin_cambios ? 'No había nada nuevo.' : 'Agregadas ' + r.nuevas + ' unidades' + (r.actualizadas ? ' y actualizadas ' + r.actualizadas : '') + '.'); S.adminTab = 'avance'; S.datos = null; render(); cargarUnidades(); cargarSegunVista();
      });
    },
    nuevoUsuario: function () {
      modal('<h3>Nuevo usuario</h3><p>Se crea con un PIN temporal que cambiará en su primer ingreso.</p><form data-f="nuevo"><div class="campo"><label for="nu">Usuario</label><input id="nu" name="usuario" autocapitalize="none" autocomplete="off" required></div>' +
        '<div class="campo" style="margin-top:12px"><label for="nr">Rol</label><select id="nr" name="rol"><option value="contador">Contador</option><option value="ajustador">Ajustador</option><option value="administrador">Administrador</option></select></div>' +
        '<div id="msg"></div><div class="botones"><button class="btn gr" type="button" data-a="cerrarModal">Cancelar</button><button class="btn rel" type="submit">Crear</button></div></form>');
    },
    pedirReset: function (b) { confirmar('¿Generar un PIN nuevo para ' + b.dataset.id + '?', 'Se anula su PIN actual y se genera uno temporal que deberá cambiar al entrar.', 'Generar PIN', 'reset', b.dataset.id); },
    reset: function (b) {
      ocupar(b, 'Generando…');
      api('resetearPin', { usuario: b.dataset.id }).then(function (r) { if (!r.ok) { liberarBoton(b); return mostrarError(null, r.mensaje); } mostrarPin(r.usuario, r.pin_temporal); cargarSegunVista(); });
    },
    desbloquear: function (b) { api('desbloquearUsuario', { usuario: b.dataset.id }).then(function (r) { toast(r.ok ? 'Usuario desbloqueado.' : r.mensaje); cargarSegunVista(); }); },
    activar: function (b) { api('activarUsuario', { usuario: b.dataset.id, activo: b.dataset.v === '1' }).then(function (r) { toast(r.ok ? (b.dataset.v === '1' ? 'Usuario activado.' : 'Usuario desactivado.') : r.mensaje); cargarSegunVista(); }); }
  };
  function mostrarPin(usuario, pin) {
    modal('<h3>PIN temporal de ' + esc(usuario) + '</h3><p>Entrégaselo en persona. No se vuelve a mostrar y debe cambiarlo al entrar.</p><div class="pinbox" aria-label="PIN temporal">' + esc(pin) + '</div><div class="botones"><button class="btn rel" data-a="cerrarModal">Listo</button></div>', true);
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
    var f = ACC[b.dataset.a]; if (f) { e.preventDefault(); f(b); }
  });
  document.addEventListener('submit', function (e) {
    var f = e.target.closest('form[data-f]'); if (!f) return; e.preventDefault();
    var tipo = f.dataset.f, v = {}; new FormData(f).forEach(function (val, k) { v[k] = String(val).trim(); });
    var btn = f.querySelector('button[type=submit]');
    function ocupar(x) { if (btn) { btn.disabled = x; } }
    if (tipo === 'login') {
      if (!v.usuario || !v.pin) return mostrarError(null, 'Escribe tu usuario y tu PIN.');
      ocupar(true);
      api('login', { usuario: v.usuario, pin: v.pin }).then(function (r) {
        ocupar(false);
        if (!r.ok) return mostrarError(null, r.mensaje || 'No se pudo ingresar.');
        S.aviso = ''; S.ses = { token: r.token, usuario: r.usuario, rol: r.rol, vence: r.vence, debe: !!r.debe_cambiar_pin }; guardarSesion(); entrar();
      });
    } else if (tipo === 'pin') {
      if (!/^\d{6,10}$/.test(v.nuevo || '')) return mostrarError(null, 'El PIN nuevo debe tener de 6 a 10 dígitos.');
      if (v.nuevo !== v.rep) return mostrarError(null, 'Los dos PIN nuevos no coinciden.');
      ocupar(true);
      api('cambiarPin', { pinActual: v.actual, pinNuevo: v.nuevo }).then(function (r) {
        ocupar(false); if (!r.ok) return mostrarError(null, r.mensaje);
        S.ses.debe = false; guardarSesion(); toast('PIN cambiado.'); S.vista = 'home'; render(); cargarSegunVista();
      });
    } else if (tipo === 'nuevo') {
      if (!v.usuario) return mostrarError(null, 'Escribe el nombre de usuario.');
      ocupar(true);
      api('crearUsuario', { usuario: v.usuario, rol: v.rol }).then(function (r) {
        ocupar(false); if (!r.ok) return mostrarError(null, r.mensaje); mostrarPin(r.usuario, r.pin_temporal); cargarSegunVista();
      });
    } else if (tipo === 'hist') { S.filtroHist = v.q || ''; buscarHistorial(); }
  });
  window.addEventListener('online', function () { S.online = true; renderConScroll(); flush(true).then(function () { if (S.ses && S.vista === 'contar' && CT.fuera && $capa.className !== 'on') cargarConteo(); }); if (S.ses && S.vista === 'home') cargarSegunVista(true); });
  var tq = {};
  document.addEventListener('input', function (e) { var i = e.target; if (!i.matches || !i.matches('input[data-q]')) return; clearTimeout(tq[i.dataset.q]); tq[i.dataset.q] = setTimeout(function () { if (document.body.contains(i)) leerCantidad(i); }, 800); });
  document.addEventListener('change', function (e) { var i = e.target; if (!i.matches || !i.matches('input[data-q]')) return; clearTimeout(tq[i.dataset.q]); leerCantidad(i); });
  document.addEventListener('keydown', function (e) {
    var i = e.target; if (e.key !== 'Enter' || !i.matches || !i.matches('input[data-q]')) return; e.preventDefault();
    clearTimeout(tq[i.dataset.q]); leerCantidad(i);
    var todos = [].slice.call(document.querySelectorAll('input[data-q]')).filter(function (x) { return x.offsetParent !== null; }), p = todos.indexOf(i);
    if (todos[p + 1]) { todos[p + 1].focus(); todos[p + 1].select(); } else i.blur();
  });
  document.addEventListener('input', function (e) {
    var i = e.target; if (!i || !i.id) return;
    if (i.id === 'rk') { var d = document.getElementById('rdesc'); if (d) d.innerHTML = descReg(i.value.trim().toUpperCase()); }
    if (i.id === 'rv') { var w = document.getElementById('robsw'); if (w) w.hidden = !vencCorto(i.value); }
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) flush(true); });
  window.addEventListener('pagehide', function () { flush(true); });
  window.addEventListener('offline', function () { S.online = false; renderConScroll(); });

  // actualización automática de la lista (solo con la pantalla visible y sin ventanas abiertas)
  setInterval(function () {
    if (document.hidden || !S.ses || S.vista !== 'home' || $capa.className === 'on' || S.ocupado) return;
    if (S.ses.rol === 'administrador' && (S.adminTab === 'usuarios' || S.adminTab === 'historial' || S.adminTab === 'carga')) return;
    cargarUnidades(true);
  }, (CFG.REFRESCO_SEG || 20) * 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && S.ses && S.vista === 'home') cargarSegunVista(true); });

  // ---------- botón "atrás" del celular ----------
  // Atrás sube un nivel dentro de la app. Solo en la pantalla principal pregunta si de verdad quieres salir.
  var SALIENDO = false;
  function textoSalida() {
    var mia = (S.datos && S.datos.unidades ? S.datos.unidades : []).filter(function (u) { return u.mia; })[0], p = pendientes().length, t = [];
    if (mia) t.push('Tienes <b>' + esc(nombreUnidad(mia)) + '</b> en conteo, sin cerrar.');
    if (p) t.push('Hay <b>' + p + '</b> conteo' + (p === 1 ? '' : 's') + ' sin enviar; se enviarán cuando vuelvas a abrir la app con tu usuario.');
    return t.length ? t.join(' ') + ' ¿Seguro que quieres salir?' : '¿Seguro que quieres salir de la aplicación?';
  }
  function preguntarSalida() {
    modal('<h3>¿Salir de la aplicación?</h3><p>' + (S.ses ? textoSalida() : '¿Seguro que quieres salir?') + '</p><div class="botones"><button class="btn rel" data-a="quedarme">Quedarme</button><button class="btn gr" data-a="salirApp">Salir</button></div>', true);
  }
  function alAtras() {
    if ($capa.className === 'on') { cerrarModal(); return; }
    if (!S.ses) return preguntarSalida();
    if (S.vista === 'contar') return ACC.atras();
    if (S.vista === 'pin') { if (S.ses.debe) { toast('Primero cambia tu PIN.'); return; } S.vista = 'home'; render(); cargarSegunVista(); return; }
    if (S.ses.rol === 'administrador' && S.adminTab !== 'avance') { S.adminTab = 'avance'; S.errCarga = ''; render(); cargarSegunVista(); return; }
    preguntarSalida();
  }
  try {
    if (!(history.state && history.state.n === 'app')) { history.replaceState({ n: 'base' }, ''); history.pushState({ n: 'app' }, ''); }
    window.addEventListener('popstate', function () {
      if (SALIENDO) return;
      if (!(history.state && history.state.n === 'app')) { try { history.pushState({ n: 'app' }, ''); } catch (e) {} alAtras(); }
    });
  } catch (e) {}

  // ---------- arranque ----------
  try { var g = ls('ses'); if (g) { var o = JSON.parse(g); if (o && o.token && new Date(o.vence).getTime() > Date.now()) S.ses = o; } } catch (e) {}
  if (S.ses) entrar(); else render();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(function () {});
})();
