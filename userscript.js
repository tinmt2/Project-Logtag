(function () {
  "use strict";

  /** ===================== CONFIG ===================== **/
  const RELOAD_AFTER_MS = 5 * 60 * 1000;
  const RESCAN_INTERVAL_MS = 1 * 60 * 1000;
  const ALERT_COOLDOWN_MS = 5 * 60 * 1000;
  const STALE_MINUTES = 30;
  const TEMP_LOW_LT = 3.0;
  const TEMP_HIGH_GT = 6.0;
  // const OVERWRITE_LOGS_EACH_TIME = true;
  const SOUND_ENABLED_DEFAULT = true;

  // ===== Camera Config =====
  const CAMERA_URL = "https://camera-giamsat-mon.fptshop.com.vn/camera-dis";
  const CAMERA_COL = {
    CODE_NAME: 3,
    CH: 5,
    STATUS: 6,
    TRUE_1: 7,
    TRUE_2: 8,
    MINUTES: 11
  };
  const CAMERA_MINUTES_THRESHOLD = 20;
  const CAMERA_RESCAN_MS = 15000;

  const SOUND_CONFIG = {
    frequency: 800,
    duration: 5000,
    volume: 0.3,
    type: "sine",
    fadeOut: true,
  };

  /** ================== LocalStorage keys ============== **/
  const LS_LAST_ALERT_TS = "tm_last_alert_ts_v1";
  const LS_ALERT_LOGS = "tm_alert_logs_v1";
  const LS_PANEL_POS = "tm_panel_pos_v1";
  const LS_BUBBLE_POS = "tm_bubble_pos_v1";
  const LS_MINIMIZED = "tm_panel_minimized_v1";
  const LS_SOUND_ENABLED = "tm_sound_enabled_v1";
  const LS_LOGIN_CREDENTIALS = "tm_login_credentials_v1";
  const LS_CAMERA_ALERTS = "tm_camera_alerts_v1";

  /** ====================== Utils ====================== **/
  const MONTH = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const minutesDiff = (a, b) => Math.round((a - b) / 60000);

  function flatText(root) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let out = "",
      n;
    while ((n = tw.nextNode())) out += n.nodeValue + " ";
    return norm(out);
  }

  /** ===================== Regex ======================= **/
  const LOST_RE = /\blost[\s\W]*connection\b/i;
  const LAST_RE =
    /last\W*reading\W*:\W*(\d{1,2})\W*:\W*(\d{2})\W*([A-Za-z]{3})\W*(\d{1,2})\W*\W*(\d{4})/i;
  const TEMP_C_RE = /(-?\d+(?:[.,]\d+)?)\s*°\s*C\b/gi;

  function parseLastReadingFlat(flat) {
    const m = flat.match(LAST_RE);
    if (!m) return null;
    const [, hh, mm, monStr, dd, yyyy] = m;
    const mon = MONTH[monStr.slice(0, 3).replace(/^./, (c) => c.toUpperCase())];
    if (mon == null) return null;
    return new Date(+yyyy, mon, +dd, +hh, +mm, 0, 0);
  }

  /** ================ Camera Functions ================ **/
  const CAMERA_MINUTES_RE = /(\d+(?:\.\d+)?)\s*m\b/i;

  function camera_qsa(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function camera_rows() {
    return camera_qsa('table tr').filter(tr => norm(tr.textContent).length > 10);
  }

  function camera_cell(tr, idx1) {
    return tr.querySelector(`:scope > td:nth-child(${idx1}), :scope > th:nth-child(${idx1})`);
  }

  function camera_cellText(tr, idx1) {
    return norm((camera_cell(tr, idx1)?.textContent) || '');
  }

  function camera_isDisconnected(tr) {
    return /^disconnected$/i.test(camera_cellText(tr, CAMERA_COL.STATUS));
  }

  function camera_minutesValue(tr) {
    const txt = camera_cellText(tr, CAMERA_COL.MINUTES);
    const m = txt.match(CAMERA_MINUTES_RE);
    return m ? parseFloat(m[1]) : null;
  }

  function camera_isCamGS(tr) {
    const t1 = camera_cellText(tr, CAMERA_COL.TRUE_1);
    const t2 = camera_cellText(tr, CAMERA_COL.TRUE_2);
    return /\btrue\b/i.test(t1) || /\btrue\b/i.test(t2);
  }

  function camera_label(tr) {
    const codeName = camera_cellText(tr, CAMERA_COL.CODE_NAME);
    const ch = camera_cellText(tr, CAMERA_COL.CH).toUpperCase();
    return ch ? `${codeName} — ${ch}` : codeName;
  }

  function camera_scan() {
    const items = [];
    try {
      for (const tr of camera_rows()) {
        if (!camera_isDisconnected(tr)) continue;

        const mins = camera_minutesValue(tr);
        if (mins == null || !(mins < CAMERA_MINUTES_THRESHOLD)) continue;

        items.push({ 
          label: camera_label(tr), 
          mins, 
          isGS: camera_isCamGS(tr),
          type: 'camera'
        });
      }
    } catch (e) {
      console.error('Camera scan error:', e);
    }
    return items;
  }

  function getCameraAlerts() {
    return JSON.parse(localStorage.getItem(LS_CAMERA_ALERTS) || '[]');
  }

  function setCameraAlerts(alerts) {
    localStorage.setItem(LS_CAMERA_ALERTS, JSON.stringify(alerts));
  }

  function checkCameraAlerts() {
    // Chỉ scan camera nếu đang ở trang camera
    if (!window.location.href.includes('camera-giamsat-mon')) {
      return [];
    }
    
    const cameraItems = camera_scan();
    const previousAlerts = getCameraAlerts();
    
    if (cameraItems.length > 0) {
      setCameraAlerts(cameraItems);
      
      // Chỉ thông báo nếu có thay đổi
      const previousLabels = previousAlerts.map(a => a.label);
      const currentLabels = cameraItems.map(a => a.label);
      
      const newAlerts = cameraItems.filter(item => !previousLabels.includes(item.label));
      const resolvedAlerts = previousAlerts.filter(item => !currentLabels.includes(item.label));
      
      if (newAlerts.length > 0 || resolvedAlerts.length > 0) {
        return cameraItems;
      }
    } else {
      setCameraAlerts([]);
    }
    
    return [];
  }

  // Biến toàn cục cho camera modal
  let cameraModal = null;
  let cameraTab = null;

  /** ================ Camera Modal Management ================ **/
  function openCameraModal() {
    // Nếu modal đã tồn tại, focus vào nó
    if (cameraModal) {
      cameraModal.style.display = 'flex';
      return;
    }

    // Nếu tab camera đã mở, focus vào tab đó
    if (cameraTab && !cameraTab.closed) {
      try {
        cameraTab.focus();
        return;
      } catch (e) {
        // Tab đã bị đóng
        cameraTab = null;
      }
    }

    // Tạo modal mới
    cameraModal = document.createElement('div');
    cameraModal.className = 'tm-overlay';
    cameraModal.style.zIndex = '2147483647';
    cameraModal.innerHTML = `
      <div class="tm-modal tm-camera-modal" style="width: 95vw; height: 95vh;">
        <div class="tm-modal-h">
          <span>📷 Camera Monitoring</span>
          <div class="tm-actions">
            <button class="tm-iconbtn" id="tmCameraReload" title="Tải lại">↻</button>
            <button class="tm-iconbtn" id="tmCameraClose" title="Đóng (ESC)">×</button>
          </div>
        </div>
        <div class="tm-modal-b" style="padding: 0; flex: 1;">
          <iframe src="${CAMERA_URL}" 
                  class="tm-camera-frame" 
                  style="width: 100%; height: 100%; border: none;"
                  frameborder="0"></iframe>
        </div>
      </div>
    `;

    document.body.appendChild(cameraModal);

    // Sự kiện cho nút đóng
    cameraModal.querySelector('#tmCameraClose').onclick = closeCameraModal;
    
    // Sự kiện cho nút reload
    cameraModal.querySelector('#tmCameraReload').onclick = () => {
      const iframe = cameraModal.querySelector('.tm-camera-frame');
      if (iframe) {
        iframe.src = iframe.src;
      }
    };

    // Sự kiện click ra ngoài để đóng
    cameraModal.addEventListener('click', (e) => {
      if (e.target === cameraModal) {
        closeCameraModal();
      }
    });

    // Sự kiện ESC để đóng
    document.addEventListener('keydown', handleCameraEsc);
  }

  function closeCameraModal() {
    if (cameraModal) {
      document.removeEventListener('keydown', handleCameraEsc);
      cameraModal.remove();
      cameraModal = null;
    }
  }

  function handleCameraEsc(e) {
    if (e.key === 'Escape' && cameraModal) {
      closeCameraModal();
    }
  }

  /** ================ Ghi nhớ mật khẩu ================ **/
  function getSavedCredentials() {
    try {
      const saved = localStorage.getItem(LS_LOGIN_CREDENTIALS);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  }

  function saveCredentials(email, password) {
    try {
      localStorage.setItem(
        LS_LOGIN_CREDENTIALS,
        JSON.stringify({ email, password, timestamp: Date.now() })
      );
      console.log("Đã lưu thông tin đăng nhập");
    } catch (e) {
      console.warn("Không thể lưu thông tin đăng nhập:", e);
    }
  }

  function clearCredentials() {
    try {
      localStorage.removeItem(LS_LOGIN_CREDENTIALS);
      console.log("Đã xóa thông tin đăng nhập");
    } catch {}
  }

  function autoLogin() {
    const credentials = getSavedCredentials();
    if (!credentials) return false;

    // Kiểm tra nếu đã ở trang locations
    if (window.location.pathname.includes("/locations")) {
      return true;
    }

    // Kiểm tra nếu đang ở trang login
    if (
      window.location.pathname.includes("/login") ||
      document.querySelector('input[type="password"]')
    ) {
      console.log("Đang thực hiện tự động đăng nhập...");

      // Đợi một chút để trang load hoàn tất
      setTimeout(() => {
        // Tìm các trường input
        const emailInput = document.querySelector(
          'input[type="email"], input[name="email"], input[placeholder*="email" i], input:not([type])'
        );
        const passwordInput = document.querySelector('input[type="password"]');
        const submitButton = document.querySelector(
          'button[type="submit"], input[type="submit"], button:contains("SIGN IN"), button:contains("Sign In"), input[value*="Sign"], input[value*="Login"]'
        );

        if (emailInput && passwordInput) {
          console.log("Tìm thấy form đăng nhập, điền thông tin...");

          // Điền thông tin đăng nhập
          emailInput.value = credentials.email;
          passwordInput.value = credentials.password;

          // Kích hoạt sự kiện input
          emailInput.dispatchEvent(new Event("input", { bubbles: true }));
          passwordInput.dispatchEvent(new Event("input", { bubbles: true }));
          emailInput.dispatchEvent(new Event("change", { bubbles: true }));
          passwordInput.dispatchEvent(new Event("change", { bubbles: true }));

          // Đợi một chút rồi submit
          setTimeout(() => {
            if (submitButton) {
              console.log("Click nút submit");
              submitButton.click();
            } else {
              // Thử tìm form và submit
              const form = emailInput.closest("form");
              if (form) {
                console.log("Submit form");
                form.submit();
              }
            }
          }, 1500);

          return true;
        } else {
          console.log("Không tìm thấy form đăng nhập hoàn chỉnh");
        }
      }, 1000);

      return true;
    }

    return false;
  }

  /** ================ Thêm checkbox ghi nhớ ================ **/
  function setupRememberMeCheckbox() {
    // Kiểm tra xem đã có checkbox chưa
    if (document.querySelector("#tmRememberLogin")) return;

    // Tìm form đăng nhập
    const passwordInput = document.querySelector('input[type="password"]');
    if (!passwordInput) return;

    const form = passwordInput.closest("form");
    if (!form) return;

    // Tìm nút submit
    const submitButton = form.querySelector(
      'button[type="submit"], input[type="submit"]'
    );
    if (!submitButton) return;

    console.log("Đang thêm checkbox ghi nhớ mật khẩu...");

    // Tạo container cho checkbox
    const rememberContainer = document.createElement("div");
    rememberContainer.style.cssText = `
      margin: 15px 0;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      background: rgba(255,255,255,0.05);
      border-radius: 4px;
    `;

    rememberContainer.innerHTML = `
      <input type="checkbox" id="tmRememberLogin" style="margin: 0;">
      <label for="tmRememberLogin" style="color: #666; font-size: 14px; cursor: pointer; margin: 0;">Ghi nhớ đăng nhập</label>
      <button type="button" id="tmClearLogin" style="margin-left: auto; background: transparent; border: 1px solid #ccc; border-radius: 3px; padding: 2px 6px; font-size: 11px; color: #666; cursor: pointer;">Xóa</button>
    `;

    // Chèn checkbox vào trước nút submit
    submitButton.parentNode.insertBefore(rememberContainer, submitButton);

    // Sự kiện cho checkbox
    const rememberCheckbox = document.getElementById("tmRememberLogin");
    const clearButton = document.getElementById("tmClearLogin");

    // Kiểm tra xem có thông tin đã lưu không
    const savedCredentials = getSavedCredentials();
    if (savedCredentials) {
      rememberCheckbox.checked = true;
      // Tự động điền thông tin nếu có
      const emailInput = form.querySelector(
        'input[type="email"], input[name="email"]'
      );
      if (emailInput && !emailInput.value) {
        emailInput.value = savedCredentials.email;
      }
    }

    // Sự kiện khi submit form
    form.addEventListener("submit", function (e) {
      const emailInput = form.querySelector(
        'input[type="email"], input[name="email"]'
      );
      const passwordInput = form.querySelector('input[type="password"]');

      if (rememberCheckbox.checked && emailInput && passwordInput) {
        saveCredentials(emailInput.value, passwordInput.value);
        console.log("Đã lưu thông tin đăng nhập");
      } else {
        clearCredentials();
        console.log("Đã xóa thông tin đăng nhập");
      }
    });

    // Sự kiện cho nút xóa
    clearButton.addEventListener("click", function () {
      clearCredentials();
      rememberCheckbox.checked = false;

      // Xóa thông tin trong form
      const emailInput = form.querySelector(
        'input[type="email"], input[name="email"]'
      );
      const passwordInput = form.querySelector('input[type="password"]');
      if (emailInput) emailInput.value = "";
      if (passwordInput) passwordInput.value = "";

      alert("Đã xóa thông tin đăng nhập đã lưu");
    });

    console.log("Đã thêm checkbox ghi nhớ mật khẩu");
  }

  /** ================ Tính năng tìm kiếm ================ **/
  function setupSearchFeature() {
    let searchOverlay = null;
    let searchInput = null;
    let currentIndex = -1;
    let searchResults = [];

    function createSearchOverlay() {
      if (searchOverlay) return searchOverlay;

      searchOverlay = document.createElement("div");
      searchOverlay.style.cssText = `
        position: fixed;
        top: 50px;
        right: 20px;
        background: #1e1e1e;
        border: 1px solid #444;
        border-radius: 8px;
        padding: 10px;
        z-index: 2147483647;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        min-width: 300px;
        max-width: 90vw;
      `;

      searchOverlay.innerHTML = `
        <div style="display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;">
          <input type="text" id="tmSearchInput" placeholder="Tìm kiếm..." 
                 style="flex: 1; min-width: 150px; padding: 6px; background: #2d2d2d; border: 1px solid #555; border-radius: 4px; color: white;">
          <div style="display: flex; gap: 4px;">
            <button id="tmSearchPrev" style="padding: 6px 10px; background: #555; border: none; border-radius: 4px; color: white; cursor: pointer;">↑</button>
            <button id="tmSearchNext" style="padding: 6px 10px; background: #555; border: none; border-radius: 4px; color: white; cursor: pointer;">↓</button>
            <button id="tmSearchClose" style="padding: 6px 10px; background: #d32f2f; border: none; border-radius: 4px; color: white; cursor: pointer;">×</button>
          </div>
        </div>
        <div id="tmSearchResults" style="font-size: 12px; color: #ccc; word-break: break-word;">
          Nhấn Enter để tìm kiếm
        </div>
      `;

      document.body.appendChild(searchOverlay);
      searchInput = searchOverlay.querySelector("#tmSearchInput");

      // Sự kiện cho các nút
      searchOverlay.querySelector("#tmSearchPrev").onclick = () =>
        navigateSearch(-1);
      searchOverlay.querySelector("#tmSearchNext").onclick = () =>
        navigateSearch(1);
      searchOverlay.querySelector("#tmSearchClose").onclick = closeSearch;

      // Sự kiện cho input
      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          if (e.shiftKey) {
            navigateSearch(-1); // Shift+Enter: tìm kết quả trước
          } else {
            if (searchResults.length > 0) {
              navigateSearch(1); // Enter: tìm kết quả tiếp theo
            } else {
              performSearch(); // Enter lần đầu: thực hiện tìm kiếm
            }
          }
        } else if (e.key === "Escape") {
          closeSearch();
        }
      });

      return searchOverlay;
    }

    function performSearch() {
      const searchTerm = searchInput.value.trim();
      if (searchTerm.length < 2) {
        updateSearchResults("Nhập ít nhất 2 ký tự");
        return;
      }

      // Xóa highlight cũ
      clearHighlights();

      // Tìm kiếm trong toàn bộ nội dung trang
      const allTextNodes = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );

      let node;
      while ((node = walker.nextNode())) {
        if (node.textContent.toLowerCase().includes(searchTerm.toLowerCase())) {
          allTextNodes.push(node);
        }
      }

      searchResults = allTextNodes;

      if (searchResults.length > 0) {
        currentIndex = 0;
        highlightCurrentResult();
        updateSearchResults(
          `Tìm thấy ${searchResults.length} kết quả - Dùng ↑↓ để điều hướng`
        );
      } else {
        updateSearchResults("Không tìm thấy kết quả");
      }
    }

    function navigateSearch(direction) {
      if (searchResults.length === 0) return;

      currentIndex =
        (currentIndex + direction + searchResults.length) %
        searchResults.length;
      highlightCurrentResult();
      updateSearchResults(`${currentIndex + 1}/${searchResults.length}`);
    }

    function highlightCurrentResult() {
      // Xóa highlight cũ
      clearHighlights();

      if (searchResults[currentIndex]) {
        const node = searchResults[currentIndex];
        const searchTerm = searchInput.value.trim().toLowerCase();
        const nodeText = node.textContent;
        const lowerText = nodeText.toLowerCase();
        const index = lowerText.indexOf(searchTerm);

        if (index !== -1) {
          // Tạo highlight cho từ khóa tìm thấy
          const span = document.createElement("span");
          span.className = "tm-search-highlight-current";
          span.style.cssText =
            "background-color: #ff6b6b !important; color: white !important; padding: 2px 1px; border-radius: 2px;";

          const before = nodeText.substring(0, index);
          const highlight = nodeText.substring(
            index,
            index + searchTerm.length
          );
          const after = nodeText.substring(index + searchTerm.length);

          const fragment = document.createDocumentFragment();
          fragment.appendChild(document.createTextNode(before));

          const highlightSpan = document.createElement("span");
          highlightSpan.textContent = highlight;
          highlightSpan.style.cssText =
            "background-color: #ff6b6b !important; color: white !important; padding: 2px 1px; border-radius: 2px; font-weight: bold;";
          fragment.appendChild(highlightSpan);

          fragment.appendChild(document.createTextNode(after));

          // Thay thế node bằng fragment
          node.parentNode.replaceChild(fragment, node);

          // Cuộn đến vị trí highlight
          scrollToElement(highlightSpan);
        }
      }
    }

    function scrollToElement(element) {
      const rect = element.getBoundingClientRect();
      const absoluteElementTop = rect.top + window.pageYOffset;
      const middle = absoluteElementTop - window.innerHeight / 2;

      window.scrollTo({
        top: middle,
        behavior: "smooth",
      });
    }

    function clearHighlights() {
      // Xóa tất cả highlight
      document
        .querySelectorAll(".tm-search-highlight-current")
        .forEach((el) => {
          const parent = el.parentNode;
          if (parent) {
            const text = document.createTextNode(el.textContent);
            parent.replaceChild(text, el);
            // Normalize để gộp các text node liền kề
            parent.normalize();
          }
        });
    }

    function updateSearchResults(message) {
      const resultsDiv = searchOverlay.querySelector("#tmSearchResults");
      resultsDiv.textContent = message;
    }

    function closeSearch() {
      if (searchOverlay) {
        clearHighlights();
        searchOverlay.remove();
        searchOverlay = null;
        searchInput = null;
        searchResults = [];
        currentIndex = -1;
      }
    }

    function openSearch() {
      const overlay = createSearchOverlay();
      overlay.style.display = "block";
      searchInput.focus();
      searchInput.select();
    }

    // Global Ctrl+F handler
    function handleGlobalSearch(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        openSearch();
        return false;
      }
    }

    // Sử dụng capture phase để chặn sự kiện sớm hơn
    document.addEventListener("keydown", handleGlobalSearch, true);

    // Cũng thêm vào window để chắc chắn
    window.addEventListener("keydown", handleGlobalSearch, true);

    return { openSearch, closeSearch };
  }

  /** ==================== Global F5 Handler ==================== **/
  function setupGlobalF5Handler() {
    document.addEventListener("keydown", function (e) {
      if (e.key === "F5") {
        e.preventDefault();
        e.stopPropagation();
        location.reload();
        return false;
      }
    });
  }

  /** =================== Scan page ===================== **/
  function getShopCards() {
    const anchors = Array.from(
      document.querySelectorAll(
        "div.col-lg-4.col-md-4.col-sm-5.col-xs-5.text-left > span, .text-left > span"
      )
    ).filter((el) => norm(el.textContent));
    return anchors.map((anchor) => {
      const card =
        anchor.closest(".row") ||
        anchor.closest("li, .list-group-item, .card, .panel, .location-item") ||
        anchor.parentElement?.parentElement ||
        anchor;
      const label = norm(anchor.textContent || "");
      return { card, label };
    });
  }

  function buildLists() {
    const now = new Date();
    const lost = [],
      stale = [],
      tempOut = [];
    for (const { card, label } of getShopCards()) {
      const flat = flatText(card);

      if (LOST_RE.test(flat)) lost.push(label);

      const dt = parseLastReadingFlat(flat);
      if (dt) {
        const late = minutesDiff(now, dt);
        if (late >= STALE_MINUTES) stale.push({ label, late });
      }

      let m;
      TEMP_C_RE.lastIndex = 0;
      while ((m = TEMP_C_RE.exec(flat)) !== null) {
        const v = parseFloat(m[1].replace(",", "."));
        if (Number.isNaN(v) || v <= -30 || v >= 60) continue;
        if (v > TEMP_HIGH_GT) {
          tempOut.push({ label, value: v, status: "HIGH" });
          break;
        }
        if (v < TEMP_LOW_LT) {
          tempOut.push({ label, value: v, status: "LOW" });
          break;
        }
      }
    }
    return { lost, stale, tempOut };
  }

  /** ================ Logs (LUÔN ghi đè) =========== **/
  function setLogs(text) {
    try {
      // LUÔN ghi đè log cũ
      localStorage.setItem(LS_ALERT_LOGS, text);
    } catch {}
  }
  
  const getLogs = () => localStorage.getItem(LS_ALERT_LOGS) || "";
  
  const clearLogs = () => {
    try {
      localStorage.removeItem(LS_ALERT_LOGS);
    } catch {}
  };

  /** ===================== Cooldown ===================== **/
  const getLastAlertTs = () => {
    const v = parseInt(localStorage.getItem(LS_LAST_ALERT_TS) || "0", 10);
    return Number.isFinite(v) ? v : 0;
  };
  const setLastAlertTs = (ts) => {
    try {
      localStorage.setItem(LS_LAST_ALERT_TS, String(ts));
    } catch {}
  };
  const isCooldownActive = (nowMs) =>
    nowMs - getLastAlertTs() < ALERT_COOLDOWN_MS;

  /** ===================== Sound ===================== **/
  const getSoundEnabled = () => {
    const v = localStorage.getItem(LS_SOUND_ENABLED);
    if (v === null) return SOUND_ENABLED_DEFAULT;
    return v === "1";
  };
  const setSoundEnabled = (enabled) => {
    try {
      localStorage.setItem(LS_SOUND_ENABLED, enabled ? "1" : "0");
    } catch {}
  };

  function playAlertSound(repeat = 5, duration = 0.5, gap = 0.5) {
    if (!getSoundEnabled()) return;

    try {
      const audioContext = new (window.AudioContext ||
        window.webkitAudioContext)();

      for (let i = 0; i < repeat; i++) {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.type = SOUND_CONFIG.type || "sine"; // loại sóng
        oscillator.frequency.value = SOUND_CONFIG.freq || 880; // tần số (Hz)
        gainNode.gain.value = SOUND_CONFIG.volume || 0.2; // âm lượng

        let startTime = audioContext.currentTime + i * (duration + gap);
        let stopTime = startTime + duration;

        oscillator.start(startTime);
        oscillator.stop(stopTime);
      }
    } catch (e) {
      console.error("Audio Error:", e);
    }
  }

  /** ======================== UI ======================= **/
  let panel, cooldownSpan, lastSpan, toastDiv, bubble, soundBtn;

  // Biến toàn cục để quản lý modal
  let currentModal = null;
  let procedureModal = null;
  let alertDisplay = null;
  let alertModal = null;

  function injectStyles() {
    const css = document.createElement("style");
    css.textContent = `
      .tm-panel {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        background: #071234ff;
        color: #fff;
        font-family: system-ui, Arial, sans-serif;
        width: min(260px, 90vw);
        max-width: 95vw;
        border-radius: 12px;
        box-shadow: 0 14px 38px rgba(0,0,0,.45);
        cursor: grab;
        resize: both;
        overflow: auto;
        min-width: 200px;
        min-height: 150px;
        max-height: 80vh;
      }
      .tm-panel.dragging {
        cursor: grabbing;
        resize: none;
      }
      .tm-panel.resizing {
        cursor: nwse-resize;
      }
      .tm-head {
        padding: 10px 12px;
        font-size: min(14px, 3vw);
        font-weight: 600;
        background: rgba(218, 170, 170, 0.06);
        display: flex;
        align-items: center;
        justify-content: space-between;
        user-select: none;
        border-radius: 12px 12px 0 0;
        cursor: move;
      }
      .tm-actions {
        display: flex;
        gap: 6px;
      }
      .tm-iconbtn {
        width: 26px;
        height: 26px;
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,.2);
        background: rgba(255,255,255,.08);
        color: #fff;
        cursor: pointer;
        font-size: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .tm-body {
        padding: 10px 12px;
        display: grid;
        gap: 8px;
        overflow: auto;
      }
      .tm-row {
        font-size: min(12px, 2.5vw);
        opacity: .9;
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
      }
      .tm-btns {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      .tm-btn {
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: rgba(204, 64, 64, 0.08);
        color: #fff;
        padding: 6px;
        border-radius: 8px;
        font-size: min(12px, 2.5vw);
        cursor: pointer;
        text-align: center;
        word-break: break-word;
      }
      .tm-btn:hover {
        background: rgba(228, 242, 244, 0.16);
      }
      .tm-small {
        font-size: min(11px, 2vw);
        opacity: .8;
        word-break: break-word;
      }
      .tm-sound-btn {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,.2);
        background: rgba(255,255,255,.08);
        color: #fff;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
      }
      .tm-sound-btn:hover {
        background: rgba(255,255,255,.16);
      }
      .tm-sound-btn.muted {
        opacity: .6;
      }
      .tm-procedure-btn {
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: rgba(64, 128, 204, 0.08);
        color: #fff;
        padding: 6px;
        border-radius: 8px;
        font-size: min(12px, 2.5vw);
        cursor: pointer;
        text-align: center;
        word-break: break-word;
      }
      .tm-procedure-btn:hover {
        background: rgba(64, 128, 204, 0.16);
      }
      .tm-camera-btn {
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: rgba(255, 165, 0, 0.08);
        color: #fff;
        padding: 6px;
        border-radius: 8px;
        font-size: min(12px, 2.5vw);
        cursor: pointer;
        text-align: center;
        word-break: break-word;
      }
      .tm-camera-btn:hover {
        background: rgba(255, 165, 0, 0.16);
      }

      .tm-toast {
        position: fixed;
        left: 50%;
        transform: translateX(-50%);
        bottom: 24px;
        z-index: 2147483647;
        background: #222;
        color: #fff;
        padding: 10px 14px;
        border-radius: 10px;
        font-size: min(13px, 3vw);
        box-shadow: 0 6px 18px rgba(0,0,0,.35);
        opacity: 0;
        transition: opacity .2s;
        max-width: 90vw;
        word-break: break-word;
      }

      .tm-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,.5);
        backdrop-filter: blur(2px);
        z-index: 2147483646;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .tm-modal {
        width: min(900px, 92vw);
        height: min(520px, 82vh);
        background: #111;
        color: #eee;
        border: 1px solid #333;
        border-radius: 12px;
        box-shadow: 0 12px 34px rgba(0,0,0,.5);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .tm-modal-h {
        padding: 10px 14px;
        background: #181818;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
      }
      .tm-modal-b {
        padding: 10px 14px;
        flex: 1;
        overflow: auto;
      }
      .tm-textarea {
        width: 100%;
        height: 100%;
        min-height: 200px;
        background: #0a0101ff;
        color: #ddd;
        border: 1px solid #333;
        border-radius: 8px;
        padding: 10px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: min(12px, 2.5vw);
        white-space: pre;
        overflow: auto;
        resize: vertical;
      }
      .tm-modal-f {
        display: flex;
        gap: 10px;
        justify-content: flex-end;
        padding: 10px 14px;
        background: #181818;
        flex-wrap: wrap;
      }

      .tm-bubble {
        position: fixed;
        bottom: 18px;
        right: 18px;
        z-index: 2147483647;
        width: min(44px, 10vw);
        height: min(44px, 10vw);
        border-radius: 999px;
        box-shadow: 0 12px 28px rgba(0,0,0,.45);
        background: #14161c;
        color: #fff;
        border: 1px solid rgba(255,255,255,.2);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: grab;
        user-select: none;
      }
      .tm-bubble-btn {
        position: absolute;
        inset: 0;
        border: none;
        background: transparent;
        color: #fff;
        cursor: pointer;
        font-size: min(18px, 4vw);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      /* Alert Display trên màn hình chính */
      .tm-alert-display {
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483646;
        background: linear-gradient(135deg, #ff6b6b, #ee5a52);
        color: white;
        padding: 15px 25px;
        border-radius: 12px;
        box-shadow: 0 8px 25px rgba(255, 107, 107, 0.4);
        font-family: system-ui, Arial, sans-serif;
        font-weight: 600;
        font-size: 16px;
        text-align: center;
        max-width: 80vw;
        word-break: break-word;
        border: 2px solid #ff4757;
        animation: tmAlertSlideIn 0.5s ease-out;
      }

      .tm-alert-display.success {
        background: linear-gradient(135deg, #2ed573, #1dd1a1);
        border: 2px solid #00d2d3;
        box-shadow: 0 8px 25px rgba(46, 213, 115, 0.4);
      }

      .tm-alert-display.info {
        background: linear-gradient(135deg, #3742fa, #5352ed);
        border: 2px solid #3742fa;
        box-shadow: 0 8px 25px rgba(55, 66, 250, 0.4);
      }

      @keyframes tmAlertSlideIn {
        0% {
          opacity: 0;
          transform: translateX(-50%) translateY(-20px);
        }
        100% {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
      }

      @keyframes tmAlertSlideOut {
        0% {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
        100% {
          opacity: 0;
          transform: translateX(-50%) translateY(-20px);
        }
      }

      /* Mini Window Modal */
      .tm-mini-window {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 2147483646;
        background: #111;
        color: #eee;
        border: 1px solid #333;
        border-radius: 12px;
        box-shadow: 0 12px 34px rgba(0,0,0,.5);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        width: min(800px, 90vw);
        height: min(600px, 80vh);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }

      .tm-mini-header {
        padding: 8px 10px;
        background: #181818;
        display: flex;
        gap: 8px;
        align-items: center;
        justify-content: space-between;
        position: sticky;
        top: 0;
      }

      .tm-mini-header b {
        font-size: 12px;
      }

      .tm-mini-textarea {
        width: 100%;
        height: calc(100% - 82px);
        box-sizing: border-box;
        background: #d3d8d7ff;
        color: #05235cff;
        border: 0;
        border-top: 1px solid #333;
        padding: 10px;
        resize: none;
        white-space: pre;
        font-family: inherit;
        font-size: 18px;
        font-weight: bold;
      }

      .tm-mini-footer {
        padding: 8px 10px;
        background: #181818;
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        position: sticky;
        bottom: 0;
      }

      .tm-mini-btn {
        background: #2a2a2a;
        border: 1px solid #444;
        color: #fff;
        border-radius: 8px;
        padding: 6px 10px;
        cursor: pointer;
        font-family: inherit;
        font-size: 12px;
      }

      .tm-mini-btn:hover {
        background: #383838;
      }

      .muted {
        opacity: .7;
      }

      /* Camera Modal */
      .tm-camera-modal {
        width: 95vw !important;
        height: 95vh !important;
        max-width: none !important;
        max-height: none !important;
      }

      .tm-camera-frame {
        width: 100%;
        height: 100%;
        border: none;
        background: white;
      }

      /* Responsive design */
      @media (max-width: 768px) {
        .tm-panel {
          width: min(300px, 85vw);
          right: 8px;
          top: 8px;
        }
        .tm-btns {
          grid-template-columns: 1fr;
        }
        .tm-body {
          padding: 8px 10px;
          gap: 6px;
        }
        .tm-alert-display {
          top: 10px;
          padding: 12px 20px;
          font-size: 14px;
          max-width: 90vw;
        }
        .tm-mini-window {
          width: 95vw;
          height: 85vh;
        }
        .tm-camera-modal {
          width: 98vw !important;
          height: 98vh !important;
        }
      }

      @media (max-width: 480px) {
        .tm-panel {
          width: min(280px, 90vw);
          right: 4px;
          top: 4px;
        }
        .tm-head {
          padding: 8px 10px;
        }
        .tm-iconbtn {
          width: 24px;
          height: 24px;
        }
        .tm-alert-display {
          top: 5px;
          padding: 10px 15px;
          font-size: 13px;
        }
      }
    `;
    document.head.appendChild(css);
  }

  /** ==================== Hiển thị cảnh báo trên màn hình chính ==================== **/
  function showMainAlert(message, type = "alert", duration = 5000) {
    // Xóa alert cũ nếu có
    if (alertDisplay) {
      alertDisplay.style.animation = "tmAlertSlideOut 0.5s ease-in forwards";
      setTimeout(() => {
        if (alertDisplay && alertDisplay.parentNode) {
          alertDisplay.parentNode.removeChild(alertDisplay);
        }
      }, 500);
    }

    // Tạo alert mới
    alertDisplay = document.createElement("div");
    alertDisplay.className = `tm-alert-display ${type}`;
    alertDisplay.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
        <span style="font-size: 20px;">${getAlertIcon(type)}</span>
        <span>${message}</span>
        <button style="background: transparent; border: none; color: white; font-size: 18px; cursor: pointer; padding: 0; margin-left: 10px;" onclick="this.parentElement.parentElement.remove()">×</button>
      </div>
    `;

    document.body.appendChild(alertDisplay);

    // Tự động ẩn sau thời gian duration
    if (duration > 0) {
      setTimeout(() => {
        if (alertDisplay && alertDisplay.parentNode) {
          alertDisplay.style.animation =
            "tmAlertSlideOut 0.5s ease-in forwards";
          setTimeout(() => {
            if (alertDisplay && alertDisplay.parentNode) {
              alertDisplay.parentNode.removeChild(alertDisplay);
              alertDisplay = null;
            }
          }, 500);
        }
      }, duration);
    }

    return alertDisplay;
  }

  function getAlertIcon(type) {
    switch (type) {
      case "success":
        return "✅";
      case "info":
        return "ℹ️";
      case "alert":
      default:
        return "⚠️";
    }
  }

  /** ==================== Mini Window Modal ==================== **/
  function showMiniWindowModal() {
    // Kiểm tra nếu modal đã tồn tại thì không tạo mới
    if (alertModal) {
      alertModal.style.display = "flex";
      return;
    }
    // thẻ trong quét cảnh báo
    alertModal = document.createElement("div");
    alertModal.className = "tm-overlay";
    alertModal.innerHTML = `
      <div class="tm-mini-window" role="dialog" aria-label="Thông báo cảnh báo">
        <div class="tm-mini-header">
          <b>📄 Thông báo</b>
          <span class="muted" id="tmMiniTimestamp">${new Date().toLocaleTimeString()}</span>
        </div>
        <textarea class="tm-mini-textarea" id="tmMiniTextarea" readonly></textarea>
        <div class="tm-mini-footer">
 
        <button class="copy"><a href="https://docs.google.com/spreadsheets/d/1VusUQdljH-jqMFIQK4g_sQFvAqmVFBB9hra_DFUDgok/edit?pli=1&gid=773053306#gid=773053306" target="_blank" style="text-decoration: none;color: #161515ff "> Inside LC </a></button>
          <button class="tm-mini-btn" id="tmMiniScanNow">Reload</button>
          <button class="tm-mini-btn" id="tmMiniCopy">Copy toàn bộ</button>
          <button class="tm-mini-btn" id="tmMiniClose">Đóng</button>
        </div>
      </div>
    `;

    document.body.appendChild(alertModal);

    const textarea = alertModal.querySelector("#tmMiniTextarea");
    const timestamp = alertModal.querySelector("#tmMiniTimestamp");
    const scanBtn = alertModal.querySelector("#tmMiniScanNow");
    const copyBtn = alertModal.querySelector("#tmMiniCopy");
    const closeBtn = alertModal.querySelector("#tmMiniClose");

    // Cập nhật nội dung
    function updateContent() {
      textarea.value = getLogs();
      timestamp.textContent = new Date().toLocaleTimeString();
    }

    // Sự kiện click nút quét cảnh báo
    scanBtn.onclick = () => {
      const result = showAlertsOnce({ bypassCooldown: true });
      updateContent();
      if (result) {
        showToast("Đã quét và cập nhật cảnh báo");
      } else {
        showToast("Không có cảnh báo mới");
      }
      updatePanel();
    };

    // Sự kiện click nút copy
    copyBtn.onclick = () => {
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      showToast(ok ? "Đã copy toàn bộ nội dung" : "Copy thất bại");
    };

    // Sự kiện click nút đóng
    closeBtn.onclick = () => {
      alertModal.remove();
      alertModal = null;
    };

    // Sự kiện click ra ngoài modal để đóng
    alertModal.addEventListener("click", (e) => {
      if (e.target === alertModal) {
        alertModal.remove();
        alertModal = null;
      }
    });

    // Sự kiện keydown trong modal
    alertModal.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        alertModal.remove();
        alertModal = null;
      }
    });

    // Cập nhật nội dung ban đầu
    updateContent();

    // Tự động cập nhật nội dung mỗi 3 giây
    const updateInterval = setInterval(updateContent, 3000);

    // Dọn dẹp interval khi modal đóng
    alertModal.addEventListener("click", function cleanup(e) {
      if (e.target === alertModal || e.target.id === "tmMiniClose") {
        clearInterval(updateInterval);
        alertModal.removeEventListener("click", cleanup);
      }
    });

    // Focus vào textarea
    setTimeout(() => {
      textarea.focus();
    }, 100);
  }

  /** ==================== Responsive Panel ==================== **/
  function setupResponsivePanel() {
    let resizeObserver;

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver((entries) => {
        for (let entry of entries) {
          const { width, height } = entry.contentRect;
          adjustPanelSize(width, height);
        }
      });

      // Quan sát thay đổi kích thước của document body và panel
      if (panel) {
        resizeObserver.observe(document.body);
        resizeObserver.observe(panel);
      }
    }

    // Cũng lắng nghe sự kiện resize của window
    window.addEventListener("resize", handleWindowResize);
  }

  function adjustPanelSize(bodyWidth, bodyHeight) {
    if (!panel) return;

    const panelRect = panel.getBoundingClientRect();

    // Điều chỉnh kích thước panel dựa trên kích thước màn hình
    if (bodyWidth < 768) {
      // Mobile
      panel.style.width = "min(280px, 85vw)";
      panel.style.maxHeight = "70vh";
    } else if (bodyWidth < 1024) {
      // Tablet
      panel.style.width = "min(300px, 40vw)";
      panel.style.maxHeight = "75vh";
    } else {
      // Desktop
      panel.style.width = "min(320px, 30vw)";
      panel.style.maxHeight = "80vh";
    }

    // Đảm bảo panel không bị che bởi các cạnh
    ensurePanelInViewport();
  }

  function handleWindowResize() {
    const bodyWidth = document.body.clientWidth;
    const bodyHeight = document.body.clientHeight;
    adjustPanelSize(bodyWidth, bodyHeight);
  }

  function ensurePanelInViewport() {
    if (!panel) return;

    const rect = panel.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let newLeft = parseFloat(panel.style.left) || rect.left;
    let newTop = parseFloat(panel.style.top) || rect.top;

    // Kiểm tra và điều chỉnh nếu panel nằm ngoài viewport
    if (newLeft + rect.width > viewportWidth) {
      newLeft = viewportWidth - rect.width - 10;
    }
    if (newLeft < 0) {
      newLeft = 10;
    }
    if (newTop + rect.height > viewportHeight) {
      newTop = viewportHeight - rect.height - 10;
    }
    if (newTop < 0) {
      newTop = 10;
    }

    panel.style.left = newLeft + "px";
    panel.style.top = newTop + "px";
  }

  function enableDrag(el, handle, lsKey) {
    let sx = 0,
      sy = 0,
      ox = 0,
      oy = 0,
      dragging = false;
    const isInteractive = (n) =>
      n?.closest?.(
        "button, .tm-btn, .tm-iconbtn, a, input, textarea, select, [contenteditable]"
      );

    const onDown = (e) => {
      if (isInteractive(e.target)) return;
      const ev = e.touches ? e.touches[0] : e;
      dragging = true;
      el.classList.add("dragging");
      sx = ev.clientX;
      sy = ev.clientY;
      const r = el.getBoundingClientRect();
      ox = r.left;
      oy = r.top;
      el.style.right = "auto";
      el.style.bottom = "auto";
      if (!el.style.left) el.style.left = ox + "px";
      if (!el.style.top) el.style.top = oy + "px";
      document.body.style.userSelect = "none";
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!dragging) return;
      const ev = e.touches ? e.touches[0] : e;
      el.style.left = ox + (ev.clientX - sx) + "px";
      el.style.top = oy + (ev.clientY - sy) + "px";
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove("dragging");
      document.body.style.userSelect = "";
      if (!lsKey) return;
      const r = el.getBoundingClientRect();
      localStorage.setItem(lsKey, JSON.stringify({ x: r.left, y: r.top }));
    };

    handle.addEventListener("mousedown", onDown);
    handle.addEventListener("touchstart", onDown, { passive: false });
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
  }

  function showToast(msg) {
    if (!toastDiv) return;
    toastDiv.textContent = msg;
    toastDiv.style.opacity = "1";
    setTimeout(() => {
      toastDiv.style.opacity = "0";
    }, 1600);
  }

  /** ==================== Global ESC Handler ==================== **/
  function setupGlobalEscHandler() {
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeAllModals();
      }
    });
  }

  /** ==================== Close All Modals ==================== **/
  function closeAllModals() {
    // Đóng modal quy trình
    if (procedureModal) {
      procedureModal.remove();
      procedureModal = null;
    }

    // Đóng modal mini window
    if (alertModal) {
      alertModal.remove();
      alertModal = null;
    }

    // Đóng modal camera
    if (cameraModal) {
      closeCameraModal();
    }

    // Đóng modal tìm kiếm
    const searchOverlay = document.querySelector(".tm-overlay");
    if (searchOverlay) {
      searchOverlay.remove();
    }

    // Đóng bất kỳ modal nào khác
    const allModals = document.querySelectorAll(".tm-overlay");
    allModals.forEach((modal) => modal.remove());

    currentModal = null;
  }

  /** ==================== Procedure Modal ==================== **/
  function showProcedureModal() {
    // Kiểm tra nếu modal đã tồn tại thì không tạo mới
    if (procedureModal) {
      procedureModal.style.display = "flex";
      return;
    }
    // Quy trình
    const procedureContent = `
QUY TRÌNH XỬ LÝ CẢNH BÁO LOGTAG

1. XỬ LÝ MKN (LOGTAG, Elitech) và BÁO CHẬM:
 -CAMERA xem được sẽ theo dõi không cần gọi.
 -Theo dõi qua Camera xem trong TTTC hoặc kho có gì bất thường không.

2. XỬ LÝ NHIỆT ĐỘ BẤT THƯỜNG:
   - Có cảnh báo nhiệt độ cao hoặc thấp, theo dõi liên tục, nếu không (tăng, hạ) thì gọi shop ngay lập tức.

3. Xử lý CAMERA MKN:
    - Camera MKN -> gọi điều dưỡng -> Bác sĩ.... -> ASM (không ai lên shop được thì chỉ cần thông báo và bàn giao ASM)
    - TH tất cả đều không nghe máy -> Báo lại TN mail bàn giao.
4. Hướng dẫn sử dụng: 
    -2p web sẽ tự reload lại.
    -5p sẽ cảnh báo 1 lần
    - Nếu muốn nhận thông báo ngay thì bấm "Quét&Báo ngay" hoặc "Reload".
    - Mini window: mở 1 tab riêng để theo dõi logtag, bấm reload để quét cảnh báo mới.
    
    `.trim();

    procedureModal = document.createElement("div");
    procedureModal.className = "tm-overlay";
    procedureModal.innerHTML = `
      <div class="tm-modal" role="dialog" aria-label="Quy trình xử lý">
        <div class="tm-modal-h">
          <span>📋 Quy Trình Xử Lý Cảnh Báo</span>
          <button class="tm-btn" id="tmCloseProcedure">Đóng</button>
        </div>
        <div class="tm-modal-b">
          <textarea class="tm-textarea" readonly style="font-size: 15px; line-height: 1.5; background: #dfe9edff;color: black"> ${procedureContent} </textarea>
          
        </div>
        <div class="tm-modal-f">
        <a href="https://docs.google.com/spreadsheets/d/1VusUQdljH-jqMFIQK4g_sQFvAqmVFBB9hra_DFUDgok/edit?pli=1&gid=773053306#gid=773053306" target="_blank style="text-decoration: none;" >Xem quy trình đầy đủ tại đây</a>
          <button class="tm-btn" id="tmCopyProcedure">Copy nội dung</button>
        </div>
      </div>`;

    document.body.appendChild(procedureModal);

    // Sự kiện click nút đóng
    procedureModal.querySelector("#tmCloseProcedure").onclick = () => {
      procedureModal.remove();
      procedureModal = null;
    };

    // Sự kiện click nút copy
    procedureModal.querySelector("#tmCopyProcedure").onclick = () => {
      const textarea = procedureModal.querySelector(".tm-textarea");
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      showToast(ok ? "Đã copy quy trình" : "Copy thất bại");
    };

    // Sự kiện click ra ngoài modal để đóng
    procedureModal.addEventListener("click", (e) => {
      if (e.target === procedureModal) {
        procedureModal.remove();
        procedureModal = null;
      }
    });

    // Sự kiện keydown trong modal
    procedureModal.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        procedureModal.remove();
        procedureModal = null;
      }
    });
  }

  function updateSoundButton() {
    if (!soundBtn) return;
    const enabled = getSoundEnabled();
    soundBtn.innerHTML = enabled ? "🔊" : "🔇";
    soundBtn.classList.toggle("muted", !enabled);
  }
// nút camera
  function createPanel() {
    if (panel) return panel;
    injectStyles();
    panel = document.createElement("div");
    panel.className = "tm-panel";
    panel.innerHTML = `
      <div class="tm-head">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:min(16px, 3.5vw)">⚠️</span>
          <span>Theo dõi Logtag</span>
        </div>
        <div class="tm-actions">
          <button class="tm-sound-btn" id="tmSound" title="Bật/tắt âm thanh">🔊</button>
          <button class="tm-iconbtn" id="tmMin" title="Thu nhỏ">—</button>
        </div>
      </div>
      <div class="tm-body">
        <div class="tm-row"><span>Thời gian báo tiếp theo  :</span><span id="tmCooldown">—</span></div>
        <div class="tm-row"><span>Báo gần nhất:</span><span id="tmLast">—</span></div>
        <div class="tm-btns">
          <button class="tm-btn" id="tmMini">Mini window</button>
          <button class="tm-btn" id="tmShowNow">Quét & Báo ngay</button>
          <button class="tm-procedure-btn" id="tmProcedure">Quy trình gọi</button>
          <button class="tm-camera-btn" id="tmCamera">📷 Camera</button>
        </div>
      </div>`;
    document.body.appendChild(panel);

    cooldownSpan = panel.querySelector("#tmCooldown");
    lastSpan = panel.querySelector("#tmLast");
    soundBtn = panel.querySelector("#tmSound");
    toastDiv = document.createElement("div");
    toastDiv.className = "tm-toast";
    document.body.appendChild(toastDiv);

    enableDrag(panel, panel, LS_PANEL_POS);

    // Sửa lại sự kiện cho nút "Quét & Báo ngay" - CHỈ HIỆN MINI WINDOW KHI CÓ CẢNH BÁO
    panel.querySelector("#tmShowNow").onclick = () => {
      console.log("Nút Quét & Báo ngay được click");
      const result = showAlertsOnce({ bypassCooldown: true });

      if (result) {
        // CHỈ hiển thị Mini Window khi có cảnh báo mới
        showMiniWindowModal();
        showToast("Đã quét và gửi cảnh báo thành công");
        
        // Hiển thị cảnh báo lớn trên màn hình chính
        const { lost, stale, tempOut } = buildLists();
        const cameraAlerts = checkCameraAlerts();
        let alertMessage = `CẢNH BÁO MỚI!`;

        if (lost.length > 0) {
          alertMessage += `\n${lost.length} tủ MKN`;
        }
        if (stale.length > 0) {
          alertMessage += `\n${stale.length} tủ báo chậm`;
        }
        if (tempOut.length > 0) {
          alertMessage += `\n${tempOut.length} tủ nhiệt độ bất thường`;
        }
        if (cameraAlerts.length > 0) {
          alertMessage += `\n${cameraAlerts.length} camera mất kết nối`;
        }

        showMainAlert(alertMessage, "alert", 3000);
      } else {
        // KHÔNG hiển thị gì thêm khi không có cảnh báo
        showToast("Không có cảnh báo mới");
      }
      updatePanel();
      
      // Tự động ẩn toast sau khi click
      setTimeout(() => {
        if (toastDiv) toastDiv.style.opacity = "0";
      }, 500);
    };

    // Nút Mini window mở tab mới
    panel.querySelector("#tmMini").onclick = () => {
      openMiniAsTab();
      // Tự động ẩn toast sau khi click
      setTimeout(() => {
        if (toastDiv) toastDiv.style.opacity = "0";
      }, 500);
    };

    panel.querySelector("#tmMin").onclick = () => {
      minimizePanel();
      // Tự động ẩn toast sau khi click
      setTimeout(() => {
        if (toastDiv) toastDiv.style.opacity = "0";
      }, 500);
    };

    panel.querySelector("#tmProcedure").onclick = () => {
      showProcedureModal();
      // Tự động ẩn toast sau khi click
      setTimeout(() => {
        if (toastDiv) toastDiv.style.opacity = "0";
      }, 500);
    };

    // Nút Camera mới - Mở modal
    panel.querySelector("#tmCamera").onclick = () => {
      openCameraModal();
      showToast("Đang mở Camera...");
      // Tự động ẩn toast sau khi click
      setTimeout(() => {
        if (toastDiv) toastDiv.style.opacity = "0";
      }, 500);
    };

    soundBtn.onclick = () => {
      const current = getSoundEnabled();
      setSoundEnabled(!current);
      updateSoundButton();
      showToast(!current ? "🔊 Đã bật âm thanh" : "🔇 Đã tắt âm thanh");
    };

    updateSoundButton();
    setupResponsivePanel();

    if (localStorage.getItem(LS_MINIMIZED) === "1") showBubble();

    document.addEventListener("keydown", (e) => {
      if (e.altKey && (e.key === "l" || e.key === "L")) openMiniAsTab();
    });

    return panel;
  }

  function showBubble() {
    if (bubble) {
      bubble.style.display = "flex";
      panel.style.display = "none";
      return;
    }
    bubble = document.createElement("div");
    bubble.className = "tm-bubble";
    bubble.innerHTML = `<button class="tm-bubble-btn" title="Mở lại">⚠️</button>`;
    document.body.appendChild(bubble);

    const pos = JSON.parse(localStorage.getItem(LS_BUBBLE_POS) || "null");
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      bubble.style.left = pos.x + "px";
      bubble.style.top = pos.y + "px";
      bubble.style.right = "auto";
      bubble.style.bottom = "auto";
    }
    enableDrag(bubble, bubble, LS_BUBBLE_POS);
    bubble.querySelector(".tm-bubble-btn").onclick = () => {
      restorePanel();
      // Tự động ẩn toast sau khi click
      setTimeout(() => {
        if (toastDiv) toastDiv.style.opacity = "0";
      }, 500);
    };
    panel.style.display = "none";
  }

  const minimizePanel = () => {
    localStorage.setItem(LS_MINIMIZED, "1");
    showBubble();
  };

  const restorePanel = () => {
    localStorage.removeItem(LS_MINIMIZED);
    if (bubble) bubble.style.display = "none";
    panel.style.display = "block";
  };

  /** ============== Mini show as TAB (single) =========== **/
  let miniTabRef = null,
    openingMini = false;
  function openMiniAsTab() {
    if (openingMini) return;
    openingMini = true;
    setTimeout(() => (openingMini = false), 700);

    if (miniTabRef && !miniTabRef.closed) {
      try {
        miniTabRef.focus();
      } catch {}
      return;
    }

    //CSS cho mini log
    const html = `
<!doctype html><html><head><meta charset="utf-8"><title>LogTag — Mini Logs</title>
<style>
  body{margin:0;background:#111;color:#eee;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace}
  header{padding:8px 10px;background:#181818;display:flex;gap:8px;align-items:center;justify-content:space-between;position:sticky;top:0}
  header b{font-size:12px}
  textarea{width:100%;height:calc(100vh - 82px);box-sizing:border-box;background:#d3d8d7ff;color:#05235cff;border:0;border-top:1px solid #cdc5c5ff;padding:10px;resize:none;white-space:pre;font-weight:bold; font-size:13px}
  button{background:#2a2a2a;border:1px solid #444;color:#fff;border-radius:8px;padding:6px 10px;cursor:pointer}
  button:hover{background:#383838}
  footer{padding:8px 10px;background:#181818;display:flex;gap:8px;justify-content:flex-end;position:sticky;bottom:0}
  .muted{opacity:.7}
</style></head><body>
  <header><b>📄Thông báo</b><span class="muted" id="ts"></span></header>
  <textarea id="ta" readonly></textarea>
  <footer>
    <button class="copy"><a href="https://insidepharmacy.fptshop.com.vn/LongChau.aspx" target="_blank" style="text-decoration: none;color: #cdc5c5ff "> Inside LC </a></button>
    <button id="scanNow">Reload</button>
    <button id="copy">Copy toàn bộ</button>
  </footer>
<script>
  const LS='${LS_ALERT_LOGS}';
  const ta=document.getElementById('ta'), ts=document.getElementById('ts');

  function sync(){ 
    try { 
      ta.value = localStorage.getItem(LS) || ''; 
    } catch(e) { 
      ta.value='(Không đọc được localStorage)'; 
    } 
    ts.textContent=new Date().toLocaleTimeString(); 
  }
  
  document.getElementById('copy').onclick=()=>{ 
    ta.focus(); 
    ta.select(); 
    const ok = document.execCommand('copy');
    if (ok) {
      const originalText = ts.textContent;
      ts.textContent = 'Đã copy!';
      setTimeout(() => ts.textContent = originalText, 1000);
    }
  };

  document.getElementById('scanNow').onclick=()=>{
    // Gửi thông điệp đến tab chính để quét cảnh báo
    if (window.opener) {
      window.opener.postMessage({ action: 'scanAlertsNow' }, '*');
      ts.textContent = 'Đã yêu cầu quét...';
    } else {
      ts.textContent = 'Không thể kết nối đến tab chính';
    }
  };

  // Lắng nghe thông điệp cập nhật logs
  window.addEventListener('message', function(event) {
    if (event.data.action === 'updateLogs') {
      sync();
    }
  });

  // ESC để đóng cửa sổ
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      window.close();
    }
  });

  let zoomLevel = 1;
  document.addEventListener('wheel', function(e) {
    if (e.ctrlKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      zoomLevel = Math.min(Math.max(0.5, zoomLevel + delta), 3);
      document.body.style.fontSize = (12 * zoomLevel) + 'px';
      ta.style.fontSize = (12 * zoomLevel) + 'px';
    }
  }, { passive: false });

  sync(); 
  setInterval(sync, 3000);
<\/script>
</body></html>`.trim();

    let win = null;
    try {
      win = window.open(
        "",
        "logtag_mini_tab",
        "width=800,height=600,resizable=yes,scrollbars=yes"
      );
    } catch {}
    if (win) {
      try {
        win.document.open();
        win.document.write(html);
        win.document.close();
      } catch (e) {
        try {
          const blob = new Blob([html], { type: "text/html" });
          const url = URL.createObjectURL(blob);
          win.location.href = url;
          setTimeout(() => URL.revokeObjectURL(url), 8000);
        } catch (_) {}
      }
      miniTabRef = win;
      try {
        win.focus();
      } catch {}
      return;
    }

    try {
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.target = "logtag_mini_tab";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
    } catch (_) {
      // Fallback không cần mở log viewer
    }
  }

  /** ===================== Counters ===================== **/
  function updatePanel() {
    const now = Date.now(),
      last = getLastAlertTs();
    const remain = Math.max(0, ALERT_COOLDOWN_MS - (now - last));
    if (lastSpan)
      lastSpan.textContent = last ? new Date(last).toLocaleString() : "—";
    if (cooldownSpan)
      cooldownSpan.textContent =
        remain > 0
          ? `${Math.floor(remain / 60000)}m ${Math.ceil((remain / 1000) % 60)}s`
          : "Hết cooldown";
  }

  /** ==================== Alert flow ==================== **/
  function showAlertsOnce(opts = {}) {
    const now = Date.now();
    if (!opts.bypassCooldown && isCooldownActive(now)) {
      console.log("Đang trong thời gian cooldown, bỏ qua cảnh báo");
      return false;
    }

    console.log("Bắt đầu quét cảnh báo...");
    const { lost, stale, tempOut } = buildLists();
    const cameraAlerts = checkCameraAlerts();
    console.log("Kết quả quét:", { lost, stale, tempOut, cameraAlerts });

    // XÓA LOG CŨ TRƯỚC KHI KIỂM TRA CẢNH BÁO MỚI
    clearLogs();

    if (!lost.length && !stale.length && !tempOut.length && !cameraAlerts.length) {
      console.log("Không có cảnh báo nào");
      // KHÔNG ghi gì vào logs khi không có cảnh báo
      return false;
    }

    const lines = [];
    lines.push(`Thông Báo (${new Date().toLocaleString()})`);
    lines.push("");
    if (lost.length) {
      lines.push("");
      lines.push(`**********LOGTAG MẤT KẾT NỐI********** ${lost.length}Tủ`);
      lines.push(...lost.map((n) => ` ${n.replace(/\s*-\s*/i, ":")}`));
      lines.push("");
    }
    if (stale.length) {
      lines.push("");
      lines.push("");
      lines.push(`**********LOGTAG BÁO CHẬM:********** ${stale.length} Tủ`);
      lines.push("");

      // Tính độ rộng tối đa cho phần label (giống phần nhiệt độ)
      const maxStaleLabelLength = Math.max(
        ...stale.map((item) => item.label.replace(/\s*-\s*/i, ":").length)
      );

      lines.push(
        ...stale
          .map((it) => {
            const formattedLabel = it.label.replace(/\s*-\s*/i, ":");
            const paddedLabel = formattedLabel.padEnd(
              maxStaleLabelLength + 5,
              " "
            );
            const minutePart = `${it.late}Phút`.padStart(10, " "); // Căn phải số phút

            const line = `${paddedLabel}${minutePart}`;
            return [line, ""]; // Trả về mảng [dòng, hàng trống] - cách dòng giống nhiệt độ
          })
          .flat()
      );
    }
    lines.push("");
    lines.push("");
    if (tempOut.length) {
      lines.push(`**********NHIỆT ĐỘ*********(${tempOut.length} Tủ)`);
      lines.push("");
      //nhiệt đọ
      lines.push(
        ...tempOut
          .map((it) => {
            let formattedLabel = it.label.replace(/\s*-\s*/i, ": ");

            // Tự động tính độ rộng tối đa của label
            const maxLabelLength = Math.max(
              ...tempOut.map(
                (item) => item.label.replace(/\s*-\s*/i, ": ").length
              )
            );

            // Căn trái label và căn phải nhiệt độ
            const paddedLabel = formattedLabel.padEnd(maxLabelLength + 10, " ");
            const tempPart = `${it.value}°C`;

            const line =
              it.status === "HIGH"
                ? `${paddedLabel}${tempPart}`
                : `${paddedLabel}${tempPart}`;

            return [line, ""]; // Trả về mảng [dòng, hàng trống]
          })
          .flat() // Làm phẳng mảng
      );
    }
    if (cameraAlerts.length) {
      lines.push("");
      lines.push("");
      lines.push(`**********CAMERA MẤT KẾT NỐI********** ${cameraAlerts.length} Camera`);
      lines.push("");
      lines.push(
        ...cameraAlerts
          .map((it) => {
            const prefix = it.isGS ? '📷 Cam GS: ' : '📷 ';
            return `${prefix}${it.label} — ${it.mins}m`;
          })
      );
    }
    const text = lines.filter((s) => s != null).join("\n");

    console.log("Nội dung cảnh báo:", text);
    setLogs(text);
    playAlertSound();
    setLastAlertTs(now);
    updatePanel();

    // Thông báo cho mini tab nếu đang mở
    if (miniTabRef && !miniTabRef.closed) {
      try {
        miniTabRef.postMessage({ action: "updateLogs" }, "*");
      } catch (e) {
        console.log("Không thể cập nhật mini tab");
      }
    }

    console.log("Đã gửi cảnh báo thành công");
    return true;
  }

  /** ==================== Camera Background Scan ==================== **/
  function startCameraBackgroundScan() {
    // Chỉ chạy camera scan nếu đang ở trang camera
    if (window.location.href.includes('camera-giamsat-mon')) {
      setInterval(() => {
        try {
          const cameraAlerts = checkCameraAlerts();
          if (cameraAlerts.length > 0) {
            console.log('Camera alerts detected:', cameraAlerts);
            // Tích hợp cảnh báo camera vào hệ thống chung
            showAlertsOnce({ bypassCooldown: true });
          }
        } catch (e) {
          console.error('Camera background scan error:', e);
        }
      }, CAMERA_RESCAN_MS);
    }
  }

  /** ==================== Message Handler for Mini Tab ==================== **/
  function setupMessageHandler() {
    window.addEventListener("message", function (event) {
      if (event.data.action === "scanAlertsNow") {
        console.log("Nhận yêu cầu quét từ mini tab");
        const result = showAlertsOnce({ bypassCooldown: true });
        updatePanel();
        if (result) {
          showToast("Đã quét và gửi cảnh báo từ mini tab");
          const { lost, stale, tempOut } = buildLists();
          const cameraAlerts = checkCameraAlerts();
          let alertMessage = `CẢNH BÁO MỚI!`;

          if (lost.length > 0) {
            alertMessage += `\n${lost.length} tủ MKN`;
          }
          if (stale.length > 0) {
            alertMessage += `\n${stale.length} tủ báo chậm`;
          }
          if (tempOut.length > 0) {
            alertMessage += `\n${tempOut.length} tủ nhiệt độ bất thường`;
          }
          if (cameraAlerts.length > 0) {
            alertMessage += `\n${cameraAlerts.length} camera mất kết nối`;
          }

          showMainAlert(alertMessage, "alert",  3000);
        } else {
          showToast("Không có cảnh báo mới từ mini tab");
          // KHÔNG hiển thị alert chính khi không có cảnh báo
        }
      }
    });
  }

  /** ======================= Run ======================== **/
  function start() {
    // Thiết lập tính năng tìm kiếm - PHẢI GỌI ĐẦU TIÊN
    setupSearchFeature();

    // Thiết lập F5 reload
    setupGlobalF5Handler();

    // Thiết lập message handler cho mini tab
    setupMessageHandler();

    // Thiết lập auto login và checkbox ghi nhớ
    if (
      window.location.pathname.includes("/login") ||
      document.querySelector('input[type="password"]')
    ) {
      console.log("Phát hiện trang đăng nhập");

      // Thêm checkbox ghi nhớ
      setTimeout(() => {
        setupRememberMeCheckbox();
      }, 1000);

      // Thử auto login
      setTimeout(() => {
        autoLogin();
      }, 1500);
    }

    // Chỉ khởi tạo panel khi đã ở trang locations hoặc camera
    if (window.location.pathname.includes("/locations") || window.location.href.includes('camera-giamsat-mon')) {
      createPanel();
      try {
        const pos = JSON.parse(localStorage.getItem(LS_PANEL_POS) || "null");
        if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
          panel.style.left = pos.x + "px";
          panel.style.top = pos.y + "px";
          panel.style.right = "auto";
          panel.style.bottom = "auto";
        }
      } catch {}

      updatePanel();
      setInterval(updatePanel, 1000);
      showAlertsOnce();
      setInterval(showAlertsOnce, RESCAN_INTERVAL_MS);
      setTimeout(() => location.reload(), RELOAD_AFTER_MS);

      // Bắt đầu scan camera nền (chỉ khi ở trang camera)
      startCameraBackgroundScan();

      setupGlobalEscHandler();
    }
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start);
  else start();
})();