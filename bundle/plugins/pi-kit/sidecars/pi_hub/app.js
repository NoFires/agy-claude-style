/**
 * PI Hub Frontend (`sidecars/pi_hub/app.js`).
 * Syncs with Antigravity host theme/workspace, polls live PlanBoard / Memory / Goal 2.0 / Skills state,
 * supports cross-project memory bucket switching, and drives Current-Window vs Clean-New-Window execution.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const on = (id, ev, fn) => {
    const el = $(id);
    if (el) el.addEventListener(ev, fn);
  };
  const NEXT_STATUS = {
    pending: "in_progress",
    in_progress: "done",
    done: "failed",
    failed: "pending",
  };

  const DEFAULT_SKILLS = [
    {
      name: "pi-plan",
      group: "pi-core",
      description: "先只读列清任务看板，供选择「本窗口 / ✨ 新窗口净室 / 子代理」执行并实时勾选步骤",
      starter: "/pi-plan 先只读梳理当前需求并建立结构化任务看板，让我选择执行窗口",
    },
    {
      name: "pi-goal",
      group: "pi-core",
      description: "目标模式 2.0：收敛验收标准 + 独立只读审查官 pi-goal-reviewer + Git Diff 停滞熔断",
      starter: "/pi-goal 启动 Goal Mode 2.0，先帮我收敛验收标准",
    },
    {
      name: "pi-memory",
      group: "pi-core",
      description: "管理全局与项目分级记忆、单会话无痕隔离，并与 GitHub pi-memory-sync 双向无损同步",
      starter: "/pi-memory 查看当前全局与项目记忆，并检查 GitHub 云同步状态",
    },
    {
      name: "grill",
      group: "pi-agent",
      description: "苏格拉底式高压追问与设计压力测试（Grill Mode），实施前消灭边界盲区",
      starter: "/grill 针对我接下来的方案做一轮结构化追问对齐",
    },
    {
      name: "git-commit",
      group: "pi-agent",
      description: "遵循 Conventional Commits 规范生成原子化提交信息与 PR 摘要",
      starter: "/git-commit 检查当前改动并生成规范的原子化提交",
    },
    {
      name: "colab-operator",
      group: "pi-agent",
      description: "通过 colab CLI 管理 Google Colab GPU/TPU 会话、同步文件与远程执行",
      starter: "/colab-operator 查看当前 Colab 会话与 GPU 环境状态",
    },
    {
      name: "anthropic-frontend-design",
      group: "pi-agent",
      description: "为新界面或改版提供高辨识度视觉方向、字体与排版取舍，避免模板感",
      starter: "/anthropic-frontend-design 帮我设计一个克制有辨识度的前端界面",
    },
    {
      name: "anthropic-doc-coauthoring",
      group: "pi-agent",
      description: "按结构化流程共同撰写技术提案、RFC 与规格文档并做读者视角校验",
      starter: "/anthropic-doc-coauthoring 一起撰写一份清晰的技术设计文档",
    },
    {
      name: "k-dense-literature-review",
      group: "pi-agent",
      description: "基于 PubMed、arXiv、bioRxiv 开展可复现系统文献综述与引用核查",
      starter: "/k-dense-literature-review 针对该主题开展可复现文献检索与综述",
    },
    {
      name: "k-dense-citation-management",
      group: "pi-agent",
      description: "检索 OpenAlex / PubMed / Scholar 核对元数据并生成规范 BibTeX",
      starter: "/k-dense-citation-management 校验引文元数据并导出规范 BibTeX",
    },
    {
      name: "k-dense-matplotlib",
      group: "pi-agent",
      description: "使用 Matplotlib 定制出版级科研图表并导出高分辨率 PNG/PDF/SVG",
      starter: "/k-dense-matplotlib 绘制出版级科研统计图表",
    },
    {
      name: "k-dense-statistical-analysis",
      group: "pi-agent",
      description: "统计检验选择、假设检查、效应量计算、功效分析与 APA 格式报告",
      starter: "/k-dense-statistical-analysis 进行统计假设检验与效应量分析",
    },
    {
      name: "k-dense-stable-baselines3",
      group: "pi-agent",
      description: "使用 Stable Baselines3 训练与评估 PPO / SAC / DQN 强化学习智能体",
      starter: "/k-dense-stable-baselines3 构建并评估强化学习训练流程",
    },
  ];

  const state = {
    tab: "plan",
    memScope: "global",
    selectedProjectKey: "",
    skillFilter: "",
    workspaceUri: "",
    snap: null,
    manualTheme: null,
    instructionsDirty: false,
    refreshInFlight: false,
    refreshQueued: false,
  };

  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );

  function showToast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.add("hidden"), 2600);
  }

  function parseCssColor(cssExpr, fallback) {
    const probe = document.createElement("span");
    probe.style.cssText = `position:absolute;visibility:hidden;color:${cssExpr || fallback}`;
    document.documentElement.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    const nums = (rgb.match(/[\d.]+/g) || []).map(Number);
    if (nums.length < 3) return null;
    const scale = rgb.startsWith("color(") ? 1 : 255;
    const [r, g, b] = nums.slice(0, 3).map((v) => v / scale);
    const alpha = nums.length >= 4 ? (rgb.startsWith("color(") ? nums[3] : nums[3]) : 1;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return { lum, alpha };
  }

  function syncHostTheme() {
    if (window.parent && window.parent !== window) {
      if (!document.documentElement.classList.contains("in-host")) {
        document.documentElement.classList.add("in-host");
      }
      if (document.body && document.body.style.background !== "transparent") {
        document.body.style.background = "transparent";
      }
    }
    const bg = parseCssColor("var(--background, #f7f7f8)");
    const fg = parseCssColor("var(--foreground, #1d1f21)");
    let nextTheme = "";
    if (bg && bg.alpha >= 0.25) {
      nextTheme = bg.lum < 0.5 ? "dark" : "light";
    } else if (fg) {
      nextTheme = fg.lum > 0.5 ? "dark" : "light";
    }
    if (nextTheme && document.documentElement.dataset.theme !== nextTheme) {
      document.documentElement.dataset.theme = nextTheme;
    }
  }

  new MutationObserver(syncHostTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["style"],
  });

  window.addEventListener("DOMContentLoaded", syncHostTheme);
  window.addEventListener("load", syncHostTheme);
  window.addEventListener("message", (event) => {
    if (event.data?.type === "theme-change") {
      requestAnimationFrame(syncHostTheme);
    }
  });

  if (window.sidecar?.onWorkspaceChange) {
    window.sidecar.onWorkspaceChange((uris) => {
      state.workspaceUri = uris?.[0] || "";
      void refresh();
    });
  }

  function convId() {
    return (
      window.sidecar?.conversationId ||
      new URLSearchParams(location.search).get("conversationId") ||
      state.snap?.conversationId ||
      ""
    );
  }

  function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
      Promise.resolve(promise).then(
        (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  async function apiGet(path) {
    const fn = window.sidecar?.fetch ? window.sidecar.fetch.bind(window.sidecar) : fetch;
    const res = await withTimeout(fn(path, { method: "GET" }), 8000, `GET ${path}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function apiPost(path, body) {
    const fn = window.sidecar?.fetch ? window.sidecar.fetch.bind(window.sidecar) : fetch;
    const res = await withTimeout(
      fn(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: convId(),
          workspaceUri: state.workspaceUri,
          ...body,
        }),
      }),
      15000,
      `POST ${path}`,
    );
    const payload = await res.json();
    if (!res.ok || payload?.error) throw new Error(payload?.error || `HTTP ${res.status}`);
    return payload;
  }

  document.querySelectorAll(".pi-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.tab = btn.dataset.tab;
      document.querySelectorAll(".pi-tab").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".pi-panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${state.tab}`));
    });
  });

  document.querySelectorAll(".pi-seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.memScope = btn.dataset.memScope;
      state.instructionsDirty = false;
      document.querySelectorAll(".pi-seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
      renderMemory();
    });
  });

  on("select-project-bucket", "change", (e) => {
    state.selectedProjectKey = e.target.value;
    state.instructionsDirty = false;
    renderMemory();
  });

  on("input-skill-filter", "input", (e) => {
    state.skillFilter = e.target.value.trim().toLowerCase();
    renderSkills();
  });

  on("btn-reload-ui", "click", async () => {
    const ok = await refresh();
    if (ok) {
      syncHostTheme();
      showToast("已刷新最新状态");
    } else {
      location.reload();
    }
  });

  function resolveSelectedBucket(mem) {
    const all = mem?.allProjects || [];
    const activeKey = !mem?.identity?.isChatSpace ? mem?.identity?.projectKey : "";
    if (!state.selectedProjectKey) {
      state.selectedProjectKey = activeKey || all[0]?.projectKey || "";
    }
    return all.find((p) => p.projectKey === state.selectedProjectKey) || null;
  }

  function render() {
    const snap = state.snap;
    if (!snap) return;

    const proj = snap.memory?.identity;
    $("pi-project-badge").textContent = proj?.isChatSpace
      ? `💬 独立对话 · 已同步 ${(snap.memory?.allProjects || []).length} 个项目桶`
      : `${proj?.projectKey || proj?.name || "workspace"}`;

    const incBtn = $("btn-incognito");
    incBtn.textContent = snap.incognito ? "🔒 独立记忆中" : "🔓 共享记忆";
    incBtn.classList.toggle("isolated", Boolean(snap.incognito));

    renderPlan();
    renderMemory();
    renderGoal();
    renderSkills();
  }

  function renderPlan() {
    const plan = state.snap?.plan;
    const steps = plan?.steps || [];
    const badge = $("badge-plan");

    if (!steps.length) {
      badge.classList.add("hidden");
      $("plan-empty").classList.remove("hidden");
      $("plan-board").classList.add("hidden");
      return;
    }

    const done = steps.filter((s) => s.status === "done").length;
    const pct = Math.round((done / steps.length) * 100);
    badge.textContent = `${done}/${steps.length}`;
    badge.classList.remove("hidden");

    $("plan-empty").classList.add("hidden");
    $("plan-board").classList.remove("hidden");
    $("plan-title").textContent = plan.title || "任务执行计划";
    $("plan-mode-pill").textContent = plan.planMode
      ? "🔒 规划只读闸门开启（写工具已锁定，等待选择执行窗口）"
      : `🚀 执行推进中 · 已完成 ${done}/${steps.length}`;
    $("plan-pct").textContent = `${pct}%`;
    $("plan-progress-bar").style.width = `${pct}%`;

    setHtmlIfChanged(
      $("plan-steps"),
      steps
        .map((s, idx) => {
          const sym =
            s.status === "done" ? "✓" : s.status === "in_progress" ? "▸" : s.status === "failed" ? "!" : idx + 1;
          const files = s.files?.length ? `<div class="pi-step-meta">${esc(s.files.join(", "))}</div>` : "";
          const desc = s.description ? `<div class="pi-status-line">${esc(s.description)}</div>` : "";
          return `
          <div class="pi-step ${esc(s.status)}" data-step-id="${esc(s.id)}">
            <button type="button" class="pi-step-check" data-action="cycle" data-step-id="${esc(s.id)}" title="点击切换步骤状态">${sym}</button>
            <div class="pi-step-body">
              <div class="pi-step-title">${esc(s.title)}</div>
              ${desc}
              ${files}
            </div>
            <button type="button" class="pi-btn sm ghost danger" data-action="del" data-step-id="${esc(s.id)}" title="删除步骤">✕</button>
          </div>
        `;
        })
        .join(""),
    );
  }

  function renderMemory() {
    const mem = state.snap?.memory;
    const sync = state.snap?.sync;
    if (!mem) return;

    const allProjects = mem.allProjects || [];
    const selectedBucket = resolveSelectedBucket(mem);

    const gItems = mem.globalItems || [];
    const pItems =
      selectedBucket?.items ??
      (!mem.identity?.isChatSpace && selectedBucket?.projectKey === mem.identity?.projectKey
        ? mem.projectItems || []
        : []);

    const activeGlobalCount = gItems.filter((i) => i.enabled !== false).length;
    const totalProjectActive = allProjects.reduce((acc, p) => acc + (p.activeCount || 0), 0);

    $("cnt-global").textContent = String(activeGlobalCount);
    $("cnt-project").textContent = String(selectedBucket ? selectedBucket.activeCount || pItems.length : totalProjectActive);
    $("badge-memory").textContent = String(activeGlobalCount + totalProjectActive);

    // Populate project selector dropdown
    const pickerRow = $("project-picker-row");
    const selEl = $("select-project-bucket");
    if ((state.memScope === "project" || state.memScope === "instructions") && allProjects.length > 0) {
      pickerRow.classList.remove("hidden");
      const nextOpts = allProjects
        .map(
          (p) =>
            `<option value="${esc(p.projectKey)}" ${p.projectKey === state.selectedProjectKey ? "selected" : ""}>📁 ${esc(p.name)} (${esc(p.projectKey)}) · ${p.activeCount || 0} 条</option>`,
        )
        .join("");
      setHtmlIfChanged(selEl, nextOpts);
      if (selEl.value !== state.selectedProjectKey) {
        selEl.value = state.selectedProjectKey;
      }
    } else {
      pickerRow.classList.add("hidden");
    }

    if (sync?.loggedIn) {
      $("sync-account-label").textContent = `GitHub · @${sync.username}/${sync.repo}`;
      const ts = sync.lastSyncedAt ? new Date(sync.lastSyncedAt).toLocaleString() : "尚未同步";
      $("sync-meta-label").textContent = sync.lastError ? `⚠ ${sync.lastError}` : `上次同步：${ts}`;
      $("btn-sync-now").classList.remove("hidden");
      $("btn-sync-logout").classList.remove("hidden");
      $("btn-device-login").classList.add("hidden");
    } else {
      $("sync-account-label").textContent = "GitHub 跨端云同步 (pi-memory-sync)";
      $("sync-meta-label").textContent = sync?.lastError || "支持 8 位设备码一键授权，与 pi-desktop 无损互通";
      $("btn-sync-now").classList.add("hidden");
      $("btn-sync-logout").classList.add("hidden");
      $("btn-device-login").classList.remove("hidden");
    }

    if (sync?.deviceFlow) {
      $("device-flow-box").classList.remove("hidden");
      $("device-code").textContent = sync.deviceFlow.userCode;
      $("device-uri").href = sync.deviceFlow.verificationUri;
    } else {
      $("device-flow-box").classList.add("hidden");
    }

    if (state.memScope === "instructions") {
      $("mem-list-section").classList.add("hidden");
      $("mem-instructions-section").classList.remove("hidden");
      if (!state.instructionsDirty) {
        $("textarea-instructions").value = selectedBucket?.instructions ?? mem.projectInstructions ?? "";
      }
      return;
    }

    $("mem-list-section").classList.remove("hidden");
    $("mem-instructions-section").classList.add("hidden");

    if (state.memScope === "project") {
      if (!selectedBucket && mem.identity?.isChatSpace) {
        setHtmlIfChanged(
          $("memory-items"),
          `<div class="pi-empty-desc">暂无已同步的项目记忆桶；在任意代码仓库对话后会自动创建对应项目桶。</div>`,
        );
        return;
      }
      if (!pItems.length) {
        const hint =
          selectedBucket && selectedBucket.activeCount > 0 && !selectedBucket.items
            ? `该项目桶已有 ${selectedBucket.activeCount} 条记忆（打开该项目目录或重启面板即可展开编辑明细）。`
            : "当前项目桶暂无记忆条目，可在上方输入框直接添加。";
        setHtmlIfChanged($("memory-items"), `<div class="pi-empty-desc">${esc(hint)}</div>`);
        return;
      }
    }

    const items = state.memScope === "project" ? pItems : gItems;
    if (!items.length) {
      setHtmlIfChanged($("memory-items"), `<div class="pi-empty-desc">当前作用域暂无记忆条目。</div>`);
      return;
    }
    setHtmlIfChanged(
      $("memory-items"),
      items
        .map(
          (it) => `
        <div class="pi-mem-item ${it.enabled === false ? "disabled" : ""}">
          <input type="checkbox" ${it.enabled !== false ? "checked" : ""} data-mem-toggle="${esc(it.id)}" title="启用/禁用该条记忆" />
          <div class="pi-mem-text">${esc(it.content)}</div>
          <button type="button" class="pi-btn sm ghost danger" data-mem-del="${esc(it.id)}" title="软删除">✕</button>
        </div>
      `,
        )
        .join(""),
    );
  }

  function renderGoal() {
    const goal = state.snap?.goal;
    const badge = $("badge-goal");
    if (!goal) {
      badge.classList.add("hidden");
      $("goal-empty").classList.remove("hidden");
      $("goal-active").classList.add("hidden");
      return;
    }
    badge.classList.remove("hidden");
    badge.textContent = `${goal.round}/${goal.maxRounds}`;
    $("goal-empty").classList.add("hidden");
    $("goal-active").classList.remove("hidden");

    $("goal-phase-badge").textContent =
      goal.phase === "completed"
        ? "✅ 已达成"
        : goal.phase === "blocked"
          ? "⛔ 已熔断/受阻"
          : goal.phase === "paused"
            ? "⏸ 已暂停"
            : "🔥 执行审查循环中";
    $("goal-round-stat").textContent = `Round ${goal.round}/${goal.maxRounds}`;
    $("goal-objective-text").textContent = goal.objective;

    const fp = goal.liveDiff?.fingerprint || goal.lastFingerprint || "—";
    const stat = goal.liveDiff?.statSummary || goal.lastStatSummary || "等待首轮 Diff 取样";
    $("goal-diff-line").textContent = `Diff 指纹: ${fp} · 停滞计数: ${goal.stagnantRounds || 0}/2 · ${stat}`;

    const vbox = $("goal-verdict-box");
    if (goal.blockedReason) {
      vbox.classList.remove("hidden");
      vbox.textContent = `⛔ ${goal.blockedReason}`;
    } else if (goal.lastVerdict) {
      vbox.classList.remove("hidden");
      vbox.textContent = `[第 ${goal.lastVerdict.round} 轮审查: ${goal.lastVerdict.verdict}] ${goal.lastVerdict.feedback}`;
    } else {
      vbox.classList.add("hidden");
    }
  }

  function renderSkills() {
    const planLocked = Boolean(state.snap?.plan?.planMode);
    const guards = [
      {
        label: "PreToolUse · 规划期硬只读闸门",
        state: planLocked ? "🔒 拦截写操作中" : "🟢 待命 (规划时自动锁写)",
      },
      {
        label: "PreToolUse · pkill -f / rm -rf 红线拦截",
        state: "🛡️ 常驻保护中",
      },
      {
        label: "SessionStart · 静态前缀记忆注入",
        state: state.snap?.incognito ? "🔒 当前会话已隔离" : "⚡ 首轮零抖动注入",
      },
      {
        label: "Stop · Goal 2.0 Git Diff 停滞熔断器",
        state: state.snap?.goal ? `🎯 监控中 (${state.snap.goal.round}/${state.snap.goal.maxRounds})` : "🟢 就绪 (2轮零Diff跳闸)",
      },
      {
        label: "Subagent · pi-goal-reviewer 只读审查官",
        state: "🔍 已挂载",
      },
    ];
    setHtmlIfChanged(
      $("guardrails-list"),
      guards
        .map(
          (g) => `
        <div class="pi-guard-item">
          <span class="pi-min0"><span class="pi-guard-dot"></span>${esc(g.label)}</span>
          <span class="pi-mono-stat">${esc(g.state)}</span>
        </div>
      `,
        )
        .join(""),
    );

    const rawSkills = state.snap?.capabilities?.skills?.length ? state.snap.capabilities.skills : DEFAULT_SKILLS;
    const starterMap = Object.fromEntries(DEFAULT_SKILLS.map((s) => [s.name, s.starter]));
    const mergedSkills = rawSkills.map((s) => ({
      ...s,
      starter: s.starter || starterMap[s.name] || `/${s.name} `,
    }));

    $("badge-skills").textContent = String(mergedSkills.length);
    const filtered = state.skillFilter
      ? mergedSkills.filter(
          (s) =>
            s.name.toLowerCase().includes(state.skillFilter) ||
            (s.description || "").toLowerCase().includes(state.skillFilter),
        )
      : mergedSkills;
    $("skills-count-label").textContent = `${filtered.length}/${mergedSkills.length} 项`;

    setHtmlIfChanged(
      $("skills-grid"),
      filtered
        .map(
          (s) => `
        <div class="pi-skill-card ${s.group === "pi-core" ? "core" : ""}">
          <div class="pi-row-between">
            <span class="pi-skill-cmd">/${esc(s.name)}</span>
            <div class="pi-row-gap">
              <button type="button" class="pi-btn sm ghost" data-skill-copy="/${esc(s.name)}" title="复制斜杠指令">复制</button>
              <button type="button" class="pi-btn sm primary" data-skill-run="${esc(s.starter)}" title="直接发送到当前对话">▶ 调用</button>
            </div>
          </div>
          <div class="pi-status-line">${esc(s.description || "")}</div>
        </div>
      `,
        )
        .join(""),
    );
  }

  // Event Handlers — Skills Studio
  on("skills-grid", "click", async (e) => {
    const copyBtn = e.target.closest("button[data-skill-copy]");
    if (copyBtn) {
      await navigator.clipboard.writeText(copyBtn.dataset.skillCopy);
      showToast(`已复制 ${copyBtn.dataset.skillCopy}`);
      return;
    }
    const runBtn = e.target.closest("button[data-skill-run]");
    if (runBtn) {
      const msg = runBtn.dataset.skillRun;
      if (window.sidecar?.agent?.sendMessage && convId()) {
        try {
          await window.sidecar.agent.sendMessage(msg);
          showToast(`🚀 已发送至当前对话: ${msg.split(" ")[0]}`);
          return;
        } catch {
          // Fallback to clipboard
        }
      }
      await navigator.clipboard.writeText(msg);
      showToast(`📋 已复制指令，粘贴到输入框即可运行`);
    }
  });

  // Event Handlers — PlanBoard
  on("btn-quick-step", "click", async () => {
    const title = $("input-quick-step").value.trim();
    if (!title) return;
    $("input-quick-step").value = "";
    await apiPost("/api/plan", { action: "add_step", title });
    await refresh();
  });

  on("btn-add-step", "click", async () => {
    const title = $("input-add-step").value.trim();
    if (!title) return;
    $("input-add-step").value = "";
    await apiPost("/api/plan", { action: "add_step", title });
    await refresh();
  });

  on("plan-steps", "click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const stepId = btn.dataset.stepId;
    if (btn.dataset.action === "del") {
      await apiPost("/api/plan", { action: "delete_step", stepId });
      await refresh();
    } else if (btn.dataset.action === "cycle") {
      const step = state.snap?.plan?.steps?.find((s) => s.id === stepId);
      if (!step) return;
      await apiPost("/api/plan", { action: "update_step", stepId, status: NEXT_STATUS[step.status] || "pending" });
      await refresh();
    }
  });

  on("btn-exec-here", "click", async () => {
    try {
      await apiPost("/api/plan", { action: "set_mode", planMode: false });
      await refresh();
      if (window.sidecar?.agent?.sendMessage) {
        await window.sidecar.agent.sendMessage(
          "已确认在当前窗口开始实施：请严格按当前任务看板逐步执行，每步开始置 in_progress、验证完成后调用 pi_plan(action='update_step', status='done') 把完成项勾掉。",
        );
        showToast("▶ 已解锁并在当前窗口启动执行");
      }
    } catch (err) {
      showToast(`启动失败: ${err.message}`);
    }
  });

  on("btn-exec-newwin", "click", async () => {
    try {
      const { handoff } = await apiPost("/api/plan", { action: "prepare_handoff" });
      const winTitle = `✨ ${handoff.title}`.slice(0, 80);
      const launched = await apiPost("/api/internal/new-window", {
        fromConversationId: convId(),
        title: winTitle,
        prompt: handoff.prompt,
      });
      const newId =
        launched?.result?.conversationId ||
        launched?.result?.response?.newConversation?.conversationId ||
        launched?.result?.response?.conversationId ||
        "";
      if (newId) {
        await apiPost("/api/plan", {
          action: "claim_handoff",
          newConversationId: newId,
          prompt: handoff.prompt,
        });
        window.sidecar?.ui?.toggleConversation?.(newId);
      }
      showToast("✨ 已在左侧栏拉起全新净室窗口执行！");
      await refresh();
    } catch (err) {
      showToast(`拉起新窗口失败: ${err.message}`);
    }
  });

  on("btn-copy-plan", "click", async () => {
    if (!state.snap?.planMarkdown) return;
    await navigator.clipboard.writeText(state.snap.planMarkdown);
    showToast("📋 已复制 Markdown 任务清单");
  });

  on("btn-toggle-gate", "click", async () => {
    const cur = Boolean(state.snap?.plan?.planMode);
    await apiPost("/api/plan", { action: "set_mode", planMode: !cur });
    await refresh();
  });

  on("btn-clear-plan", "click", async () => {
    await apiPost("/api/plan", { action: "clear" });
    await refresh();
  });

  // Event Handlers — Memory & Sync
  on("btn-incognito", "click", async () => {
    const next = !state.snap?.incognito;
    await apiPost("/api/memory", { action: "set_incognito", incognito: next });
    showToast(next ? "🔒 当前对话已设为独立无痕记忆" : "🔓 已恢复共享记忆");
    await refresh();
  });

  on("btn-add-memory", "click", async () => {
    const content = $("input-new-memory").value.trim();
    if (!content) return;
    try {
      const scope = state.memScope === "project" ? "project" : "global";
      const bucket = resolveSelectedBucket(state.snap?.memory);
      await apiPost("/api/memory", {
        action: "remember",
        scope,
        content,
        projectKey: scope === "project" ? bucket?.projectKey || "" : "",
        projectName: scope === "project" ? bucket?.name || "" : "",
        bypassIncognito: true,
      });
      $("input-new-memory").value = "";
      showToast("已写入记忆库");
      await refresh();
    } catch (err) {
      showToast(err.message);
    }
  });

  on("memory-items", "click", async (e) => {
    const bucket = resolveSelectedBucket(state.snap?.memory);
    const scope = state.memScope === "project" ? "project" : "global";
    const projectKey = scope === "project" ? bucket?.projectKey || "" : "";

    const delBtn = e.target.closest("button[data-mem-del]");
    if (delBtn) {
      await apiPost("/api/memory", { action: "forget", scope, id: delBtn.dataset.memDel, projectKey });
      await refresh();
      return;
    }
    const chk = e.target.closest("input[data-mem-toggle]");
    if (chk) {
      await apiPost("/api/memory", {
        action: "toggle_item",
        scope,
        id: chk.dataset.memToggle,
        enabled: chk.checked,
        projectKey,
      });
      await refresh();
    }
  });

  on("textarea-instructions", "input", () => {
    state.instructionsDirty = true;
  });

  on("btn-save-instructions", "click", async () => {
    try {
      const bucket = resolveSelectedBucket(state.snap?.memory);
      await apiPost("/api/memory", {
        action: "set_instructions",
        projectKey: bucket?.projectKey || "",
        projectName: bucket?.name || "",
        instructions: $("textarea-instructions").value,
      });
      state.instructionsDirty = false;
      showToast("📜 项目专属指令已保存");
      await refresh();
    } catch (err) {
      showToast(err.message);
    }
  });

  on("btn-sync-now", "click", async () => {
    try {
      $("btn-sync-now").disabled = true;
      $("btn-sync-now").textContent = "同步中…";
      const res = await apiPost("/api/memory", { action: "sync" });
      showToast(`✅ 云同步成功 (全局 ${res.globalCount} 条)`);
      await refresh();
    } catch (err) {
      showToast(`同步失败: ${err.message}`);
    } finally {
      $("btn-sync-now").disabled = false;
      $("btn-sync-now").textContent = "🔄 同步";
    }
  });

  on("btn-device-login", "click", async () => {
    try {
      await apiPost("/api/memory", { action: "device_login" });
      await refresh();
    } catch (err) {
      showToast(err.message);
    }
  });

  on("btn-token-login", "click", async () => {
    const token = $("input-gh-token").value.trim();
    if (!token) return;
    try {
      await apiPost("/api/memory", { action: "token_login", token });
      $("input-gh-token").value = "";
      $("token-login-details").open = false;
      showToast("✅ GitHub 登录并同步成功");
      await refresh();
    } catch (err) {
      showToast(err.message);
    }
  });

  on("btn-sync-logout", "click", async () => {
    await apiPost("/api/memory", { action: "logout" });
    await refresh();
  });

  // Event Handlers — Goal Mode 2.0
  on("btn-start-goal", "click", async () => {
    const objective = $("input-goal-obj").value.trim();
    if (!objective) return;
    const maxRounds = Number($("input-goal-rounds").value) || 6;
    await apiPost("/api/goal", { action: "set", objective, maxRounds });
    $("input-goal-obj").value = "";
    await refresh();
    if (window.sidecar?.agent?.sendMessage) {
      await window.sidecar.agent.sendMessage(
        `【PI Goal 2.0 已激活】目标：${objective}（最大轮次 ${maxRounds}）。请开始第 1 轮实施，完成后调用只读子代理 pi-goal-reviewer 核验并登记 record_verdict。`,
      );
    }
    showToast("🎯 Goal 2.0 已启动");
  });

  on("btn-pause-goal", "click", async () => {
    await apiPost("/api/goal", { action: "pause" });
    await refresh();
  });

  on("btn-clear-goal", "click", async () => {
    await apiPost("/api/goal", { action: "clear" });
    await refresh();
  });

  function setHtmlIfChanged(el, nextHtml) {
    if (el && el.innerHTML !== nextHtml) {
      el.innerHTML = nextHtml;
    }
  }

  async function refresh() {
    if (state.refreshInFlight) {
      state.refreshQueued = true;
      return true;
    }
    state.refreshInFlight = true;
    try {
      const qs = new URLSearchParams({
        conversationId: convId(),
        workspaceUri: state.workspaceUri || "",
        _t: String(Date.now()),
      });
      state.snap = await apiGet(`/api/snapshot?${qs.toString()}`);
      render();
      return true;
    } catch (err) {
      const badge = $("pi-project-badge");
      if (badge) {
        badge.textContent = state.snap
          ? `同步重试中 (${err?.message || "network"})`
          : `重试连接中 (${err?.message || "network"})`;
      }
      return false;
    } finally {
      state.refreshInFlight = false;
      if (state.refreshQueued) {
        state.refreshQueued = false;
        void refresh();
      }
    }
  }

  syncHostTheme();
  if (window.__PI_INITIAL_SNAP__) {
    state.snap = window.__PI_INITIAL_SNAP__;
    render();
  }
  void refresh();
  setInterval(refresh, 2000);
})();
