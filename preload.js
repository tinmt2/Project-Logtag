// preload.js
const fs = require("fs");
const path = require("path");

(function bootstrap() {
  // Chỉ chạy trên đúng host/path cần thiết
  const shouldRunHere = () => {
    try {
      const { hostname, pathname } = window.location;
      if (!/(^|\.)logtagonline\.com$/i.test(hostname)) return false;
      // chấp nhận /locations và các biến thể có query/hash
      return pathname.toLowerCase().startsWith("/locations");
    } catch {
      return false;
    }
  };

  // Bơm code vào "page world" để script chạy như code của chính trang
  const injectToPage = (code) => {
    try {
      // Guard trong page world (tránh chạy nhiều lần nếu reload/nhúng lại)
      const wrapped = `
        (function(){
          try
          { if (window.__logtag_injected) return;
            window.__logtag_injected = true;
            ${code}}catch(e){ console.error('[preload] userscript error:', e); }
        })();`;
      const s = document.createElement("script");
      s.textContent = wrapped;
      (document.head || document.documentElement).appendChild(s);
      s.remove();
      console.log("[preload] userscript injected.");
    } catch (e) {
      console.error("[preload] injectToPage failed:", e);
    }
  };

  // Đọc file userscript.js nằm cạnh preload.js
  const readUserScript = () => {
    const file = path.join(__dirname, "userscript.js");
    try {
      const code = fs.readFileSync(file, "utf8");
      console.log("[preload] userscript loaded:", file, "length=", code.length);
      return code;
    } catch (e) {
      console.error("[preload] cannot read userscript.js:", e);
      return null;
    }
  };

  // Chỉ inject 1 lần cho mỗi renderer
  if (window.__preload_guard) return;
  window.__preload_guard = true;

  // Sau khi DOM sẵn sàng mới bơm
  const start = () => {
    if (!shouldRunHere()) {
      console.log("[preload] skip: not locations page:", window.location.href);
      return;
    }
    // Tránh bơm 2 lần nếu trang SPA đẩy state
    if (window.__logtag_preloaded) return;
    window.__logtag_preloaded = true;

    // 1) Thử đọc file userscript.js
    let code = readUserScript();

    // 2) Fallback: nếu không đọc được, có thể chèn 1 thông báo đơn giản
    if (!code) {
      code = console.warn("[userscript fallback] Không tìm thấy userscript.js");
    }

    injectToPage(code);
  };

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    // DOM đã sẵn
    start();
  }

  // Bắt thêm event SPA (nếu trang thay đổi URL bằng history API)
  // để bơm lại khi quay về /locations
  const pushState = history.pushState;
  const replaceState = history.replaceState;
  const onUrlChange = () => {
    try {
      // reset cờ để cho phép inject lại sau khi chuyển route
      window.__logtag_preloaded = false;
      start();
    } catch {}
  };
  history.pushState = function () {
    const r = pushState.apply(this, arguments);
    onUrlChange();
    return r;
  };
  history.replaceState = function () {
    const r = replaceState.apply(this, arguments);
    onUrlChange();
    return r;
  };
  window.addEventListener("popstate", onUrlChange);
})();
