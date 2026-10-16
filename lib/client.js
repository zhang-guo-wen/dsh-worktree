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
		const css$2 = ".KJP-8W_row{justify-content:flex-end;padding:0 16px;display:flex}[data-phase=hero] .KJP-8W_row,[data-content-phase=hero] .KJP-8W_row{height:0;margin:-8px 0;position:relative}.KJP-8W_pill{box-sizing:border-box;border-radius:var(--dsw-radius-md);background:0 0;border:none;align-items:stretch;height:24px;display:inline-flex;overflow:hidden}[data-phase=hero] .KJP-8W_pill,[data-content-phase=hero] .KJP-8W_pill{max-width:min(100% - 44px,560px);position:absolute;bottom:calc(100% + 4px);right:28px}@media (width<=600px){[data-phase=hero] .KJP-8W_row,[data-content-phase=hero] .KJP-8W_row{justify-content:flex-start;height:auto;margin:0;padding:0 20px}[data-phase=hero] .KJP-8W_pill,[data-content-phase=hero] .KJP-8W_pill{max-width:100%;position:static;bottom:auto;right:auto}.KJP-8W_branchMenu{flex:0 auto;min-width:0}.KJP-8W_branch{width:100%}.KJP-8W_seat{flex:none}}@media (width<=600px) and (pointer:coarse){.KJP-8W_pill{height:44px}}.KJP-8W_branch{min-width:0;height:100%;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-strong-13);cursor:pointer;background:0 0;border:none;align-items:center;gap:4px;padding:0 8px;display:inline-flex}.KJP-8W_branch:not(:disabled):hover,.KJP-8W_branch[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}.KJP-8W_branch:disabled{cursor:default;color:var(--dsw-alias-label-caption)}.KJP-8W_branchIcon{flex:none}.KJP-8W_branchLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;max-width:16ch;overflow:hidden}.KJP-8W_chevron{color:var(--dsw-alias-label-tertiary);flex:none}.KJP-8W_divider{background:var(--dsw-alias-border-l2);flex:none;align-self:center;width:1px;height:12px}.KJP-8W_seat{border-radius:var(--dsw-radius-md);height:100%;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-strong-13);white-space:nowrap;cursor:pointer;align-items:center;gap:6px;padding:0 8px;display:inline-flex}.KJP-8W_seat:not(:has(input:disabled)):hover{background:var(--dsw-alias-interactive-bg-hover)}.KJP-8W_seat:has(input:disabled){cursor:default;opacity:.5}.KJP-8W_seat input{width:14px;height:14px;accent-color:var(--dsw-alias-brand-primary);cursor:inherit;flex:none;margin:0}.KJP-8W_seat input:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}.KJP-8W_seatGlyph{color:var(--dsw-alias-label-primary);flex:none;align-items:center;display:inline-flex}.KJP-8W_seatFailed,.KJP-8W_seatFailed .KJP-8W_seatGlyph{color:var(--dsw-alias-state-error-primary)}.KJP-8W_seatIconError{color:var(--dsw-alias-state-error-primary);flex:none;margin-right:6px}.KJP-8W_seatIconWarn{color:var(--dsw-alias-label-secondary);flex:none;margin-right:6px}";
		const tagId$2 = "@guowenzhang/dsh-worktree/WorktreeChip.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$2) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.pluginCss = tagId$2;
			tag.textContent = css$2;
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
		//#region \0dsh-css:C:\02-codespace\DeepSeek\dsh-worktree\src\client\BackupPanel.module.css.mjs
		const css$1 = ".HXi-lW_page{height:100%;min-height:0;color:var(--dsw-alias-label-primary);flex-direction:column;flex:auto;display:flex}.HXi-lW_toolbar{box-sizing:border-box;border-bottom:.5px solid var(--dsw-alias-border-l3);flex:none;align-items:center;gap:4px;height:38px;padding:0 8px 0 16px;display:flex}.HXi-lW_count{white-space:nowrap;text-overflow:ellipsis;min-width:0;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);flex:auto;overflow:hidden}.HXi-lW_list{scrollbar-gutter:stable;flex:auto;min-height:0;margin:0 2px 0 0;padding:8px;list-style:none;overflow:auto}.HXi-lW_list::-webkit-scrollbar-track{margin:2px}.HXi-lW_row{box-sizing:border-box;border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:8px 10px;display:flex}.HXi-lW_list>.HXi-lW_row:last-child{border-bottom:0}.HXi-lW_rowText{flex-direction:column;flex:auto;gap:4px;min-width:0;display:flex}.HXi-lW_name{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}.HXi-lW_meta{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);flex-wrap:wrap;align-items:center;gap:6px;display:flex}.HXi-lW_failed{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;margin:0}.HXi-lW_notice{flex-direction:column;flex:none;align-items:flex-start;gap:8px;padding:12px 16px;display:flex}.HXi-lW_empty{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;margin:0;padding:16px}.HXi-lW_skeleton{border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-bg-skeleton);width:60%;height:14px;display:block}@media (pointer:coarse){.HXi-lW_row,.HXi-lW_action{min-height:44px}}";
		const tagId$1 = "@guowenzhang/dsh-worktree/BackupPanel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var BackupPanel_module_css_default = {
			"action": "HXi-lW_action",
			"count": "HXi-lW_count",
			"empty": "HXi-lW_empty",
			"failed": "HXi-lW_failed",
			"list": "HXi-lW_list",
			"meta": "HXi-lW_meta",
			"name": "HXi-lW_name",
			"notice": "HXi-lW_notice",
			"page": "HXi-lW_page",
			"row": "HXi-lW_row",
			"rowText": "HXi-lW_rowText",
			"skeleton": "HXi-lW_skeleton",
			"toolbar": "HXi-lW_toolbar"
		};
		//#endregion
		//#region src/client/BackupPanel.tsx
		/**
		* The file-backup page's body: one row per file this session's guard copied
		* before changing it, and the control that puts one copy back.
		*
		* The list is flat on purpose. The copies mirror the workspace's own tree, but
		* the question this page answers is "which files changed", and a reader
		* scanning for the file the AI just broke goes by name — so the row carries the
		* path that identifies it and nothing nests. That also keeps a restore's meaning
		* obvious: one row, one file, one button.
		*
		* Nothing here subscribes to anything. The list is read when the page mounts
		* and when the reader refreshes it, and a restore's outcome is this body's own
		* state, because no other surface shows it: the row keeps saying "restored"
		* until the next read, instead of vanishing the moment the copy lands, which
		* would leave the click that just succeeded looking like it did nothing.
		* @module @guowenzhang/dsh-worktree/client/BackupPanel
		*/
		/** Rows drawn while the first read is in flight. */
		const SKELETON_ROWS = 3;
		/**
		* Render the file-backup page.
		* @param props - the seat's runtime shares, this plugin's copy, and the data face.
		* @returns the page.
		*/
		function BackupPanel({ useTabInfo, sessionId, list, restore, t }) {
			const { tab } = useTabInfo();
			const [state, setState] = (0, react.useState)({
				status: "loading",
				entries: []
			});
			const [rows, setRows] = (0, react.useState)({});
			const [revision, setRevision] = (0, react.useState)(0);
			const alive = (0, react.useRef)(true);
			const reload = (0, react.useCallback)(() => {
				setRevision((value) => value + 1);
			}, []);
			(0, react.useEffect)(() => () => {
				alive.current = false;
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
			(0, react.useEffect)(() => tab.actions.bindCommands({ refresh: reload }), [tab.actions, reload]);
			const onRestore = (entry) => {
				setRows((current) => ({
					...current,
					[entry.relative]: { kind: "restoring" }
				}));
				restore(sessionId, entry.relative).then((result) => {
					if (!alive.current) return;
					const next = result.ok ? { kind: "restored" } : {
						kind: "failed",
						message: result.message
					};
					setRows((current) => ({
						...current,
						[entry.relative]: next
					}));
				});
			};
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
							row: rows[entry.relative],
							onRestore,
							t
						}, entry.relative))
					}) : state.status === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: BackupPanel_module_css_default.list,
						"data-backup-state": "loading",
						"aria-hidden": "true",
						children: Array.from({ length: SKELETON_ROWS }, (_, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
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
		* One file's row: what it is, how it differs, and the button that puts it back.
		* @param props - the entry, the row's own outcome, the restore action, and copy.
		* @returns the row.
		*/
		function Row$1({ entry, row, onRestore, t }) {
			const label = row?.kind === "restoring" ? t("sidebar.restoring") : row?.kind === "restored" ? t("sidebar.restored") : t("sidebar.restore");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: BackupPanel_module_css_default.row,
				"data-backup-row": entry.relative,
				"data-backup-file": entry.state,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: BackupPanel_module_css_default.rowText,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: BackupPanel_module_css_default.name,
						title: t("sidebar.copyAt", { path: entry.backup }),
						children: entry.name
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: BackupPanel_module_css_default.meta,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
							tone: entry.state === "deleted" ? "danger" : "warning",
							children: t(entry.state === "deleted" ? "sidebar.state.deleted" : "sidebar.state.modified")
						}), row?.kind === "failed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: BackupPanel_module_css_default.failed,
							children: t("sidebar.restoreFailed", { message: row.message })
						}) : null]
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					size: "sm",
					className: BackupPanel_module_css_default.action,
					disabled: row?.kind === "restoring" || row?.kind === "restored",
					"aria-label": t("sidebar.restoreOne", { name: entry.name }),
					onClick: () => {
						onRestore(entry);
					},
					children: label
				})]
			});
		}
		//#endregion
		//#region src/client/api.ts
		/**
		* Browser client of the `/worktree/api` Host route.
		*
		* The route carries the operations this plugin's UI needs that no generic
		* Remote exposes: create a checkout, register its project, and start a session
		* in it; list the files the guard copied before changing them, and put one
		* copy back. Everything else (listing workspaces, opening a session) goes
		* through the composed client services.
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
			if (!response.ok) {
				const message = readErrorMessage(parsed) ?? `the worktree route answered ${response.status}`;
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
		/** Read a machine-readable error code, when the Host supplied one. */
		function readErrorCode(parsed) {
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
			"settings.description": "使用 Worktree 创建独立空间，开始并行工作。",
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
			"settings.backupSidebar.label": "显示备份侧边栏",
			"settings.backupSidebar.hint": "在右侧边栏加入「文件备份」页，列出这个会话里被改动或删除的文件，可以逐个还原。",
			"settings.backupSidebar.inactive": "在右侧边栏加入「文件备份」页（需先开启「会话文件保护」）。",
			"sidebar.title": "文件备份",
			"sidebar.description": "列出这个会话里被改动或删除的文件，可以逐个还原。",
			"sidebar.loading": "正在读取备份…",
			"sidebar.empty": "这个会话还没有备份的文件。AI 改动已存在的文件之前会自动备一份，改坏或删除后就能在这里还原。",
			"sidebar.failed": "读取备份失败：{message}",
			"sidebar.retry": "重试",
			"sidebar.refresh": "刷新备份列表",
			"sidebar.count": "共 {count} 个文件",
			"sidebar.state.modified": "已修改",
			"sidebar.state.deleted": "已删除",
			"sidebar.restore": "还原",
			"sidebar.restoreOne": "还原 {name}",
			"sidebar.restoring": "还原中…",
			"sidebar.restored": "已还原",
			"sidebar.restoreFailed": "还原失败：{message}",
			"sidebar.copyAt": "备份副本：{path}",
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
			"checkout.kept": "已归档，但 worktree 保留（{reason}）：{path}"
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
			"settings.description": "Create isolated workspaces with Git worktrees to work on tasks in parallel.",
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
			"settings.backupSidebar.label": "Show the backup sidebar",
			"settings.backupSidebar.hint": "Add a File backup page to the right sidebar, listing the files this session changed or deleted, each restorable on its own.",
			"settings.backupSidebar.inactive": "Add a File backup page to the right sidebar (turn on Session file protection first).",
			"sidebar.title": "File backup",
			"sidebar.description": "The files this session changed or deleted, each restorable on its own.",
			"sidebar.loading": "Reading backups…",
			"sidebar.empty": "This session has no backups yet. A file is copied aside before the AI changes it, so a bad edit or a deletion can be restored here.",
			"sidebar.failed": "Could not read the backups: {message}",
			"sidebar.retry": "Retry",
			"sidebar.refresh": "Refresh the backup list",
			"sidebar.count": "{count} files",
			"sidebar.state.modified": "Modified",
			"sidebar.state.deleted": "Deleted",
			"sidebar.restore": "Restore",
			"sidebar.restoreOne": "Restore {name}",
			"sidebar.restoring": "Restoring…",
			"sidebar.restored": "Restored",
			"sidebar.restoreFailed": "Restore failed: {message}",
			"sidebar.copyAt": "Backup copy: {path}",
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
			"checkout.kept": "Archived, but the worktree was kept ({reason}): {path}"
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
				saveFailed: t("settings.saveFailed")
			};
		}
		//#endregion
		//#region \0dsh-css:C:\02-codespace\DeepSeek\dsh-worktree\src\client\SettingsSection.module.css.mjs
		const css = ".SOCsgq_page{width:100%;max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;display:flex;container:SOCsgq_worktree-settings/inline-size}.SOCsgq_pageTitle{font:var(--dsw-font-base-strong-16);color:var(--dsw-alias-label-primary);margin:0 0 4px}.SOCsgq_pageDescription{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);margin:0 0 12px}.SOCsgq_card{border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-settings-card-fill);flex-direction:column;margin:0 0 12px;padding:16px;display:flex}.SOCsgq_cardTitle{font:var(--dsw-font-s-strong-14);color:var(--dsw-alias-label-primary);margin:0 0 4px}.SOCsgq_gitStatus{border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);margin:0 0 4px;padding:8px 12px}.SOCsgq_gitError{color:var(--dsw-alias-state-error-primary)}.SOCsgq_notice{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);margin:0 0 12px}.SOCsgq_saveFailed{color:var(--dsw-alias-state-error-primary)}.SOCsgq_row{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex}.SOCsgq_card>.SOCsgq_row:first-of-type{margin-top:4px}.SOCsgq_card>.SOCsgq_row:last-child{border-bottom:0}.SOCsgq_rowText{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}.SOCsgq_title{font:var(--dsw-font-s-14);color:var(--dsw-alias-label-primary)}.SOCsgq_desc{max-width:62ch;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}.SOCsgq_control{flex:none;align-items:center;gap:8px;display:inline-flex}.SOCsgq_choices{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover);grid-auto-columns:1fr;grid-auto-flow:column;gap:2px;padding:4px;display:inline-grid;position:relative}.SOCsgq_indicator{width:calc((100% - 8px - 2px * (var(--worktree-choice-count) - 1)) / var(--worktree-choice-count));border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);height:calc(100% - 8px);box-shadow:var(--dsw-elevation-soft);transform:translateX(calc(var(--worktree-choice-index) * (100% + 2px)));transition:transform var(--ds-transition-duration) var(--ds-ease-in-out);pointer-events:none;position:absolute;top:4px;left:4px}.SOCsgq_choice{z-index:1;border-radius:var(--dsw-radius-sm);height:28px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-strong-13);white-space:nowrap;cursor:pointer;transition:color var(--ds-transition-duration-fast) var(--ds-ease-in-out);background:0 0;border:0;padding:0 14px;position:relative}.SOCsgq_choice:hover:not(:disabled),.SOCsgq_choice[aria-pressed=true]{color:var(--dsw-alias-label-primary)}.SOCsgq_choice:disabled{cursor:default;opacity:.5}.SOCsgq_choice:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}@media (prefers-reduced-motion:reduce){.SOCsgq_indicator,.SOCsgq_choice{transition:none}}.SOCsgq_input{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);height:36px;font:var(--dsw-font-s-14);color:var(--dsw-alias-label-primary);border:none;padding:0 14px}.SOCsgq_input:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}.SOCsgq_input:disabled{color:var(--dsw-alias-label-tertiary);opacity:.5;cursor:default}.SOCsgq_input[aria-invalid=true]{outline:var(--dsw-focus-ring-width) solid var(--dsw-alias-state-error-primary);outline-offset:-1px}.SOCsgq_inputNumber{text-align:center;font-variant-numeric:tabular-nums;width:104px}@container SOCsgq_worktree-settings (width<=520px){.SOCsgq_card{padding:12px}.SOCsgq_row{flex-wrap:wrap;align-items:flex-start;row-gap:8px}.SOCsgq_rowText{flex:1 0 100%;padding-right:0}.SOCsgq_control{justify-content:flex-start}}@media (pointer:coarse){.SOCsgq_row{min-height:44px}.SOCsgq_switchHit{position:relative}.SOCsgq_switchHit:after{content:\"\";position:absolute;inset:-12px -6px}.SOCsgq_input{height:44px;font:var(--dsw-font-base-16)}.SOCsgq_choice{height:44px}}";
		const tagId = "@guowenzhang/dsh-worktree/SettingsSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
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
		//#region src/client/SettingsSection.tsx
		/**
		* The file backup settings page, in two cards: the policy every later checkout
		* is created under, and the protection that runs over files inside a session.
		*
		* Each card is a title, an explanation, and its own rows, laid out in the
		* settings column's two-column shape (label and explanation left, control
		* right), so this page reads like every other page beside it. The Worktree card
		* answers what a checkout looks like — whether the child repositories come
		* along, how deep the search for them goes, and where the directory lands. The
		* backup card answers what happens to the files inside it: whether they are
		* copied aside before a change, whether a destructive command is refused, and
		* whether the right sidebar offers the page that lists and restores them.
		* Everything else the entry accepts — the agent subdirectory, the git bound,
		* the route options — is deployment composition, edited in the profile's own
		* patch.
		*
		* Every valid edit saves automatically through the shared settings scope.
		* There is no manual-save footer, and leaving the page never discards a write.
		*
		* The two action results — a write the Host refused, and a draft it would
		* reject — are reported in the Host's floating banner instead of at the page's
		* own end, which two filled cards and the settings modal's scroll container put
		* out of sight. What stays on the page is standing state: whether the entry is
		* served, whether this deployment stores settings read-only, the Git line, and
		* each row's hint.
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
		//#region src/client/index.ts
		/** This implementation's identity in the right Sidebar's tab system. */
		const BACKUP_TAB_ID = "@guowenzhang/dsh-worktree/backup";
		/** The tab kind the file-backup page is opened as. */
		const BACKUP_TAB_KIND = "worktree-backup";
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
			ctx.effect(() => ctx.configForms.whileServed([SETTINGS_NAMESPACE], () => ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "worktree",
				order: 30,
				label: () => t("settings.nav"),
				locale: NS,
				inject: () => settings.inject()
			}, WorktreeSettingsSection))), "ui-worktree: settings page");
			const backupFace = {
				list: (sessionId) => request("backups", { sessionId }),
				restore: (sessionId, relative) => request("restore", {
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
				}, "ui-worktree: file backup sidebar type");
				scope.effect(() => scope.slots.inject("sidebar.right.pane.tab", () => scope.slots.register({
					name: "sidebar.right.pane.tab",
					key: BACKUP_TAB_ID,
					locale: NS,
					inject: () => backupFace
				}, BackupPanel)), "ui-worktree: file backup page body");
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
