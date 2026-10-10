/* Toma de inventario · F1 (acceso + elegir pasillo/torre + panel de administrador) */
(function () {
  'use strict';
  var CFG = window.CONFIG, VERSION = 'F1';
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
  var LECTURAS = { yo: 1, listarUnidades: 1, listarUsuarios: 1, historial: 1, validarDatos: 1 };
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
    S.ses = null; S.errCarga = ''; S.datos = null; S.usuarios = null; S.historial = null; S.informe = null; guardarSesion();
    S.vista = 'login'; S.aviso = msg || ''; cerrarModal(); render();
  }
  function entrar() {
    S.datos = null; S.tab = null;
    S.vista = S.ses.debe ? 'pin' : 'home'; S.adminTab = 'avance'; render();
    if (!S.ses.debe) cargarSegunVista();
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
      (atras ? '<button class="ibtn" data-a="atras" aria-label="Volver">‹</button>' : '') +
      '<div class="t"><h1>' + esc(titulo) + '</h1><small>' + esc(sub || '') + '</small></div>' +
      (S.ses && S.vista === 'home' ? '<button class="ibtn" data-a="recargar" aria-label="Actualizar">↻</button>' : '') +
      '<span class="chip' + (S.online ? '' : ' off') + '">' + (S.online ? 'En línea' : 'Sin conexión') + '</span>' +
      (S.ses ? '<button class="ibtn" data-a="menu" aria-label="Menú de ' + esc(S.ses.usuario) + '">' + ini + '</button>' : '') + '</header>';
  }
  function modal(html, fija) {
    $capa.innerHTML = '<div class="hoja" role="dialog" aria-modal="true">' + html + '</div>'; $capa.className = 'on'; $capa.dataset.fija = fija ? '1' : '';
    var f = $capa.querySelector('input,select,button'); if (f) setTimeout(function () { try { f.focus(); } catch (e) {} }, 30);
  }
  function cerrarModal() { $capa.className = ''; $capa.innerHTML = ''; }
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
      if (u.estado === 'En conteo') acc = '<button class="btn pel peq" data-a="pedirLiberar" data-id="' + esc(u.id) + '">Liberar</button>';
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
  function vistaTomada() {
    var u = (S.datos ? S.datos.unidades : []).filter(function (x) { return x.id === S.unidadActual; })[0];
    var nombre = u ? (u.tipo === 'torre' ? 'Torre ' + u.torre : 'Pasillo ' + u.pasillo) : S.unidadActual;
    var sub = u && u.tipo !== 'torre' ? 'Nave ' + u.nave + (u.zona ? ' · ' + u.zona.charAt(0) + u.zona.slice(1).toLowerCase() : '') : 'Modula';
    return '<main class="pantalla">' + cabecera(nombre, sub + ' · ' + S.ses.usuario, u && u.tipo === 'torre', true) +
      '<div class="cuerpo"><div class="form"><div class="ok"><b>Es tuyo.</b> Quedó bloqueado para los demás operarios.</div>' +
      '<div class="aviso">El conteo posición por posición se activa en la fase F2. Por ahora tu unidad queda reservada con tu nombre.</div>' +
      '<button class="btn rel ancho" data-a="atras">Volver a la lista</button></div></div></main>';
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
    return resumenBarra(un) + '<div class="tarjetas"><div class="tj"><small>Pendientes</small><b>' + c.Pendiente + '</b></div><div class="tj amb"><small>En conteo</small><b>' + c['En conteo'] + '</b></div>' +
      '<div class="tj ver"><small>Cerradas</small><b>' + c.cer + '</b></div><div class="tj"><small>Unidades</small><b>' + un.length + '</b></div></div>' + secciones;
  }
  function adminCarga() {
    var d = S.datos, abierta = d && d.toma_activa, inf = S.informe, h = '<div class="form">';
    if (!d) return cargando();
    if (abierta) {
      h += '<div class="ok"><b>Hay una toma abierta</b> con ' + d.unidades.length + ' unidades. Para cerrarla y archivarla se usa la fase F5.</div>';
    } else {
      h += '<div class="aviso">Antes de abrir la toma, valida los datos de las pestañas MODULA y MINORISTA Y MAYORISTA del Google Sheet.</div>' +
        '<button class="btn amb ancho" data-a="validar"' + (S.ocupado ? ' disabled' : '') + '>' + (S.ocupado ? 'Validando…' : 'Validar datos') + '</button>';
    }
    if (inf && !abierta) {
      h += '<div class="tarjetas" style="padding:0"><div class="tj"><small>Filas leídas</small><b>' + inf.informe.filas_leidas + '</b></div><div class="tj"><small>Unidades</small><b>' + inf.informe.unidades_conteo + '</b></div>' +
        '<div class="tj"><small>Pasillos</small><b>' + inf.informe.pasillos + '</b></div><div class="tj"><small>Torres Modula</small><b>' + inf.informe.torres + '</b></div></div>';
      if (inf.informe.errores.length) {
        h += '<div class="err"><b>' + inf.informe.errores.length + ' error(es) que corregir:</b><ul style="margin:8px 0 0;padding-left:18px">' +
          inf.informe.errores.slice(0, 30).map(function (e) { return '<li>' + esc(e.hoja) + (e.fila ? ' · fila ' + esc(e.fila) : '') + ': ' + esc(e.msg) + '</li>'; }).join('') + '</ul>' +
          (inf.informe.errores.length > 30 ? '<div style="margin-top:6px">…y ' + (inf.informe.errores.length - 30) + ' más.</div>' : '') + '</div>';
      } else {
        h += '<div class="ok">Los datos están bien. Puedes abrir la toma.</div>';
      }
      if (inf.informe.advertencias.length) {
        h += '<div class="sec" style="padding:6px 0">Avisos (no bloquean)</div>' + inf.informe.advertencias.map(function (a) {
          return '<div class="fila" style="padding:8px 0"><div class="info">' + esc(a.texto) + '</div><b class="mono">' + esc(a.cantidad) + '</b></div>'; }).join('');
      }
      h += '<button class="btn rel ancho" data-a="pedirAbrir"' + (inf.ok ? '' : ' disabled') + '>Abrir toma</button>';
    }
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

  // ---------- render ----------
  function render() {
    var h;
    if (!S.ses) h = vistaLogin();
    else if (S.vista === 'pin') h = vistaPin();
    else if (S.vista === 'tomada') h = vistaTomada();
    else if (S.ses.rol === 'administrador') h = vistaAdmin();
    else if (S.ses.rol === 'contador') h = vistaContador();
    else if (S.ses.rol === 'ajustador') h = vistaAjustador();
    else h = '<main class="pantalla"><div class="vacio"><h2>Rol no reconocido</h2><p>Avisa al administrador.</p><button class="btn" data-a="salir">Cerrar sesión</button></div></main>';
    $app.innerHTML = h;
  }
  function renderConScroll() {
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
    recargar: function () { toast('Actualizando…'); S.errCarga = ''; render(); Promise.resolve(cargarSegunVista()).then(function () { if (S.online) toast('Lista al día.'); }); },
    admtab: function (b) { S.adminTab = b.dataset.id; S.filtroHist = ''; S.errCarga = ''; render(); window.scrollTo(0, 0); cargarSegunVista(); },
    atras: function () { S.vista = S.ses && S.ses.debe ? 'pin' : 'home'; render(); cargarSegunVista(); },
    cerrarModal: cerrarModal,
    salir: function () { cerrarModal(); var t = S.ses && S.ses.token; api('logout', { token: t }).then(function () {}); S.aviso = ''; salirLocal(); },
    menu: function () {
      modal('<h3>' + esc(S.ses.usuario) + '</h3><p>' + esc(S.ses.rol) + ' · versión ' + VERSION + '</p><div style="display:flex;flex-direction:column;gap:10px"><button class="btn gr ancho" data-a="irPin">Cambiar mi PIN</button><button class="btn pel ancho" data-a="salir">Cerrar sesión</button><button class="btn gr ancho" data-a="cerrarModal">Cerrar</button></div>');
    },
    irPin: function () { cerrarModal(); S.vista = 'pin'; render(); },

    pedirTomar: function (b) { var u = unidadPorId(b.dataset.id); confirmar('¿Tomar ' + nombreUnidad(u) + '?', 'Quedará bloqueado para los demás operarios. Solo el administrador puede liberarlo.', 'Tomar', 'tomar', b.dataset.id); },
    tomar: function (b) {
      var id = b.dataset.id; ocupar(b, 'Tomando…');
      api('tomarUnidad', { id: id }).then(function (r) {
        if (!r.ok) { liberarBoton(b); if ($capa.className === 'on') mostrarError(null, r.mensaje); else toast(r.mensaje); if (r.error !== 'red') cargarUnidades(true); return; }
        cerrarModal(); S.unidadActual = id; S.vista = 'tomada'; render(); window.scrollTo(0, 0); cargarUnidades(true).then(function () { if (S.vista === 'tomada') render(); });
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
  window.addEventListener('online', function () { S.online = true; renderConScroll(); if (S.ses && S.vista === 'home') cargarSegunVista(true); });
  window.addEventListener('offline', function () { S.online = false; renderConScroll(); });

  // actualización automática de la lista (solo con la pantalla visible y sin ventanas abiertas)
  setInterval(function () {
    if (document.hidden || !S.ses || S.vista !== 'home' || $capa.className === 'on' || S.ocupado) return;
    if (S.ses.rol === 'administrador' && (S.adminTab === 'usuarios' || S.adminTab === 'historial' || S.adminTab === 'carga')) return;
    cargarUnidades(true);
  }, (CFG.REFRESCO_SEG || 20) * 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && S.ses && S.vista === 'home') cargarSegunVista(true); });

  // ---------- arranque ----------
  try { var g = ls('ses'); if (g) { var o = JSON.parse(g); if (o && o.token && new Date(o.vence).getTime() > Date.now()) S.ses = o; } } catch (e) {}
  if (S.ses) entrar(); else render();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(function () {});
})();
