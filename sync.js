// Optional Google sign-in that keeps a plan in step across devices (Firebase Auth + Firestore).
// The site never needs it: everything still lives in localStorage, and this file only copies the
// plan keys to users/{uid} in Firestore and back. It loads as a plain script in <head> so it can see
// every localStorage write the planner makes, and it pulls in the Firebase SDK only on the live site.
(function () {
  "use strict";
  // Firebase web config is public by design (security comes from Auth + the Firestore rules in firestore.rules)
  var CONFIG = null;
  var HOSTS = /^(bigboxdiet\.com|www\.bigboxdiet\.com|mjsbroadbent\.github\.io|localhost|127\.0\.0\.1)$/;
  var SDK = "https://www.gstatic.com/firebasejs/11.0.2/";
  if (window.BBD_SYNC_TEST) { CONFIG = window.BBD_SYNC_TEST.config; SDK = window.BBD_SYNC_TEST.sdk; HOSTS = /./; }
  if (!CONFIG || !HOSTS.test(location.hostname) || !/^https?:$/.test(location.protocol)) return;

  // What follows you between devices: the plan (same keys as a share link) plus ticks and ratings.
  // The look, the open step and install state stay per device.
  var KEYS = ["ad-inputs", "ad-seed", "ad-week", "ad-nostock", "ad-staples", "ad-pantry", "ad-have", "ad-checked", "ad-rate", "ad-swapped"];
  var META = "ad-sync"; // { uid, stamp, hash }: the account and the cloud version this device last matched
  var raw = Storage.prototype.getItem, put = Storage.prototype.setItem, del = Storage.prototype.removeItem;
  var get = function (k) { try { return raw.call(localStorage, k); } catch (e) { return null; } };
  var meta = function () { try { return JSON.parse(get(META)) || {}; } catch (e) { return {}; } };
  var setMeta = function (m) { try { put.call(localStorage, META, JSON.stringify(m)); } catch (e) {} };
  var snapshot = function () { var o = {}; KEYS.forEach(function (k) { var v = get(k); if (v != null) o[k] = v; }); return o; };
  var hash = function (o) { var s = JSON.stringify(KEYS.map(function (k) { return o[k] == null ? null : o[k]; })), h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) + "." + s.length; };
  // A device someone has used, not just the starter week the planner builds on a first visit
  var hasPlan = function (o) { return KEYS.some(function (k) { return k !== "ad-week" && k !== "ad-seed" && o[k] != null && !/^(\[\]|\{\}|null)$/.test(o[k]); }); };
  var dev = (function () { var d = get("ad-dev"); if (!d) { d = Math.random().toString(36).slice(2, 10); try { put.call(localStorage, "ad-dev", d); } catch (e) {} } return d; })();

  // Watch the planner's own writes and push them a moment later
  var timer = 0, onChange = function () {};
  Storage.prototype.setItem = function (k, v) { var r = put.apply(this, arguments); if (this === localStorage && KEYS.indexOf(k) >= 0) { clearTimeout(timer); timer = setTimeout(function () { onChange(); }, 1500); } return r; };
  Storage.prototype.removeItem = function (k) { var r = del.apply(this, arguments); if (this === localStorage && KEYS.indexOf(k) >= 0) { clearTimeout(timer); timer = setTimeout(function () { onChange(); }, 1500); } return r; };
  addEventListener("pagehide", function () { if (timer) { clearTimeout(timer); timer = 0; onChange(); } });

  function apply(data, stamp, uid) {
    KEYS.forEach(function (k) { try { data[k] == null ? del.call(localStorage, k) : put.call(localStorage, k, data[k]); } catch (e) {} });
    setMeta({ uid: uid, stamp: stamp, hash: hash(data) });
    location.reload();
  }

  // ---------- Markup (styled by the design: .acct, .acct-menu, .sync-bar) ----------
  var box, bar;
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
  function banner(text, buttons) {
    if (bar) bar.remove();
    bar = el("div", "warn plan-in sync-bar");
    bar.setAttribute("role", "status");
    bar.appendChild(el("span", "", text));
    var b = el("span", "btns");
    (buttons || [{ label: "OK", ghost: true }]).forEach(function (x) {
      var btn = el("button", x.ghost ? "ghost" : "btn", x.label); btn.type = "button";
      btn.addEventListener("click", function () { bar.remove(); bar = null; if (x.go) x.go(); });
      b.appendChild(btn);
    });
    bar.appendChild(b);
    var wrap = document.querySelector(".wrap"), top = document.querySelector(".topbar");
    if (top && top.nextSibling) wrap.insertBefore(bar, top.nextSibling); else if (wrap) wrap.prepend(bar);
  }
  function ui(state, user) {
    if (!box) return;
    box.textContent = "";
    if (state === "out") {
      var b = el("button", "ghost", "Sign in to sync"); b.type = "button"; b.id = "signIn";
      b.title = "Save your plan to a Google account so it follows you to your other devices";
      b.addEventListener("click", signIn);
      box.appendChild(b);
      return;
    }
    var d = el("details", "acct-menu"), s = el("summary", "ghost");
    d.dataset.state = state;
    s.appendChild(el("span", "acct-dot")); s.appendChild(el("span", "acct-state", state === "busy" ? "Syncing" : state === "off" ? "Offline" : "Synced"));
    d.appendChild(s);
    var p = el("div", "acct-pop");
    p.appendChild(el("p", "note", "Signed in as " + (user.email || user.displayName || "you") + ". Your plan, ticks and ratings save to your account and sync to every device you sign in on."));
    var out = el("button", "ghost", "Sign out"); out.type = "button"; out.addEventListener("click", signOutNow);
    var wipe = el("button", "ghost", "Delete synced copy"); wipe.type = "button"; wipe.addEventListener("click", wipeCloud);
    var row = el("span", "btns"); row.appendChild(out); row.appendChild(wipe); p.appendChild(row);
    d.appendChild(p);
    box.appendChild(d);
  }
  function mount() {
    var top = document.querySelector(".topbar");
    if (!top || box) return;
    box = el("div", "acct"); box.id = "acct";
    top.insertBefore(box, document.getElementById("install"));
    ui(meta().uid ? "busy" : "out", {});
    var foot = document.querySelector("footer.fine");
    if (foot) {
      var n = el("p"); n.id = "syncNote";
      n.innerHTML = "<b>Accounts are optional.</b> Everything works without signing in and stays on your device. If you sign in with Google, your plan, ticks and ratings are saved to Google Firebase under your account so they sync between devices. Only you can read them, and Delete synced copy in the account menu removes them.";
      foot.appendChild(n);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();

  // ---------- Firebase ----------
  var fb = null, user = null, remote = null, unsub = null, ready = false, pending = null;
  function load() {
    if (fb) return fb;
    fb = Promise.all([import(SDK + "firebase-app.js"), import(SDK + "firebase-auth.js")]).then(function (m) {
      var app = m[0].initializeApp(CONFIG), A = m[1], auth = A.getAuth(app);
      return { app: app, A: A, auth: auth, fs: null };
    });
    fb.catch(function () { fb = null; });
    return fb;
  }
  function store(f) {
    if (!f.fs) f.fs = import(SDK + "firebase-firestore.js").then(function (F) { return { F: F, db: F.getFirestore(f.app) }; });
    return f.fs;
  }
  function signIn() {
    load().then(function (f) {
      var p = new f.A.GoogleAuthProvider();
      p.setCustomParameters({ prompt: "select_account" });
      return f.A.signInWithPopup(f.auth, p).catch(function (e) {
        if (e && e.code === "auth/popup-blocked") return f.A.signInWithRedirect(f.auth, p);
        if (e && /cancelled|closed-by-user/.test(e.code || "")) return;
        throw e;
      });
    }).catch(function (e) { banner("Sign-in didn't work" + (e && e.code ? " (" + e.code.replace("auth/", "") + ")" : "") + ". Your plan is still saved on this device."); });
  }
  function signOutNow() {
    load().then(function (f) { return f.A.signOut(f.auth); }).then(function () {
      setMeta({});
      banner("Signed out. Your plan stays on this device; sign in again to sync it.");
    });
  }
  function ref(S) { return S.F.doc(S.db, "users", user.uid); }
  function wipeCloud() {
    if (!user) return;
    if (unsub) { unsub(); unsub = null; }
    ready = false;
    load().then(store).then(function (S) { return S.F.deleteDoc(ref(S)); }).then(function () {
      var u = user; return load().then(function (f) { return f.A.signOut(f.auth); }).then(function () {
        setMeta({}); banner("Deleted the copy saved to " + (u.email || "your account") + " and signed out. This device still has your plan.");
      });
    }).catch(function () { banner("Couldn't delete the synced copy. Check your connection and try again."); watch(); });
  }

  // Push this device's plan when it changed since the last cloud version it matched
  function push(force) {
    if (!user || !ready) return Promise.resolve();
    var m = meta(), local = snapshot(), h = hash(local);
    if (!force && m.uid === user.uid && m.hash === h) return Promise.resolve();
    // Someone else saved since this device last matched the cloud: ask instead of overwriting
    if (!force && remote && remote.stamp !== m.stamp) return Promise.resolve(conflict());
    var stamp = Date.now().toString(36) + "-" + dev;
    ui("busy", user);
    pending = stamp;
    return load().then(store).then(function (S) {
      return S.F.setDoc(ref(S), { v: 1, data: local, stamp: stamp, at: S.F.serverTimestamp() });
    }).then(function () {
      remote = { data: local, stamp: stamp };
      setMeta({ uid: user.uid, stamp: stamp, hash: h });
      ui("on", user);
    }).catch(function (e) { ui("off", user); console.warn("Sync failed", e); });
  }
  onChange = function () { push(false); };

  function conflict() {
    banner("Your plan changed on another device too. Which one do you want to keep?", [
      { label: "Use the other device's", go: function () { apply(remote.data, remote.stamp, user.uid); } },
      { label: "Keep this device's", ghost: true, go: function () { push(true); } },
    ]);
  }

  // A cloud version arrived (first sign-in, page open, or another device saving)
  function received(doc, first) {
    var m = meta(), local = snapshot(), lh = hash(local), clean = m.uid === user.uid && m.hash === lh;
    if (!doc || !doc.data) { remote = null; ready = true; return push(true); } // nothing saved yet: this device's plan becomes the account's
    remote = { data: doc.data, stamp: doc.stamp };
    ready = true;
    if (m.uid === user.uid && m.stamp === doc.stamp) { ui("on", user); return push(false); } // already in step (maybe with local edits to send)
    var rh = hash(doc.data);
    if (rh === lh) { setMeta({ uid: user.uid, stamp: doc.stamp, hash: lh }); return ui("on", user); }
    if (first && (clean || (m.uid !== user.uid && !hasPlan(local)))) return apply(doc.data, doc.stamp, user.uid); // empty device, or untouched since last sync
    ui("on", user);
    if (clean) {
      banner("Your plan changed on another device.", [{ label: "Load it", go: function () { apply(doc.data, doc.stamp, user.uid); } }, { label: "Not now", ghost: true }]);
      return;
    }
    if (m.uid !== user.uid) {
      banner("Your account already has a saved plan, and this device has a different one. Which one do you want?", [
        { label: "Use my saved plan", go: function () { apply(doc.data, doc.stamp, user.uid); } },
        { label: "Keep this device's", ghost: true, go: function () { push(true); } },
      ]);
      return;
    }
    conflict();
  }

  function watch() {
    var first = true;
    return load().then(store).then(function (S) {
      if (unsub) unsub();
      unsub = S.F.onSnapshot(ref(S), function (snap) {
        if (snap.metadata.hasPendingWrites) return;
        var d = snap.exists() ? snap.data() : null;
        if (!first && d && ((remote && d.stamp === remote.stamp) || d.stamp === pending)) return; // our own save coming back
        var f0 = first; first = false;
        received(d, f0);
      }, function (e) { ui("off", user); console.warn("Sync listener failed", e); });
    });
  }

  function start() {
    load().then(function (f) {
      f.A.onAuthStateChanged(f.auth, function (u) {
        var was = user;
        user = u; ready = false; remote = null;
        if (unsub) { unsub(); unsub = null; }
        if (!u) { if (meta().uid) setMeta({}); return ui("out"); }
        ui("busy", u);
        if (!was && !meta().uid) banner("Signed in. Your plan now saves to your account and follows you to any device you sign in on.");
        watch().catch(function () { ui("off", u); });
      });
      f.A.getRedirectResult(f.auth).catch(function () {});
    }).catch(function () { if (meta().uid) ui("off", {}); });
  }
  // Signed in before: connect right away. Otherwise fetch the SDK when the browser is idle, so the
  // sign-in popup can open straight from the click (Safari blocks popups that wait on a download).
  if (meta().uid) start();
  else addEventListener("load", function () { setTimeout(function () { window.requestIdleCallback ? requestIdleCallback(start, { timeout: 5000 }) : start(); }, 1500); });
})();
