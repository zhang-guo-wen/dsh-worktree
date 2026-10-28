window.__ModuleLoader__.load({
	id: "@guowenzhang/dsh-worktree",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-css:C:\02-codespace\DeepSeek\dsh-worktree\src\client\WorktreeChip.module.css.mjs
		const css$5 = ".KJP-8W_row{justify-content:flex-end;padding:0 16px;display:flex}[data-phase=hero] .KJP-8W_row,[data-content-phase=hero] .KJP-8W_row{height:0;margin:-8px 0;position:relative}.KJP-8W_pill{box-sizing:border-box;border-radius:var(--dsw-radius-md);background:0 0;border:none;align-items:stretch;height:24px;display:inline-flex;overflow:hidden}[data-phase=hero] .KJP-8W_pill,[data-content-phase=hero] .KJP-8W_pill{max-width:min(100% - 44px,560px);position:absolute;bottom:calc(100% + 4px);right:28px}@media (width<=600px){[data-phase=hero] .KJP-8W_row,[data-content-phase=hero] .KJP-8W_row{justify-content:flex-start;height:auto;margin:0;padding:0 20px}[data-phase=hero] .KJP-8W_pill,[data-content-phase=hero] .KJP-8W_pill{max-width:100%;position:static;bottom:auto;right:auto}.KJP-8W_branchMenu{flex:0 auto;min-width:0}.KJP-8W_branch{width:100%}.KJP-8W_seat{flex:none}}@media (width<=600px) and (pointer:coarse){.KJP-8W_pill{height:44px}}.KJP-8W_branch{min-width:0;height:100%;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-strong-13);cursor:pointer;background:0 0;border:none;align-items:center;gap:4px;padding:0 8px;display:inline-flex}.KJP-8W_branch:not(:disabled):hover,.KJP-8W_branch[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}.KJP-8W_branch:disabled{cursor:default;color:var(--dsw-alias-label-caption)}.KJP-8W_branchIcon{flex:none}.KJP-8W_branchLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;max-width:16ch;overflow:hidden}.KJP-8W_chevron{color:var(--dsw-alias-label-tertiary);flex:none}.KJP-8W_divider{background:var(--dsw-alias-border-l2);flex:none;align-self:center;width:1px;height:12px}.KJP-8W_seat{border-radius:var(--dsw-radius-md);height:100%;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-strong-13);white-space:nowrap;cursor:pointer;align-items:center;gap:6px;padding:0 8px;display:inline-flex}.KJP-8W_seat:not(:has(input:disabled)):hover{background:var(--dsw-alias-interactive-bg-hover)}.KJP-8W_seat:has(input:disabled){cursor:default;opacity:.5}.KJP-8W_seat input{width:14px;height:14px;accent-color:var(--dsw-alias-brand-primary);cursor:inherit;flex:none;margin:0}.KJP-8W_seat input:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}.KJP-8W_seatGlyph{color:var(--dsw-alias-label-primary);flex:none;align-items:center;display:inline-flex}.KJP-8W_seatFailed,.KJP-8W_seatFailed .KJP-8W_seatGlyph{color:var(--dsw-alias-state-error-primary)}.KJP-8W_seatIconError{color:var(--dsw-alias-state-error-primary);flex:none;margin-right:6px}.KJP-8W_seatIconWarn{color:var(--dsw-alias-label-secondary);flex:none;margin-right:6px}";
		const tagId$5 = "@guowenzhang/dsh-worktree/WorktreeChip.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$5) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.pluginCss = tagId$5;
			tag.textContent = css$5;
			document.head.appendChild(tag);
		}
		var WorktreeChip_module_css_default = {
			"branch": "KJP-8W_branch",
			"branchIcon": "KJP-8W_branchIcon",
			"branchLabel": "KJP-8W_branchLabel",
			"branchMenu": "KJP-8W_branchMenu",
			"chevron": "KJP-8W_chevron",
			"divider": "KJP-8W_divider",
			"pill": "KJP-8W_pill",
			"row": "KJP-8W_row",
			"seat": "KJP-8W_seat",
			"seatFailed": "KJP-8W_seatFailed",
			"seatGlyph": "KJP-8W_seatGlyph",
			"seatIconError": "KJP-8W_seatIconError",
			"seatIconWarn": "KJP-8W_seatIconWarn"
		};
		//#endregion
		//#region src/client/WorktreeChip.tsx
		/**
		* The worktree control on the new-session screen.
		*
		* One pill holds both facts the choice is made of: the local branch a new
		* branch starts from, and whether the session moves into a new checkout at all.
		* It sits beside the workspace picker and the agent-preset chip on desktop,
		* and on its own row below them on mobile. It follows their geometry — the
		* same ghost row, the same rounded ends — drawn one step smaller and clear
		* of the composer card's corner.
		*
		* A session's working directory is fixed at creation, so this control is
		* available only while the session is blank and the choice cannot be revised
		* afterwards — starting a new session is the way to change it.
		*
		* The worktree half is one-way: checking it creates the checkout and starts the
		* session inside it, and nothing checks it back off. A failed start leaves it
		* unchecked, says so on the segment, keeps the reason in its tooltip, and the
		* next check retries. A start that succeeded with repositories left out says so
		* instead: the checkout is a partial mirror, and that is a fact about the new
		* Session rather than a failure of this one.
		* @module @guowenzhang/dsh-worktree/client/WorktreeChip
		*/
		/**
		* Render the worktree control.
		* @param props - composed slot props.
		* @returns the pill, or null when this Session is not a Git repository or can no longer choose.
		*/
		function WorktreeChip({ session, useWorktreeSeat, useEditable, load, loadBranches, selectBase, setEnabled, t }) {
			const state = useWorktreeSeat((snapshot) => snapshot);
			const editable = useEditable((value) => value);
			const [open, setOpen] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				load(session.sessionId);
			}, [load, session.sessionId]);
			if (!state.visible || !editable) return null;
			const busy = state.creating;
			const locked = state.isolated;
			const failed = state.skipped.length === 0 && state.error !== null && !locked;
			const baseLabel = state.base === "HEAD" ? t("branch.head") : state.base;
			const lockedHint = t("seat.applied", { branch: state.checkoutBranch });
			const skippedHint = state.skipped.length === 0 ? null : t("seat.skipped", {
				count: String(state.skipped.length),
				list: state.skipped.map((entry) => `${entry.relative} (${skipText(entry, t)})`).join(", ")
			});
			const options = state.branches ?? [state.base];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: WorktreeChip_module_css_default.row,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: WorktreeChip_module_css_default.pill,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
							className: WorktreeChip_module_css_default.branchMenu,
							open,
							onClose: () => {
								setOpen(false);
							},
							items: options.map((name) => ({
								id: name,
								label: name
							})),
							selectedId: state.base,
							onSelect: (id) => {
								setOpen(false);
								selectBase(id);
							},
							align: "start",
							portal: true,
							anchor: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: WorktreeChip_module_css_default.branch,
								"aria-haspopup": "menu",
								"aria-expanded": open,
								title: locked ? lockedHint : t("branch.hint"),
								disabled: busy || locked,
								onClick: () => {
									if (!open) loadBranches();
									setOpen((value) => !value);
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutlineRegular, {
										className: WorktreeChip_module_css_default.branchIcon,
										size: 14
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: WorktreeChip_module_css_default.branchLabel,
										children: baseLabel
									}),
									!locked && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, {
										className: WorktreeChip_module_css_default.chevron,
										size: 12
									})
								]
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: WorktreeChip_module_css_default.divider,
							"aria-hidden": "true"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: failed ? `${WorktreeChip_module_css_default.seat} ${WorktreeChip_module_css_default.seatFailed}` : WorktreeChip_module_css_default.seat,
							title: skippedHint ?? (locked ? lockedHint : state.error ?? t("seat.hint")),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: state.enabled || locked,
									disabled: busy || locked,
									onChange: () => {
										setEnabled(true);
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: WorktreeChip_module_css_default.seatGlyph,
									"aria-hidden": "true",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconProjectAddOutlineRegular, { size: 14 })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: busy ? t("seat.creating") : failed ? t("seat.failed") : t("seat.label") })
							]
						}),
						state.skipped.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, {
							className: WorktreeChip_module_css_default.seatIconWarn,
							size: 14
						}),
						failed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, {
							className: WorktreeChip_module_css_default.seatIconError,
							size: 14
						})
					]
				})
			});
		}
		/**
		* State one skipped nested repository in the current locale.
		* @param entry - the skip the Host reported.
		* @param t - this plugin's locale reader.
		* @returns the reason, with Git's own text only where this plugin has no copy.
		*/
		function skipText(entry, t) {
			return entry.code === "no-commits" ? t("seat.skippedNoCommits") : t("seat.skippedCreateFailed", { reason: entry.reason });
		}
		//#endregion
		//#region src/client/checkout-notice-store.ts
		/**
		* Follow the Workspace list and publish one notice per removal the Host made.
		*
		* The baseline is seeded from the first snapshot without reporting anything:
		* there is no predecessor to compare against, and a Client mounts long after
		* the removals an earlier session caused.
		* @param workspaces - the Workspace list to follow.
		* @param probe - asks the Host what happened to a path whose row disappeared.
		* @param notices - the queue the seat renders.
		* @returns a disposer that unsubscribes and suppresses late answers.
		*/
		function observeCheckouts(workspaces, probe, notices) {
			let disposed = false;
			let seq = 0;
			let previous = /* @__PURE__ */ new Map();
			const seed = workspaces.list.getSnapshot();
			for (const item of seed.items) previous.set(item.workspaceId, item);
			const archived = new Set(seed.archivedSessionIds.map(String));
			const unsubscribe = workspaces.list.subscribe(() => {
				if (disposed) return;
				const snapshot = workspaces.list.getSnapshot();
				for (const id of snapshot.archivedSessionIds) archived.add(String(id));
				const rows = new Map(snapshot.items.map((item) => [item.workspaceId, item]));
				const disappeared = [];
				for (const [id, before] of previous) {
					if (rows.has(id)) continue;
					if (before.sessionIds.length === 0) continue;
					if (before.sessionIds.every((session) => archived.has(String(session)))) disappeared.push(before.path);
				}
				previous = rows;
				for (const path of disappeared) probe(path).then((answer) => {
					if (disposed || answer.outcome === "unknown") return;
					seq += 1;
					notices.set([...notices.getSnapshot(), {
						seq,
						path,
						outcome: answer.outcome,
						...answer.reason === void 0 ? {} : { reason: answer.reason }
					}]);
				}).catch(() => {});
			});
			return () => {
				disposed = true;
				unsubscribe();
			};
		}
		//#endregion
		//#region src/client/checkout-notice.tsx
		/**
		* The overlay seat for the archive flow's second notice.
		*
		* One banner per checkout removal the Host performed, rendered in the frame's
		* own floating layer beside the Workspace surface's "Session archived" toast.
		* All the bookkeeping lives in `checkout-notice-store.ts`; this module only
		* renders the head of the queue its observer publishes.
		*
		* Both outcomes get a banner because both are facts the user would otherwise
		* have to infer from a checkout directory that may or may not still be there. A
		* refusal carries the Host's own reason, so "archived but kept" never reads as
		* "archived and cleaned up".
		*
		* @module @guowenzhang/dsh-worktree/client/checkout-notice
		*/
		/**
		* Render the current banner.
		* @param props - the banner queue, the localized copy, and the dismisser.
		* @returns the banner, or null while nothing was removed.
		*/
		function CheckoutNoticeToast({ useNotices, text, dismiss }) {
			const head = useNotices((queue) => queue[0]);
			if (head === void 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
				text: text(head),
				...head.outcome === "removed" ? { tone: "success" } : { icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, {}) },
				onDone: () => {
					dismiss(head.seq);
				}
			}, `worktree-checkout-${String(head.seq)}`);
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* Copy for the worktree surfaces, in the shapes its surfaces render.
		* @module @guowenzhang/dsh-worktree/client/locales
		*/
		/** Dictionary namespace for this plugin's UI copy. */
		const NS = "worktree";
		/** Chinese copy (the package's primary locale). */
		const zh = {
			"seat.label": "worktree",
			"seat.hint": "创建当前工作区的一个独立 Git worktree，并在其中开启这个会话。",
			"seat.creating": "创建中…",
			"seat.failed": "创建失败，点此重试",
			"seat.applied": "已在该 worktree 中运行：{branch}；这个选择不能再改",
			"seat.skipped": "有 {count} 个子仓库没有带过来：{list}",
			"seat.skippedNoCommits": "还没有任何提交，没有可检出的内容",
			"seat.skippedCreateFailed": "创建失败：{reason}",
			"branch.hint": "新分支从哪个本地分支开始",
			"branch.head": "HEAD",
			"settings.nav": "文件备份",
			"settings.title": "文件备份",
			"settings.description": "使用 Worktree 创建独立空间，连接 Git 账号，开始并行工作。",
			"settings.worktree.cardTitle": "Worktree 设置",
			"settings.backup.cardTitle": "自动备份",
			"settings.gitChecking": "正在检查 Git…",
			"settings.gitAvailable": "Git 已就绪",
			"settings.gitMissing": "未找到 Git。请安装 Git，确保 DSH 启动环境的 PATH 包含 Git，然后重启 DSH。",
			"settings.gitFailed": "Git 检查失败",
			"settings.nested.label": "创建子仓库",
			"settings.nested.hint": "创建 worktree 时同步创建子模块和子仓库。",
			"settings.depth.label": "扫描层级",
			"settings.depth.hint": "递归扫描目录层数。",
			"settings.depth.inactive": "递归扫描目录层数（需先开启「创建子仓库」）。",
			"settings.layout.label": "worktree 存储位置",
			"settings.newSession.label": "新会话默认开启 worktree",
			"settings.newSession.hint": "新建会话的空白页自动创建 worktree 并在其中开始，不再询问。",
			"settings.guard.label": "会话文件保护",
			"settings.guard.hint": "AI 改动已存在的文件之前先备份一份，改坏或删除后可以取回。备份随会话归档一起清除。",
			"settings.deny.label": "拦截删除命令",
			"settings.deny.hint": "遇到看起来会删文件的命令时先拒绝，要求 AI 先申报要动的文件。",
			"settings.deny.inactive": "遇到看起来会删文件的命令时先拒绝（需先开启「会话文件保护」）。",
			"settings.backupSidebar.label": "显示变更记录侧边栏",
			"settings.backupSidebar.hint": "在右侧边栏加入「变更记录」页，列出这个会话及其子会话里被改动或删除的文件，可以左右对比、逐个还原。",
			"settings.backupSidebar.inactive": "在右侧边栏加入「变更记录」页（需先开启「会话文件保护」）。",
			"sidebar.title": "变更记录",
			"sidebar.description": "这个会话及其子会话里被改动或删除的文件，可以左右对比、逐个还原。",
			"sidebar.loading": "正在读取变更记录…",
			"sidebar.empty": "这个会话及其子会话还没有变更记录。AI 改动已存在的文件之前会自动备一份，改坏或删除后就能在这里对比和还原。",
			"sidebar.failed": "读取变更记录失败：{message}",
			"sidebar.retry": "重试",
			"sidebar.refresh": "刷新变更记录",
			"sidebar.count": "共 {count} 个文件",
			"sidebar.subsession": "子会话",
			"sidebar.subsessionNamed": "子会话 · {name}",
			"sidebar.subsessionTitle": "子会话 {id}",
			"sidebar.state.modified": "已修改",
			"sidebar.state.deleted": "已删除",
			"sidebar.restore": "还原",
			"sidebar.restoreOne": "还原 {name}",
			"sidebar.restoreOneOwned": "还原 {name}（{owner}）",
			"sidebar.restoring": "还原中…",
			"sidebar.restored": "已还原",
			"sidebar.restoreFailed": "还原失败：{message}",
			"sidebar.copyAt": "备份副本：{path}",
			"sidebar.back": "返回列表",
			"sidebar.openDiff": "查看 {name} 的对比",
			"sidebar.openDiffOwned": "查看 {name}（{owner}）的对比",
			"diff.loading": "正在读取差异…",
			"diff.failed": "读取差异失败：{message}",
			"diff.before": "备份副本 · 改动前",
			"diff.after": "当前文件",
			"diff.binary": "二进制文件（{before} → {after}），无法逐行对比；仍可还原。",
			"diff.oversized": "文件过大（{before} → {after}），无法逐行对比；仍可还原。",
			"diff.unreadable": "当前路径已不是普通文件，无法对比。",
			"diff.deleted": "文件已删除，右侧为空；以下是删除前的内容。",
			"diff.identical": "内容已与备份一致（可能刚还原过）。",
			"diff.truncated": "文件较大，仅显示前 {count} 行。",
			"diff.coarse": "差异过大，按整块替换显示。",
			"diff.gap": "{count} 行未显示（无改动）",
			"diff.stats": "新增 {added} 行，删除 {deleted} 行",
			"diff.size.b": "{value} B",
			"diff.size.kb": "{value} KB",
			"diff.size.mb": "{value} MB",
			"layout.path.agents": "<工作区>/.agents/worktree/<分支>",
			"layout.path.sibling": "<仓库名>-wt-<分支>，建在仓库旁边",
			"layout.path.home": "~/.agents/worktree/<分支>，整机共享",
			"option.agents": "工作区内",
			"option.sibling": "仓库同级",
			"option.home": "用户目录",
			"option.none": "只建父仓库",
			"option.submodules": "带上子模块",
			"option.all": "带上所有子仓库",
			"settings.readOnly": "本部署的设置为只读。",
			"settings.unavailable": "该插件当前未加载，暂时无法配置。",
			"settings.saveFailed": "自动保存失败，修改尚未保存；请调整或重新选择该设置以重试。",
			"settings.invalidNumber": "请输入正整数；空值和无效值不会保存。",
			"checkout.removed": "已归档，worktree 已删除：{path}",
			"checkout.kept": "已归档，但 worktree 保留（{reason}）：{path}",
			"gitAccounts.nav": "Git 账号",
			"gitAccounts.title": "Git 账号",
			"gitAccounts.description": "连接 GitHub、GitLab 或 Gitee，管理本机的 Git 身份与已有授权。",
			"gitAccounts.settings.title": "Git 账号",
			"gitAccounts.settings.description": "连接 GitHub、GitLab 或 Gitee；访问令牌只保存在本机凭据中，SSH 密钥只记录路径。",
			"gitAccounts.settings.openProjects": "在「Git 账号」页查看项目",
			"gitAccounts.loading": "正在读取 Git 账号…",
			"gitAccounts.loadFailed": "读取 Git 账号失败：{message}",
			"gitAccounts.retry": "重试",
			"gitAccounts.refresh": "刷新 Git 账号",
			"gitAccounts.identity.title": "Git 身份",
			"gitAccounts.identity.description": "提交记录使用的全局 user.name 与 user.email；留空保存会清除该项。",
			"gitAccounts.identity.name": "名称（user.name）",
			"gitAccounts.identity.namePlaceholder": "例如 Zhang San",
			"gitAccounts.identity.email": "邮箱（user.email）",
			"gitAccounts.identity.emailPlaceholder": "例如 you@example.com",
			"gitAccounts.identity.save": "保存身份",
			"gitAccounts.identity.saving": "保存中…",
			"gitAccounts.identity.saved": "已保存",
			"gitAccounts.identity.saveFailed": "保存失败：{message}",
			"gitAccounts.identity.unavailable": "无法读取全局 Git 配置，身份暂不可编辑。",
			"gitAccounts.identity.gitMissing": "未找到 Git。请安装 Git，并确保 DSH 启动环境的 PATH 包含 Git。",
			"gitAccounts.identity.gitFailed": "读取全局 Git 配置失败。",
			"gitAccounts.accounts.title": "账号",
			"gitAccounts.accounts.description": "访问令牌只保存在本机凭据中，SSH 账号只记录私钥路径；页面都不会显示机密内容。",
			"gitAccounts.accounts.add": "添加账号",
			"gitAccounts.accounts.scan": "扫描已有授权",
			"gitAccounts.accounts.scanning": "扫描中…",
			"gitAccounts.accounts.list": "已连接的账号",
			"gitAccounts.accounts.empty": "还没有账号。",
			"gitAccounts.accounts.emptyHint": "「添加账号」会先验证访问令牌再保存；「扫描已有授权」会读取环境变量、~/.git-credentials、gh CLI 与 Windows 凭据管理器。",
			"gitAccounts.account.addedAt": "添加于 {date}",
			"gitAccounts.account.origin": "来源：{origin}",
			"gitAccounts.account.viewProjects": "查看项目",
			"gitAccounts.account.viewProjectsOne": "查看 {login} 的项目",
			"gitAccounts.account.remove": "移除",
			"gitAccounts.account.removeOne": "移除账号 {login}",
			"gitAccounts.account.added": "已添加账号 {login}",
			"gitAccounts.account.updated": "已刷新账号 {login} 的令牌",
			"gitAccounts.account.removed": "已移除账号 {login}",
			"gitAccounts.account.addedUnverified": "已保存账号 {login}，但连接验证失败；网络恢复后重新添加同一密钥即可完成验证。",
			"gitAccounts.account.unverifiedHint": "保存时主机不可达，尚未验证；Git 拉取/推送仍可使用这把密钥。",
			"gitAccounts.auth.sshBadge": "SSH",
			"gitAccounts.auth.unverifiedBadge": "未验证",
			"gitAccounts.origin.manual": "手动添加",
			"gitAccounts.origin.credential-manager": "Windows 凭据管理器",
			"gitAccounts.origin.git-credentials": "~/.git-credentials",
			"gitAccounts.origin.gh-cli": "gh CLI",
			"gitAccounts.origin.environment": "环境变量",
			"gitAccounts.origin.ssh-key": "SSH 密钥",
			"gitAccounts.add.title": "添加 Git 账号",
			"gitAccounts.add.description": "用访问令牌或 SSH 密钥验证一个账号；令牌只保存在本机凭据中，SSH 密钥只记录路径。",
			"gitAccounts.add.close": "关闭添加账号对话框",
			"gitAccounts.add.provider": "平台",
			"gitAccounts.add.auth": "认证方式",
			"gitAccounts.add.auth.token": "访问令牌",
			"gitAccounts.add.auth.ssh": "SSH 密钥",
			"gitAccounts.add.host": "主机地址",
			"gitAccounts.add.token": "访问令牌",
			"gitAccounts.add.tokenPlaceholder": "粘贴访问令牌",
			"gitAccounts.add.tokenHint": "令牌至少需要读取用户信息与项目的权限。",
			"gitAccounts.add.tokenLink.github": "在 GitHub 创建令牌",
			"gitAccounts.add.tokenLink.gitlab": "在 GitLab 创建令牌",
			"gitAccounts.add.tokenLink.gitee": "在 Gitee 创建令牌",
			"gitAccounts.add.keyPath": "私钥文件",
			"gitAccounts.add.keyPathPlaceholder": "例如 C:\\Users\\you\\.ssh\\id_ed25519",
			"gitAccounts.add.keys": "本机发现的密钥",
			"gitAccounts.add.keysLoading": "正在查找 SSH 密钥…",
			"gitAccounts.add.keysFailed": "查找密钥失败，可直接填写私钥路径。",
			"gitAccounts.add.keysEmpty": "在 ~/.ssh 下没有发现私钥，可直接填写路径。",
			"gitAccounts.add.keyHint": "SSH 账号可用于 git 拉取与推送，但无法列出项目；需要项目列表时请另加访问令牌账号。加密私钥请先加载到 ssh-agent。",
			"gitAccounts.add.submit": "添加",
			"gitAccounts.add.submitting": "验证中…",
			"gitAccounts.add.cancel": "取消",
			"gitAccounts.add.verify": "验证连接",
			"gitAccounts.add.verifying": "连接中…",
			"gitAccounts.add.verified": "连接成功：{login}（{provider} · {host}）",
			"gitAccounts.add.verifiedVia": "连接成功：{login}（{provider} · {host}，经 {endpoint}）",
			"gitAccounts.add.failed.unauthorized": "令牌被拒绝，请确认令牌有效、未过期且有读取权限。",
			"gitAccounts.add.failed.sshUnauthorized": "主机拒绝了这把 SSH 密钥（publickey），请确认公钥已上传到该账号且私钥与它配对。",
			"gitAccounts.add.failed.network": "无法连接该主机（5 秒超时或网络不可达）。可点「验证连接」重试；SSH 会再尝试 GitHub/GitLab 的 443 端口。",
			"gitAccounts.add.failed": "添加失败：{message}",
			"gitAccounts.remove.title": "移除账号",
			"gitAccounts.remove.description": "从本机凭据中删除 {login}（{host}）的令牌，之后可以重新添加。",
			"gitAccounts.remove.confirm": "移除",
			"gitAccounts.remove.removing": "移除中…",
			"gitAccounts.remove.cancel": "取消",
			"gitAccounts.remove.close": "关闭移除账号对话框",
			"gitAccounts.remove.failed": "移除失败：{message}",
			"gitAccounts.scan.failed": "扫描失败：{message}",
			"gitAccounts.scan.resultAdded": "扫描完成：新增 {count} 个账号（{logins}）",
			"gitAccounts.scan.resultNone": "扫描完成：没有新增账号（更新 {updated} 个，跳过 {skipped} 个）。",
			"gitAccounts.projects.title": "项目",
			"gitAccounts.projects.description": "选择一个账号，查看它能访问的项目；SSH 授权账号无法列出项目。",
			"gitAccounts.projects.accounts": "账号",
			"gitAccounts.projects.emptyNoAccount": "还没有可查询的账号。先在上面添加账号，或扫描本机已有授权。",
			"gitAccounts.projects.choose": "选择一个账号查看项目。",
			"gitAccounts.projects.loading": "正在加载项目…",
			"gitAccounts.projects.failed": "加载项目失败：{message}",
			"gitAccounts.projects.empty": "该账号下没有项目。",
			"gitAccounts.projects.emptyHint": "如果项目属于其他组织或群组，确认令牌有读取它们的权限。",
			"gitAccounts.projects.sshUnavailable": "这个账号使用 SSH 授权，无法通过 API 列出项目。",
			"gitAccounts.projects.sshUnavailableHint": "SSH 密钥只用于 git 的拉取与推送；想在这里看项目，请在同一主机上再添加一个访问令牌账号。",
			"gitAccounts.projects.search": "搜索项目",
			"gitAccounts.projects.searchPlaceholder": "按名称搜索已加载的项目",
			"gitAccounts.projects.count": "共 {count} 个项目",
			"gitAccounts.projects.searchCount": "{shown} / {total} 个项目",
			"gitAccounts.projects.noMatch": "没有匹配的项目。",
			"gitAccounts.projects.loadMore": "加载更多",
			"gitAccounts.projects.loadingMore": "加载中…",
			"gitAccounts.projects.copy": "复制 HTTPS 克隆地址",
			"gitAccounts.projects.copyOne": "复制 {name} 的 HTTPS 克隆地址",
			"gitAccounts.projects.copied": "已复制",
			"gitAccounts.projects.copyFailed": "复制失败",
			"gitAccounts.projects.open": "在浏览器打开",
			"gitAccounts.projects.openOne": "在浏览器中打开 {name}",
			"gitAccounts.projects.branch": "默认分支 {branch}",
			"gitAccounts.projects.updated": "更新于 {date}",
			"gitAccounts.visibility.public": "公开",
			"gitAccounts.visibility.private": "私有",
			"gitAccounts.visibility.internal": "内部",
			"gitAccounts.visibility.unknown": "未知可见性"
		};
		/** English copy. */
		const en = {
			"seat.label": "worktree",
			"seat.hint": "Create an isolated Git worktree of this workspace and start this session inside it.",
			"seat.creating": "Creating…",
			"seat.failed": "Create failed — click to retry",
			"seat.applied": "Running in this worktree: {branch}; the choice can no longer change",
			"seat.skipped": "Left out {count} nested repositories: {list}",
			"seat.skippedNoCommits": "no commits yet, so there is nothing to check out",
			"seat.skippedCreateFailed": "could not be created: {reason}",
			"branch.hint": "Local branch the new branch starts from",
			"branch.head": "HEAD",
			"settings.nav": "File backup",
			"settings.title": "File backup",
			"settings.description": "Create isolated workspaces with Git worktrees, connect Git accounts, and work on tasks in parallel.",
			"settings.worktree.cardTitle": "Worktree settings",
			"settings.backup.cardTitle": "Automatic backup",
			"settings.gitChecking": "Checking Git…",
			"settings.gitAvailable": "Git is ready",
			"settings.gitMissing": "Git was not found. Install Git, add it to the DSH host PATH, then restart DSH.",
			"settings.gitFailed": "Git check failed",
			"settings.nested.label": "Create nested repositories",
			"settings.nested.hint": "Create submodules and nested repositories along with the worktree.",
			"settings.depth.label": "Scan depth",
			"settings.depth.hint": "How many directory levels are searched recursively.",
			"settings.depth.inactive": "How many directory levels are searched recursively (turn on Create nested repositories first).",
			"settings.layout.label": "Worktree location",
			"settings.newSession.label": "Start new sessions in a worktree",
			"settings.newSession.hint": "A new blank session creates its own worktree and starts inside it, without asking.",
			"settings.guard.label": "Session file protection",
			"settings.guard.hint": "Copy a file aside before the AI changes it, so a bad edit or a deletion can be undone. The copies are cleared when the session is archived.",
			"settings.deny.label": "Block delete commands",
			"settings.deny.hint": "Refuse a command that looks like it deletes files, and ask the AI to declare what it will touch first.",
			"settings.deny.inactive": "Refuse a command that looks like it deletes files (turn on Session file protection first).",
			"settings.backupSidebar.label": "Show the change history sidebar",
			"settings.backupSidebar.hint": "Add a Change history page to the right sidebar, listing the files this session and its sub-sessions changed or deleted, each comparable with its backup and restorable on its own.",
			"settings.backupSidebar.inactive": "Add a Change history page to the right sidebar (turn on Session file protection first).",
			"sidebar.title": "Change history",
			"sidebar.description": "The files this session and its sub-sessions changed or deleted; compare each with its backup and restore it.",
			"sidebar.loading": "Reading the change history…",
			"sidebar.empty": "This session and its sub-sessions have no changes recorded yet. A file is copied aside before the AI changes it, so a bad edit or a deletion can be compared and restored here.",
			"sidebar.failed": "Could not read the change history: {message}",
			"sidebar.retry": "Retry",
			"sidebar.refresh": "Refresh the change history",
			"sidebar.count": "{count} files",
			"sidebar.subsession": "Sub-session",
			"sidebar.subsessionNamed": "Sub-session · {name}",
			"sidebar.subsessionTitle": "Sub-session {id}",
			"sidebar.state.modified": "Modified",
			"sidebar.state.deleted": "Deleted",
			"sidebar.restore": "Restore",
			"sidebar.restoreOne": "Restore {name}",
			"sidebar.restoreOneOwned": "Restore {name} ({owner})",
			"sidebar.restoring": "Restoring…",
			"sidebar.restored": "Restored",
			"sidebar.restoreFailed": "Restore failed: {message}",
			"sidebar.copyAt": "Backup copy: {path}",
			"sidebar.back": "Back to the list",
			"sidebar.openDiff": "Compare {name} with its backup",
			"sidebar.openDiffOwned": "Compare {name} ({owner}) with its backup",
			"diff.loading": "Reading the comparison…",
			"diff.failed": "Could not read the comparison: {message}",
			"diff.before": "Backup copy · before",
			"diff.after": "Current file",
			"diff.binary": "Binary file ({before} → {after}); it cannot be compared line by line. Restore is still available.",
			"diff.oversized": "File too large ({before} → {after}); it cannot be compared line by line. Restore is still available.",
			"diff.unreadable": "The path is no longer a regular file, so it cannot be compared.",
			"diff.deleted": "The file is deleted — the right side is empty. This is its content before the deletion.",
			"diff.identical": "The content matches the backup (it may have just been restored).",
			"diff.truncated": "The file is large; only the first {count} rows are shown.",
			"diff.coarse": "The difference was too large to align; it is shown as one replaced block.",
			"diff.gap": "{count} unchanged rows hidden",
			"diff.stats": "{added} lines added, {deleted} lines deleted",
			"diff.size.b": "{value} B",
			"diff.size.kb": "{value} KB",
			"diff.size.mb": "{value} MB",
			"layout.path.agents": "<workspace>/.agents/worktree/<branch>",
			"layout.path.sibling": "<repo>-wt-<branch>, beside the repository",
			"layout.path.home": "~/.agents/worktree/<branch>, shared by the machine",
			"option.agents": "In the workspace",
			"option.sibling": "Beside the repository",
			"option.home": "User directory",
			"option.none": "Parent only",
			"option.submodules": "With submodules",
			"option.all": "With every nested repository",
			"settings.readOnly": "This deployment stores settings read-only.",
			"settings.unavailable": "This plugin is not loaded, so it cannot be configured right now.",
			"settings.saveFailed": "Automatic saving failed; changes are not saved. Edit or select the setting again to retry.",
			"settings.invalidNumber": "Enter a positive integer; empty or invalid values are not saved.",
			"checkout.removed": "Archived, and the worktree was deleted: {path}",
			"checkout.kept": "Archived, but the worktree was kept ({reason}): {path}",
			"gitAccounts.nav": "Git accounts",
			"gitAccounts.title": "Git accounts",
			"gitAccounts.description": "Connect GitHub, GitLab, or Gitee; manage this machine's Git identity and existing authorizations.",
			"gitAccounts.settings.title": "Git accounts",
			"gitAccounts.settings.description": "Connect GitHub, GitLab, or Gitee; access tokens stay in this machine's credential store and SSH keys are recorded by path only.",
			"gitAccounts.settings.openProjects": "View projects on the Git accounts page",
			"gitAccounts.loading": "Reading Git accounts…",
			"gitAccounts.loadFailed": "Could not read Git accounts: {message}",
			"gitAccounts.retry": "Retry",
			"gitAccounts.refresh": "Refresh Git accounts",
			"gitAccounts.identity.title": "Git identity",
			"gitAccounts.identity.description": "The global user.name and user.email used in commits; saving an empty field clears that key.",
			"gitAccounts.identity.name": "Name (user.name)",
			"gitAccounts.identity.namePlaceholder": "e.g. Jane Doe",
			"gitAccounts.identity.email": "Email (user.email)",
			"gitAccounts.identity.emailPlaceholder": "e.g. you@example.com",
			"gitAccounts.identity.save": "Save identity",
			"gitAccounts.identity.saving": "Saving…",
			"gitAccounts.identity.saved": "Saved",
			"gitAccounts.identity.saveFailed": "Could not save: {message}",
			"gitAccounts.identity.unavailable": "Git's global configuration cannot be read, so the identity cannot be edited right now.",
			"gitAccounts.identity.gitMissing": "Git was not found. Install Git, and make sure the DSH host PATH includes it.",
			"gitAccounts.identity.gitFailed": "Reading the global Git configuration failed.",
			"gitAccounts.accounts.title": "Accounts",
			"gitAccounts.accounts.description": "Access tokens stay in this machine's credentials and SSH accounts record only the key path; the page never shows either secret.",
			"gitAccounts.accounts.add": "Add account",
			"gitAccounts.accounts.scan": "Scan existing authorizations",
			"gitAccounts.accounts.scanning": "Scanning…",
			"gitAccounts.accounts.list": "Connected accounts",
			"gitAccounts.accounts.empty": "No accounts yet.",
			"gitAccounts.accounts.emptyHint": "\"Add account\" verifies an access token before storing it; \"Scan existing authorizations\" reads environment variables, ~/.git-credentials, the gh CLI, and Windows Credential Manager.",
			"gitAccounts.account.addedAt": "Added {date}",
			"gitAccounts.account.origin": "Source: {origin}",
			"gitAccounts.account.viewProjects": "View projects",
			"gitAccounts.account.viewProjectsOne": "View the projects of {login}",
			"gitAccounts.account.remove": "Remove",
			"gitAccounts.account.removeOne": "Remove the account {login}",
			"gitAccounts.account.added": "Added the account {login}",
			"gitAccounts.account.updated": "Refreshed the token of {login}",
			"gitAccounts.account.removed": "Removed the account {login}",
			"gitAccounts.account.addedUnverified": "Saved the account {login}, but the connection test failed; add the same key again once the network is back to finish verifying it.",
			"gitAccounts.account.unverifiedHint": "Saved while the host was unreachable, so it is not verified yet; Git fetch/push can still use this key.",
			"gitAccounts.auth.sshBadge": "SSH",
			"gitAccounts.auth.unverifiedBadge": "Not verified",
			"gitAccounts.origin.manual": "Added manually",
			"gitAccounts.origin.credential-manager": "Windows Credential Manager",
			"gitAccounts.origin.git-credentials": "~/.git-credentials",
			"gitAccounts.origin.gh-cli": "gh CLI",
			"gitAccounts.origin.environment": "Environment variables",
			"gitAccounts.origin.ssh-key": "SSH keys",
			"gitAccounts.add.title": "Add a Git account",
			"gitAccounts.add.description": "Verify an account with an access token or an SSH key; tokens stay in this machine's credentials and keys are recorded by path only.",
			"gitAccounts.add.close": "Close the add-account dialog",
			"gitAccounts.add.provider": "Provider",
			"gitAccounts.add.auth": "Authentication",
			"gitAccounts.add.auth.token": "Access token",
			"gitAccounts.add.auth.ssh": "SSH key",
			"gitAccounts.add.host": "Host",
			"gitAccounts.add.token": "Access token",
			"gitAccounts.add.tokenPlaceholder": "Paste the access token",
			"gitAccounts.add.tokenHint": "The token needs permission to read your profile and projects.",
			"gitAccounts.add.tokenLink.github": "Create a token on GitHub",
			"gitAccounts.add.tokenLink.gitlab": "Create a token on GitLab",
			"gitAccounts.add.tokenLink.gitee": "Create a token on Gitee",
			"gitAccounts.add.keyPath": "Private key file",
			"gitAccounts.add.keyPathPlaceholder": "e.g. ~/.ssh/id_ed25519",
			"gitAccounts.add.keys": "Keys found on this machine",
			"gitAccounts.add.keysLoading": "Looking for SSH keys…",
			"gitAccounts.add.keysFailed": "Could not list keys; type the private key path instead.",
			"gitAccounts.add.keysEmpty": "No private keys found under ~/.ssh; type the path instead.",
			"gitAccounts.add.keyHint": "An SSH account works for Git fetch and push but cannot list projects; add an access-token account for project lists. Load an encrypted key into ssh-agent first.",
			"gitAccounts.add.submit": "Add",
			"gitAccounts.add.submitting": "Verifying…",
			"gitAccounts.add.cancel": "Cancel",
			"gitAccounts.add.verify": "Test connection",
			"gitAccounts.add.verifying": "Connecting…",
			"gitAccounts.add.verified": "Connected: {login} ({provider} · {host})",
			"gitAccounts.add.verifiedVia": "Connected: {login} ({provider} · {host}, via {endpoint})",
			"gitAccounts.add.failed.unauthorized": "The token was rejected. Check that it is valid, unexpired, and allowed to read.",
			"gitAccounts.add.failed.sshUnauthorized": "The host refused this SSH key (publickey). Check that its public key is uploaded to the account and pairs with this private key.",
			"gitAccounts.add.failed.network": "Could not reach the host (5-second timeout or unreachable network). Try \"Test connection\"; for SSH, GitHub/GitLab are also tried on port 443.",
			"gitAccounts.add.failed": "Could not add the account: {message}",
			"gitAccounts.remove.title": "Remove account",
			"gitAccounts.remove.description": "Delete the stored token of {login} ({host}) from this machine's credentials. You can add the account again later.",
			"gitAccounts.remove.confirm": "Remove",
			"gitAccounts.remove.removing": "Removing…",
			"gitAccounts.remove.cancel": "Cancel",
			"gitAccounts.remove.close": "Close the remove-account dialog",
			"gitAccounts.remove.failed": "Could not remove: {message}",
			"gitAccounts.scan.failed": "Scan failed: {message}",
			"gitAccounts.scan.resultAdded": "Scan finished: {count} new account(s) — {logins}",
			"gitAccounts.scan.resultNone": "Scan finished: no new accounts ({updated} updated, {skipped} skipped).",
			"gitAccounts.projects.title": "Projects",
			"gitAccounts.projects.description": "Pick an account to see the projects it can reach; an SSH-authorized account cannot list projects.",
			"gitAccounts.projects.accounts": "Accounts",
			"gitAccounts.projects.emptyNoAccount": "No accounts to query yet. Add one above, or scan this machine's existing authorizations.",
			"gitAccounts.projects.choose": "Select an account to view its projects.",
			"gitAccounts.projects.loading": "Loading projects…",
			"gitAccounts.projects.failed": "Could not load projects: {message}",
			"gitAccounts.projects.empty": "This account has no projects.",
			"gitAccounts.projects.emptyHint": "If the projects belong to other organizations or groups, check that the token may read them.",
			"gitAccounts.projects.sshUnavailable": "This account signs in over SSH, so it cannot list projects through the API.",
			"gitAccounts.projects.sshUnavailableHint": "SSH keys only authorize Git fetch and push. Add an access-token account for the same host to browse projects here.",
			"gitAccounts.projects.search": "Search projects",
			"gitAccounts.projects.searchPlaceholder": "Search loaded projects by name",
			"gitAccounts.projects.count": "{count} projects",
			"gitAccounts.projects.searchCount": "{shown} of {total} projects",
			"gitAccounts.projects.noMatch": "No project matches.",
			"gitAccounts.projects.loadMore": "Load more",
			"gitAccounts.projects.loadingMore": "Loading…",
			"gitAccounts.projects.copy": "Copy HTTPS clone URL",
			"gitAccounts.projects.copyOne": "Copy the HTTPS clone URL of {name}",
			"gitAccounts.projects.copied": "Copied",
			"gitAccounts.projects.copyFailed": "Copy failed",
			"gitAccounts.projects.open": "Open in browser",
			"gitAccounts.projects.openOne": "Open {name} in the browser",
			"gitAccounts.projects.branch": "Default branch {branch}",
			"gitAccounts.projects.updated": "Updated {date}",
			"gitAccounts.visibility.public": "Public",
			"gitAccounts.visibility.private": "Private",
			"gitAccounts.visibility.internal": "Internal",
			"gitAccounts.visibility.unknown": "Unknown visibility"
		};
		/**
		* The text that names the session a listed copy belongs to.
		*
		* A copy taken by a delegated child says so and names that child; a copy the
		* page's own session took has no chip at all (the caller checks `depth`).
		* @param owner - the listed copy's owning-session facts.
		* @param t - this plugin's locale reader.
		* @returns the localized owner label.
		*/
		function subsessionLabel(owner, t) {
			return owner.sessionLabel === void 0 ? t("sidebar.subsession") : t("sidebar.subsessionNamed", { name: owner.sessionLabel });
		}
		/**
		* The shared settings form's frame copy, read from this plugin's dictionary.
		* @param t - this plugin's locale reader.
		* @returns the labels the settings form renders.
		*/
		function formLabels(t) {
			return {
				unavailable: t("settings.unavailable"),
				readOnly: t("settings.readOnly"),
				saveFailed: t("settings.saveFailed")
			};
		}
		//#endregion
		//#region src/client/diff-columns.ts
		/**
		* Turn the Host's rows into the two aligned columns.
		* @param rows - the comparison's rows, in file order.
		* @returns the columns; both lists have the same length.
		*/
		function toColumns(rows) {
			const left = [];
			const right = [];
			for (const row of rows) switch (row.kind) {
				case "context":
					left.push({
						kind: "context",
						no: row.left.no,
						text: row.left.text
					});
					right.push({
						kind: "context",
						no: row.right.no,
						text: row.right.text
					});
					break;
				case "change":
					left.push(row.left === void 0 ? { kind: "empty" } : {
						kind: "deleted",
						no: row.left.no,
						text: row.left.text
					});
					right.push(row.right === void 0 ? { kind: "empty" } : {
						kind: "added",
						no: row.right.no,
						text: row.right.text
					});
					break;
				case "gap":
					left.push({
						kind: "gap",
						hidden: row.hidden
					});
					right.push({ kind: "gap" });
			}
			return {
				left,
				right
			};
		}
		/**
		* The row index of the first change, which is what the detail view scrolls to.
		* @param rows - the comparison's rows.
		* @returns the index, or -1 when nothing changed.
		*/
		function firstChangeRow(rows) {
			return rows.findIndex((row) => row.kind === "change");
		}
		//#endregion
		//#region \0dsh-css:C:\02-codespace\DeepSeek\dsh-worktree\src\client\BackupDetail.module.css.mjs
		const css$4 = ".wx391a_page{height:100%;min-height:0;color:var(--dsw-alias-label-primary);flex-direction:column;flex:auto;display:flex}.wx391a_header{box-sizing:border-box;border-bottom:.5px solid var(--dsw-alias-border-l3);flex:none;align-items:center;gap:4px;height:38px;padding:0 8px;display:flex}.wx391a_title{white-space:nowrap;text-overflow:ellipsis;min-width:0;font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-primary);flex:auto;overflow:hidden}.wx391a_session{white-space:nowrap;text-overflow:ellipsis;max-width:40%;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);flex:0 auto;overflow:hidden}.wx391a_restore{flex:none}.wx391a_columnHeaders{border-bottom:.5px solid var(--dsw-alias-border-l2);flex:none;display:flex}.wx391a_columnHeaders>span{box-sizing:border-box;white-space:nowrap;text-overflow:ellipsis;min-width:0;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);flex:50%;padding:4px 10px;overflow:hidden}.wx391a_columnHeaders>span+span{border-left:.5px solid var(--dsw-alias-border-l3)}.wx391a_columns{flex:auto;min-height:0;display:flex}.wx391a_pane{scrollbar-gutter:stable;min-width:0;font:var(--dsw-font-markdown-code-block);outline:none;flex:50%;position:relative;overflow:auto}.wx391a_pane+.wx391a_pane{border-left:.5px solid var(--dsw-alias-border-l3)}.wx391a_pane:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}.wx391a_rows{width:max-content;min-width:100%}.wx391a_row{box-sizing:border-box;background:var(--dsw-alias-bg-base);white-space:pre;min-height:1lh;display:flex}.wx391a_row[data-cell=deleted]{background:var(--dsw-alias-code-diff-deleted)}.wx391a_row[data-cell=added]{background:var(--dsw-alias-code-diff-added)}.wx391a_row[data-cell=empty]{background:var(--dsw-alias-bg-layer-1)}.wx391a_row[data-cell=gap]{background:var(--dsw-alias-bg-layer-2)}.wx391a_no{text-align:right;min-width:4ch;color:var(--dsw-alias-label-tertiary);background:inherit;user-select:none;flex:none;padding:0 8px 0 10px;position:sticky;left:0}.wx391a_text{color:var(--dsw-alias-label-primary);flex:none;padding:0 22px 0 6px}.wx391a_gap{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);padding:0 10px;line-height:1lh;display:block}.wx391a_note{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);flex:none;margin:0;padding:8px 12px 0}.wx391a_failed{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;flex:none;margin:0;padding:8px 12px}.wx391a_notice{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;flex:none;margin:0;padding:12px}";
		const tagId$4 = "@guowenzhang/dsh-worktree/BackupDetail.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$4) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.pluginCss = tagId$4;
			tag.textContent = css$4;
			document.head.appendChild(tag);
		}
		var BackupDetail_module_css_default = {
			"columnHeaders": "wx391a_columnHeaders",
			"columns": "wx391a_columns",
			"failed": "wx391a_failed",
			"gap": "wx391a_gap",
			"header": "wx391a_header",
			"no": "wx391a_no",
			"note": "wx391a_note",
			"notice": "wx391a_notice",
			"page": "wx391a_page",
			"pane": "wx391a_pane",
			"restore": "wx391a_restore",
			"row": "wx391a_row",
			"rows": "wx391a_rows",
			"session": "wx391a_session",
			"text": "wx391a_text",
			"title": "wx391a_title"
		};
		//#endregion
		//#region src/client/BackupDetail.tsx
		/**
		* One protected file's two-column comparison: the copy from before the session
		* changed the file on the left, the file as it is now on the right.
		*
		* The two panes draw the same rows and scroll vertically together, so a changed
		* line always sits opposite the line it replaced. Horizontal scrolling stays
		* per pane: the sides can have different line lengths, and tying them together
		* would make a long line on one side hide content on the other. Each pane is its
		* own scroll container with fixed-height rows, which is what keeps the columns
		* aligned without measuring anything.
		*
		* The comparison is read once when this view opens (and again after a restore or
		* an explicit refresh); the page owns the list, this view owns only one file.
		* @module @guowenzhang/dsh-worktree/client/BackupDetail
		*/
		/**
		* Render one copy's comparison.
		* @param props - see {@link BackupDetailProps}.
		* @returns the page body.
		*/
		function BackupDetail({ entry, revision, onBack, onRestored, compare, restore, t }) {
			const [state, setState] = (0, react.useState)({ status: "loading" });
			const [attempt, setAttempt] = (0, react.useState)(0);
			const [outcome, setOutcome] = (0, react.useState)({ kind: "idle" });
			const alive = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				alive.current = true;
				return () => {
					alive.current = false;
				};
			}, []);
			(0, react.useEffect)(() => {
				let active = true;
				setState({ status: "loading" });
				compare(entry.sessionId, entry.relative).then((result) => {
					if (!active) return;
					setState(result.ok ? {
						status: "ready",
						value: result.value
					} : {
						status: "failed",
						message: result.message
					});
				});
				return () => {
					active = false;
				};
			}, [
				compare,
				entry.sessionId,
				entry.relative,
				revision,
				attempt
			]);
			const onRestore = (0, react.useCallback)(() => {
				setOutcome({ kind: "restoring" });
				restore(entry.sessionId, entry.relative).then((result) => {
					if (!alive.current) return;
					if (result.ok) {
						setOutcome({ kind: "restored" });
						onRestored();
					} else setOutcome({
						kind: "failed",
						message: result.message
					});
				});
			}, [
				entry.sessionId,
				entry.relative,
				onRestored,
				restore
			]);
			const restoreLabel = outcome.kind === "restoring" ? t("sidebar.restoring") : outcome.kind === "restored" ? t("sidebar.restored") : t("sidebar.restore");
			const owner = entry.depth > 0 ? subsessionLabel(entry, t) : void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: BackupDetail_module_css_default.page,
				"data-backup-detail": entry.relative,
				"data-backup-session": entry.sessionId,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: BackupDetail_module_css_default.header,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "ghost",
								size: "sm",
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronLeftOutlineRegular, {}),
								"aria-label": t("sidebar.back"),
								title: t("sidebar.back"),
								onClick: onBack
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: BackupDetail_module_css_default.title,
								title: entry.name,
								children: entry.name
							}),
							owner === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: BackupDetail_module_css_default.session,
								title: t("sidebar.subsessionTitle", { id: entry.sessionId }),
								children: owner
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "outline",
								size: "sm",
								className: BackupDetail_module_css_default.restore,
								disabled: outcome.kind === "restoring" || outcome.kind === "restored",
								"aria-label": owner === void 0 ? t("sidebar.restoreOne", { name: entry.name }) : t("sidebar.restoreOneOwned", {
									name: entry.name,
									owner
								}),
								onClick: onRestore,
								children: restoreLabel
							})
						]
					}),
					outcome.kind === "failed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: BackupDetail_module_css_default.failed,
						role: "status",
						children: t("sidebar.restoreFailed", { message: outcome.message })
					}) : null,
					state.status === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: BackupDetail_module_css_default.notice,
						role: "status",
						children: t("diff.loading")
					}) : null,
					state.status === "failed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: BackupDetail_module_css_default.notice,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: BackupDetail_module_css_default.failed,
							children: t("diff.failed", { message: state.message })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							size: "sm",
							onClick: () => {
								setAttempt((value) => value + 1);
							},
							children: t("sidebar.retry")
						})]
					}) : null,
					state.status === "ready" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ComparisonView, {
						value: state.value,
						t
					}) : null
				]
			});
		}
		/**
		* Render one comparison's body: the notes that explain its shape, then the two
		* panes when there is line content to draw.
		* @param props.value - the comparison.
		* @param props.t - this plugin's copy.
		* @returns the body.
		*/
		function ComparisonView({ value, t }) {
			const comparison = value.kind === "text" ? value.comparison : void 0;
			const rows = comparison?.rows ?? [];
			const columns = (0, react.useMemo)(() => toColumns(rows), [rows]);
			const firstChange = (0, react.useMemo)(() => firstChangeRow(rows), [rows]);
			if (value.kind !== "text") {
				const message = value.kind === "unreadable" ? t("diff.unreadable") : t(value.kind === "binary" ? "diff.binary" : "diff.oversized", {
					before: sizeText(value.beforeBytes, t),
					after: sizeText(value.afterBytes, t)
				});
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: BackupDetail_module_css_default.notice,
					role: "status",
					children: message
				});
			}
			if (comparison === void 0 || rows.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [value.state === "deleted" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: BackupDetail_module_css_default.note,
				children: t("diff.deleted")
			}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: BackupDetail_module_css_default.notice,
				role: "status",
				children: t("diff.identical")
			})] });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				value.state === "deleted" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: BackupDetail_module_css_default.note,
					children: t("diff.deleted")
				}) : null,
				comparison.truncated ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: BackupDetail_module_css_default.note,
					role: "status",
					children: t("diff.truncated", { count: String(rows.length) })
				}) : null,
				comparison.coarse ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: BackupDetail_module_css_default.note,
					role: "status",
					children: t("diff.coarse")
				}) : null,
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SplitComparison, {
					columns,
					firstChange,
					t
				})
			] });
		}
		/**
		* Draw the two aligned panes and keep their vertical scrolls in step.
		* @param props.columns - the two columns.
		* @param props.firstChange - row index the panes scroll to when they open.
		* @param props.t - this plugin's copy.
		* @returns the panes.
		*/
		function SplitComparison({ columns, firstChange, t }) {
			const leftPane = (0, react.useRef)(null);
			const rightPane = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const pane = leftPane.current;
				if (pane === null || firstChange < 0) return;
				const target = pane.querySelector(`[data-row="${firstChange}"]`);
				if (target === null) return;
				pane.scrollTop = Math.max(0, target.offsetTop - Math.round(pane.clientHeight / 2));
				if (rightPane.current !== null) rightPane.current.scrollTop = pane.scrollTop;
			}, [columns, firstChange]);
			const mirror = (from) => () => {
				const source = from === "left" ? leftPane.current : rightPane.current;
				const target = from === "left" ? rightPane.current : leftPane.current;
				if (source === null || target === null) return;
				if (target.scrollTop !== source.scrollTop) target.scrollTop = source.scrollTop;
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: BackupDetail_module_css_default.columnHeaders,
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("diff.before") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("diff.after") })]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: BackupDetail_module_css_default.columns,
				"data-backup-columns": "",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Pane, {
					side: "left",
					cells: columns.left,
					paneRef: leftPane,
					onScroll: mirror("left"),
					label: t("diff.before"),
					t
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Pane, {
					side: "right",
					cells: columns.right,
					paneRef: rightPane,
					onScroll: mirror("right"),
					label: t("diff.after"),
					t
				})]
			})] });
		}
		/**
		* One scrollable column.
		* @param props.side - which side this is, for test hooks and the sync direction.
		* @param props.cells - the column's cells.
		* @param props.paneRef - the scroll container, shared with the sibling pane.
		* @param props.onScroll - keeps the peer's vertical offset equal.
		* @param props.label - the column's accessible name.
		* @param props.t - this plugin's copy.
		* @returns the pane.
		*/
		function Pane({ side, cells, paneRef, onScroll, label, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: BackupDetail_module_css_default.pane,
				ref: paneRef,
				onScroll,
				tabIndex: 0,
				role: "region",
				"aria-label": label,
				"data-diff-side": side,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: BackupDetail_module_css_default.rows,
					children: cells.map((cell, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Cell, {
						cell,
						index,
						t
					}, index))
				})
			});
		}
		/**
		* One row of one column.
		* @param props.cell - what the cell draws.
		* @param props.index - the row's index, so the open scroll can find a change.
		* @param props.t - this plugin's copy.
		* @returns the row.
		*/
		function Cell({ cell, index, t }) {
			if (cell.kind === "empty") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: BackupDetail_module_css_default.row,
				"data-row": index,
				"data-cell": "empty",
				"aria-hidden": "true"
			});
			if (cell.kind === "gap") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: BackupDetail_module_css_default.row,
				"data-row": index,
				"data-cell": "gap",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: BackupDetail_module_css_default.gap,
					children: cell.hidden === void 0 ? "⋯" : t("diff.gap", { count: String(cell.hidden) })
				})
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: BackupDetail_module_css_default.row,
				"data-row": index,
				"data-cell": cell.kind,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: BackupDetail_module_css_default.no,
					children: cell.no ?? ""
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: BackupDetail_module_css_default.text,
					children: cell.text ?? ""
				})]
			});
		}
		/**
		* Format one side's byte size for the not-readable notes.
		* @param bytes - the side's size.
		* @param t - this plugin's copy.
		* @returns the localized size.
		*/
		function sizeText(bytes, t) {
			if (bytes >= 1048576) return t("diff.size.mb", { value: (bytes / 1048576).toFixed(1) });
			if (bytes >= 1024) return t("diff.size.kb", { value: (bytes / 1024).toFixed(1) });
			return t("diff.size.b", { value: String(bytes) });
		}
		//#endregion
		//#region \0dsh-css:C:\02-codespace\DeepSeek\dsh-worktree\src\client\BackupPanel.module.css.mjs
		const css$3 = ".HXi-lW_page{height:100%;min-height:0;color:var(--dsw-alias-label-primary);flex-direction:column;flex:auto;display:flex}.HXi-lW_toolbar{box-sizing:border-box;border-bottom:.5px solid var(--dsw-alias-border-l3);flex:none;align-items:center;gap:4px;height:38px;padding:0 8px 0 16px;display:flex}.HXi-lW_count{white-space:nowrap;text-overflow:ellipsis;min-width:0;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);flex:auto;overflow:hidden}.HXi-lW_list{scrollbar-gutter:stable;flex:auto;min-height:0;margin:0 2px 0 0;padding:8px;list-style:none;overflow:auto}.HXi-lW_list::-webkit-scrollbar-track{margin:2px}.HXi-lW_row{box-sizing:border-box;border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:8px 10px;display:flex}.HXi-lW_list>.HXi-lW_row:last-child{border-bottom:0}.HXi-lW_open{min-width:0;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;flex-direction:column;flex:auto;align-items:flex-start;gap:4px;margin:0;padding:0;display:flex}.HXi-lW_open:hover .HXi-lW_name{text-decoration:underline}.HXi-lW_open:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px;border-radius:var(--dsw-radius-xs)}.HXi-lW_name{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}.HXi-lW_name s{text-decoration-line:line-through}.HXi-lW_subsession{white-space:nowrap;text-overflow:ellipsis;max-width:100%;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);overflow:hidden}.HXi-lW_failed{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;margin:0}.HXi-lW_notice{flex-direction:column;flex:none;align-items:flex-start;gap:8px;padding:12px 16px;display:flex}.HXi-lW_empty{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;margin:0;padding:16px}.HXi-lW_skeleton{border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-bg-skeleton);width:60%;height:14px;display:block}@media (pointer:coarse){.HXi-lW_row,.HXi-lW_action{min-height:44px}}";
		const tagId$3 = "@guowenzhang/dsh-worktree/BackupPanel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$3) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.pluginCss = tagId$3;
			tag.textContent = css$3;
			document.head.appendChild(tag);
		}
		var BackupPanel_module_css_default = {
			"action": "HXi-lW_action",
			"count": "HXi-lW_count",
			"empty": "HXi-lW_empty",
			"failed": "HXi-lW_failed",
			"list": "HXi-lW_list",
			"name": "HXi-lW_name",
			"notice": "HXi-lW_notice",
			"open": "HXi-lW_open",
			"page": "HXi-lW_page",
			"row": "HXi-lW_row",
			"skeleton": "HXi-lW_skeleton",
			"subsession": "HXi-lW_subsession",
			"toolbar": "HXi-lW_toolbar"
		};
		//#endregion
		//#region src/client/BackupPanel.tsx
		/**
		* The change-history page's body: one row per file this session's guard copied
		* before changing it, the control that puts one copy back, and the two-column
		* comparison opened from a row.
		*
		* The list is flat on purpose. The copies mirror the workspace's own tree, but
		* the question this page answers is "which files changed", and a reader
		* scanning for the file the AI just broke goes by name — so the row carries the
		* path that identifies it and nothing nests. That also keeps a restore's meaning
		* obvious: one row, one file, one button.
		*
		* The page covers the session and the delegated children whose work belongs to
		* it, because a teammate's edits are the session's changes from the reader's
		* point of view. A row a child took says so and names it, and its restore sends
		* the child's own session back; the page's own rows carry no such mark.
		*
		* Opening a row replaces the list with that file's comparison and a way back:
		* two columns need width, and the pane the list lives in has more of it to give
		* a single comparison than a row can spare.
		*
		* Nothing here subscribes to anything. The list is read when the page mounts
		* and when the reader refreshes it, and a restore's outcome is this body's own
		* state, because no other surface shows it: the row keeps saying "restored"
		* until the next read, instead of vanishing the moment the copy lands, which
		* would leave the click that just succeeded looking like it did nothing.
		* @module @guowenzhang/dsh-worktree/client/BackupPanel
		*/
		/** Rows drawn while the first read is in flight. */
		const SKELETON_ROWS$1 = 3;
		/**
		* One row's identity: the copy plus the session it belongs to.
		*
		* A page that lists a session and its delegated children can report the same
		* relative path twice — the parent's copy and a child's copy are different
		* states of the same file — so the path alone cannot key a row's own outcome.
		* @param entry - one listed copy.
		* @returns the session-qualified key.
		*/
		function entryKey(entry) {
			return `${entry.sessionId}:${entry.relative}`;
		}
		/**
		* Render the file-backup page.
		* @param props - the seat's runtime shares, this plugin's copy, and the data face.
		* @returns the page.
		*/
		function BackupPanel({ useTabInfo, sessionId, list, restore, compare, t }) {
			const { tab } = useTabInfo();
			const [state, setState] = (0, react.useState)({
				status: "loading",
				entries: []
			});
			const [rows, setRows] = (0, react.useState)({});
			const [revision, setRevision] = (0, react.useState)(0);
			const [selected, setSelected] = (0, react.useState)(void 0);
			const [detailRevision, setDetailRevision] = (0, react.useState)(0);
			const alive = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				alive.current = true;
			}, []);
			(0, react.useEffect)(() => () => {
				alive.current = false;
			}, []);
			const reload = (0, react.useCallback)(() => {
				setRevision((value) => value + 1);
			}, []);
			(0, react.useEffect)(() => {
				let active = true;
				setState((current) => ({
					...current,
					status: "loading"
				}));
				list(sessionId).then((result) => {
					if (!active) return;
					setState(result.ok ? {
						status: "ready",
						entries: result.value.entries
					} : {
						status: "failed",
						entries: [],
						message: result.message
					});
				});
				return () => {
					active = false;
				};
			}, [
				list,
				sessionId,
				revision
			]);
			const refresh = (0, react.useCallback)(() => {
				if (selected === void 0) setRevision((value) => value + 1);
				else setDetailRevision((value) => value + 1);
			}, [selected]);
			(0, react.useEffect)(() => tab.actions.bindCommands({ refresh }), [tab.actions, refresh]);
			const onRestore = (entry) => {
				setRows((current) => ({
					...current,
					[entryKey(entry)]: { kind: "restoring" }
				}));
				restore(entry.sessionId, entry.relative).then((result) => {
					if (!alive.current) return;
					const next = result.ok ? { kind: "restored" } : {
						kind: "failed",
						message: result.message
					};
					setRows((current) => ({
						...current,
						[entryKey(entry)]: next
					}));
				});
			};
			const onOpen = (entry) => {
				setDetailRevision((value) => value + 1);
				setSelected(entry);
			};
			if (selected !== void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BackupDetail, {
				entry: selected,
				revision: detailRevision,
				onBack: () => {
					setSelected(void 0);
				},
				onRestored: () => {
					setRows((current) => ({
						...current,
						[entryKey(selected)]: { kind: "restored" }
					}));
					setDetailRevision((value) => value + 1);
				},
				compare,
				restore,
				t
			});
			const busy = state.status === "loading";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: BackupPanel_module_css_default.page,
				"data-backup-page": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: BackupPanel_module_css_default.toolbar,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: BackupPanel_module_css_default.count,
							role: "status",
							"data-backup-count": state.entries.length,
							children: busy && state.entries.length === 0 ? t("sidebar.loading") : t("sidebar.count", { count: String(state.entries.length) })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "ghost",
							size: "sm",
							icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, {}),
							"aria-label": t("sidebar.refresh"),
							title: t("sidebar.refresh"),
							disabled: busy,
							onClick: reload
						})]
					}),
					state.status === "failed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: BackupPanel_module_css_default.notice,
						role: "status",
						"data-backup-state": "failed",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: BackupPanel_module_css_default.failed,
							children: t("sidebar.failed", { message: state.message ?? "" })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							size: "sm",
							className: BackupPanel_module_css_default.action,
							onClick: reload,
							children: t("sidebar.retry")
						})]
					}) : null,
					state.entries.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: BackupPanel_module_css_default.list,
						"data-backup-state": "ready",
						"aria-busy": busy,
						children: state.entries.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row$1, {
							entry,
							row: rows[entryKey(entry)],
							onRestore,
							onOpen,
							t
						}, entryKey(entry)))
					}) : state.status === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: BackupPanel_module_css_default.list,
						"data-backup-state": "loading",
						"aria-hidden": "true",
						children: Array.from({ length: SKELETON_ROWS$1 }, (_, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
							className: BackupPanel_module_css_default.row,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: BackupPanel_module_css_default.skeleton })
						}, index))
					}) : state.status === "ready" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: BackupPanel_module_css_default.empty,
						"data-backup-state": "empty",
						children: t("sidebar.empty")
					}) : null
				]
			});
		}
		/**
		* One file's row: what it is, whose copy it is, how it differs, and the
		* controls that open its comparison or put its copy back.
		* @param props - the entry, the row's own outcome, the row actions, and copy.
		* @returns the row.
		*/
		function Row$1({ entry, row, onRestore, onOpen, t }) {
			const label = row?.kind === "restoring" ? t("sidebar.restoring") : row?.kind === "restored" ? t("sidebar.restored") : t("sidebar.restore");
			const owner = entry.depth > 0 ? subsessionLabel(entry, t) : void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: BackupPanel_module_css_default.row,
				"data-backup-row": entry.relative,
				"data-backup-session": entry.sessionId,
				"data-backup-file": entry.state,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: BackupPanel_module_css_default.open,
					"aria-label": owner === void 0 ? t("sidebar.openDiff", { name: entry.name }) : t("sidebar.openDiffOwned", {
						name: entry.name,
						owner
					}),
					title: t("sidebar.copyAt", { path: entry.backup }),
					onClick: () => {
						onOpen(entry);
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: BackupPanel_module_css_default.name,
							children: entry.state === "deleted" && row?.kind !== "restored" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("s", {
								"aria-label": `${entry.name} (${t("sidebar.state.deleted")})`,
								children: entry.name
							}) : entry.name
						}),
						owner === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: BackupPanel_module_css_default.subsession,
							title: t("sidebar.subsessionTitle", { id: entry.sessionId }),
							children: owner
						}),
						row?.kind === "failed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: BackupPanel_module_css_default.failed,
							children: t("sidebar.restoreFailed", { message: row.message })
						}) : null
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					size: "sm",
					className: BackupPanel_module_css_default.action,
					disabled: row?.kind === "restoring" || row?.kind === "restored",
					"aria-label": owner === void 0 ? t("sidebar.restoreOne", { name: entry.name }) : t("sidebar.restoreOneOwned", {
						name: entry.name,
						owner
					}),
					onClick: () => {
						onRestore(entry);
					},
					children: label
				})]
			});
		}
		//#endregion
		//#region src/client/api.ts
		/** The route prefix both halves agree on. */
		const ROUTE$1 = "/worktree/api";
		/**
		* Call one method of the worktree route.
		* @param method - route method name.
		* @param body - JSON request body.
		* @returns the parsed value, or the Host's refusal text.
		*/
		async function request(method, body) {
			let response;
			try {
				response = await fetch(`${ROUTE$1}/${method}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body)
				});
			} catch (error) {
				return {
					ok: false,
					message: `the worktree route is unreachable: ${error instanceof Error ? error.message : String(error)}`
				};
			}
			const text = await response.text();
			let parsed;
			try {
				parsed = JSON.parse(text);
			} catch (error) {
				return {
					ok: false,
					message: `the worktree route answered ${response.status} with a non-JSON body`
				};
			}
			if (!response.ok) {
				const message = readErrorMessage$1(parsed) ?? `the worktree route answered ${response.status}`;
				const code = readErrorCode$1(parsed);
				return {
					ok: false,
					message,
					...code === void 0 ? {} : { code }
				};
			}
			return {
				ok: true,
				value: parsed
			};
		}
		/**
		* Read the error text out of a refusal body.
		* @param parsed - the decoded response body.
		* @returns the message, or undefined when the body carries none.
		*/
		function readErrorMessage$1(parsed) {
			if (parsed === null || typeof parsed !== "object") return void 0;
			const error = parsed.error;
			if (error === null || typeof error !== "object") return void 0;
			const message = error.message;
			return typeof message === "string" && message.length > 0 ? message : void 0;
		}
		/** Read a machine-readable error code, when the Host supplied one. */
		function readErrorCode$1(parsed) {
			if (parsed === null || typeof parsed !== "object") return void 0;
			const error = parsed.error;
			if (error === null || typeof error !== "object") return void 0;
			const code = error.code;
			return typeof code === "string" ? code : void 0;
		}
		//#endregion
		//#region src/client/seat-store.ts
		/**
		* Worktree seat state, browser half.
		*
		* One staged boolean and one staged base branch for the Session currently on
		* the new-session screen. The choice decides where that session's workspace IS,
		* and a session's header cwd is fixed when it is created, so the seat is only
		* reachable while the session is blank and the choice is spent by the first
		* start.
		*
		* The store owns no session: starting one calls the Host route, which creates
		* the checkout, registers its project, and starts the session in it as one
		* operation.
		* @module @guowenzhang/dsh-worktree/client/seat-store
		*/
		/** The base a new branch starts from when the probe names no local branch. */
		const HEAD = "HEAD";
		const INITIAL = {
			visible: false,
			enabled: false,
			creating: false,
			base: HEAD,
			branches: null,
			started: null,
			checkoutBranch: "",
			isolated: false,
			error: null,
			skipped: []
		};
		/**
		* Owns the staged choice for the session currently on the new-session screen.
		*/
		var WorktreeSeatController = class {
			/** Snapshot the renderer subscribes to. */
			store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)(INITIAL);
			/** Only the newest probe may publish, so a late reply cannot revive a stale answer. */
			probeGeneration = 0;
			/**
			* Sessions this seat already spent on its own, keyed by session id.
			*
			* Per Session rather than per directory: returning to a blank Session the
			* deployment already answered must not answer it a second time, and a refusal
			* the Host reported is a result for that Session, not something to retry.
			*/
			autoStarted = /* @__PURE__ */ new Set();
			/** The directory the newest probe resolved; the staged choice applies to it. */
			probedCwd;
			/**
			* The base this seat created a checkout from, keyed by that checkout's path.
			*
			* A checkout the seat made can report what it was made from for as long as
			* this page lives; every other checkout reports only the branch it holds.
			*/
			created;
			/** The directory the staged choice applies to, for the start action to consume. */
			cwd() {
				return this.probedCwd;
			}
			/**
			* Probe what this control may offer for a Session's directory.
			*
			* The probe's checkout listing answers three questions at once: whether the
			* directory is a repository this control can act on, which branch its own
			* checkout holds, and whether that checkout is the repository's main one. A
			* Session already inside a linked checkout is isolated by a choice that was
			* made for it, so the control reports that choice and refuses changes — the
			* alternative is a checkout nested inside a checkout, one click after arriving.
			* @param cwd - the Session's working directory, when it has one.
			* @returns once the snapshot reflects the probe.
			*/
			async load(cwd) {
				const generation = ++this.probeGeneration;
				this.probedCwd = cwd;
				if (cwd === void 0) {
					this.set({
						visible: false,
						base: HEAD,
						branches: null
					});
					return;
				}
				const result = await request("list", { cwd });
				if (generation !== this.probeGeneration) return;
				if (!result.ok) {
					this.set({
						visible: false,
						base: HEAD,
						branches: null
					});
					return;
				}
				const checkout = checkoutAt(cwd, result.value.worktrees);
				const isolated = checkout !== void 0 && !checkout.main;
				const created = this.created;
				const fromSeat = isolated && created !== void 0 && checkout !== void 0 && pathKey(created.path) === pathKey(checkout.path);
				this.set({
					visible: true,
					isolated,
					checkoutBranch: checkout?.branch ?? "",
					base: fromSeat ? created.base : checkout?.branch ?? HEAD
				});
			}
			/**
			* Forget a Session this seat already created a checkout for.
			*
			* Called when the screen moves to another Session: that Session's own arrival
			* must not be blocked by the previous one's start.
			*/
			resetStart() {
				this.set({
					started: null,
					skipped: []
				});
			}
			/**
			* Read the local branches the base can be picked from.
			*
			* The read happens when the menu opens rather than with the probe: the probe
			* re-runs on every catalog change, and a branch list is only wanted at the
			* moment someone is choosing from it.
			* @returns once the snapshot holds the branches, or an empty list when the read failed.
			*/
			async loadBranches() {
				const cwd = this.probedCwd;
				if (cwd === void 0) return;
				const result = await request("branches", { cwd });
				if (cwd !== this.probedCwd) return;
				this.set({ branches: result.ok ? result.value.branches : [] });
			}
			/**
			* Stage the local branch a new branch starts from.
			* @param base - the chosen local branch name.
			*/
			selectBase(base) {
				this.set({ base });
			}
			/**
			* Stage whether the session starts inside a new worktree.
			* @param enabled - the new staged value.
			*/
			setEnabled(enabled) {
				this.set({
					enabled,
					error: null,
					skipped: []
				});
			}
			/**
			* Spend the seat when the deployment asks for a checkout without a click.
			*
			* The probe must have answered first: a seat that is not offered has no
			* repository to create a checkout in, and one already inside a checkout holds
			* a choice that can no longer change. A Session this seat already spent — or
			* already tried to spend — is left alone, so a refusal stays on the control
			* instead of becoming a retry on every catalog change.
			* @param sessionId - the Session on screen.
			* @param enabledByDefault - the live policy asking for the checkout.
			* @returns true when the caller should spend the seat by starting it.
			*/
			autoStart(sessionId, enabledByDefault) {
				if (!enabledByDefault) return false;
				if (this.autoStarted.has(sessionId)) return false;
				const state = this.store.getSnapshot();
				if (!state.visible || state.isolated || state.started !== null || state.creating) return false;
				this.autoStarted.add(sessionId);
				this.set({
					enabled: true,
					error: null,
					skipped: []
				});
				return true;
			}
			/**
			* Start the session inside a new worktree, then hand the started session to
			* the caller so it can be opened.
			*
			* This consumes the staged choice: the session it starts has its directory, so
			* the choice has no further meaning and is cleared whether the start succeeds
			* or fails. A start that created a Session but could not show it keeps that
			* Session on the seat, so the next attempt shows it instead of creating a
			* second checkout; a start the Host refused created nothing and leaves the
			* control able to try again.
			* @param open - shows the started session by id.
			* @returns the started session id, or undefined when the start failed.
			*/
			async start(open) {
				const state = this.store.getSnapshot();
				if (state.creating) return void 0;
				if (state.started !== null) {
					await this.open(state.started, open);
					return state.started;
				}
				const cwd = this.probedCwd;
				if (cwd === void 0) {
					this.set({ error: "no working directory is selected" });
					return;
				}
				this.set({
					creating: true,
					error: null
				});
				const result = await request("start", {
					cwd,
					base: state.base
				});
				if (!result.ok) {
					this.set({
						creating: false,
						enabled: false,
						error: result.message,
						skipped: []
					});
					return;
				}
				const sessionId = result.value.sessionId;
				this.created = {
					path: result.value.worktree.path,
					base: state.base
				};
				this.set({
					creating: false,
					enabled: false,
					started: sessionId,
					error: null,
					skipped: result.value.worktree.nestedSkipped ?? []
				});
				await this.open(sessionId, open);
				return sessionId;
			}
			/**
			* Show one started Session, reporting a refusal on the seat.
			* @param sessionId - the Session to show.
			* @param open - shows the started session by id.
			*/
			async open(sessionId, open) {
				try {
					await open(sessionId);
					this.set({ error: null });
				} catch (error) {
					this.set({ error: error instanceof Error ? error.message : String(error) });
				}
			}
			set(patch) {
				this.store.set({
					...this.store.getSnapshot(),
					...patch
				});
			}
		};
		/**
		* The checkout containing one directory.
		*
		* The probe lists every checkout of the repository, so the directory's own
		* checkout is the longest listed root that contains it; a directory inside the
		* main checkout therefore names the main checkout rather than a sibling
		* worktree whose path merely shares its prefix. Windows and macOS report one
		* directory under either case, and Git reports `/` where Node reports `\`, so
		* both spellings compare equal.
		* @param directory - the Session's working directory.
		* @param worktrees - the repository's checkouts, as the route listed them.
		* @returns the containing checkout, or undefined when none contains the directory.
		*/
		function checkoutAt(directory, worktrees) {
			const target = pathKey(directory);
			let found;
			for (const entry of worktrees) {
				const root = pathKey(entry.path);
				if (target !== root && !target.startsWith(`${root}/`)) continue;
				if (found === void 0 || root.length > pathKey(found.path).length) found = entry;
			}
			return found;
		}
		/**
		* Compare one path spelling against another.
		* @param path - a path from Git or from a Session header.
		* @returns the separator-normalized, case-folded form.
		*/
		function pathKey(path) {
			return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
		}
		//#endregion
		//#region src/client/draft-transfer.ts
		/**
		* Stage one semantic snapshot, degrading to plain text where the host's
		* `setDraft` takes only text.
		*
		* The published `SessionInput.setDraft` contract is plain text; the semantic
		* draft form is what the same implementation accepts on hosts whose composer
		* carries reference chips across sessions (0.2.1+). Older hosts (0.2.0-rc.x)
		* throw on the object, so the carry probes once per move: an empty semantic
		* draft is a no-op where the form is supported and throws before touching
		* state where it is not, and the degraded form rides the clipboard projection
		* — the same carry the Host's own workspace switch performs on those hosts.
		* A failing chip restoration is not a capability answer and still reaches the
		* caller's rollback.
		* @param next - the target Session's input face.
		* @param snapshot - the semantic draft to stage.
		*/
		function stageSnapshot(next, snapshot) {
			try {
				next.setDraft({
					text: "",
					references: []
				});
			} catch (_error) {
				next.setDraft(snapshot.text);
				return;
			}
			next.setDraft(snapshot);
		}
		/**
		* Show a started Session, carrying the current draft onto it first.
		*
		* Both Sessions are retained for the whole move: the Client disposes a
		* Session's input shell — and with it every draft attachment — as soon as its
		* last reference goes, and navigation releases the one the user is leaving.
		* @param ctx - the scope the Client services resolve on.
		* @param sessions - the Client Sessions service.
		* @param sourceId - the Session whose draft is carried.
		* @param targetId - the Session the draft is carried to.
		* @param open - shows the target Session; a throw leaves the source untouched.
		* @throws when the draft cannot be staged on the target; the caller reports it.
		*/
		function openWithDraft(ctx, sessions, sourceId, targetId, open) {
			if (sourceId === targetId) {
				open();
				return;
			}
			const conversation = ctx.get("conversation");
			if (conversation === void 0) throw new Error("worktree: the conversation service is unavailable, so the draft cannot be carried over");
			const source = sessions.retain(sourceId, { source: "worktreeDraftTransfer" });
			try {
				const from = conversation.input.for(source.binding.ctx);
				const draft = from.state.getSnapshot();
				if (draft.phase === "adjudicating" || draft.phase === "submitting") throw new Error("worktree: wait for the current submission to finish before switching sessions");
				if (draft.draft === "" && draft.attachmentIds.length === 0) {
					open();
					return;
				}
				const target = sessions.retain(targetId, { source: "worktreeDraftTransfer" });
				try {
					const next = conversation.input.for(target.binding.ctx);
					const existing = next.state.getSnapshot();
					if (existing.draft !== "" || existing.attachmentIds.length > 0 || existing.phase === "adjudicating" || existing.phase === "submitting") throw new Error("worktree: the worktree session already holds a draft, so nothing was moved");
					if (draft.attachmentIds.length > 0 && conversation.rebindDraftFiles === void 0) throw new Error("worktree: this host cannot carry draft attachments across sessions");
					const rebindFiles = (sessionId) => {
						conversation.rebindDraftFiles(sessionId, draft.attachmentIds);
					};
					try {
						stageSnapshot(next, {
							text: draft.draft,
							references: draft.occurrences.map(({ occurrenceId: _id, ...reference }) => reference)
						});
						if (draft.attachmentIds.length > 0) {
							if (!next.addAttachments(draft.attachmentIds)) throw new Error("worktree: the worktree session refused the draft attachments");
							rebindFiles(targetId);
						}
						open();
					} catch (error) {
						next.setDraft("");
						for (const id of draft.attachmentIds) next.removeAttachment(id);
						if (draft.attachmentIds.length > 0) rebindFiles(sourceId);
						throw error;
					}
					from.setDraft("");
					for (const id of draft.attachmentIds) from.removeAttachment(id);
				} finally {
					target.release();
				}
			} finally {
				source.release();
			}
		}
		//#endregion
		//#region src/policy.ts
		/**
		* The values both halves of this plugin agree on.
		*
		* The Host validates the policy in its Config schema and the browser renders
		* the same values as pickers, so the two must agree on more than a type name.
		* Nothing here imports anything: that is what lets the browser bundle use it
		* without pulling a Node module into the page.
		* @module @guowenzhang/dsh-worktree/policy
		*/
		/**
		* Settings namespace the worktree page edits: the profile entry's id, which is
		* also the key the Host serves that entry's live form under.
		*/
		const SETTINGS_NAMESPACE = "worktree";
		/** Which repositories hanging off a checkout come with it. */
		const NESTED_REPOSITORY_POLICIES = [
			"none",
			"submodules",
			"all"
		];
		/** Where a checkout created without an explicit path goes. */
		const WORKTREE_LAYOUTS = [
			"agents",
			"sibling",
			"home"
		];
		//#endregion
		//#region src/git-accounts/types.ts
		/**
		* The Git-accounts capability's shared vocabulary.
		*
		* Both halves of the plugin compile against this file: the Host builds account
		* summaries, project pages, and scan outcomes, and the browser renders them.
		* Nothing here imports anything — no Node module and no browser module — because
		* the page bundle must be able to read it without pulling a Host dependency in,
		* and the Host must not depend on the page's api client. The wire types are
		* deliberately narrower than the Host's stored record: a token has no field here,
		* so no route, injected face, or component can carry one by accident.
		*
		* The capability answers four questions for one operator:
		* - which Git hosts this machine can already push to (accounts),
		* - what the operator's Git identity is (name and email in global config),
		* - which of the operator's own projects each account can list,
		* - and what a scan of this machine's existing authorizations found.
		* @module @guowenzhang/dsh-worktree/git-accounts/types
		*/
		/** The three hosts this capability speaks to. */
		const GIT_PROVIDERS = [
			"github",
			"gitlab",
			"gitee"
		];
		/**
		* Each provider's public host, used as the form's placeholder and the value a
		* scan assumes when a stored credential names no host. A self-hosted GitLab or
		* GitHub Enterprise instance replaces the host and keeps the provider.
		*/
		const DEFAULT_PROVIDER_HOSTS = {
			github: "github.com",
			gitlab: "gitlab.com",
			gitee: "gitee.com"
		};
		/** How an account proves itself to its host. */
		const GIT_AUTH_METHODS = ["token", "ssh"];
		/** Machine-readable failure classes both halves agree on. */
		const GIT_ACCOUNTS_ERROR_CODES = [
			"invalid_input",
			"unauthorized",
			"forbidden",
			"not_found",
			"rate_limited",
			"network",
			"provider_unavailable",
			"credentials_unavailable",
			"account_not_found",
			"ssh_no_api",
			"git_missing",
			"git_failed",
			"scan_unsupported"
		];
		//#endregion
		//#region src/client/git-accounts/presentation.ts
		/**
		* Presentation vocabulary for the Git-accounts page: the dictionary keys its
		* machine codes map to, the brand names that stay untranslated, and the two
		* pieces of derived text the page forms itself (a token-creation address and a
		* formatted date).
		*
		* The mappings are total over the unions the page renders, so a new origin or
		* visibility in `src/git-accounts/types.ts` is a compile error here until the
		* page can name it. Nothing in this module reads the DOM or the Host.
		* @module @guowenzhang/dsh-worktree/client/git-accounts/presentation
		*/
		/**
		* The brands the three host families are named by. A brand is a proper noun, so
		* it stays as written in every locale; only the sentences around it translate.
		*/
		const PROVIDER_BRANDS = {
			github: "GitHub",
			gitlab: "GitLab",
			gitee: "Gitee"
		};
		/** Dictionary key naming one account origin. */
		const ORIGIN_KEYS = {
			manual: "gitAccounts.origin.manual",
			"credential-manager": "gitAccounts.origin.credential-manager",
			"git-credentials": "gitAccounts.origin.git-credentials",
			"gh-cli": "gitAccounts.origin.gh-cli",
			environment: "gitAccounts.origin.environment",
			"ssh-key": "gitAccounts.origin.ssh-key"
		};
		/** Dictionary key naming one project visibility. */
		const VISIBILITY_KEYS = {
			public: "gitAccounts.visibility.public",
			private: "gitAccounts.visibility.private",
			internal: "gitAccounts.visibility.internal",
			unknown: "gitAccounts.visibility.unknown"
		};
		/**
		* Turn a scan report into the one line a toast carries.
		*
		* A scan's useful answer is which accounts it added; the counts of updates and
		* skips matter only when nothing was added. The Host still returns the detailed
		* report (sources, notes, skipped rows), but this page renders a normal action
		* notification instead of a result card.
		* @param report - the scan's report.
		* @param t - the copy reader.
		* @returns the toast text.
		*/
		function scanResultText(report, t) {
			const added = report.added.map((account) => account.login);
			if (added.length > 0) return t("gitAccounts.scan.resultAdded", {
				count: String(added.length),
				logins: added.join("、")
			});
			return t("gitAccounts.scan.resultNone", {
				updated: String(report.updated.length),
				skipped: String(report.skipped.length)
			});
		}
		/**
		* The page on which one host creates a personal access token.
		*
		* GitLab serves token settings under the entered host, so a self-hosted instance
		* keeps its own address; GitHub and Gitee are named here by the two hosts whose
		* token pages this capability was written against.
		* @param provider - the host family the dialog is adding.
		* @param host - the address typed into the dialog, possibly empty.
		* @returns the absolute token-creation URL to link to.
		*/
		function tokenCreationUrl(provider, host) {
			const hostname = host.trim() === "" ? DEFAULT_PROVIDER_HOSTS[provider] : host.trim();
			switch (provider) {
				case "gitlab": return `https://${hostname}/-/user_settings/personal_access_tokens`;
				case "github": return "https://github.com/settings/tokens";
				case "gitee": return "https://gitee.com/profile/personal_access_tokens";
			}
		}
		/** The date format the account and project rows share. */
		const DATE_FORMAT = new Intl.DateTimeFormat(void 0, {
			year: "numeric",
			month: "short",
			day: "numeric"
		});
		/**
		* Format one ISO timestamp the way the page dates rows.
		*
		* A timestamp the Host reported but the browser cannot parse is shown as it
		* arrived: an unreadable date is still the Host's own answer, and replacing it
		* with a placeholder would hide that the value exists.
		* @param value - ISO 8601 timestamp from the Host.
		* @returns the locale-formatted date, or the original text when unparseable.
		*/
		function formatDate(value) {
			const date = new Date(value);
			return Number.isNaN(date.getTime()) ? value : DATE_FORMAT.format(date);
		}
		//#endregion
		//#region \0dsh-css:C:\02-codespace\DeepSeek\dsh-worktree\src\client\git-accounts\GitAccountsPage.module.css.mjs
		const css$2 = ".hIrmhG_page{box-sizing:border-box;width:100%;min-width:0;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);flex-direction:column;flex:auto;display:flex;overflow:hidden auto}.hIrmhG_content{box-sizing:border-box;width:100%;max-width:calc(960px + 2*clamp(24px,4vw,48px));margin:0 auto;padding:28px clamp(24px,4vw,48px) 48px;container:hIrmhG_git-accounts-page/inline-size}.hIrmhG_heading{justify-content:space-between;align-items:flex-start;gap:16px;margin:0 0 24px;display:flex}.hIrmhG_headingText{flex-direction:column;gap:4px;min-width:0;display:flex}.hIrmhG_title{font:var(--dsw-font-l-20);margin:0}.hIrmhG_description{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;margin:0}.hIrmhG_headingActions{flex:none;align-items:center;gap:8px;display:inline-flex}.hIrmhG_errorBanner{border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-bg-layer-1);flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;margin:0 0 16px;padding:12px 16px;display:flex}.hIrmhG_errorText{font:var(--dsw-font-xs-13);color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;margin:0}.hIrmhG_loadingCard{border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-bg-layer-1);flex-direction:column;gap:12px;padding:20px;display:flex}.hIrmhG_skeletonLine{border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-bg-skeleton);width:60%;height:14px;display:block}.hIrmhG_skeletonLineShort{width:35%}.hIrmhG_card{border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-bg-layer-1);flex-direction:column;gap:16px;margin:0 0 16px;padding:20px;display:flex}.hIrmhG_cardHead{justify-content:space-between;align-items:flex-start;gap:16px;display:flex}.hIrmhG_cardText{flex-direction:column;gap:4px;min-width:0;display:flex}.hIrmhG_cardTitle{font:var(--dsw-font-s-strong-14);margin:0}.hIrmhG_cardDescription{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;margin:0}.hIrmhG_cardActions{flex:none;align-items:center;gap:8px;display:inline-flex}.hIrmhG_warning{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;margin:0;padding:8px 12px}.hIrmhG_form{flex-wrap:wrap;align-items:flex-end;gap:12px 16px;display:flex}.hIrmhG_field{flex-direction:column;flex:240px;gap:6px;min-width:0;display:flex}.hIrmhG_fieldLabel{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary)}.hIrmhG_input{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-base);width:100%;height:36px;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14);padding:0 12px}.hIrmhG_input:disabled{opacity:.5;cursor:default}.hIrmhG_formActions{align-items:center;gap:12px;margin-left:auto;display:inline-flex}.hIrmhG_feedback{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-success-primary);overflow-wrap:anywhere}.hIrmhG_feedbackFailed{color:var(--dsw-alias-state-error-primary)}.hIrmhG_accountList{flex-direction:column;gap:10px;margin:0;padding:0;list-style:none;display:flex}.hIrmhG_accountRow{border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);transition:background-color var(--ds-transition-duration-fast) var(--ds-ease-in-out), border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out);justify-content:space-between;align-items:center;gap:16px;margin:0;padding:12px 14px;display:flex}.hIrmhG_accountRow:hover{background:var(--dsw-alias-interactive-bg-hover)}.hIrmhG_accountRowSelected{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-hover)}.hIrmhG_accountMain{flex-direction:column;flex:auto;gap:2px;min-width:0;display:flex}.hIrmhG_accountTitleRow{flex-wrap:wrap;align-items:center;gap:8px;min-width:0;display:flex}.hIrmhG_accountLogin{font:var(--dsw-font-s-strong-14);overflow-wrap:anywhere}.hIrmhG_accountTag{flex:none}.hIrmhG_accountHost{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}.hIrmhG_accountSub{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;margin:0}.hIrmhG_accountMeta{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;margin:0}.hIrmhG_accountActions{flex:none;align-items:center;gap:8px;display:inline-flex}.hIrmhG_dangerAction{color:var(--dsw-alias-state-error-primary)}.hIrmhG_empty{flex-direction:column;align-items:flex-start;gap:6px;padding:8px;display:flex}.hIrmhG_emptyText{font:var(--dsw-font-s-14);color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;margin:0}.hIrmhG_emptyHint{max-width:72ch;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;margin:0}.hIrmhG_addDialog{width:min(480px,100%)}.hIrmhG_removeDialog{width:min(440px,100%)}.hIrmhG_addForm{flex-direction:column;gap:14px;display:flex}.hIrmhG_addField{flex-direction:column;gap:8px;display:flex}.hIrmhG_tokenHint,.hIrmhG_keyHint{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;margin:0}.hIrmhG_keyOptions{flex-wrap:wrap;align-items:center;gap:6px;display:flex}.hIrmhG_keyOption{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);height:28px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);cursor:pointer;transition:border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out), color var(--ds-transition-duration-fast) var(--ds-ease-in-out);align-items:center;padding:0 10px;display:inline-flex}.hIrmhG_keyOption:hover:not(:disabled){border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary)}.hIrmhG_keyOption:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}.hIrmhG_keyOption:disabled{opacity:.5;cursor:default}@media (prefers-reduced-motion:reduce){.hIrmhG_keyOption{transition:none}}.hIrmhG_hintLink{color:var(--dsw-alias-link);text-decoration:none}.hIrmhG_hintLink:hover{text-decoration:underline}.hIrmhG_hintLink:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px;border-radius:var(--dsw-radius-xs)}.hIrmhG_dialogActions{justify-content:flex-end;gap:8px;display:flex}.hIrmhG_verifyAction{margin-right:auto}.hIrmhG_verifyOk{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-success-primary);overflow-wrap:anywhere;margin:0}.hIrmhG_inlineError{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;margin:0}.hIrmhG_inlineErrorRow{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;display:flex}.hIrmhG_confirmDanger:not(:disabled){border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}.hIrmhG_confirmDanger:hover:not(:disabled){background:var(--dsw-alias-interactive-hover-danger)}.hIrmhG_projectAccount{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);flex:none}.hIrmhG_chips{flex-wrap:wrap;gap:8px;display:flex}.hIrmhG_chip{border:.5px solid var(--dsw-alias-border-l4);corner-shape:round;height:28px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);white-space:nowrap;cursor:pointer;transition:background-color var(--ds-transition-duration-fast) var(--ds-ease-in-out), border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out);background:0 0;border-radius:999px;align-items:center;gap:6px;margin:0;padding:0 10px;display:inline-flex}.hIrmhG_chip:hover{background:var(--dsw-alias-interactive-bg-hover)}.hIrmhG_chip[aria-pressed=true]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary)}.hIrmhG_chipBrand{color:var(--dsw-alias-label-tertiary)}.hIrmhG_chipLogin{color:inherit}.hIrmhG_projects{flex-direction:column;gap:12px;display:flex}.hIrmhG_searchRow{align-items:center;gap:12px;display:flex}.hIrmhG_search{flex:auto;min-width:0}.hIrmhG_count{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);flex:none}.hIrmhG_skeletonList{flex-direction:column;gap:10px;display:flex}.hIrmhG_skeletonRow{border-bottom:.5px solid var(--dsw-alias-border-l2);flex-direction:column;gap:8px;padding:12px 8px;display:flex}.hIrmhG_skeletonBar{border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-bg-skeleton);width:100%;height:12px;display:block}.hIrmhG_skeletonBarShort{width:55%}.hIrmhG_projectList{flex-direction:column;margin:0;padding:0;list-style:none;display:flex}.hIrmhG_projectRow{border-bottom:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);transition:background-color var(--ds-transition-duration-fast) var(--ds-ease-in-out);justify-content:space-between;align-items:flex-start;gap:16px;margin:0 -8px;padding:12px 8px;display:flex}.hIrmhG_projectList>.hIrmhG_projectRow:last-child{border-bottom:0}.hIrmhG_projectRow:hover{background:var(--dsw-alias-interactive-bg-hover)}.hIrmhG_projectMain{flex-direction:column;flex:auto;gap:4px;min-width:0;display:flex}.hIrmhG_projectHead{flex-wrap:wrap;align-items:center;gap:8px;min-width:0;display:flex}.hIrmhG_projectPath{min-width:0;font:var(--dsw-font-s-14);overflow-wrap:anywhere}.hIrmhG_projectNamespace{color:var(--dsw-alias-label-tertiary)}.hIrmhG_projectName{font:var(--dsw-font-s-strong-14);color:var(--dsw-alias-label-primary)}.hIrmhG_projectDescription{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;margin:0}.hIrmhG_projectMeta{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);flex-wrap:wrap;gap:4px 12px;display:flex}.hIrmhG_projectActions{flex:none;align-items:center;gap:8px;display:flex}.hIrmhG_copyButton{flex:none}.hIrmhG_copyFailed{color:var(--dsw-alias-state-error-primary)}.hIrmhG_openLink{border-radius:var(--dsw-radius-sm);height:28px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);align-items:center;gap:4px;padding:0 10px;text-decoration:none;display:inline-flex}.hIrmhG_openLink:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.hIrmhG_loadMoreRow{justify-content:center;display:flex}.hIrmhG_noMatch{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-tertiary);margin:0;padding:12px 8px}.hIrmhG_page :focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}@container hIrmhG_git-accounts-page (width<=640px){.hIrmhG_heading,.hIrmhG_cardHead{flex-wrap:wrap}.hIrmhG_cardActions{justify-content:flex-start}.hIrmhG_accountRow,.hIrmhG_projectRow{flex-direction:column;align-items:stretch}.hIrmhG_accountActions,.hIrmhG_projectActions{justify-content:flex-start}.hIrmhG_form{flex-direction:column;align-items:stretch}.hIrmhG_field{flex:none}.hIrmhG_formActions{justify-content:flex-start;margin-left:0}.hIrmhG_searchRow{flex-wrap:wrap}.hIrmhG_count{width:100%}}@media (pointer:coarse){.hIrmhG_accountRow,.hIrmhG_projectRow,.hIrmhG_chip,.hIrmhG_openLink,.hIrmhG_copyButton{min-height:44px}.hIrmhG_input{height:44px;font:var(--dsw-font-base-16)}}@media (prefers-reduced-motion:reduce){.hIrmhG_accountRow,.hIrmhG_projectRow,.hIrmhG_chip{transition:none}}";
		const tagId$2 = "@guowenzhang/dsh-worktree/GitAccountsPage.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$2) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.pluginCss = tagId$2;
			tag.textContent = css$2;
			document.head.appendChild(tag);
		}
		var GitAccountsPage_module_css_default = {
			"accountActions": "hIrmhG_accountActions",
			"accountHost": "hIrmhG_accountHost",
			"accountList": "hIrmhG_accountList",
			"accountLogin": "hIrmhG_accountLogin",
			"accountMain": "hIrmhG_accountMain",
			"accountMeta": "hIrmhG_accountMeta",
			"accountRow": "hIrmhG_accountRow",
			"accountRowSelected": "hIrmhG_accountRowSelected",
			"accountSub": "hIrmhG_accountSub",
			"accountTag": "hIrmhG_accountTag",
			"accountTitleRow": "hIrmhG_accountTitleRow",
			"addDialog": "hIrmhG_addDialog",
			"addField": "hIrmhG_addField",
			"addForm": "hIrmhG_addForm",
			"card": "hIrmhG_card",
			"cardActions": "hIrmhG_cardActions",
			"cardDescription": "hIrmhG_cardDescription",
			"cardHead": "hIrmhG_cardHead",
			"cardText": "hIrmhG_cardText",
			"cardTitle": "hIrmhG_cardTitle",
			"chip": "hIrmhG_chip",
			"chipBrand": "hIrmhG_chipBrand",
			"chipLogin": "hIrmhG_chipLogin",
			"chips": "hIrmhG_chips",
			"confirmDanger": "hIrmhG_confirmDanger",
			"content": "hIrmhG_content",
			"copyButton": "hIrmhG_copyButton",
			"copyFailed": "hIrmhG_copyFailed",
			"count": "hIrmhG_count",
			"dangerAction": "hIrmhG_dangerAction",
			"description": "hIrmhG_description",
			"dialogActions": "hIrmhG_dialogActions",
			"empty": "hIrmhG_empty",
			"emptyHint": "hIrmhG_emptyHint",
			"emptyText": "hIrmhG_emptyText",
			"errorBanner": "hIrmhG_errorBanner",
			"errorText": "hIrmhG_errorText",
			"feedback": "hIrmhG_feedback",
			"feedbackFailed": "hIrmhG_feedbackFailed",
			"field": "hIrmhG_field",
			"fieldLabel": "hIrmhG_fieldLabel",
			"form": "hIrmhG_form",
			"formActions": "hIrmhG_formActions",
			"git-accounts-page": "hIrmhG_git-accounts-page",
			"heading": "hIrmhG_heading",
			"headingActions": "hIrmhG_headingActions",
			"headingText": "hIrmhG_headingText",
			"hintLink": "hIrmhG_hintLink",
			"inlineError": "hIrmhG_inlineError",
			"inlineErrorRow": "hIrmhG_inlineErrorRow",
			"input": "hIrmhG_input",
			"keyHint": "hIrmhG_keyHint",
			"keyOption": "hIrmhG_keyOption",
			"keyOptions": "hIrmhG_keyOptions",
			"loadMoreRow": "hIrmhG_loadMoreRow",
			"loadingCard": "hIrmhG_loadingCard",
			"noMatch": "hIrmhG_noMatch",
			"openLink": "hIrmhG_openLink",
			"page": "hIrmhG_page",
			"projectAccount": "hIrmhG_projectAccount",
			"projectActions": "hIrmhG_projectActions",
			"projectDescription": "hIrmhG_projectDescription",
			"projectHead": "hIrmhG_projectHead",
			"projectList": "hIrmhG_projectList",
			"projectMain": "hIrmhG_projectMain",
			"projectMeta": "hIrmhG_projectMeta",
			"projectName": "hIrmhG_projectName",
			"projectNamespace": "hIrmhG_projectNamespace",
			"projectPath": "hIrmhG_projectPath",
			"projectRow": "hIrmhG_projectRow",
			"projects": "hIrmhG_projects",
			"removeDialog": "hIrmhG_removeDialog",
			"search": "hIrmhG_search",
			"searchRow": "hIrmhG_searchRow",
			"skeletonBar": "hIrmhG_skeletonBar",
			"skeletonBarShort": "hIrmhG_skeletonBarShort",
			"skeletonLine": "hIrmhG_skeletonLine",
			"skeletonLineShort": "hIrmhG_skeletonLineShort",
			"skeletonList": "hIrmhG_skeletonList",
			"skeletonRow": "hIrmhG_skeletonRow",
			"title": "hIrmhG_title",
			"tokenHint": "hIrmhG_tokenHint",
			"verifyAction": "hIrmhG_verifyAction",
			"verifyOk": "hIrmhG_verifyOk",
			"warning": "hIrmhG_warning"
		};
		//#endregion
		//#region src/client/git-accounts/AddAccountDialog.tsx
		/**
		* The add-account dialog: pick a host family and an authentication method, then
		* either paste an access token or choose an SSH private key this machine holds.
		*
		* The token never leaves this dialog's own state before the Host accepts it, and
		* closing the dialog clears it. An SSH account stores only the key's path: the
		* form offers the keys `~/.ssh` already exposes (the Host lists their names) and
		* still allows typing another path, while the key's contents are never read by
		* the page or returned by the Host.
		*
		* The two methods exist because they answer different questions: a token can
		* list projects through the provider API, an SSH key cannot. The SSH hint says
		* so before the operator commits, and the projects card repeats it after an SSH
		* account is selected.
		* @module @guowenzhang/dsh-worktree/client/git-accounts/AddAccountDialog
		*/
		/** The dialog form's accessible grouping; the Enter key submits it. */
		const FORM_ID = "git-accounts-add-form";
		/** Dictionary key of the token-creation link's text for one provider. */
		const TOKEN_LINK_KEYS = {
			github: "gitAccounts.add.tokenLink.github",
			gitlab: "gitAccounts.add.tokenLink.gitlab",
			gitee: "gitAccounts.add.tokenLink.gitee"
		};
		/**
		* Render the add-account dialog.
		* @param props - its open state, close request, the Host operations, its success hook, and copy.
		* @returns the dialog, or nothing while closed.
		*/
		function AddAccountDialog({ open, onClose, addAccount, verifyAccount, sshKeys, onAdded, t }) {
			const [provider, setProvider] = (0, react.useState)("github");
			const [auth, setAuth] = (0, react.useState)("token");
			const [host, setHost] = (0, react.useState)(DEFAULT_PROVIDER_HOSTS.github);
			const [token, setToken] = (0, react.useState)("");
			const [keyPath, setKeyPath] = (0, react.useState)("");
			const [keys, setKeys] = (0, react.useState)({ status: "idle" });
			/** Whether the key list was already requested for this opening; reset with the other fields. */
			const keysRequested = (0, react.useRef)(false);
			const [busy, setBusy] = (0, react.useState)(false);
			const [verifying, setVerifying] = (0, react.useState)(false);
			/** The last connection test's answer, cleared whenever the inputs it tested change. */
			const [verifyNotice, setVerifyNotice] = (0, react.useState)(void 0);
			const [refusal, setRefusal] = (0, react.useState)(void 0);
			(0, react.useEffect)(() => {
				if (open) return;
				setToken("");
				setKeyPath("");
				setAuth("token");
				setKeys({ status: "idle" });
				keysRequested.current = false;
				setRefusal(void 0);
				setBusy(false);
				setVerifying(false);
				setVerifyNotice(void 0);
			}, [open]);
			(0, react.useEffect)(() => {
				if (!open || auth !== "ssh" || keysRequested.current) return;
				keysRequested.current = true;
				let active = true;
				setKeys({ status: "loading" });
				sshKeys().then((result) => {
					if (!active) return;
					setKeys(result.ok ? {
						status: "ready",
						keys: result.value.keys
					} : { status: "failed" });
				});
				return () => {
					active = false;
				};
			}, [
				open,
				auth,
				sshKeys
			]);
			const credentialPresent = auth === "token" ? token.trim() !== "" : keyPath.trim() !== "";
			const canSubmit = host.trim() !== "" && credentialPresent && !busy && !verifying;
			const canVerify = host.trim() !== "" && credentialPresent && !busy && !verifying;
			const close = () => {
				if (busy || verifying) return;
				onClose();
			};
			const chooseProvider = (next) => {
				setProvider(next);
				setHost(DEFAULT_PROVIDER_HOSTS[next]);
				setRefusal(void 0);
				setVerifyNotice(void 0);
			};
			const chooseAuth = (next) => {
				if (next !== "token" && next !== "ssh") return;
				setAuth(next);
				setRefusal(void 0);
				setVerifyNotice(void 0);
			};
			/** Run the connection test without storing anything. */
			const verify = () => {
				if (!canVerify) return;
				setVerifying(true);
				setVerifyNotice(void 0);
				setRefusal(void 0);
				verifyAccount({
					provider,
					host: host.trim(),
					auth,
					...auth === "token" ? { token: token.trim() } : { keyPath: keyPath.trim() }
				}).then((result) => {
					setVerifying(false);
					if (result.ok) {
						const endpoint = result.value.endpoint;
						const facts = {
							login: result.value.login,
							provider: PROVIDER_BRANDS[result.value.provider],
							host: host.trim()
						};
						setVerifyNotice({
							okay: true,
							text: endpoint === void 0 ? t("gitAccounts.add.verified", facts) : t("gitAccounts.add.verifiedVia", {
								...facts,
								endpoint
							})
						});
						return;
					}
					setVerifyNotice({
						okay: false,
						text: verifyFailureText(result, auth, t)
					});
				});
			};
			const submit = () => {
				if (!canSubmit) return;
				setBusy(true);
				setRefusal(void 0);
				setVerifyNotice(void 0);
				addAccount({
					provider,
					host: host.trim(),
					auth,
					...auth === "token" ? { token: token.trim() } : { keyPath: keyPath.trim() }
				}).then((result) => {
					setBusy(false);
					if (result.ok) {
						setToken("");
						setKeyPath("");
						onAdded(result.value);
						return;
					}
					setRefusal({
						...result.code === void 0 ? {} : { code: result.code },
						message: result.message
					});
				});
			};
			const refusalText = refusal === void 0 ? void 0 : failureText(refusal.code, refusal.message, auth, t);
			const detectedKeys = keys.status === "ready" ? keys.keys : [];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open,
				onClose: close,
				title: t("gitAccounts.add.title"),
				description: t("gitAccounts.add.description"),
				closeLabel: t("gitAccounts.add.close"),
				...GitAccountsPage_module_css_default.addDialog === void 0 ? {} : { className: GitAccountsPage_module_css_default.addDialog },
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: GitAccountsPage_module_css_default.dialogActions,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							className: GitAccountsPage_module_css_default.verifyAction,
							disabled: !canVerify,
							onClick: verify,
							children: verifying ? t("gitAccounts.add.verifying") : t("gitAccounts.add.verify")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							disabled: busy || verifying,
							onClick: close,
							children: t("gitAccounts.add.cancel")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "primary",
							disabled: !canSubmit,
							onClick: submit,
							children: busy ? t("gitAccounts.add.submitting") : t("gitAccounts.add.submit")
						})
					]
				}),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
					id: FORM_ID,
					className: GitAccountsPage_module_css_default.addForm,
					"data-add-auth-method": auth,
					onSubmit: (event) => {
						event.preventDefault();
						submit();
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: GitAccountsPage_module_css_default.addField,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: GitAccountsPage_module_css_default.fieldLabel,
								children: t("gitAccounts.add.provider")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SegmentedControl, {
								id: "git-accounts-add-provider",
								value: provider,
								options: GIT_PROVIDERS.map((value) => ({
									value,
									label: PROVIDER_BRANDS[value]
								})),
								onChange: chooseProvider,
								label: t("gitAccounts.add.provider"),
								disabled: busy
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: GitAccountsPage_module_css_default.addField,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: GitAccountsPage_module_css_default.fieldLabel,
								children: t("gitAccounts.add.auth")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SegmentedControl, {
								id: "git-accounts-add-auth",
								value: auth,
								options: GIT_AUTH_METHODS.map((value) => ({
									value,
									label: value === "ssh" ? t("gitAccounts.add.auth.ssh") : t("gitAccounts.add.auth.token")
								})),
								onChange: chooseAuth,
								label: t("gitAccounts.add.auth"),
								disabled: busy
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: GitAccountsPage_module_css_default.addField,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: GitAccountsPage_module_css_default.fieldLabel,
								children: t("gitAccounts.add.host")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: GitAccountsPage_module_css_default.input,
								type: "text",
								autoComplete: "off",
								spellCheck: false,
								value: host,
								disabled: busy,
								onChange: (event) => {
									setHost(event.target.value);
									setRefusal(void 0);
									setVerifyNotice(void 0);
								}
							})]
						}),
						auth === "ssh" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: GitAccountsPage_module_css_default.addField,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: GitAccountsPage_module_css_default.fieldLabel,
									children: t("gitAccounts.add.keyPath")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: GitAccountsPage_module_css_default.input,
									type: "text",
									autoComplete: "off",
									spellCheck: false,
									value: keyPath,
									disabled: busy,
									"data-modal-autofocus": true,
									placeholder: t("gitAccounts.add.keyPathPlaceholder"),
									onChange: (event) => {
										setKeyPath(event.target.value);
										setRefusal(void 0);
										setVerifyNotice(void 0);
									}
								})]
							}),
							keys.status === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: GitAccountsPage_module_css_default.keyHint,
								role: "status",
								children: t("gitAccounts.add.keysLoading")
							}) : keys.status === "failed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: GitAccountsPage_module_css_default.keyHint,
								children: t("gitAccounts.add.keysFailed")
							}) : detectedKeys.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: GitAccountsPage_module_css_default.keyHint,
								children: t("gitAccounts.add.keysEmpty")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: GitAccountsPage_module_css_default.keyOptions,
								"aria-label": t("gitAccounts.add.keys"),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: GitAccountsPage_module_css_default.fieldLabel,
									children: t("gitAccounts.add.keys")
								}), detectedKeys.map((key) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: GitAccountsPage_module_css_default.keyOption,
									title: key.path,
									disabled: busy,
									"data-ssh-key": key.name,
									onClick: () => {
										setKeyPath(key.path);
										setRefusal(void 0);
										setVerifyNotice(void 0);
									},
									children: key.name
								}, key.path))]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: GitAccountsPage_module_css_default.tokenHint,
								children: t("gitAccounts.add.keyHint")
							})
						] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: GitAccountsPage_module_css_default.addField,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: GitAccountsPage_module_css_default.fieldLabel,
								children: t("gitAccounts.add.token")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: GitAccountsPage_module_css_default.input,
								type: "password",
								autoComplete: "off",
								spellCheck: false,
								value: token,
								disabled: busy,
								"data-modal-autofocus": true,
								placeholder: t("gitAccounts.add.tokenPlaceholder"),
								onChange: (event) => {
									setToken(event.target.value);
									setRefusal(void 0);
									setVerifyNotice(void 0);
								}
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: GitAccountsPage_module_css_default.tokenHint,
							children: [
								t("gitAccounts.add.tokenHint"),
								" ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
									className: GitAccountsPage_module_css_default.hintLink,
									href: tokenCreationUrl(provider, host),
									target: "_blank",
									rel: "noreferrer",
									children: t(TOKEN_LINK_KEYS[provider])
								})
							]
						})] }),
						verifyNotice === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: verifyNotice.okay ? GitAccountsPage_module_css_default.verifyOk : GitAccountsPage_module_css_default.inlineError,
							role: verifyNotice.okay ? "status" : "alert",
							"data-verify-result": verifyNotice.okay ? "ok" : "failed",
							children: verifyNotice.text
						}),
						refusalText === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: GitAccountsPage_module_css_default.inlineError,
							role: "alert",
							"data-add-error": refusal?.code ?? "unknown",
							children: refusalText
						})
					]
				})
			});
		}
		/**
		* Localize one credential failure.
		*
		* A refused SSH key is not a refused token, so the two `unauthorized` cases get
		* different advice; everything else shares the same wording.
		* @param code - the Host's machine code, when it sent one.
		* @param message - the Host's own text, used when no code is known.
		* @param auth - the method that was tested.
		* @param t - the copy reader.
		* @returns the text to show.
		*/
		function failureText(code, message, auth, t) {
			if (auth === "ssh" && code === "unauthorized") return t("gitAccounts.add.failed.sshUnauthorized");
			if (code === "unauthorized") return t("gitAccounts.add.failed.unauthorized");
			if (code === "network") return t("gitAccounts.add.failed.network");
			return t("gitAccounts.add.failed", { message });
		}
		/**
		* Localize one connection-test refusal.
		* @param result - the refused route result.
		* @param auth - the method that was tested.
		* @param t - the copy reader.
		* @returns the text to show.
		*/
		function verifyFailureText(result, auth, t) {
			return failureText(result.code, result.message, auth, t);
		}
		//#endregion
		//#region src/client/git-accounts/RemoveAccountDialog.tsx
		/**
		* Render the remove-account confirmation.
		* @param props - the target account, the request's state, both actions, and copy.
		* @returns the dialog, or nothing while no removal is pending.
		*/
		function RemoveAccountDialog({ account, busy, error, onClose, onConfirm, t }) {
			const close = () => {
				if (!busy) onClose();
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: account !== void 0,
				onClose: close,
				title: t("gitAccounts.remove.title"),
				closeLabel: t("gitAccounts.remove.close"),
				description: account === void 0 ? "" : t("gitAccounts.remove.description", {
					login: account.login,
					host: account.host
				}),
				...GitAccountsPage_module_css_default.removeDialog === void 0 ? {} : { className: GitAccountsPage_module_css_default.removeDialog },
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: GitAccountsPage_module_css_default.dialogActions,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "outline",
						disabled: busy,
						onClick: close,
						children: t("gitAccounts.remove.cancel")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "outline",
						className: GitAccountsPage_module_css_default.confirmDanger,
						disabled: busy,
						onClick: onConfirm,
						children: busy ? t("gitAccounts.remove.removing") : t("gitAccounts.remove.confirm")
					})]
				}),
				children: error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: GitAccountsPage_module_css_default.inlineError,
					role: "alert",
					"data-remove-error": "true",
					children: t("gitAccounts.remove.failed", { message: error })
				})
			});
		}
		//#endregion
		//#region \0dsh-css:C:\02-codespace\DeepSeek\dsh-worktree\src\client\SettingsSection.module.css.mjs
		const css$1 = ".SOCsgq_page{width:100%;max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;display:flex;container:SOCsgq_worktree-settings/inline-size}.SOCsgq_pageTitle{font:var(--dsw-font-base-strong-16);color:var(--dsw-alias-label-primary);margin:0 0 4px}.SOCsgq_pageDescription{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);margin:0 0 12px}.SOCsgq_card{border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-settings-card-fill);flex-direction:column;margin:0 0 12px;padding:16px;display:flex}.SOCsgq_cardTitle{font:var(--dsw-font-s-strong-14);color:var(--dsw-alias-label-primary);margin:0 0 4px}.SOCsgq_gitStatus{border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);margin:0 0 4px;padding:8px 12px}.SOCsgq_gitError{color:var(--dsw-alias-state-error-primary)}.SOCsgq_notice{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);margin:0 0 12px}.SOCsgq_saveFailed{color:var(--dsw-alias-state-error-primary)}.SOCsgq_row{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex}.SOCsgq_card>.SOCsgq_row:first-of-type{margin-top:4px}.SOCsgq_card>.SOCsgq_row:last-child{border-bottom:0}.SOCsgq_rowText{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}.SOCsgq_title{font:var(--dsw-font-s-14);color:var(--dsw-alias-label-primary)}.SOCsgq_desc{max-width:62ch;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}.SOCsgq_control{flex:none;align-items:center;gap:8px;display:inline-flex}.SOCsgq_choices{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover);grid-auto-columns:1fr;grid-auto-flow:column;gap:2px;padding:4px;display:inline-grid;position:relative}.SOCsgq_indicator{width:calc((100% - 8px - 2px * (var(--worktree-choice-count) - 1)) / var(--worktree-choice-count));border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);height:calc(100% - 8px);box-shadow:var(--dsw-elevation-soft);transform:translateX(calc(var(--worktree-choice-index) * (100% + 2px)));transition:transform var(--ds-transition-duration) var(--ds-ease-in-out);pointer-events:none;position:absolute;top:4px;left:4px}.SOCsgq_choice{z-index:1;border-radius:var(--dsw-radius-sm);height:28px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-strong-13);white-space:nowrap;cursor:pointer;transition:color var(--ds-transition-duration-fast) var(--ds-ease-in-out);background:0 0;border:0;padding:0 14px;position:relative}.SOCsgq_choice:hover:not(:disabled),.SOCsgq_choice[aria-pressed=true]{color:var(--dsw-alias-label-primary)}.SOCsgq_choice:disabled{cursor:default;opacity:.5}.SOCsgq_choice:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}@media (prefers-reduced-motion:reduce){.SOCsgq_indicator,.SOCsgq_choice{transition:none}}.SOCsgq_input{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);height:36px;font:var(--dsw-font-s-14);color:var(--dsw-alias-label-primary);border:none;padding:0 14px}.SOCsgq_input:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}.SOCsgq_input:disabled{color:var(--dsw-alias-label-tertiary);opacity:.5;cursor:default}.SOCsgq_input[aria-invalid=true]{outline:var(--dsw-focus-ring-width) solid var(--dsw-alias-state-error-primary);outline-offset:-1px}.SOCsgq_inputNumber{text-align:center;font-variant-numeric:tabular-nums;width:104px}@container SOCsgq_worktree-settings (width<=520px){.SOCsgq_card{padding:12px}.SOCsgq_row{flex-wrap:wrap;align-items:flex-start;row-gap:8px}.SOCsgq_rowText{flex:1 0 100%;padding-right:0}.SOCsgq_control{justify-content:flex-start}}@media (pointer:coarse){.SOCsgq_row{min-height:44px}.SOCsgq_switchHit{position:relative}.SOCsgq_switchHit:after{content:\"\";position:absolute;inset:-12px -6px}.SOCsgq_input{height:44px;font:var(--dsw-font-base-16)}.SOCsgq_choice{height:44px}}";
		const tagId$1 = "@guowenzhang/dsh-worktree/SettingsSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var SettingsSection_module_css_default = {
			"card": "SOCsgq_card",
			"cardTitle": "SOCsgq_cardTitle",
			"choice": "SOCsgq_choice",
			"choices": "SOCsgq_choices",
			"control": "SOCsgq_control",
			"desc": "SOCsgq_desc",
			"gitError": "SOCsgq_gitError",
			"gitStatus": "SOCsgq_gitStatus",
			"indicator": "SOCsgq_indicator",
			"input": "SOCsgq_input",
			"inputNumber": "SOCsgq_inputNumber",
			"notice": "SOCsgq_notice",
			"page": "SOCsgq_page",
			"pageDescription": "SOCsgq_pageDescription",
			"pageTitle": "SOCsgq_pageTitle",
			"row": "SOCsgq_row",
			"rowText": "SOCsgq_rowText",
			"saveFailed": "SOCsgq_saveFailed",
			"switchHit": "SOCsgq_switchHit",
			"title": "SOCsgq_title",
			"worktree-settings": "SOCsgq_worktree-settings"
		};
		//#endregion
		//#region \0dsh-css:C:\02-codespace\DeepSeek\dsh-worktree\src\client\git-accounts\SettingsGitAccountsCard.module.css.mjs
		const css = ".Y_1HgG_actions{flex-wrap:wrap;align-items:center;gap:8px;margin:10px 0 4px;display:flex}.Y_1HgG_failure{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;margin:8px 0 0;display:flex}.Y_1HgG_statusText{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);margin:8px 0 0}.Y_1HgG_empty{flex-direction:column;gap:4px;margin:8px 0 0;display:flex}.Y_1HgG_emptyText{font:var(--dsw-font-s-14);color:var(--dsw-alias-label-primary);margin:0}.Y_1HgG_list{flex-direction:column;gap:8px;margin:8px 0 0;padding:0;list-style:none;display:flex}.Y_1HgG_row{border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px 12px;padding:10px 12px;display:flex}.Y_1HgG_rowMain{flex-direction:column;flex:220px;gap:2px;min-width:0;display:flex}.Y_1HgG_rowTitle{flex-wrap:wrap;align-items:center;gap:8px;min-width:0;display:flex}.Y_1HgG_login{font:var(--dsw-font-s-strong-14);color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}.Y_1HgG_host{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}.Y_1HgG_openPage{align-self:flex-start;margin:10px 0 0}";
		const tagId = "@guowenzhang/dsh-worktree/SettingsGitAccountsCard.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var SettingsGitAccountsCard_module_css_default = {
			"actions": "Y_1HgG_actions",
			"empty": "Y_1HgG_empty",
			"emptyText": "Y_1HgG_emptyText",
			"failure": "Y_1HgG_failure",
			"host": "Y_1HgG_host",
			"list": "Y_1HgG_list",
			"login": "Y_1HgG_login",
			"openPage": "Y_1HgG_openPage",
			"row": "Y_1HgG_row",
			"rowMain": "Y_1HgG_rowMain",
			"rowTitle": "Y_1HgG_rowTitle",
			"statusText": "Y_1HgG_statusText"
		};
		//#endregion
		//#region src/client/git-accounts/SettingsGitAccountsCard.tsx
		/**
		* The Git-account connection card on the worktree settings page.
		*
		* The settings page is where a deployment's operator looks for "how this plugin
		* talks to Git", so the account connections live there beside the worktree
		* policy rather than only on the standalone Git accounts panel. The card is a
		* compact version of that panel's accounts card: list, add, scan, forget, and a
		* way over to the panel for project browsing. It reuses the same dialogs and
		* scan report — one interaction, one code path — and owns only its own read of
		* the account list, because the settings page and the panel can both be mounted.
		*
		* No token is stored or rendered here: the add dialog keeps the pasted value in
		* its own state until the Host accepts it, exactly as on the panel.
		* @module @guowenzhang/dsh-worktree/client/git-accounts/SettingsGitAccountsCard
		*/
		/**
		* Render the Git-account connection card.
		* @param props - the Host face, the panel navigation, and copy.
		* @returns the card.
		*/
		function SettingsGitAccountsCard({ gitAccounts, onOpenAccountsPage, t }) {
			const { snapshot, addAccount, verifyAccount, sshKeys, removeAccount, scan } = gitAccounts;
			const [state, setState] = (0, react.useState)({
				status: "loading",
				accounts: []
			});
			const [reload, setReload] = (0, react.useState)(0);
			const [addOpen, setAddOpen] = (0, react.useState)(false);
			const [removeTarget, setRemoveTarget] = (0, react.useState)(void 0);
			const [removing, setRemoving] = (0, react.useState)(false);
			const [removeError, setRemoveError] = (0, react.useState)(void 0);
			const [scanning, setScanning] = (0, react.useState)(false);
			const [scanError, setScanError] = (0, react.useState)(void 0);
			const [notice, setNotice] = (0, react.useState)(void 0);
			(0, react.useEffect)(() => {
				let active = true;
				setState((current) => ({
					...current,
					status: "loading"
				}));
				snapshot().then((result) => {
					if (!active) return;
					if (result.ok) {
						setState({
							status: "ready",
							accounts: result.value.accounts
						});
						return;
					}
					setState((current) => ({
						...current,
						status: "failed",
						message: result.message
					}));
				});
				return () => {
					active = false;
				};
			}, [snapshot, reload]);
			const announce = (text) => {
				setNotice((current) => ({
					text,
					seq: (current?.seq ?? 0) + 1
				}));
			};
			const handleAdded = (result) => {
				setAddOpen(false);
				setState((current) => ({
					...current,
					accounts: current.accounts.some((account) => account.id === result.account.id) ? current.accounts.map((account) => account.id === result.account.id ? result.account : account) : [...current.accounts, result.account]
				}));
				announce(result.account.verified === false ? t("gitAccounts.account.addedUnverified", { login: result.account.login }) : t(result.created ? "gitAccounts.account.added" : "gitAccounts.account.updated", { login: result.account.login }));
			};
			const handleScan = () => {
				if (scanning) return;
				setScanning(true);
				setScanError(void 0);
				scan().then((result) => {
					setScanning(false);
					if (!result.ok) {
						setScanError(result.message);
						return;
					}
					setState((current) => ({
						...current,
						accounts: result.value.accounts
					}));
					announce(scanResultText(result.value.report, t));
				});
			};
			const handleRemove = () => {
				if (removeTarget === void 0 || removing) return;
				const target = removeTarget;
				setRemoving(true);
				setRemoveError(void 0);
				removeAccount(target.id).then((result) => {
					setRemoving(false);
					if (!result.ok) {
						setRemoveError(result.message);
						return;
					}
					setRemoveTarget(void 0);
					setState((current) => ({
						...current,
						accounts: current.accounts.filter((account) => account.id !== target.id)
					}));
					announce(t("gitAccounts.account.removed", { login: target.login }));
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: SettingsSection_module_css_default.card,
				"aria-labelledby": "worktree-git-accounts-heading",
				"data-git-accounts-settings": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: SettingsSection_module_css_default.cardTitle,
						id: "worktree-git-accounts-heading",
						children: t("gitAccounts.settings.title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: GitAccountsPage_module_css_default.cardDescription,
						children: t("gitAccounts.settings.description")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SettingsGitAccountsCard_module_css_default.actions,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							size: "sm",
							icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutlineRegular, {}),
							disabled: state.status === "loading" || scanning,
							onClick: handleScan,
							children: scanning ? t("gitAccounts.accounts.scanning") : t("gitAccounts.accounts.scan")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "primary",
							size: "sm",
							icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular, {}),
							disabled: state.status === "loading",
							onClick: () => {
								setAddOpen(true);
							},
							children: t("gitAccounts.accounts.add")
						})]
					}),
					state.status === "failed" && state.message !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SettingsGitAccountsCard_module_css_default.failure,
						role: "status",
						"data-git-accounts-settings-error": "true",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: GitAccountsPage_module_css_default.inlineError,
							children: t("gitAccounts.loadFailed", { message: state.message })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							size: "sm",
							onClick: () => {
								setReload((value) => value + 1);
							},
							children: t("gitAccounts.retry")
						})]
					}) : null,
					scanError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: GitAccountsPage_module_css_default.inlineError,
						role: "alert",
						"data-scan-error": "true",
						children: t("gitAccounts.scan.failed", { message: scanError })
					}),
					state.status === "loading" && state.accounts.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: SettingsGitAccountsCard_module_css_default.statusText,
						role: "status",
						children: t("gitAccounts.loading")
					}) : state.accounts.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SettingsGitAccountsCard_module_css_default.empty,
						"data-accounts-empty": "true",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: SettingsGitAccountsCard_module_css_default.emptyText,
							children: t("gitAccounts.accounts.empty")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: GitAccountsPage_module_css_default.emptyHint,
							children: t("gitAccounts.accounts.emptyHint")
						})]
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: SettingsGitAccountsCard_module_css_default.list,
						"aria-label": t("gitAccounts.accounts.list"),
						children: state.accounts.map((account) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
							className: SettingsGitAccountsCard_module_css_default.row,
							"data-account-id": account.id,
							"data-account-provider": account.provider,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: SettingsGitAccountsCard_module_css_default.rowMain,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: SettingsGitAccountsCard_module_css_default.rowTitle,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: SettingsGitAccountsCard_module_css_default.login,
											children: account.login
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
											tone: "neutral",
											children: PROVIDER_BRANDS[account.provider]
										}),
										account.auth === "ssh" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
											tone: "outline",
											children: t("gitAccounts.auth.sshBadge")
										}) : null,
										account.verified ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											title: t("gitAccounts.account.unverifiedHint"),
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
												tone: "warning",
												children: t("gitAccounts.auth.unverifiedBadge")
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: SettingsGitAccountsCard_module_css_default.host,
											children: account.host
										})
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
									className: GitAccountsPage_module_css_default.accountMeta,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("gitAccounts.account.origin", { origin: t(ORIGIN_KEYS[account.origin]) }) }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											"aria-hidden": "true",
											children: " · "
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("gitAccounts.account.addedAt", { date: formatDate(account.addedAt) }) })
									]
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "ghost",
								size: "sm",
								className: GitAccountsPage_module_css_default.dangerAction,
								"aria-label": t("gitAccounts.account.removeOne", { login: account.login }),
								onClick: () => {
									setRemoveError(void 0);
									setRemoveTarget(account);
								},
								children: t("gitAccounts.account.remove")
							})]
						}, account.id))
					}),
					state.accounts.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "outline",
						size: "sm",
						className: SettingsGitAccountsCard_module_css_default.openPage,
						icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconLinkOutlineRegular, {}),
						onClick: onOpenAccountsPage,
						children: t("gitAccounts.settings.openProjects")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AddAccountDialog, {
						open: addOpen,
						onClose: () => {
							setAddOpen(false);
						},
						addAccount,
						verifyAccount,
						sshKeys,
						onAdded: handleAdded,
						t
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RemoveAccountDialog, {
						account: removeTarget,
						busy: removing,
						error: removeError,
						onClose: () => {
							if (removing) return;
							setRemoveTarget(void 0);
							setRemoveError(void 0);
						},
						onConfirm: handleRemove,
						t
					}),
					notice === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
						text: notice.text,
						tone: "success",
						onDone: () => {
							setNotice((current) => current?.seq === notice.seq ? void 0 : current);
						}
					}, notice.seq)
				]
			});
		}
		//#endregion
		//#region src/client/SettingsSection.tsx
		/**
		* The file backup settings page, in three cards: the Git connections this
		* plugin uses, the policy every later checkout is created under, and the
		* protection that runs over files inside a session.
		*
		* Each card is a title, an explanation, and its own rows, laid out in the
		* settings column's two-column shape (label and explanation left, control
		* right), so this page reads like every other page beside it. The Git accounts
		* card sits first: connecting a host is the one thing here that talks to a
		* service outside this machine, and it is what an operator most often opens the
		* page for. The Worktree card answers what a checkout looks like — whether the
		* child repositories come along, how deep the search for them goes, and where
		* the directory lands. The backup card answers what happens to the files inside
		* it: whether they are copied aside before a change, whether a destructive
		* command is refused, and whether the right sidebar offers the page that lists
		* and restores them. Everything else the entry accepts — the agent
		* subdirectory, the git bound, the route options — is deployment composition,
		* edited in the profile's own patch.
		*
		* Every valid edit saves automatically through the shared settings scope.
		* There is no manual-save footer, and leaving the page never discards a write.
		*
		* The two action results — a write the Host refused, and a draft it would
		* reject — are reported in the Host's floating banner instead of at the page's
		* own end, which three filled cards and the settings modal's scroll container
		* put out of sight. What stays on the page is standing state: whether the entry
		* is served, whether this deployment stores settings read-only, the Git line,
		* and each row's hint.
		* @module @guowenzhang/dsh-worktree/client/SettingsSection
		*/
		/** A refused write names what broke and how to retry, so it holds the longest. */
		const FAILURE_HOLD_MS = 6e3;
		/** Rule feedback is shorter: the field stays marked while the text is wrong. */
		const INVALID_HOLD_MS = 4e3;
		/**
		* Render one settings row: what it edits on the left, the control on the right.
		* @param props - the row's title, its explanation, and its control.
		* @returns the row.
		*/
		function Row(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: SettingsSection_module_css_default.row,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: SettingsSection_module_css_default.rowText,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: SettingsSection_module_css_default.title,
						id: `${props.id}-label`,
						children: props.title
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: SettingsSection_module_css_default.desc,
						id: `${props.id}-message`,
						children: props.description
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: SettingsSection_module_css_default.control,
					children: props.control
				})]
			});
		}
		/**
		* Group rows under one heading, on the settings cards' shared material.
		*
		* The heading names the surface the rows below answer for. Its id is what the
		* region points at, so a screen reader announces the group by the same words
		* the page shows above it.
		* @param props - the heading's identity and text, and the rows it groups.
		* @returns the card.
		*/
		function Card(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: SettingsSection_module_css_default.card,
				"aria-labelledby": `${props.id}-heading`,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
					className: SettingsSection_module_css_default.cardTitle,
					id: `${props.id}-heading`,
					children: props.title
				}), props.children]
			});
		}
		/**
		* Render a row's choices as one row of buttons with a sliding selection.
		*
		* The buttons are the same control the Appearance row uses — buttons carrying
		* `aria-pressed` — because this is a preference, not a set of panels: tablist
		* semantics with no panel to control would promise navigation that does not
		* exist. The two properties the indicator derives its geometry from are
		* plugin-private: the `--dsh-` prefix names Host-owned properties. The buttons
		* carry `aria-pressed` rather than tab semantics, so the wrapper is a named
		* `group`: a set of toggles with one name, not a tab list.
		* @param props - the row identity, its staged value, the labelled choices, and the write.
		* @returns the segmented control.
		*/
		function ChoiceRow(props) {
			const selected = props.options.findIndex((option) => option.value === props.text);
			const indicator = {
				"--worktree-choice-count": String(props.options.length),
				"--worktree-choice-index": String(Math.max(selected, 0))
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: SettingsSection_module_css_default.choices,
				style: indicator,
				role: "group",
				"aria-label": props.label,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					"aria-hidden": "true",
					className: SettingsSection_module_css_default.indicator
				}), props.options.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: SettingsSection_module_css_default.choice,
					"aria-pressed": option.value === props.text,
					"aria-describedby": `${props.id}-message`,
					disabled: props.disabled,
					onClick: () => {
						props.onEdit(option.value);
					},
					children: option.label
				}, option.value))]
			});
		}
		/**
		* Render the file backup page.
		* @param props - the composition's other props, this plugin's copy, and the form face.
		* @returns the settings page.
		*/
		function WorktreeSettingsSection(props) {
			const { t } = props;
			const state = props.useWorktreeSettings((snapshot) => snapshot);
			const [gitStatus, setGitStatus] = (0, react.useState)({ kind: "checking" });
			(0, react.useEffect)(() => {
				let active = true;
				request("check", {}).then((result) => {
					if (!active) return;
					if (result.ok) setGitStatus({
						kind: "available",
						detail: result.value.version
					});
					else if (result.code === "git_not_found" || /\bspawn\s+git\s+ENOENT\b/iu.test(result.message)) setGitStatus({ kind: "missing" });
					else setGitStatus({
						kind: "failed",
						detail: result.message
					});
				}).catch((error) => {
					if (active) setGitStatus({
						kind: "failed",
						detail: error instanceof Error ? error.message : String(error)
					});
				});
				return () => {
					active = false;
				};
			}, []);
			const labels = formLabels(t);
			const [report, setReport] = (0, react.useState)(null);
			const reportSeq = (0, react.useRef)(0);
			(0, react.useEffect)(() => {
				if (state.failedSeq === 0) return;
				setReport({
					text: labels.saveFailed,
					seq: ++reportSeq.current,
					kind: "failed"
				});
			}, [state.failedSeq]);
			(0, react.useEffect)(() => {
				if (!state.nestedScanDepth.invalid) return;
				setReport({
					text: t("settings.invalidNumber"),
					seq: ++reportSeq.current,
					kind: "invalid"
				});
			}, [state.nestedScanDepth.invalid]);
			const readOnly = !state.writable;
			const createsNested = state.nestedRepositories.text !== "none";
			if (!state.available) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: SettingsSection_module_css_default.notice,
				role: "status",
				children: labels.unavailable
			});
			const guardsFiles = state.fileGuard.text !== "false";
			const gitLine = gitStatus.kind === "checking" ? t("settings.gitChecking") : gitStatus.kind === "available" ? `${t("settings.gitAvailable")} · ${gitStatus.detail}` : gitStatus.kind === "missing" ? t("settings.gitMissing") : `${t("settings.gitFailed")}：${gitStatus.detail}`;
			const reportProps = report?.kind === "failed" ? {
				icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, {}),
				holdMs: FAILURE_HOLD_MS
			} : { holdMs: INVALID_HOLD_MS };
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: SettingsSection_module_css_default.page,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						className: SettingsSection_module_css_default.pageTitle,
						children: t("settings.title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: SettingsSection_module_css_default.pageDescription,
						children: t("settings.description")
					}),
					!state.writable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: SettingsSection_module_css_default.notice,
						role: "status",
						children: labels.readOnly
					}) : null,
					state.failed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: `${SettingsSection_module_css_default.notice} ${SettingsSection_module_css_default.saveFailed}`,
						role: "status",
						children: labels.saveFailed
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SettingsGitAccountsCard, {
						gitAccounts: props.gitAccounts,
						onOpenAccountsPage: () => {
							props.close();
							props.openAccountsPage();
						},
						t
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Card, {
						id: "worktree",
						title: t("settings.worktree.cardTitle"),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: `${SettingsSection_module_css_default.gitStatus} ${gitStatus.kind === "missing" || gitStatus.kind === "failed" ? SettingsSection_module_css_default.gitError : ""}`,
								role: "status",
								children: gitLine
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
								id: "worktree-new-session",
								title: t("settings.newSession.label"),
								description: t("settings.newSession.hint"),
								control: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
									checked: state.newSessionWorktree.text === "true",
									label: t("settings.newSession.label"),
									disabled: readOnly,
									className: SettingsSection_module_css_default.switchHit,
									onChange: (next) => {
										props.edit("newSessionWorktree", String(next));
									}
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
								id: "worktree-nested",
								title: t("settings.nested.label"),
								description: t("settings.nested.hint"),
								control: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
									checked: createsNested,
									label: t("settings.nested.label"),
									disabled: readOnly,
									className: SettingsSection_module_css_default.switchHit,
									onChange: (next) => {
										props.edit("nestedRepositories", next ? "all" : "none");
									}
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
								id: "worktree-scan-depth",
								title: t("settings.depth.label"),
								description: createsNested ? t("settings.depth.hint") : t("settings.depth.inactive"),
								control: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "text",
									inputMode: "numeric",
									className: `${SettingsSection_module_css_default.input} ${SettingsSection_module_css_default.inputNumber}`,
									"aria-labelledby": "worktree-scan-depth-label",
									"aria-describedby": "worktree-scan-depth-message",
									"aria-invalid": state.nestedScanDepth.invalid || void 0,
									value: state.nestedScanDepth.text,
									disabled: readOnly || !createsNested,
									onChange: (event) => {
										props.edit("nestedScanDepth", event.target.value);
									}
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
								id: "worktree-default-path",
								title: t("settings.layout.label"),
								description: t(layoutPathKey(state.defaultPath.text)),
								control: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChoiceRow, {
									id: "worktree-default-path",
									label: t("settings.layout.label"),
									text: state.defaultPath.text,
									options: WORKTREE_LAYOUTS.map((value) => ({
										value,
										label: t(`option.${value}`)
									})),
									disabled: readOnly,
									onEdit: (value) => {
										props.edit("defaultPath", value);
									}
								})
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Card, {
						id: "backup",
						title: t("settings.backup.cardTitle"),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
								id: "worktree-file-guard",
								title: t("settings.guard.label"),
								description: t("settings.guard.hint"),
								control: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
									checked: guardsFiles,
									label: t("settings.guard.label"),
									disabled: readOnly,
									className: SettingsSection_module_css_default.switchHit,
									onChange: (next) => {
										props.edit("fileGuard", String(next));
									}
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
								id: "worktree-deny-destructive",
								title: t("settings.deny.label"),
								description: guardsFiles ? t("settings.deny.hint") : t("settings.deny.inactive"),
								control: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
									checked: state.denyDestructiveCommands.text !== "false",
									label: t("settings.deny.label"),
									disabled: readOnly || !guardsFiles,
									onChange: (next) => {
										props.edit("denyDestructiveCommands", String(next));
									}
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
								id: "worktree-backup-sidebar",
								title: t("settings.backupSidebar.label"),
								description: guardsFiles ? t("settings.backupSidebar.hint") : t("settings.backupSidebar.inactive"),
								control: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
									checked: state.backupSidebar.text === "true",
									label: t("settings.backupSidebar.label"),
									disabled: readOnly || !guardsFiles,
									className: SettingsSection_module_css_default.switchHit,
									onChange: (next) => {
										props.edit("backupSidebar", String(next));
									}
								})
							})
						]
					}),
					report === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
						text: report.text,
						...reportProps,
						onDone: () => {
							setReport((current) => current?.seq === report.seq ? null : current);
						}
					}, report.seq)
				]
			});
		}
		/**
		* The dictionary key naming one layout's directory.
		* @param value - the staged layout, empty before the Host answers.
		* @returns the key holding that layout's path.
		*/
		function layoutPathKey(value) {
			return `layout.path.${WORKTREE_LAYOUTS.includes(value) ? value : WORKTREE_LAYOUTS[0]}`;
		}
		//#endregion
		//#region src/client/settings-fields.ts
		/**
		* The settings page's field vocabulary: which policy fields it edits, and how
		* each one converts between its stored value and the text its control renders.
		*
		* This sits apart from `settings-store.ts` on purpose. The store subscribes to
		* the Host's settings scope, which carries a runtime dependency the self-contained
		* spec runner cannot resolve; the conversion rules carry none, so keeping them
		* here is what lets them be exercised without a composed Host. The same
		* reasoning as `policy.ts`, which the browser bundle also imports directly.
		*
		* @module @guowenzhang/dsh-worktree/client/settings-fields
		*/
		/**
		* Every switch field, with the schema default an absent value resolves to.
		*
		* Three of the four default to `true` and one to `false`, so a single
		* `SWITCH_DEFAULT` would have to lie about somebody. These entries must move
		* with the `DEFAULT_*` constants in `policy.ts`: a page that renders "on" for a
		* switch that is off has the user "fix" a setting that was already correct,
		* which is worse than showing nothing.
		*/
		const SWITCH_DEFAULTS = {
			fileGuard: true,
			denyDestructiveCommands: true,
			newSessionWorktree: false,
			backupSidebar: true
		};
		/** Every policy field the settings page edits, in the order the page renders them. */
		const WORKTREE_SETTINGS_FIELDS = [
			"newSessionWorktree",
			"nestedRepositories",
			"defaultPath",
			"nestedScanDepth",
			"fileGuard",
			"denyDestructiveCommands",
			"backupSidebar"
		];
		/**
		* Whether a field is a switch rather than a picker, number, or string.
		* @param field - the field to test.
		* @returns true when the field's control is a switch.
		*/
		function isSwitchField(field) {
			return Object.hasOwn(SWITCH_DEFAULTS, field);
		}
		/**
		* The schema default one switch resolves to when nothing is stored.
		* @param field - the switch field being read.
		* @returns the default the Host's schema would apply.
		*/
		function switchDefault(field) {
			return SWITCH_DEFAULTS[field] ?? false;
		}
		/**
		* Render a field's stored value as the draft text its control reads.
		*
		* A picker or a number with no stored value renders as the empty string, which
		* is what "nothing chosen yet" means for those controls. A switch renders the
		* schema default instead, because for a boolean the absent value is a real
		* setting rather than an empty selection.
		* @param field - the field being rendered.
		* @param value - the section's stored value, when it carries one.
		* @returns the draft text.
		*/
		function formatSetting(field, value) {
			if (isSwitchField(field)) return typeof value === "boolean" ? String(value) : String(switchDefault(field));
			return value === void 0 ? "" : String(value);
		}
		/**
		* Convert draft text into the value a save writes.
		*
		* The empty string is the schema default for a switch; for every other field it
		* is not a value at all, which is what makes a cleared input block the save
		* rather than writing `null`.
		* @param field - the field being written.
		* @param text - the draft text.
		* @returns the value to write, or undefined when the text is not a value this field accepts.
		*/
		function parseSetting(field, text) {
			if (field === "nestedRepositories") return NESTED_REPOSITORY_POLICIES.includes(text) ? text : void 0;
			if (field === "defaultPath") return WORKTREE_LAYOUTS.includes(text) ? text : void 0;
			if (isSwitchField(field)) {
				if (text === "true") return true;
				if (text === "false") return false;
				return text === "" ? switchDefault(field) : void 0;
			}
			const number = Number(text);
			return text.trim() !== "" && Number.isSafeInteger(number) && number > 0 ? number : void 0;
		}
		//#endregion
		//#region src/client/settings-store.ts
		/**
		* Automatically persist the worktree policy through the Host's shared settings
		* scope. Writes are serialized; drafts typed while a write is in flight stay
		* visible and are sent next, rather than being cleared by the older response.
		* @module @guowenzhang/dsh-worktree/client/settings-store
		*/
		/** Bridges automatic, revision-fenced writes onto the Host's live policy. */
		var WorktreeSettingsController = class {
			scope;
			store;
			drafts = /* @__PURE__ */ new Map();
			pending = /* @__PURE__ */ new Map();
			unsubscribe;
			saving = false;
			failedFields = /* @__PURE__ */ new Set();
			failedWrites = 0;
			disposed = false;
			constructor(scope) {
				this.scope = scope;
				this.store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)(this.projection());
				this.unsubscribe = scope.subscribe(() => {
					this.publish();
				});
			}
			/**
			* One field as its control renders it.
			* @param field - the field being read.
			* @returns the control's staged state.
			*/
			field(field) {
				const snapshot = this.scope.getSnapshot();
				const draft = this.drafts.get(field);
				const value = snapshot.value?.[field];
				return {
					text: draft !== void 0 ? draft : formatSetting(field, value),
					overridden: draft !== void 0 || Object.hasOwn(snapshot.user ?? {}, field),
					invalid: draft !== void 0 && parseSetting(field, draft) === void 0
				};
			}
			projection() {
				const snapshot = this.scope.getSnapshot();
				return {
					available: snapshot.status === "ready",
					writable: snapshot.writable,
					dirty: this.drafts.size > 0,
					invalid: [...this.drafts].some(([field, text]) => parseSetting(field, text) === void 0),
					saving: this.saving,
					failed: this.failedFields.size > 0,
					failedSeq: this.failedWrites,
					newSessionWorktree: this.field("newSessionWorktree"),
					nestedRepositories: this.field("nestedRepositories"),
					defaultPath: this.field("defaultPath"),
					nestedScanDepth: this.field("nestedScanDepth"),
					fileGuard: this.field("fileGuard"),
					denyDestructiveCommands: this.field("denyDestructiveCommands"),
					backupSidebar: this.field("backupSidebar")
				};
			}
			inject() {
				return {
					hooks: { worktreeSettings: this.store },
					edit: (field, text) => {
						this.edit(field, text);
					}
				};
			}
			edit(name, text) {
				if (!WORKTREE_SETTINGS_FIELDS.includes(name)) throw new Error(`unknown worktree setting ${name}`);
				const snapshot = this.scope.getSnapshot();
				if (this.disposed || snapshot.status !== "ready" || !snapshot.writable) return;
				const field = name;
				if (!this.saving && !this.drafts.has(field) && this.field(field).text === text) return;
				this.drafts.set(field, text);
				if (parseSetting(field, text) === void 0) this.pending.delete(field);
				else this.pending.set(field, text);
				this.publish();
				this.flush();
			}
			async flush() {
				if (this.saving || this.disposed) return;
				this.saving = true;
				try {
					while (this.pending.size > 0 && !this.disposed) {
						const snapshot = this.scope.getSnapshot();
						if (snapshot.status !== "ready" || !snapshot.writable) break;
						const batch = new Map(this.pending);
						this.pending.clear();
						const ops = [...batch].map(([field, text]) => ({
							op: "set",
							path: [field],
							value: parseSetting(field, text)
						}));
						this.publish();
						let accepted = false;
						try {
							accepted = await this.scope.mutate(ops, snapshot.revision);
						} catch {}
						if (this.disposed) return;
						if (accepted) for (const [field, text] of batch) {
							this.failedFields.delete(field);
							if (this.drafts.get(field) === text && !this.pending.has(field)) this.drafts.delete(field);
						}
						else {
							this.failedWrites += 1;
							for (const field of batch.keys()) this.failedFields.add(field);
						}
					}
				} finally {
					this.saving = false;
					this.publish();
				}
			}
			publish() {
				if (!this.disposed) this.store.set(this.projection());
			}
			/** Stop subscriptions and unsent writes when the plugin is unloaded. */
			dispose() {
				this.disposed = true;
				this.pending.clear();
				this.unsubscribe();
			}
		};
		//#endregion
		//#region src/client/git-accounts/AccountsCard.tsx
		/**
		* Render the accounts card.
		* @param props - the listed accounts, the scan's state, the row actions, and copy.
		* @returns the card.
		*/
		function AccountsCard({ accounts, selectedId, scanning, scanError, onAdd, onScan, onViewProjects, onRemove, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: GitAccountsPage_module_css_default.card,
				"aria-labelledby": "git-accounts-accounts-heading",
				"data-git-accounts-card": "accounts",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: GitAccountsPage_module_css_default.cardHead,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: GitAccountsPage_module_css_default.cardText,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
								className: GitAccountsPage_module_css_default.cardTitle,
								id: "git-accounts-accounts-heading",
								children: t("gitAccounts.accounts.title")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: GitAccountsPage_module_css_default.cardDescription,
								children: t("gitAccounts.accounts.description")
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: GitAccountsPage_module_css_default.cardActions,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "outline",
								size: "sm",
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutlineRegular, {}),
								disabled: scanning,
								onClick: onScan,
								children: scanning ? t("gitAccounts.accounts.scanning") : t("gitAccounts.accounts.scan")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "primary",
								size: "sm",
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular, {}),
								onClick: onAdd,
								children: t("gitAccounts.accounts.add")
							})]
						})]
					}),
					scanError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: GitAccountsPage_module_css_default.inlineError,
						role: "alert",
						"data-scan-error": "true",
						children: t("gitAccounts.scan.failed", { message: scanError })
					}),
					accounts.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: GitAccountsPage_module_css_default.empty,
						"data-accounts-empty": "true",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: GitAccountsPage_module_css_default.emptyText,
							children: t("gitAccounts.accounts.empty")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: GitAccountsPage_module_css_default.emptyHint,
							children: t("gitAccounts.accounts.emptyHint")
						})]
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: GitAccountsPage_module_css_default.accountList,
						"aria-label": t("gitAccounts.accounts.list"),
						children: accounts.map((account) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountRow, {
							account,
							selected: account.id === selectedId,
							onViewProjects,
							onRemove,
							t
						}, account.id))
					})
				]
			});
		}
		/**
		* One account's row.
		* @param props - the account, whether it is selected, the two row actions, and copy.
		* @returns the row.
		*/
		function AccountRow({ account, selected, onViewProjects, onRemove, t }) {
			const brand = PROVIDER_BRANDS[account.provider];
			const nameLine = [account.name, account.email].filter((value) => value !== void 0 && value !== "");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: selected ? `${GitAccountsPage_module_css_default.accountRow} ${GitAccountsPage_module_css_default.accountRowSelected}` : GitAccountsPage_module_css_default.accountRow,
				"data-account-id": account.id,
				"data-account-provider": account.provider,
				"data-account-selected": selected ? "true" : "false",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: GitAccountsPage_module_css_default.accountMain,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: GitAccountsPage_module_css_default.accountTitleRow,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: GitAccountsPage_module_css_default.accountLogin,
									children: account.login
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
									tone: "neutral",
									className: GitAccountsPage_module_css_default.accountTag,
									children: brand
								}),
								account.auth === "ssh" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
									tone: "outline",
									children: t("gitAccounts.auth.sshBadge")
								}) : null,
								account.verified ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									title: t("gitAccounts.account.unverifiedHint"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
										tone: "warning",
										children: t("gitAccounts.auth.unverifiedBadge")
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: GitAccountsPage_module_css_default.accountHost,
									children: account.host
								})
							]
						}),
						nameLine.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: GitAccountsPage_module_css_default.accountSub,
							children: nameLine.join(" · ")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: GitAccountsPage_module_css_default.accountMeta,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("gitAccounts.account.origin", { origin: t(ORIGIN_KEYS[account.origin]) }) }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									"aria-hidden": "true",
									children: " · "
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("gitAccounts.account.addedAt", { date: formatDate(account.addedAt) }) })
							]
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: GitAccountsPage_module_css_default.accountActions,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "outline",
						size: "sm",
						"aria-label": t("gitAccounts.account.viewProjectsOne", { login: account.login }),
						onClick: () => {
							onViewProjects(account);
						},
						children: t("gitAccounts.account.viewProjects")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "ghost",
						size: "sm",
						className: GitAccountsPage_module_css_default.dangerAction,
						"aria-label": t("gitAccounts.account.removeOne", { login: account.login }),
						onClick: () => {
							onRemove(account);
						},
						children: t("gitAccounts.account.remove")
					})]
				})]
			});
		}
		//#endregion
		//#region src/client/git-accounts/IdentityCard.tsx
		/**
		* The Git identity card: the global `user.name` and `user.email` every commit on
		* this machine records.
		*
		* The form is staged locally and written as one pair, because the Host validates
		* both fields before writing either one. An empty field is the reader's way to
		* clear that key, so the save control stays enabled for an emptied pair and the
		* copy says so; what it cannot do is save a change that is not there, which is
		* why an unchanged pair leaves the control inert.
		*
		* A Host that cannot read Git's global configuration disables the form with the
		* reason beside it instead of offering a save that can only fail.
		* @module @guowenzhang/dsh-worktree/client/git-accounts/IdentityCard
		*/
		/**
		* Render the Git identity card.
		* @param props - the identity, the write, its success hook, and copy.
		* @returns the card.
		*/
		function IdentityCard({ identity, save, onSaved, t }) {
			const [name, setName] = (0, react.useState)(identity.name);
			const [email, setEmail] = (0, react.useState)(identity.email);
			const [feedback, setFeedback] = (0, react.useState)({ kind: "idle" });
			const lastSynced = (0, react.useRef)(identity);
			(0, react.useEffect)(() => {
				const previous = lastSynced.current;
				lastSynced.current = identity;
				if (previous.name === identity.name && previous.email === identity.email && previous.available === identity.available) return;
				setName(identity.name);
				setEmail(identity.email);
			}, [identity]);
			const available = identity.available;
			const saving = feedback.kind === "saving";
			const dirty = name.trim() !== identity.name || email.trim() !== identity.email;
			const disabled = !available || saving;
			const submit = () => {
				if (disabled || !dirty) return;
				setFeedback({ kind: "saving" });
				save({
					name: name.trim(),
					email: email.trim()
				}).then((result) => {
					if (!result.ok) {
						setFeedback({
							kind: "failed",
							message: result.message
						});
						return;
					}
					setFeedback({ kind: "saved" });
					onSaved(result.value.identity);
				});
			};
			const reason = identity.error === "git_missing" ? t("gitAccounts.identity.gitMissing") : t("gitAccounts.identity.gitFailed");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: GitAccountsPage_module_css_default.card,
				"aria-labelledby": "git-accounts-identity-heading",
				"data-git-accounts-card": "identity",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: GitAccountsPage_module_css_default.cardHead,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: GitAccountsPage_module_css_default.cardText,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
								className: GitAccountsPage_module_css_default.cardTitle,
								id: "git-accounts-identity-heading",
								children: t("gitAccounts.identity.title")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: GitAccountsPage_module_css_default.cardDescription,
								children: t("gitAccounts.identity.description")
							})]
						})
					}),
					available ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: GitAccountsPage_module_css_default.warning,
						role: "status",
						"data-identity-unavailable": "true",
						children: [
							t("gitAccounts.identity.unavailable"),
							" ",
							reason
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: GitAccountsPage_module_css_default.form,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: GitAccountsPage_module_css_default.field,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: GitAccountsPage_module_css_default.fieldLabel,
									children: t("gitAccounts.identity.name")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: GitAccountsPage_module_css_default.input,
									type: "text",
									autoComplete: "off",
									spellCheck: false,
									value: name,
									disabled,
									placeholder: t("gitAccounts.identity.namePlaceholder"),
									onChange: (event) => {
										setName(event.target.value);
										setFeedback({ kind: "idle" });
									}
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: GitAccountsPage_module_css_default.field,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: GitAccountsPage_module_css_default.fieldLabel,
									children: t("gitAccounts.identity.email")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: GitAccountsPage_module_css_default.input,
									type: "email",
									autoComplete: "off",
									spellCheck: false,
									value: email,
									disabled,
									placeholder: t("gitAccounts.identity.emailPlaceholder"),
									onChange: (event) => {
										setEmail(event.target.value);
										setFeedback({ kind: "idle" });
									}
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: GitAccountsPage_module_css_default.formActions,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "primary",
									disabled: disabled || !dirty,
									onClick: submit,
									children: saving ? t("gitAccounts.identity.saving") : t("gitAccounts.identity.save")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: feedback.kind === "failed" ? `${GitAccountsPage_module_css_default.feedback} ${GitAccountsPage_module_css_default.feedbackFailed}` : GitAccountsPage_module_css_default.feedback,
									role: "status",
									"data-identity-feedback": feedback.kind,
									children: feedback.kind === "saved" ? t("gitAccounts.identity.saved") : feedback.kind === "failed" ? t("gitAccounts.identity.saveFailed", { message: feedback.message }) : null
								})]
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/git-accounts/ProjectsSection.tsx
		/**
		* The projects card: which account's projects are on screen, a search over the
		* rows already loaded, and the rows themselves.
		*
		* The card reads one page at a time through the injected `projects` call, and
		* only when a reader selects an account: a page that listed projects for every
		* account on mount would spend one Host request per row without anyone asking.
		* A failed read keeps whatever rows are already shown, because losing the list
		* the reader was reading is worse than a line saying the next read failed.
		*
		* The rows carry no mutation: this capability lists projects to identify them.
		* Copying the HTTPS clone URL and opening the project in a browser are the two
		* actions a project row has, and cloning stays out of scope.
		* @module @guowenzhang/dsh-worktree/client/git-accounts/ProjectsSection
		*/
		/** One visibility's tag tone: public is healthy, internal is informational, the rest neutral. */
		const VISIBILITY_TONES = {
			public: "success",
			private: "neutral",
			internal: "info",
			unknown: "outline"
		};
		/** The card before any account is chosen. */
		const IDLE = {
			accountId: void 0,
			status: "idle",
			projects: [],
			hasMore: false,
			page: 0,
			more: false
		};
		/** How many rows the first read's skeleton draws. */
		const SKELETON_ROWS = 3;
		/**
		* Render the projects card.
		* @param props - the accounts, the selection, the Host read, and copy.
		* @returns the card.
		*/
		function ProjectsSection({ accounts, selectedId, onSelect, projects, t }) {
			const [state, setState] = (0, react.useState)(IDLE);
			const [revision, setRevision] = (0, react.useState)(0);
			const [query, setQuery] = (0, react.useState)("");
			const [copyResult, setCopyResult] = (0, react.useState)(void 0);
			(0, react.useEffect)(() => {
				if (selectedId === void 0) {
					setState(IDLE);
					return;
				}
				if (accounts.find((candidate) => candidate.id === selectedId)?.auth === "ssh") {
					setState({
						accountId: selectedId,
						status: "ssh",
						projects: [],
						hasMore: false,
						page: 0,
						more: false
					});
					return;
				}
				let active = true;
				setState((current) => current.accountId === selectedId ? {
					...current,
					status: "loading",
					more: false
				} : {
					accountId: selectedId,
					status: "loading",
					projects: [],
					hasMore: false,
					page: 0,
					more: false
				});
				projects(selectedId, 1).then((result) => {
					if (!active) return;
					if (result.ok) {
						setState({
							accountId: selectedId,
							status: "ready",
							projects: result.value.projects,
							hasMore: result.value.hasMore,
							page: 1,
							more: false
						});
						return;
					}
					setState((current) => ({
						accountId: selectedId,
						status: "failed",
						projects: current.accountId === selectedId ? current.projects : [],
						hasMore: current.accountId === selectedId ? current.hasMore : false,
						page: current.accountId === selectedId ? current.page : 0,
						more: false,
						message: result.message
					}));
				});
				return () => {
					active = false;
				};
			}, [
				accounts,
				projects,
				selectedId,
				revision
			]);
			(0, react.useEffect)(() => {
				setQuery("");
				setCopyResult(void 0);
			}, [selectedId]);
			const loadMore = () => {
				const current = state;
				if (selectedId === void 0 || current.accountId !== selectedId) return;
				if (current.status === "loading" || current.more || !current.hasMore) return;
				const nextPage = current.page + 1;
				setState((previous) => ({
					...previous,
					more: true
				}));
				projects(selectedId, nextPage).then((result) => {
					setState((previous) => {
						if (previous.accountId !== selectedId) return previous;
						if (!result.ok) return {
							...previous,
							more: false,
							status: "failed",
							message: result.message
						};
						const seen = new Set(previous.projects.map((project) => project.id));
						const appended = result.value.projects.filter((project) => !seen.has(project.id));
						return {
							...previous,
							more: false,
							status: "ready",
							projects: [...previous.projects, ...appended],
							hasMore: result.value.hasMore,
							page: nextPage
						};
					});
				});
			};
			const copy = (project) => {
				(0, _deepseek_ai_dsh_client_ui_primitives.writeClipboard)(project.httpsUrl).then((ok) => {
					setCopyResult({
						id: project.id,
						ok
					});
				});
			};
			const account = accounts.find((candidate) => candidate.id === selectedId);
			const shown = state.accountId === selectedId ? state : {
				...IDLE,
				accountId: selectedId,
				status: selectedId === void 0 ? "idle" : "loading"
			};
			const search = query.trim().toLowerCase();
			const filtered = search === "" ? shown.projects : shown.projects.filter((project) => project.name.toLowerCase().includes(search) || project.fullName.toLowerCase().includes(search));
			const loading = shown.status === "loading" && shown.projects.length === 0;
			const failed = shown.status === "failed" && shown.message !== void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: GitAccountsPage_module_css_default.card,
				"aria-labelledby": "git-accounts-projects-heading",
				"aria-busy": shown.status === "loading" || shown.more,
				"data-git-accounts-card": "projects",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: GitAccountsPage_module_css_default.cardHead,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: GitAccountsPage_module_css_default.cardText,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							className: GitAccountsPage_module_css_default.cardTitle,
							id: "git-accounts-projects-heading",
							children: t("gitAccounts.projects.title")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: GitAccountsPage_module_css_default.cardDescription,
							children: t("gitAccounts.projects.description")
						})]
					}), account === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: GitAccountsPage_module_css_default.projectAccount,
						children: [
							PROVIDER_BRANDS[account.provider],
							" · ",
							account.host
						]
					})]
				}), accounts.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: GitAccountsPage_module_css_default.empty,
					"data-projects-empty": "no-account",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: GitAccountsPage_module_css_default.emptyText,
						children: t("gitAccounts.projects.emptyNoAccount")
					})
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: GitAccountsPage_module_css_default.chips,
					role: "group",
					"aria-label": t("gitAccounts.projects.accounts"),
					children: accounts.map((candidate) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: GitAccountsPage_module_css_default.chip,
						"aria-pressed": candidate.id === selectedId,
						onClick: () => {
							onSelect(candidate.id);
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: GitAccountsPage_module_css_default.chipBrand,
							children: PROVIDER_BRANDS[candidate.provider]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: GitAccountsPage_module_css_default.chipLogin,
							children: candidate.login
						})]
					}, candidate.id))
				}), selectedId === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: GitAccountsPage_module_css_default.empty,
					"data-projects-empty": "unchosen",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: GitAccountsPage_module_css_default.emptyText,
						children: t("gitAccounts.projects.choose")
					})
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: GitAccountsPage_module_css_default.projects,
					children: [
						shown.status === "ssh" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: GitAccountsPage_module_css_default.empty,
							"data-projects-empty": "ssh",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: GitAccountsPage_module_css_default.emptyText,
								children: t("gitAccounts.projects.sshUnavailable")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: GitAccountsPage_module_css_default.emptyHint,
								children: t("gitAccounts.projects.sshUnavailableHint")
							})]
						}) : null,
						failed ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: GitAccountsPage_module_css_default.inlineErrorRow,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: GitAccountsPage_module_css_default.inlineError,
								role: "alert",
								"data-projects-error": "true",
								children: t("gitAccounts.projects.failed", { message: shown.message ?? "" })
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "outline",
								size: "sm",
								onClick: () => {
									setRevision((value) => value + 1);
								},
								children: t("gitAccounts.retry")
							})]
						}) : null,
						shown.projects.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: GitAccountsPage_module_css_default.searchRow,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								type: "search",
								...GitAccountsPage_module_css_default.search === void 0 ? {} : { className: GitAccountsPage_module_css_default.search },
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutlineRegular, {}),
								value: query,
								placeholder: t("gitAccounts.projects.searchPlaceholder"),
								"aria-label": t("gitAccounts.projects.search"),
								onChange: (event) => {
									setQuery(event.target.value);
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: GitAccountsPage_module_css_default.count,
								role: "status",
								children: search === "" ? t("gitAccounts.projects.count", { count: String(shown.projects.length) }) : t("gitAccounts.projects.searchCount", {
									shown: String(filtered.length),
									total: String(shown.projects.length)
								})
							})]
						}),
						loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: GitAccountsPage_module_css_default.skeletonList,
							role: "status",
							"aria-label": t("gitAccounts.projects.loading"),
							"data-projects-loading": "true",
							children: Array.from({ length: SKELETON_ROWS }, (_, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: GitAccountsPage_module_css_default.skeletonRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: GitAccountsPage_module_css_default.skeletonBar }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `${GitAccountsPage_module_css_default.skeletonBar} ${GitAccountsPage_module_css_default.skeletonBarShort}` })]
							}, index))
						}) : null,
						shown.status === "ready" && shown.projects.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: GitAccountsPage_module_css_default.empty,
							"data-projects-empty": "none",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: GitAccountsPage_module_css_default.emptyText,
								children: t("gitAccounts.projects.empty")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: GitAccountsPage_module_css_default.emptyHint,
								children: t("gitAccounts.projects.emptyHint")
							})]
						}) : null,
						filtered.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: GitAccountsPage_module_css_default.projectList,
							"aria-label": t("gitAccounts.projects.title"),
							children: filtered.map((project) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectRow, {
								project,
								copyResult,
								onCopy: copy,
								t
							}, project.id))
						}),
						search !== "" && filtered.length === 0 && shown.projects.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: GitAccountsPage_module_css_default.noMatch,
							role: "status",
							children: t("gitAccounts.projects.noMatch")
						}) : null,
						shown.hasMore ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: GitAccountsPage_module_css_default.loadMoreRow,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "outline",
								size: "sm",
								disabled: shown.more,
								onClick: loadMore,
								children: shown.more ? t("gitAccounts.projects.loadingMore") : t("gitAccounts.projects.loadMore")
							})
						}) : null
					]
				})] })]
			});
		}
		/**
		* Split a project's namespaced path into the namespace and the project's own
		* name, so the name is the emphasized part of the path the row shows.
		* @param project - the project whose path to split.
		* @returns the namespace prefix (empty when the path does not end with the name).
		*/
		function pathPrefix(project) {
			if (project.fullName === project.name || !project.fullName.endsWith(project.name)) return "";
			return project.fullName.slice(0, project.fullName.length - project.name.length);
		}
		/**
		* One project's row: what it is, who can see it, where it lives, and the two
		* actions that identify it outside the page.
		* @param props - the project, the last copy outcome, the copy action, and copy.
		* @returns the row.
		*/
		function ProjectRow({ project, copyResult, onCopy, t }) {
			const prefix = pathPrefix(project);
			const copied = copyResult?.id === project.id ? copyResult : void 0;
			const copyLabel = copied === void 0 ? t("gitAccounts.projects.copy") : copied.ok ? t("gitAccounts.projects.copied") : t("gitAccounts.projects.copyFailed");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: GitAccountsPage_module_css_default.projectRow,
				"data-project-id": project.id,
				"data-project-visibility": project.visibility,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: GitAccountsPage_module_css_default.projectMain,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: GitAccountsPage_module_css_default.projectHead,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: GitAccountsPage_module_css_default.projectPath,
								title: project.fullName,
								"data-project-path": project.fullName,
								children: [prefix === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: GitAccountsPage_module_css_default.projectNamespace,
									children: prefix
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: GitAccountsPage_module_css_default.projectName,
									children: project.name
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
								tone: VISIBILITY_TONES[project.visibility],
								children: t(VISIBILITY_KEYS[project.visibility])
							})]
						}),
						project.description === void 0 || project.description === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: GitAccountsPage_module_css_default.projectDescription,
							children: project.description
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: GitAccountsPage_module_css_default.projectMeta,
							children: [project.defaultBranch === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("gitAccounts.projects.branch", { branch: project.defaultBranch }) }), project.updatedAt === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("gitAccounts.projects.updated", { date: formatDate(project.updatedAt) }) })]
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: GitAccountsPage_module_css_default.projectActions,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "ghost",
						size: "sm",
						icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCopyOutlineRegular, {}),
						className: copied?.ok === false ? `${GitAccountsPage_module_css_default.copyButton} ${GitAccountsPage_module_css_default.copyFailed}` : GitAccountsPage_module_css_default.copyButton,
						"aria-label": t("gitAccounts.projects.copyOne", { name: project.name }),
						onClick: () => {
							onCopy(project);
						},
						children: copyLabel
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
						className: GitAccountsPage_module_css_default.openLink,
						href: project.webUrl,
						target: "_blank",
						rel: "noreferrer",
						"aria-label": t("gitAccounts.projects.openOne", { name: project.name }),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconLinkOutlineRegular, { size: 14 }), t("gitAccounts.projects.open")]
					})]
				})]
			});
		}
		//#endregion
		//#region src/client/git-accounts/GitAccountsPage.tsx
		/**
		* The Git-accounts page: a global main panel for the machine's Git
		* authorizations, its Git identity, a scan of what this machine already
		* authorizes, and the projects those accounts can reach.
		*
		* The page is registered as one main-panel key and one sidebar row that selects
		* it, so it is not bound to a Session and keeps none of its data in a Session.
		* Everything it reads and writes arrives through the injected face built by
		* `createGitAccountsFace`; the page itself has no transport, no credential
		* access, and no token visible anywhere in its markup.
		*
		* A successful snapshot is retained across refreshes and failures: the cards go
		* on showing what was last read while a banner names the failed read and offers
		* a retry. The three cards answer, in order, who the commits say the operator
		* is, which authorizations this machine holds, and what one of those accounts
		* can list.
		* @module @guowenzhang/dsh-worktree/client/git-accounts/GitAccountsPage
		*/
		/**
		* Render the Git-accounts page.
		* @param props - the main-panel seat, this plugin's copy, and the data face.
		* @returns the page.
		*/
		function GitAccountsPage(props) {
			const { snapshot, addAccount, verifyAccount, sshKeys, removeAccount, scan, projects, saveIdentity, t } = props;
			const [state, setState] = (0, react.useState)({
				status: "loading",
				loaded: false,
				accounts: []
			});
			const [reload, setReload] = (0, react.useState)(0);
			const [selectedId, setSelectedId] = (0, react.useState)(void 0);
			const [addOpen, setAddOpen] = (0, react.useState)(false);
			const [removeTarget, setRemoveTarget] = (0, react.useState)(void 0);
			const [removing, setRemoving] = (0, react.useState)(false);
			const [removeError, setRemoveError] = (0, react.useState)(void 0);
			const [scanning, setScanning] = (0, react.useState)(false);
			const [scanError, setScanError] = (0, react.useState)(void 0);
			const [notice, setNotice] = (0, react.useState)(void 0);
			const noticeSeq = (0, react.useRef)(0);
			const announce = (text) => {
				noticeSeq.current += 1;
				setNotice({
					text,
					seq: noticeSeq.current
				});
			};
			(0, react.useEffect)(() => {
				let active = true;
				setState((current) => ({
					...current,
					status: "loading"
				}));
				snapshot().then((result) => {
					if (!active) return;
					if (result.ok) {
						setState({
							status: "ready",
							loaded: true,
							accounts: result.value.accounts,
							identity: result.value.identity
						});
						return;
					}
					setState((current) => ({
						...current,
						status: "failed",
						message: result.message
					}));
				});
				return () => {
					active = false;
				};
			}, [snapshot, reload]);
			const selected = state.accounts.find((candidate) => candidate.id === selectedId);
			const handleAdded = (result) => {
				setAddOpen(false);
				setState((current) => ({
					...current,
					accounts: current.accounts.some((account) => account.id === result.account.id) ? current.accounts.map((account) => account.id === result.account.id ? result.account : account) : [...current.accounts, result.account]
				}));
				announce(result.account.verified === false ? t("gitAccounts.account.addedUnverified", { login: result.account.login }) : t(result.created ? "gitAccounts.account.added" : "gitAccounts.account.updated", { login: result.account.login }));
			};
			const handleRemove = () => {
				if (removeTarget === void 0 || removing) return;
				const target = removeTarget;
				setRemoving(true);
				setRemoveError(void 0);
				removeAccount(target.id).then((result) => {
					setRemoving(false);
					if (!result.ok) {
						setRemoveError(result.message);
						return;
					}
					setRemoveTarget(void 0);
					setState((current) => ({
						...current,
						accounts: current.accounts.filter((account) => account.id !== target.id)
					}));
					announce(t("gitAccounts.account.removed", { login: target.login }));
				});
			};
			const handleScan = () => {
				if (scanning) return;
				setScanning(true);
				setScanError(void 0);
				scan().then((result) => {
					setScanning(false);
					if (!result.ok) {
						setScanError(result.message);
						return;
					}
					setState((current) => ({
						...current,
						accounts: result.value.accounts
					}));
					announce(scanResultText(result.value.report, t));
				});
			};
			const askRemove = (account) => {
				setRemoveError(void 0);
				setRemoveTarget(account);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: GitAccountsPage_module_css_default.page,
				"aria-labelledby": "git-accounts-heading",
				"aria-busy": state.status === "loading",
				"data-git-accounts-page": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: GitAccountsPage_module_css_default.content,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
								className: GitAccountsPage_module_css_default.heading,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: GitAccountsPage_module_css_default.headingText,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", {
										className: GitAccountsPage_module_css_default.title,
										id: "git-accounts-heading",
										children: t("gitAccounts.title")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: GitAccountsPage_module_css_default.description,
										children: t("gitAccounts.description")
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: GitAccountsPage_module_css_default.headingActions,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "ghost",
										size: "sm",
										icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, {}),
										"aria-label": t("gitAccounts.refresh"),
										title: t("gitAccounts.refresh"),
										disabled: state.status === "loading",
										onClick: () => {
											setReload((value) => value + 1);
										}
									})
								})]
							}),
							state.status === "failed" && state.message !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: GitAccountsPage_module_css_default.errorBanner,
								role: "status",
								"data-git-accounts-error": "true",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: GitAccountsPage_module_css_default.errorText,
									children: t("gitAccounts.loadFailed", { message: state.message })
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "outline",
									size: "sm",
									onClick: () => {
										setReload((value) => value + 1);
									},
									children: t("gitAccounts.retry")
								})]
							}) : null,
							!state.loaded && state.status === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: GitAccountsPage_module_css_default.loadingCard,
								role: "status",
								"aria-label": t("gitAccounts.loading"),
								"data-git-accounts-loading": "true",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: GitAccountsPage_module_css_default.skeletonLine }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: GitAccountsPage_module_css_default.skeletonLine }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `${GitAccountsPage_module_css_default.skeletonLine} ${GitAccountsPage_module_css_default.skeletonLineShort}` })
								]
							}) : null,
							state.identity === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IdentityCard, {
								identity: state.identity,
								save: saveIdentity,
								onSaved: (identity) => {
									setState((current) => ({
										...current,
										identity
									}));
								},
								t
							}),
							!state.loaded ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountsCard, {
								accounts: state.accounts,
								selectedId: selected?.id,
								scanning,
								scanError,
								onAdd: () => {
									setAddOpen(true);
								},
								onScan: handleScan,
								onViewProjects: (account) => {
									setSelectedId(account.id);
								},
								onRemove: askRemove,
								t
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectsSection, {
								accounts: state.accounts,
								selectedId: selected?.id,
								onSelect: setSelectedId,
								projects,
								t
							})] })
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AddAccountDialog, {
						open: addOpen,
						onClose: () => {
							setAddOpen(false);
						},
						addAccount,
						verifyAccount,
						sshKeys,
						onAdded: handleAdded,
						t
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RemoveAccountDialog, {
						account: removeTarget,
						busy: removing,
						error: removeError,
						onClose: () => {
							if (removing) return;
							setRemoveTarget(void 0);
							setRemoveError(void 0);
						},
						onConfirm: handleRemove,
						t
					}),
					notice === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
						text: notice.text,
						tone: "success",
						onDone: () => {
							setNotice((current) => current?.seq === notice.seq ? void 0 : current);
						}
					}, notice.seq)
				]
			});
		}
		//#endregion
		//#region src/client/git-accounts/GitAccountsIcon.tsx
		/**
		* Render the Git-accounts icon at the size the sidebar asks for.
		* @param props - the sidebar's icon share: the requested edge; `active` is the
		* owner's selection state, which this glyph does not style itself.
		* @returns the icon element.
		*/
		function GitAccountsIcon({ size }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutlineRegular, { size });
		}
		//#endregion
		//#region src/client/git-accounts-api.ts
		/**
		* Browser client of the `/worktree/git/api` Host route.
		*
		* The page never fetches: it is registered with one {@link GitAccountsInjected}
		* face built here, so every call has the same transport, the same refusal
		* handling, and the same rule that a token is only ever written toward the
		* Host. A transport failure is folded into the same result union as a Host
		* refusal, which is what lets the page show a failure where the affected
		* control sits instead of owning an exception path per call.
		* @module @guowenzhang/dsh-worktree/client/git-accounts-api
		*/
		/** The route prefix both halves agree on. */
		const ROUTE = "/worktree/git/api";
		/**
		* Call one method of the Git-accounts route.
		* @param method - route method name.
		* @param body - JSON request body.
		* @returns the parsed value, or the Host's refusal.
		*/
		async function gitRequest(method, body) {
			let response;
			try {
				response = await fetch(`${ROUTE}/${method}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body)
				});
			} catch (error) {
				return {
					ok: false,
					message: `the Git accounts route is unreachable: ${error instanceof Error ? error.message : String(error)}`
				};
			}
			const text = await response.text();
			let parsed;
			try {
				parsed = JSON.parse(text);
			} catch {
				return {
					ok: false,
					message: `the Git accounts route answered ${response.status} with a non-JSON body`
				};
			}
			if (!response.ok) {
				const message = readErrorMessage(parsed) ?? `the Git accounts route answered ${response.status}`;
				const code = readErrorCode(parsed);
				return {
					ok: false,
					message,
					...code === void 0 ? {} : { code }
				};
			}
			return {
				ok: true,
				value: parsed
			};
		}
		/**
		* Read the error text out of a refusal body.
		* @param parsed - the decoded response body.
		* @returns the message, or undefined when the body carries none.
		*/
		function readErrorMessage(parsed) {
			if (parsed === null || typeof parsed !== "object") return void 0;
			const error = parsed.error;
			if (error === null || typeof error !== "object") return void 0;
			const message = error.message;
			return typeof message === "string" && message.length > 0 ? message : void 0;
		}
		/**
		* Read a failure code out of a refusal body, keeping only codes both halves know.
		* @param parsed - the decoded response body.
		* @returns the code, or undefined when the body carries none or an unknown one.
		*/
		function readErrorCode(parsed) {
			if (parsed === null || typeof parsed !== "object") return void 0;
			const error = parsed.error;
			if (error === null || typeof error !== "object") return void 0;
			const code = error.code;
			return typeof code === "string" && GIT_ACCOUNTS_ERROR_CODES.includes(code) ? code : void 0;
		}
		/**
		* Build the data face the Git-accounts page is registered with.
		*
		* One face is built per plugin activation, and the same object is returned on
		* every injection: a page remount must not need a new transport.
		* @param call - the route call to use; tests pass their own.
		* @returns the page's injected face.
		*/
		function createGitAccountsFace(call = gitRequest) {
			return {
				snapshot: () => call("snapshot", {}),
				addAccount: (input) => call("accounts.add", {
					provider: input.provider,
					host: input.host,
					...input.auth === void 0 ? {} : { auth: input.auth },
					...input.token === void 0 ? {} : { token: input.token },
					...input.keyPath === void 0 ? {} : { keyPath: input.keyPath }
				}),
				verifyAccount: (input) => call("accounts.verify", {
					provider: input.provider,
					host: input.host,
					...input.auth === void 0 ? {} : { auth: input.auth },
					...input.token === void 0 ? {} : { token: input.token },
					...input.keyPath === void 0 ? {} : { keyPath: input.keyPath }
				}),
				sshKeys: () => call("ssh.keys", {}),
				removeAccount: (id) => call("accounts.remove", { id }),
				scan: () => call("accounts.scan", {}),
				projects: (accountId, page) => call("projects.list", {
					accountId,
					page
				}),
				saveIdentity: (identity) => call("identity.set", {
					name: identity.name,
					email: identity.email
				})
			};
		}
		//#endregion
		//#region src/client/index.ts
		/** This implementation's identity in the right Sidebar's tab system. */
		const BACKUP_TAB_ID = "@guowenzhang/dsh-worktree/backup";
		/** The tab kind the file-backup page is opened as. */
		const BACKUP_TAB_KIND = "worktree-backup";
		/**
		* Main-panel key of the Git-accounts page, which is also the `sidebar.panellist`
		* row id that selects it: the sidebar addresses a panel by the key the `main`
		* slot was registered under, so the two cannot drift apart.
		*/
		const GIT_ACCOUNTS_PANEL_ID = "git-accounts";
		/** Required services (cordis fiber inject). */
		const inject = [
			"slots",
			"locale",
			"conversation",
			"uiWorkspace",
			"configForms"
		];
		/**
		* Register the dictionaries, the new-session worktree chip, and the settings page.
		* @param ctx - the browser plugin context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-worktree: dictionaries");
			const t = ctx.locale.bind(NS);
			const settingsScope = ctx.configForms.get(SETTINGS_NAMESPACE);
			const settings = new WorktreeSettingsController(settingsScope);
			ctx.effect(() => () => {
				settings.dispose();
			}, "ui-worktree: settings form subscription");
			const gitAccountsFace = createGitAccountsFace();
			/**
			* Leave the settings dialog for the Git-accounts panel. The panel is selected
			* through the layout service read at call time: a replaced layout must be the
			* one this navigation uses, and a deployment without one keeps the settings
			* card's own list working.
			*/
			const openAccountsPage = () => {
				ctx.get("layout")?.selectPanel(GIT_ACCOUNTS_PANEL_ID);
			};
			ctx.effect(() => ctx.configForms.whileServed([SETTINGS_NAMESPACE], () => ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "worktree",
				order: 30,
				label: () => t("settings.nav"),
				locale: NS,
				inject: () => ({
					...settings.inject(),
					gitAccounts: gitAccountsFace,
					openAccountsPage
				})
			}, WorktreeSettingsSection))), "ui-worktree: settings page");
			ctx.inject(["slots"], (scope) => {
				scope.slots.inject("main", () => scope.slots.register({
					name: "main",
					key: GIT_ACCOUNTS_PANEL_ID,
					locale: NS,
					inject: () => gitAccountsFace
				}, GitAccountsPage));
				scope.slots.inject("sidebar.panellist", () => scope.slots.register({
					name: "sidebar.panellist",
					id: GIT_ACCOUNTS_PANEL_ID,
					order: 20,
					label: () => t("gitAccounts.nav"),
					locale: NS
				}, GitAccountsIcon));
			});
			const backupFace = {
				list: (sessionId) => request("backups", { sessionId }),
				restore: (sessionId, relative) => request("restore", {
					sessionId,
					relative
				}),
				compare: (sessionId, relative) => request("compare", {
					sessionId,
					relative
				})
			};
			ctx.inject(["slots", "sidebarRightTabs"], (scope) => {
				const tabs = scope.sidebarRightTabs;
				const definition = {
					id: BACKUP_TAB_ID,
					kind: BACKUP_TAB_KIND,
					title: () => t("sidebar.title"),
					guide: [{
						id: "backup",
						order: 40,
						title: () => t("sidebar.title"),
						description: () => t("sidebar.description"),
						icon: _deepseek_ai_dsh_client_ui_primitives.PluginArtworkLoop
					}]
				};
				const offered = () => settingsScope.getSnapshot().value?.backupSidebar !== false;
				scope.effect(() => {
					let registration;
					const sync = () => {
						if (offered() === (registration !== void 0)) return;
						if (offered()) registration = tabs.register(definition);
						else {
							registration?.();
							registration = void 0;
						}
					};
					const unsubscribe = settingsScope.subscribe(sync);
					sync();
					return () => {
						unsubscribe();
						registration?.();
						registration = void 0;
					};
				}, "ui-worktree: change history sidebar type");
				scope.effect(() => scope.slots.inject("sidebar.right.pane.tab", () => scope.slots.register({
					name: "sidebar.right.pane.tab",
					key: BACKUP_TAB_ID,
					locale: NS,
					inject: () => backupFace
				}, BackupPanel)), "ui-worktree: change history page body");
			});
			const checkoutNotices = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)([]);
			ctx.inject(["slots", "workspaces"], (scope) => {
				const workspaces = scope.get("workspaces");
				if (workspaces === void 0) return;
				/**
				* Ask the Host what the archive flow did to a path whose row is gone.
				* A refusal or an unreachable route reports `unknown`, which shows nothing.
				*/
				const probe = async (path) => {
					const result = await request("checkout", { path });
					return result.ok ? result.value : { outcome: "unknown" };
				};
				scope.effect(() => observeCheckouts(workspaces, probe, checkoutNotices), "ui-worktree: checkout notices");
				scope.slots.inject("shell.overlay", () => scope.slots.register({
					name: "shell.overlay",
					id: "worktree-checkout",
					order: 100,
					locale: NS,
					inject: () => ({
						hooks: { notices: checkoutNotices },
						probe,
						text: (notice) => t(notice.outcome === "removed" ? "checkout.removed" : "checkout.kept", {
							path: notice.path,
							reason: notice.reason ?? ""
						}),
						dismiss: (seq) => {
							checkoutNotices.set(checkoutNotices.getSnapshot().filter((entry) => entry.seq !== seq));
						}
					})
				}, CheckoutNoticeToast));
			});
			ctx.inject([
				"slots",
				"conversation",
				"sessions",
				"uiWorkspace"
			], (scope) => {
				const controller = new WorktreeSeatController();
				/** Whether this surface may still choose: a blank Session is on screen. */
				const editable = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)(false);
				/** Catalog subscription for the Session on screen; replaced by each load. */
				let gate;
				scope.effect(() => () => {
					gate?.();
				}, "ui-worktree: session gate");
				/** The Session the seat currently describes, so a switch resets it. */
				let shown;
				const sessions = () => scope.get("sessions");
				const cwdOf = (sessionId) => sessions()?.list.getSnapshot().byId[sessionId]?.cwd;
				/**
				* Whether one Session may still choose where it runs.
				*
				* The dock's owner props identify the Session on screen, so this reads that
				* Session's own row rather than searching the catalog: `blank` is the
				* Client's "no turn has run yet" fact, and a Session's working directory is
				* fixed once a turn runs.
				* @param sessionId - the Session the composer belongs to.
				* @returns true when the choice is still open.
				*/
				const isEditable = (sessionId) => {
					return (sessions()?.list.getSnapshot().byId[sessionId])?.blank === true;
				};
				/**
				* Whether the deployment asks for a checkout without a click.
				*
				* Read live rather than captured: the settings page edits this while the
				* plugin runs, and the next blank Session is what the new answer applies to.
				* An absent value is the schema's own default, which is off.
				* @returns true when a new Session should start in a worktree on its own.
				*/
				const startsInWorktree = () => settingsScope.getSnapshot().value?.newSessionWorktree === true;
				/**
				* Show the Session the Host started in the new checkout, carrying the draft
				* the user had typed on the screen they are leaving.
				*
				* The Host created that Session outside this Client's Session Controller,
				* so its id is not in the catalog when the route answers, and navigation
				* refuses an identity it cannot resolve. Pulling the list first catalogues
				* it; the second pull covers the first await having joined a list read that
				* had already started before the Session existed.
				* @param sessionId - the Session the route started.
				* @param sourceId - the Session on screen when the start was asked for, so a
				* later switch during the Git run cannot move the wrong draft.
				*/
				const openStarted = async (sessionId, sourceId) => {
					const service = sessions();
					if (service === void 0) throw new Error("worktree: sessions service unavailable");
					const catalogued = () => service.list.getSnapshot().byId[sessionId] !== void 0;
					await service.refresh();
					if (!catalogued()) await service.refresh();
					if (sourceId === void 0) {
						scope.uiWorkspace.openSession(sessionId);
						return;
					}
					if (shown !== sourceId) return;
					openWithDraft(scope, service, sourceId, sessionId, () => {
						scope.uiWorkspace.openSession(sessionId);
					});
				};
				/**
				* Spend the seat: start the Session in a new checkout and open it.
				*
				* The Session on screen travels with the call, so a switch during the Git
				* run cannot move the wrong draft.
				*/
				const startSeat = () => {
					const sourceId = shown;
					controller.start((sessionId) => openStarted(sessionId, sourceId));
				};
				const evaluate = (sessionId) => {
					const editableNow = isEditable(sessionId);
					editable.set(editableNow);
					if (sessionId !== shown) {
						shown = sessionId;
						controller.resetStart();
					}
					controller.load(editableNow ? cwdOf(sessionId) : void 0).then(() => {
						if (editableNow && controller.autoStart(sessionId, startsInWorktree())) startSeat();
					});
				};
				const injected = () => ({
					hooks: {
						worktreeSeat: controller.store,
						editable
					},
					load: async (sessionId) => {
						evaluate(sessionId);
						const list = sessions()?.list;
						if (list === void 0) return;
						gate?.();
						gate = list.subscribe(() => {
							evaluate(sessionId);
						});
					},
					loadBranches: () => controller.loadBranches(),
					selectBase: (base) => {
						controller.selectBase(base);
					},
					setEnabled: (enabled) => {
						controller.setEnabled(enabled);
						if (enabled) startSeat();
					}
				});
				scope.slots.inject("conversation.input.dock", () => scope.slots.register({
					name: "conversation.input.dock",
					id: "worktree",
					order: -10,
					locale: NS,
					inject: injected
				}, WorktreeChip));
			});
		}
		//#endregion
		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		exports.observeCheckouts = observeCheckouts;
		return module.exports;
	}
});
