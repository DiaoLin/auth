/* global JSZip */
(function () {
  "use strict";

  const embedMode = new URLSearchParams(window.location.search).get("embed") === "1";
  const C = window.PvzSaveCore;
  if (!C) {
    document.body.innerHTML = "<p style='padding:30px;color:#ff8b8b'>缺少 pvz-save-core.js，无法启动存档编辑器。</p>";
    return;
  }

  const $ = (selector) => document.querySelector(selector);
  const state = {
    files: new Map(),
    activeId: null,
    counter: 0,
    browser: null,
    cloudSlot: null,
    cloudSlots: [],
    selected: new Map(),
    toastTimer: 0,
  };

  const KIND_LABEL = {
    profile: "玩家存档",
    users: "用户列表",
    v4: "关卡存档",
    legacy: "旧版数据",
    error: "错误",
  };

  const CHALLENGE_NAMES = [
    "生存：白天", "生存：黑夜", "生存：泳池", "生存：浓雾", "生存：屋顶",
    "生存（困难）：白天", "生存（困难）：黑夜", "生存（困难）：泳池", "生存（困难）：浓雾", "生存（困难）：屋顶",
    "生存（无尽）：白天", "生存（无尽）：黑夜", "生存（无尽）：泳池", "生存（无尽）：浓雾", "生存（无尽）：屋顶",
    "豌豆与僵尸", "坚果保龄球", "老虎机", "天降种子", "宝石迷阵",
    "隐形食尸鬼", "看见星星", "僵尸水族馆", "宝石迷阵：旋转", "小僵尸大麻烦",
    "传送门大战", "专栏攻击", "雪橇区", "僵尸快速", "打僵尸",
    "最后防线", "豌豆与僵尸 2", "坚果保龄球 2", "撑杆派对", "僵尸博士的复仇",
    "坚果艺术挑战", "晴天", "除草日", "大时代", "向日葵艺术挑战",
    "空袭", "冰关", "禅境花园", "高重力", "墓地危险",
    "你能挖吗", "暴风雨之夜", "蹦极闪电战", "松鼠", "智慧树",
    "花瓶破坏者 1", "花瓶破坏者 2", "花瓶破坏者 3", "花瓶破坏者 4", "花瓶破坏者 5",
    "花瓶破坏者 6", "花瓶破坏者 7", "花瓶破坏者 8", "花瓶破坏者 9", "花瓶破坏者无尽",
    "我是僵尸 1", "我是僵尸 2", "我是僵尸 3", "我是僵尸 4", "我是僵尸 5",
    "我是僵尸 6", "我是僵尸 7", "我是僵尸 8", "我是僵尸 9", "我是僵尸无尽",
    "Upsell", "Intro",
  ];

  const PURCHASE_INFO = [
    ["机枪豌豆", "1 = 已购买"], ["双胞向日葵", "1 = 已购买"], ["忧郁蘑菇", "1 = 已购买"],
    ["香蒲", "1 = 已购买"], ["冰西瓜", "1 = 已购买"], ["金磁铁", "1 = 已购买"],
    ["地刺王", "1 = 已购买"], ["玉米加农炮", "1 = 已购买"], ["模仿者", "1 = 已购买"],
    ["额外割草机", "数量/标志"], ["金盏花（左）", "日期或标志"], ["金盏花（中）", "日期或标志"],
    ["金盏花（右）", "日期或标志"], ["黄金浇水壶", "1 = 已购买"], ["肥料", "1000 + 数量"],
    ["杀虫剂", "1000 + 数量"], ["留声机", "1 = 已购买"], ["园艺手套", "1 = 已购买"],
    ["蘑菇花园", "1 = 已购买"], ["手推车", "1 = 已购买"], ["蜗牛 Stinky", "时间戳/标志"],
    ["卡槽升级", "0-4"], ["泳池清洁车", "1 = 已购买"], ["屋顶清洁车", "1 = 已购买"],
    ["耙子", "剩余使用次数"], ["水族馆花园", "1 = 已购买"], ["巧克力", "1000 + 数量"],
    ["智慧树", "1 = 已购买"], ["树食", "1000 + 数量"], ["急救", "1 = 已购买"],
    ["扩展 #30", "原版未使用"], ["扩展 #31", "原版未使用"], ["扩展 #32", "原版未使用"],
    ["扩展 #33", "原版未使用"], ["扩展 #34", "原版未使用"], ["扩展 #35", "原版未使用"],
    ["扩展 #36", "原版未使用"], ["扩展 #37", "原版未使用"], ["扩展 #38", "原版未使用"],
    ["扩展 #39", "原版未使用"], ["扩展 #40", "原版未使用"], ["扩展 #41", "原版未使用"],
    ["扩展 #42", "原版未使用"], ["扩展 #43", "原版未使用"], ["扩展 #44", "原版未使用"],
    ["扩展 #45", "原版未使用"], ["扩展 #46", "原版未使用"], ["扩展 #47", "原版未使用"],
    ["扩展 #48", "原版未使用"], ["扩展 #49", "原版未使用"], ["扩展 #50", "原版未使用"],
    ["扩展 #51", "原版未使用"], ["扩展 #52", "原版未使用"], ["扩展 #53", "原版未使用"],
    ["扩展 #54", "原版未使用"], ["扩展 #55", "原版未使用"], ["扩展 #56", "原版未使用"],
    ["扩展 #57", "原版未使用"], ["扩展 #58", "原版未使用"], ["扩展 #59", "原版未使用"],
    ["扩展 #60", "原版未使用"], ["扩展 #61", "原版未使用"], ["扩展 #62", "原版未使用"],
    ["扩展 #63", "原版未使用"], ["扩展 #64", "原版未使用"], ["扩展 #65", "原版未使用"],
    ["扩展 #66", "原版未使用"], ["扩展 #67", "原版未使用"], ["扩展 #68", "原版未使用"],
    ["扩展 #69", "原版未使用"], ["扩展 #70", "原版未使用"], ["扩展 #71", "原版未使用"],
    ["扩展 #72", "原版未使用"], ["扩展 #73", "原版未使用"], ["扩展 #74", "原版未使用"],
    ["扩展 #75", "原版未使用"], ["扩展 #76", "原版未使用"], ["扩展 #77", "原版未使用"],
    ["扩展 #78", "原版未使用"], ["扩展 #79", "原版未使用"],
  ];

  const ACHIEVEMENT_NAMES = [
    "Home Lawn Security（完成冒险）",
    "Nobel Peas Prize（豌豆 Nobel 奖）",
    "China Shop（瓷器店）",
    "Spudow!（土豆雷）",
    "Explodonator（爆炸）",
    "Morticulturalist（园艺大师）",
    "Don't Pea in the Pool（别在泳池里种豌豆）",
    "Roll Some Heads（保龄球）",
    "Grounded（扎根）",
    "Zombologist（僵尸学家）",
    "Penny Pincher（省钱达人）",
    "Sunny Days（晴天）",
    "Popcorn Party（爆米花派对）",
    "Good Morning（早上好）",
    "No Fungus Among Us（蘑菇）",
    "Beyond the Grave（墓地之外）",
    "Immortal（不朽）",
    "Towering Wisdom（智慧树）",
    "Mustache Mode（胡须模式）",
    "Zombatar（僵尸头像）",
  ];

  /* ------------------------------------------------------------------ */
  /* DOM helpers                                                        */
  /* ------------------------------------------------------------------ */

  function h(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (value === undefined || value === null || value === false) continue;
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key === "dataset") Object.assign(node.dataset, value);
        else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
        else if (key === "checked" || key === "value" || key === "selected" || key === "disabled") node[key] = value;
        else node.setAttribute(key, value);
      }
    }
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function toast(message, isError = false) {
    const node = $("#toast");
    node.textContent = message;
    node.className = isError ? "show error" : "show";
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { node.className = ""; }, isError ? 5200 : 3000);
  }

  function setStatus(message, type = "") {
    const node = $("#status-bar");
    node.textContent = message || "";
    node.className = "status-bar" + (type ? " " + type : "");
  }

  function basename(path) {
    return String(path || "").replace(/\\/g, "/").split("/").pop() || "save";
  }

  function normalizePath(path) {
    return String(path || "").replace(/\\/g, "/").replace(/^\/+/, "");
  }

  function formatBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KiB";
    return (n / 1024 / 1024).toFixed(2) + " MiB";
  }

  function formatCoins(raw) {
    return "$" + Math.max(0, Number(raw) || 0) * 10;
  }

  function formatTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("zh-CN", { hour12: false });
  }

  function clampInt(value, min, max) {
    let n = Number(value);
    if (!Number.isFinite(n)) n = min;
    n = Math.trunc(n);
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    return n;
  }

  function field(label, key, control) {
    return h("div", { class: "field" },
      h("label", { title: key }, label || key),
      control,
      h("span", { class: "key" }, key)
    );
  }

  function numberControl(value, onChange, options = {}) {
    const input = h("input", {
      type: "number",
      value: value === null || value === undefined ? "" : String(value),
      step: options.step || "1",
      min: options.min,
      max: options.max,
    });
    input.addEventListener("change", () => {
      const n = Number(input.value);
      if (!Number.isFinite(n)) {
        toast("请输入有效数字", true);
        input.value = String(value);
        return;
      }
      try {
        onChange(options.integer === false ? n : Math.trunc(n));
      } catch (error) {
        toast(error.message || String(error), true);
        input.value = String(value);
      }
    });
    return input;
  }

  function textControl(value, onChange, options = {}) {
    const input = h("input", { type: "text", value: value == null ? "" : String(value), maxlength: options.maxlength });
    input.addEventListener("change", () => {
      try { onChange(input.value); } catch (error) { toast(error.message || String(error), true); }
    });
    return input;
  }

  function checkboxControl(value, onChange) {
    const input = h("input", { type: "checkbox", checked: !!value });
    input.addEventListener("change", () => {
      try { onChange(input.checked); } catch (error) { toast(error.message || String(error), true); }
    });
    return input;
  }

  function check(label, value, onChange) {
    return h("label", { class: "check" }, checkboxControl(value, onChange), h("span", null, label));
  }

  function selectControl(value, table, onChange) {
    const select = h("select");
    const entries = Object.entries(table || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
    const hasValue = entries.some(([k]) => Number(k) === Number(value));
    if (!hasValue) {
      const opt = h("option", { value: String(value) }, `未知值 ${value}`);
      select.append(opt);
    }
    for (const [k, name] of entries) {
      select.append(h("option", { value: k }, `${k} · ${name}`));
    }
    select.value = String(value);
    select.addEventListener("change", () => {
      try { onChange(Number(select.value)); } catch (error) { toast(error.message || String(error), true); }
    });
    return select;
  }

  function readOnly(value) {
    return h("input", { type: "text", value: typeof value === "string" ? value : JSON.stringify(value), readonly: "readonly" });
  }

  function sectionTitle(title, sub, actions) {
    return h("div", { class: "section-title" },
      h("div", null, h("h3", null, title), sub ? h("div", { class: "sub" }, sub) : null),
      actions ? h("div", { class: "actions" }, actions) : null
    );
  }

  function notice(text, type = "") {
    return h("div", { class: "notice " + type }, text);
  }

  /* ------------------------------------------------------------------ */
  /* File management                                                    */
  /* ------------------------------------------------------------------ */

  function addLoadedFile(name, bytes, meta = {}) {
    const normalizedName = normalizePath(meta.entryName || name);
    const existing = [...state.files.values()].find((entry) =>
      entry.source === meta.source && entry.entryName && normalizedName &&
      normalizePath(entry.entryName) === normalizedName
    );
    if (existing) {
      activateFile(existing.id);
      return existing;
    }
    let detected;
    try {
      detected = C.detectFile(name, bytes);
    } catch (error) {
      toast(`${basename(name)}：${error.message}`, true);
      return null;
    }
    const entry = {
      id: "f" + (++state.counter),
      name: normalizePath(meta.entryName || name),
      displayName: basename(name),
      kind: detected.kind,
      model: detected.model,
      originalBytes: bytes.slice(),
      originalName: name,
      dirty: false,
      source: meta.source || "local",
      entryName: meta.entryName || null,
      activeTab: null,
    };
    state.files.set(entry.id, entry);
    renderFileList();
    activateFile(entry.id);
    return entry;
  }

  function activateFile(id) {
    if (!state.files.has(id)) return;
    state.activeId = id;
    const entry = state.files.get(id);
    if (!entry.activeTab) entry.activeTab = defaultTab(entry);
    renderEditor();
    renderFileList();
  }

  function removeFile(id) {
    const entry = state.files.get(id);
    if (!entry) return;
    state.files.delete(id);
    if (state.activeId === id) {
      const next = state.files.keys().next();
      state.activeId = next.done ? null : next.value;
    }
    renderFileList();
    renderEditor();
  }

  function renderFileList() {
    const list = $("#file-list");
    clear(list);
    $("#file-count").textContent = String(state.files.size);
    if (!state.files.size) {
      list.append(h("p", { class: "muted" }, "还没有打开存档。"));
      return;
    }
    for (const entry of state.files.values()) {
      const badgeClass = entry.kind === "v4" ? "info" : entry.kind === "legacy" ? "warn" : "";
      const item = h("div", {
        class: "file-item" + (entry.id === state.activeId ? " active" : ""),
        title: entry.name,
        onclick: () => activateFile(entry.id),
      },
        h("div", { style: "min-width:0" },
          h("div", { class: "name" }, entry.displayName + (entry.dirty ? " *" : "")),
          h("div", { class: "path" }, entry.name)
        ),
        h("div", { style: "display:flex;align-items:center;gap:4px" },
          h("span", { class: "badge " + badgeClass }, KIND_LABEL[entry.kind] || entry.kind),
          h("button", {
            class: "x",
            title: "关闭",
            onclick: (event) => { event.stopPropagation(); removeFile(entry.id); },
          }, "×")
        )
      );
      list.append(item);
    }
  }

  function defaultTab(entry) {
    if (entry.kind === "v4") return "overview";
    if (entry.kind === "users") return "users";
    if (entry.kind === "profile") return "basic";
    return "overview";
  }

  function tabsFor(entry) {
    if (entry.kind === "v4") {
      return [
        ["overview", "概览"], ["board", "关卡"], ["waves", "波次"],
        ["plants", "植物"], ["zombies", "僵尸"], ["projectiles", "子弹"],
        ["coins", "金币"], ["mowers", "割草机"], ["grid_items", "格子物品"],
        ["packets", "卡槽"], ["other", "其他数据"],
      ];
    }
    if (entry.kind === "users") return [["users", "用户列表"]];
    if (entry.kind === "profile") {
      return [
        ["basic", "基础"], ["challenges", "挑战/奖杯"], ["store", "商店"],
        ["garden", "禅境花园"], ["achievements", "成就"], ["advanced", "高级"],
      ];
    }
    return [["overview", "概览"]];
  }

  function markDirty(entry, message) {
    if (!entry) return;
    entry.dirty = true;
    renderFileList();
    renderEditor();
    if (message) setStatus(message);
  }

  function renderEditor() {
    const entry = state.activeId ? state.files.get(state.activeId) : null;
    $("#empty").style.display = entry ? "none" : "grid";
    $("#editor").classList.toggle("visible", !!entry);
    if (!entry) return;

    $("#file-title").textContent = entry.displayName;
    const sourceText = entry.source === "browser-zip" ? "浏览器存档（ZIP 快照）"
      : entry.source === "browser-idbfs" ? "浏览器存档（IDBFS）"
      : String(entry.source || "").startsWith("cloud-slot-") ? `云存档槽位 ${entry.source.slice("cloud-slot-".length)}`
      : "本地文件";
    $("#file-subtitle").textContent = `${entry.name} · ${sourceText}${entry.dirty ? " · 有未保存修改" : ""}`;

    const meta = $("#file-meta");
    clear(meta);
    meta.append(
      metaCard("类型", KIND_LABEL[entry.kind] || entry.kind),
      metaCard("大小", formatBytes(entry.originalBytes.length)),
      metaCard("状态", entry.dirty ? "已修改" : "未修改"),
      metaCard("来源", sourceText)
    );
    if (entry.kind === "v4") {
      meta.append(metaCard("CRC32", entry.model.crcValid ? "有效" : "无效（保存时会重算）"));
      meta.append(metaCard("数据块", String(entry.model.chunks.length)));
    }
    if (entry.kind === "profile") {
      meta.append(metaCard("等级", String(entry.model.level)));
      meta.append(metaCard("金币", formatCoins(entry.model.coins)));
    }
    if (entry.kind === "users") meta.append(metaCard("档案数", String(entry.model.profiles.length)));

    const tabs = tabsFor(entry);
    if (!tabs.some(([id]) => id === entry.activeTab)) entry.activeTab = tabs[0][0];
    const tabsNode = $("#tabs");
    clear(tabsNode);
    for (const [id, label] of tabs) {
      tabsNode.append(h("button", {
        class: id === entry.activeTab ? "active" : "",
        onclick: () => { entry.activeTab = id; renderEditor(); },
      }, label));
    }

    $("#save-browser").disabled = !embedMode && !state.browser;
    renderTab(entry);
    setStatus(entry.dirty ? "有未保存修改；点击“下载修改后的文件”或“写入浏览器存档”。" : "");
  }

  function metaCard(k, v) {
    return h("div", { class: "meta" }, h("div", { class: "k" }, k), h("div", { class: "v" }, v));
  }

  function renderTab(entry) {
    const node = $("#tab-content");
    clear(node);
    try {
      if (entry.kind === "profile") renderProfileTab(entry, node);
      else if (entry.kind === "users") renderUsersTab(entry, node);
      else if (entry.kind === "v4") renderV4Tab(entry, node);
      else renderLegacyTab(entry, node);
    } catch (error) {
      console.error(error);
      node.append(notice("渲染失败：" + (error.message || String(error)), "error"));
    }
  }

  /* ------------------------------------------------------------------ */
  /* Profile editor                                                     */
  /* ------------------------------------------------------------------ */

  const PROFILE_FLAGS = [
    ["hasUsedCheatKeys", "使用过作弊码"],
    ["hasWokenStinky", "唤醒过蜗牛"],
    ["didntPurchasePacketUpgrade", "尚未购买卡槽升级"],
    ["hasUnlockedMinigames", "解锁小游戏"],
    ["hasUnlockedPuzzleMode", "解锁解谜模式"],
    ["hasNewMiniGame", "新小游戏提示"],
    ["hasNewScaryPotter", "新花瓶破坏者提示"],
    ["hasNewIZombie", "新我是僵尸提示"],
    ["hasNewSurvival", "新生存模式提示"],
    ["hasUnlockedSurvivalMode", "解锁生存模式"],
    ["needsMessageOnGameSelector", "选择界面提示"],
    ["needsMagicTacoReward", "需要魔法玉米饼奖励"],
    ["hasSeenStinky", "见过蜗牛"],
    ["hasSeenUpsell", "见过 Upsell"],
  ];

  function renderProfileTab(entry, node) {
    const m = entry.model;
    if (entry.activeTab === "basic") renderBasic(entry, m, node);
    else if (entry.activeTab === "challenges") renderChallenges(entry, m, node);
    else if (entry.activeTab === "store") renderStore(entry, m, node);
    else if (entry.activeTab === "garden") renderGarden(entry, m, node);
    else if (entry.activeTab === "achievements") renderAchievements(entry, m, node);
    else renderProfileAdvanced(entry, m, node);
  }

  function renderBasic(entry, m, node) {
    node.append(sectionTitle("基础进度", "修改后点击上方按钮导出 userN.dat"));
    node.append(h("div", { class: "quick" },
      h("button", { class: "secondary btn-mini", onclick: () => { m.coins = 99999; markDirty(entry, "金币已设为 $999,990"); renderTab(entry); } }, "金币 $999,990"),
      h("button", { class: "secondary btn-mini", onclick: () => { m.finishedAdventure = 1; m.level = Math.max(50, m.level); markDirty(entry, "已设置通关冒险"); renderTab(entry); } }, "通关冒险"),
      h("button", { class: "secondary btn-mini", onclick: () => { unlockAllModes(m); markDirty(entry, "已解锁全部模式"); renderTab(entry); } }, "解锁全部模式"),
      h("button", { class: "secondary btn-mini", onclick: () => { m.achievements = m.achievements.map(() => 1); markDirty(entry, "已解锁全部成就"); renderTab(entry); } }, "全成就")
    ));

    const levelControl = h("div", { class: "range" });
    const sceneSelect = h("select", { style: "flex:1;min-width:0" });
    const stageSelect = h("select", { style: "flex:1;min-width:0" });
    const sceneNames = { 1: "白天", 2: "黑夜", 3: "泳池", 4: "浓雾", 5: "屋顶" };
    for (let scene = 1; scene <= 5; scene++) {
      sceneSelect.append(h("option", { value: String(scene) }, `${scene} ${sceneNames[scene]}`));
    }
    for (let stage = 1; stage <= 10; stage++) {
      stageSelect.append(h("option", { value: String(stage) }, String(stage)));
    }
    const customLevel = m.level < 1 || m.level > 50;
    if (customLevel) {
      sceneSelect.append(h("option", { value: "0" }, "自定义"));
      stageSelect.append(h("option", { value: "0" }, `等级 ${m.level}`));
      sceneSelect.value = "0";
      stageSelect.value = "0";
      levelControl.append(numberControl(m.level, (v) => {
        m.level = clampInt(v, 1, 100000);
        markDirty(entry, "等级已修改");
        renderTab(entry);
      }, { min: 1 }));
    } else {
      sceneSelect.value = String(Math.floor((m.level - 1) / 10) + 1);
      stageSelect.value = String(((m.level - 1) % 10) + 1);
    }
    const applyLevel = () => {
      const scene = Number(sceneSelect.value);
      const stage = Number(stageSelect.value);
      if (!scene || !stage) return;
      m.level = (scene - 1) * 10 + stage;
      markDirty(entry, "等级已修改");
      renderTab(entry);
    };
    sceneSelect.addEventListener("change", applyLevel);
    stageSelect.addEventListener("change", applyLevel);
    levelControl.prepend(sceneSelect, h("span", null, "-"), stageSelect);

    const grid = h("div", { class: "grid2" });
    grid.append(
      field("关卡等级（幕 - 关卡）", "level", levelControl),
      field("金币（原始值，游戏显示 ×10）", "coins", numberControl(m.coins, (v) => { m.coins = clampInt(v, 0, 99999); markDirty(entry, `金币已设为 ${formatCoins(m.coins)}`); renderTab(entry); }, { min: 0, max: 99999 })),
      field("冒险是否通关", "finishedAdventure", selectControl(m.finishedAdventure, { 0: "未通关", 1: "已通关" }, (v) => { m.finishedAdventure = v; markDirty(entry, "冒险状态已修改"); })),
      field("游戏内金币显示", "coins_display", readOnly(formatCoins(m.coins))),
      field("主动游戏时间（秒）", "playTimeActive", numberControl(m.playTimeActive, (v) => { m.playTimeActive = clampInt(v, 0); markDirty(entry); }, { min: 0 })),
      field("非主动游戏时间（秒）", "playTimeInactive", numberControl(m.playTimeInactive, (v) => { m.playTimeInactive = clampInt(v, 0); markDirty(entry); }, { min: 0 })),
    );
    node.append(grid);

    node.append(h("div", { style: "margin-top:16px" },
      sectionTitle("进度开关", "这些字段对应 PlayerInfo 中的全局标志"),
      h("div", { class: "checks" }, PROFILE_FLAGS.map(([key, label]) =>
        check(label, m[key], (checked) => {
          m[key] = checked ? 1 : 0;
          markDirty(entry, `${label} 已修改`);
        })
      ))
    ));

    const other = h("div", { class: "grid2", style: "margin-top:16px" });
    other.append(
      field("蜗牛 X 坐标", "stinkyPosX", numberControl(m.stinkyPosX, (v) => { m.stinkyPosX = clampInt(v, -100000, 100000); markDirty(entry); })),
      field("蜗牛 Y 坐标", "stinkyPosY", numberControl(m.stinkyPosY, (v) => { m.stinkyPosY = clampInt(v, -100000, 100000); markDirty(entry); })),
      field("上次巧克力时间", "lastStinkyChocolateTime", numberControl(m.lastStinkyChocolateTime, (v) => { m.lastStinkyChocolateTime = clampInt(v, 0); markDirty(entry); }, { min: 0 })),
      field("占位统计字段", "placeHolderPlayerStats", numberControl(m.placeHolderPlayerStats, (v) => { m.placeHolderPlayerStats = clampInt(v, 0); markDirty(entry); }, { min: 0 }))
    );
    node.append(other);
  }

  function unlockAllModes(m) {
    m.finishedAdventure = 1;
    m.hasUnlockedMinigames = 1;
    m.hasUnlockedPuzzleMode = 1;
    m.hasUnlockedSurvivalMode = 1;
    m.hasNewMiniGame = 0;
    m.hasNewScaryPotter = 0;
    m.hasNewIZombie = 0;
    m.hasNewSurvival = 0;
    m.needsMessageOnGameSelector = 0;
    m.needsMagicTacoReward = 0;
    if (m.level < 50) m.level = 50;
  }

  function renderChallenges(entry, m, node) {
    node.append(sectionTitle("挑战 / 小游戏 / 生存记录", "共 100 个 u32。0-14 为生存模式，15-71 为挑战模式。"));
    node.append(h("div", { class: "quick" },
      h("button", { class: "secondary btn-mini", onclick: () => { allTrophies(m); markDirty(entry, "已设置全部奖杯"); renderTab(entry); } }, "全部奖杯"),
      h("button", { class: "secondary btn-mini", onclick: () => { m.challengeRecords = m.challengeRecords.map(() => 0); markDirty(entry, "已清空挑战记录"); renderTab(entry); } }, "清空记录")
    ));
    node.append(notice("生存模式的记录值通常代表已通过的旗数/关卡数；挑战模式通常 1 表示已通关。部分记录还承担解锁标志，建议配合“基础 → 解锁全部模式”。"));
    const wrap = h("div", { class: "table-wrap" });
    const table = h("table");
    table.append(h("thead", null, h("tr", null,
      h("th", { style: "width:70px" }, "索引"),
      h("th", null, "模式"),
      h("th", { style: "width:150px" }, "值")
    )));
    const tbody = h("tbody");
    for (let i = 0; i < 100; i++) {
      tbody.append(h("tr", null,
        h("td", { class: "mono" }, String(i)),
        h("td", null, CHALLENGE_NAMES[i] || "未使用/扩展"),
        h("td", null, numberControl(m.challengeRecords[i], (v) => {
          m.challengeRecords[i] = clampInt(v, 0, 0xffffffff);
          markDirty(entry, `挑战记录 #${i} 已修改`);
        }, { min: 0 }))
      ));
    }
    table.append(tbody);
    wrap.append(table);
    node.append(wrap);
  }

  function allTrophies(m) {
    for (let i = 0; i < 100; i++) {
      if (i < 5) m.challengeRecords[i] = Math.max(m.challengeRecords[i], 5);
      else if (i < 10) m.challengeRecords[i] = Math.max(m.challengeRecords[i], 10);
      else if (i < 15) m.challengeRecords[i] = Math.max(m.challengeRecords[i], 40);
      else if (i < 72) m.challengeRecords[i] = Math.max(m.challengeRecords[i], 1);
      else m.challengeRecords[i] = 0;
    }
  }

  function renderStore(entry, m, node) {
    node.append(sectionTitle("商店 / 购买记录", "共 80 个 u32。消耗品的常用编码是 1000 + 数量。"));
    node.append(h("div", { class: "quick" },
      h("button", { class: "secondary btn-mini", onclick: () => { unlockStorePlants(m); markDirty(entry, "已解锁商店植物"); renderTab(entry); } }, "解锁商店植物"),
      h("button", { class: "secondary btn-mini", onclick: () => { fillConsumables(m); markDirty(entry, "已补满消耗品"); renderTab(entry); } }, "补满消耗品"),
      h("button", { class: "secondary btn-mini", onclick: () => { m.purchases = m.purchases.map(() => 0); markDirty(entry, "已清空购买记录"); renderTab(entry); } }, "清空记录")
    ));
    const wrap = h("div", { class: "table-wrap" });
    const table = h("table");
    table.append(h("thead", null, h("tr", null,
      h("th", { style: "width:70px" }, "索引"),
      h("th", null, "物品"),
      h("th", null, "编码说明"),
      h("th", { style: "width:160px" }, "值")
    )));
    const tbody = h("tbody");
    for (let i = 0; i < 80; i++) {
      const info = PURCHASE_INFO[i] || ["扩展", "原版未使用"];
      tbody.append(h("tr", null,
        h("td", { class: "mono" }, String(i)),
        h("td", null, info[0]),
        h("td", { class: "muted" }, info[1]),
        h("td", null, numberControl(m.purchases[i], (v) => {
          m.purchases[i] = clampInt(v, 0, 0xffffffff);
          markDirty(entry, `购买记录 #${i} 已修改`);
        }, { min: 0 }))
      ));
    }
    table.append(tbody);
    wrap.append(table);
    node.append(wrap);
  }

  function unlockStorePlants(m) {
    for (let i = 0; i <= 8; i++) m.purchases[i] = 1;
    for (const i of [13, 16, 17, 18, 19, 20, 21, 22, 23, 25, 27, 29]) m.purchases[i] = Math.max(m.purchases[i], 1);
  }

  function fillConsumables(m) {
    for (const i of [14, 15, 26, 28]) m.purchases[i] = 1005;
  }

  function renderGarden(entry, m, node) {
    node.append(sectionTitle("禅境花园", `已种植 ${m.plants.length} / 200`, h("button", {
      class: "secondary btn-mini",
      onclick: () => {
        if (m.plants.length >= 200) { toast("最多只能有 200 株植物", true); return; }
        m.plants.push(makeDefaultPlant());
        markDirty(entry, "已添加一株植物");
        renderTab(entry);
      },
    }, "添加植物")));
    node.append(notice("修改植物类型/花园/位置前请确认游戏处于关闭状态。植物记录后的成就会自动跟随移动。"));
    if (!m.plants.length) {
      node.append(notice("这个存档里还没有禅境花园植物。"));
      return;
    }
    const list = h("div", { style: "display:grid;gap:10px" });
    m.plants.forEach((plant, index) => {
      const v = plant.values;
      const summary = h("summary", null,
        h("span", null, `#${index + 1} · ${enumName(C.enums.SEED_TYPE, v.seedType)} · 花园 ${enumName(C.enums.GARDEN_TYPE, v.garden)}`),
        h("span", { class: "tag" }, `阶段 ${enumName(C.enums.POTTED_PLANT_AGE, v.plantAge)}`)
      );
      const body = h("div", { class: "details-body" });
      const grid = h("div", { class: "grid2" });
      for (const spec of C.pottedPlantFields) {
        let control;
        if (spec.kind === "enum") {
          control = selectControl(v[spec.key], spec.table, (value) => { v[spec.key] = value; markDirty(entry, `植物 #${index + 1} 已修改`); });
        } else {
          control = numberControl(v[spec.key], (value) => { v[spec.key] = clampInt(value, spec.kind === "i64" ? -9007199254740991 : 0); markDirty(entry, `植物 #${index + 1} 已修改`); }, { min: spec.kind === "i64" ? undefined : 0 });
        }
        grid.append(field(spec.label, spec.key, control));
      }
      body.append(grid, h("div", { class: "quick" }, h("button", {
        class: "danger btn-mini",
        onclick: () => {
          if (!confirm(`删除第 ${index + 1} 株植物？`)) return;
          m.plants.splice(index, 1);
          markDirty(entry, "已删除植物");
          renderTab(entry);
        },
      }, "删除这株植物")));
      const details = h("details", { class: "wave-row" }, summary, body);
      list.append(details);
    });
    node.append(list);
  }

  function makeDefaultPlant() {
    const raw = new Uint8Array(88);
    return {
      raw,
      values: {
        seedType: 0, garden: 0, x: 0, y: 0, facing: 0, padding1: 0, lastWatered: 0,
        drawVariation: 0, plantAge: 3, timesFed: 0, feedingsPerGrow: 3, plantNeed: 0,
        padding2: 0, lastNeedFulfilled: 0, lastFertilized: 0, lastChocolate: 0, futureAttribute: 0,
      },
    };
  }

  function renderAchievements(entry, m, node) {
    node.append(sectionTitle("成就", "20 个 u16 标志"));
    node.append(h("div", { class: "quick" },
      h("button", { class: "secondary btn-mini", onclick: () => { m.achievements = m.achievements.map(() => 1); markDirty(entry, "已解锁全部成就"); renderTab(entry); } }, "全部解锁"),
      h("button", { class: "secondary btn-mini", onclick: () => { m.achievements = m.achievements.map(() => 0); markDirty(entry, "已清空成就"); renderTab(entry); } }, "全部清除")
    ));
    const checks = h("div", { class: "checks" });
    for (let i = 0; i < 20; i++) {
      checks.append(check(ACHIEVEMENT_NAMES[i] || `成就 #${i}`, m.achievements[i] !== 0, (checked) => {
        m.achievements[i] = checked ? 1 : 0;
        markDirty(entry, `成就 #${i} 已修改`);
      }));
    }
    node.append(checks);
  }

  function renderProfileAdvanced(entry, m, node) {
    node.append(sectionTitle("高级 / 原始信息", "这些字段通常不需要修改。"));
    const grid = h("div", { class: "grid2" });
    grid.append(
      field("Zombatar 已接受", "zombatarAccepted", checkboxControl(m.zombatarAccepted, (v) => { m.zombatarAccepted = v ? 1 : 0; markDirty(entry, "Zombatar 状态已修改"); })),
      field("Zombatar 数量", "zombatarCount", readOnly(String(m.zombatarCount))),
      field("Zombatar 数据大小", "zombatarData", readOnly(formatBytes(m.zombatarData.length))),
      field("Zombatar 创建于旧版本", "zombatarCreatedBefore", checkboxControl(m.zombatarCreatedBefore, (v) => { m.zombatarCreatedBefore = v ? 1 : 0; markDirty(entry, "Zombatar 标志已修改"); })),
      field("小游戏标志（20 字节）", "miniGameFlags", readOnly(Array.from(m.miniGameFlags).join(","))),
      field("尾部附加数据", "trailing", readOnly(formatBytes(m.trailing.length))),
    );
    node.append(grid);
    node.append(h("details", null,
      h("summary", null, "查看原始文件头（十六进制）"),
      h("div", { class: "details-body" },
        h("pre", { class: "mono", style: "overflow:auto;max-height:260px;white-space:pre-wrap;word-break:break-all" }, C.hex(m.original, 2048))
      )
    ));
  }

  /* ------------------------------------------------------------------ */
  /* users.dat editor                                                   */
  /* ------------------------------------------------------------------ */

  function renderUsersTab(entry, node) {
    const m = entry.model;
    node.append(sectionTitle("用户列表 users.dat", "顺序对应 user1.dat、user2.dat……", h("button", {
      class: "secondary btn-mini",
      onclick: () => {
        const nextId = m.profiles.reduce((max, p) => Math.max(max, p.id), 0) + 1;
        m.profiles.push({ name: "新玩家", nameBytes: null, useSeq: m.profiles.length + 1, id: nextId });
        markDirty(entry, "已添加用户");
        renderTab(entry);
      },
    }, "添加用户")));
    node.append(notice("修改名字是安全的；删除或调整顺序可能导致 userN.dat 对应关系错乱。建议只修改名字。"));
    if (!m.profiles.length) {
      node.append(notice("users.dat 中没有用户。"));
      return;
    }
    const wrap = h("div", { class: "table-wrap" });
    const table = h("table");
    table.append(h("thead", null, h("tr", null,
      h("th", { style: "width:60px" }, "#"),
      h("th", null, "名字"),
      h("th", { style: "width:120px" }, "使用序号"),
      h("th", { style: "width:120px" }, "用户 ID"),
      h("th", { style: "width:80px" }, "操作")
    )));
    const tbody = h("tbody");
    m.profiles.forEach((profile, index) => {
      tbody.append(h("tr", null,
        h("td", { class: "mono" }, String(index + 1)),
        h("td", null, textControl(profile.name, (value) => {
          profile.name = value;
          markDirty(entry, "用户名字已修改");
          renderFileList();
        }, { maxlength: 255 })),
        h("td", null, numberControl(profile.useSeq, (value) => { profile.useSeq = clampInt(value, 0, 0xffffffff); markDirty(entry); }, { min: 0 })),
        h("td", null, numberControl(profile.id, (value) => { profile.id = clampInt(value, 0, 0xffffffff); markDirty(entry); }, { min: 0 })),
        h("td", null, h("button", {
          class: "danger btn-mini",
          onclick: () => {
            if (!confirm(`删除用户“${profile.name}”？`)) return;
            m.profiles.splice(index, 1);
            markDirty(entry, "已删除用户");
            renderTab(entry);
          },
        }, "删除"))
      ));
    });
    table.append(tbody);
    wrap.append(table);
    node.append(wrap);
  }

  /* ------------------------------------------------------------------ */
  /* Legacy / unsupported                                               */
  /* ------------------------------------------------------------------ */

  function renderLegacyTab(entry, node) {
    node.append(sectionTitle("旧版原始内存存档", "仅检测到文件，但未解析"));
    node.append(notice(
      "这个 .dat 文件不是 PvZ-Portable 的 v4 关卡存档，也不是版本 12 的玩家进度文件。它可能是旧版游戏的原始内存 dump，包含平台相关的指针/结构体，无法安全地跨平台编辑。建议在游戏中重新保存为 .v4 后再编辑。",
      "warn"
    ));
    node.append(h("pre", { class: "mono", style: "overflow:auto;max-height:260px;white-space:pre-wrap;word-break:break-all" },
      C.hex(entry.model.raw, 4096)));
  }

  /* ------------------------------------------------------------------ */
  /* V4 editor                                                          */
  /* ------------------------------------------------------------------ */

  function renderV4Tab(entry, node) {
    const tab = entry.activeTab;
    if (tab === "overview") renderV4Overview(entry, node);
    else if (tab === "board") renderV4Board(entry, node);
    else if (tab === "waves") renderV4Waves(entry, node);
    else if (["plants", "zombies", "projectiles", "coins", "mowers", "grid_items"].includes(tab)) renderV4Entities(entry, node, tab);
    else if (tab === "packets") renderV4Packets(entry, node);
    else renderV4Other(entry, node);
  }

  function renderV4Overview(entry, node) {
    const m = entry.model;
    node.append(sectionTitle("存档概览", `PVZP_SAVE4 · payload ${formatBytes(m.payloadSize)}`));
    if (!m.crcValid) node.append(notice("CRC32 校验失败；文件可能已损坏。保存时会重新计算 CRC。", "warn"));
    const wrap = h("div", { class: "table-wrap" });
    const table = h("table");
    table.append(h("thead", null, h("tr", null,
      h("th", null, "类型 ID"), h("th", null, "数据块"), h("th", null, "大小"),
      h("th", null, "解析"), h("th", null, "状态")
    )));
    const tbody = h("tbody");
    for (const chunk of m.chunks) {
      tbody.append(h("tr", null,
        h("td", { class: "mono" }, String(chunk.type)),
        h("td", null, chunk.name),
        h("td", null, formatBytes(chunk.data.length)),
        h("td", null, chunk.parseError ? h("span", { class: "badge error" }, "失败") : chunk.parsed ? h("span", { class: "badge" }, "可编辑") : h("span", { class: "badge info" }, "保留原样")),
        h("td", null, chunk.dirty ? h("span", { class: "badge warn" }, "已修改") : h("span", { class: "muted" }, "未修改"))
      ));
    }
    table.append(tbody);
    wrap.append(table);
    node.append(wrap);
    if (m.chunks.some((c) => c.parseError)) {
      node.append(h("details", null,
        h("summary", null, "查看解析错误"),
        h("div", { class: "details-body" }, m.chunks.filter((c) => c.parseError).map((c) =>
          h("div", { class: "notice warn", style: "margin-bottom:6px" }, `${c.name}：${c.parseError}`)
        ))
      ));
    }
    node.append(notice("关卡存档修改后，游戏需要重新载入该关卡或重新进入游戏才会读取。"));
  }

  function boardChunk(entry) {
    return C.getChunk(entry.model, "BOARD_BASE");
  }

  function renderV4Board(entry, node) {
    const chunk = boardChunk(entry);
    if (!chunk || !chunk.parsed) {
      node.append(notice("这个 .v4 中没有可解析的 BOARD_BASE 数据块。", "warn"));
      return;
    }
    const board = chunk.parsed;
    node.append(sectionTitle("关卡数据", "当前阳光、波次、关卡号、场景等"));
    const common = C.boardSchema.filter((spec) => spec.common && spec.kind !== "waves");
    const grid = h("div", { class: "grid2" });
    for (const spec of common) {
      if (spec.kind === "enum") {
        const value = C.getBoardValue(board, spec);
        grid.append(field(spec.label, spec.key, selectControl(value, spec.arg, (v) => {
          C.setBoardValue(board, spec, v); chunk.dirty = true; markDirty(entry, `${spec.label} 已修改`); renderTab(entry);
        })));
      } else if (spec.kind === "bool") {
        grid.append(field(spec.label, spec.key, checkboxControl(C.getBoardValue(board, spec), (v) => {
          C.setBoardValue(board, spec, v); chunk.dirty = true; markDirty(entry, `${spec.label} 已修改`);
        })));
      } else if (["i32", "u32", "i64", "f32"].includes(spec.kind)) {
        const value = C.getBoardValue(board, spec);
        grid.append(field(spec.label, spec.key, numberControl(value, (v) => {
          C.setBoardValue(board, spec, spec.kind === "f32" ? v : Math.trunc(v));
          chunk.dirty = true;
          markDirty(entry, `${spec.label} 已修改`);
          if (spec.id === 31) renderTab(entry);
        }, { min: spec.kind === "u32" ? 0 : undefined, step: spec.kind === "f32" ? "any" : "1", integer: spec.kind !== "f32" })));
      }
    }
    node.append(grid);

    const advanced = C.boardSchema.filter((spec) =>
      spec.kind !== "waves" && !spec.common && ["bool", "i32", "u32", "i64", "f32", "enum", "rect"].includes(spec.kind)
    );
    const details = h("details", null,
      h("summary", null, `高级字段（${advanced.length} 个可编辑）`),
      h("div", { class: "details-body" })
    );
    const advGrid = h("div", { class: "grid2" });
    for (const spec of advanced) {
      const value = C.getBoardValue(board, spec);
      if (value === null) continue;
      if (spec.kind === "enum") {
        advGrid.append(field(spec.label, spec.key, selectControl(value, spec.arg, (v) => {
          C.setBoardValue(board, spec, v); chunk.dirty = true; markDirty(entry, `${spec.label} 已修改`);
        })));
      } else if (spec.kind === "bool") {
        advGrid.append(field(spec.label, spec.key, checkboxControl(value, (v) => {
          C.setBoardValue(board, spec, v); chunk.dirty = true; markDirty(entry, `${spec.label} 已修改`);
        })));
      } else {
        advGrid.append(field(spec.label, spec.key, numberControl(value, (v) => {
          C.setBoardValue(board, spec, spec.kind === "f32" ? v : Math.trunc(v));
          chunk.dirty = true; markDirty(entry, `${spec.label} 已修改`);
        }, { min: spec.kind === "u32" ? 0 : undefined, step: spec.kind === "f32" ? "any" : "1", integer: spec.kind !== "f32" })));
      }
    }
    details.querySelector(".details-body").append(advGrid);
    node.append(details);

    const arrays = C.boardSchema.filter((spec) => spec.kind !== "waves" && !["bool", "i32", "u32", "i64", "f32", "enum", "rect"].includes(spec.kind));
    if (arrays.length) {
      const arrDetails = h("details", null,
        h("summary", null, `只读数组字段（${arrays.length} 个）`),
        h("div", { class: "details-body" },
          h("div", { class: "grid3" }, arrays.map((spec) => field(spec.label, spec.key, readOnly(`长度 ${spec.size} 字节`))))
        )
      );
      node.append(arrDetails);
    }
    node.append(notice("修改“总波数”后，波次页会按新的数量显示；超出的波次数据仍会保留在文件中。", ""));
  }

  function renderV4Waves(entry, node) {
    const chunk = boardChunk(entry);
    if (!chunk || !chunk.parsed) {
      node.append(notice("没有 BOARD_BASE 数据块，无法编辑波次。", "warn"));
      return;
    }
    const board = chunk.parsed;
    const numWaves = clampInt(board.numWaves, 0, 100);
    node.append(sectionTitle("僵尸波次", `总波数 ${board.numWaves}，每波最多 50 个僵尸`, h("div", { class: "actions" },
      h("button", { class: "secondary btn-mini", onclick: () => {
        if (numWaves >= 100) { toast("最多 100 波", true); return; }
        const spec = C.boardById.get(31);
        C.setBoardValue(board, spec, numWaves + 1);
        C.setBoardWave(board, numWaves, []);
        chunk.dirty = true; markDirty(entry, "已添加一波"); renderTab(entry);
      } }, "添加一波"),
      h("button", { class: "secondary btn-mini", onclick: () => {
        if (numWaves <= 0) return;
        C.setBoardValue(board, C.boardById.get(31), numWaves - 1);
        chunk.dirty = true; markDirty(entry, "已删除最后一波"); renderTab(entry);
      } }, "删除最后一波")
    )));
    node.append(notice("每行用逗号分隔僵尸类型 ID 或名称，例如 0, 7, ZOMBIE_GARGANTUAR。修改的是当前存档的波次组成。"));
    if (!numWaves) {
      node.append(notice("当前总波数为 0。"));
      return;
    }
    if (!board.wavesRaw) {
      node.append(notice("存档没有 field 18 波次数据。", "warn"));
      return;
    }
    const list = h("div", { class: "wave-list" });
    for (let i = 0; i < numWaves; i++) {
      const values = board.waves[i] || [];
      const text = values.map((v) => enumName(C.enums.ZOMBIE_TYPE, v)).join(", ");
      const summary = h("summary", null,
        h("span", null, `第 ${i + 1} 波`),
        h("span", { class: "tag" }, `${values.length} 只`)
      );
      const textarea = h("textarea", { spellcheck: "false" });
      textarea.value = text;
      const apply = h("button", { class: "secondary btn-mini" }, "应用这一波");
      const info = h("div", { class: "hint" }, "逗号分隔；支持数字或 ZOMBIE_* 名称。");
      apply.addEventListener("click", () => {
        try {
          const parsed = parseZombieList(textarea.value);
          C.setBoardWave(board, i, parsed);
          chunk.dirty = true;
          markDirty(entry, `第 ${i + 1} 波已修改`);
          renderTab(entry);
        } catch (error) {
          toast(error.message || String(error), true);
        }
      });
      list.append(h("details", { class: "wave-row", open: i === 0 }, summary,
        h("div", { class: "wave-edit" }, textarea, h("div", { class: "quick" }, apply), info)
      ));
    }
    node.append(list);
  }

  function parseZombieList(text) {
    const parts = String(text || "").split(/[,，\s]+/).filter(Boolean);
    if (parts.length > 50) throw new Error("每波最多 50 个僵尸");
    const reverse = {};
    for (const [k, v] of Object.entries(C.enums.ZOMBIE_TYPE)) reverse[v] = Number(k);
    return parts.map((part) => {
      if (/^-?\d+$/.test(part)) {
        const n = Number(part);
        if (n < -1 || n > 100000) throw new Error(`僵尸类型超出范围：${part}`);
        return n;
      }
      if (reverse[part] !== undefined) return reverse[part];
      throw new Error(`未知僵尸类型：${part}`);
    });
  }

  const ENTITY_INFO = {
    plants: { chunk: "PLANTS", schema: "plants", label: "植物" },
    zombies: { chunk: "ZOMBIES", schema: "zombies", label: "僵尸" },
    projectiles: { chunk: "PROJECTILES", schema: "projectiles", label: "子弹" },
    coins: { chunk: "COINS", schema: "coins", label: "金币" },
    mowers: { chunk: "MOWERS", schema: "mowers", label: "割草机" },
    grid_items: { chunk: "GRIDITEMS", schema: "grid_items", label: "格子物品" },
  };

  function renderV4Entities(entry, node, tab) {
    const info = ENTITY_INFO[tab];
    const chunk = C.getChunk(entry.model, info.chunk);
    if (!chunk || !chunk.parsed) {
      node.append(notice(`这个 .v4 中没有可解析的 ${info.chunk} 数据块。`, "warn"));
      return;
    }
    const array = chunk.parsed;
    const active = [];
    array.slots.forEach((slot, index) => { if (slot.item) active.push({ slot, index }); });
    node.append(sectionTitle(`${info.label}列表`, `活动对象 ${active.length} · 数组容量 ${array.header.maxSize}`, null));
    if (!active.length) {
      node.append(notice(`当前没有${info.label}对象。`));
      return;
    }
    const key = entry.id + ":" + tab;
    let selected = state.selected.get(key);
    if (selected === undefined || !array.slots[selected] || !array.slots[selected].item) selected = active[0].index;
    state.selected.set(key, selected);

    const layout = h("div", { class: "item-layout" });
    const wrap = h("div", { class: "table-wrap" });
    const table = h("table");
    table.append(h("thead", null, h("tr", null,
      h("th", { style: "width:60px" }, "槽位"),
      h("th", { style: "width:80px" }, "ID"),
      h("th", null, "类型"),
      h("th", null, "位置 / 行列"),
      h("th", null, "生命 / 状态"),
      h("th", null, "选中")
    )));
    const tbody = h("tbody");
    for (const { slot, index } of active) {
      const item = slot.item;
      const row = entityRowInfo(tab, item);
      tbody.append(h("tr", {
        class: index === selected ? "selected" : "",
        onclick: () => { state.selected.set(key, index); renderTab(entry); },
      },
        h("td", { class: "mono" }, String(index)),
        h("td", { class: "mono" }, "0x" + (slot.id >>> 0).toString(16)),
        h("td", null, row.type),
        h("td", null, row.position),
        h("td", null, row.health),
        h("td", null, index === selected ? h("span", { class: "badge" }, "编辑中") : "")
      ));
    }
    table.append(tbody);
    wrap.append(table);
    const detail = renderEntityDetail(entry, chunk, array, selected, tab);
    layout.append(wrap, detail);
    node.append(layout);
  }

  function entityRowInfo(tab, item) {
    const v = item.tail ? item.tail.values : {};
    const go = item.gameobject ? item.gameobject.values : null;
    const type = item.typeName || String(v.seed_type ?? v.zombie_type ?? v.type ?? "");
    let position = "";
    let health = "";
    if (tab === "plants") {
      position = `行 ${go ? go.row : "?"} / 列 ${v.col}`;
      health = `HP ${v.plant_health} / ${v.plant_max_health}${v.dead ? " · 死亡" : ""}`;
    } else if (tab === "zombies") {
      position = `行 ${go ? go.row : "?"} · x ${Math.round(v.pos_x || 0)}`;
      health = `HP ${v.body_health} / ${v.body_max_health}${v.dead ? " · 死亡" : ""}`;
    } else if (tab === "projectiles") {
      position = `x ${Math.round(v.pos_x || 0)} · y ${Math.round(v.pos_y || 0)}`;
      health = v.dead ? "已消失" : "飞行中";
    } else if (tab === "coins") {
      position = `x ${Math.round(v.pos_x || 0)} · y ${Math.round(v.pos_y || 0)}`;
      health = v.dead ? "已消失" : `倒计时 ${v.disappear_counter}`;
    } else if (tab === "mowers") {
      position = `行 ${v.row} · x ${Math.round(v.pos_x || 0)}`;
      health = `${enumName(C.enums.LAWN_MOWER_STATE, v.mower_state)}${v.dead ? " · 消失" : ""}`;
    } else {
      position = `行 ${v.grid_y} / 列 ${v.grid_x}`;
      health = `${v.dead ? "已消失" : "存在"} · 计数 ${v.grid_item_counter}`;
    }
    return { type, position, health };
  }

  function renderEntityDetail(entry, chunk, array, slotIndex, tab) {
    const slot = array.slots[slotIndex];
    const item = slot.item;
    const schema = ENTITY_INFO[tab].schema;
    const detail = h("div", { class: "item-detail" });
    detail.append(h("h4", null, `槽位 #${slotIndex} · ${item.typeName || "对象"}`));
    detail.append(h("div", { class: "hint", style: "margin-bottom:10px" }, `对象 ID 0x${(slot.id >>> 0).toString(16)}`));

    const goSection = h("div");
    if (item.gameobject) {
      goSection.append(h("div", { class: "sub", style: "margin:6px 0;color:var(--muted)" }, "GameObject"));
      const goGrid = h("div", { class: "grid2" });
      for (const spec of C.gameObjectFields) {
        const value = item.gameobject.values ? item.gameobject.values[spec.key] : null;
        if (value === undefined || value === null) continue;
        if (spec.kind === "bool") {
          goGrid.append(field(spec.label, spec.key, checkboxControl(value, (v) => {
            C.writeGameObject(item.gameobject.raw, spec.key, v);
            item.gameobject.values[spec.key] = v;
            chunk.dirty = true; markDirty(entry, `${spec.label} 已修改`); renderTab(entry);
          })));
        } else {
          goGrid.append(field(spec.label, spec.key, numberControl(value, (v) => {
            C.writeGameObject(item.gameobject.raw, spec.key, v);
            item.gameobject.values[spec.key] = v;
            chunk.dirty = true; markDirty(entry, `${spec.label} 已修改`); renderTab(entry);
          })));
        }
      }
      goSection.append(goGrid);
    }
    detail.append(goSection);

    if (!item.tail) {
      detail.append(notice("该对象没有可编辑的字段尾部。", "warn"));
      return detail;
    }
    const schemaSpecs = C.schemas[schema] || [];
    const common = schemaSpecs.filter((s) => s.common && isEditableKind(s.kind));
    const advanced = schemaSpecs.filter((s) => !s.common && isEditableKind(s.kind));
    detail.append(h("div", { class: "sub", style: "margin:10px 0 6px;color:var(--muted)" }, "常用字段"));
    const grid = h("div", { class: "grid2" });
    for (const spec of common) grid.append(itemField(entry, chunk, item, spec));
    detail.append(grid);

    if (advanced.length) {
      const adv = h("details", null,
        h("summary", null, `高级字段（${advanced.length}）`),
        h("div", { class: "details-body" })
      );
      const advGrid = h("div", { class: "grid2" });
      for (const spec of advanced) advGrid.append(itemField(entry, chunk, item, spec));
      adv.querySelector(".details-body").append(advGrid);
      detail.append(adv);
    }

    const readonly = schemaSpecs.filter((s) => !isEditableKind(s.kind) && item.tail.values[s.key] !== undefined);
    if (readonly.length) {
      const ro = h("details", null,
        h("summary", null, `只读数组/结构（${readonly.length}）`),
        h("div", { class: "details-body" })
      );
      const roGrid = h("div", { class: "grid2" });
      for (const spec of readonly) roGrid.append(field(spec.label, spec.key, readOnly(item.tail.values[spec.key])));
      ro.querySelector(".details-body").append(roGrid);
      detail.append(ro);
    }
    return detail;
  }

  function isEditableKind(kind) {
    return ["bool", "i32", "u32", "i64", "f32", "enum", "rect"].includes(kind);
  }

  function itemField(entry, chunk, item, spec) {
    const value = item.tail.values[spec.key];
    if (value === undefined) return h("span");
    if (spec.kind === "bool") {
      return field(spec.label, spec.key, checkboxControl(value, (v) => {
        C.writeFieldValue(spec, v, item.tail.raw, spec.offset);
        item.tail.values[spec.key] = v;
        chunk.dirty = true; markDirty(entry, `${spec.label} 已修改`); renderTab(entry);
      }));
    }
    if (spec.kind === "enum") {
      return field(spec.label, spec.key, selectControl(value, spec.arg, (v) => {
        C.writeFieldValue(spec, v, item.tail.raw, spec.offset);
        item.tail.values[spec.key] = v;
        if (spec.key === "seed_type" || spec.key === "type" || spec.key.endsWith("_type")) {
          item.typeName = typeNameFor(item, spec);
        }
        chunk.dirty = true; markDirty(entry, `${spec.label} 已修改`); renderTab(entry);
      }));
    }
    if (spec.kind === "rect") {
      const rect = value || { x: 0, y: 0, width: 0, height: 0 };
      const grid = h("div", { class: "grid2" });
      for (const part of ["x", "y", "width", "height"]) {
        grid.append(field(part, spec.key + "." + part, numberControl(rect[part], (v) => {
          const next = { ...item.tail.values[spec.key], [part]: Math.trunc(v) };
          C.writeFieldValue(spec, next, item.tail.raw, spec.offset);
          item.tail.values[spec.key] = next;
          chunk.dirty = true; markDirty(entry, `${spec.label} 已修改`); renderTab(entry);
        })));
      }
      return h("div", { class: "field", style: "grid-column:1/-1" }, h("label", null, spec.label), grid, h("span", { class: "key" }, spec.key));
    }
    return field(spec.label, spec.key, numberControl(value, (v) => {
      C.writeFieldValue(spec, spec.kind === "f32" ? v : Math.trunc(v), item.tail.raw, spec.offset);
      item.tail.values[spec.key] = spec.kind === "f32" ? v : Math.trunc(v);
      chunk.dirty = true; markDirty(entry, `${spec.label} 已修改`); renderTab(entry);
    }, {
      min: spec.kind === "u32" ? 0 : undefined,
      step: spec.kind === "f32" ? "any" : "1",
      integer: spec.kind !== "f32",
    }));
  }

  function typeNameFor(item, spec) {
    if (!spec.arg) return item.typeName;
    const value = item.tail.values[spec.key];
    const table = spec.arg;
    return table[value] || String(value);
  }

  function renderV4Packets(entry, node) {
    const chunk = C.getChunk(entry.model, "SEEDPACKETS");
    if (!chunk || !chunk.parsed) {
      node.append(notice("这个 .v4 中没有可解析的 SEEDPACKETS 数据块。", "warn"));
      return;
    }
    const packets = chunk.parsed.packets;
    node.append(sectionTitle("卡槽 / Seed Packets", `共 ${packets.length} 张卡`));
    const list = h("div", { style: "display:grid;gap:10px" });
    packets.forEach((item, index) => {
      const common = C.schemas.seed_packets.filter((s) => s.common && isEditableKind(s.kind));
      const details = h("details", { class: "wave-row" },
        h("summary", null,
          h("span", null, `卡槽 ${index + 1} · ${item.typeName || "空"}`),
          h("span", { class: "tag" }, item.tail ? `${Math.round(item.tail.values.refresh_counter || 0)} / ${Math.round(item.tail.values.refresh_time || 0)}` : "无数据")
        ),
        h("div", { class: "details-body" },
          h("div", { class: "grid2" }, common.map((spec) => itemField(entry, chunk, item, spec)))
        )
      );
      list.append(details);
    });
    node.append(list);
    node.append(notice("卡槽数据通常只在关卡内有效；修改后请回到游戏并重新载入关卡。"));
  }

  function renderV4Other(entry, node) {
    node.append(sectionTitle("其他数据块", "未在上面单独展示的解析数据块"));
    const chunks = entry.model.chunks.filter((c) => c.parsed && !["BOARD_BASE", "PLANTS", "ZOMBIES", "PROJECTILES", "COINS", "MOWERS", "GRIDITEMS", "SEEDPACKETS"].includes(c.name));
    if (!chunks.length) {
      node.append(notice("没有其他可编辑的数据块。"));
      return;
    }
    for (const chunk of chunks) {
      if (chunk.parsed.kind === "singleton") {
        const schema = chunk.parsed.info.schema;
        const common = schema.filter((s) => s.common && isEditableKind(s.kind));
        const details = h("details", null,
          h("summary", null, `${chunk.name} · ${common.length} 个常用字段`),
          h("div", { class: "details-body" })
        );
        const grid = h("div", { class: "grid2" });
        for (const spec of common) {
          const item = { fields: chunk.parsed.fields, tail: null };
          // Singletons store fields directly; adapt an item-like wrapper.
          const raw = chunk.parsed.fields.get(100);
          if (!raw) continue;
          const values = C.parseSchemaValues(schema, raw).values;
          item.tail = { raw, values };
          grid.append(itemField(entry, chunk, item, spec));
        }
        details.querySelector(".details-body").append(grid);
        node.append(details);
      } else {
        node.append(h("div", { class: "notice", style: "margin-bottom:8px" },
          `${chunk.name}：${chunk.parsed.kind}，${formatBytes(chunk.data.length)}，暂未提供专用表单。`));
      }
    }
  }

  function enumName(table, value) {
    return table && table[value] !== undefined ? table[value] : String(value);
  }

  /* ------------------------------------------------------------------ */
  /* Export / download / browser saves                                  */
  /* ------------------------------------------------------------------ */

  function serializeEntry(entry) {
    if (entry.kind === "profile") return C.serializeProfile(entry.model);
    if (entry.kind === "users") return C.serializeUsers(entry.model);
    if (entry.kind === "v4") return C.serializeV4(entry.model);
    throw new Error("这种文件类型不支持导出修改。");
  }

  function downloadEntry(entry) {
    try {
      const bytes = serializeEntry(entry);
      const blob = new Blob([bytes], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "edited-" + basename(entry.name);
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      entry.dirty = false;
      renderFileList();
      renderEditor();
      setStatus(`已导出 ${a.download}（${formatBytes(bytes.length)}）`, "ok");
      toast("已生成修改后的文件");
    } catch (error) {
      console.error(error);
      setStatus("导出失败：" + (error.message || String(error)), "error");
      toast(error.message || String(error), true);
    }
  }

  async function resetEntry(entry) {
    try {
      const detected = C.detectFile(entry.originalName, entry.originalBytes);
      entry.kind = detected.kind;
      entry.model = detected.model;
      entry.dirty = false;
      entry.activeTab = defaultTab(entry);
      renderFileList();
      renderEditor();
      setStatus("已撤销所有修改。", "ok");
    } catch (error) {
      toast(error.message || String(error), true);
    }
  }

  function openDB(name, version, upgrade) {
    return new Promise((resolve, reject) => {
      const request = version ? indexedDB.open(name, version) : indexedDB.open(name);
      request.onupgradeneeded = () => {
        if (upgrade) upgrade(request.result);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB 打开失败"));
    });
  }

  function idbGet(db, store, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const request = tx.objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function idbGetAll(db, store) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const request = tx.objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function idbPut(db, store, key, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadBrowserSaves() {
    if (!("indexedDB" in window)) {
      toast("当前浏览器不支持 IndexedDB", true);
      return;
    }
    setStatus("正在读取浏览器存档…");
    try {
      let databaseNames = [];
      if (indexedDB.databases) {
        try {
          databaseNames = (await indexedDB.databases()).map((db) => db.name).filter(Boolean);
        } catch (_) { databaseNames = []; }
      }

      // 优先读取 pvz.html 写入的 ZIP 快照。
      if (!databaseNames.length || databaseNames.includes("pvz-browser-saves")) {
        const db = await openDB("pvz-browser-saves", 1, (db) => {
          if (!db.objectStoreNames.contains("saves")) db.createObjectStore("saves");
        });
        if (db.objectStoreNames.contains("saves")) {
          const snapshot = await idbGet(db, "saves", "userdata");
          if (snapshot) {
            if (typeof JSZip === "undefined") throw new Error("缺少 JSZip，无法解析浏览器存档。");
            const zip = await JSZip.loadAsync(snapshot);
            const files = new Map();
            const entries = Object.values(zip.files).filter((entry) => !entry.dir);
            if (entries.length > 1000) throw new Error("浏览器存档中的文件数量异常。");
            for (const zipEntry of entries) {
              const path = normalizePath(zipEntry.name);
              const data = await zipEntry.async("uint8array");
              files.set(path, data);
            }
            state.browser = { kind: "zip", db, dbName: "pvz-browser-saves", storeName: "saves", key: "userdata", files };
            let loaded = 0;
            for (const [path, data] of files) {
              if (!/\.(dat|v4)$/i.test(path)) continue;
              if (addLoadedFile(path, data, { source: "browser-zip", entryName: path })) loaded++;
            }
            setStatus(`已读取浏览器 ZIP 快照，载入 ${loaded} 个存档文件。`, "ok");
            renderEditor();
            return;
          }
        }
        db.close();
      }

      // 兼容真正的 Emscripten IDBFS（数据库名通常是挂载点 "/saves"）。
      const idbfsSources = [];
      for (const name of databaseNames) {
        if (name === "pvz-browser-saves") continue;
        let db;
        try {
          db = await openDB(name);
          if (!db.objectStoreNames.contains("FILE_DATA")) { db.close(); continue; }
          const records = await idbGetAll(db, "FILE_DATA");
          const keys = await new Promise((resolve, reject) => {
            const tx = db.transaction("FILE_DATA", "readonly");
            const req = tx.objectStore("FILE_DATA").getAllKeys();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          const map = new Map();
          records.forEach((record, index) => {
            const key = normalizePath(keys[index]);
            const data = record && record.contents ? record.contents : record;
            if (data && (data.byteLength !== undefined || data.length !== undefined)) {
              map.set(key, { record, key: keys[index], data: data instanceof Uint8Array ? data : new Uint8Array(data) });
            }
          });
          if (map.size) idbfsSources.push({ db, dbName: name, storeName: "FILE_DATA", records: map });
        } catch (_) {
          try { db && db.close(); } catch (_) {}
        }
      }
      if (idbfsSources.length) {
        state.browser = { kind: "idbfs", sources: idbfsSources };
        let loaded = 0;
        for (const source of idbfsSources) {
          for (const [key, record] of source.records) {
            if (!/\.(dat|v4)$/i.test(key)) continue;
            if (addLoadedFile(key, record.data, { source: "browser-idbfs", entryName: source.dbName + "/" + key })) loaded++;
          }
        }
        setStatus(`已读取 IDBFS 浏览器存档，载入 ${loaded} 个文件。`, "ok");
        renderEditor();
        return;
      }
      throw new Error("没有找到浏览器存档。请先在 PVZ 页面中运行游戏并产生存档。");
    } catch (error) {
      console.error(error);
      setStatus("读取浏览器存档失败：" + (error.message || String(error)), "error");
      toast(error.message || String(error), true);
    }
  }

  async function writeOneToBrowser(entry, options = {}) {
    const silent = !!options.silent;
    const createIfMissing = !!options.createIfMissing;
    if (!state.browser) {
      if (!silent) toast("请先点击“读取浏览器存档”", true);
      return false;
    }
    let bytes;
    try {
      bytes = serializeEntry(entry);
    } catch (error) {
      if (!silent) toast(error.message || String(error), true);
      return false;
    }
    try {
      if (state.browser.kind === "zip") {
        let target = findZipTarget(entry);
        if (!target && createIfMissing) target = "userdata/" + basename(entry.name);
        if (!target) throw new Error("浏览器 ZIP 快照中没有同名文件。");
        state.browser.files.set(target, bytes);
        const zip = new JSZip();
        for (const [path, data] of state.browser.files) zip.file(path, data);
        const snapshot = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
        await idbPut(state.browser.db, state.browser.storeName, state.browser.key, snapshot);
      } else {
        let found = false;
        for (const source of state.browser.sources) {
          for (const [key, record] of source.records) {
            if (sameBrowserFile(entry, source.dbName + "/" + key, key)) {
              const next = record.record && typeof record.record === "object" && !(record.record instanceof Uint8Array)
                ? { ...record.record, contents: bytes, timestamp: Date.now() }
                : bytes;
              await idbPut(source.db, source.storeName, record.key, next);
              record.data = bytes;
              found = true;
            }
          }
        }
        if (!found) throw new Error("IDBFS 存档中没有同名文件。");
      }
      entry.dirty = false;
      return true;
    } catch (error) {
      console.error(error);
      if (!silent) {
        setStatus("写入浏览器存档失败：" + (error.message || String(error)), "error");
        toast(error.message || String(error), true);
      }
      return false;
    }
  }

  async function writeToBrowser(entry) {
    if (!state.browser) {
      toast("请先点击“读取浏览器存档”", true);
      return;
    }
    if (!confirm("写入浏览器存档会覆盖当前浏览器中的同名文件。请先关闭 PVZ 游戏页面，否则游戏可能再次覆盖。继续？")) return;
    if (await writeOneToBrowser(entry)) {
      renderFileList();
      renderEditor();
      setStatus("已写入浏览器存档。请刷新/重新打开 PVZ 页面，让游戏重新读取。", "ok");
      toast("已写入浏览器存档");
    }
  }

  async function readBrowserZipSnapshot() {
    const files = new Map();
    try {
      const db = await openDB("pvz-browser-saves", 1, (database) => {
        if (!database.objectStoreNames.contains("saves")) database.createObjectStore("saves");
      });
      const snapshot = await idbGet(db, "saves", "userdata");
      if (snapshot && snapshot.byteLength) {
        const zip = await JSZip.loadAsync(snapshot);
        for (const [path, entry] of Object.entries(zip.files)) {
          if (!entry.dir) files.set(normalizePath(path), await entry.async("uint8array"));
        }
      }
      db.close();
    } catch (_) {
      // 没有快照就从空目录开始。
    }
    return files;
  }

  async function writeBrowserZipSnapshot(files) {
    const db = await openDB("pvz-browser-saves", 1, (database) => {
      if (!database.objectStoreNames.contains("saves")) database.createObjectStore("saves");
    });
    const zip = new JSZip();
    for (const [path, data] of files) zip.file(path, data);
    const snapshot = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
    await idbPut(db, "saves", "userdata", snapshot);
    db.close();
  }

  async function writeIdbfsFallback(entries) {
    try {
      const db = await openDB("/saves");
      if (!db.objectStoreNames.contains("FILE_DATA")) { db.close(); return; }
      for (const entry of entries) {
        let bytes;
        try { bytes = serializeEntry(entry); } catch (_) { continue; }
        const key = normalizePath(entry.entryName || ("userdata/" + basename(entry.name)));
        await idbPut(db, "FILE_DATA", key, { timestamp: Date.now(), mode: 0x81a4, contents: bytes });
      }
      db.close();
    } catch (_) {
      // 该页面不使用 IDBFS，忽略即可。
    }
  }

  async function applyAllToBrowser() {
    const dirty = [...state.files.values()].filter((entry) => entry.dirty && entry.kind !== "legacy" && entry.kind !== "error");
    if (!dirty.length) { toast("没有未保存的修改"); return false; }
    try {
      const files = state.browser && state.browser.kind === "zip"
        ? new Map(state.browser.files)
        : await readBrowserZipSnapshot();
      let ok = true;
      for (const entry of dirty) {
        let bytes;
        try { bytes = serializeEntry(entry); } catch (error) { ok = false; continue; }
        let target = null;
        if (entry.entryName && files.has(normalizePath(entry.entryName))) target = normalizePath(entry.entryName);
        if (!target) {
          const wanted = basename(entry.name).toLowerCase();
          for (const path of files.keys()) {
            if (basename(path).toLowerCase() === wanted) { target = path; break; }
          }
        }
        if (!target) target = "userdata/" + basename(entry.name);
        files.set(target, bytes);
        entry.dirty = false;
      }
      await writeBrowserZipSnapshot(files);
      await writeIdbfsFallback(dirty);
      if (state.browser && state.browser.kind === "zip") state.browser.files = files;
      renderFileList();
      renderEditor();
      if (ok) {
        setStatus(`已将 ${dirty.length} 个修改写入浏览器存档。`, "ok");
        toast("存档已保存");
      }
      return ok;
    } catch (error) {
      console.error(error);
      setStatus("保存失败：" + (error.message || String(error)), "error");
      toast(error.message || String(error), true);
      return false;
    }
  }

  async function embedSaveAndApply() {
    if (!(await applyAllToBrowser())) return;
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "pvz-editor-saved" }, window.location.origin);
    }
  }

  function findZipTarget(entry) {
    if (entry.entryName && state.browser.files.has(normalizePath(entry.entryName))) return normalizePath(entry.entryName);
    const wanted = basename(entry.name).toLowerCase();
    for (const path of state.browser.files.keys()) {
      if (basename(path).toLowerCase() === wanted) return path;
    }
    return null;
  }

  function sameBrowserFile(entry, fullPath, key) {
    return normalizePath(fullPath) === normalizePath(entry.entryName || "") ||
      basename(key).toLowerCase() === basename(entry.name).toLowerCase();
  }

  /* ------------------------------------------------------------------ */
  /* Cloud saves                                                        */
  /* ------------------------------------------------------------------ */

  async function cloudSaveApi(path, options = {}) {
    let token;
    try {
      token = localStorage.getItem("device_token");
    } catch (_) {
      throw new Error("无法读取设备登录信息。");
    }
    if (!token) return null;
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", "Bearer " + token);
    let response;
    try {
      response = await fetch("/api/cloud-saves" + path, {
        ...options,
        cache: "no-store",
        headers,
      });
    } catch (_) {
      throw new Error("无法连接云存档服务。");
    }
    if (response.status === 401) return null;
    if (!response.ok) {
      let message = "云存档请求失败（HTTP " + response.status + "）。";
      try {
        const data = await response.json();
        if (data.error) message = data.error;
      } catch (_) {
        // Keep the HTTP error when the response is not JSON.
      }
      throw new Error(message);
    }
    return response;
  }

  function cloudStatus(message, isError = false) {
    const node = $("#cloud-status");
    if (!node) return;
    node.textContent = message;
    node.style.color = isError ? "var(--red)" : "var(--muted)";
  }

  async function refreshCloudSlots() {
    const list = $("#cloud-slot-list");
    const loginHint = $("#cloud-login-hint");
    clear(list);
    try {
      const response = await cloudSaveApi("");
      if (!response) {
        loginHint.hidden = false;
        cloudStatus("请先登录设备。", true);
        return;
      }
      loginHint.hidden = true;
      const data = await response.json();
      state.cloudSlots = data.slots || [];
      if (!state.cloudSlots.length) {
        list.append(h("p", { class: "muted" }, "没有云存档。"));
        cloudStatus("云存档为空；可以编辑后上传。");
        return;
      }
      for (const save of state.cloudSlots) {
        const full = !!save.name;
        const card = h("div", { class: "cloud-slot" },
          h("div", { class: "title" },
            h("span", null, `槽位 ${save.slot}`),
            h("span", { class: "badge " + (full ? "info" : "") }, full ? save.name : "空槽位")
          ),
          h("div", { class: "meta" },
            full ? `${formatBytes(save.size_bytes || 0)} · ${formatTime(save.updated_at)}` : "暂无存档"
          ),
          h("div", { class: "actions" },
            full ? h("button", {
              class: "secondary btn-mini",
              onclick: () => loadCloudSlot(save),
            }, "载入到编辑器") : null,
            full ? h("button", {
              class: "danger btn-mini",
              onclick: () => deleteCloudSlot(save),
            }, "删除") : null
          )
        );
        list.append(card);
      }
      cloudStatus("云存档已刷新。");
      const selected = Number($("#cloud-slot-select").value);
      const current = state.cloudSlots.find((s) => s.slot === selected);
      if (current && current.name && !$("#cloud-save-name").value.trim()) {
        $("#cloud-save-name").value = current.name;
      }
    } catch (error) {
      console.error(error);
      cloudStatus(error.message || String(error), true);
    }
  }

  async function loadCloudSlot(save) {
    cloudStatus(`正在载入槽位 ${save.slot}…`);
    try {
      const response = await cloudSaveApi("/" + save.slot);
      if (!response) throw new Error("登录设备后才能使用云存档。");
      if (typeof JSZip === "undefined") throw new Error("缺少 JSZip，无法解析云存档。");
      const zip = await JSZip.loadAsync(await response.blob());
      const entries = Object.values(zip.files).filter((entry) => !entry.dir);
      if (!entries.length || entries.length > 1000) throw new Error("云存档中的文件数量无效。");
      const files = new Map();
      let total = 0;
      for (const entry of entries) {
        const path = normalizePath(entry.name);
        if (!path || path.split("/").some((part) => !part || part === "." || part === "..")) {
          throw new Error("云存档包含无效文件路径。");
        }
        const data = await entry.async("uint8array");
        total += data.byteLength;
        if (total > 50 * 1024 * 1024) throw new Error("云存档解压后超过 50 MiB。");
        files.set(path, data);
      }
      state.cloudSlot = { slot: save.slot, name: save.name, files };
      $("#cloud-slot-select").value = String(save.slot);
      $("#cloud-save-name").value = save.name || "";
      let loaded = 0;
      for (const [path, data] of files) {
        if (!/\.(dat|v4)$/i.test(path)) continue;
        if (addLoadedFile(path, data, { source: "cloud-slot-" + save.slot, entryName: path })) loaded++;
      }
      cloudStatus(`已载入槽位 ${save.slot}（${loaded} 个存档文件），编辑后可上传回云存档。`);
      setStatus(`已从云存档载入 ${loaded} 个文件。`, "ok");
    } catch (error) {
      console.error(error);
      cloudStatus(error.message || String(error), true);
      toast(error.message || String(error), true);
    }
  }

  async function deleteCloudSlot(save) {
    if (!confirm(`确定删除云存档“${save.name}”（槽位 ${save.slot}）吗？`)) return;
    try {
      const response = await cloudSaveApi("/" + save.slot, { method: "DELETE" });
      if (!response) throw new Error("登录设备后才能使用云存档。");
      if (state.cloudSlot && state.cloudSlot.slot === save.slot) state.cloudSlot = null;
      await refreshCloudSlots();
      cloudStatus("云存档已删除。");
    } catch (error) {
      cloudStatus(error.message || String(error), true);
    }
  }

  function cloudBaseFiles(slot) {
    if (state.cloudSlot && state.cloudSlot.slot === slot) {
      return { files: new Map(state.cloudSlot.files), label: `云存档槽位 ${slot}` };
    }
    if (state.browser && state.browser.kind === "zip") {
      return { files: new Map(state.browser.files), label: "浏览器存档快照" };
    }
    if (state.browser && state.browser.kind === "idbfs") {
      const files = new Map();
      for (const source of state.browser.sources) {
        for (const [key, record] of source.records) files.set(normalizePath(key), record.data);
      }
      return { files, label: "浏览器 IDBFS 存档" };
    }
    return { files: new Map(), label: "当前已打开的文件（可能不完整）" };
  }

  async function uploadCurrentToCloud() {
    const slot = Number($("#cloud-slot-select").value);
    const name = $("#cloud-save-name").value.trim();
    if (![1, 2].includes(slot)) { cloudStatus("槽位无效。", true); return; }
    if (!name || [...name].length > 40) { cloudStatus("存档名称须为 1 至 40 个字符。", true); return; }

    const base = cloudBaseFiles(slot);
    const localOnly = base.files.size === 0;
    let overlayCount = 0;
    for (const entry of state.files.values()) {
      if (entry.kind === "legacy" || entry.kind === "error") continue;
      let target = null;
      if (entry.entryName && base.files.has(normalizePath(entry.entryName))) {
        target = normalizePath(entry.entryName);
      } else {
        const wanted = basename(entry.name).toLowerCase();
        for (const path of base.files.keys()) {
          if (basename(path).toLowerCase() === wanted) { target = path; break; }
        }
      }
      if (!target && localOnly) target = "userdata/" + basename(entry.name);
      if (!target) continue;
      try {
        base.files.set(target, serializeEntry(entry));
        overlayCount++;
      } catch (error) {
        console.warn("跳过无法导出的文件：", entry.name, error);
      }
    }
    if (!base.files.size) {
      cloudStatus("没有可上传的存档文件。请先读取云存档、浏览器存档，或拖入本地文件。", true);
      return;
    }
    if (!base.files.has("userdata/users.dat") && !base.files.has("users.dat")) {
      cloudStatus(`注意：${base.label} 中没有 users.dat；上传后游戏可能无法列出玩家。`, true);
      return;
    }
    if (!confirm(`将 ${base.label} 中的 ${base.files.size} 个文件上传到槽位 ${slot}（“${name}”）？这会覆盖该槽位原有内容。`)) return;

    cloudStatus("正在生成云存档 ZIP…");
    try {
      if (typeof JSZip === "undefined") throw new Error("缺少 JSZip，无法生成云存档。");
      const zip = new JSZip();
      for (const [path, data] of base.files) zip.file(path, data);
      const body = await zip.generateAsync({
        type: "uint8array",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });
      if (body.byteLength > 10 * 1024 * 1024) throw new Error("云存档超过 10 MiB，无法上传。");
      cloudStatus("正在上传到云存档…");
      const response = await cloudSaveApi(
        "/" + slot + "?name=" + encodeURIComponent(name),
        { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body }
      );
      if (!response) throw new Error("登录设备后才能使用云存档。");
      state.cloudSlot = { slot, name, files: new Map(base.files) };
      await refreshCloudSlots();
      cloudStatus(`已上传槽位 ${slot}（${formatBytes(body.byteLength)}，覆盖 ${overlayCount} 个编辑文件）。`);
      setStatus(`云存档槽位 ${slot} 已更新。`, "ok");
      toast("云存档已上传");
    } catch (error) {
      console.error(error);
      cloudStatus(error.message || String(error), true);
      toast(error.message || String(error), true);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                             */
  /* ------------------------------------------------------------------ */

  async function readLocalFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setStatus(`正在读取 ${files.length} 个文件…`);
    let loaded = 0;
    for (const file of files) {
      try {
        if (file.size > 20 * 1024 * 1024) {
          toast(`${file.name} 超过 20 MiB，已跳过`, true);
          continue;
        }
        const buffer = await file.arrayBuffer();
        if (addLoadedFile(file.name, new Uint8Array(buffer), { source: "local" })) loaded++;
      } catch (error) {
        console.error(error);
        toast(`${file.name}：${error.message || String(error)}`, true);
      }
    }
    if (loaded) setStatus(`已载入 ${loaded} 个文件。`, "ok");
  }

  function initEvents() {
    const dropZone = $("#drop-zone");
    const input = $("#file-input");
    $("#pick-files").addEventListener("click", () => input.click());
    dropZone.addEventListener("click", () => input.click());
    dropZone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); input.click(); }
    });
    input.addEventListener("change", async () => {
      await readLocalFiles(input.files);
      input.value = "";
    });
    for (const type of ["dragenter", "dragover"]) {
      dropZone.addEventListener(type, (event) => { event.preventDefault(); dropZone.classList.add("over"); });
    }
    for (const type of ["dragleave", "drop"]) {
      dropZone.addEventListener(type, (event) => { event.preventDefault(); dropZone.classList.remove("over"); });
    }
    dropZone.addEventListener("drop", async (event) => {
      await readLocalFiles(event.dataTransfer.files);
    });
    $("#load-browser").addEventListener("click", loadBrowserSaves);
    $("#cloud-refresh").addEventListener("click", refreshCloudSlots);
    $("#cloud-upload").addEventListener("click", uploadCurrentToCloud);
    $("#cloud-slot-select").addEventListener("change", () => {
      const selected = Number($("#cloud-slot-select").value);
      const save = state.cloudSlots.find((s) => s.slot === selected);
      if (save && save.name) $("#cloud-save-name").value = save.name;
      else if (state.cloudSlot && state.cloudSlot.slot === selected) $("#cloud-save-name").value = state.cloudSlot.name || "";
    });
    $("#save-download").addEventListener("click", () => {
      const entry = state.activeId ? state.files.get(state.activeId) : null;
      if (entry) downloadEntry(entry);
    });
    $("#save-browser").addEventListener("click", () => {
      if (embedMode) { embedSaveAndApply(); return; }
      const entry = state.activeId ? state.files.get(state.activeId) : null;
      if (entry) writeToBrowser(entry);
    });
    $("#reset-file").addEventListener("click", () => {
      const entry = state.activeId ? state.files.get(state.activeId) : null;
      if (!entry) return;
      if (!confirm("撤销当前文件的所有修改并重新解析原始数据？")) return;
      resetEntry(entry);
    });
  }

  if (embedMode) {
    const link = document.querySelector('a[href="pvz.html"]');
    if (link) link.hidden = true;
    const closeButton = document.getElementById("editor-close-embed");
    if (closeButton) {
      closeButton.hidden = false;
      closeButton.addEventListener("click", () => {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: "pvz-editor-close" }, window.location.origin);
        }
      });
    }
    $("#save-browser").textContent = "保存并应用到游戏";
    $("#browser-hint").textContent = "修改后点击“保存并应用到游戏”，会写回本机存档并提示重启游戏。";
    loadBrowserSaves();
  }

  initEvents();
  renderFileList();
  renderEditor();
  setStatus("准备就绪。文件只在浏览器本地处理。");
  refreshCloudSlots();
})();
