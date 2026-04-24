---
name: User writes British English
description: User is British; all user-facing text, copy, comments, and documentation should use British English spelling and conventions, not American
type: user
originSessionId: b3e8cf55-4b99-492a-8686-3ecd102e7b51
---
The user is British. All prose written for this project — UI copy, notices, button labels, error messages, documentation, commit messages — must use British English spelling and conventions.

Examples: unauthorised (not unauthorized), colour, behaviour, organisation, centre, licence (noun) / license (verb), programme (not program, except software programs), whilst, optimise, customise, analyse, catalogue, dialogue, defence, cheque, grey (not gray), tyre, kerb.

Treat American-spelling spellcheck flags in source files as false positives — do not "correct" British spellings to American. Code identifiers (CSS class names, variable names) stay in their existing form even if American (e.g. `color` in CSS is a keyword, not prose).
