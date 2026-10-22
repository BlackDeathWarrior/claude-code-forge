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

## Tests

- Behaviour is tested through public interfaces, at the seams the spec names.
- A test is written first and seen to fail for the right reason.
- Critical user flows have an end-to-end test that lives in the repository.
- A bug fix starts with the test that reproduces the bug.

## Hygiene

- No debug output, focused tests (`.only`), or commented-out code in a commit.
- A TODO names its ticket or its owner.
- Commits are small and conventional: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`.
- Documentation a user reads changes in the same commit as the behaviour it describes.

</standards-seed>
