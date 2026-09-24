window.__ModuleLoader__.load({
	id: "@guowenzhang/dsh-worktree",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-css:C:\02-codespace\deepseek-harness\dsh-worktree\src\client\WorktreeChip.module.css.mjs
		const css$1 = ".RJ5EIW_row{justify-content:flex-end;padding:0 16px;display:flex}[data-phase=hero] .RJ5EIW_row,[data-content-phase=hero] .RJ5EIW_row{height:0;margin:-8px 0;position:relative}.RJ5EIW_pill{box-sizing:border-box;background:0 0;border:none;border-radius:12px;align-items:stretch;height:24px;display:inline-flex;overflow:hidden}[data-phase=hero] .RJ5EIW_pill,[data-content-phase=hero] .RJ5EIW_pill{max-width:min(100% - 44px,560px);position:absolute;bottom:calc(100% + 4px);right:28px}.RJ5EIW_branch{min-width:0;height:100%;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;align-items:center;gap:4px;padding:0 8px;font-family:inherit;font-size:13px;font-weight:500;line-height:20px;display:inline-flex}.RJ5EIW_branch:not(:disabled):hover,.RJ5EIW_branch[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}.RJ5EIW_branch:disabled{cursor:default;color:var(--dsw-alias-label-quaternary)}.RJ5EIW_branchIcon{flex:none}.RJ5EIW_branchLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;max-width:16ch;overflow:hidden}.RJ5EIW_chevron{color:var(--dsw-alias-label-tertiary);flex:none}.RJ5EIW_divider{background:var(--dsw-alias-border-l2);flex:none;align-self:center;width:1px;height:12px}.RJ5EIW_seat{height:100%;color:var(--dsw-alias-label-primary);white-space:nowrap;cursor:pointer;border-radius:12px;align-items:center;gap:6px;padding:0 8px;font-size:13px;font-weight:500;line-height:20px;display:inline-flex}.RJ5EIW_seat:not(:has(input:disabled)):hover{background:var(--dsw-alias-interactive-bg-hover)}.RJ5EIW_seat:has(input:disabled){cursor:default;opacity:.5}.RJ5EIW_seat input{width:14px;height:14px;accent-color:var(--dsw-alias-brand-primary);cursor:inherit;flex:none;margin:0}.RJ5EIW_seat input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.RJ5EIW_seatGlyph{color:var(--dsw-alias-label-primary);flex:none;align-items:center;display:inline-flex}.RJ5EIW_seatIconError{color:var(--dsw-alias-label-danger,#d33);flex:none;margin-right:6px}";
		const tagId$1 = "@guowenzhang/dsh-worktree/WorktreeChip.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var WorktreeChip_module_css_default = {
			"branch": "RJ5EIW_branch",
			"branchIcon": "RJ5EIW_branchIcon",
			"branchLabel": "RJ5EIW_branchLabel",
			"chevron": "RJ5EIW_chevron",
			"divider": "RJ5EIW_divider",
			"pill": "RJ5EIW_pill",
			"row": "RJ5EIW_row",
			"seat": "RJ5EIW_seat",
			"seatGlyph": "RJ5EIW_seatGlyph",
			"seatIconError": "RJ5EIW_seatIconError"
		};
		//#endregion
		//#region src/client/WorktreeChip.tsx
		/**
		* The worktree control on the new-session screen.
		*
		* One pill holds both facts the choice is made of: the local branch a new
		* branch starts from, and whether the session moves into a new checkout at all.
		* It sits beside the workspace picker and the agent-preset chip and follows
		* their geometry — the same ghost row, the same rounded ends — drawn one step
		* smaller and clear of the composer card's corner.
		*
		* A session's working directory is fixed at creation, so this control is
		* available only while the session is blank and the choice cannot be revised
		* afterwards — starting a new session is the way to change it.
		*
		* The worktree half is one-way: checking it creates the checkout and starts the
		* session inside it, and nothing checks it back off. A failed start leaves it
		* unchecked with its reason, and the next check retries.
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
			const baseLabel = state.base === "HEAD" ? t("branch.head") : state.base;
			const lockedHint = t("seat.applied", { branch: state.checkoutBranch });
			const options = state.branches ?? [state.base];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: WorktreeChip_module_css_default.row,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: WorktreeChip_module_css_default.pill,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
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
							className: WorktreeChip_module_css_default.seat,
							title: locked ? lockedHint : state.error ?? t("seat.hint"),
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
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: busy ? t("seat.creating") : t("seat.label") })
							]
						}),
						state.error !== null && !locked && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, {
							className: WorktreeChip_module_css_default.seatIconError,
							size: 14
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/api.ts
		/**
		* Browser client of the `/worktree/api` Host route.
		*
		* The route carries the one operation this plugin's UI needs that no generic
		* Remote exposes: create a checkout, register its project, and start a session
		* in it. Everything else (listing workspaces, opening a session) goes through
		* the composed client services.
		* @module @guowenzhang/dsh-worktree/client/api
		*/
		/** The route prefix both halves agree on. */
		const ROUTE = "/worktree/api";
		/**
		* Call one method of the worktree route.
		* @param method - route method name.
		* @param body - JSON request body.
		* @returns the parsed value, or the Host's refusal text.
		*/
		async function request(method, body) {
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
			if (!response.ok) return {
				ok: false,
				message: readErrorMessage(parsed) ?? `the worktree route answered ${response.status}`
			};
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
			error: null
		};
		/**
		* Owns the staged choice for the session currently on the new-session screen.
		*/
		var WorktreeSeatController = class {
			/** Snapshot the renderer subscribes to. */
			store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)(INITIAL);
			/** Only the newest probe may publish, so a late reply cannot revive a stale answer. */
			probeGeneration = 0;
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
				this.set({ started: null });
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
					error: null
				});
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
						error: result.message
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
					error: null
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
		//#region src/client/locales.ts
		/** Dictionary namespace for this plugin's UI copy. */
		const NS = "worktree";
		/** Chinese copy (the package's primary locale). */
		const zh = {
			"seat.label": "worktree",
			"seat.hint": "创建当前工作区的一个独立 Git worktree，并在其中开启这个会话。",
			"seat.creating": "创建中…",
			"seat.applied": "已在该 worktree 中运行：{branch}；这个选择不能再改",
			"branch.hint": "新分支从哪个本地分支开始",
			"branch.head": "HEAD",
			"settings.nav": "Worktree",
			"settings.title": "worktree 配置",
			"settings.nested.label": "创建子仓库",
			"settings.nested.hint": "创建 worktree 时同步创建子模块和子仓库。",
			"settings.depth.label": "扫描层级",
			"settings.depth.hint": "递归扫描目录层数。",
			"settings.depth.inactive": "递归扫描目录层数（需先开启「创建子仓库」）。",
			"settings.layout.label": "worktree 存储位置",
			"layout.path.agents": "<工作区>/.agents/worktree/<分支>",
			"layout.path.sibling": "<仓库名>-wt-<分支>，建在仓库旁边",
			"layout.path.home": "~/.agents/worktree/<分支>，整机共享",
			"option.agents": "工作区内",
			"option.sibling": "仓库同级",
			"option.home": "用户目录",
			"option.none": "只建父仓库",
			"option.submodules": "带上子模块",
			"option.all": "带上所有子仓库",
			"settings.reset": "恢复默认",
			"settings.readOnly": "本部署的设置为只读。",
			"settings.unavailable": "该插件当前未加载，暂时无法配置。",
			"settings.save": "保存",
			"settings.saving": "保存中…",
			"settings.saveFailed": "本部署没有接受这些值，已保留供你修改。",
			"settings.invalidNumber": "请填数字；留空表示使用默认值。"
		};
		/** English copy. */
		const en = {
			"seat.label": "worktree",
			"seat.hint": "Create an isolated Git worktree of this workspace and start this session inside it.",
			"seat.creating": "Creating…",
			"seat.applied": "Running in this worktree: {branch}; the choice can no longer change",
			"branch.hint": "Local branch the new branch starts from",
			"branch.head": "HEAD",
			"settings.nav": "Worktree",
			"settings.title": "Worktree settings",
			"settings.nested.label": "Create nested repositories",
			"settings.nested.hint": "Create submodules and nested repositories along with the worktree.",
			"settings.depth.label": "Scan depth",
			"settings.depth.hint": "How many directory levels are searched recursively.",
			"settings.depth.inactive": "How many directory levels are searched recursively (turn on Create nested repositories first).",
			"settings.layout.label": "Worktree location",
			"layout.path.agents": "<workspace>/.agents/worktree/<branch>",
			"layout.path.sibling": "<repo>-wt-<branch>, beside the repository",
			"layout.path.home": "~/.agents/worktree/<branch>, shared by the machine",
			"option.agents": "In the workspace",
			"option.sibling": "Beside the repository",
			"option.home": "User directory",
			"option.none": "Parent only",
			"option.submodules": "With submodules",
			"option.all": "With every nested repository",
			"settings.reset": "Reset to default",
			"settings.readOnly": "This deployment stores settings read-only.",
			"settings.unavailable": "This plugin is not loaded, so it cannot be configured right now.",
			"settings.save": "Save",
			"settings.saving": "Saving…",
			"settings.saveFailed": "The deployment did not accept these values; they were left for you to correct.",
			"settings.invalidNumber": "Enter a number, or leave blank to use the default."
		};
		/**
		* The shared settings form's frame copy, read from this plugin's dictionary.
		* @param t - this plugin's locale reader.
		* @returns the labels the settings form renders.
		*/
		function formLabels(t) {
			return {
				unavailable: t("settings.unavailable"),
				readOnly: t("settings.readOnly"),
				saveFailed: t("settings.saveFailed"),
				save: t("settings.save"),
				saving: t("settings.saving")
			};
		}
		//#endregion
		//#region \0dsh-css:C:\02-codespace\deepseek-harness\dsh-worktree\src\client\SettingsSection.module.css.mjs
		const css = "._9Iyffq_page{flex-direction:column;width:100%;display:flex}._9Iyffq_pageTitle{color:var(--dsw-alias-label-primary);margin:0 0 8px;font-size:16px;font-weight:500;line-height:24px}._9Iyffq_notice{color:var(--dsw-alias-label-tertiary);margin:0 0 12px;font-size:12px;line-height:1.5}._9Iyffq_row{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex}._9Iyffq_rowText{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}._9Iyffq_title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}._9Iyffq_desc{max-width:62ch;color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}._9Iyffq_control{flex:none;align-items:center;gap:8px;display:inline-flex}._9Iyffq_choices{background:var(--dsw-alias-interactive-bg-hover);border-radius:18px;grid-auto-columns:1fr;grid-auto-flow:column;gap:2px;padding:3px;display:inline-grid;position:relative}._9Iyffq_indicator{width:calc((100% - 6px - 2px * (var(--dsh-choice-count) - 1)) / var(--dsh-choice-count));background:var(--dsw-alias-bg-layer-1);height:calc(100% - 6px);box-shadow:var(--dsw-elevation-soft);transform:translateX(calc(var(--dsh-choice-index) * (100% + 2px)));pointer-events:none;border-radius:15px;transition:transform .16s;position:absolute;top:3px;left:3px}._9Iyffq_choice{z-index:1;height:30px;color:var(--dsw-alias-label-secondary);font:inherit;white-space:nowrap;cursor:pointer;background:0 0;border:0;border-radius:15px;padding:0 14px;font-size:13px;font-weight:500;line-height:20px;transition:color .12s;position:relative}._9Iyffq_choice:hover:not(:disabled),._9Iyffq_choice[aria-pressed=true]{color:var(--dsw-alias-label-primary)}._9Iyffq_choice:disabled{cursor:default;opacity:.4}._9Iyffq_choice:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}@media (prefers-reduced-motion:reduce){._9Iyffq_indicator,._9Iyffq_choice{transition:none}}._9Iyffq_input{background:var(--dsw-alias-bg-module-platform);height:36px;font:inherit;color:var(--dsw-alias-label-primary);border:none;border-radius:18px;padding:0 14px;font-size:14px;line-height:22px}._9Iyffq_input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}._9Iyffq_input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}._9Iyffq_input[aria-invalid=true]{outline:2px solid var(--dsw-alias-state-error-primary);outline-offset:-1px}._9Iyffq_inputNumber{text-align:center;font-variant-numeric:tabular-nums;width:104px}._9Iyffq_footer{justify-content:flex-end;align-items:center;gap:8px;padding-top:16px;display:flex}._9Iyffq_failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}._9Iyffq_resetAll{appearance:none;border:1px solid var(--dsw-alias-border-l4);font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}._9Iyffq_resetAll:hover:not(:disabled){color:var(--dsw-alias-label-primary)}._9Iyffq_resetAll:disabled{opacity:.4;cursor:default}._9Iyffq_resetAll:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}._9Iyffq_save{appearance:none;font:inherit;cursor:pointer;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3);border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}._9Iyffq_save:disabled{opacity:.4;cursor:default}._9Iyffq_save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}";
		const tagId = "@guowenzhang/dsh-worktree/SettingsSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var SettingsSection_module_css_default = {
			"choice": "_9Iyffq_choice",
			"choices": "_9Iyffq_choices",
			"control": "_9Iyffq_control",
			"desc": "_9Iyffq_desc",
			"failed": "_9Iyffq_failed",
			"footer": "_9Iyffq_footer",
			"indicator": "_9Iyffq_indicator",
			"input": "_9Iyffq_input",
			"inputNumber": "_9Iyffq_inputNumber",
			"notice": "_9Iyffq_notice",
			"page": "_9Iyffq_page",
			"pageTitle": "_9Iyffq_pageTitle",
			"resetAll": "_9Iyffq_resetAll",
			"row": "_9Iyffq_row",
			"rowText": "_9Iyffq_rowText",
			"save": "_9Iyffq_save",
			"title": "_9Iyffq_title"
		};
		//#endregion
		//#region src/client/SettingsSection.tsx
		/**
		* The worktree settings page: the policy every later checkout is created under.
		*
		* Three rows, each the settings column's own two-column shape (label and
		* explanation left, control right), so this page reads like every other page
		* beside it. The rows are the three choices that actually change what a
		* checkout looks like: whether the child repositories come along, how deep the
		* search for them goes, and where the directory lands. Everything else the
		* entry accepts — the agent subdirectory, the git bound, the tool names — is
		* deployment composition, edited in the profile's own patch.
		*
		* The footer carries `[Reset to default] [Save]` together, which is why this
		* page renders its own frame instead of the shared one: the shared frame's
		* footer holds the save alone, and a reset that stands far from the rows it
		* clears is the control people forget exists. Staging and saving still come
		* from the shared form model.
		* @module @guowenzhang/dsh-worktree/client/SettingsSection
		*/
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
		* Render a row's choices as one row of buttons with a sliding selection.
		*
		* The buttons are the same control the Appearance row uses — buttons carrying
		* `aria-pressed` — because this is a preference, not a set of panels: tablist
		* semantics with no panel to control would promise navigation that does not
		* exist.
		* @param props - the row identity, its staged value, the labelled choices, and the write.
		* @returns the segmented control.
		*/
		function ChoiceRow(props) {
			const selected = props.options.findIndex((option) => option.value === props.text);
			const indicator = {
				"--dsh-choice-count": String(props.options.length),
				"--dsh-choice-index": String(Math.max(selected, 0))
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: SettingsSection_module_css_default.choices,
				style: indicator,
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
		* Render the worktree policy page.
		* @param props - the composition's other props, this plugin's copy, and the form face.
		* @returns the settings page.
		*/
		function WorktreeSettingsSection(props) {
			const { t } = props;
			const state = props.useWorktreeSettings((snapshot) => snapshot);
			const labels = formLabels(t);
			const readOnly = !state.writable;
			const createsNested = state.nestedRepositories.text !== "none";
			const overridden = [
				state.nestedRepositories,
				state.defaultPath,
				state.nestedScanDepth
			].some((field) => field.overridden);
			const discard = (0, react.useRef)(props.discard);
			discard.current = props.discard;
			(0, react.useEffect)(() => () => {
				discard.current();
			}, []);
			if (!state.available) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: SettingsSection_module_css_default.notice,
				role: "status",
				children: labels.unavailable
			});
			/**
			* Clear every row's override, so each one falls back to the composition
			* layer. The clears are staged like any other edit and ride the same save.
			*/
			const resetAll = () => {
				if (state.nestedRepositories.overridden) props.resetField("nestedRepositories");
				if (state.defaultPath.overridden) props.resetField("defaultPath");
				if (state.nestedScanDepth.overridden) props.resetField("nestedScanDepth");
			};
			const blocked = !state.dirty || state.invalid || state.saving;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: SettingsSection_module_css_default.page,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						className: SettingsSection_module_css_default.pageTitle,
						children: t("settings.title")
					}),
					!state.writable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: SettingsSection_module_css_default.notice,
						role: "status",
						children: labels.readOnly
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
						id: "worktree-nested",
						title: t("settings.nested.label"),
						description: t("settings.nested.hint"),
						control: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
							checked: createsNested,
							label: t("settings.nested.label"),
							disabled: readOnly,
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
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SettingsSection_module_css_default.footer,
						children: [
							state.failed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: SettingsSection_module_css_default.failed,
								role: "status",
								children: labels.saveFailed
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: SettingsSection_module_css_default.resetAll,
								disabled: readOnly || !overridden,
								onClick: resetAll,
								children: t("settings.reset")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: SettingsSection_module_css_default.save,
								disabled: blocked,
								onClick: props.save,
								children: state.saving ? labels.saving : labels.save
							})
						]
					})
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
		//#region src/client/settings-store.ts
		/**
		* A field restricted to a closed set of values.
		*
		* The shared text field would let a user type a policy the Host schema rejects;
		* this stages only a member of the set, and a draft outside it blocks the save
		* the way any other unaccepted draft does. An empty section reads as empty
		* rather than as a member nobody chose.
		* @param field - field name inside the namespace section.
		* @param allowed - the values the Host accepts for it.
		* @returns the field's conversion spec.
		*/
		function settingsChoiceField(field, allowed) {
			return {
				field,
				format: (value) => typeof value === "string" && allowed.includes(value) ? value : "",
				parse: (text) => allowed.includes(text) ? {
					kind: "set",
					value: text
				} : void 0
			};
		}
		/** Bridges the Host entry's live form onto the page's staged form. */
		var WorktreeSettingsController = class {
			form;
			store;
			/** @param scope - the shared configuration form of the entry running this plugin. */
			constructor(scope) {
				this.form = new _deepseek_ai_dsh_client_ui_primitives.SettingsFormModel(scope, [
					settingsChoiceField("nestedRepositories", NESTED_REPOSITORY_POLICIES),
					settingsChoiceField("defaultPath", WORKTREE_LAYOUTS),
					(0, _deepseek_ai_dsh_client_ui_primitives.settingsNumberField)("nestedScanDepth")
				]);
				this.store = this.form.bind(() => this.projection());
			}
			projection() {
				return {
					...this.form.shell(),
					nestedRepositories: this.form.field("nestedRepositories"),
					defaultPath: this.form.field("defaultPath"),
					nestedScanDepth: this.form.field("nestedScanDepth")
				};
			}
			/**
			* Build the face the page's slot registration injects.
			* @returns the page's snapshot and its form actions.
			*/
			inject() {
				return {
					hooks: { worktreeSettings: this.store },
					...this.form.actions()
				};
			}
			/** Release the form subscription. */
			dispose() {
				this.form.dispose();
			}
		};
		//#endregion
		//#region src/client/index.ts
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
			const settings = new WorktreeSettingsController(ctx.configForms.get(SETTINGS_NAMESPACE));
			ctx.effect(() => () => {
				settings.dispose();
			}, "ui-worktree: settings form subscription");
			ctx.effect(() => ctx.configForms.whileServed([SETTINGS_NAMESPACE], () => ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "worktree",
				order: 30,
				label: () => t("settings.nav"),
				locale: NS,
				inject: () => settings.inject()
			}, WorktreeSettingsSection))), "ui-worktree: settings page");
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
				const evaluate = (sessionId) => {
					const editableNow = isEditable(sessionId);
					editable.set(editableNow);
					if (sessionId !== shown) {
						shown = sessionId;
						controller.resetStart();
					}
					controller.load(editableNow ? cwdOf(sessionId) : void 0);
				};
				/**
				* Show the Session the Host started in the new checkout.
				*
				* The Host created that Session outside this Client's Session Controller,
				* so its id is not in the catalog when the route answers, and navigation
				* refuses an identity it cannot resolve. Pulling the list first catalogues
				* it; the second pull covers the first await having joined a list read that
				* had already started before the Session existed.
				* @param sessionId - the Session the route started.
				*/
				const openStarted = async (sessionId) => {
					const service = sessions();
					if (service === void 0) return;
					const catalogued = () => service.list.getSnapshot().byId[sessionId] !== void 0;
					await service.refresh();
					if (!catalogued()) await service.refresh();
					scope.uiWorkspace.openSession(sessionId);
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
						if (enabled) controller.start(openStarted);
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
		return module.exports;
	}
});
