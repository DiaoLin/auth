/* ============================================================
 * 设备令牌 SSE 实时保护
 * ============================================================ */
(function () {
  'use strict';

  var API_BASE    = 'https://devauth.us.ci'; // 统一使用这个域名
  var CHECK_URL   = 'https://devauth.us.ci/check.html';
  var CHECK_API   = API_BASE + '/api/check';
  var STREAM_API  = API_BASE + '/api/device_stream';
  var TOKEN_KEY   = 'device_token';

  var audioContexts = [];
  (function hijackAudio() {
    var OriginalAC = window.AudioContext || window.webkitAudioContext;
    if (!OriginalAC) return;

    function WrappedAC() {
      if (window.__tokenGuardMuted) throw new Error('Audio is disabled.');
      var ctx = new OriginalAC(...arguments);
      audioContexts.push(ctx);
      return ctx;
    }
    WrappedAC.prototype = OriginalAC.prototype;
    window.AudioContext = WrappedAC;
    window.webkitAudioContext = WrappedAC;
  })();

  (function hijackPlay() {
    if (!window.HTMLMediaElement) return;
    var origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (window.__tokenGuardMuted) return Promise.resolve();
      return origPlay.apply(this, arguments);
    };
  })();

  var currentES = null;
  var stopped = false;
  var revokedShown = false;
  var bannedShown = false;

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }
  function clearToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }
  function goCheck() {
    try { window.location.replace(CHECK_URL); }
    catch (e) { try { window.location.href = CHECK_URL; } catch (e2) {} }
  }

  function muteAll() {
    window.__tokenGuardMuted = true;

    function muteMedia(root) {
      try {
        root.querySelectorAll('audio, video').forEach(function (el) {
          try {
            el.muted = true;
            el.volume = 0;
            if (!el.paused) el.pause();
            try { el.currentTime = 0; } catch (e) {}
          } catch (e) {}
        });
      } catch (e) {}
    }

    function muteFrames(doc) {
      try {
        doc.querySelectorAll('iframe').forEach(function (frame) {
          var sameOrigin = false;
          try {
            var inner = frame.contentDocument;
            if (inner) {
              sameOrigin = true;
              muteMedia(inner);
              muteFrames(inner);
            }
          } catch (e) {}
          if (!sameOrigin) {
            try { frame.src = 'about:blank'; } catch (e) {}
          }
        });
      } catch (e) {}
    }

    muteMedia(document);
    muteFrames(document);

    audioContexts.forEach(function (ctx) {
      try { ctx.suspend(); } catch (e) {}
    });

    try {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    } catch (e) {}

    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen();
      }
    } catch (e) {}

    try {
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    } catch (e) {}
  }

  function buildOverlay(id, title, bodyText, withButton) {
    var overlay = document.createElement('div');
    overlay.id = id;
    overlay.style.cssText =
      'position:fixed;inset:0;display:none;align-items:center;justify-content:center;' +
      'background:#0b0f1a;z-index:2147483647;overflow:auto;';

    var box = document.createElement('div');
    box.style.cssText =
      'width:320px;max-width:90vw;padding:26px 22px;border-radius:16px;text-align:center;' +
      'background:#141a26;border:1px solid rgba(255,255,255,.18);' +
      'box-shadow:0 24px 60px rgba(0,0,0,.8);' +
      'font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#e8ecf5;';

    if (title) {
      var h3 = document.createElement('h3');
      h3.textContent = title;
      h3.style.cssText = 'margin:0 0 12px;font-size:16px;color:#ff8f8f;font-weight:600;';
      box.appendChild(h3);
    }

    var p = document.createElement('p');
    p.style.cssText = 'margin:0 0 20px;font-size:14px;line-height:1.7;color:#cbd5e8;word-break:break-word;';
    if (bodyText) {
      p.appendChild(document.createTextNode(bodyText));
      p.appendChild(document.createElement('br'));
    }
    p.appendChild(document.createTextNode('原因：'));

    var reasonEl = document.createElement('b');
    reasonEl.id = id + '_reason';
    reasonEl.style.cssText = 'color:#ffb3b3;font-weight:600;';
    reasonEl.textContent = '原因未给出';
    p.appendChild(reasonEl);
    box.appendChild(p);

    var pTime = document.createElement('p');
    pTime.id = id + '_time';
    pTime.style.cssText = 'margin:8px 0 0;font-size:14px;line-height:1.7;color:#f6ad55;font-weight:600;display:none;';
    box.appendChild(pTime);

    if (withButton) {
      var btn = document.createElement('button');
      btn.textContent = '知道了';
      btn.style.cssText =
        'width:100%;padding:11px;border-radius:10px;border:none;cursor:pointer;' +
        'font-family:inherit;font-size:14px;font-weight:600;' +
        'background:linear-gradient(135deg,#4fd1c5,#3b82f6);color:#06121a;';
      btn.addEventListener('click', function () { goCheck(); });
      box.appendChild(btn);
    }

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    return overlay;
  }

  var revokedOverlay = null;
  var bannedOverlay = null;

  function ensureRevokedOverlay() {
    if (!revokedOverlay) {
      revokedOverlay = buildOverlay(
        '__token_guard_overlay',
        '权限已撤销',
        '本设备使用权限已被撤销。',
        true
      );
    }
    return revokedOverlay;
  }

  function ensureBannedOverlay() {
    if (!bannedOverlay) {
      bannedOverlay = buildOverlay(
        '__token_guard_ban_overlay',
        '本设备已被封禁',
        '',
        false
      );
    }
    return bannedOverlay;
  }

  function showRevoked(reason) {
    if (revokedShown) return;
    revokedShown = true;
    stop();
    muteAll();
    var el = ensureRevokedOverlay();
    document.getElementById('__token_guard_overlay_reason').textContent = reason || '原因未给出';
    el.style.display = 'flex';
  }

  function showBanned(reason, banUntil) {
    if (bannedShown) return;
    bannedShown = true;
    stop();
    muteAll();
    var el = ensureBannedOverlay();
    document.getElementById('__token_guard_ban_overlay_reason').textContent = reason || '原因未给出';
    var timeEl = document.getElementById('__token_guard_ban_overlay_time');
    if (timeEl) {
      timeEl.textContent = banUntil ? '解封时间：' + banUntil : '解封时间：永久封禁';
      timeEl.style.display = 'block';
    }
    el.style.display = 'flex';
  }

  async function initialCheck() {
    var token = getToken();
    if (!token) { goCheck(); return false; }

    try {
      var form = new URLSearchParams();
      form.append('token', token);
      var res = await fetch(CHECK_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        credentials: 'include',
        cache: 'no-store'
      });
      if (!res.ok) return true; // 网络错误，交给 SSE 兜底
      var data = await res.json();

      if (data.banned === true) {
        showBanned(data.reason, data.ban_until);
        return false;
      }
      if (data.revoked === true) {
        clearToken();
        showRevoked(data.reason);
        return false;
      }
      if (data.valid === false) {
        clearToken();
        stop();
        goCheck();
        return false;
      }
      return true;
    } catch (e) {
      return true;
    }
  }

  function connectSSE() {
    if (revokedShown || bannedShown || stopped) return;
    var token = getToken();
    if (!token) { goCheck(); return; }

    closeSSE();

    var url = STREAM_API + '?token=' + encodeURIComponent(token);
    var es = new EventSource(url, { withCredentials: true });
    currentES = es;

    es.addEventListener('revoked', function (e) {
      var data = JSON.parse(e.data || '{}');
      clearToken();
      showRevoked(data.reason);
    });

    es.addEventListener('banned', function (e) {
      var data = JSON.parse(e.data || '{}');
      showBanned(data.reason, data.ban_until);
    });

    es.addEventListener('expired', function() {
       clearToken();
       stop();
       goCheck();
    });

    es.onerror = function () {
      if (es.readyState === EventSource.CLOSED) {
        currentES = null;
        if (!revokedShown && !bannedShown && !stopped) {
          setTimeout(connectSSE, 5000);
        }
      }
    };
  }

  function closeSSE() {
    if (currentES) {
      try { currentES.close(); } catch (e) {}
      currentES = null;
    }
  }

  async function start() {
    if (revokedShown || bannedShown) return;
    stopped = false;
    var ok = await initialCheck();
    if (ok) {
      connectSSE();
    }
  }

  function stop() {
    stopped = true;
    closeSSE();
  }

  document.addEventListener('visibilitychange', function () {
    if (revokedShown || bannedShown) return;
    if (document.visibilityState === 'visible') {
      start();
    } else {
      stop();
    }
  });
  window.addEventListener('pagehide', stop);

  window.__tokenGuard = {
    start: start,
    stop: stop,
    checkNow: initialCheck
  };

  if (getToken()) {
    start();
  } else {
    goCheck();
  }
})();