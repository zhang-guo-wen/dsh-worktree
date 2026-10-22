import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import z from "@deepseek-ai/schemastery";
import { appendFile, copyFile, lstat, mkdir, open, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
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
/** Parse optional top-level names selected for an initial commit. */
function selectedEntries(value) {
	if (value === void 0) return void 0;
	if (!Array.isArray(value) || !value.every((name) => typeof name === "string" && name.length > 0)) throw new RouteError(400, "selectedEntries must be an array of top-level names");
	return value;
}
/**
* The working directory one session runs in.
*
* Read from the Host's session store, never from the request: a backup's
* relative path is only meaningful against the directory the session actually
* had, and a caller-supplied one could point a restore at another file with the
* same tail. A session this host does not know has no directory to restore
* into, and says so instead of guessing.
* @param ctx - the scope the route handler runs in.
* @param sessionId - the session named by the request.
* @returns the absolute working directory.
* @throws {RouteError} when the session is not in this host's session store.
*/
function sessionWorkspace(ctx, sessionId) {
	const cwd = ctx.get("sessions")?.get(SessionId(sessionId))?.header.cwd;
	if (cwd === void 0) throw new RouteError(404, `session ${JSON.stringify(sessionId)} is not known to this host, so its working directory is unknown`);
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
* The session store is read with `ctx.get` instead: it is only needed by the
* two backup methods, so a deployment without it keeps every other method
* working, and a request that needs it says so.
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
					if (req.method !== "POST") throw new RouteError(405, "method not allowed");
					const method = new URL(req.url ?? "/", "http://dsh.internal").pathname.slice(14);
					const body = await readJsonBody(req);
					if (method === "check") {
						stage = "git";
						writeJson(res, 200, { version: (await runGit(process.cwd(), ["--version"])).trim() });
						return;
					}
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
					if (method === "init-files") {
						stage = "init-files";
						const workspaceId = requireString(body.workspaceId, "workspaceId");
						const workspace = scope.workspaceRegistry.get(WorkspaceId(workspaceId));
						if (workspace === void 0) throw new RouteError(404, "workspace not found");
						writeJson(res, 200, { entries: await service.initialCommitEntries(workspace.path) });
						return;
					}
					if (method === "init") {
						stage = "init";
						const workspaceId = requireString(body.workspaceId, "workspaceId");
						const workspace = scope.workspaceRegistry.get(WorkspaceId(workspaceId));
						if (workspace === void 0) throw new RouteError(404, "workspace not found");
						if (await isGitWorkTree(workspace.path)) throw new RouteError(409, "workspace is already a Git repository");
						await service.initialize(workspace.path, selectedEntries(body.selectedEntries));
						writeJson(res, 200, {
							initialized: true,
							path: workspace.path
						});
						return;
					}
					if (method === "branches") {
						stage = "branches";
						writeJson(res, 200, { branches: await service.listBranches(requireString(body.cwd, "cwd")) });
						return;
					}
					if (method === "checkout") {
						stage = "checkout";
						writeJson(res, 200, probeArchiveOutcome(requireString(body.path, "path")));
						return;
					}
					if (method === "backups") {
						stage = "backups";
						const sessionId = requireString(body.sessionId, "sessionId");
						writeJson(res, 200, { entries: await guard.list(sessionId, sessionWorkspace(scope, sessionId)) });
						return;
					}
					if (method === "restore") {
						stage = "restore";
						const sessionId = requireString(body.sessionId, "sessionId");
						const relative = requireString(body.relative, "relative");
						writeJson(res, 200, await guard.restore(sessionId, sessionWorkspace(scope, sessionId), relative));
						return;
					}
					if (method === "compare") {
						stage = "compare";
						const sessionId = requireString(body.sessionId, "sessionId");
						const relative = requireString(body.relative, "relative");
						writeJson(res, 200, await guard.compare(sessionId, sessionWorkspace(scope, sessionId), relative));
						return;
					}
					throw new RouteError(404, `unknown worktree API method ${JSON.stringify(method)}`);
				} catch (error) {
					const status = error instanceof RouteError ? error.status : error instanceof InvalidInitialSelectionError ? 409 : error instanceof NoSuchBackupError ? 404 : 500;
					const detail = error instanceof Error ? error.message : String(error);
					const message = `[${stage}] ${detail}`;
					scope.logger?.error?.(`dsh-worktree: ${message}`);
					const code = error instanceof GitCommandError ? error.code : void 0;
					writeJson(res, status, { error: {
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
}
//#endregion
export { Config, SETTINGS_NAMESPACE, WorktreeService, apply, name };
