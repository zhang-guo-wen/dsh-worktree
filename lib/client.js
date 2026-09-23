window.__ModuleLoader__.load({
	id: "@zhang-guo-wen/dsh-worktree",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-css:C:\02-codespace\deepseek-harness\dsh-worktree\src\client\WorktreeChip.module.css.mjs
		const css = ".RJ5EIW_row{justify-content:flex-end;padding:0 16px;display:flex}[data-phase=hero] .RJ5EIW_row,[data-content-phase=hero] .RJ5EIW_row{height:0;margin:-8px 0;position:relative}.RJ5EIW_pill{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);border-radius:8px;align-items:stretch;height:28px;display:inline-flex;overflow:hidden}[data-phase=hero] .RJ5EIW_pill,[data-content-phase=hero] .RJ5EIW_pill{max-width:min(100% - 32px,560px);position:absolute;bottom:100%;right:16px}.RJ5EIW_branch{min-width:0;height:100%;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;align-items:center;gap:4px;padding:0 8px;font-family:inherit;font-size:13px;font-weight:500;line-height:20px;display:inline-flex}.RJ5EIW_branch:not(:disabled):hover,.RJ5EIW_branch[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}.RJ5EIW_branch:disabled{cursor:default;color:var(--dsw-alias-label-quaternary)}.RJ5EIW_branchIcon{flex:none}.RJ5EIW_branchLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;max-width:16ch;overflow:hidden}.RJ5EIW_chevron{color:var(--dsw-alias-label-tertiary);flex:none}.RJ5EIW_divider{background:var(--dsw-alias-border-l2);flex:none;align-self:stretch;width:1px}.RJ5EIW_seat{white-space:nowrap;cursor:pointer;height:100%;padding:0 8px;font-size:13px;line-height:20px}.RJ5EIW_seat:has(input:disabled){cursor:default}.RJ5EIW_seatIconError{color:var(--dsw-alias-label-danger,#d33);flex:none;margin-right:6px}";
		const tagId = "@zhang-guo-wen/dsh-worktree/WorktreeChip.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
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
			"seatIconError": "RJ5EIW_seatIconError"
		};
		//#endregion
		//#region src/client/WorktreeChip.tsx
		/**
		* The worktree control on the new-session screen.
		*
		* One pill holds both facts the choice is made of: the local branch a new
		* branch starts from, and whether the session moves into a new checkout at all.
		* It sits beside the workspace picker and the agent-preset chip and mirrors
		* their geometry, because it is the same kind of choice: what the session will
		* BE. A session's working directory is fixed at creation, so this control is
		* available only while the session is blank and the choice cannot be revised
		* afterwards — starting a new session is the way to change it.
		*
		* The worktree half is one-way: checking it creates the checkout and starts the
		* session inside it, and nothing checks it back off. A failed start leaves it
		* unchecked with its reason, and the next check retries.
		* @module @zhang-guo-wen/dsh-worktree/client/WorktreeChip
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
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutlineRegular, { className: WorktreeChip_module_css_default.branchIcon }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: WorktreeChip_module_css_default.branchLabel,
										children: baseLabel
									}),
									!locked && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { className: WorktreeChip_module_css_default.chevron })
								]
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: WorktreeChip_module_css_default.divider,
							"aria-hidden": "true"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Checkbox, {
							checked: state.enabled || locked,
							disabled: busy || locked,
							label: busy ? t("seat.creating") : t("seat.label"),
							title: locked ? lockedHint : state.error ?? t("seat.hint"),
							onChange: () => {
								setEnabled(true);
							},
							className: WorktreeChip_module_css_default.seat
						}),
						state.error !== null && !locked && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { className: WorktreeChip_module_css_default.seatIconError })
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
		* @module @zhang-guo-wen/dsh-worktree/client/api
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
		* @module @zhang-guo-wen/dsh-worktree/client/seat-store
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
		//#region src/client/locales.ts
		/**
		* Copy for the worktree surfaces, in the shapes its surfaces render.
		* @module @zhang-guo-wen/dsh-worktree/client/locales
		*/
		/** Dictionary namespace for this plugin's UI copy. */
		const NS = "worktree";
		/** Chinese copy (the package's primary locale). */
		const zh = {
			"seat.label": "worktree",
			"seat.hint": "创建当前工作区的一个独立 Git worktree，并在其中开启这个会话。",
			"seat.creating": "创建中…",
			"seat.applied": "已在该 worktree 中运行：{branch}；这个选择不能再改",
			"branch.hint": "新分支从哪个本地分支开始",
			"branch.head": "HEAD"
		};
		/** English copy. */
		const en = {
			"seat.label": "worktree",
			"seat.hint": "Create an isolated Git worktree of this workspace and start this session inside it.",
			"seat.creating": "Creating…",
			"seat.applied": "Running in this worktree: {branch}; the choice can no longer change",
			"branch.hint": "Local branch the new branch starts from",
			"branch.head": "HEAD"
		};
		//#endregion
		//#region src/client/index.ts
		/** Required services (cordis fiber inject). */
		const inject = [
			"slots",
			"locale",
			"conversation",
			"uiWorkspace"
		];
		/**
		* Register the dictionaries and the new-session worktree chip.
		* @param ctx - the browser plugin context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-worktree: dictionaries");
			ctx.locale.bind(NS);
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
