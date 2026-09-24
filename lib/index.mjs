import z from "@deepseek-ai/schemastery";
import { mkdir, readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { execFile } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { SessionId } from "@deepseek-ai/dsh-session/types";
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
/**
* What each policy field resolves to when no layer sets it.
*
* These are the Config schema's defaults and the service's fallbacks at once:
* the schema needs one to produce a live reference at all, and the service
* needs one when a caller constructs it directly, so a second copy would be a
* second answer to the same question.
*/
const DEFAULT_WORKTREE_LAYOUT = "agents";
/** Default checkout directory under the workspace. */
const DEFAULT_AGENTS_DIRECTORY = ".agents/worktree";
/**
* Default policy for the repositories a checkout carries.
*
* Off by default: materializing submodules runs git over the network, and a
* checkout per nested repository writes a branch into repositories the parent
* does not track, so neither is something a user should discover after the
* fact.
*/
const DEFAULT_NESTED_REPOSITORIES = "none";
/** Default bound on one git invocation. */
const DEFAULT_GIT_TIMEOUT_MS = 6e4;
//#endregion
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
			maxBuffer: 16777216
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
* The main repository that owns a linked checkout, when `checkout` is one.
*
* A linked worktree's `.git` is a file naming `<main>/.git/worktrees/<name>`,
* which is what makes the owning repository recoverable from the checkout
* alone. A `.git` file pointing anywhere else is not a linked worktree: a
* submodule's gitdir lives under `.git/modules/<name>`, and a checkout whose
* gitdir was moved names a directory this module cannot interpret, so both
* answer undefined rather than a guess.
* @param checkout - absolute directory to resolve the owning repository of.
* @returns the main repository root, or undefined when the directory is not a linked worktree.
*/
async function linkedWorktreeOwner(checkout) {
	const marker = join(checkout, ".git");
	const info = await statOrUndefined(marker);
	if (info === void 0 || info.isDirectory()) return void 0;
	const text = await readFileOrUndefined(marker);
	if (text === void 0) return void 0;
	const recovered = repositoryRootFromGitFile(text);
	if (recovered === void 0) return void 0;
	return process.platform === "win32" ? recovered.replace(/\//g, "\\") : recovered;
}
/**
* The main repository root containing `checkout`.
*
* A linked worktree's `.git` is a file naming `<main>/.git/worktrees/<name>`,
* so the session that requests a worktree may itself already be running inside
* one. `git worktree add` must run against the common repository, never against
* a linked checkout, which is why this module exists as its own step rather
* than being folded into the command that follows it.
* @param checkout - absolute directory to resolve the owning repository of.
* @returns the main repository root, or `checkout` when it cannot be recovered.
*/
async function mainRepositoryRoot(checkout) {
	return await linkedWorktreeOwner(checkout) ?? checkout;
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
//#region src/nested.ts
/** Directory names never walked: Git's own metadata, and the dependency tree no repository owns. */
const SKIPPED = /* @__PURE__ */ new Set([".git", "node_modules"]);
/**
* Find the repositories nested inside one repository's checkout.
*
* Only a directory carrying a `.git` DIRECTORY is reported: that is a
* repository of its own. A directory whose `.git` is a file is either a
* submodule (materialized by the submodule step, never by a second worktree) or
* a linked worktree of some other repository (its own checkout already exists
* elsewhere), and neither is a repository this search may create a branch in.
*
* The walk descends through a repository it just reported, so a repository
* nested inside a nested one is found too, and the result is ordered parents
* before children — which is the order their checkouts must be created in,
* because every child's directory is inside its parent's.
* @param root - absolute path of the repository root to search.
* @param maxDepth - directory levels below `root` to search; 1 is the direct children.
* @returns the nested repositories, outermost first.
*/
async function findNestedRepositories(root, maxDepth) {
	const found = [];
	const visit = async (directory, depth) => {
		if (depth > maxDepth) return;
		for (const entry of await readableEntries(directory)) {
			if (!entry.isDirectory() || SKIPPED.has(entry.name)) continue;
			const child = join(directory, entry.name);
			if (await hasGitDirectory(child)) found.push({
				root: child,
				relative: relativeTo(root, child)
			});
			await visit(child, depth + 1);
		}
	};
	await visit(root, 1);
	return found;
}
/**
* Find the linked worktrees of other repositories inside one checkout.
*
* This is the removal half of {@link findNestedRepositories}: the checkouts a
* creation made are recognized by their `.git` file naming a repository's
* `.git/worktrees` entry, and each is removed from the repository that owns it.
* @param root - absolute path of the checkout to search.
* @param maxDepth - directory levels below `root` to search; 1 is the direct children.
* @returns the nested checkouts, outermost first.
*/
async function findNestedCheckouts(root, maxDepth) {
	const found = [];
	const visit = async (directory, depth) => {
		if (depth > maxDepth) return;
		for (const entry of await readableEntries(directory)) {
			if (!entry.isDirectory() || SKIPPED.has(entry.name)) continue;
			const child = join(directory, entry.name);
			const owner = await linkedWorktreeOwner(child);
			if (owner !== void 0) found.push({
				path: child,
				repositoryRoot: owner
			});
			await visit(child, depth + 1);
		}
	};
	await visit(root, 1);
	return found;
}
/**
* A directory's entries, or none when it cannot be read.
* @param directory - directory to list.
* @returns its entries, empty when the directory is unreadable.
*/
async function readableEntries(directory) {
	try {
		return await readdir(directory, { withFileTypes: true });
	} catch (error) {
		return [];
	}
}
/**
* Whether a directory carries its own Git metadata directory.
* @param directory - candidate directory.
* @returns true when `<directory>/.git` is a directory.
*/
async function hasGitDirectory(directory) {
	try {
		return (await stat(join(directory, ".git"))).isDirectory();
	} catch (error) {
		return false;
	}
}
/**
* Express one path relative to another with `/` separators.
* @param root - directory the result is relative to.
* @param path - path to express.
* @returns the relative path, `/`-separated on every platform.
*/
function relativeTo(root, path) {
	return relative(root, path).split(sep).join("/");
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
* Derive the `home` checkout directory for a branch: under the user's own
* `.agents`, shared by every workspace on the machine.
*
* This is the one layout that leaves the workspace's tree entirely, which is
* what it is for: checkouts of several repositories then sit side by side
* instead of nesting inside whichever one was open.
* @param agentsRoot - the user-level `.agents` directory.
* @param branch - branch the worktree will hold.
* @returns an absolute directory path.
*/
function homeWorktreePath(agentsRoot, branch) {
	return join(agentsRoot, "worktree", flattenBranch(branch));
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
	homeAgentsDirectory;
	nestedRepositories;
	nestedScanDepth;
	/**
	* @param options - git bound, the layout a default path is derived from, and the nested-repository policy.
	* @throws {Error} when `agentsDirectory` cannot be a workspace-relative directory, or `nestedScanDepth` is not a positive integer.
	*/
	constructor(options = {}) {
		this.timeoutMs = 0;
		this.defaultPath = "agents";
		this.agentsDirectory = ".agents/worktree";
		this.homeAgentsDirectory = join(homedir(), ".agents");
		this.nestedRepositories = "none";
		this.nestedScanDepth = 1;
		this.reconfigure(options);
	}
	/**
	* Replace the policy every later call runs under.
	*
	* A deployment's settings are live: the fields this service reads are
	* editable while it runs, so they are read at the moment each call uses them.
	* Replacing them here — rather than rebuilding the registration — keeps the
	* service identity every consumer already holds. Validation matches the
	* constructor's, so a policy that could not have been constructed cannot be
	* installed afterwards either.
	* @param options - the complete new policy; an omitted field reverts to its default.
	* @throws {Error} when a field cannot be a worktree policy.
	*/
	reconfigure(options = {}) {
		const agentsDirectory = options.agentsDirectory ?? ".agents/worktree";
		const nestedScanDepth = options.nestedScanDepth ?? 1;
		assertAgentsDirectory(agentsDirectory);
		if (!Number.isSafeInteger(nestedScanDepth) || nestedScanDepth < 1) throw new Error(`nestedScanDepth must be a positive integer: ${JSON.stringify(nestedScanDepth)}`);
		this.timeoutMs = options.timeoutMs ?? 6e4;
		this.defaultPath = options.defaultPath ?? "agents";
		this.agentsDirectory = agentsDirectory;
		this.homeAgentsDirectory = options.homeAgentsDirectory ?? join(homedir(), ".agents");
		this.nestedRepositories = options.nestedRepositories ?? "none";
		this.nestedScanDepth = nestedScanDepth;
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
		const checkout = await canonical(created.path);
		const nested = [];
		try {
			if (this.nestedRepositories !== "none") await this.attachSubmodules(checkout);
			if (this.nestedRepositories === "all") await this.attachRepositories(repositoryRoot, checkout, nested);
		} catch (error) {
			await this.rollback(repositoryRoot, checkout, nested, error);
		}
		return {
			path: checkout,
			branch: created.branch,
			head: created.head,
			main: false,
			repositoryRoot,
			nested
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
	* Remove one linked worktree, together with the nested checkouts inside it.
	*
	* The requested path is matched against the repository's own listing before
	* it becomes a git argument, so a path the model invented cannot reach
	* `git worktree remove`. The main worktree is refused: removing it would
	* delete the repository itself.
	*
	* Nested checkouts are removed first, and each is held to the same rule as
	* the caller's own checkout: they are worktrees of OTHER repositories, whose
	* records would survive with their directories gone if the parent's
	* directory were removed first. Local work is checked before anything is
	* destroyed, so a refusal leaves every checkout in place.
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
		const nested = await findNestedCheckouts(target.path, this.nestedScanDepth);
		const nestedPaths = nested.map((entry) => relativeFrom(target.path, entry.path));
		await this.assertRemovable(target.path, nestedPaths, request.force);
		for (const entry of [...nested].reverse()) {
			await this.assertRemovable(entry.path, [], request.force);
			await this.removeCheckout(entry.repositoryRoot, entry.path, request.force);
		}
		await this.removeCheckout(repositoryRoot, target.path, request.force);
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
		if (this.defaultPath === "sibling") return siblingWorktreePath(repositoryRoot, branch);
		if (this.defaultPath === "home") return homeWorktreePath(this.homeAgentsDirectory, branch);
		return agentsWorktreePath(workspacePath, branch, this.agentsDirectory);
	}
	/**
	* Materialize the submodules one checkout records.
	*
	* `git worktree add` creates each gitlink as an empty directory, so a checkout
	* of a repository with submodules is incomplete without this step. Git keeps
	* every worktree's submodule git directory under that worktree's own
	* administrative entry, so materializing them here leaves the checkouts the
	* caller already had untouched.
	* @param checkout - the checkout to populate.
	*/
	async attachSubmodules(checkout) {
		if (!await isFile(join(checkout, ".gitmodules"))) return;
		await this.git(checkout, [
			"submodule",
			"update",
			"--init",
			"--recursive"
		]);
	}
	/**
	* Attach one linked checkout per repository nested inside the caller's.
	*
	* Each nested repository is its own repository with its own branch space, so
	* its checkout is created the same way the caller's was: a new branch named
	* after the branch it currently holds, based on that branch. The checkout
	* path mirrors the nested repository's place under the original repository
	* root, which puts it inside the new checkout where the original directory
	* was — the path is what makes the copied tree recognizable.
	* @param repositoryRoot - repository root the nested repositories are found under.
	* @param checkout - the parent checkout the nested ones are created inside.
	* @param created - collects each nested creation, in creation order.
	*/
	async attachRepositories(repositoryRoot, checkout, created) {
		for (const nested of await findNestedRepositories(repositoryRoot, this.nestedScanDepth)) {
			const target = join(checkout, ...nested.relative.split("/"));
			const base = await this.currentBranch(nested.root);
			const branch = defaultBranchName(base === DETACHED_HEAD ? void 0 : base);
			await mkdir(dirname(target), { recursive: true });
			await this.git(nested.root, [
				"worktree",
				"add",
				"-b",
				branch,
				target,
				...base === DETACHED_HEAD ? [] : [base]
			]);
			created.push({
				path: target,
				branch,
				repositoryRoot: nested.root
			});
		}
	}
	/**
	* The branch one repository's own checkout holds.
	* @param repositoryRoot - repository root to read.
	* @returns the short branch name, or `HEAD` for a detached or unborn HEAD.
	*/
	async currentBranch(repositoryRoot) {
		return (await this.git(repositoryRoot, [
			"rev-parse",
			"--abbrev-ref",
			"HEAD"
		])).trim();
	}
	/**
	* Undo a creation whose nested repositories could not all be attached.
	*
	* The caller asked for the whole tree or nothing, so every checkout this call
	* created is removed — nested ones first, because each was created inside the
	* one before it. A cleanup that itself fails is reported beside the original
	* failure rather than replacing it: a directory left behind is a fact the
	* caller has to act on, and the reason the creation failed is still the
	* reason.
	* @param repositoryRoot - main repository root of the caller's checkout.
	* @param checkout - the parent checkout to remove.
	* @param nested - the nested creations to remove, in creation order.
	* @param cause - the failure being reported.
	* @throws {Error} always, carrying the cause.
	*/
	async rollback(repositoryRoot, checkout, nested, cause) {
		const failures = [];
		for (const entry of [...nested].reverse()) try {
			await this.git(entry.repositoryRoot, [
				"worktree",
				"remove",
				"--force",
				entry.path
			]);
		} catch (error) {
			failures.push(`${entry.path} (${reason(error)})`);
			await this.pruneQuietly(entry.repositoryRoot);
		}
		try {
			await this.git(repositoryRoot, [
				"worktree",
				"remove",
				"--force",
				checkout
			]);
		} catch (error) {
			failures.push(`${checkout} (${reason(error)})`);
			await this.pruneQuietly(repositoryRoot);
		}
		if (failures.length > 0) throw new Error(`${reason(cause)}; cleanup also failed for ${failures.join(", ")}`);
		throw cause;
	}
	/**
	* Refuse to remove a checkout that holds work nobody has committed.
	*
	* Git's own removal rule is the same one, but Git cannot state it for a
	* checkout it refuses outright (see {@link removeCheckout}), so the rule is
	* applied here where the caller can read it. Paths the caller is about to
	* remove first are excluded from the caller's own checkout, because they are
	* other repositories' work and are judged on their own.
	* @param checkout - the checkout being removed.
	* @param excluded - repository-relative paths inside it that this removal also removes.
	* @param force - the caller's explicit permission to discard local work.
	* @throws {Error} naming the checkout and how much work is at stake.
	*/
	async assertRemovable(checkout, excluded, force) {
		if (force === true) return;
		const pathspecs = [".", ...excluded.map((path) => `:(exclude,literal)${path}`)];
		const changes = (await this.git(checkout, [
			"status",
			"--porcelain",
			"--untracked-files=normal",
			"--",
			...pathspecs
		])).trim();
		if (changes === "") return;
		throw new Error(`refusing to remove ${JSON.stringify(checkout)}: it has uncommitted work (${String(changes.split("\n").length)} path(s)); pass force to remove it anyway`);
	}
	/**
	* Remove one checkout from the repository that owns it.
	*
	* Git refuses to remove any worktree holding a materialized submodule, clean
	* or not, so such a checkout is removed with force — its local work has
	* already been checked by the caller. Every other checkout is offered to Git
	* unchanged, so Git's own refusals (a locked worktree, an unexpected state)
	* still stand.
	* @param repositoryRoot - main repository root that owns the checkout.
	* @param path - the checkout to remove.
	* @param force - the caller's explicit permission to discard local work.
	*/
	async removeCheckout(repositoryRoot, path, force) {
		const forced = force === true || await this.hasSubmodules(path);
		await this.git(repositoryRoot, [
			"worktree",
			"remove",
			...forced ? ["--force"] : [],
			path
		]);
	}
	/**
	* Whether any submodule of one checkout is materialized.
	* @param checkout - the checkout to inspect.
	* @returns true when at least one submodule directory holds a checkout.
	*/
	async hasSubmodules(checkout) {
		if (!await isFile(join(checkout, ".gitmodules"))) return false;
		return (await this.git(checkout, [
			"submodule",
			"status",
			"--recursive"
		])).split("\n").some((line) => line.trim().length > 0 && !line.startsWith("-"));
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
* Express one path relative to another, with `/` separators.
* @param root - directory the result is relative to.
* @param path - path to express.
* @returns the relative path as Git's pathspecs spell it.
*/
function relativeFrom(root, path) {
	return relative(root, path).split(sep).join("/");
}
/**
* Describe a caught failure for a diagnostic.
* @param error - a caught failure.
* @returns its message, or its string form.
*/
function reason(error) {
	return error instanceof Error ? error.message : String(error);
}
/** The abbreviation Git prints for a HEAD that names no branch. */
const DETACHED_HEAD = "HEAD";
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
/**
* Whether a path names an existing regular file.
* @param path - candidate file.
* @returns true when the path is an existing file.
*/
async function isFile(path) {
	try {
		return (await stat(path)).isFile();
	} catch (error) {
		return false;
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
		description: "Create an isolated Git worktree of the current repository and return its path. Use it to work on a separate branch without disturbing the current checkout. The new checkout is a DIFFERENT directory: files, git state, and uncommitted changes there are independent of the current one. Submodules this repository records, and — where the deployment is configured for it — repositories nested inside this one, are created with it, each on its own branch. This tool only creates the checkout — it does not move your session into it.",
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
					},
					nested: {
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
								repositoryRoot: {
									type: "string",
									required: true
								}
							}
						}
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: `Created worktree ${value.path} on branch ${value.branch} (${value.head.slice(0, 12)}) from ${value.repositoryRoot}.` + (value.nested.length === 0 ? "" : ` Nested repositories came with it: ${value.nested.map((entry) => `${entry.path} [${entry.branch}]`).join(", ")}.`)
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
				sessionStarted: false,
				nested: created.nested.map((entry) => ({
					path: entry.path,
					branch: entry.branch,
					repositoryRoot: entry.repositoryRoot
				}))
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
		description: "Remove a linked Git worktree created earlier, together with the checkouts of repositories nested inside it. The main checkout is refused. A worktree with uncommitted changes is refused unless force is set, because removal discards that work.",
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
* the tools rather than failing to activate. The settings service is asked for
* through `ctx.inject` too: a deployment that runs no settings document keeps
* the tools and simply cannot edit this policy while the process runs.
*/
const inject = ["tools"];
/**
* Schemastery validation for {@link Config}.
*
* Left un-annotated deliberately: `z<Config>` also pins the schema's INPUT type
* to `Config`, while an object schema accepts every field as optional — which
* is exactly what a deployment writing only one field needs. The resolved
* output is what {@link apply} receives, so the interface still describes it.
*/
const Config = z.object({
	defaultPath: z.union([
		"agents",
		"sibling",
		"home"
	]).default(DEFAULT_WORKTREE_LAYOUT).volatile(),
	agentsDirectory: z.string().default(DEFAULT_AGENTS_DIRECTORY).volatile(),
	nestedRepositories: z.union([
		"none",
		"submodules",
		"all"
	]).default(DEFAULT_NESTED_REPOSITORIES).volatile(),
	nestedScanDepth: z.number().step(1).min(1).default(1).volatile(),
	gitTimeoutMs: z.number().min(0).default(DEFAULT_GIT_TIMEOUT_MS).volatile(),
	createToolName: z.string(),
	listToolName: z.string(),
	removeToolName: z.string(),
	startSessionRoute: z.boolean()
});
/**
* Read one running plugin's policy off its live configuration.
* @param config - the plugin's resolved configuration.
* @returns the service options those fields currently name.
*/
function liveOptions(config) {
	return {
		timeoutMs: config.gitTimeoutMs.get(),
		defaultPath: config.defaultPath.get(),
		agentsDirectory: config.agentsDirectory.get(),
		nestedRepositories: config.nestedRepositories.get(),
		nestedScanDepth: config.nestedScanDepth.get()
	};
}
/**
* Register the worktree service and its model-facing tools.
* @param ctx - the Host plugin context.
* @param config - the deployment's worktree policy.
*/
function apply(ctx, config) {
	const service = new WorktreeService(liveOptions(config));
	ctx.provide("worktree", service);
	ctx.inject(["settings"], (scope) => {
		scope.effect(() => scope.on("settings/document-updated", (ns) => {
			if (ns !== "worktree") return;
			service.reconfigure(liveOptions(config));
		}), "dsh-worktree: live policy");
	});
	registerTools(ctx, service, {
		create: config.createToolName ?? "worktree_create",
		list: config.listToolName ?? "worktree_list",
		remove: config.removeToolName ?? "worktree_remove"
	});
	if (config.startSessionRoute ?? true) registerRoute(ctx, service);
}
//#endregion
export { Config, SETTINGS_NAMESPACE, WorktreeService, apply, inject, name };
