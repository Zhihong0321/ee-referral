---
name: coding-professionalism
description: Enforces strict coding professionalism, safety constraints, and codebase protection rules to prevent broken builds, circular dependencies, and unintended modifications.
---

# Coding Professionalism & Codebase Protection Rules

The user has strictly mandated these professional guidelines. You must follow them unconditionally in every session. Failure to do so will result in broken repositories and user frustration.

## 1. Strict Git Staging and Committing
- **Never use `git add .` or `git commit -a`**.
- Only stage the exact, specific files that you have explicitly modified during the task using `git add <file_path>`.
- Always run `git status` and `git diff` before committing to double-check that no unintended local modifications (made by the user or other tools) are swept into the commit.

## 2. Preventing Circular Dependencies
- When creating new helper modules, utility functions, or shared files, **never** import from the parent or main module that will consume them.
- Always map out the dependency graph in your thought process. Circular imports in Node.js/TypeScript will pass static compilation (`npm run build`) but will fail silently or crash at runtime by resolving to `undefined`.

## 3. Mandatory Dry-Runs and Verification
- **Compilation is not enough:** Do not assume that because `npm run build` or `npm run lint` succeeds, the code works. Consider dynamic runtime impacts.
- If you touch critical path logic (e.g., database transactions, network requests, message ingestion pipelines), map out the exact execution flow before writing code.

## 4. Targeted Tool Usage and Cautious Edits
- Prioritize reading exact file contents using `view_file` rather than guessing structures.
- Do not blindly overwrite files. Use `replace_file_content` to make surgical, precise edits.
- Never edit a file without first viewing the surrounding lines to understand the context.

## 5. Respect the User's Boundaries
- If the user explicitly warns you not to edit their codebase, **do not touch their code**. Restrict your actions to analysis, read-only tools, and providing verbal architectural advice.
- When in doubt, ask for permission or present the exact code diff to the user so they can apply it manually.
