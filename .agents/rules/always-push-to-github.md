# Always Push Changes to GitHub

When working in this workspace, follow this strict invariant:
- **Always push changes**: Every time you successfully modify the codebase (e.g., fix a bug, add a feature, refactor code), you MUST automatically run the git commands to commit and push those changes to the remote repository.
- **Workflow**: Run `git add .`, `git commit -m "[Descriptive commit message]"`, and `git push` using the `run_command` tool before concluding your final response to the user.
- Do not wait for the user to explicitly ask you to push; it should be done automatically as part of completing any modifying task.
