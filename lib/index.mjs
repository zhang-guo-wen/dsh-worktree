import { homedir, tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import z from "@deepseek-ai/schemastery";
import { appendFile, copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { diffLines } from "diff";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { WorkspaceId } from "@deepseek-ai/dsh-workspace";
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
/**
* Directory under the user's home that holds every workspace's protected files.
*
* Named for what it is rather than for "snapshots": the contents are ordinary
* files in the workspace's own layout, kept so a change can be undone.
*/
const FILE_GUARD_DIRECTORY_SEGMENTS = [".agents", "file-guard"];
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
	code;
	/**
	* @param args - the git arguments that failed, for the diagnostic text.
	* @param cwd - the directory the command ran in.
	* @param stderr - Git's stderr, trimmed.
	*/
	constructor(args, cwd, stderr, code) {
		super(code === "git_not_found" ? "Git was not found. Install Git, add it to the DSH host PATH, then restart DSH." : `git ${args.join(" ")} failed in ${cwd}: ${stderr}`);
		this.args = args;
		this.cwd = cwd;
		this.stderr = stderr;
		this.code = code;
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
			const missingGit = error.code === "ENOENT" && existsSync(cwd);
			rejectPromise(new GitCommandError(args, cwd, stderr.trim() || error.message, missingGit ? "git_not_found" : void 0));
		});
	});
}
/**
* Run one git command and report its exit status instead of throwing on a
* nonzero exit.
*
* Callers use this when a nonzero exit is an answer rather than a failure —
* `git config --get` exits 1 for an unset key, and an unset key is the normal
* first run. Only a spawn-level failure (Git missing) still rejects, because no
* exit status exists to report. The same no-shell rule as {@link runGit}
* applies.
* @param cwd - directory to run in.
* @param args - git arguments, excluding the leading `git`.
* @param environment - extra environment entries layered over the process environment; tests set a
* scratch global-config file through it so no case touches the operator's own configuration.
* @returns stdout, stderr, and the exit status.
* @throws {GitCommandError} when Git cannot be spawned at all.
*/
async function runGitWithExit(cwd, args, environment) {
	return await new Promise((resolvePromise, rejectPromise) => {
		execFile("git", [...args], {
			cwd,
			windowsHide: true,
			maxBuffer: 16777216,
			...environment === void 0 ? {} : { env: {
				...process.env,
				...environment
			} }
		}, (error, stdout, stderr) => {
			if (error === null) {
				resolvePromise({
					stdout,
					stderr,
					code: 0
				});
				return;
			}
			const failure = error;
			if (failure.code === "ENOENT" && existsSync(cwd)) {
				rejectPromise(new GitCommandError(args, cwd, stderr.trim() || error.message, "git_not_found"));
				return;
			}
			if (typeof failure.code === "number") {
				resolvePromise({
					stdout,
					stderr,
					code: failure.code
				});
				return;
			}
			rejectPromise(new GitCommandError(args, cwd, stderr.trim() || error.message));
		});
	});
}
/**
* Whether a directory is inside a Git working tree.
* @param cwd - absolute directory to test.
* @returns true when `git rev-parse` finds a work tree.
*/
async function isGitWorkTree(cwd) {
	try {
		return (await runGit(cwd, ["rev-parse", "--is-inside-work-tree"])).trim() === "true";
	} catch (error) {
		return false;
	}
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
var InvalidInitialSelectionError = class extends Error {
	constructor() {
		super("initial commit selection changed; reopen the dialog and choose the files again");
		this.name = "InvalidInitialSelectionError";
	}
};
/** Keep one top-level name literal in an anchored .gitignore pattern. */
function escapeIgnoreName(name) {
	if (/[\r\n]/u.test(name)) throw new Error("file names containing line breaks cannot be added to .gitignore");
	const special = /* @__PURE__ */ new Set([
		"\\",
		"*",
		"?",
		"[",
		"]",
		"#",
		"!",
		" "
	]);
	return Array.from(name, (character) => special.has(character) ? `\\${character}` : character).join("");
}
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
	/** List only top-level items. Git metadata and the rules file are managed separately. */
	async initialCommitEntries(cwd) {
		assertAbsolutePath(cwd, "cwd");
		const entries = await readdir(cwd, { withFileTypes: true });
		const result = [];
		for (const entry of entries) {
			if (entry.name === ".git" || entry.name === ".gitignore") continue;
			if (!entry.isDirectory()) {
				result.push({
					name: entry.name,
					kind: "file"
				});
				continue;
			}
			let nestedRepository = false;
			try {
				await lstat(join(cwd, entry.name, ".git"));
				nestedRepository = true;
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
			result.push({
				name: entry.name,
				kind: nestedRepository ? "nested_repository" : "directory"
			});
		}
		return result.sort((left, right) => left.name.localeCompare(right.name));
	}
	/** Initialize a workspace and optionally stage chosen first-level items. */
	async initialize(cwd, selectedEntries) {
		assertAbsolutePath(cwd, "cwd");
		if (!(await stat(cwd)).isDirectory()) throw new Error("workspace path is not a directory");
		try {
			await lstat(join(cwd, ".git"));
			throw new Error("workspace already has Git metadata");
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		try {
			await this.git(cwd, ["rev-parse", "--is-inside-work-tree"]);
			throw new Error("workspace is already inside a Git repository");
		} catch (error) {
			if (!(error instanceof Error) || !error.message.includes("not a git repository")) throw error;
		}
		const entries = selectedEntries === void 0 ? [] : await this.initialCommitEntries(cwd);
		const selectable = new Set(entries.filter((entry) => entry.kind !== "nested_repository").map((entry) => entry.name));
		if (selectedEntries !== void 0 && (new Set(selectedEntries).size !== selectedEntries.length || selectedEntries.some((name) => !selectable.has(name)))) throw new InvalidInitialSelectionError();
		const ignored = selectedEntries === void 0 ? [] : entries.filter((entry) => !selectedEntries.includes(entry.name));
		const ignoreLines = ignored.map((entry) => `/${escapeIgnoreName(entry.name)}${entry.kind === "file" ? "" : "/"}`);
		const ignorePath = join(cwd, ".gitignore");
		let ignoreExists = false;
		try {
			if (!(await lstat(ignorePath)).isFile()) throw new Error(".gitignore must be a regular file");
			ignoreExists = true;
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		await this.git(cwd, [
			"init",
			"-q",
			"-b",
			"main"
		]);
		if (selectedEntries !== void 0) {
			if (ignored.length > 0) {
				const existing = ignoreExists ? await readFile(ignorePath, "utf8") : "";
				await appendFile(ignorePath, `${existing && !existing.endsWith("\n") ? "\n" : ""}# Excluded from the first commit by DSH Worktree\n${ignoreLines.join("\n")}\n`);
				ignoreExists = true;
			}
			if (ignoreExists) await this.git(cwd, [
				"add",
				"-f",
				"--",
				":(literal).gitignore"
			]);
			for (const name of selectedEntries) try {
				await this.git(cwd, [
					"add",
					"-f",
					"--",
					`:(literal)${name}`
				]);
			} catch (error) {
				if (entries.find((entry) => entry.name === name)?.kind !== "directory" || !(error instanceof Error) || !error.message.includes("did not match any files")) throw error;
			}
		}
		await this.git(cwd, [
			"-c",
			"user.name=DeepSeek Harness",
			"-c",
			"user.email=dsh@localhost",
			"commit",
			"--allow-empty",
			"-q",
			"-m",
			"Initialize workspace for worktrees"
		]);
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
		const nestedSkipped = [];
		try {
			if (this.nestedRepositories !== "none") await this.attachSubmodules(checkout);
			if (this.nestedRepositories === "all") await this.attachRepositories(repositoryRoot, checkout, nested, nestedSkipped);
		} catch (error) {
			await this.rollback(repositoryRoot, checkout, nested, error);
		}
		return {
			path: checkout,
			branch: created.branch,
			head: created.head,
			main: false,
			repositoryRoot,
			nested,
			nestedSkipped
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
	* Describe `path` when it is a linked checkout of a Git repository.
	*
	* This is the only way to tell a checkout apart from a repository's own
	* working tree, and callers outside git need the distinction: the identical
	* directory shape holds for both, and removing the main worktree would delete
	* the repository. The answer comes from the repository's own listing — the
	* same listing {@link remove} validates against — so a path that is merely
	* *inside* a checkout, or a directory that only looks like one, is not a
	* linked checkout.
	* @param path - absolute directory to describe.
	* @returns the repository root, the checkout's canonical path, and the main
	* worktree's path; `undefined` when the path is not a linked checkout.
	* @throws {Error} when the path is not absolute or git itself fails.
	*/
	async inspectLinkedCheckout(path) {
		assertAbsolutePath(path, "path");
		const records = await this.list(path);
		const requested = await canonical(path);
		const record = records.find((entry) => samePath(entry.path, requested));
		if (record === void 0 || record.main) return void 0;
		const main = records.find((entry) => entry.main);
		if (main === void 0) return void 0;
		const common = (await this.git(path, [
			"rev-parse",
			"--path-format=absolute",
			"--git-common-dir"
		])).trim();
		return {
			repositoryRoot: await canonical(dirname(common)),
			path: record.path,
			main: main.path
		};
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
	*
	* One nested repository that cannot take a branch is left out and named
	* instead of failing the call: the caller asked for a checkout, and a
	* repository with nothing to check out is a normal state of the tree rather
	* than a reason to hand back no checkout at all. Every skip is reported, so
	* the caller can tell a complete mirror from a partial one.
	* @param repositoryRoot - repository root the nested repositories are found under.
	* @param checkout - the parent checkout the nested ones are created inside.
	* @param created - collects each nested creation, in creation order.
	* @param skipped - collects each repository left out, in the same order.
	*/
	async attachRepositories(repositoryRoot, checkout, created, skipped) {
		for (const nested of await findNestedRepositories(repositoryRoot, this.nestedScanDepth)) {
			const target = join(checkout, ...nested.relative.split("/"));
			if (!await this.hasCommit(nested.root)) {
				skipped.push({
					repositoryRoot: nested.root,
					relative: nested.relative,
					code: "no-commits",
					reason: "the repository has no commit, so it has no HEAD to start a branch from"
				});
				continue;
			}
			let base;
			try {
				base = await this.currentBranch(nested.root);
			} catch (error) {
				skipped.push({
					repositoryRoot: nested.root,
					relative: nested.relative,
					code: "create-failed",
					reason: reason$1(error)
				});
				continue;
			}
			const branch = defaultBranchName(base === DETACHED_HEAD ? void 0 : base);
			try {
				await mkdir(dirname(target), { recursive: true });
				await this.git(nested.root, [
					"worktree",
					"add",
					"-b",
					branch,
					target,
					...base === DETACHED_HEAD ? [] : [base]
				]);
			} catch (error) {
				await this.pruneQuietly(nested.root);
				skipped.push({
					repositoryRoot: nested.root,
					relative: nested.relative,
					code: "create-failed",
					reason: reason$1(error)
				});
				continue;
			}
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
	* Whether one repository has a commit, which is what a new branch needs.
	*
	* Read through `rev-parse --verify HEAD` rather than the branch name: an
	* unborn HEAD still names the branch Git would use, so the branch name alone
	* cannot tell a repository with commits from one without.
	* @param repositoryRoot - repository root to read.
	* @returns true when HEAD resolves to a commit.
	*/
	async hasCommit(repositoryRoot) {
		try {
			await this.git(repositoryRoot, [
				"rev-parse",
				"--verify",
				"HEAD"
			]);
			return true;
		} catch (error) {
			return false;
		}
	}
	/**
	* Undo a creation whose submodules could not be materialized.
	*
	* The caller asked for the tree the parent records, so an incomplete
	* materialization removes every checkout this call created — nested ones
	* first, because each was created inside the one before it. An independent
	* nested repository that cannot take a branch is deliberately not in this
	* class: it is reported as skipped instead, and its creation survives.
	* A cleanup that itself fails is reported beside the original failure rather
	* than replacing it: a directory left behind is a fact the caller has to act
	* on, and the reason the creation failed is still the reason.
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
			failures.push(`${entry.path} (${reason$1(error)})`);
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
			failures.push(`${checkout} (${reason$1(error)})`);
			await this.pruneQuietly(repositoryRoot);
		}
		if (failures.length > 0) throw new Error(`${reason$1(cause)}; cleanup also failed for ${failures.join(", ")}`);
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
function reason$1(error) {
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
//#region src/archive-cleanup.ts
/**
* Latest outcome per checkout path.
*
* In-memory on purpose: it answers a banner that follows the archive by
* seconds, so it needs no durability, and dropping it only costs a missing
* banner — never a wrong one. The entry is cleared when a later attempt at the
* same path overwrites it (`kept` then `removed`, or the reverse).
*/
const archiveProbes = /* @__PURE__ */ new Map();
/** Record what the archive flow did to one checkout. */
function rememberArchiveOutcome(path, outcome) {
	archiveProbes.set(path, outcome);
}
/**
* Answer what happened to a checkout path whose Workspace row is gone.
* @param path - the canonical checkout path.
* @returns the recorded outcome, or `unknown` when this path saw no removal.
*/
function probeArchiveOutcome(path) {
	return archiveProbes.get(path) ?? { outcome: "unknown" };
}
/**
* The storage domain whose global singleton carries the archive set.
*
* The registry opens it once (`workspaceDomainSpec`), so every durable write of
* `archivedSessionIds` is announced as a `domain/changed` put on this domain.
*/
const WORKSPACE_DOMAIN = "workspace";
/**
* Wire post-archive cleanup into one Host context.
*
* Registration rides the plugin's fiber: unloading the plugin removes the two
* listeners and nothing else — no checkout is touched by disposal.
* @param ctx - the Host plugin context.
* @param service - the worktree capability doing the removal.
* @param guard - the file guard whose per-session backups end with the session.
* @param wiring - whether archived sessions' linked checkouts are removed.
*/
function installArchiveCleanup(ctx, service, guard, wiring = {}) {
	const removeCheckouts = wiring.removeCheckouts ?? true;
	let pending = Promise.resolve();
	/** Serialize cleanups: two archives landing together must not race on one registry. */
	const serialize = (work) => {
		pending = pending.then(work, work).catch((error) => {
			ctx.logger?.warn?.(`dsh-worktree: post-archive cleanup failed: ${String(error)}`);
		});
	};
	ctx.inject(["workspaceRegistry"], (scope) => {
		const registry = scope.workspaceRegistry;
		/**
		* Sessions this process has already cleaned up for.
		*
		* Seeded with the set this process started with, which is deliberately not
		* its to clean: an archive that happened while no host was running is the
		* user's own history, and deleting it when the next host starts would carry
		* out a decision nobody made in that session. Only an archive that arrives
		* while this process runs is acted on.
		*/
		const handled = new Set(registry.archivedSessionIds.map(String));
		const pendingBackups = /* @__PURE__ */ new Set();
		const cleanBackups = async () => {
			for (const id of pendingBackups) {
				if (!registry.archivedSessionIds.some((archivedId) => String(archivedId) === id)) {
					pendingBackups.delete(id);
					continue;
				}
				try {
					await guard?.archive(id);
					pendingBackups.delete(id);
				} catch (error) {
					scope.logger?.warn?.(`dsh-worktree: could not clean backups for archived session ${JSON.stringify(id)}: ${reason(error)}`);
				}
			}
		};
		/**
		* End the backups — and the checkout — of every archive that arrived since
		* the previous call.
		*
		* Backups end with the session that took them; the checkout goes with them,
		* because this process watched that archive happen. An id that left the set —
		* unarchived — is forgotten, so a later archive of the same session is a new
		* arrival.
		*/
		const cleanArrived = async () => {
			const archived = new Set(registry.archivedSessionIds.map(String));
			for (const id of handled) {
				if (archived.has(id)) continue;
				handled.delete(id);
				pendingBackups.delete(id);
				guard?.resume(id);
			}
			const arrived = [...archived].filter((id) => !handled.has(id));
			for (const id of arrived) {
				handled.add(id);
				pendingBackups.add(id);
			}
			await cleanBackups();
			if (removeCheckouts) await reconcile(scope, service, registry, arrived);
		};
		scope.effect(() => scope.on("domain/changed", (change) => {
			if (change.domain !== WORKSPACE_DOMAIN) return;
			if (change.operation !== "put" || change.table !== "" || change.key !== "") return;
			serialize(async () => {
				await new Promise((resolve) => {
					setImmediate(resolve);
				});
				await cleanArrived();
			});
		}), "dsh-worktree: clean up a session as soon as its archive is durable");
		scope.effect(() => scope.on("workspace/session-stop", ({ sessionId }) => {
			serialize(async () => {
				if (!registry.archivedSessionIds.some((id) => String(id) === String(sessionId))) return;
				pendingBackups.add(String(sessionId));
				await cleanBackups();
				if (removeCheckouts) await reconcile(scope, service, registry, [sessionId]);
			});
		}), "dsh-worktree: remove the checkout of an archived session");
	});
}
/**
* Remove the checkout of every session in `sessionIds` that is archived.
* @param ctx - context for the session store and the logger.
* @param service - the worktree capability.
* @param registry - the workspace registry.
* @param sessionIds - session ids to consider; extra ids are ignored.
*/
async function reconcile(ctx, service, registry, sessionIds) {
	const archived = new Set(registry.archivedSessionIds);
	if (archived.size === 0) return;
	const sessions = ctx.get("sessions");
	for (const sessionId of sessionIds) {
		if (!archived.has(String(sessionId))) continue;
		const workspace = findWorkspace(registry, sessionId, sessions);
		if (workspace === void 0) continue;
		if (!archived.has(String(workspace.sessionIds[0]))) continue;
		await discard$1(ctx, service, registry, workspace);
	}
}
/**
* Locate the workspace a session belongs to.
*
* The session's own header cwd is the authoritative answer when it is still
* live; after the session is gone, the registry's accounting is.
* @param registry - the workspace registry.
* @param sessionId - the session to locate.
* @param sessions - the live session store, when the host has one.
* @returns the workspace, or undefined when the session is accounted nowhere.
*/
function findWorkspace(registry, sessionId, sessions) {
	const cwd = sessions?.get(sessionId)?.header.cwd;
	const normalized = cwd === void 0 ? void 0 : normalize(cwd);
	return registry.list().find((workspace) => normalized !== void 0 && normalize(workspace.path) === normalized || workspace.sessionIds.some((id) => String(id) === String(sessionId)));
}
/**
* Remove one archived session's linked checkout and its workspace registration.
* @param ctx - context for the logger.
* @param service - the worktree capability.
* @param registry - the workspace registry.
* @param workspace - the workspace whose checkout should go.
*/
async function discard$1(ctx, service, registry, workspace) {
	let checkout;
	try {
		checkout = await service.inspectLinkedCheckout(workspace.path);
	} catch (error) {
		ctx.logger?.warn?.(`dsh-worktree: could not inspect ${JSON.stringify(workspace.path)} after archiving: ${reason(error)}`);
		return;
	}
	if (checkout === void 0) return;
	try {
		await service.remove({
			cwd: checkout.repositoryRoot,
			path: checkout.path
		});
	} catch (error) {
		const failure = reason(error);
		rememberArchiveOutcome(checkout.path, {
			outcome: "kept",
			reason: failure
		});
		ctx.logger?.warn?.(`dsh-worktree: kept ${JSON.stringify(checkout.path)} after archiving its session: ${failure}`);
		return;
	}
	rememberArchiveOutcome(checkout.path, { outcome: "removed" });
	try {
		await registry.delete(workspace.id);
	} catch (error) {
		ctx.logger?.warn?.(`dsh-worktree: removed ${JSON.stringify(checkout.path)} but could not drop its workspace record: ${reason(error)}`);
	}
}
/** Compare two paths by identity rather than spelling, matching the service's canon. */
function normalize(value) {
	const trimmed = value.replace(/[\\/]+$/, "").replace(/\\/g, "/");
	return process.platform === "win32" ? trimmed.toLowerCase() : trimmed;
}
/** Describe a caught failure for a diagnostic. */
function reason(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
//#region src/compare.ts
/**
* Line comparison for the file-backup page's two-column view.
*
* The two sides are texts the Host already has on disk: the copy taken before
* this session first changed a file, and that file as it is now. No version
* control participates, so the same answer comes back on a machine without Git.
*
* A row holds one line of each side. Deleted lines sit alone on the left, added
* lines alone on the right, and a replaced block pairs its deletions with its
* additions row by row so the columns stay aligned. Long unchanged stretches
* collapse into a single gap row once the whole file would be too expensive to
* draw, which keeps a large file's changes visible without hiding them behind a
* cut.
* @module @guowenzhang/dsh-worktree/compare
*/
/** Context rows kept on each side of a change when unchanged runs collapse. */
const KEPT_CONTEXT = 3;
/** Rows at which the view starts collapsing unchanged runs instead of drawing them. */
const FULL_VIEW_ROWS = 1200;
/** Rows a comparison may carry; a longer one is cut and reported truncated. */
const MAX_ROWS = 2400;
/** Bound on one line comparison; a slower one degrades to a whole-block replacement. */
const DIFF_TIMEOUT_MS = 1e3;
/**
* Split one side into display lines.
*
* A byte-order mark is not content and a carriage return is not a line of its
* own, so both are dropped here: a CRLF file compares against an LF one without
* every line reporting as changed. A single trailing newline terminates the last
* line rather than opening an empty one.
* @param text - the side's text.
* @returns its lines, without terminators.
*/
function splitLines(text) {
	const body = text.startsWith("﻿") ? text.slice(1) : text;
	if (body === "") return [];
	return (body.endsWith("\n") ? body.slice(0, -1) : body).split("\n").map((line) => line.endsWith("\r") ? line.slice(0, -1) : line);
}
/**
* Join lines back with one terminator each.
*
* Comparing terminated text is what makes the last line compare by content
* alone: the line-based diff then never reports a final-newline difference as a
* changed line.
* @param lines - the side's lines.
* @returns the text with every line terminated.
*/
function terminate(lines) {
	return lines.length === 0 ? "" : lines.map((line) => `${line}\n`).join("");
}
/**
* The lines one change part carries.
* @param value - the part's text.
* @returns its lines, without terminators.
*/
function partLines(value) {
	if (value === "") return [];
	return (value.endsWith("\n") ? value.slice(0, -1) : value).split("\n");
}
/**
* Shape the rows every comparison ends with: collapse unchanged runs when the
* file is large, then cut at the hard row limit.
* @param rows - every row of the comparison.
* @param added - lines the current file added.
* @param deleted - lines the current file deleted.
* @param coarse - whether the line diff degraded to a whole-block replacement.
* @returns the comparison the route serves.
*/
function finish(rows, added, deleted, coarse) {
	const collapsed = rows.length > FULL_VIEW_ROWS ? collapse(rows) : rows;
	const truncated = collapsed.length > MAX_ROWS;
	return {
		rows: truncated ? collapsed.slice(0, MAX_ROWS) : collapsed,
		added,
		deleted,
		truncated,
		coarse
	};
}
/**
* Replace every unchanged run longer than the kept context with one gap row.
* @param rows - the full row list.
* @returns the row list with long unchanged runs collapsed.
*/
function collapse(rows) {
	const kept = [];
	let index = 0;
	while (index < rows.length) {
		const row = rows[index];
		if (row === void 0 || row.kind !== "context") {
			if (row !== void 0) kept.push(row);
			index += 1;
			continue;
		}
		let end = index;
		while (end < rows.length) {
			const current = rows[end];
			if (current === void 0 || current.kind !== "context") break;
			end += 1;
		}
		const run = end - index;
		if (run > 6) {
			for (let head = 0; head < KEPT_CONTEXT; head += 1) {
				const at = rows[index + head];
				if (at !== void 0) kept.push(at);
			}
			kept.push({
				kind: "gap",
				hidden: run - 6
			});
			for (let tail = end - KEPT_CONTEXT; tail < end; tail += 1) {
				const at = rows[tail];
				if (at !== void 0) kept.push(at);
			}
		} else for (let at = index; at < end; at += 1) {
			const current = rows[at];
			if (current !== void 0) kept.push(current);
		}
		index = end;
	}
	return kept;
}
/**
* Build a comparison whose line diff did not finish inside its bound.
*
* Pairing the sides row by row keeps the columns aligned and shows both
* complete texts; the `coarse` flag tells the reader this is a fallback rather
* than a line-by-line result.
* @param beforeLines - the old side's lines.
* @param afterLines - the new side's lines.
* @returns the whole-block comparison.
*/
function replaceAll(beforeLines, afterLines) {
	const rows = [];
	const size = Math.max(beforeLines.length, afterLines.length);
	for (let index = 0; index < size; index += 1) {
		const before = beforeLines[index];
		const after = afterLines[index];
		rows.push({
			kind: "change",
			...before === void 0 ? {} : { left: {
				no: index + 1,
				text: before
			} },
			...after === void 0 ? {} : { right: {
				no: index + 1,
				text: after
			} }
		});
	}
	return finish(rows, afterLines.length, beforeLines.length, true);
}
/**
* Build the rows one line diff reports.
* @param parts - the diff's change parts, in file order.
* @returns the comparison.
*/
function fromParts(parts) {
	const rows = [];
	let added = 0;
	let deleted = 0;
	let oldNo = 1;
	let newNo = 1;
	for (let at = 0; at < parts.length; at += 1) {
		const part = parts[at];
		if (part === void 0) continue;
		if (part.removed === true) {
			const gone = partLines(part.value);
			const next = parts[at + 1];
			const arrived = next?.added === true ? partLines(next.value) : [];
			if (next?.added === true) at += 1;
			deleted += gone.length;
			added += arrived.length;
			const size = Math.max(gone.length, arrived.length);
			for (let index = 0; index < size; index += 1) {
				const before = gone[index];
				const after = arrived[index];
				rows.push({
					kind: "change",
					...before === void 0 ? {} : { left: {
						no: oldNo + index,
						text: before
					} },
					...after === void 0 ? {} : { right: {
						no: newNo + index,
						text: after
					} }
				});
			}
			oldNo += gone.length;
			newNo += arrived.length;
			continue;
		}
		if (part.added === true) {
			const arrived = partLines(part.value);
			added += arrived.length;
			for (const text of arrived) {
				rows.push({
					kind: "change",
					right: {
						no: newNo,
						text
					}
				});
				newNo += 1;
			}
			continue;
		}
		for (const text of partLines(part.value)) {
			const left = {
				no: oldNo,
				text
			};
			const right = {
				no: newNo,
				text
			};
			rows.push({
				kind: "context",
				left,
				right
			});
			oldNo += 1;
			newNo += 1;
		}
	}
	return finish(rows, added, deleted, false);
}
/**
* Compare two texts line by line.
*
* A null side does not exist (a deleted or a not-yet-existing file) and is
* treated as empty, so a deletion shows every old line on the left and a
* creation shows every new line on the right.
* @param before - the copy's text, or null when there is none.
* @param after - the current file's text, or null when it is gone.
* @returns the rows and totals the detail view renders.
*/
function compareTexts(before, after) {
	const beforeLines = splitLines(before ?? "");
	const afterLines = splitLines(after ?? "");
	const oldText = terminate(beforeLines);
	const newText = terminate(afterLines);
	if (oldText === newText) return {
		rows: [],
		added: 0,
		deleted: 0,
		truncated: false,
		coarse: false
	};
	const parts = diffLines(oldText, newText, { timeout: DIFF_TIMEOUT_MS });
	return parts === void 0 ? replaceAll(beforeLines, afterLines) : fromParts(parts);
}
//#endregion
//#region src/file-guard.ts
/**
* Pre-change file protection: the first time the AI is about to touch an
* existing file, that file's current bytes are copied out of the workspace, so
* a bad edit or a deletion is recoverable by copying the file back.
*
* Four decisions shape this module, each taken on measured evidence rather than
* convenience.
*
* **One backup per file, per session.** The copy is taken before the first
* change and is never replaced afterwards. That bounds total storage by the size
* of the files actually touched, independent of how many turns a session runs —
* the failure mode that makes Cursor's snapshot store grow without bound, and
* the reason a per-file version history (VS Code keeps 50) is not needed. It
* also removes content-addressed deduplication: with one copy per file there is
* nothing to deduplicate. A file another session already protected is copied
* again, because backups live and die with the session that asked for them
* (see the cleanup rule below).
*
* **No size cap.** Large files dominate: of 243,529 files under this machine's
* codespace, the 3,472 above 256 KB are 79.5% of the bytes. Copying VS Code's
* 256 KB cutoff would silently abandon four fifths of the data to save nothing.
* Copies move at 623 MB/s here, so the cost is per-file syscall overhead
* (0.94 ms) rather than bandwidth.
*
* **Only files that already exist.** A file the AI creates has no prior state to
* preserve: deleting it restores the same absent state that existed before. That
* exemption lasts only for the run that watched the file appear. A file created
* in an earlier session reads as pre-existing on its first change in a later
* one, which keeps a generated file's iterations recoverable; only re-editing it
* inside the creating session stays unprotected.
*
* **Backups are session-scoped and end with the session.** Each session owns one
* directory, and archiving the session deletes it. The alternative — sharing a
* directory per workspace — cannot answer "who still needs these files" when a
* workspace outlives all its sessions, and a sweep that guesses risks deleting
* another live session's latest copy.
*
* Discovery is precise, because the cost of protection is a function of how the
* target is found, not of the copy: a known path is one `copyFile`, while
* walking this workspace to discover changes costs seconds. The automatic path
* therefore reads the file a tool named in its own arguments and stays inside
* the session's working directory; anything else — another directory, another
* drive — is declared through {@link BACKUP_TOOL_NAME}, which has no scope
* limit, and the destructive shell commands are refused so the model declares
* its targets instead of deleting blind.
*
* The copies are also the restore list. {@link FileGuard.list} walks one
* session's directory and reports the files that differ from their copy, and
* {@link FileGuard.restore} writes one copy back over its file; both work from
* the tree alone, because a copy that exists is the only thing a restore needs.
* A change is detected by comparing content, since the copy is written just
* before the change and shares no timestamp with the state it preserved.
*
* @module @guowenzhang/dsh-worktree/file-guard
*/
/** Tool argument names that carry the path a call is about to change. */
const FILE_TARGET_ARGUMENTS = ["file_path"];
/**
* Tools that change files without naming one.
*
* Their arguments cannot name a target, so the destructive ones are refused and
* the model is told what to do instead.
*/
const SHELL_TOOLS = ["bash", "pwsh"];
/**
* Command shapes that destroy an existing file or directory.
*
* Matched against the command text with quoted spans removed, so a command that
* merely mentions a destructive word (`echo "rm -rf"`) is not refused. A false
* positive costs one retry; a false negative costs unprotected data.
*/
const DESTRUCTIVE_COMMAND = /(^|[|&;(\s])(rm|rmdir|del|erase|rd|Remove-Item|ri)(\s|$)/i;
/**
* Name of the model-facing tool that protects declared paths.
*
* Declared here rather than beside the tool definition because the refusal text
* below names it, and the tool definition module imports from this one.
*/
const BACKUP_TOOL_NAME = "worktree_backup";
/** Directory segment holding files protected from outside the working directory. */
const EXTERNAL_SEGMENT = "external";
/**
* A restore that names no copy this session holds.
*
* Distinguished from an I/O failure because the two need different answers: a
* request naming nothing is the caller's mistake, while a copy that exists and
* cannot be written is a failure of the machine.
*/
var NoSuchBackupError = class extends Error {
	/**
	* @param session - the session whose directory was searched.
	* @param relative - the copy path that was not found under it.
	*/
	constructor(session, relative) {
		super(`session ${JSON.stringify(session)} holds no backup at ${JSON.stringify(relative)}`);
		this.name = "NoSuchBackupError";
	}
};
/**
* Copies files out of a session's reach before anything changes them.
*
* One instance is created per plugin load and disposed with the plugin fiber.
* What it remembers is which files each session already copied, which is what
* makes the first copy authoritative and later ones free.
*/
var FileGuard = class {
	directory;
	denyDestructiveCommands;
	/** Paths already copied, keyed by session. */
	protected_ = /* @__PURE__ */ new Map();
	/**
	* Paths this run watched appear, keyed by session.
	*
	* A file the AI created has no prior state to preserve while the session that
	* created it is still running, and this is what keeps it unprotected for that
	* window. Deliberately memory-only: a later session constructs a new guard, so
	* a file created earlier reads as pre-existing and is protected on its first
	* change there.
	*/
	created = /* @__PURE__ */ new Map();
	/** Closed sessions cannot recreate backups while their cancelled tools settle. */
	archived = /* @__PURE__ */ new Set();
	/** Allow protection again after an explicit unarchive. */
	resume(session) {
		this.archived.delete(sessionKeyOf(session));
	}
	/**
	* @param options - where copies are kept and the shell policy.
	*/
	constructor(options) {
		this.directory = options.directory;
		this.denyDestructiveCommands = options.denyDestructiveCommands;
	}
	/** Root directory holding every session's protected files. */
	get root() {
		return this.directory;
	}
	/**
	* Copy one file out, once per session.
	* @param agent - the calling agent; its session owns the copy.
	* @param declared - the file to protect, absolute or relative to its working directory.
	* @returns what happened, which the callers report rather than infer.
	*/
	async protect(agent, declared) {
		const placement = this.place(agent, declared);
		if (placement === void 0) return {
			path: declared,
			outcome: "absent"
		};
		const { sessionKey, relativePath } = placement;
		if (this.archived.has(sessionKey)) return {
			path: declared,
			outcome: "absent"
		};
		const destination = join(this.directory, sessionKey, relativePath);
		const known = this.protectedFor(sessionKey);
		if (known.has(relativePath)) return {
			path: declared,
			outcome: "already-protected",
			backup: destination
		};
		if (this.createdFor(sessionKey).has(relativePath)) return {
			path: declared,
			outcome: "absent"
		};
		const target = resolveTarget(agent, declared);
		if (target === void 0) return {
			path: declared,
			outcome: "absent"
		};
		let info;
		try {
			info = await stat(target);
		} catch (error) {
			if (isMissing(error)) {
				this.createdFor(sessionKey).add(relativePath);
				return {
					path: declared,
					outcome: "absent"
				};
			}
			throw error;
		}
		if (!info.isFile()) return {
			path: declared,
			outcome: "not-a-file"
		};
		await mkdir(dirname(destination), { recursive: true });
		await copyFile(target, destination);
		if (this.archived.has(sessionKey)) {
			await this.archive(agent.session.id);
			return {
				path: declared,
				outcome: "absent"
			};
		}
		known.add(relativePath);
		return {
			path: declared,
			outcome: "protected",
			backup: destination
		};
	}
	/**
	* Protect every path one `worktree_backup` call declared.
	* @param agent - the calling agent, whose session owns the copies.
	* @param paths - paths to protect, absolute or relative to the working directory.
	* @returns the per-path outcomes the tool reports back to the model.
	*/
	async protectAll(agent, paths) {
		const results = [];
		for (const path of paths) results.push(await this.protect(agent, path));
		return results;
	}
	/**
	* List one session's backups whose file is not what the copy holds.
	*
	* The copy tree is the whole record, so this walks it rather than consulting
	* an index: one directory per session, the file's own path below it. A copy
	* whose file is byte-identical is left out — the copy was not needed, and
	* reporting it as changed would invite a restore that changes nothing. A copy
	* outside the working directory whose original path cannot be reconstructed
	* (a UNC share) is left out rather than pointed at a guessed location.
	* @param session - the session whose backups to list.
	* @param workspace - the absolute working directory the relative copies restore into.
	* @returns the changed and deleted files, by name.
	*/
	async list(session, workspace) {
		const directory = join(this.directory, sessionKeyOf(session));
		const entries = [];
		for (const relative of (await copiesUnder(directory)).sort()) {
			const target = targetOf(workspace, relative);
			if (target === void 0) continue;
			const state = await difference(join(directory, relative), target);
			if (state === void 0) continue;
			entries.push({
				relative,
				path: target,
				name: nameOf(relative, target),
				backup: join(directory, relative),
				state
			});
		}
		return entries;
	}
	/**
	* Whether one session's directory holds any copy at all.
	*
	* The route asks this only for a session whose working directory cannot be
	* resolved: a session with no copy has nothing to list, so the page answers
	* an empty list instead of an error, while a copy the Host cannot address is
	* a refusal. Answered from the tree alone, like {@link FileGuard.list}; a
	* directory that was never created holds none.
	* @param session - the session whose copies to look for.
	* @returns true when at least one copy file exists below its directory.
	*/
	async hasCopies(session) {
		return (await copiesUnder(join(this.directory, sessionKeyOf(session)))).length > 0;
	}
	/**
	* Copy one backup back over the file it came from.
	*
	* The copy is the state from before this session's first change, so writing it
	* back is what undoes that change — including for a file that was deleted, in
	* which case the directory holding it is created again. The backup itself is
	* kept: it stays the session's record of the original, and a later restore of
	* the same file uses it again.
	* @param session - the session holding the backup.
	* @param workspace - the absolute working directory the relative copies restore into.
	* @param relative - the copy's path below the session directory, as listed.
	* @returns the absolute path written, and the bytes copied.
	* @throws {NoSuchBackupError} when no copy exists at that path.
	*/
	async restore(session, workspace, relative) {
		const source = contained(join(this.directory, sessionKeyOf(session)), relative);
		const target = source === void 0 ? void 0 : targetOf(workspace, relative);
		if (source === void 0 || target === void 0) throw new NoSuchBackupError(session, relative);
		let info;
		try {
			info = await stat(source);
		} catch (error) {
			if (isMissing(error)) throw new NoSuchBackupError(session, relative);
			throw error;
		}
		if (!info.isFile()) throw new NoSuchBackupError(session, relative);
		await mkdir(dirname(target), { recursive: true });
		await copyFile(source, target);
		return {
			path: target,
			bytes: info.size
		};
	}
	/**
	* Compare one protected file with the file it stands for.
	*
	* The two sides are read from disk: the copy the guard kept before this
	* session first changed the file, and the file where it is now. The read is
	* lazy — the list never reads content — and bounded, because a copy can be any
	* size: a side over the byte cap is reported without content rather than
	* loaded, and a side that is not UTF-8 text (a document, an archive, an
	* image — the formats the guard deliberately protects) is reported as binary.
	*
	* The target is resolved from the session's own working directory, exactly as
	* a restore resolves it: the request names a copy, never a path to read.
	* @param session - the session holding the copy.
	* @param workspace - the absolute working directory the copy's path resolves against.
	* @param relative - the copy's path below the session directory.
	* @returns the comparison, or the reason content cannot be shown line by line.
	* @throws {NoSuchBackupError} when no copy exists at that path.
	*/
	async compare(session, workspace, relative) {
		const source = contained(join(this.directory, sessionKeyOf(session)), relative);
		const target = source === void 0 ? void 0 : targetOf(workspace, relative);
		if (source === void 0 || target === void 0) throw new NoSuchBackupError(session, relative);
		let copyInfo;
		try {
			copyInfo = await stat(source);
		} catch (error) {
			if (isMissing(error)) throw new NoSuchBackupError(session, relative);
			throw error;
		}
		if (!copyInfo.isFile()) throw new NoSuchBackupError(session, relative);
		const name = nameOf(relative, target);
		let fileInfo;
		try {
			fileInfo = await stat(target);
		} catch (error) {
			if (!isMissing(error)) throw error;
			fileInfo = void 0;
		}
		const state = fileInfo === void 0 ? "deleted" : "modified";
		if (fileInfo !== void 0 && !fileInfo.isFile()) return {
			relative,
			path: target,
			name,
			state,
			kind: "unreadable",
			beforeBytes: copyInfo.size,
			afterBytes: 0
		};
		const beforeBytes = copyInfo.size;
		const afterBytes = fileInfo === void 0 ? 0 : fileInfo.size;
		if (beforeBytes > MAX_COMPARISON_BYTES || afterBytes > MAX_COMPARISON_BYTES) return {
			relative,
			path: target,
			name,
			state,
			kind: "oversized",
			beforeBytes,
			afterBytes
		};
		const [copyBytes, fileBytes] = await Promise.all([readFile(source), fileInfo === void 0 ? Promise.resolve(void 0) : readFile(target)]);
		const before = decodeText(copyBytes);
		const after = fileBytes === void 0 ? null : decodeText(fileBytes);
		if (before === void 0 || after === void 0) return {
			relative,
			path: target,
			name,
			state,
			kind: "binary",
			beforeBytes,
			afterBytes
		};
		return {
			relative,
			path: target,
			name,
			state,
			kind: "text",
			beforeBytes,
			afterBytes,
			comparison: compareTexts(before, after)
		};
	}
	/**
	* Delete one session's backups.
	*
	* Called when the session is archived, which is what makes the protection
	* lifetime the session's lifetime. A repeated call for the same session does
	* nothing, so an archive path that fires twice cannot race itself.
	* @param session - the session whose backups should go.
	* @returns true when a directory was removed, false when there was nothing left.
	*/
	async archive(session) {
		const key = sessionKeyOf(session);
		this.archived.add(key);
		this.protected_.delete(key);
		this.created.delete(key);
		const directory = join(this.directory, key);
		const present = await pathExists(directory);
		try {
			await rm(directory, {
				recursive: true,
				force: true
			});
		} catch (error) {
			throw new Error(`could not remove backups for session ${JSON.stringify(session)} at ${JSON.stringify(directory)}: ${String(error)}`, { cause: error });
		}
		if (present) console.log(`dsh-worktree: removed the backups of archived session ${session}`);
		return present;
	}
	/**
	* Handle one `tools/pre-execute`: protect what the call names, or refuse a
	* destructive shell command so the model declares its targets first.
	* @param execution - the pending call, with parsed arguments.
	* @param next - the pipeline's delegate; called exactly once on the allow path.
	* @returns the pipeline decision.
	*/
	async beforeTool(execution, next) {
		const agent = execution.agent;
		if (workspaceOf(agent) === void 0) return next();
		const name = execution.name;
		if (name !== void 0 && SHELL_TOOLS.some((tool) => tool === name)) {
			const command = commandOf(execution.arguments);
			if (this.denyDestructiveCommands && command !== void 0 && DESTRUCTIVE_COMMAND.test(stripQuoted(command))) return {
				kind: "deny",
				reason: `"${name}" looks like it deletes files, and a deletion cannot be recovered once it runs. Call ${BACKUP_TOOL_NAME} first with the files or directories this command will touch, then retry it.`
			};
			return next();
		}
		if (name !== "write" && name !== "edit") return next();
		const declared = fileTarget(execution.arguments);
		if (declared === void 0) return next();
		const result = await this.protect(agent, declared);
		if (result.outcome === "protected") console.log(`dsh-worktree: protected ${result.path} before change, kept at ${result.backup}`);
		return next();
	}
	/**
	* Where one file's copy belongs.
	*
	* A file inside the session's working directory keeps its workspace-relative
	* path, so recovery is a plain copy back. A file outside it — another
	* directory, another drive — is placed under `external/` with its own path
	* preserved, which keeps every backup addressable without an index.
	* @param agent - the calling agent.
	* @param declared - the path as declared.
	* @returns the destination, or undefined when there is no session to own it.
	*/
	place(agent, declared) {
		const session = agent?.session?.id;
		if (typeof session !== "string" || session.length === 0) return void 0;
		const sessionKey = sessionKeyOf(session);
		const target = resolveTarget(agent, declared);
		if (target === void 0) return void 0;
		const workspace = workspaceOf(agent);
		if (workspace !== void 0) {
			const inside = relativePathOf(workspace, target);
			if (inside !== void 0) return {
				sessionKey,
				relativePath: inside
			};
		}
		return {
			sessionKey,
			relativePath: `${EXTERNAL_SEGMENT}/${externalPathOf(target)}`
		};
	}
	/** The set of paths one session has already copied. */
	protectedFor(sessionKey) {
		return this.setFor(this.protected_, sessionKey);
	}
	/** The set of paths this run watched appear for one session. */
	createdFor(sessionKey) {
		return this.setFor(this.created, sessionKey);
	}
	/** One session's set inside a keyed map, created on first use. */
	setFor(map, key) {
		let known = map.get(key);
		if (known === void 0) {
			known = /* @__PURE__ */ new Set();
			map.set(key, known);
		}
		return known;
	}
};
/**
* Install file protection on one Host context.
*
* The registration rides the plugin's fiber, so unloading the plugin stops the
* guard without touching anything already copied. The declaration tool and the
* archive cleanup are wired by the plugin entry, which owns the registrations
* that need other services.
* @param ctx - the Host plugin context.
* @param options - where copies are kept and the shell policy.
* @returns the guard, for the other registrations and for the spec suite.
*/
function installFileGuard(ctx, options) {
	const guard = new FileGuard(options);
	ctx.effect(() => ctx.on("tools/pre-execute", (execution, next) => guard.beforeTool(execution, next)), "dsh-worktree: protect files before tools may change them");
	return guard;
}
/**
* The path a declared value names, resolved against the session's directory.
* @param agent - the calling agent, whose session supplies the base directory.
* @param declared - the path as declared.
* @returns the absolute path, or undefined when there is no session.
*/
function resolveTarget(agent, declared) {
	const session = agent?.session?.id;
	if (typeof session !== "string" || session.length === 0) return void 0;
	if (isAbsolute(declared)) return resolve(declared);
	const cwd = workspaceOf(agent);
	if (cwd === void 0) return void 0;
	return resolve(cwd, declared);
}
/**
* The working directory a call protects: the caller session's own.
* @param agent - the agent the payload carries.
* @returns the absolute working directory, or undefined when unknown.
*/
function workspaceOf(agent) {
	const cwd = agent?.session?.header?.cwd;
	if (typeof cwd !== "string" || cwd.length === 0) return void 0;
	return isAbsolute(cwd) ? resolve(cwd) : void 0;
}
/**
* The file a tool call declared, when it declares one.
* @param args - the call's parsed arguments.
* @returns the declared path, or undefined for a tool that names no file.
*/
function fileTarget(args) {
	if (typeof args !== "object" || args === null) return void 0;
	for (const key of FILE_TARGET_ARGUMENTS) {
		const value = args[key];
		if (typeof value === "string" && value.trim().length > 0) return value;
	}
}
/**
* The command text a shell call is about to run.
* @param args - the call's parsed arguments.
* @returns the command string, or undefined for another argument shape.
*/
function commandOf(args) {
	if (typeof args !== "object" || args === null) return void 0;
	for (const key of [
		"command",
		"script",
		"cmd"
	]) {
		const value = args[key];
		if (typeof value === "string" && value.trim().length > 0) return value;
	}
}
/**
* Blank out quoted spans so a quoted word is not read as a command.
*
* `echo "rm -rf /"` writes text; `rm -rf /` deletes. Only the second is refused.
* @param command - the command text.
* @returns the text with single- and double-quoted spans removed.
*/
function stripQuoted(command) {
	return command.replace(/"[^"]*"/g, "\"\"").replace(/'[^']*'/g, "''");
}
/**
* Express one absolute path relative to its workspace.
* @param workspace - absolute workspace root.
* @param target - absolute path.
* @returns the `/`-separated relative path, or undefined when outside.
*/
function relativePathOf(workspace, target) {
	const rel = relative(workspace, target);
	if (rel.length === 0 || rel.startsWith("..") || isAbsolute(rel)) return void 0;
	return rel.split(sep).join("/");
}
/**
* The path a target keeps when it lies outside the session's directory.
*
* A drive-qualified path keeps its drive letter (`c/Users/...`), and a UNC path
* collapses to its share, so two files with the same tail on different volumes
* never collide.
* @param target - absolute path outside the workspace.
* @returns a `/`-separated path below `external/`.
*/
function externalPathOf(target) {
	return resolve(target).replace(/\\/g, "/").replace(/^\/+/, "").replace(/:/g, "");
}
/**
* Every copy below a session directory, as `/`-separated paths relative to it.
*
* The tree is walked rather than indexed: one copy per file means the tree is
* the record, and a directory that was never created is simply an empty list.
* @param directory - the session's directory.
* @param prefix - the path of `directory` below the walk's root, empty at the top.
* @returns the copy paths, in directory order.
*/
async function copiesUnder(directory, prefix = "") {
	const found = [];
	let entries;
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (isMissing(error)) return found;
		throw error;
	}
	for (const entry of entries) {
		const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
		if (entry.isDirectory()) found.push(...await copiesUnder(join(directory, entry.name), path));
		else if (entry.isFile()) found.push(path);
	}
	return found;
}
/**
* The absolute file one copy restores to.
*
* A workspace-relative copy names a file below the session's working directory.
* A copy under `external/` names one outside it, and its absolute path is
* reconstructed from the same rule {@link externalPathOf} wrote — which is why a
* path that rule cannot express exactly is refused instead of guessed: a Windows
* share has no drive letter to restore, and a POSIX path can start with a letter
* that would read as one.
* @param workspace - the absolute working directory.
* @param relative - the copy path below the session directory.
* @returns the absolute target, or undefined when no target can be reconstructed.
*/
function targetOf(workspace, relative) {
	if (relative === EXTERNAL_SEGMENT || relative.startsWith(`${EXTERNAL_SEGMENT}/`)) return externalTargetOf(relative.slice(9));
	return resolve(workspace, relative);
}
/**
* Reverse one path below `external/` back into an absolute path.
*
* Resolved rather than returned as spelled, so a reconstructed Windows path is
* platform-native (`C:/x` becomes `C:\x`) and reads the same as the path the
* copy was taken from.
* @param relative - the `/`-separated path below `external/`.
* @returns the absolute path, or undefined when this platform has no exact inverse.
*/
function externalTargetOf(relative) {
	if (process.platform !== "win32") return resolve(`/${relative}`);
	const [drive, ...rest] = relative.split("/");
	if (drive === void 0 || !/^[A-Za-z]$/u.test(drive)) return void 0;
	return resolve(`${drive.toUpperCase()}:/${rest.join("/")}`);
}
/**
* The path the restore list shows for one copy.
*
* A copy outside the working directory has no workspace-relative form, so the
* absolute path it restores to is its name; showing the internal `external/…`
* spelling instead would name a directory the user never created.
* @param relative - the copy path below the session directory.
* @param target - the absolute path the copy restores to.
* @returns the display path.
*/
function nameOf(relative, target) {
	return relative.startsWith(`${EXTERNAL_SEGMENT}/`) ? target : relative;
}
/**
* Resolve one copy path below its directory, refusing anything that leaves it.
*
* The path arrives from the browser, so it is the one input that could name a
* file outside the session's own tree; a resolution that escapes, or that is
* not a relative path at all, has no copy behind it.
* @param directory - the session's directory.
* @param relative - the copy path as requested.
* @returns the absolute copy path, or undefined when it is not inside `directory`.
*/
function contained(directory, relative) {
	if (relative.length === 0 || isAbsolute(relative)) return void 0;
	const target = resolve(directory, relative);
	return relative_(directory, target) === void 0 ? void 0 : target;
}
/** `path.relative` as a containment test: undefined when the child is not below the parent. */
function relative_(parent, child) {
	const back = relative(parent, child);
	return back.length === 0 || back.startsWith("..") || isAbsolute(back) ? void 0 : back;
}
/**
* How one copy differs from the file it holds.
*
* Compared by content, not by a timestamp: the copy is written when the change
* is about to happen, so a metadata comparison would report every copy as
* changed. A path that is gone is `deleted`; one that is no longer a regular
* file cannot equal the copy either.
* @param copy - absolute path of the copy.
* @param target - absolute path of the file.
* @returns the difference, or undefined when the two hold the same bytes.
*/
async function difference(copy, target) {
	let info;
	try {
		info = await stat(target);
	} catch (error) {
		if (isMissing(error)) return "deleted";
		throw error;
	}
	if (!info.isFile()) return "modified";
	return await sameBytes(copy, target) ? void 0 : "modified";
}
/** Bytes compared per read; large enough to keep syscalls rare, small enough to stay cheap. */
const COMPARE_CHUNK = 65536;
/**
* Bytes one side of a comparison may hold.
*
* Reading is what turns a sidebar click into memory and CPU, so a file above
* this bound is reported with its size instead of being loaded: the copy has no
* size cap, and a single 3 GB file must not be read to fill a pane.
*/
const MAX_COMPARISON_BYTES = 2097152;
/**
* Whether two files hold the same bytes, stopping at the first difference.
* @param left - absolute path of the first file.
* @param right - absolute path of the second file.
* @returns true when every byte matches.
*/
async function sameBytes(left, right) {
	const [first, second] = await Promise.all([open(left, "r"), open(right, "r")]);
	try {
		const leftChunk = Buffer.allocUnsafe(COMPARE_CHUNK);
		const rightChunk = Buffer.allocUnsafe(COMPARE_CHUNK);
		for (;;) {
			const [a, b] = await Promise.all([first.read(leftChunk, 0, COMPARE_CHUNK, null), second.read(rightChunk, 0, COMPARE_CHUNK, null)]);
			if (a.bytesRead !== b.bytesRead) return false;
			if (a.bytesRead === 0) return true;
			if (!leftChunk.subarray(0, a.bytesRead).equals(rightChunk.subarray(0, b.bytesRead))) return false;
		}
	} finally {
		await Promise.all([first.close(), second.close()]);
	}
}
/**
* Decode one side of a comparison as UTF-8 text.
*
* A NUL byte is what other diff tools also use as the text/binary boundary, and
* a byte sequence that is not valid UTF-8 (UTF-16, a legacy code page, a zip
* container) is not text this view could render faithfully. Neither is an
* error: the caller reports the side as binary and leaves the restore intact.
* @param bytes - the side's bytes.
* @returns the text, or undefined when the bytes are not UTF-8 text.
*/
function decodeText(bytes) {
	if (bytes.includes(0)) return void 0;
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return;
	}
}
/**
* Directory name for one session id.
*
* Hashed rather than used verbatim: a session id is opaque and may contain
* characters a directory name cannot, and the mapping is one-way on purpose —
* the backup directory is browsed by its file tree, not by session id.
* @param session - the session id.
* @returns a 32-character hexadecimal key.
*/
function sessionKeyOf(session) {
	return createHash("sha256").update(session).digest("hex").slice(0, 32);
}
/** Whether a failure means the path simply is not there. */
function isMissing(error) {
	const code = error?.code;
	return code === "ENOENT" || code === "ENOTDIR";
}
/**
* Whether one path exists, file or directory.
* @param path - the absolute path to look for.
* @returns true when it is there.
*/
async function pathExists(path) {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (isMissing(error)) return false;
		throw error;
	}
}
//#endregion
//#region src/backup-tool.ts
/**
* The model-facing declaration tool: `worktree_backup`.
*
* It exists for the changes no argument names — a command the model is about to
* run, a script's side effects, a rename, and anything outside the working
* directory, including other drives. The model declares what it is about to
* touch, and the guard copies those files aside.
*
* Every copy's absolute path is part of the answer. The copy is only useful to
* a caller that can name it, and the caller here is a later turn — often a
* different model run — that has no other way to learn where the bytes went:
* the result is the only record it reads.
*
* This lives apart from the guard itself on purpose. Defining a tool requires
* `defineTool`, which carries a runtime dependency on the tool registry and, in
* turn, on the services the registry resolves at import time. The guard needs no
* such dependency to copy a file, so keeping the definition in its own module is
* what lets the guard be exercised without a composed Host.
*
* @module @guowenzhang/dsh-worktree/backup-tool
*/
/**
* The model-facing account of one call.
*
* Every group is stated even when empty, so a missing group can never be read as
* "everything was protected" — the failure mode in which an incomplete backup
* looks complete. The copies come last and carry their absolute paths: a result
* that says a file was protected without saying where the copy is leaves the
* caller unable to use it.
* @param outcomes - the per-group paths from one call.
* @returns one sentence per group, in a fixed order.
*/
function describeBackup(outcomes) {
	const parts = [`protected ${outcomes.protected.length} file(s) before change`];
	if (outcomes.alreadyProtected.length > 0) parts.push(`${outcomes.alreadyProtected.length} were already protected this session`);
	if (outcomes.absent.length > 0) parts.push(`${outcomes.absent.length} do not exist (nothing to protect): ${outcomes.absent.join(", ")}`);
	if (outcomes.notAFile.length > 0) parts.push(`${outcomes.notAFile.length} are not regular files and were NOT protected: ${outcomes.notAFile.join(", ")}`);
	if (outcomes.copies.length > 0) {
		const pairs = outcomes.copies.map((copy) => `${copy.path} (backup: ${copy.backup})`).join("; ");
		parts.push(`restore by copying each backup back over its file: ${pairs}`);
	}
	return parts.join("; ");
}
/**
* Build the registry-ready declaration tool.
* @param guard - the guard that performs the copies.
* @returns the tool definition for `ctx.tools.register`.
*/
function defineBackupTool(guard) {
	return defineTool({
		name: BACKUP_TOOL_NAME,
		description: "Copy files aside before changing or deleting them, so the change can be undone. Call this before writing any file, and before running any command that rewrites or deletes files the current task did not create. It works for any path, including files outside the working directory. Files that already exist are copied; a file created later needs no copy, and a file already copied this session is not copied twice. Every copy is reported by its absolute path: restore a file by copying that backup back over it, and declaring an already-copied file again reports the address of the first copy.",
		parameters: { file_paths: {
			type: "array",
			items: { type: "string" },
			required: true,
			description: "Files to protect, absolute or relative to the working directory. Provide `file_paths` before any other argument."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					protected: {
						type: "array",
						items: { type: "string" },
						required: true,
						description: "Copied out of the working set by this call."
					},
					alreadyProtected: {
						type: "array",
						items: { type: "string" },
						required: true,
						description: "Already copied earlier in this session."
					},
					absent: {
						type: "array",
						items: { type: "string" },
						required: true,
						description: "Do not exist, so there is no prior state to keep."
					},
					notAFile: {
						type: "array",
						items: { type: "string" },
						required: true,
						description: "Not regular files and therefore not protected."
					},
					copies: {
						type: "array",
						required: true,
						description: "Every declared file that has a copy on disk, with the path to restore from.",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								path: {
									type: "string",
									required: true,
									description: "The file as declared."
								},
								backup: {
									type: "string",
									required: true,
									description: "Absolute path of the copy; copy it back over `path` to restore that file."
								}
							}
						}
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: describeBackup(value)
			}]
		},
		async execute(args, exec) {
			const results = await guard.protectAll(exec.agent, args.file_paths);
			return {
				protected: results.filter((result) => result.outcome === "protected").map((result) => result.path),
				alreadyProtected: results.filter((result) => result.outcome === "already-protected").map((result) => result.path),
				absent: results.filter((result) => result.outcome === "absent").map((result) => result.path),
				notAFile: results.filter((result) => result.outcome === "not-a-file").map((result) => result.path),
				copies: results.flatMap((result) => result.backup === void 0 ? [] : [{
					path: result.path,
					backup: result.backup
				}])
			};
		}
	});
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
//#region src/session-tree.ts
/**
* Resolve the page's session and its delegated descendants.
*
* The descendants are resolved only after the root's directory is known: a
* session with no directory has no list to extend, and the caller reports that
* as the page's own outcome.
* @param ctx - the scope the route handler runs in.
* @param sessionId - the session the page was opened for.
* @returns the root when its directory resolves, and the children that also resolve one.
*/
async function resolveSessionTree(ctx, sessionId) {
	const cwd = await resolveSessionCwd(ctx, sessionId);
	if (cwd === void 0) return {
		root: void 0,
		descendants: []
	};
	return {
		root: {
			sessionId,
			cwd,
			depth: 0
		},
		descendants: await resolveDescendants(ctx, sessionId)
	};
}
/**
* The working directory one session runs in.
*
* Read from the Host's stores, never from the request: a copy's relative path is
* only meaningful against the directory the session actually had, and a
* caller-supplied one could point a restore at another file with the same tail.
* The live store answers for a session this process currently holds; the durable
* store answers for every session it stored, including a stopped teammate.
* @param ctx - the scope the route handler runs in.
* @param sessionId - the session whose directory is needed.
* @returns the absolute working directory, or undefined when no store knows it.
*/
async function resolveSessionCwd(ctx, sessionId) {
	const live = directoryOf(ctx.get("sessions")?.get(SessionId(sessionId))?.header.cwd);
	if (live !== void 0) return live;
	const persistence = ctx.get("sessionPersistence");
	if (persistence === void 0) return void 0;
	try {
		return directoryOf((await persistence.stat(SessionId(sessionId)))?.header.cwd);
	} catch (error) {
		ctx.logger?.warn?.(`dsh-worktree: could not read the stored header of session ${JSON.stringify(sessionId)}; its working directory is unknown (${reasonOf(error)})`);
		return;
	}
}
/**
* Resolve the delegated sessions below one session, with their directories.
*
* The catalog traversal is durable, so a teammate that has stopped is still
* named here. Rows whose directory cannot be resolved are skipped: a copy under
* an unknown directory can be neither compared nor restored, and listing it
* would offer an action the Host cannot carry out.
* @param ctx - the scope the route handler runs in.
* @param sessionId - the session whose delegated children are wanted.
* @returns the resolved children and their descendants, in catalog pre-order.
*/
async function resolveDescendants(ctx, sessionId) {
	const subagents = ctx.get("subagents");
	if (subagents === void 0) return [];
	let rows;
	try {
		rows = await subagents.listDescendants(SessionId(sessionId));
	} catch (error) {
		ctx.logger?.warn?.(`dsh-worktree: could not list the delegated sessions of ${JSON.stringify(sessionId)}; the change history lists this session alone (${reasonOf(error)})`);
		return [];
	}
	const owners = [];
	for (const row of rows) {
		if (row.kind !== "child") continue;
		const cwd = await resolveSessionCwd(ctx, row.id);
		if (cwd === void 0) continue;
		owners.push({
			sessionId: row.id,
			cwd,
			depth: row.depth,
			...row.label === void 0 ? {} : { label: row.label }
		});
	}
	return owners;
}
/**
* Normalize one stored directory, refusing a relative one.
*
* A session header's `cwd` is absolute by construction; a value that is not is
* a record this page cannot resolve against, and resolving it would silently
* anchor restores to the Host process's directory instead.
* @param cwd - the stored directory, when the store had one.
* @returns the platform-normalized absolute directory, or undefined.
*/
function directoryOf(cwd) {
	if (typeof cwd !== "string" || cwd.length === 0) return void 0;
	return isAbsolute(cwd) ? resolve(cwd) : void 0;
}
/**
* One failure's text, for a log line.
* @param error - whatever was thrown.
* @returns the message, or the stringified value.
*/
function reasonOf(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
//#region src/route.ts
/** A refusal that carries the HTTP status the route answers with. */
var RouteError$1 = class extends Error {
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
async function readJsonBody$1(req) {
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
	const text = Buffer.concat(chunks).toString("utf8").trim();
	if (text === "") return {};
	try {
		const parsed = JSON.parse(text);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new RouteError$1(400, "request body must be a JSON object");
		return parsed;
	} catch (error) {
		if (error instanceof RouteError$1) throw error;
		throw new RouteError$1(400, "request body is not valid JSON");
	}
}
/**
* Write a JSON response.
* @param res - the response to write.
* @param status - HTTP status.
* @param body - JSON-serializable body.
*/
function writeJson$1(res, status, body) {
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
function requireString$1(value, field) {
	if (typeof value !== "string" || value.length === 0) throw new RouteError$1(400, `${field} must be a non-empty string`);
	return value;
}
/** Parse optional top-level names selected for an initial commit. */
function selectedEntries(value) {
	if (value === void 0) return void 0;
	if (!Array.isArray(value) || !value.every((name) => typeof name === "string" && name.length > 0)) throw new RouteError$1(400, "selectedEntries must be an array of top-level names");
	return value;
}
/**
* The working directory one session runs in.
*
* Read from the Host's stores, never from the request: a backup's relative path
* is only meaningful against the directory the session actually had, and a
* caller-supplied one could point a restore at another file with the same tail.
* The live session store answers first, and the durable store answers for a
* session that is not live — a stopped teammate, or a child read back from
* history after the app was reopened. A session neither store records has no
* directory to restore into, and says so instead of guessing.
* @param ctx - the scope the route handler runs in.
* @param sessionId - the session named by the request.
* @returns the absolute working directory.
* @throws {RouteError} when no Host store knows the session's directory.
*/
async function sessionWorkspace(ctx, sessionId) {
	const cwd = await resolveSessionCwd(ctx, sessionId);
	if (cwd === void 0) throw new RouteError$1(404, `session ${JSON.stringify(sessionId)} is not known to this host, so its working directory is unknown`);
	return cwd;
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
*
* The backup methods read three more services with `ctx.get`: the live session
* store, the durable session store that answers for a session this process no
* longer holds, and the subagent catalog that names the delegated children. All
* three are optional — a deployment without one keeps every method that does not
* need it working, and the backup page degrades to what it can still address
* (the session alone, or an empty list) instead of failing to mount.
* @param ctx - the Host plugin context.
* @param service - the worktree capability.
* @param guard - the file guard whose copies the backup methods read and restore.
*/
function registerRoute(ctx, service, guard) {
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
					if (req.method !== "POST") throw new RouteError$1(405, "method not allowed");
					const method = new URL(req.url ?? "/", "http://dsh.internal").pathname.slice(14);
					const body = await readJsonBody$1(req);
					if (method === "check") {
						stage = "git";
						writeJson$1(res, 200, { version: (await runGit(process.cwd(), ["--version"])).trim() });
						return;
					}
					if (method === "start") {
						writeJson$1(res, 200, await start(scope, service, body, (next) => {
							stage = next;
						}));
						return;
					}
					if (method === "list") {
						stage = "list";
						writeJson$1(res, 200, { worktrees: await service.list(requireString$1(body.cwd, "cwd")) });
						return;
					}
					if (method === "init-files") {
						stage = "init-files";
						const workspaceId = requireString$1(body.workspaceId, "workspaceId");
						const workspace = scope.workspaceRegistry.get(WorkspaceId(workspaceId));
						if (workspace === void 0) throw new RouteError$1(404, "workspace not found");
						writeJson$1(res, 200, { entries: await service.initialCommitEntries(workspace.path) });
						return;
					}
					if (method === "init") {
						stage = "init";
						const workspaceId = requireString$1(body.workspaceId, "workspaceId");
						const workspace = scope.workspaceRegistry.get(WorkspaceId(workspaceId));
						if (workspace === void 0) throw new RouteError$1(404, "workspace not found");
						if (await isGitWorkTree(workspace.path)) throw new RouteError$1(409, "workspace is already a Git repository");
						await service.initialize(workspace.path, selectedEntries(body.selectedEntries));
						writeJson$1(res, 200, {
							initialized: true,
							path: workspace.path
						});
						return;
					}
					if (method === "branches") {
						stage = "branches";
						writeJson$1(res, 200, { branches: await service.listBranches(requireString$1(body.cwd, "cwd")) });
						return;
					}
					if (method === "checkout") {
						stage = "checkout";
						writeJson$1(res, 200, probeArchiveOutcome(requireString$1(body.path, "path")));
						return;
					}
					if (method === "backups") {
						stage = "backups";
						const sessionId = requireString$1(body.sessionId, "sessionId");
						const tree = await resolveSessionTree(scope, sessionId);
						if (tree.root === void 0) {
							if (!await guard.hasCopies(sessionId)) {
								writeJson$1(res, 200, { entries: [] });
								return;
							}
							throw new RouteError$1(404, `session ${JSON.stringify(sessionId)} is not known to this host, so its working directory is unknown; the copies it still holds can be neither compared nor restored without one`);
						}
						const entries = [];
						for (const owner of [tree.root, ...tree.descendants]) for (const entry of await guard.list(owner.sessionId, owner.cwd)) entries.push({
							...entry,
							sessionId: owner.sessionId,
							depth: owner.depth,
							...owner.label === void 0 ? {} : { sessionLabel: owner.label }
						});
						writeJson$1(res, 200, { entries });
						return;
					}
					if (method === "restore") {
						stage = "restore";
						const sessionId = requireString$1(body.sessionId, "sessionId");
						const relative = requireString$1(body.relative, "relative");
						writeJson$1(res, 200, await guard.restore(sessionId, await sessionWorkspace(scope, sessionId), relative));
						return;
					}
					if (method === "compare") {
						stage = "compare";
						const sessionId = requireString$1(body.sessionId, "sessionId");
						const relative = requireString$1(body.relative, "relative");
						writeJson$1(res, 200, await guard.compare(sessionId, await sessionWorkspace(scope, sessionId), relative));
						return;
					}
					throw new RouteError$1(404, `unknown worktree API method ${JSON.stringify(method)}`);
				} catch (error) {
					const status = error instanceof RouteError$1 ? error.status : error instanceof InvalidInitialSelectionError ? 409 : error instanceof NoSuchBackupError ? 404 : 500;
					const detail = error instanceof Error ? error.message : String(error);
					const message = `[${stage}] ${detail}`;
					scope.logger?.error?.(`dsh-worktree: ${message}`);
					const code = error instanceof GitCommandError ? error.code : void 0;
					writeJson$1(res, status, { error: {
						message,
						stage,
						...code ? { code } : {}
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
	const cwd = requireString$1(body.cwd, "cwd");
	const branch = body.branch === void 0 ? void 0 : requireString$1(body.branch, "branch");
	const base = body.base === void 0 ? void 0 : requireString$1(body.base, "base");
	const path = body.path === void 0 ? void 0 : requireString$1(body.path, "path");
	const agentPreset = body.agentPreset === void 0 ? void 0 : requireString$1(body.agentPreset, "agentPreset");
	onStage("worktree");
	const created = await service.create({
		cwd,
		...branch === void 0 ? {} : { branch },
		...base === void 0 ? {} : { base },
		...path === void 0 ? {} : { path }
	});
	for (const skipped of created.nestedSkipped) ctx.logger?.warn?.(`dsh-worktree: left out nested repository ${JSON.stringify(skipped.repositoryRoot)} in ${JSON.stringify(created.path)} (${skipped.code}): ${skipped.reason}`);
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
		throw new RouteError$1(500, `session ${JSON.stringify(sessionId)} was started in ${JSON.stringify(created.path)} but could not attach to workspace ${JSON.stringify(workspaceId)}: ${reason}`);
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
//#region src/git-accounts/http.ts
/**
* The HTTP edge of the Git-accounts capability.
*
* Every provider request goes through {@link fetchProviderJson}, the single
* place the plugin talks to a Git host. A host answers with JSON, and the
* handful of ways that can fail are classified here once, so the Host service
* above maps one error type instead of each provider's own error dialect.
*
* Error messages name the endpoint but never its query string: Gitee carries
* the access token as a URL parameter, so a message that echoed the full URL
* would put the credential into a route response or a log line.
* @module @guowenzhang/dsh-worktree/git-accounts/http
*/
/** Largest provider response this plugin reads, in bytes. */
const MAX_RESPONSE_BYTES = 4194304;
/** Longest a provider request may take before it fails as a network error, in milliseconds. */
const REQUEST_TIMEOUT_MS = 5e3;
/**
* A failed provider request.
*
* The message is operator-facing and safe to forward: it carries the sanitized
* endpoint and the provider's own error text, never the request's query string
* or headers.
*/
var GitProviderHttpError = class extends Error {
	code;
	status;
	/**
	* @param code - the failure class.
	* @param message - operator-facing text that never contains a token.
	* @param status - the HTTP status when a response was received.
	*/
	constructor(code, message, status) {
		super(message);
		this.code = code;
		this.status = status;
		this.name = "GitProviderHttpError";
	}
};
/**
* Return a URL with its query string, fragment, and credentials removed.
*
* Failure messages use this form so a Gitee token living in the query string
* cannot travel with the message. The path is kept because it names which API
* call failed.
* @param url - the request URL to sanitize.
* @returns `origin` plus path, never a query or fragment.
*/
function sanitizeRequestUrl(url) {
	try {
		const parsed = new URL(url);
		return `${parsed.origin}${parsed.pathname}`;
	} catch (error) {
		return (url.split(/[?#]/, 1)[0] ?? "").replace(/\/\/[^/]*@/, "//");
	}
}
/**
* Send one provider request and decode its JSON response.
*
* The request is a plain GET with the catalog's headers and a 5 second
* timeout; a response body larger than 4 MiB is refused rather than buffered so
* one misbehaving endpoint cannot exhaust the Host's memory.
* @param request - the URL and headers to send.
* @returns the parsed body and the response headers.
* @throws {GitProviderHttpError} when the host refuses, the response is not
* JSON, the size limit is exceeded, or the request cannot complete.
*/
async function fetchProviderJson(request) {
	const endpoint = sanitizeRequestUrl(request.url);
	let response;
	try {
		response = await fetch(request.url, {
			method: "GET",
			headers: request.headers,
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});
	} catch (error) {
		throw networkError(endpoint, error);
	}
	let text;
	try {
		text = await readResponseText(response, endpoint);
	} catch (error) {
		if (error instanceof GitProviderHttpError) throw error;
		throw networkError(endpoint, error);
	}
	if (!response.ok) throw responseError(response, text, endpoint);
	return {
		body: parseJsonBody(text, endpoint),
		headers: response.headers
	};
}
/**
* Classify a non-2xx response from its status and headers.
* @param response - the received response.
* @param text - the already-read response body.
* @param endpoint - the sanitized endpoint for the message.
* @returns the error to throw.
*/
function responseError(response, text, endpoint) {
	const detail = providerMessage(text) ?? response.statusText.trim();
	const summary = `Git provider refused ${endpoint} with HTTP ${response.status}`;
	return new GitProviderHttpError(failureCode(response.status, response.headers), detail === "" ? `${summary}.` : `${summary}: ${detail}`, response.status);
}
/**
* Map an HTTP status to the failure class the Host reports.
* @param status - the HTTP status code.
* @param headers - response headers, whose rate-limit counter distinguishes an
* exhausted 403 from a plain permission refusal.
* @returns the failure class.
*/
function failureCode(status, headers) {
	if (status === 401) return "unauthorized";
	if (status === 404) return "not_found";
	if (status === 403) return headers.get("x-ratelimit-remaining")?.trim() === "0" ? "rate_limited" : "forbidden";
	if (status === 429) return "rate_limited";
	return "bad_response";
}
/**
* Extract the provider's own explanation from an error body.
* @param text - the response body.
* @returns the message, error, or error description; `undefined` when absent.
*/
function providerMessage(text) {
	let body;
	try {
		body = JSON.parse(text);
	} catch (error) {
		return;
	}
	if (typeof body !== "object" || body === null || Array.isArray(body)) return void 0;
	const record = body;
	for (const key of [
		"message",
		"error",
		"error_description"
	]) {
		const value = record[key];
		if (typeof value === "string" && value.trim() !== "") return value.trim();
		if (key === "error" && typeof value === "object" && value !== null) {
			const nested = value.message;
			if (typeof nested === "string" && nested.trim() !== "") return nested.trim();
		}
	}
}
/**
* Parse a successful response body as JSON.
* @param text - the response body.
* @param endpoint - the sanitized endpoint for the message.
* @returns the parsed JSON value.
* @throws {GitProviderHttpError} with code `bad_response` when the body is not JSON.
*/
function parseJsonBody(text, endpoint) {
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new GitProviderHttpError("bad_response", `Git provider answered ${endpoint} with something other than JSON.`);
	}
}
/**
* Read a response body, refusing one larger than {@link MAX_RESPONSE_BYTES}.
*
* The declared content length is checked first so an oversized body is never
* read at all; the byte count is checked while streaming so a response that
* lies about (or omits) its length is still bounded.
* @param response - the response to read.
* @param endpoint - the sanitized endpoint for the message.
* @returns the decoded body text.
* @throws {GitProviderHttpError} with code `bad_response` when the body is too large.
*/
async function readResponseText(response, endpoint) {
	const declared = response.headers.get("content-length");
	const declaredBytes = declared === null ? NaN : Number(declared);
	if (Number.isFinite(declaredBytes) && declaredBytes > MAX_RESPONSE_BYTES) throw tooLarge(endpoint);
	if (response.body === null) return "";
	const reader = response.body.getReader();
	const chunks = [];
	let total = 0;
	try {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			total += chunk.value.byteLength;
			if (total > MAX_RESPONSE_BYTES) {
				await cancelReader(reader);
				throw tooLarge(endpoint);
			}
			chunks.push(chunk.value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
}
/**
* Cancel a response stream whose body will not be read to the end.
* @param reader - the stream reader to cancel.
*/
async function cancelReader(reader) {
	try {
		await reader.cancel();
	} catch (error) {}
}
/**
* Build the response-too-large error.
* @param endpoint - the sanitized endpoint for the message.
* @returns the error to throw.
*/
function tooLarge(endpoint) {
	return new GitProviderHttpError("bad_response", `The response from ${endpoint} is larger than 4 MiB, which this plugin does not read.`);
}
/**
* Build the request-failure error for a transport problem or a timeout.
*
* The underlying error's own message is deliberately not forwarded: it can
* include the request URL with its query string.
* @param endpoint - the sanitized endpoint for the message.
* @param error - whatever the fetch call or body read rejected with.
* @returns the error to throw.
*/
function networkError(endpoint, error) {
	const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
	return new GitProviderHttpError("network", `Could not reach ${endpoint}: ${name === "TimeoutError" ? "the request timed out after 5 seconds" : name === "AbortError" ? "the request was aborted" : "the host could not be reached"}.`);
}
//#endregion
//#region src/git-accounts/identity.ts
/**
* The operator's global Git identity: `user.name` and `user.email`.
*
* Both keys live in Git's global configuration, which is what a commit made in
* any checkout on this machine reads. The page shows what is there and writes
* only what the operator submits: an empty field clears that key instead of
* storing an empty value, because Git's own lookup treats a missing key and a
* blank one differently (`git config --unset` is the write that means "no
* identity").
*
* A failure has three shapes, and the page needs all three: Git missing (the
* operator can install it), Git unable to read the global file (a broken config
* or a permissions problem), and an invalid submission (the form's own rule).
* Only the first two describe the machine; the third never reaches Git.
*
* Tests never touch the operator's real global file: every call accepts an
* environment whose `GIT_CONFIG_GLOBAL` points at a scratch file.
* @module @guowenzhang/dsh-worktree/git-accounts/identity
*/
/** Longest display name accepted; Git itself has no bound, so this is a form bound. */
const NAME_MAX_LENGTH = 200;
/** Longest email accepted; RFC 5321's maximum mailbox length. */
const EMAIL_MAX_LENGTH = 320;
/** A control character never belongs in either identity field, and would corrupt a config line. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
/** Loose email rule: one `@`, a dot in the domain. Git validates nothing beyond the line format. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
/** Git's exit status for `config --unset` on a key that is not set. */
const UNSET_MISSING_CODE = 5;
/**
* One identity failure with a machine code the page or route can explain.
*
* `invalid_input` is the form's own refusal; `git_missing` and `git_failed` are
* the machine's. A route maps the first to a client error and the others to a
* Host-side failure.
*/
var GitIdentityError = class extends Error {
	code;
	/**
	* @param code - the failure class.
	* @param message - actionable text; for a Git failure it carries Git's own diagnostic.
	*/
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "GitIdentityError";
	}
};
/**
* Read the global identity.
*
* An unset key reads as an empty string: first run is not a failure. Git being
* absent or unable to read its global file is: the page shows which, and
* disables the form.
* @param cwd - existing directory the Git process runs in.
* @param environment - extra environment entries for the Git calls.
* @returns both keys and whether the read worked.
*/
async function readGitIdentity(cwd, environment) {
	try {
		return {
			name: await readKey(cwd, "user.name", environment),
			email: await readKey(cwd, "user.email", environment),
			available: true
		};
	} catch (error) {
		if (error instanceof GitCommandError && error.code === "git_not_found") return {
			name: "",
			email: "",
			available: false,
			error: "git_missing"
		};
		return {
			name: "",
			email: "",
			available: false,
			error: "git_failed"
		};
	}
}
/**
* Write the global identity and read it back.
*
* Both fields are validated before either is written, so a rejected email never
* leaves a name committed on its own. An empty field removes that key; removing
* a key that is already absent is success, matching the operator's intent.
* @param cwd - existing directory the Git process runs in.
* @param input - the submitted name and email; empty clears that key.
* @param environment - extra environment entries for the Git calls.
* @returns the identity as Git now reports it.
* @throws {GitIdentityError} when a field is invalid or Git cannot write the configuration.
*/
async function writeGitIdentity(cwd, input, environment) {
	const name = validateName(input.name);
	const email = validateEmail(input.email);
	for (const [key, value] of [["user.name", name], ["user.email", email]]) if (value === "") await unsetKey(cwd, key, environment);
	else await setKey(cwd, key, value, environment);
	const identity = await readGitIdentity(cwd, environment);
	if (!identity.available) throw new GitIdentityError("git_failed", "the Git configuration could not be read back after writing it");
	return identity;
}
/**
* Validate a submitted display name.
* @param value - the form's value.
* @returns the trimmed name, or an empty string meaning "clear the key".
* @throws {GitIdentityError} when the name is too long or carries a control character.
*/
function validateName(value) {
	const name = value.trim();
	if (name.length > NAME_MAX_LENGTH) throw new GitIdentityError("invalid_input", `user.name must be at most ${NAME_MAX_LENGTH} characters`);
	if (CONTROL_CHARACTERS.test(name)) throw new GitIdentityError("invalid_input", "user.name must not contain control characters");
	return name;
}
/**
* Validate a submitted email.
* @param value - the form's value.
* @returns the trimmed email, or an empty string meaning "clear the key".
* @throws {GitIdentityError} when the email is too long or not an email address.
*/
function validateEmail(value) {
	const email = value.trim();
	if (email === "") return email;
	if (email.length > EMAIL_MAX_LENGTH) throw new GitIdentityError("invalid_input", `user.email must be at most ${EMAIL_MAX_LENGTH} characters`);
	if (CONTROL_CHARACTERS.test(email)) throw new GitIdentityError("invalid_input", "user.email must not contain control characters");
	if (!EMAIL_PATTERN.test(email)) throw new GitIdentityError("invalid_input", "user.email must look like name@example.com");
	return email;
}
/**
* Read one global key.
* @param cwd - directory the Git process runs in.
* @param key - the configuration key.
* @param environment - extra environment entries.
* @returns the trimmed value, or an empty string when unset.
* @throws {GitCommandError} when Git is missing or cannot read the configuration.
*/
async function readKey(cwd, key, environment) {
	const result = await runGitWithExit(cwd, [
		"config",
		"--global",
		"--get",
		key
	], environment);
	if (result.code === 0) return result.stdout.trim();
	if (result.code === 1) return "";
	throw new GitCommandError([
		"config",
		"--global",
		"--get",
		key
	], cwd, result.stderr.trim() || `git config exited ${result.code}`);
}
/**
* Set one global key.
* @param cwd - directory the Git process runs in.
* @param key - the configuration key.
* @param value - the non-empty value.
* @param environment - extra environment entries.
* @throws {GitIdentityError} when Git refuses the write.
*/
async function setKey(cwd, key, value, environment) {
	const result = await runGitWithExit(cwd, [
		"config",
		"--global",
		key,
		value
	], environment);
	if (result.code === 0) return;
	throw new GitIdentityError("git_failed", `git could not write ${key}: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`}`);
}
/**
* Remove one global key, treating "already absent" as done.
* @param cwd - directory the Git process runs in.
* @param key - the configuration key.
* @param environment - extra environment entries.
* @throws {GitIdentityError} when Git refuses the removal.
*/
async function unsetKey(cwd, key, environment) {
	const result = await runGitWithExit(cwd, [
		"config",
		"--global",
		"--unset",
		key
	], environment);
	if (result.code === 0 || result.code === UNSET_MISSING_CODE) return;
	throw new GitIdentityError("git_failed", `git could not clear ${key}: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`}`);
}
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
/** Where one stored account's credential came from. */
const ACCOUNT_ORIGINS = [
	"manual",
	"credential-manager",
	"git-credentials",
	"gh-cli",
	"environment",
	"ssh-key"
];
/** How an account proves itself to its host. */
const GIT_AUTH_METHODS = ["token", "ssh"];
/** The source families a scan reads. */
const SCAN_SOURCES = [
	"credential-manager",
	"git-credentials",
	"gh-cli",
	"environment",
	"ssh"
];
//#endregion
//#region src/git-accounts/providers.ts
/**
* The Git provider catalog.
*
* One entry per supported host family: where its API lives, how a token
* travels, and how its JSON becomes the account and project facts the page
* renders. The Host service drives every provider through this one interface,
* so account storage, routes, and the page never learn a provider's dialect.
*
* The parsers validate what the page needs and tolerate what a host may omit. A
* missing login or project path fails with a message naming the provider and
* field; a missing display name, description, or SSH URL is simply absent from
* the result.
* @module @guowenzhang/dsh-worktree/git-accounts/providers
*/
/** How many projects one page of a provider list asks for. */
const PAGE_SIZE = 100;
/** A provider response that does not carry the facts the catalog expects. */
var ProviderDataError = class extends Error {
	/**
	* @param message - what was missing or malformed, naming the provider and field.
	*/
	constructor(message) {
		super(message);
		this.name = "ProviderDataError";
	}
};
/**
* Return the catalog entry for one host family.
* @param provider - the host family.
* @returns its spec.
* @throws {ProviderDataError} when the value is not a supported provider.
*/
function providerSpec(provider) {
	switch (provider) {
		case "github": return GITHUB;
		case "gitlab": return GITLAB;
		case "gitee": return GITEE;
		default: throw new ProviderDataError(`Unknown Git provider: ${String(provider)}.`);
	}
}
/**
* Name the host family a host belongs to.
*
* The public hosts answer exactly; any other host falls back to a name hint, so
* a self-hosted `gitlab.arcuchi.com` or `github.corp.example` is recognized
* without configuration.
* @param host - host name, or a value such as a URL.
* @returns the host family, or `undefined` when the host matches none.
*/
function knownProviderForHost(host) {
	let candidate = typeof host === "string" ? host.trim().toLowerCase() : "";
	try {
		candidate = normalizeHostValue(host);
	} catch (error) {}
	if (candidate === "github.com") return "github";
	if (candidate === "gitlab.com") return "gitlab";
	if (candidate === "gitee.com") return "gitee";
	if (candidate.includes("gitlab")) return "gitlab";
	if (candidate.includes("gitee")) return "gitee";
	if (candidate.includes("github")) return "github";
}
/** GitHub's REST API. */
const GITHUB = {
	id: "github",
	defaultHost: DEFAULT_PROVIDER_HOSTS.github,
	normalizeHost: normalizeHostValue,
	userRequest(host, token) {
		return {
			url: `${githubApiBase(host)}/user`,
			headers: githubHeaders(token)
		};
	},
	parseProfile(body, headers) {
		const record = jsonObject(body, "GitHub profile");
		const login = requiredString(record, "login", "GitHub profile");
		const name = optionalString(record, "name");
		const email = optionalString(record, "email");
		const profileUrl = optionalString(record, "html_url");
		const scopes = optionalHeader(headers, "x-oauth-scopes");
		return {
			login,
			...name === void 0 ? {} : { name },
			...email === void 0 ? {} : { email },
			...profileUrl === void 0 ? {} : { profileUrl },
			...scopes === void 0 ? {} : { scopes }
		};
	},
	projectsRequest(host, token, page) {
		return {
			url: `${githubApiBase(host)}/user/repos?per_page=${PAGE_SIZE}&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
			headers: githubHeaders(token)
		};
	},
	parseProjects(body, headers) {
		const rows = jsonArray(body, "GitHub projects");
		return {
			projects: rows.map((row, index) => parseGithubProject(row, index)),
			hasMore: linkHasNextPage(headers.get("link")) || rows.length === PAGE_SIZE
		};
	}
};
/** GitLab's REST API, on the public host or a self-hosted instance. */
const GITLAB = {
	id: "gitlab",
	defaultHost: DEFAULT_PROVIDER_HOSTS.gitlab,
	normalizeHost: normalizeHostValue,
	userRequest(host, token) {
		return {
			url: `${gitlabApiBase(host)}/user`,
			headers: { "PRIVATE-TOKEN": token }
		};
	},
	parseProfile(body) {
		const record = jsonObject(body, "GitLab profile");
		const login = requiredString(record, "username", "GitLab profile");
		const name = optionalString(record, "name");
		const email = optionalString(record, "email");
		const profileUrl = optionalString(record, "web_url");
		return {
			login,
			...name === void 0 ? {} : { name },
			...email === void 0 ? {} : { email },
			...profileUrl === void 0 ? {} : { profileUrl }
		};
	},
	projectsRequest(host, token, page) {
		return {
			url: `${gitlabApiBase(host)}/projects?membership=true&simple=true&per_page=${PAGE_SIZE}&page=${page}&order_by=last_activity_at&sort=desc`,
			headers: { "PRIVATE-TOKEN": token }
		};
	},
	parseProjects(body, headers) {
		const rows = jsonArray(body, "GitLab projects");
		const projects = rows.map((row, index) => parseGitlabProject(row, index));
		const nextPage = headers.get("x-next-page");
		return {
			projects,
			hasMore: nextPage !== null && nextPage.trim() !== "" || rows.length === PAGE_SIZE
		};
	}
};
/** Gitee's REST API, which takes the token as a query parameter. */
const GITEE = {
	id: "gitee",
	defaultHost: DEFAULT_PROVIDER_HOSTS.gitee,
	normalizeHost: normalizeHostValue,
	userRequest(host, token) {
		return {
			url: `${giteeApiBase(host)}/user?access_token=${encodeURIComponent(token)}`,
			headers: {}
		};
	},
	parseProfile(body) {
		const record = jsonObject(body, "Gitee profile");
		const login = requiredString(record, "login", "Gitee profile");
		const name = optionalString(record, "name");
		const email = optionalString(record, "email");
		const profileUrl = optionalString(record, "html_url");
		return {
			login,
			...name === void 0 ? {} : { name },
			...email === void 0 ? {} : { email },
			...profileUrl === void 0 ? {} : { profileUrl }
		};
	},
	projectsRequest(host, token, page) {
		return {
			url: `${giteeApiBase(host)}/user/repos?access_token=${encodeURIComponent(token)}&per_page=${PAGE_SIZE}&page=${page}&sort=updated`,
			headers: {}
		};
	},
	parseProjects(body) {
		const rows = jsonArray(body, "Gitee projects");
		return {
			projects: rows.map((row, index) => parseGiteeProject(row, index)),
			hasMore: rows.length === PAGE_SIZE
		};
	}
};
/**
* Reduce user input to a bare host.
*
* Input may carry a scheme, credentials, a path, a query, or a fragment, as in
* `https://gitlab.arcuchi.com/some/path`; only the lowercase host and its
* optional port survive.
* @param raw - the host value to normalize.
* @returns the bare host, for example `gitlab.arcuchi.com` or `host:8443`.
* @throws {ProviderDataError} when the value cannot name a host.
*/
function normalizeHostValue(raw) {
	if (typeof raw !== "string") throw new ProviderDataError("A Git host is required.");
	const text = raw.trim();
	if (text.length === 0) throw new ProviderDataError("A Git host is required.");
	let authority = text;
	const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.exec(authority);
	if (scheme !== null) authority = authority.slice(scheme[0].length);
	authority = authority.replace(/^\/+/, "");
	const at = authority.lastIndexOf("@");
	if (at !== -1) authority = authority.slice(at + 1);
	authority = (authority.split(/[/?#]/, 1)[0] ?? "").toLowerCase().replace(/\.+$/, "");
	if (!HOST_PATTERN.test(authority)) throw new ProviderDataError(`${JSON.stringify(raw)} is not a Git host. Use a host name such as ${DEFAULT_PROVIDER_HOSTS.github}, with an optional port and nothing else.`);
	const port = /:([0-9]+)$/.exec(authority);
	if (port !== null && Number(port[1]) > 65535) throw new ProviderDataError(`${JSON.stringify(raw)} has a port outside 1-65535.`);
	return authority;
}
/** A host name with optional port: labels of letters, digits, and inner dashes. */
const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::[0-9]{1,5})?$/;
/**
* Base URL of GitHub's REST API for a host.
*
* The public host keeps its dedicated API host; GitHub Enterprise serves the
* same API under `/api/v3` on the account's own host.
* @param host - the account's host.
* @returns the API base, without a trailing slash.
*/
function githubApiBase(host) {
	const normalized = normalizeHostValue(host);
	return normalized === DEFAULT_PROVIDER_HOSTS.github ? "https://api.github.com" : `https://${normalized}/api/v3`;
}
/**
* Base URL of GitLab's REST API for a host.
* @param host - the account's host.
* @returns the API base, without a trailing slash.
*/
function gitlabApiBase(host) {
	return `https://${normalizeHostValue(host)}/api/v4`;
}
/**
* Base URL of Gitee's REST API for a host.
* @param host - the account's host.
* @returns the API base, without a trailing slash.
*/
function giteeApiBase(host) {
	return `https://${normalizeHostValue(host)}/api/v5`;
}
/**
* Headers every GitHub API request sends.
* @param token - the access token.
* @returns the request headers.
*/
function githubHeaders(token) {
	return {
		Authorization: `Bearer ${token}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		"user-agent": "dsh-worktree"
	};
}
/**
* Read one GitHub project row.
* @param row - one element of the response array.
* @param index - the row's position, for the diagnostic.
* @returns the project facts.
* @throws {ProviderDataError} when a required field is missing.
*/
function parseGithubProject(row, index) {
	const label = `GitHub project ${index + 1}`;
	const record = jsonObject(row, label);
	const fullName = requiredString(record, "full_name", label);
	const webUrl = requiredString(record, "html_url", label);
	const httpsUrl = requiredString(record, "clone_url", label);
	const idValue = record.id;
	const description = optionalString(record, "description");
	const defaultBranch = optionalString(record, "default_branch");
	const updatedAt = optionalString(record, "updated_at");
	const sshUrl = optionalString(record, "ssh_url");
	return {
		id: typeof idValue === "number" || typeof idValue === "string" ? String(idValue) : fullName,
		fullName,
		name: optionalString(record, "name") ?? lastSegment(fullName),
		visibility: record.private === true ? "private" : "public",
		webUrl,
		httpsUrl,
		...description === void 0 ? {} : { description },
		...defaultBranch === void 0 ? {} : { defaultBranch },
		...updatedAt === void 0 ? {} : { updatedAt },
		...sshUrl === void 0 ? {} : { sshUrl }
	};
}
/**
* Read one GitLab project row.
* @param row - one element of the response array.
* @param index - the row's position, for the diagnostic.
* @returns the project facts.
* @throws {ProviderDataError} when a required field is missing.
*/
function parseGitlabProject(row, index) {
	const label = `GitLab project ${index + 1}`;
	const record = jsonObject(row, label);
	const fullName = requiredString(record, "path_with_namespace", label);
	const webUrl = requiredString(record, "web_url", label);
	const httpsUrl = requiredString(record, "http_url_to_repo", label);
	const idValue = record.id;
	const description = optionalString(record, "description");
	const defaultBranch = optionalString(record, "default_branch");
	const updatedAt = optionalString(record, "last_activity_at");
	const sshUrl = optionalString(record, "ssh_url_to_repo");
	return {
		id: typeof idValue === "number" || typeof idValue === "string" ? String(idValue) : fullName,
		fullName,
		name: optionalString(record, "name") ?? lastSegment(fullName),
		visibility: gitlabVisibility(record.visibility),
		webUrl,
		httpsUrl,
		...description === void 0 ? {} : { description },
		...defaultBranch === void 0 ? {} : { defaultBranch },
		...updatedAt === void 0 ? {} : { updatedAt },
		...sshUrl === void 0 ? {} : { sshUrl }
	};
}
/**
* Read one Gitee project row.
* @param row - one element of the response array.
* @param index - the row's position, for the diagnostic.
* @returns the project facts.
* @throws {ProviderDataError} when a required field is missing.
*/
function parseGiteeProject(row, index) {
	const label = `Gitee project ${index + 1}`;
	const record = jsonObject(row, label);
	const fullName = requiredString(record, "full_name", label);
	const webUrl = requiredString(record, "html_url", label);
	const httpsUrl = requiredString(record, "clone_url", label);
	const idValue = record.id;
	const description = optionalString(record, "description");
	const defaultBranch = optionalString(record, "default_branch");
	const updatedAt = optionalString(record, "updated_at");
	const sshUrl = optionalString(record, "ssh_url");
	return {
		id: typeof idValue === "number" || typeof idValue === "string" ? String(idValue) : fullName,
		fullName,
		name: optionalString(record, "name") ?? lastSegment(fullName),
		visibility: record.private === true ? "private" : "public",
		webUrl,
		httpsUrl,
		...description === void 0 ? {} : { description },
		...defaultBranch === void 0 ? {} : { defaultBranch },
		...updatedAt === void 0 ? {} : { updatedAt },
		...sshUrl === void 0 ? {} : { sshUrl }
	};
}
/**
* Fold GitLab's visibility vocabulary onto the shared one.
* @param value - the `visibility` field of a GitLab project.
* @returns the shared visibility, or `unknown` for an unrecognized value.
*/
function gitlabVisibility(value) {
	return value === "public" || value === "internal" || value === "private" ? value : "unknown";
}
/**
* Assert a parsed JSON value is an object.
* @param value - the parsed value.
* @param label - what the object should represent, for the diagnostic.
* @returns the value as a field map.
* @throws {ProviderDataError} when the value is not an object.
*/
function jsonObject(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ProviderDataError(`${label} response is not a JSON object.`);
	return value;
}
/**
* Assert a parsed JSON value is an array.
* @param value - the parsed value.
* @param label - what the array should represent, for the diagnostic.
* @returns the value as an array.
* @throws {ProviderDataError} when the value is not an array.
*/
function jsonArray(value, label) {
	if (!Array.isArray(value)) throw new ProviderDataError(`${label} response is not a JSON array.`);
	return value;
}
/**
* Read a required string field.
* @param record - the row.
* @param key - the field name.
* @param label - what the row represents, for the diagnostic.
* @returns the field value.
* @throws {ProviderDataError} when the field is absent, empty, or not a string.
*/
function requiredString(record, key, label) {
	const value = record[key];
	if (typeof value !== "string" || value.trim() === "") throw new ProviderDataError(`${label} response has no "${key}".`);
	return value;
}
/**
* Read an optional string field, treating `null` and empty strings as absent.
* @param record - the row.
* @param key - the field name.
* @returns the field value, or `undefined`.
*/
function optionalString(record, key) {
	const value = record[key];
	return typeof value === "string" && value.trim() !== "" ? value : void 0;
}
/**
* Read an optional response header.
* @param headers - the response headers.
* @param name - the header name.
* @returns the trimmed value, or `undefined` when absent or empty.
*/
function optionalHeader(headers, name) {
	const value = headers.get(name);
	if (value === null) return void 0;
	const trimmed = value.trim();
	return trimmed === "" ? void 0 : trimmed;
}
/**
* Whether a GitHub `Link` header advertises a next page.
* @param link - the response's `Link` header, or `null`.
* @returns true when the header carries `rel="next"`.
*/
function linkHasNextPage(link) {
	return link !== null && /rel\s*=\s*"?next"?/.test(link);
}
/**
* The last segment of a namespaced path.
* @param path - a path such as `acme/widgets`.
* @returns the final segment.
*/
function lastSegment(path) {
	const index = path.lastIndexOf("/");
	return index === -1 ? path : path.slice(index + 1);
}
//#endregion
//#region src/git-accounts/scan-parsers.ts
/**
* Pure parsers behind the machine authorization scan.
*
* Every export here is a value transform over text that another module already
* read, except {@link collectSshNotes}, which inspects file NAMES under
* `<home>/.ssh` and the small `config` text file. No parser opens a network
* connection, spawns a process, or reads a private key's contents, which is
* what lets the scan spec exercise every branch against fixtures and temporary
* directories instead of the operator's real credentials.
* @module @guowenzhang/dsh-worktree/git-accounts/scan-parsers
*/
/**
* Targets whose value is a Git credential. Anything else in the store — web
* logons, RDP passwords, application secrets — is never read past its target
* name, so a scan cannot leak an unrelated secret.
*/
const GIT_TARGET = /^(?:git:|LegacyGeneric:target=git:|git-credential)/i;
/** Prefixes a Git credential target wears before the URL it names. */
const TARGET_PREFIX = /^(?:LegacyGeneric:target=|git-credential-manager:|git-credential:|git:)/i;
/** File names that hold an SSH private key; a `.pub` sibling is a public key. */
const SSH_PRIVATE_KEY_NAME = /^id_[A-Za-z0-9._-]+$/;
const SSH_PUBLIC_KEY_NAME = /\.pub$/i;
/** How many SSH findings one note may name, so a large key ring stays readable. */
const MAX_SSH_NOTE_DETAILS = 5;
/**
* Decode a URL component, keeping the raw text when its escapes are malformed.
*
* `URL` leaves the user info percent-encoded, and a hand-written
* `.git-credentials` line may contain a bare `%`; a decode failure must skip
* the escape, not the whole line.
* @param value - percent-encoded component text.
* @returns the decoded text, or the input when it is not valid percent-encoding.
*/
function decodeUrlComponent(value) {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}
/**
* Strip every Git-credential target prefix, outermost first.
* @param target - a Credential Manager target name.
* @returns the remainder, which is expected to be a URL.
*/
function stripTargetPrefixes(target) {
	let rest = target;
	for (;;) {
		const stripped = rest.replace(TARGET_PREFIX, "");
		if (stripped === rest) return rest;
		rest = stripped;
	}
}
/**
* Parse `~/.git-credentials`, Git's `store` helper file.
*
* One credential per line: `https://user:token@host`. Both `https` and `http`
* are accepted (`http` is the scheme a self-hosted host on a trusted network
* uses; this scan only reads what Git already stored and never sends it
* anywhere), and lines that are not a complete credential are skipped rather
* than reported, because a malformed line names no candidate to probe.
* @param text - the file's contents.
* @param source - the scan source to tag the candidates with; always `git-credentials`.
* @returns one candidate per complete credential line, in file order.
*/
function parseGitCredentials(text, source) {
	const candidates = [];
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length === 0) continue;
		let url;
		try {
			url = new URL(line);
		} catch {
			continue;
		}
		if (url.protocol !== "https:" && url.protocol !== "http:") continue;
		if (url.username.length === 0 || url.password.length === 0) continue;
		const host = url.host;
		const provider = inferProvider(host);
		candidates.push({
			host,
			...provider === void 0 ? {} : { provider },
			token: decodeUrlComponent(url.password),
			login: decodeUrlComponent(url.username),
			source
		});
	}
	return candidates;
}
/**
* Parse the JSON the Credential Manager script printed.
*
* The script emits an array, but a single stored credential can serialize as
* one object depending on how the host serializes it, so both shapes are
* accepted. A leading byte-order mark is tolerated because Windows PowerShell's
* redirected stdout may prepend one. Entries are filtered to Git credential
* targets here, before any caller can look at their blobs.
* @param stdout - the script's stdout.
* @returns the Git credential entries, in output order; empty when the text is
*   empty, malformed, or names no Git credential.
*/
function parseCredentialManagerOutput(stdout) {
	const text = stdout.replace(/^\uFEFF/, "").trim();
	if (text.length === 0) return [];
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return [];
	}
	const rows = Array.isArray(parsed) ? parsed : [parsed];
	const entries = [];
	for (const row of rows) {
		if (typeof row !== "object" || row === null) continue;
		const record = row;
		const target = typeof record.target === "string" ? record.target : void 0;
		if (target === void 0 || target.length === 0 || !GIT_TARGET.test(target)) continue;
		const userName = typeof record.userName === "string" ? record.userName : "";
		const blobBase64 = typeof record.blobBase64 === "string" ? record.blobBase64 : "";
		entries.push({
			target,
			userName,
			blobBase64
		});
	}
	return entries;
}
/**
* Decode a Credential Manager blob into the token it stores.
*
* Windows Credential Manager stores a generic credential's blob as UTF-16LE
* when the writer passed Unicode, while other writers (git-credential-manager
* among them) store UTF-8. The two are told apart by shape: an even number of
* bytes whose odd positions are all zero is the UTF-16LE form of a text value;
* anything else is decoded as UTF-8. Trailing NUL padding and surrounding
* whitespace are dropped, since neither is part of the password.
* @param base64 - the blob, base64-encoded.
* @returns the stored text; empty when the input is empty or undecodable.
*/
function decodeCredentialBlob(base64) {
	const trimmed = base64.trim();
	if (trimmed.length === 0) return "";
	const bytes = Buffer.from(trimmed, "base64");
	if (bytes.length === 0) return "";
	if (bytes.length % 2 === 0) {
		let utf16 = true;
		for (let index = 1; index < bytes.length; index += 2) if (bytes[index] !== 0) {
			utf16 = false;
			break;
		}
		if (utf16) return bytes.toString("utf16le").replace(/\u0000+$/, "").trim();
	}
	return bytes.toString("utf8").replace(/\u0000+$/, "").trim();
}
/**
* Pull the token `gh auth token` prints.
* @param stdout - the command's stdout.
* @returns the trimmed token, or undefined when the command printed nothing.
*/
function parseGhToken(stdout) {
	const token = stdout.trim();
	return token.length === 0 ? void 0 : token;
}
/**
* Infer a host family from a host name.
*
* The three public hosts are matched exactly; a self-hosted instance is
* recognized by its name containing the provider's name (for example
* `gitlab.arcuchi.com`). A host whose family cannot be inferred keeps no
* provider, and the account service then probes it instead of guessing.
* @param host - a host name, optionally with a port.
* @returns the host family, or undefined when the name names none.
*/
function inferProvider(host) {
	const normalized = host.trim().toLowerCase();
	if (normalized.length === 0) return void 0;
	if (normalized === "github.com") return "github";
	if (normalized === "gitlab.com") return "gitlab";
	if (normalized === "gitee.com") return "gitee";
	if (normalized.includes("gitlab")) return "gitlab";
	if (normalized.includes("gitee")) return "gitee";
	if (normalized.includes("github")) return "github";
}
/**
* Recover the URL a Credential Manager Git target names.
*
* Windows stores the same credential under a few target spellings
* (`git:https://github.com`, `LegacyGeneric:target=git:https://github.com`,
* `git-credential:...`); each spelling is a prefix in front of the host URL.
* @param target - a Credential Manager target name.
* @returns the normalized URL, or undefined when the remainder is not an
*   absolute http(s) URL.
*/
function credentialManagerTargetUrl(target) {
	const trimmed = target.trim();
	if (trimmed.length === 0) return void 0;
	const remainder = stripTargetPrefixes(trimmed);
	if (remainder === trimmed) return void 0;
	let url;
	try {
		url = new URL(remainder);
	} catch {
		return;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return void 0;
	if (url.hostname.length === 0) return void 0;
	return url.href;
}
/**
* Read the hosts and key names an SSH client configuration mentions.
* @param configPath - absolute path of `.ssh/config`.
* @returns the `Host` aliases (wildcards excluded), `HostName` values, and
*   `IdentityFile` basenames, in file order; empty when the file is missing.
*/
async function collectSshConfigDetails(configPath) {
	let text;
	try {
		text = await readFile(configPath, "utf8");
	} catch {
		return [];
	}
	const details = [];
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith("#")) continue;
		const match = /^([A-Za-z]+)\s+(.+)$/.exec(line);
		if (match === null) continue;
		const directive = match[1].toLowerCase();
		const value = match[2].trim();
		if (directive === "host") for (const alias of value.split(/\s+/)) {
			if (alias.length === 0 || alias.includes("*") || alias.includes("?")) continue;
			details.push(alias);
		}
		else if (directive === "hostname") details.push(value);
		else if (directive === "identityfile") details.push(basename(value.replace(/^["']|["']$/g, "")));
	}
	return details;
}
/**
* Report SSH keys and configured hosts as a note the page can explain.
*
* An SSH key authorizes Git transport, not the provider REST API: a key that
* `~/.ssh/config` pairs with a known host can become an SSH account (that
* candidate list lives in `ssh.ts`), but it can never list projects. The note
* tells the operator which keys and hosts were seen, including any key no scan
* pair covers. Only file names and config text are inspected — a private key
* file is never opened.
* @param homeDirectory - the operator's home directory.
* @returns one note naming at most five findings, or none when `.ssh` has none.
*/
async function collectSshNotes(homeDirectory) {
	const sshDirectory = join(homeDirectory, ".ssh");
	let entries;
	try {
		entries = await readdir(sshDirectory, { withFileTypes: true });
	} catch {
		return [];
	}
	const details = [];
	const keyNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).filter((name) => SSH_PRIVATE_KEY_NAME.test(name) && !SSH_PUBLIC_KEY_NAME.test(name)).sort();
	details.push(...keyNames);
	details.push(...await collectSshConfigDetails(join(sshDirectory, "config")));
	const unique = [];
	for (const detail of details) {
		if (!unique.includes(detail)) unique.push(detail);
		if (unique.length === MAX_SSH_NOTE_DETAILS) break;
	}
	if (unique.length === 0) return [];
	return [{
		code: "ssh-keys-found",
		detail: unique.join(", ")
	}];
}
/**
* The PowerShell program the scan spawns on Windows.
*
* It P/Invokes `advapi32!CredEnumerateW` for generic credentials, keeps only
* entries whose target names a Git credential, base64-encodes each blob, and
* prints one compressed JSON array — `[]` when there is nothing to report. The
* outer guard turns a missing `advapi32` (or an older host that cannot compile
* the type) into `[]` instead of a failing exit, so the scan can report an
* empty Windows credential store accurately. The script never prompts; the
* scan still spawns it with `-NonInteractive` so an unexpected prompt fails
* fast instead of waiting for a console that is not attached.
*/
const CREDENTIAL_MANAGER_SCRIPT = String.raw`$ErrorActionPreference = 'Stop'
try {
  try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch { }
  $source = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class DshGitCredentialStore
{
    [StructLayout(LayoutKind.Sequential)]
    private struct FILETIME
    {
        public uint dwLowDateTime;
        public uint dwHighDateTime;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL
    {
        public int Flags;
        public int Type;
        public string TargetName;
        public string Comment;
        public FILETIME LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    public sealed class Entry
    {
        public string target { get; set; }
        public string userName { get; set; }
        public string blobBase64 { get; set; }
    }

    [DllImport("advapi32.dll", EntryPoint = "CredEnumerateW", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CredEnumerate(string filter, int flags, out int count, out IntPtr credentials);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern void CredFree(IntPtr buffer);

    private static bool IsGitTarget(string target)
    {
        if (target == null || target.Length == 0)
            return false;
        if (target.StartsWith("git:", StringComparison.OrdinalIgnoreCase))
            return true;
        if (target.StartsWith("LegacyGeneric:target=git:", StringComparison.OrdinalIgnoreCase))
            return true;
        return target.StartsWith("git-credential", StringComparison.OrdinalIgnoreCase);
    }

    public static Entry[] Read()
    {
        int count;
        IntPtr credentials;
        if (!CredEnumerate(null, 0, out count, out credentials))
            return new Entry[0];
        List<Entry> entries = new List<Entry>();
        try
        {
            for (int index = 0; index < count; index++)
            {
                IntPtr pointer = Marshal.ReadIntPtr(credentials, index * IntPtr.Size);
                CREDENTIAL credential = (CREDENTIAL)Marshal.PtrToStructure(pointer, typeof(CREDENTIAL));
                if (!IsGitTarget(credential.TargetName))
                    continue;
                byte[] blob = new byte[0];
                if (credential.CredentialBlobSize > 0 && credential.CredentialBlob != IntPtr.Zero)
                {
                    blob = new byte[credential.CredentialBlobSize];
                    Marshal.Copy(credential.CredentialBlob, blob, 0, blob.Length);
                }
                Entry entry = new Entry();
                entry.target = credential.TargetName == null ? string.Empty : credential.TargetName;
                entry.userName = credential.UserName == null ? string.Empty : credential.UserName;
                entry.blobBase64 = Convert.ToBase64String(blob);
                entries.Add(entry);
            }
        }
        finally
        {
            CredFree(credentials);
        }
        return entries.ToArray();
    }
}
'@
  Add-Type -TypeDefinition $source -Language CSharp
  $entries = [DshGitCredentialStore]::Read()
  if ($null -eq $entries -or $entries.Count -eq 0) {
    [Console]::Out.Write('[]')
  } else {
    [Console]::Out.Write((ConvertTo-Json -InputObject @($entries) -Compress -Depth 3))
  }
} catch {
  [Console]::Out.Write('[]')
}`;
//#endregion
//#region src/git-accounts/ssh.ts
/**
* SSH-key authentication for Git accounts.
*
* A Git remote can be reached over SSH with a private key and no provider API
* token, but the provider APIs this capability reads cannot be asked "which
* projects can this key reach": SSH authorizes Git transport, not REST. So an
* SSH account is stored for what it is — a key that a host accepts as a login —
* and the project list stays the token accounts' job.
*
* Verification is one `ssh -T git@<host>`: the banner a host prints on success
* names the account (`Hi <login>!`, `Welcome to GitLab, @<login>!`), which is how
* an SSH key becomes a row with a login instead of an opaque path. The probe is
* non-interactive by construction — `BatchMode=yes` makes an encrypted key fail
* instead of waiting for a prompt — and it writes host keys to a scratch
* `known_hosts`, so the operator's own SSH configuration is never modified.
*
* The private key's contents are never read: this module hands the path to
* `ssh -i` and nothing else.
* @module @guowenzhang/dsh-worktree/git-accounts/ssh
*/
/** File names that hold an SSH private key; a `.pub` sibling is a public key. */
const PRIVATE_KEY_NAME = /^id_[A-Za-z0-9._-]+$/u;
/** How many private keys one read offers the operator. */
const MAX_KEYS = 12;
/** How many SSH candidates one scan verifies; a key ring must not turn one click into minutes. */
const MAX_CANDIDATES = 6;
/**
* Bound on one verification, in milliseconds.
*
* A reachable host answers in well under a second, so five seconds is generous.
* When a host has an SSH-over-443 fallback the first endpoint gets the first
* three seconds and the fallback the rest, so the whole verification still ends
* at this budget instead of spending it twice.
*/
const PROBE_BUDGET_MS = 5e3;
/** Share of {@link PROBE_BUDGET_MS} the first endpoint may use when a fallback exists. */
const PRIMARY_PROBE_MS = 3e3;
/** TCP connect bound handed to OpenSSH itself, in seconds; the process budget above is the backstop. */
const CONNECT_TIMEOUT_SECONDS = 5;
/**
* SSH-over-443 fallbacks for the two hosts that publish one.
*
* A network that drops outbound port 22 (common behind restrictive middleboxes)
* still reaches GitHub and GitLab on 443, where both run the same SSH service.
* The account keeps its browser/API host (`github.com`); only the probe uses the
* alternate endpoint, and the result reports which endpoint answered.
*/
const SSH_FALLBACKS = {
	github: {
		hostname: "ssh.github.com",
		port: "443"
	},
	gitlab: {
		hostname: "altssh.gitlab.com",
		port: "443"
	}
};
/** A key file name a note or dialog can show without opening the file. */
const KEY_FILE_NAME = /^[^\\/:*?"<>|]+$/u;
/** One verification failure, classified for the account capability. */
var SshVerificationError = class extends Error {
	code;
	/**
	* @param code - failure class this module can tell apart.
	* @param message - actionable text; never key contents.
	*/
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "SshVerificationError";
	}
};
/**
* Read a host's `ssh -T` banner.
*
* Each host family words the success line differently, and the login is the only
* fact worth extracting. An authentication success without a recognizable name
* still reports `authenticated`, so a caller can distinguish "the key works but
* cannot be attributed" from "the key was refused". The wording also identifies
* the host family, which is how a scan can place a self-hosted host whose domain
* does not name its platform.
* @param output - the probe's stdout and stderr, concatenated.
* @returns whether the key authenticated and, when the host names them, its login and family.
*/
function parseSshBanner(output) {
	const giteeHi = /Hi\s+([^!\r\n]+)!\s+You've successfully authenticated,\s+but\s+GITEE\.COM/iu.exec(output);
	if (giteeHi?.[1] !== void 0) return {
		authenticated: true,
		login: giteeHi[1].trim(),
		provider: "gitee"
	};
	const github = /Hi\s+([^!\r\n]+)!\s+You've successfully authenticated/iu.exec(output);
	if (github?.[1] !== void 0) return {
		authenticated: true,
		login: github[1].trim(),
		provider: "github"
	};
	const gitlab = /Welcome to GitLab,\s*@?([^\s!]+)!/iu.exec(output);
	if (gitlab?.[1] !== void 0) return {
		authenticated: true,
		login: gitlab[1].trim(),
		provider: "gitlab"
	};
	const giteeWelcome = /Welcome to Gitee\.com,\s*([^!\r\n]+)!/iu.exec(output);
	if (giteeWelcome?.[1] !== void 0) return {
		authenticated: true,
		login: giteeWelcome[1].trim(),
		provider: "gitee"
	};
	if (/successfully authenticated/iu.test(output)) return { authenticated: true };
	return { authenticated: false };
}
/**
* Expand a leading `~` and make a path absolute against the operator's home.
* @param path - a path as typed or as written in `~/.ssh/config`.
* @param home - the home directory to expand against.
* @returns the absolute path.
*/
function expandKeyPath(path, home = homedir()) {
	const trimmed = path.trim();
	if (trimmed === "~") return home;
	if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) return resolve(home, trimmed.slice(2));
	return isAbsolute(trimmed) ? resolve(trimmed) : resolve(home, trimmed);
}
/**
* Whether a path names a private key file that exists.
* @param keyPath - absolute or `~`-relative path.
* @param home - the home directory to expand against.
* @returns the absolute path when the file exists.
* @throws {SshVerificationError} when the path is not a file.
*/
async function resolveExistingKey(keyPath, home) {
	const absolute = expandKeyPath(keyPath, home);
	let isFile = false;
	try {
		isFile = (await stat(absolute)).isFile();
	} catch {
		isFile = false;
	}
	if (!isFile) throw new SshVerificationError("invalid_input", `the SSH key file ${JSON.stringify(absolute)} does not exist`);
	return absolute;
}
/**
* Read the private keys this machine offers: `id_*` files in `~/.ssh` plus the
* explicit `IdentityFile` values in its config.
* @param homeDirectory - the operator's home directory.
* @returns the existing private key paths, deduplicated and ordered by name.
*/
async function listSshKeys(homeDirectory = homedir()) {
	const sshDirectory = join(homeDirectory, ".ssh");
	const found = /* @__PURE__ */ new Map();
	let entries = [];
	try {
		entries = (await readdir(sshDirectory, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name);
	} catch {
		entries = [];
	}
	const add = (path, name) => {
		if (found.size >= MAX_KEYS || !KEY_FILE_NAME.test(name)) return;
		found.set(path, {
			path,
			name
		});
	};
	for (const name of entries.sort()) if (PRIVATE_KEY_NAME.test(name) && !name.endsWith(".pub")) add(join(sshDirectory, name), name);
	for (const block of await readSshConfig(sshDirectory)) for (const identity of block.identityFiles) {
		const path = expandKeyPath(identity, homeDirectory);
		if (!found.has(path)) add(path, basename(path));
	}
	return [...found.values()].slice(0, MAX_KEYS);
}
/**
* Read `~/.ssh/config` into host blocks.
* @param sshDirectory - the `.ssh` directory.
* @returns the blocks in file order; empty when the file is absent.
*/
async function readSshConfig(sshDirectory) {
	let text;
	try {
		text = await readFile(join(sshDirectory, "config"), "utf8");
	} catch {
		return [];
	}
	const blocks = [];
	let identityFiles = [];
	let hostName;
	let aliases = [];
	const flush = () => {
		const host = hostName ?? aliases.find((alias) => !alias.includes("*") && !alias.includes("?"));
		if (host !== void 0 || identityFiles.length > 0) blocks.push({
			identityFiles,
			host
		});
		identityFiles = [];
		hostName = void 0;
		aliases = [];
	};
	for (const raw of text.split(/\r?\n/u)) {
		const line = raw.trim();
		if (line === "" || line.startsWith("#")) continue;
		const match = /^([A-Za-z][A-Za-z0-9]*)[ \t]+(.+)$/u.exec(line);
		if (match === null) continue;
		const key = match[1].toLowerCase();
		const value = match[2].trim();
		if (key === "host") {
			flush();
			aliases = value.split(/[ \t]+/u).filter((alias) => alias !== "");
			continue;
		}
		if (key === "hostname") hostName = unquote(value);
		else if (key === "identityfile") identityFiles.push(unquote(value));
	}
	flush();
	return blocks;
}
/**
* Strip the quotes an SSH config value may carry.
* @param value - the raw value.
* @returns the bare value.
*/
function unquote(value) {
	return (/^"(.*)"$/u.exec(value) ?? /^'(.*)'$/u.exec(value))?.[1] ?? value;
}
/**
* Read the `~/.ssh/config` pairs that name a known Git host and an explicit
* private key.
*
* Only explicit `IdentityFile` entries for a recognized host become candidates:
* an unconfigured key ring cannot be attributed to a host without probing every
* combination, and a scan that quietly opens several SSH connections per key is
* not what one click should do. A private key for a host the inference cannot
* place is still reported as a note, and the add dialog can verify it manually.
* @param homeDirectory - the operator's home directory.
* @returns at most {@link MAX_CANDIDATES} key/host pairs, deduplicated.
*/
async function collectSshKeyCandidates(homeDirectory = homedir()) {
	const blocks = await readSshConfig(join(homeDirectory, ".ssh"));
	const candidates = [];
	const seen = /* @__PURE__ */ new Set();
	for (const block of blocks) {
		if (block.host === void 0) continue;
		const provider = inferProvider(block.host);
		if (provider === void 0) continue;
		for (const identity of block.identityFiles) {
			const keyPath = expandKeyPath(identity, homeDirectory);
			const key = `${provider}|${block.host}|${keyPath}`;
			if (seen.has(key)) continue;
			seen.add(key);
			candidates.push({
				keyPath,
				host: block.host,
				provider
			});
			if (candidates.length === MAX_CANDIDATES) return candidates;
		}
	}
	return candidates;
}
/**
* Verify one private key against one host and read the account login.
*
* The probe is `ssh -T git@<hostname>` with batch mode, an isolated scratch
* `known_hosts`, and the selected key only. A host that authenticates prints its
* banner before closing the session — GitHub exits nonzero after a successful
* authentication, so the banner decides, not the exit status. When `github.com`
* or `gitlab.com` is unreachable on 22 and the host has a published SSH-over-443
* endpoint, that endpoint is tried once before failing.
* @param request - provider, host, key path, and timeout.
* @returns the host's profile facts for the key and the family its banner names.
* @throws {SshVerificationError} when the key is unusable, refused, or the host is unreachable.
*/
async function verifySshKey(request) {
	const keyPath = await resolveExistingKey(request.keyPath);
	const targets = sshProbeEndpoints(request.provider, request.host);
	const scratch = await mkdtemp(join(tmpdir(), "dsh-worktree-ssh-"));
	const knownHosts = join(scratch, "known_hosts");
	try {
		await writeFile(knownHosts, "");
		let lastError;
		for (const [index, target] of targets.entries()) try {
			return await probeTarget(target, keyPath, knownHosts, request.provider, probeTimeout(request.timeoutMs, targets.length, index));
		} catch (error) {
			if (!(error instanceof SshVerificationError)) throw error;
			lastError = error;
			if (!(index + 1 < targets.length) || error.code !== "network") throw error;
		}
		if (lastError !== void 0 && targets.length > 1) {
			const tried = targets.map((target) => `${target.hostname}:${target.port ?? "22"}`).join(" and ");
			throw new SshVerificationError("network", `could not reach ${request.host} over SSH (tried ${tried})`);
		}
		throw lastError ?? new SshVerificationError("network", `could not reach ${request.host} over SSH`);
	} finally {
		await rm(scratch, {
			recursive: true,
			force: true
		}).catch(() => {});
	}
}
/**
* Build the endpoints one verification may try: the host as entered, then the
* published SSH-over-443 fallback when the host is a canonical github/gitlab one
* and no custom port was named. Exported for the SSH spec, which pins the
* fallback order without opening a connection.
* @param provider - host family.
* @param host - normalized host, possibly `host:port`.
* @returns the endpoints in the order they are tried.
*/
function sshProbeEndpoints(provider, host) {
	const primary = splitHostPort(host);
	const targets = [primary];
	const fallback = SSH_FALLBACKS[provider];
	if (primary.port === void 0 && fallback !== void 0 && primary.hostname === (provider === "github" ? "github.com" : "gitlab.com")) targets.push(fallback);
	return targets;
}
/**
* Probe one endpoint and turn its banner into a result.
* @param target - the endpoint to dial.
* @param keyPath - resolved private key path.
* @param knownHosts - scratch known-hosts file shared by one verification's attempts.
* @param provider - host family, for the failure text.
* @param timeoutMs - this attempt's process bound.
* @returns the verified result.
* @throws {SshVerificationError} when the probe is refused or unreachable.
*/
async function probeTarget(target, keyPath, knownHosts, provider, timeoutMs) {
	const output = await runSsh([
		"-T",
		"-i",
		keyPath,
		"-o",
		"BatchMode=yes",
		"-o",
		"IdentitiesOnly=yes",
		"-o",
		"StrictHostKeyChecking=accept-new",
		"-o",
		`UserKnownHostsFile=${knownHosts}`,
		"-o",
		`ConnectTimeout=${String(CONNECT_TIMEOUT_SECONDS)}`,
		...target.port === void 0 ? [] : ["-p", target.port],
		`git@${target.hostname}`
	], timeoutMs);
	const banner = parseSshBanner(output);
	if (banner.authenticated && banner.login !== void 0 && banner.login !== "") return {
		profile: { login: banner.login },
		...banner.provider === void 0 ? {} : { provider: banner.provider },
		...target.port === void 0 ? {} : { endpoint: `${target.hostname}:${target.port}` }
	};
	if (banner.authenticated) throw new SshVerificationError("provider_unavailable", "the host accepted the SSH key but its banner named no account, so the login cannot be recorded");
	throw classifyProbeFailure(output, provider, target.hostname);
}
/**
* Split a host that may carry a port into its SSH parts.
* @param host - a normalized host such as `gitlab.example.com` or `host:2222`.
* @returns the hostname and, when present, the port.
*/
function splitHostPort(host) {
	const match = /^(.*):(\d{1,5})$/u.exec(host);
	if (match === null) return {
		hostname: host,
		port: void 0
	};
	return {
		hostname: match[1],
		port: match[2]
	};
}
/**
* The process bound one attempt gets.
* @param override - a caller-supplied bound, used verbatim for every attempt.
* @param attempts - how many endpoints this verification may try.
* @param index - the attempt's position.
* @returns milliseconds for this attempt.
*/
function probeTimeout(override, attempts, index) {
	if (override !== void 0) return override;
	if (attempts <= 1) return PROBE_BUDGET_MS;
	return index === 0 ? PRIMARY_PROBE_MS : 2e3;
}
/**
* Run one `ssh` probe and return its stdout and stderr together.
*
* A nonzero exit is this probe's normal answer for both success-with-banner and
* refusal, so the caller classifies the output; only a spawn-level failure
* (no `ssh` executable) is thrown here.
* @param args - ssh arguments.
* @param timeoutMs - bound on the probe.
* @returns stdout followed by stderr.
* @throws {SshVerificationError} when `ssh` cannot be started or the probe times out.
*/
async function runSsh(args, timeoutMs) {
	return await new Promise((resolvePromise, rejectPromise) => {
		execFile("ssh", [...args], {
			timeout: timeoutMs,
			windowsHide: true,
			maxBuffer: 262144
		}, (error, stdout, stderr) => {
			const output = `${stdout}${stderr}`;
			if (error === null) {
				resolvePromise(output);
				return;
			}
			const failure = error;
			if (failure.code === "ENOENT") {
				rejectPromise(new SshVerificationError("provider_unavailable", "the OpenSSH client (ssh) was not found on the Host PATH, so SSH accounts cannot be verified"));
				return;
			}
			if (failure.killed === true) {
				const seconds = Math.round(timeoutMs / 1e3);
				rejectPromise(new SshVerificationError("network", `the SSH probe timed out after ${String(seconds)} seconds`));
				return;
			}
			resolvePromise(output);
		});
	});
}
/**
* Classify a probe that printed no success banner.
* @param output - the probe's stdout and stderr.
* @param provider - host family, for the message.
* @param hostname - host that was probed.
* @returns the failure to throw.
*/
function classifyProbeFailure(output, provider, hostname) {
	if (/permission denied\s*\(publickey/i.test(output)) return new SshVerificationError("unauthorized", `the ${provider} host refused this SSH key (publickey permission denied)`);
	if (/enter passphrase|passphrase/iu.test(output)) return new SshVerificationError("invalid_input", "the SSH key is encrypted; load it into ssh-agent (or use an unencrypted key) before adding the account");
	if (/could not resolve hostname|connection timed out|connection refused|network is unreachable|no route to host|host is unreachable/iu.test(output)) return new SshVerificationError("network", `could not reach ${hostname} over SSH`);
	if (/no such identity|identity file .* not accessible|could not open/i.test(output)) return new SshVerificationError("invalid_input", "the SSH key file could not be read by the OpenSSH client");
	if (/host key verification failed/iu.test(output)) return new SshVerificationError("provider_unavailable", `the SSH host key for ${hostname} did not verify`);
	return new SshVerificationError("provider_unavailable", `SSH verification against ${hostname} failed: ${(output.split(/\r?\n/u).map((line) => line.trim()).find((line) => line !== "") ?? "no diagnostic").replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 300)}`);
}
//#endregion
//#region src/git-accounts/scan.ts
/**
* Host-side discovery of the Git authorizations this machine already stores.
*
* A scan reads five sources in a fixed order — environment variables,
* `~/.git-credentials`, the `gh` CLI, on Windows the Credential Manager, and the
* SSH configuration's key/host pairs — and never verifies or stores anything
* itself. Verification belongs to the account service, which probes each
* candidate's host and decides whether it becomes an account; this module only
* reports what it found, where it found it, and what it deliberately did not
* import.
*
* Two rules keep the result safe to hand upward:
* - a token appears only in {@link RawScanCandidate.token}, never in a note or
*   an error message,
* - a private key appears only as a path in {@link RawScanCandidate.keyPath};
*   its contents are never read here, and
* - every source the scan could not read is reported as unavailable instead of
*   being silently skipped.
* @module @guowenzhang/dsh-worktree/git-accounts/scan
*/
/** Environment variables that carry a token for a known host. */
const ENVIRONMENT_TOKEN_SOURCES = [
	{
		names: ["GH_TOKEN", "GITHUB_TOKEN"],
		host: "github.com",
		provider: "github"
	},
	{
		names: ["GITLAB_TOKEN", "GITLAB_PRIVATE_TOKEN"],
		host: "gitlab.com",
		provider: "gitlab"
	},
	{
		names: ["GITEE_TOKEN", "GITEE_ACCESS_TOKEN"],
		host: "gitee.com",
		provider: "gitee"
	}
];
/** `gh auth token` should answer immediately; anything slower is a hung helper. */
const GH_CLI_TIMEOUT_MS = 1e4;
/** The Credential Manager script compiles a type on first run; that takes a moment. */
const POWERSHELL_TIMEOUT_MS = 2e4;
/** The file Git's `store` helper writes. */
const GIT_CREDENTIALS_FILE = ".git-credentials";
/** PowerShell 5.1 on every supported Windows version. */
const POWERSHELL_EXECUTABLE = "powershell.exe";
/** Arguments that keep Windows PowerShell quiet, non-interactive, and script-tolerant. */
const POWERSHELL_ARGUMENTS = [
	"-NoLogo",
	"-NoProfile",
	"-NonInteractive",
	"-ExecutionPolicy",
	"Bypass"
];
/**
* Run one helper command with `child_process.execFile`.
* @param file - executable name or path.
* @param args - arguments, passed as an array so no shell re-parses them.
* @param options - the read's timeout.
* @returns the command's stdout.
* @throws the underlying process error on a nonzero exit, a missing executable, or a timeout.
*/
function runCommandWithExecFile(file, args, options) {
	return new Promise((resolvePromise, rejectPromise) => {
		execFile(file, [...args], {
			windowsHide: true,
			timeout: options.timeoutMs,
			maxBuffer: 8388608
		}, (error, stdout) => {
			if (error !== null) {
				rejectPromise(error);
				return;
			}
			resolvePromise({ stdout });
		});
	});
}
/**
* Read the token environment variables.
* @param environment - the environment to read.
* @returns one candidate per set, non-blank variable, in {@link ENVIRONMENT_TOKEN_SOURCES} order.
*/
function collectEnvironmentCandidates(environment) {
	const candidates = [];
	for (const source of ENVIRONMENT_TOKEN_SOURCES) for (const name of source.names) {
		const token = environment[name]?.trim();
		if (token === void 0 || token.length === 0) continue;
		candidates.push({
			host: source.host,
			provider: source.provider,
			token,
			source: "environment"
		});
	}
	return candidates;
}
/**
* Read `~/.git-credentials`.
* @param homeDirectory - the operator's home directory.
* @returns the file's candidates and whether it exists.
*/
async function readGitCredentials(homeDirectory) {
	const file = join(homeDirectory, GIT_CREDENTIALS_FILE);
	if (!existsSync(file)) return {
		available: false,
		supported: true,
		candidates: [],
		notes: []
	};
	try {
		return {
			available: true,
			supported: true,
			candidates: parseGitCredentials(await readFile(file, "utf8"), "git-credentials"),
			notes: []
		};
	} catch {
		return {
			available: true,
			supported: true,
			candidates: [],
			notes: []
		};
	}
}
/**
* Read `gh auth token`.
* @param runCommand - the command runner to use.
* @returns the token candidate when gh is installed and logged in.
*/
async function readGhCli(runCommand) {
	try {
		const { stdout } = await runCommand("gh", ["auth", "token"], { timeoutMs: GH_CLI_TIMEOUT_MS });
		const token = parseGhToken(stdout);
		if (token === void 0) return {
			available: false,
			supported: true,
			candidates: [],
			notes: []
		};
		return {
			available: true,
			supported: true,
			candidates: [{
				host: "github.com",
				provider: "github",
				token,
				source: "gh-cli"
			}],
			notes: []
		};
	} catch {
		return {
			available: false,
			supported: true,
			candidates: [],
			notes: []
		};
	}
}
/**
* Keep the last segment of a Windows-qualified credential user name.
* @param userName - the stored user name, possibly `DOMAIN\user`.
* @returns the login, or undefined when the stored name is blank.
*/
function loginFromCredentialManagerUser(userName) {
	const trimmed = userName.trim();
	if (trimmed.length === 0) return void 0;
	const separator = trimmed.lastIndexOf("\\");
	const login = separator === -1 ? trimmed : trimmed.slice(separator + 1);
	return login.length === 0 ? void 0 : login;
}
/**
* Recover the login a credential URL names, when it names one.
* @param url - the credential's host URL.
* @returns the decoded user-info login, or undefined when the URL has none.
*/
function loginFromCredentialUrl(url) {
	if (url.username.length === 0) return void 0;
	try {
		return decodeURIComponent(url.username);
	} catch {
		return url.username;
	}
}
/**
* Read the Windows Credential Manager through the PowerShell program.
* @param platform - the host platform.
* @param runCommand - the command runner to use.
* @returns the source's reading, including a note explaining an unsupported
*   platform or an unavailable PowerShell.
*/
async function readCredentialManager(platform, runCommand) {
	if (platform !== "win32") return {
		available: false,
		supported: false,
		candidates: [],
		notes: [{
			code: "platform-unsupported",
			detail: "windows"
		}]
	};
	let stdout;
	try {
		stdout = (await runCommand(POWERSHELL_EXECUTABLE, [
			...POWERSHELL_ARGUMENTS,
			"-Command",
			CREDENTIAL_MANAGER_SCRIPT
		], { timeoutMs: POWERSHELL_TIMEOUT_MS })).stdout;
	} catch {
		return {
			available: false,
			supported: true,
			candidates: [],
			notes: [{
				code: "tool-missing",
				detail: "powershell"
			}]
		};
	}
	const candidates = [];
	for (const entry of parseCredentialManagerOutput(stdout)) {
		const targetUrl = credentialManagerTargetUrl(entry.target);
		if (targetUrl === void 0) continue;
		let url;
		try {
			url = new URL(targetUrl);
		} catch {
			continue;
		}
		const token = decodeCredentialBlob(entry.blobBase64);
		if (token.length === 0) continue;
		const host = url.host;
		if (host.length === 0) continue;
		const login = loginFromCredentialManagerUser(entry.userName) ?? loginFromCredentialUrl(url);
		const provider = inferProvider(host);
		candidates.push({
			host,
			...provider === void 0 ? {} : { provider },
			token,
			...login === void 0 ? {} : { login },
			source: "credential-manager"
		});
	}
	return {
		available: true,
		supported: true,
		candidates,
		notes: []
	};
}
/**
* Drop repeated credentials, keeping the first (and therefore highest-priority) finding.
*
* The same token can be stored by several sources — an exported variable and a
* `.git-credentials` line, say — and probing it twice would ask the host the
* same question twice. The key deliberately ignores the login because the host,
* not the stored name, decides who the token is.
* @param candidates - candidates in source and discovery order.
* @returns the candidates with repeats removed, in the same order.
*/
function dedupeCandidates(candidates) {
	const seen = /* @__PURE__ */ new Set();
	const unique = [];
	for (const candidate of candidates) {
		const secret = candidate.auth === "ssh" ? `ssh:${candidate.keyPath ?? ""}` : candidate.token ?? "";
		const key = `${candidate.auth ?? "token"}|${candidate.provider ?? "?"}|${candidate.host.toLowerCase()}|${secret}`;
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(candidate);
	}
	return unique;
}
/**
* Read the `~/.ssh/config` key/host pairs as SSH candidates.
*
* Only explicit `IdentityFile`/`Host` pairs become candidates; a key that the
* configuration does not attribute to a host stays a note, because probing every
* key against every host is not what one click should do.
* @param homeDirectory - the operator's home directory.
* @returns the SSH candidates, in configuration order.
*/
async function readSshKeys(homeDirectory) {
	const pairs = await collectSshKeyCandidates(homeDirectory);
	return {
		available: pairs.length > 0,
		supported: true,
		candidates: pairs.map((pair) => ({
			host: pair.host,
			...pair.provider === void 0 ? {} : { provider: pair.provider },
			auth: "ssh",
			keyPath: pair.keyPath,
			source: "ssh"
		})),
		notes: []
	};
}
/**
* Report the sources in {@link SCAN_SOURCES} order, whatever order they were read in.
* @param readings - one reading per source id.
* @returns one status per source id, in the shared constant's order.
*/
function buildSourceStatuses(readings) {
	return SCAN_SOURCES.map((id) => ({
		id,
		available: readings[id].available,
		supported: readings[id].supported
	}));
}
/**
* Scan this machine's existing Git authorizations.
*
* The sources are read one after another in a fixed order so the result is
* deterministic and a slow helper cannot reorder findings: environment
* variables, `~/.git-credentials`, the `gh` CLI, the Windows Credential
* Manager, then the SSH configuration's key/host pairs. A source that is absent
* on this machine contributes no candidates and is reported unavailable; a
* source that cannot apply to this platform (the Credential Manager off Windows)
* is also reported unsupported. Nothing here verifies a token or a key, throws
* on a missing helper, or writes to disk.
* @param environment - platform, home directory, environment, and optional runner.
* @returns every candidate found, all five source statuses, and the caveats.
*/
async function scanAuthorizations(environment) {
	const runCommand = environment.runCommand ?? runCommandWithExecFile;
	const environmentCandidates = collectEnvironmentCandidates(environment.environment);
	const gitCredentials = await readGitCredentials(environment.homeDirectory);
	const ghCli = await readGhCli(runCommand);
	const credentialManager = await readCredentialManager(environment.platform, runCommand);
	const sshKeys = await readSshKeys(environment.homeDirectory);
	const sshNotes = await collectSshNotes(environment.homeDirectory);
	const readings = {
		environment: {
			available: environmentCandidates.length > 0,
			supported: true,
			candidates: environmentCandidates,
			notes: []
		},
		"git-credentials": gitCredentials,
		"gh-cli": ghCli,
		"credential-manager": credentialManager,
		ssh: sshKeys
	};
	return {
		candidates: dedupeCandidates([
			...environmentCandidates,
			...gitCredentials.candidates,
			...ghCli.candidates,
			...credentialManager.candidates,
			...sshKeys.candidates
		]),
		sources: buildSourceStatuses(readings),
		notes: [...credentialManager.notes, ...sshNotes]
	};
}
//#endregion
//#region src/git-accounts/accounts.ts
/**
* The Git-accounts capability, Host half: credentials, identity, projects, and
* the adoption of authorizations this machine already holds.
*
* Accounts are stored as credential records through the Harness credential
* seam, not in a file of this plugin's own: the seam owns where a secret is
* written and how it is protected (the local provider writes `0600` and layers
* environment overrides), and a record's payload is opaque to every other
* plugin. Each account is one record under the `worktree` scope, whose payload
* is this module's own JSON; {@link parseStoredAccount} validates it on every
* read because the record crosses disk.
*
* Nothing here returns a token. The wire types carry account summaries,
* projects, identity, and scan outcomes only, so a route, a component, or a
* log line cannot expose a secret by accident.
*
* A provider request that the remote refuses becomes a {@link GitAccountsError}
* with a code the page can explain; an HTTP failure's message is already
* sanitized by the HTTP edge, which strips the query string a Gitee token rides
* in.
* @module @guowenzhang/dsh-worktree/git-accounts/accounts
*/
/** Credential-record scope: the owning plugin's registered name. */
const ACCOUNT_SCOPE = "worktree";
/** The credential-record id grammar, as the credential seam defines it. */
const ACCOUNT_ID_PATTERN = /^[a-z][a-z0-9-]*$/u;
/** Version tag of the payload this module writes; a record with another tag is not interpreted. */
const PAYLOAD_VERSION = 1;
/** Longest account token accepted; a form bound, not a protocol rule. */
const TOKEN_MAX_LENGTH = 1e3;
/** Shortest account token accepted; anything shorter cannot be a provider token. */
const TOKEN_MIN_LENGTH = 4;
/** Whitespace never belongs inside a token that was pasted as one value. */
const TOKEN_WHITESPACE = /\s/u;
/** Environment variables the scan reads as tokens; each belongs to the host its source implies. */
const ENVIRONMENT_TOKEN_VARIABLES = [
	"GH_TOKEN",
	"GITHUB_TOKEN",
	"GITLAB_TOKEN",
	"GITLAB_PRIVATE_TOKEN",
	"GITEE_TOKEN",
	"GITEE_ACCESS_TOKEN"
];
/** The Windows credential manager is the one platform-specific source. */
const WINDOWS_PLATFORM = "win32";
/** One capability failure with the code and HTTP status the route reports. */
var GitAccountsError = class extends Error {
	code;
	/**
	* @param code - machine-readable failure class.
	* @param message - actionable text for the page.
	*/
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "GitAccountsError";
	}
};
/**
* The HTTP status a route answers for one failure class.
* @param code - the failure class.
* @returns the status to answer with.
*/
function statusForAccountsError(code) {
	switch (code) {
		case "invalid_input":
		case "ssh_no_api":
		case "scan_unsupported": return 400;
		case "unauthorized": return 401;
		case "forbidden": return 403;
		case "not_found":
		case "account_not_found": return 404;
		case "rate_limited": return 429;
		case "credentials_unavailable": return 503;
		case "network":
		case "provider_unavailable": return 502;
		case "git_missing":
		case "git_failed": return 500;
	}
}
/**
* The capability over one Host deployment.
*
* Every read of the credential provider and of the process environment happens
* per call, so a replaced provider or a changed environment reaches the next
* operation without rebuilding this object.
*/
var GitAccountsService = class {
	options;
	/**
	* @param options - the credential provider accessor, the scan implementation, and test seams.
	*/
	constructor(options) {
		this.options = options;
	}
	/**
	* Read the page's whole first state: accounts, identity, and what a scan would read.
	* @returns the snapshot.
	* @throws {GitAccountsError} when the deployment has no credential provider.
	*/
	async snapshot() {
		return {
			accounts: (await this.listStored()).map((entry) => summaryOf(entry)),
			identity: await readGitIdentity(this.gitCwd(), this.options.git?.environment),
			sources: this.describeSources(),
			platform: this.platform()
		};
	}
	/**
	* Verify one credential and store it as an account.
	*
	* A token account is verified through the host's REST API; an SSH account is
	* verified by one non-interactive `ssh -T`, and its private key stays where it
	* is — only the path is stored. `auth` defaults to `token`, and a request that
	* names `keyPath` without `auth` is an SSH account.
	*
	* An SSH account is still stored when the probe fails because the host is
	* **unreachable**: the key path is what Git needs later, and a network outage
	* is not evidence the key is wrong. Such a row is marked unverified and its
	* login is the key's file name until a later verified add replaces it. A
	* refused key (`unauthorized`), unusable input, or a refused token still fails,
	* so a credential the host actively rejects is never stored as valid.
	* @param input - host family, host, and either a token or a private key path; `origin` is set by the caller that knows the provenance.
	* @returns the accepted account and whether it is new.
	* @throws {GitAccountsError} when the input is invalid or the host refuses the credential.
	*/
	async add(input) {
		const credentials = this.requireCredentials();
		const provider = parseProvider(input.provider);
		const host = parseHost(provider, input.host);
		const auth = parseAuthMethod(input);
		const secret = auth === "ssh" ? parseKeyPath(input.keyPath) : parseToken(input.token);
		let verified;
		let isVerified = true;
		try {
			verified = await this.verifyCredential(provider, host, auth, secret);
		} catch (error) {
			if (auth !== "ssh" || !(error instanceof GitAccountsError) || error.code !== "network") throw error;
			verified = {
				provider,
				profile: { login: loginForUnverifiedKey(secret) },
				secret
			};
			isVerified = false;
		}
		const accountProvider = verified.provider;
		const existing = (await this.listStored()).find((entry) => sameCredential(entry.account, {
			provider: accountProvider,
			host,
			auth,
			login: verified.profile.login,
			secret: verified.secret
		}));
		if (!isVerified && existing !== void 0 && existing.account.verified !== false) return {
			account: summaryOf(existing),
			created: false
		};
		const id = existing?.id ?? createAccountId(accountProvider);
		const account = {
			version: PAYLOAD_VERSION,
			provider: accountProvider,
			host,
			auth,
			...auth === "ssh" ? { keyPath: verified.secret } : { token: verified.secret },
			login: verified.profile.login,
			...optional("name", verified.profile.name),
			...optional("email", verified.profile.email),
			...optional("profileUrl", verified.profile.profileUrl),
			...optional("scopes", verified.profile.scopes),
			addedAt: (/* @__PURE__ */ new Date()).toISOString(),
			verified: isVerified,
			origin: input.origin ?? "manual"
		};
		await this.writeStored(credentials, id, account);
		return {
			account: summaryOf({
				id,
				account
			}),
			created: existing === void 0
		};
	}
	/**
	* Test one credential against its host without storing anything.
	* @param input - host family, host, and either a token or a private key path.
	* @returns the login and profile facts the host reported.
	* @throws {GitAccountsError} when the input is invalid or the host refuses the credential.
	*/
	async verifyAccount(input) {
		const provider = parseProvider(input.provider);
		const host = parseHost(provider, input.host);
		const auth = parseAuthMethod(input);
		const secret = auth === "ssh" ? parseKeyPath(input.keyPath) : parseToken(input.token);
		const verified = await this.verifyCredential(provider, host, auth, secret);
		return {
			provider: verified.provider,
			auth,
			login: verified.profile.login,
			...optional("name", verified.profile.name),
			...optional("email", verified.profile.email),
			...optional("profileUrl", verified.profile.profileUrl),
			...optional("scopes", verified.profile.scopes),
			...optional("endpoint", verified.endpoint)
		};
	}
	/**
	* Read the SSH private keys this machine offers, for the add dialog's picker.
	* @returns the key paths and names; an absent `~/.ssh` answers an empty list.
	* @throws {GitAccountsError} when the deployment has no credential provider.
	*/
	async listSshKeys() {
		this.requireCredentials();
		return { keys: await listSshKeys(this.homeDirectory()) };
	}
	/**
	* Forget one account's stored token.
	* @param id - the account's record id.
	* @returns a confirmation.
	* @throws {GitAccountsError} when no such account is stored.
	*/
	async remove(id) {
		const credentials = this.requireCredentials();
		const key = accountKey(id);
		if (await readStoredPayload(credentials, key) === void 0) throw new GitAccountsError("account_not_found", `no Git account ${JSON.stringify(id)} is stored`);
		await credentials.deleteRecord(key);
		return { removed: true };
	}
	/**
	* Read one page of one account's projects, newest activity first.
	*
	* Only a token account can list projects: an SSH key authorizes Git transport,
	* and the provider APIs this capability reads are not reachable with it. The
	* refusal names the remedy (add a token account) rather than failing silently.
	* @param accountId - the account whose token lists them.
	* @param page - one-based page number.
	* @returns that page.
	* @throws {GitAccountsError} when the account is unknown, is SSH-only, the input is invalid, or the host refuses.
	*/
	async projects(accountId, page) {
		const credentials = this.requireCredentials();
		if (!Number.isInteger(page) || page < 1 || page > 100) throw new GitAccountsError("invalid_input", "page must be an integer between 1 and 100");
		const entry = await this.readStored(credentials, accountId);
		if (entry.account.auth === "ssh" || entry.account.token === void 0) throw new GitAccountsError("ssh_no_api", "this account authenticates over SSH, which cannot list projects through the host API; add an access-token account to browse projects");
		const spec = providerSpec(entry.account.provider);
		try {
			const response = await fetchProviderJson(spec.projectsRequest(entry.account.host, entry.account.token, page));
			const listed = spec.parseProjects(response.body, response.headers);
			return {
				accountId,
				page,
				hasMore: listed.hasMore,
				projects: listed.projects.map((project) => ({
					...project,
					accountId,
					provider: entry.account.provider
				}))
			};
		} catch (error) {
			throw toAccountsError(error);
		}
	}
	/**
	* Scan this machine's existing authorizations and adopt everything that verifies.
	*
	* Every candidate is verified against its host before it becomes an account: a
	* stored password that is not a token, an expired token, an SSH key the host
	* refuses, and a credential for a host that no longer answers all stay out of
	* the list and are reported as skipped instead. An unknown host is probed with
	* each provider's API path, because a self-hosted instance's domain need not
	* carry its product's name.
	* @returns the report and the account list after adoption.
	* @throws {GitAccountsError} when the deployment has no credential provider.
	*/
	async scan() {
		const credentials = this.requireCredentials();
		const environment = this.scanEnvironment();
		const raw = await (this.options.scan ?? scanAuthorizations)(environment);
		const added = [];
		const updated = [];
		const skipped = [];
		let existing = await this.listStored();
		for (const candidate of raw.candidates) {
			const verdict = await this.verifyCandidate(candidate);
			if (verdict.kind === "unverified") {
				skipped.push({
					...candidate.provider === void 0 ? {} : { provider: candidate.provider },
					host: candidate.host,
					...candidate.login === void 0 ? {} : { login: candidate.login },
					...candidate.auth === void 0 ? {} : { auth: candidate.auth },
					source: candidate.source,
					outcome: "unverified",
					errorCode: verdict.errorCode
				});
				continue;
			}
			const verified = verdict.verified;
			const match = existing.find((entry) => sameCredential(entry.account, {
				provider: verified.provider,
				host: verified.host,
				auth: verified.auth,
				login: verified.profile.login,
				secret: verified.secret
			}));
			const id = match?.id ?? createAccountId(verified.provider);
			const account = {
				version: PAYLOAD_VERSION,
				provider: verified.provider,
				host: verified.host,
				auth: verified.auth,
				...verified.auth === "ssh" ? { keyPath: verified.secret } : { token: verified.secret },
				login: verified.profile.login,
				...optional("name", verified.profile.name),
				...optional("email", verified.profile.email),
				...optional("profileUrl", verified.profile.profileUrl),
				...optional("scopes", verified.profile.scopes),
				addedAt: (/* @__PURE__ */ new Date()).toISOString(),
				verified: true,
				origin: originForSource(candidate.source)
			};
			const duplicate = match !== void 0 && (verified.auth === "ssh" ? match.account.keyPath === verified.secret : match.account.token === verified.secret);
			if (!duplicate) await this.writeStored(credentials, id, account);
			const entry = {
				id,
				account
			};
			if (duplicate) {
				skipped.push({
					provider: verified.provider,
					host: verified.host,
					login: verified.profile.login,
					auth: verified.auth,
					source: candidate.source,
					outcome: "duplicate"
				});
				continue;
			}
			if (match === void 0) {
				added.push(summaryOf(entry));
				existing = [...existing, entry];
			} else {
				updated.push(summaryOf(entry));
				existing = existing.map((candidateEntry) => candidateEntry.id === id ? entry : candidateEntry);
			}
		}
		return {
			report: {
				sources: raw.sources,
				examined: raw.candidates.length,
				added,
				updated,
				skipped,
				notes: raw.notes
			},
			accounts: existing.map((entry) => summaryOf(entry))
		};
	}
	/**
	* Write the global Git identity.
	* @param input - the submitted name and email; an empty field clears that key.
	* @returns the identity as Git reports it after the write.
	* @throws {GitAccountsError} when the submission is invalid or Git cannot write.
	*/
	async saveIdentity(input) {
		try {
			return { identity: await writeGitIdentity(this.gitCwd(), input, this.options.git?.environment) };
		} catch (error) {
			if (error instanceof GitIdentityError) throw new GitAccountsError(error.code, error.message);
			throw error;
		}
	}
	/** Read every stored account, oldest first. @returns the entries. */
	async listStored() {
		const credentials = this.requireCredentials();
		const records = await credentials.listRecords();
		const entries = [];
		for (const record of records) {
			const [scope, id] = splitKey(record.key);
			if (scope !== ACCOUNT_SCOPE || id === void 0 || !ACCOUNT_ID_PATTERN.test(id)) continue;
			const stored = await readStoredPayload(credentials, record.key);
			if (stored === void 0) {
				this.options.warn?.(`dsh-worktree: ignored an unreadable Git account record ${JSON.stringify(record.key)}`);
				continue;
			}
			entries.push({
				id,
				account: stored
			});
		}
		return entries.sort((left, right) => left.account.addedAt === right.account.addedAt ? left.id.localeCompare(right.id) : left.account.addedAt.localeCompare(right.account.addedAt));
	}
	/**
	* Read one account by its record id.
	* @param credentials - the live provider.
	* @param id - the record id.
	* @returns the parsed payload.
	* @throws {GitAccountsError} when no readable record is stored under that id.
	*/
	async readStored(credentials, id) {
		const account = await readStoredPayload(credentials, accountKey(id));
		if (account === void 0) throw new GitAccountsError("account_not_found", `no Git account ${JSON.stringify(id)} is stored`);
		return {
			id,
			account
		};
	}
	/**
	* Write one account payload as a grant record.
	* @param credentials - the live provider.
	* @param id - the record id.
	* @param account - the payload.
	*/
	async writeStored(credentials, id, account) {
		const record = {
			kind: "grant",
			payload: account
		};
		await credentials.modifyRecord(accountKey(id), () => Promise.resolve(record));
	}
	/**
	* Verify one token against its host, mapping the host's failure into this capability's code.
	* @param provider - host family.
	* @param host - normalized host.
	* @param token - the token to verify.
	* @returns what the host reports about the account.
	* @throws {GitAccountsError} when the host refuses the token or the answer is unusable.
	*/
	async verify(provider, host, token) {
		const spec = providerSpec(provider);
		try {
			const response = await fetchProviderJson(spec.userRequest(host, token));
			return spec.parseProfile(response.body, response.headers);
		} catch (error) {
			throw toAccountsError(error);
		}
	}
	/**
	* Verify one private key with a non-interactive SSH probe.
	*
	* The banner also names the host family, so a self-hosted domain that the
	* inference could not place can still be recorded under the platform it really
	* serves; the caller's provider is the fallback when the banner's wording is
	* not recognizable.
	* @param provider - host family the caller believes, used for the probe's messages.
	* @param host - normalized host.
	* @param keyPath - private key path; its contents are never read.
	* @returns the verified provider, profile, path to store, and endpoint that answered.
	* @throws {GitAccountsError} when the key is unusable, refused, or the host is unreachable.
	*/
	async verifySshCredential(provider, host, keyPath) {
		const verify = this.options.verifySsh ?? verifySshKey;
		try {
			const result = await verify({
				provider,
				host,
				keyPath
			});
			return {
				provider: result.provider ?? provider,
				profile: result.profile,
				secret: keyPath,
				...result.endpoint === void 0 ? {} : { endpoint: result.endpoint }
			};
		} catch (error) {
			if (error instanceof SshVerificationError) throw new GitAccountsError(error.code, error.message);
			throw error;
		}
	}
	/**
	* Verify one credential by its method.
	* @param provider - host family the caller believes.
	* @param host - normalized host.
	* @param auth - token or SSH.
	* @param secret - the token, or the private key path.
	* @returns the verified credential.
	* @throws {GitAccountsError} when the host refuses the credential or cannot be reached.
	*/
	async verifyCredential(provider, host, auth, secret) {
		if (auth === "ssh") return await this.verifySshCredential(provider, host, secret);
		return {
			provider,
			profile: await this.verify(provider, host, secret),
			secret
		};
	}
	/**
	* Decide one scan candidate: which provider accepts its credential, or why none did.
	*
	* A token candidate whose source already names its provider — an environment
	* variable's host is fixed, and the credential manager's host went through the
	* same inference — is verified only against that provider: probing the others
	* would replace the host's real refusal (an expired token is `unauthorized`)
	* with a wrong URL's `not_found`. A token host the scan could not place is
	* probed with every provider, in a fixed order that starts with GitLab because
	* self-hosted instances are the common unknown-host case in this deployment.
	*
	* An SSH candidate is one probe against the host itself; the banner names the
	* host family, so no provider probing is needed (and probing several REST
	* paths would not verify a key anyway).
	* @param candidate - one scanned credential.
	* @returns the verified account or the failure class.
	*/
	async verifyCandidate(candidate) {
		if (candidate.auth === "ssh") {
			if (candidate.keyPath === void 0 || candidate.keyPath === "") return {
				kind: "unverified",
				errorCode: "invalid_input"
			};
			const guessed = candidate.provider ?? knownProviderForHost(candidate.host);
			try {
				const host = providerSpec(guessed ?? "gitlab").normalizeHost(candidate.host);
				const verified = await this.verifySshCredential(guessed ?? "gitlab", host, candidate.keyPath);
				return {
					kind: "resolved",
					verified: {
						provider: verified.provider,
						host,
						auth: "ssh",
						secret: verified.secret,
						profile: verified.profile
					}
				};
			} catch (error) {
				return {
					kind: "unverified",
					errorCode: error instanceof GitAccountsError ? error.code : "provider_unavailable"
				};
			}
		}
		if (candidate.token === void 0 || candidate.token === "") return {
			kind: "unverified",
			errorCode: "invalid_input"
		};
		if (candidate.provider !== void 0) try {
			const host = providerSpec(candidate.provider).normalizeHost(candidate.host);
			const profile = await this.verify(candidate.provider, host, candidate.token);
			return {
				kind: "resolved",
				verified: {
					provider: candidate.provider,
					host,
					auth: "token",
					secret: candidate.token,
					profile
				}
			};
		} catch (error) {
			return {
				kind: "unverified",
				errorCode: error instanceof GitAccountsError ? error.code : "provider_unavailable"
			};
		}
		const guessed = knownProviderForHost(candidate.host);
		const order = guessed === void 0 ? [
			"gitlab",
			"github",
			"gitee"
		] : [guessed, ...GIT_PROVIDERS.filter((provider) => provider !== guessed)];
		let lastCode = "provider_unavailable";
		for (const provider of order) try {
			const host = providerSpec(provider).normalizeHost(candidate.host);
			const profile = await this.verify(provider, host, candidate.token);
			return {
				kind: "resolved",
				verified: {
					provider,
					host,
					auth: "token",
					secret: candidate.token,
					profile
				}
			};
		} catch (error) {
			if (error instanceof GitAccountsError) {
				lastCode = error.code;
				if (error.code === "network") break;
				continue;
			}
			lastCode = "provider_unavailable";
		}
		return {
			kind: "unverified",
			errorCode: lastCode
		};
	}
	/**
	* The scan sources a snapshot can report without reading any of them.
	* @returns the fixed source list with availability for this machine.
	*/
	describeSources() {
		const platform = this.platform();
		const environment = this.processEnvironment();
		const ghAvailable = findExecutable("gh") !== void 0;
		const gitCredentials = existsSync(join(this.homeDirectory(), ".git-credentials"));
		const tokenInEnvironment = ENVIRONMENT_TOKEN_VARIABLES.some((name) => (environment[name] ?? "").trim() !== "");
		const sshDirectory = existsSync(join(this.homeDirectory(), ".ssh"));
		return [
			{
				id: "credential-manager",
				supported: platform === WINDOWS_PLATFORM,
				available: platform === WINDOWS_PLATFORM
			},
			{
				id: "git-credentials",
				supported: true,
				available: gitCredentials
			},
			{
				id: "gh-cli",
				supported: true,
				available: ghAvailable
			},
			{
				id: "environment",
				supported: true,
				available: tokenInEnvironment
			},
			{
				id: "ssh",
				supported: true,
				available: sshDirectory
			}
		];
	}
	/** @returns the credential provider or a failure naming the missing deployment service. */
	requireCredentials() {
		const credentials = this.options.credentials();
		if (credentials === void 0) throw new GitAccountsError("credentials_unavailable", "this deployment has no credential service, so Git accounts cannot be stored; add @deepseek-ai/dsh-credentials-local to the profile");
		return credentials;
	}
	/** @returns the environment a scan reads. */
	scanEnvironment() {
		return this.options.environment ?? {
			platform: process.platform,
			homeDirectory: homedir(),
			environment: process.env
		};
	}
	/** @returns the host platform a snapshot reports. */
	platform() {
		return this.options.environment?.platform ?? process.platform;
	}
	/** @returns the home directory whose per-user sources are described. */
	homeDirectory() {
		return this.options.environment?.homeDirectory ?? homedir();
	}
	/** @returns the process environment a snapshot describes. */
	processEnvironment() {
		return this.options.environment?.environment ?? process.env;
	}
	/** @returns the directory Git runs in. */
	gitCwd() {
		return this.options.git?.cwd ?? process.cwd();
	}
};
/**
* Read and validate one stored payload.
* @param credentials - the live provider.
* @param key - the record's full key.
* @returns the payload, or undefined when the record holds something this reader does not interpret.
*/
async function readStoredPayload(credentials, key) {
	let record;
	try {
		record = await credentials.readRecord(key);
	} catch {
		return;
	}
	if (record === void 0 || record.kind !== "grant") return void 0;
	return parseStoredAccount(record.payload);
}
/**
* Validate one stored payload across the file boundary.
* @param payload - the record's opaque payload.
* @returns the payload as this module wrote it, or undefined when it is not one.
*/
function parseStoredAccount(payload) {
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return void 0;
	const value = payload;
	if (value.version !== PAYLOAD_VERSION) return void 0;
	if (typeof value.provider !== "string" || !GIT_PROVIDERS.includes(value.provider)) return void 0;
	if (typeof value.host !== "string" || value.host === "") return void 0;
	const auth = value.auth === "ssh" ? "ssh" : "token";
	const token = value.token;
	const keyPath = value.keyPath;
	if (auth === "token" && (typeof token !== "string" || token === "")) return void 0;
	if (auth === "ssh" && (typeof keyPath !== "string" || keyPath === "")) return void 0;
	if (typeof value.login !== "string" || value.login === "") return void 0;
	if (typeof value.addedAt !== "string" || value.addedAt === "") return void 0;
	if (typeof value.origin !== "string" || !ACCOUNT_ORIGINS.includes(value.origin)) return void 0;
	return {
		version: PAYLOAD_VERSION,
		provider: value.provider,
		host: value.host,
		auth,
		...auth === "ssh" ? { keyPath } : { token },
		login: value.login,
		...optional("name", stringOrUndefined(value.name)),
		...optional("email", stringOrUndefined(value.email)),
		...optional("profileUrl", stringOrUndefined(value.profileUrl)),
		...optional("scopes", stringOrUndefined(value.scopes)),
		addedAt: value.addedAt,
		verified: value.verified !== false,
		origin: value.origin
	};
}
/**
* Build the wire summary of one stored account.
* @param entry - the stored name-origin payload with its id.
* @returns the summary the page renders.
*/
function summaryOf(entry) {
	return {
		id: entry.id,
		provider: entry.account.provider,
		host: entry.account.host,
		login: entry.account.login,
		auth: entry.account.auth,
		verified: entry.account.verified,
		...optional("name", entry.account.name),
		...optional("email", entry.account.email),
		...optional("profileUrl", entry.account.profileUrl),
		...optional("scopes", entry.account.scopes),
		addedAt: entry.account.addedAt,
		origin: entry.account.origin
	};
}
/**
* Whether a stored account is the same credential a host now reports.
*
* A token account is identified by its login (the host decides who the token
* is); an SSH account is identified by its key path, because a saved-while-
* unreachable row's login is only the key's file name until a probe succeeds.
* @param stored - the stored payload.
* @param credential - the provider, host, method, login, and secret to match.
* @returns true when provider, host, method, and the method's identity field agree.
*/
function sameCredential(stored, credential) {
	if (stored.auth !== credential.auth || stored.provider !== credential.provider || stored.host.toLowerCase() !== credential.host.toLowerCase()) return false;
	if (stored.auth === "ssh") return stored.keyPath === credential.secret;
	return stored.login.toLowerCase() === credential.login.toLowerCase();
}
/**
* Derive the placeholder login of an SSH account saved while the host was
* unreachable. The file name is the only stable identity on hand; a later
* verified add replaces it with the login the host names.
* @param keyPath - the private key path.
* @returns the key's file name, or `ssh` when the path has no name.
*/
function loginForUnverifiedKey(keyPath) {
	const name = keyPath.replaceAll("\\", "/").split("/").pop() ?? "";
	return name === "" ? "ssh" : name;
}
/**
* Validate the provider named by a request.
* @param value - the request's provider string.
* @returns the provider.
* @throws {GitAccountsError} when the value names no supported host family.
*/
function parseProvider(value) {
	if (!GIT_PROVIDERS.includes(value)) throw new GitAccountsError("invalid_input", `provider must be one of ${GIT_PROVIDERS.join(", ")}`);
	return value;
}
/**
* Normalize the host named by a request.
* @param provider - the host family.
* @param value - the request's host string.
* @returns the host as the provider API names it.
* @throws {GitAccountsError} when the host is not a host name.
*/
function parseHost(provider, value) {
	try {
		return providerSpec(provider).normalizeHost(value);
	} catch (error) {
		if (error instanceof ProviderDataError) throw new GitAccountsError("invalid_input", error.message);
		throw error;
	}
}
/**
* Validate a pasted token.
* @param value - the request's token.
* @returns the token without surrounding whitespace.
* @throws {GitAccountsError} when the value cannot be a provider token.
*/
function parseToken(value) {
	if (value === void 0) throw new GitAccountsError("invalid_input", "an access token is required for a token account");
	const token = value.trim();
	if (token.length < TOKEN_MIN_LENGTH || token.length > TOKEN_MAX_LENGTH || TOKEN_WHITESPACE.test(token)) throw new GitAccountsError("invalid_input", "token must be one pasted value with no whitespace inside");
	return token;
}
/**
* Decide how one add request authenticates.
*
* An explicit `auth` wins; without it, a request that carries a key path is an
* SSH account and everything else is a token account (the form's original and
* still the common case).
* @param input - the add request.
* @returns the authentication method.
* @throws {GitAccountsError} when the request names a method this capability does not speak.
*/
function parseAuthMethod(input) {
	if (input.auth !== void 0) {
		if (!GIT_AUTH_METHODS.includes(input.auth)) throw new GitAccountsError("invalid_input", `auth must be one of ${GIT_AUTH_METHODS.join(", ")}`);
		return input.auth;
	}
	return input.keyPath !== void 0 && input.token === void 0 ? "ssh" : "token";
}
/**
* Validate the private key path of an SSH add request.
*
* The path is not read here — the SSH probe resolves it — but a blank value is
* refused before any probe starts.
* @param value - the request's key path.
* @returns the path, trimmed.
* @throws {GitAccountsError} when no key path was supplied.
*/
function parseKeyPath(value) {
	const keyPath = value?.trim() ?? "";
	if (keyPath === "") throw new GitAccountsError("invalid_input", "an SSH private key path is required for an SSH account");
	return keyPath;
}
/**
* Map one scan source onto the account-origin vocabulary.
*
* The two vocabularies differ by one word: a scan calls the key ring `ssh`, while
* a stored account records that its credential came from an `ssh-key`.
* @param source - the scan source that found the candidate.
* @returns the origin to store.
*/
function originForSource(source) {
	return source === "ssh" ? "ssh-key" : source;
}
/**
* Build one credential key for an account id.
* @param id - the account's record id.
* @returns the branded key the credential seam accepts.
* @throws {GitAccountsError} when the id is outside the seam's key grammar.
*/
function accountKey(id) {
	if (!ACCOUNT_ID_PATTERN.test(id)) throw new GitAccountsError("account_not_found", `no Git account ${JSON.stringify(id)} is stored`);
	return `${ACCOUNT_SCOPE}/${id}`;
}
/**
* Split a credential key back into scope and id.
* @param key - the stored key.
* @returns the scope and the id segment, when the key has exactly two segments.
*/
function splitKey(key) {
	const separator = key.indexOf("/");
	if (separator < 0) return [key, void 0];
	return [key.slice(0, separator), key.slice(separator + 1)];
}
/**
* Generate one account record id.
* @param provider - the host family the id starts with, so a stored key is recognizable at a glance.
* @returns the id.
*/
function createAccountId(provider) {
	return `${provider}-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}
/**
* Map an HTTP or parser failure into this capability's code.
* @param error - the failure a provider call produced.
* @returns the capability failure.
*/
function toAccountsError(error) {
	if (error instanceof GitProviderHttpError) return new GitAccountsError(error.code === "bad_response" ? "provider_unavailable" : error.code, error.message);
	if (error instanceof ProviderDataError) return new GitAccountsError("provider_unavailable", error.message);
	return new GitAccountsError("network", error instanceof Error ? error.message : String(error));
}
/**
* Keep an optional field out of an object when it has no value, so a stored
* payload does not carry explicit `undefined`s that a JSON writer drops and a
* strict reader then reports as missing.
* @param key - the field name.
* @param value - the value, or undefined.
* @returns an object carrying the field only when it exists.
*/
function optional(key, value) {
	return value === void 0 ? {} : { [key]: value };
}
/**
* Read a payload field that must be a non-empty string when present.
* @param value - the raw field.
* @returns the string, or undefined when it is absent or not usable.
*/
function stringOrUndefined(value) {
	return typeof value === "string" && value !== "" ? value : void 0;
}
/**
* Find one executable on PATH.
*
* A snapshot describes the `gh` source without spawning it; this reachability
* check only ever tests file existence. A false negative simply leaves the
* source unmarked, and a scan still reads it.
* @param name - the executable name.
* @returns its path when one exists on PATH.
*/
function findExecutable(name) {
	const pathValue = process.env.PATH ?? "";
	const candidates = process.platform === WINDOWS_PLATFORM ? [
		name,
		`${name}.exe`,
		`${name}.cmd`,
		`${name}.bat`,
		`${name}.COM`
	] : [name];
	for (const directory of pathValue.split(delimiter)) {
		if (directory === "") continue;
		for (const candidate of candidates) {
			const path = join(directory, candidate);
			if (existsSync(path)) return path;
		}
	}
}
//#endregion
//#region src/git-accounts/route.ts
/** Route prefix both halves agree on. */
const ROUTE_PREFIX = "/worktree/git/api";
/** A request failure that carries the HTTP status this route answers with. */
var RouteError = class extends Error {
	status;
	/**
	* @param status - HTTP status to answer with.
	* @param message - user-facing reason.
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
* @throws {RouteError} when the body is not a JSON object.
*/
async function readJsonBody(req) {
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
	const text = Buffer.concat(chunks).toString("utf8").trim();
	if (text === "") return {};
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new RouteError(400, "request body is not valid JSON");
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new RouteError(400, "request body must be a JSON object");
	return parsed;
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
* Require one body field to be a string.
* @param value - the raw field.
* @param field - field name, for the diagnostic.
* @returns the string, empty allowed where the operation accepts a cleared value.
* @throws {RouteError} when the field is absent or not a string.
*/
function requireString(value, field) {
	if (typeof value !== "string") throw new RouteError(400, `${field} must be a string`);
	return value;
}
/**
* Require one body field to be a non-empty string.
* @param value - the raw field.
* @param field - field name, for the diagnostic.
* @returns the string.
* @throws {RouteError} when the field is absent or empty.
*/
function requireNonEmptyString(value, field) {
	const text = requireString(value, field);
	if (text.length === 0) throw new RouteError(400, `${field} must be a non-empty string`);
	return text;
}
/**
* Require one body field to be a positive page number.
* @param value - the raw field.
* @returns the page number.
* @throws {RouteError} when the field is not a positive integer.
*/
function requirePage(value) {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new RouteError(400, "page must be a positive integer");
	return value;
}
/**
* Register the Git-accounts route.
*
* Registration waits for `webServer` through `ctx.inject`, exactly like the
* worktree route, so activation order does not decide whether the page works.
* A deployment without a webserver simply has no HTTP surface for this
* capability; the plugin keeps its other surfaces.
* @param ctx - the Host plugin context.
* @param service - the Git-accounts capability.
*/
function registerGitAccountsRoute(ctx, service) {
	ctx.inject(["webServer"], (scope) => {
		scope.effect(() => scope.webServer.register({
			kind: "prefix",
			path: ROUTE_PREFIX,
			handler: async (req, res) => {
				let stage = "dispatch";
				try {
					if (req.method !== "POST") throw new RouteError(405, "method not allowed");
					const method = new URL(req.url ?? "/", "http://dsh.internal").pathname.slice(`${ROUTE_PREFIX}/`.length);
					stage = method;
					writeJson(res, 200, await dispatch(service, method, await readJsonBody(req)));
				} catch (error) {
					const status = error instanceof RouteError ? error.status : error instanceof GitAccountsError ? statusForAccountsError(error.code) : 500;
					const message = error instanceof Error ? error.message : String(error);
					const code = error instanceof GitAccountsError ? error.code : void 0;
					scope.logger?.error?.(`dsh-worktree: [${stage}] ${message}`);
					writeJson(res, status, { error: {
						message: `[${stage}] ${message}`,
						stage,
						...code === void 0 ? {} : { code }
					} });
				}
			}
		}), "dsh-worktree: /worktree/git/api route");
	});
}
/**
* Dispatch one route method.
* @param service - the Git-accounts capability.
* @param method - path below the route prefix.
* @param body - decoded request body.
* @returns the method's JSON result.
* @throws {RouteError} when the method is unknown.
*/
async function dispatch(service, method, body) {
	switch (method) {
		case "snapshot": return await service.snapshot();
		case "accounts.add": return await service.add({
			provider: requireNonEmptyString(body.provider, "provider"),
			host: requireNonEmptyString(body.host, "host"),
			...body.auth === void 0 ? {} : { auth: requireString(body.auth, "auth") },
			...body.token === void 0 ? {} : { token: requireString(body.token, "token") },
			...body.keyPath === void 0 ? {} : { keyPath: requireString(body.keyPath, "keyPath") },
			origin: "manual"
		});
		case "accounts.verify": return await service.verifyAccount({
			provider: requireNonEmptyString(body.provider, "provider"),
			host: requireNonEmptyString(body.host, "host"),
			...body.auth === void 0 ? {} : { auth: requireString(body.auth, "auth") },
			...body.token === void 0 ? {} : { token: requireString(body.token, "token") },
			...body.keyPath === void 0 ? {} : { keyPath: requireString(body.keyPath, "keyPath") }
		});
		case "accounts.remove": return await service.remove(requireNonEmptyString(body.id, "id"));
		case "accounts.scan": return await service.scan();
		case "ssh.keys": return await service.listSshKeys();
		case "projects.list": return await service.projects(requireNonEmptyString(body.accountId, "accountId"), requirePage(body.page));
		case "identity.set": return await service.saveIdentity({
			name: requireString(body.name, "name"),
			email: requireString(body.email, "email")
		});
		default: throw new RouteError(404, `unknown Git accounts API method ${JSON.stringify(method)}`);
	}
}
//#endregion
//#region src/index.ts
/**
* dsh-worktree — Git worktree isolation for DeepSeek Harness.
*
* Provides the `worktree` service and the browser route over it. The service is
* the seam: a Host consumer (the session-create path, or the GUI's new-session
* flow) creates a checkout through it and starts a session whose `meta.cwd` is
* the returned path, which is what makes the checkout a separate project with
* its own file sandbox and shell working directory.
*
* Checkout creation, listing, and removal are user actions: the browser half
* owns them, and the one cleanup that must follow from another surface —
* archiving a session — is wired to the Workspace registry's archive
* notification instead of being offered to the model (see
* {@link installArchiveCleanup}). The file guard is the exception: while it is
* on (the default) the model gets `worktree_backup`, which is how it declares
* the files a destructive command would touch (see {@link defineBackupTool}).
*
* The policy fields are `volatile`: the settings page edits them while the
* plugin runs, and the entry's document update is what re-installs them on the
* service. The fields that shape REGISTRATION — whether the route mounts, and
* whether archiving cleans up — stay ordinary config, because changing one has
* to re-run `apply` rather than reconfigure a running service.
* @module @guowenzhang/dsh-worktree
*/
/** Plugin name used by the loader. */
const name = "worktree";
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
	startSessionRoute: z.boolean(),
	removeOnSessionArchive: z.boolean().default(true),
	fileGuard: z.boolean().default(true).volatile(),
	denyDestructiveCommands: z.boolean().default(true).volatile(),
	newSessionWorktree: z.boolean().default(false).volatile(),
	backupSidebar: z.boolean().default(true).volatile()
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
* The deployment's file-protection policy.
*
* Only the directory is fixed at activation, because the user's home is a
* deployment fact rather than a per-session one. The shell policy is read from
* the live configuration, so a document update applies to the running guard.
* @param config - the plugin's resolved configuration.
* @returns the options the guard consumes.
*/
function guardOptions(config) {
	return {
		directory: join(homedir(), ...FILE_GUARD_DIRECTORY_SEGMENTS),
		denyDestructiveCommands: config.denyDestructiveCommands.get()
	};
}
/**
* Register the worktree service and the surfaces over it.
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
	const protection = config.fileGuard.get();
	const guard = protection ? installFileGuard(ctx, guardOptions(config)) : new FileGuard(guardOptions(config));
	if (protection) ctx.inject(["tools"], (scope) => {
		scope.effect(() => scope.tools.register(defineBackupTool(guard)), "dsh-worktree: declare files to protect");
	});
	installArchiveCleanup(ctx, service, guard, { removeCheckouts: config.removeOnSessionArchive ?? true });
	if (config.startSessionRoute ?? true) registerRoute(ctx, service, guard);
	registerGitAccountsRoute(ctx, new GitAccountsService({
		credentials: () => ctx.get("credentials"),
		warn: (message) => {
			ctx.logger?.warn?.(message);
		}
	}));
}
//#endregion
export { Config, SETTINGS_NAMESPACE, WorktreeService, apply, name };
