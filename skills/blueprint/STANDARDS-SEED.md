# Coding standards seed

A starting point for a repository that has no coding standards document. The final review's Standards axis checks the diff against whatever the repository documents, and implementers read it before building, so a short, true standards file is one of the cheapest quality levers a project has.

Put each line to the user as a default they can keep, change or strike. Keep only what this project will actually hold itself to: a rule nobody enforces teaches agents that the file is decoration. Write the result as `CODING_STANDARDS.md` in the first task.

<standards-seed>

# Coding standards

## Structure

- A file has one responsibility. Around 200 to 400 lines is typical; past 800, split it.
- A function does one thing, in under about 50 lines, nested at most four levels.
- Organise by feature or domain, with the files that change together living together.
- Reuse what exists before adding a new helper, component or dependency.

## Correctness

- Validate input where it enters the system (request, file, environment, webhook, model output) and trust it inside.
- Handle every error where something can be done about it; elsewhere let it surface with its context. An error message names the bad input and what to do next.
- Prefer returning new values to mutating shared ones.
- Name constants; a bare number or string that carries meaning gets a name.

## Security

- Secrets come from the environment. Fail at startup when one is missing.
- Queries take their values as parameters.
- Escape output in the context it is rendered in.
- Authorisation is checked on the server for every route and action.
- Logs and error responses carry no secrets, tokens or personal data.
- State-changing endpoints are protected against cross-site requests, and public endpoints are rate limited.
- A replay or dedup record lives as long as the request stays valid, which is the signature's whole tolerance window on both sides of the timestamp, not just the part after it.
- An idempotency key is released when the work fails for a reason a retry could fix, and kept only when the rejection is final. A key written before the work and kept after a server error turns the sender's retry into a conflict with nothing done.

## Tests

- Behaviour is tested through public interfaces, at the seams the spec names.
- A test is written first and seen to fail for the right reason.
- Critical user flows have an end-to-end test that lives in the repository.
- A bug fix starts with the test that reproduces the bug.
- After adding a package or directory, check that git sees it (`git ls-files`, `git check-ignore -v`). A name that matches an ignore rule is left untracked without a word, and the tests pass on the machine that has it.

## Hygiene

- No debug output, focused tests (`.only`), or commented-out code in a commit.
- A TODO names its ticket or its owner.
- Commits are small and conventional: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`.
- Documentation a user reads changes in the same commit as the behaviour it describes.

</standards-seed>
