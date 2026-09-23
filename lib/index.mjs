import z from "@deepseek-ai/schemastery";
import { mkdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { execFile } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { SessionId } from "@deepseek-ai/dsh-session/types";
//#region src/git.ts
/**
* The Git process edge.
*
* Every git invocation in this plugin goes through {@link runGit}, which is the
* single place a child process is spawned and the single place an exit code is
* turned into a failure. Callers pass already-validated absolute paths and
* already-validated branch names; this module adds no policy of its own beyond
* never invoking a shell.
* @module @guowenzhang/dsh-worktree/git
*/
/** A git invocation that exited nonzero, carrying Git's own diagnostic. */
var GitCommandError = class extends Error {
	args;
	cwd;
	stderr;
	/**
	* @param args - the git arguments that failed, for the diagnostic text.
	* @param cwd - the directory the command ran in.
	* @param stderr - Git's stderr, trimmed.
	*/
	constructor(args, cwd, stderr) {
		super(`git ${args.join(" ")} failed in ${cwd}: ${stderr}`);
		this.args = args;
		this.cwd = cwd;
		this.stderr = stderr;
		this.name = "GitCommandError";
	}
};
/**
* Run one git command and return its stdout.
*
* The command runs without a shell, so no argument is ever re-parsed by a
* shell and a path containing spaces or metacharacters stays a single
* argument. A nonzero exit rejects with {@link GitCommandError}; a successful
* exit resolves with stdout exactly as Git wrote it (porcelain consumers
* depend on the raw bytes, including their trailing newline).
* @param cwd - directory to run in.
* @param args - git arguments, excluding the leading `git`.
* @returns the command's stdout.
* @throws {GitCommandError} when git exits nonzero.
*/
async function runGit(cwd, args) {
	return await new Promise((resolvePromise, rejectPromise) => {
		execFile("git", [...args], {
			cwd,
			windowsHide: true,
			maxBuffer: 16 * 1024 * 1024
		}, (error, stdout, stderr) => {
			if (error === null) {
				resolvePromise(stdout);
				return;
			}
			rejectPromise(new GitCommandError(args, cwd, stderr.trim() || error.message));
		});
	});
}
//#endregion
//#region src/porcelain.ts
/**
* Parse porcelain records, accepting both the newline-separated form and the
* NUL-separated form produced by `-z`.
*
* Records are separated by a blank line in the newline form and by a bare NUL
* in the `-z` form; fields within a record are `key value` pairs. Only the
* fields this plugin consumes are read, and unknown keys are ignored so a
* future Git addition cannot fail the parse.
* @param output - raw stdout of `git worktree list --porcelain[-z]`.
* @returns one record per worktree, in Git's own order (main worktree first).
*/
function parseWorktreeList(output) {
	const records = [];
	let path;
	let branch = "HEAD";
	let head = "";
	let locked = false;
	let prunable = false;
	const flush = () => {
		if (path === void 0) return;
		records.push({
			path,
			branch,
			head,
			locked,
			prunable
		});
		path = void 0;
		branch = "HEAD";
		head = "";
		locked = false;
		prunable = false;
	};
	for (const chunk of output.split("\0")) for (const line of chunk.split("\n")) {
		if (line === "") {
			flush();
			continue;
		}
		if (line.startsWith("worktree ")) {
			flush();
			path = line.slice(9);
			continue;
		}
		if (line.startsWith("branch ")) {
			branch = shortBranch(line.slice(7));
			continue;
		}
		if (line.startsWith("HEAD ")) {
			head = line.slice(5);
			continue;
		}
		if (line === "locked" || line.startsWith("locked ")) {
			locked = true;
			continue;
		}
		if (line === "prunable" || line.startsWith("prunable ")) prunable = true;
	}
	flush();
	return records;
}
/**
* Reduce a full ref to the short branch name Git would print.
* @param ref - a full ref such as `refs/heads/feature/x`.
* @returns the short name, or the input unchanged when it is not a `refs/heads` ref.
*/
function shortBranch(ref) {
	return ref.startsWith("refs/heads/") ? ref.slice(11) : ref;
}
/**
* Parse `git for-each-ref --format=%(refname:short) refs/heads` output.
*
* One branch name per line: a ref name cannot contain a newline or be empty, so
* a blank line is the only malformed record and it is dropped rather than
* becoming an empty branch the caller could select.
* @param output - raw stdout of the branch listing.
* @returns the short branch names, in Git's own order.
*/
function parseBranchList(output) {
	return output.split("\n").filter((line) => line !== "");
}
//#endregion
//#region src/repository.ts
/**
* Recovery of the main repository root from any checkout of a repository.
*
* A linked worktree's `.git` is a file naming `<main>/.git/worktrees/<name>`,
* so the session that requests a worktree may itself already be running inside
* one. `git worktree add` must run against the common repository, never against
* a linked checkout, which is why this module exists as its own step rather
* than being folded into the command that follows it.
* @module @guowenzhang/dsh-worktree/repository
*/
/**
* The main repository root containing `checkout`.
*
* A `.git` directory means the checkout is itself the main worktree. A `.git`
* file means a linked worktree: its `gitdir:` target ends in
* `.git/worktrees/<name>`, and stripping that suffix yields the repository that
* owns every linked checkout. A `.git` file pointing anywhere else (a
* submodule, or a checkout whose gitdir was moved) leaves the path unchanged,
* because the caller's directory is then the best answer available and Git
* itself will reject an operation that cannot work there.
* @param checkout - absolute directory to resolve the owning repository of.
* @returns the main repository root, or `checkout` when it cannot be recovered.
*/
async function mainRepositoryRoot(checkout) {
	const marker = join(checkout, ".git");
	const info = await statOrUndefined(marker);
	if (info === void 0 || info.isDirectory()) return checkout;
	const text = await readFileOrUndefined(marker);
	if (text === void 0) return checkout;
	const recovered = repositoryRootFromGitFile(text);
	if (recovered === void 0) return checkout;
	return process.platform === "win32" ? recovered.replace(/\//g, "\\") : recovered;
}
/**
* Derive the repository root from the contents of a `.git` file.
* @param text - the file's contents.
* @returns the repository root, or `undefined` when the file names something else.
*/
function repositoryRootFromGitFile(text) {
	const target = /^gitdir:[ \t]*(.+?)[ \t\r]*$/m.exec(text)?.[1];
	if (target === void 0) return void 0;
	return /^(.*)[\\/]\.git[\\/]worktrees[\\/][^\\/]+$/u.exec(target)?.[1];
}
async function statOrUndefined(path) {
	try {
		return await stat(path);
	} catch {
		return;
	}
}
async function readFileOrUndefined(path) {
	try {
		return await readFile(path, { encoding: "utf8" });
	} catch {
		return;
	}
}
//#endregion
//#region src/branch-rule.ts
/**
* The branch-name rule, shared by the Host validator and the browser surface.
*
* Both halves refuse an unusable name, and they must refuse exactly the same
* names: a picker that accepted what the Host rejects would fail after the user
* committed to it, and a Host that accepted what Git rejects would fail mid
* `git worktree add`. This module is that single rule.
* @module @guowenzhang/dsh-worktree/branch-rule
*/
/** Characters and sequences `git check-ref-format --branch` rejects. */
const INVALID = /[\u0000-\u001f\u007f ~^:?*[\\]|\.\.|\/\/|^\/|\/$|\.$|^\.|@\{/;
/**
* Whether a name is usable as a new branch.
* @param branch - candidate branch name.
* @returns true when the name is one Git would accept.
*/
function branchIsValid(branch) {
	if (branch.length === 0 || branch === "@") return false;
	if (branch.startsWith("-")) return false;
	if (branch.endsWith(".lock")) return false;
	return !INVALID.test(branch);
}
//#endregion
//#region src/validate.ts
/**
* Validation of the model-supplied inputs that become git arguments.
*
* Branch names and worktree paths arrive from a tool call, so they are a model
* boundary: each is checked here before any git invocation, and a value that
* cannot be a branch name or a checkout directory fails with the reason rather
* than reaching Git and producing its own opaque message.
* @module @guowenzhang/dsh-worktree/validate
*/
/**
* Assert a value is usable as a new branch name.
* @param branch - candidate branch name.
* @throws {Error} naming the violated rule.
*/
function assertBranchName(branch) {
	if (branch.length === 0) throw new Error("branch name must not be empty");
	if (!branchIsValid(branch)) throw new Error(`invalid branch name ${JSON.stringify(branch)}: it is reserved by Git, contains whitespace or a reserved character, or starts with "-"`);
}
/**
* Assert a value is an absolute, normalized path usable as a worktree target.
* @param path - candidate path.
* @param label - which input this is, for the diagnostic.
* @throws {Error} when the path is not absolute or escapes via a parent segment.
*/
function assertAbsolutePath(path, label) {
	if (!isAbsolute(path)) throw new Error(`${label} must be an absolute path: ${JSON.stringify(path)}`);
	if (path.split(/[\\/]+/).includes("..")) throw new Error(`${label} must not contain a ".." segment: ${JSON.stringify(path)}`);
}
/**
* Assert a value is usable as the relative directory the `agents` layout
* creates checkouts in.
* @param value - candidate directory.
* @throws {Error} naming the violated rule.
*/
function assertAgentsDirectory(value) {
	if (value.length === 0) throw new Error("agentsDirectory must not be empty");
	if (isAbsolute(value) || /^[A-Za-z]:/.test(value)) throw new Error(`agentsDirectory must be relative to the workspace: ${JSON.stringify(value)}`);
	if (value.split(/[\\/]+/).includes("..")) throw new Error(`agentsDirectory must not contain a ".." segment: ${JSON.stringify(value)}`);
}
/**
* Derive the `agents` checkout directory for a branch.
*
* The checkout goes inside the calling Workspace's own agent directory, which
* is where a workspace tree groups it as a child of that Workspace rather than
* as an unrelated top-level directory.
* @param workspacePath - the directory the calling Session runs in, which is the Workspace the checkout joins.
* @param branch - branch the worktree will hold.
* @param agentsDirectory - directory under the Workspace that holds checkouts.
* @returns an absolute directory path.
*/
function agentsWorktreePath(workspacePath, branch, agentsDirectory) {
	return join(workspacePath, agentsDirectory, flattenBranch(branch));
}
/**
* Derive the `sibling` checkout directory for a branch: beside the main
* checkout, named after the repository and the branch.
* @param repositoryRoot - main repository root.
* @param branch - branch the worktree will hold.
* @returns an absolute directory path.
*/
function siblingWorktreePath(repositoryRoot, branch) {
	return join(dirname(repositoryRoot), `${basename(repositoryRoot)}-wt-${flattenBranch(branch)}`);
}
/**
* Flatten a branch name into one directory name.
* @param branch - branch the worktree will hold.
* @returns the branch name with every separator replaced.
*/
function flattenBranch(branch) {
	return branch.replace(/[\\/]+/g, "-");
}
/**
* Derive the default branch name for a new worktree: the branch it starts from
* plus a short random suffix.
*
* The recorded base is the one fact about a worktree nothing else keeps, and the
* suffix is what makes two worktrees of one base distinct — the checkout
* directory is derived from this name, so it must never repeat.
* @param base - the local branch the new branch starts from, when there is one to record.
* @returns a branch name Git accepts.
*/
function defaultBranchName(base) {
	return `${base === void 0 ? "worktree" : flattenBranch(base)}-${randomSuffix()}`;
}
/** Digits drawn for the random suffix: one in a million per base. */
const SUFFIX_LENGTH = 6;
/**
* Draw the random suffix of a derived branch name.
* @returns the requested number of digits, keeping leading zeros.
*/
function randomSuffix() {
	let digits = "";
	for (let index = 0; index < SUFFIX_LENGTH; index += 1) digits += String(randomInt(0, 10));
	return digits;
}
//#endregion
//#region src/service.ts
/**
* The worktree capability: create a linked checkout, list the ones that exist,
* and remove one.
*
* This module owns the ordering that makes a worktree usable as a session
* workspace — resolve the main repository, create the checkout, then report
* the canonical path the caller will hand to `ctx.agents.create` as
* `meta.cwd`. It deliberately does not create sessions or workspaces: those
* are separate consumers of the path this returns, and keeping them out
* preserves the rule that a capability seam is complete without prescribing
* its consumers.
* @module @guowenzhang/dsh-worktree/service
*/
/**
* Create, list, and remove linked Git worktrees.
*
* Registered as the `worktree` service. Every method resolves the main
* repository from the caller's directory first, so a session already running
* inside a linked worktree still operates on the repository that owns it.
*/
var WorktreeService = class {
	timeoutMs;
	defaultPath;
	agentsDirectory;
	/**
	* @param options - git bound and the layout a default path is derived from.
	* @throws {Error} when `agentsDirectory` cannot be a workspace-relative directory.
	*/
	constructor(options = {}) {
		this.timeoutMs = options.timeoutMs ?? 6e4;
		this.defaultPath = options.defaultPath ?? "agents";
		this.agentsDirectory = options.agentsDirectory ?? ".agents/worktree";
		assertAgentsDirectory(this.agentsDirectory);
	}
	/**
	* Create a linked worktree and return its canonical path.
	*
	* Ordering matters and is the reason this is one method: the branch is
	* asserted before any process starts, the main repository is recovered
	* before `git worktree add` runs (a linked checkout cannot host the command),
	* and the created path is canonicalized through `fs.realpath` before it is
	* returned, because the workspace registry's uniqueness canon is realpath
	* equality and a caller comparing an uncanonicalized path would create a
	* second record for one directory.
	* @param request - the caller's directory plus optional branch, path, and base.
	* @returns the created worktree with its canonical path.
	*/
	async create(request) {
		assertAbsolutePath(request.cwd, "cwd");
		if (request.branch !== void 0) assertBranchName(request.branch);
		if (request.base !== void 0 && request.base.length === 0) throw new Error("base must not be empty when given");
		const repositoryRoot = await mainRepositoryRoot(request.cwd);
		const branch = request.branch ?? defaultBranchName(await this.recordedBase(repositoryRoot, request.base));
		const derived = request.path === void 0;
		const target = request.path ?? this.defaultTarget(request.cwd, repositoryRoot, branch);
		assertAbsolutePath(target, "path");
		if (derived) await mkdir(dirname(target), { recursive: true });
		const args = [
			"worktree",
			"add",
			"-b",
			branch,
			target,
			...request.base === void 0 ? [] : [request.base]
		];
		try {
			await this.git(repositoryRoot, args);
		} catch (error) {
			await this.pruneQuietly(repositoryRoot);
			throw error;
		}
		const records = await this.list(repositoryRoot);
		const created = records.find((record) => samePath(record.path, target)) ?? records.find((record) => record.branch === branch);
		if (created === void 0) throw new Error(`git reported success creating ${JSON.stringify(target)} but the worktree is not listed`);
		return {
			path: await canonical(created.path),
			branch: created.branch,
			head: created.head,
			main: false,
			repositoryRoot
		};
	}
	/**
	* List the repository's worktrees, live checkouts only.
	*
	* Prunable records are dropped here rather than reported: they name
	* administrative metadata whose checkout directory has been deleted, so no
	* caller can use them and every caller would have to filter them again.
	* @param cwd - directory inside the repository to list.
	* @returns the live worktrees, main worktree first.
	*/
	async list(cwd) {
		assertAbsolutePath(cwd, "cwd");
		const repositoryRoot = await mainRepositoryRoot(cwd);
		return parseWorktreeList(await this.git(repositoryRoot, [
			"worktree",
			"list",
			"--porcelain",
			"-z"
		])).filter((record) => !record.prunable).map((record, index) => ({
			path: record.path,
			branch: record.branch,
			head: record.head,
			main: index === 0
		}));
	}
	/**
	* Remove one linked worktree.
	*
	* The requested path is matched against the repository's own listing before
	* it becomes a git argument, so a path the model invented cannot reach
	* `git worktree remove`. The main worktree is refused: removing it would
	* delete the repository itself.
	* @param request - the caller's directory, the checkout to remove, and whether to force.
	* @returns the record that was removed, as it was last listed.
	*/
	async remove(request) {
		assertAbsolutePath(request.cwd, "cwd");
		assertAbsolutePath(request.path, "path");
		const repositoryRoot = await mainRepositoryRoot(request.cwd);
		const records = await this.list(repositoryRoot);
		const requested = await canonical(request.path);
		const target = records.find((record) => samePath(record.path, requested));
		if (target === void 0) throw new Error(`unknown worktree of ${JSON.stringify(repositoryRoot)}: ${JSON.stringify(request.path)}`);
		if (target.main) throw new Error(`refusing to remove the main worktree ${JSON.stringify(target.path)}`);
		await this.git(repositoryRoot, [
			"worktree",
			"remove",
			...request.force === true ? ["--force"] : [],
			target.path
		]);
		return target;
	}
	/**
	* List the repository's local branches, most recently committed first.
	*
	* Only `refs/heads` is read: a remote-tracking ref or a tag is not a branch a
	* checkout could hold, and `git worktree add` would silently detach HEAD for
	* one.
	* @param cwd - directory inside the repository to list.
	* @returns the short branch names.
	*/
	async listBranches(cwd) {
		assertAbsolutePath(cwd, "cwd");
		return await this.branchNames(await mainRepositoryRoot(cwd));
	}
	/**
	* The base a derived branch name records, if one is worth recording.
	*
	* A base that names a local branch says where the new branch came from; any
	* other commit-ish is a revision expression (`HEAD~2`, a hash, a remote ref)
	* that a name could only repeat as noise.
	* @param repositoryRoot - main repository root.
	* @param base - the requested commit-ish, when the caller gave one.
	* @returns the base branch name, or undefined when nothing should be recorded.
	*/
	async recordedBase(repositoryRoot, base) {
		if (base === void 0 || base === "HEAD") return void 0;
		return (await this.branchNames(repositoryRoot)).includes(base) ? base : void 0;
	}
	/**
	* Read one repository's local branch names.
	* @param repositoryRoot - main repository root.
	* @returns the short branch names, most recently committed first.
	*/
	async branchNames(repositoryRoot) {
		return parseBranchList(await this.git(repositoryRoot, [
			"for-each-ref",
			"--sort=-committerdate",
			"--format=%(refname:short)",
			"refs/heads"
		]));
	}
	/**
	* Derive the checkout directory for one creation, under the configured layout.
	* @param workspacePath - the caller's directory, which is the Workspace the checkout joins.
	* @param repositoryRoot - main repository root the checkout is created from.
	* @param branch - branch the worktree will hold.
	* @returns an absolute directory path.
	*/
	defaultTarget(workspacePath, repositoryRoot, branch) {
		return this.defaultPath === "sibling" ? siblingWorktreePath(repositoryRoot, branch) : agentsWorktreePath(workspacePath, branch, this.agentsDirectory);
	}
	/**
	* Run git under this service's configured bound.
	* @param cwd - directory to run in.
	* @param args - git arguments.
	* @returns git's stdout.
	*/
	async git(cwd, args) {
		return await withTimeout(runGit(cwd, args), this.timeoutMs, `git ${args.join(" ")}`);
	}
	/**
	* Drop stale administrative records after a failed creation.
	* @param repositoryRoot - repository whose records are pruned.
	*/
	async pruneQuietly(repositoryRoot) {
		try {
			await this.git(repositoryRoot, ["worktree", "prune"]);
		} catch (error) {}
	}
};
/**
* Resolve a checkout path to its canonical form.
*
* Git reports the path it recorded at creation time, and a caller compares
* that against the workspace registry's realpath canon; on macOS a temporary
* directory keeps a `/var` symlink that git resolves to `/private/var`, so the
* two spellings name one directory and only realpath makes them equal.
* @param path - candidate directory.
* @returns the canonical path, or the input when it cannot be resolved.
*/
async function canonical(path) {
	try {
		return await realpath(path);
	} catch (error) {
		return path;
	}
}
/**
* Compare two paths by identity rather than spelling.
*
* Git reports checkout paths with forward slashes even on Windows, while a
* caller's path comes from `node:path` and therefore uses backslashes; the two
* spellings name one directory. Case is folded on Windows for the same reason.
* @param left - first path.
* @param right - second path.
* @returns true when both name the same location.
*/
function samePath(left, right) {
	const normalize = (value) => {
		const trimmed = value.replace(/[\\/]+$/, "").replace(/\\/g, "/");
		return process.platform === "win32" ? trimmed.toLowerCase() : trimmed;
	};
	return normalize(left) === normalize(right);
}
/**
* Enforce a deadline on one git invocation.
* @param work - the pending git result.
* @param timeoutMs - the bound in milliseconds.
* @param label - what is being awaited, for the failure text.
* @returns the awaited value.
* @throws {Error} when the bound elapses first.
*/
async function withTimeout(work, timeoutMs, label) {
	if (timeoutMs <= 0) return await work;
	let timer;
	try {
		return await Promise.race([work, new Promise((_resolve, rejectPromise) => {
			timer = setTimeout(() => {
				rejectPromise(/* @__PURE__ */ new Error(`${label} timed out after ${timeoutMs}ms`));
			}, timeoutMs);
		})]);
	} finally {
		if (timer !== void 0) clearTimeout(timer);
	}
}
//#endregion
//#region src/tools.ts
/**
* The calling session's working directory, which is where repository discovery
* starts.
* @param exec - the tool execution context.
* @returns the session cwd, or undefined when the caller has none.
*/
function sessionCwd(exec) {
	return exec.agent?.session.header.cwd;
}
/**
* Require the calling session's working directory.
* @param exec - the tool execution context.
* @returns the session cwd.
* @throws {Error} when the caller has no workspace to discover a repository from.
*/
function requireCwd(exec) {
	const cwd = sessionCwd(exec);
	if (cwd === void 0) throw new Error("this tool requires an owning session with a working directory");
	return cwd;
}
/**
* Register the worktree tools on `ctx.tools`.
* @param ctx - registrant context carrying the tool registry.
* @param service - the worktree capability the tools consume.
* @param toolNames - configured tool names.
*/
function registerTools(ctx, service, toolNames) {
	ctx.tools.register(defineTool({
		name: toolNames.create,
		description: "Create an isolated Git worktree of the current repository and return its path. Use it to work on a separate branch without disturbing the current checkout. The new checkout is a DIFFERENT directory: files, git state, and uncommitted changes there are independent of the current one. This tool only creates the checkout — it does not move your session into it.",
		parameters: {
			branch: {
				type: "string",
				description: "Branch to create in the new worktree. Omit for a generated name."
			},
			path: {
				type: "string",
				description: "Absolute directory for the checkout. Omit for a sibling of the repository."
			},
			base: {
				type: "string",
				description: "Commit-ish to base the new branch on. Omit for the repository HEAD."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					path: {
						type: "string",
						required: true
					},
					branch: {
						type: "string",
						required: true
					},
					head: {
						type: "string",
						required: true
					},
					repositoryRoot: {
						type: "string",
						required: true
					},
					sessionStarted: {
						type: "boolean",
						required: true
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: `Created worktree ${value.path} on branch ${value.branch} (${value.head.slice(0, 12)}) from ${value.repositoryRoot}.`
			}]
		},
		async execute(args, exec) {
			const created = await service.create({
				cwd: requireCwd(exec),
				...args.branch === void 0 ? {} : { branch: args.branch },
				...args.path === void 0 ? {} : { path: args.path },
				...args.base === void 0 ? {} : { base: args.base }
			});
			return {
				path: created.path,
				branch: created.branch,
				head: created.head,
				repositoryRoot: created.repositoryRoot,
				sessionStarted: false
			};
		},
		presentCall: (args) => ({
			card: "generic",
			title: args.branch === void 0 ? "Create worktree" : `Create worktree ${args.branch}`,
			kind: "edit",
			...args.path === void 0 ? {} : { locations: [{ path: args.path }] }
		})
	}));
	ctx.tools.register(defineTool({
		name: toolNames.list,
		description: "List the Git worktrees of the current repository, main checkout first. Use it to see which isolated checkouts already exist before creating one.",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					repositoryRoot: {
						type: "string",
						required: true
					},
					worktrees: {
						type: "array",
						required: true,
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								path: {
									type: "string",
									required: true
								},
								branch: {
									type: "string",
									required: true
								},
								head: {
									type: "string",
									required: true
								},
								main: {
									type: "boolean",
									required: true
								}
							}
						}
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: value.worktrees.length === 0 ? `No worktrees found in ${value.repositoryRoot}.` : value.worktrees.map((entry) => `${entry.main ? "* " : "  "}${entry.path} [${entry.branch}]`).join("\n")
			}]
		},
		async execute(_args, exec) {
			const cwd = requireCwd(exec);
			const worktrees = await service.list(cwd);
			return {
				repositoryRoot: worktrees[0]?.path ?? cwd,
				worktrees: worktrees.map((entry) => ({
					path: entry.path,
					branch: entry.branch,
					head: entry.head,
					main: entry.main
				}))
			};
		},
		presentCall: () => ({
			card: "generic",
			title: "List worktrees",
			kind: "search"
		})
	}));
	ctx.tools.register(defineTool({
		name: toolNames.remove,
		description: "Remove a linked Git worktree created earlier. The main checkout is refused. A worktree with uncommitted changes is refused unless force is set, because removal discards that work.",
		parameters: {
			path: {
				type: "string",
				required: true,
				description: "Absolute path of the worktree to remove, as reported by the list tool."
			},
			force: {
				type: "boolean",
				description: "Remove even when the worktree has modifications or untracked files."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					path: {
						type: "string",
						required: true
					},
					branch: {
						type: "string",
						required: true
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: `Removed worktree ${value.path} (branch ${value.branch}).`
			}]
		},
		async execute(args, exec) {
			const removed = await service.remove({
				cwd: requireCwd(exec),
				path: args.path,
				...args.force === void 0 ? {} : { force: args.force }
			});
			return {
				path: removed.path,
				branch: removed.branch
			};
		},
		presentCall: (args) => ({
			card: "generic",
			title: "Remove worktree",
			kind: "delete",
			locations: [{ path: args.path }]
		})
	}));
}
//#endregion
//#region src/session.ts
/**
* Read the deployment's default model selection.
* @param ctx - Host context.
* @returns agent options naming a provider and model, or an empty object when the deployment composes no default.
*/
function agentOptions(ctx) {
	const defaults = ctx.get("agentDefaultModel");
	if (defaults === void 0) return {};
	const { provider, model } = defaults.currentSelection();
	return {
		provider,
		model
	};
}
/**
* Build the composition an Agent is created under.
*
* A deployment without a preset registry composes the Agent with no extra
* mounted plugins; one with a registry mounts the resolved preset, which is
* what gives the Session its tools and prompt. The requested preset is resolved
* against the roster so the durable session header records an id the roster
* actually has.
* @param ctx - Host context.
* @param presetId - requested preset id, or undefined for the deployment default.
* @returns the resolved preset id and the setup callback.
*/
async function compose(ctx, presetId) {
	const presets = ctx.get("agentPresets");
	if (presets === void 0) return { setup: () => {} };
	const resolvedId = (await presets.resolve(presetId)).id;
	return {
		agentPreset: resolvedId,
		setup: async (agentCtx) => {
			await presets.mount(agentCtx, resolvedId);
		}
	};
}
/**
* Start a Session whose working directory is the given checkout.
*
* `meta.cwd` is the whole point: the Session's header carries it, and every
* shell, filesystem, sandbox, and search consumer derives its workspace from
* that field.
* @param ctx - Host context carrying the agent registry.
* @param cwd - the checkout the Session runs in.
* @param presetId - requested Agent preset, or undefined for the deployment default.
* @returns the started Session id.
*/
async function startSessionIn(ctx, cwd, presetId) {
	const composition = await compose(ctx, presetId);
	return (await ctx.agents.create({
		sessionId: SessionId(`session-${randomUUID()}`),
		agentOptions: agentOptions(ctx),
		meta: {
			cwd,
			...composition.agentPreset === void 0 ? {} : { agentPreset: composition.agentPreset }
		},
		setup: composition.setup
	})).agent.id;
}
//#endregion
//#region src/route.ts
/** A refusal that carries the HTTP status the route answers with. */
var RouteError = class extends Error {
	status;
	/**
	* @param status - HTTP status to answer with.
	* @param message - model- and user-facing reason.
	*/
	constructor(status, message) {
		super(message);
		this.status = status;
		this.name = "RouteError";
	}
};
/**
* Read a JSON request body.
* @param req - the incoming request.
* @returns the parsed body, or an empty object for an empty body.
* @throws {RouteError} when the body is not valid JSON.
*/
async function readJsonBody(req) {
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
	const text = Buffer.concat(chunks).toString("utf8").trim();
	if (text === "") return {};
	try {
		const parsed = JSON.parse(text);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new RouteError(400, "request body must be a JSON object");
		return parsed;
	} catch (error) {
		if (error instanceof RouteError) throw error;
		throw new RouteError(400, "request body is not valid JSON");
	}
}
/**
* Write a JSON response.
* @param res - the response to write.
* @param status - HTTP status.
* @param body - JSON-serializable body.
*/
function writeJson(res, status, body) {
	const text = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(text)
	});
	res.end(text);
}
/**
* Require one body field to be a non-empty string.
* @param value - the raw field.
* @param field - field name, for the diagnostic.
* @returns the validated string.
* @throws {RouteError} when the field is absent or not a non-empty string.
*/
function requireString(value, field) {
	if (typeof value !== "string" || value.length === 0) throw new RouteError(400, `${field} must be a non-empty string`);
	return value;
}
/**
* Register the `/worktree/api` route.
*
* Registration waits for the services the route's handler reads — `webServer`,
* `workspaceRegistry`, and `agents` — through `ctx.inject` rather than reading
* them once with `ctx.get`: plugin activation order is not guaranteed, so a
* host that activates this plugin before the webserver would otherwise see
* `undefined` and never mount the route. The declaration is also what makes the
* properties readable: a service provided by a sibling plugin is reachable only
* from a context that declares it. Waiting also re-mounts the route if a
* service is replaced, and the registration rides the plugin's fiber so it
* disappears on unload. A deployment missing one of the three keeps the
* model-facing tools and mounts no route, rather than one whose start fails at
* the first missing service.
* @param ctx - the Host plugin context.
* @param service - the worktree capability.
*/
function registerRoute(ctx, service) {
	ctx.inject([
		"webServer",
		"workspaceRegistry",
		"agents"
	], (scope) => {
		scope.effect(() => scope.webServer.register({
			kind: "prefix",
			path: "/worktree/api",
			handler: async (req, res) => {
				let stage = "dispatch";
				try {
					if (req.method !== "POST") throw new RouteError(405, "method not allowed");
					const method = new URL(req.url ?? "/", "http://dsh.internal").pathname.slice(14);
					const body = await readJsonBody(req);
					if (method === "start") {
						writeJson(res, 200, await start(scope, service, body, (next) => {
							stage = next;
						}));
						return;
					}
					if (method === "list") {
						stage = "list";
						writeJson(res, 200, { worktrees: await service.list(requireString(body.cwd, "cwd")) });
						return;
					}
					if (method === "branches") {
						stage = "branches";
						writeJson(res, 200, { branches: await service.listBranches(requireString(body.cwd, "cwd")) });
						return;
					}
					throw new RouteError(404, `unknown worktree API method ${JSON.stringify(method)}`);
				} catch (error) {
					const status = error instanceof RouteError ? error.status : 500;
					const detail = error instanceof Error ? error.message : String(error);
					const message = `[${stage}] ${detail}`;
					scope.logger?.error?.(`dsh-worktree: ${message}`);
					writeJson(res, status, { error: {
						message,
						stage
					} });
				}
			}
		}), "dsh-worktree: /worktree/api route");
	});
}
/**
* Create a checkout, register it as a workspace, and start a session in it.
*
* Rollback covers the two failure points that follow a successful checkout: a
* workspace record that cannot be created, and a session that cannot be
* started. The checkout is removed in both cases so a failed start leaves the
* filesystem as it was; if that removal also fails, the error names the
* directory so the user can remove it rather than being left with silence.
* @param ctx - Host context carrying the workspace registry and agent registry.
* @param service - the worktree capability.
* @param body - the request body.
* @returns the created checkout, workspace id, and session id.
*/
async function start(ctx, service, body, onStage) {
	const cwd = requireString(body.cwd, "cwd");
	const branch = body.branch === void 0 ? void 0 : requireString(body.branch, "branch");
	const base = body.base === void 0 ? void 0 : requireString(body.base, "base");
	const path = body.path === void 0 ? void 0 : requireString(body.path, "path");
	const agentPreset = body.agentPreset === void 0 ? void 0 : requireString(body.agentPreset, "agentPreset");
	onStage("worktree");
	const created = await service.create({
		cwd,
		...branch === void 0 ? {} : { branch },
		...base === void 0 ? {} : { base },
		...path === void 0 ? {} : { path }
	});
	let workspaceId;
	let attachSession;
	onStage("workspace");
	try {
		const workspace = await ctx.workspaceRegistry.create(created.path, `${workspaceTitle(created.repositoryRoot, created.branch)}`);
		workspaceId = workspace.id;
		attachSession = async (sessionId) => {
			await workspace.attachSession(SessionId(sessionId));
		};
	} catch (error) {
		await discard(ctx, service, cwd, created.path, error);
		throw error;
	}
	let sessionId;
	onStage("session");
	try {
		sessionId = await startSessionIn(ctx, created.path, agentPreset);
	} catch (error) {
		await discard(ctx, service, cwd, created.path, error);
		throw error;
	}
	onStage("attach");
	try {
		await attachSession(sessionId);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new RouteError(500, `session ${JSON.stringify(sessionId)} was started in ${JSON.stringify(created.path)} but could not attach to workspace ${JSON.stringify(workspaceId)}: ${reason}`);
	}
	return {
		worktree: created,
		workspaceId,
		sessionId
	};
}
/**
* Build the workspace title for a new checkout.
* @param repositoryRoot - the repository the checkout belongs to.
* @param branch - the branch checked out.
* @returns a title naming both, so two worktrees of one repository are distinguishable.
*/
function workspaceTitle(repositoryRoot, branch) {
	return `${repositoryRoot.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? repositoryRoot} · ${branch}`;
}
/**
* Remove a checkout after a later step of the same start failed.
* @param ctx - Host context, for the logger.
* @param service - the worktree capability.
* @param cwd - the directory the removal is resolved from.
* @param path - the checkout to remove.
* @param cause - the failure being reported, kept as the primary error.
*/
async function discard(ctx, service, cwd, path, cause) {
	try {
		await service.remove({
			cwd,
			path,
			force: true
		});
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		ctx.logger?.warn?.(`dsh-worktree: could not remove ${JSON.stringify(path)} after a failed start (${reason}); original failure: ${cause instanceof Error ? cause.message : String(cause)}`);
	}
}
//#endregion
//#region src/index.ts
/** Plugin name used by the loader. */
const name = "worktree";
/**
* Declared service edges. The tool registry is a hard dependency — the tools
* cannot register without it. The route's dependencies (`webServer`,
* `workspaceRegistry`, and `agents`) are declared by `ctx.inject` inside
* {@link registerRoute} instead, so a deployment without one of them still gets
* the tools rather than failing to activate.
*/
const inject = ["tools"];
/** Schemastery validation for {@link Config}. */
const Config = z.object({
	defaultPath: z.union(["agents", "sibling"]),
	agentsDirectory: z.string(),
	createToolName: z.string(),
	listToolName: z.string(),
	removeToolName: z.string(),
	gitTimeoutMs: z.number(),
	startSessionRoute: z.boolean()
});
/**
* Register the worktree service and its model-facing tools.
* @param ctx - the Host plugin context.
* @param config - the deployment's worktree policy.
*/
function apply(ctx, config) {
	const service = new WorktreeService({
		...config.gitTimeoutMs === void 0 ? {} : { timeoutMs: config.gitTimeoutMs },
		...config.defaultPath === void 0 ? {} : { defaultPath: config.defaultPath },
		...config.agentsDirectory === void 0 ? {} : { agentsDirectory: config.agentsDirectory }
	});
	ctx.provide("worktree", service);
	registerTools(ctx, service, {
		create: config.createToolName ?? "worktree_create",
		list: config.listToolName ?? "worktree_list",
		remove: config.removeToolName ?? "worktree_remove"
	});
	if (config.startSessionRoute ?? true) registerRoute(ctx, service);
}
//#endregion
export { Config, WorktreeService, apply, inject, name };
