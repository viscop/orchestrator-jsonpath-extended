# Tests

These tests are optional and are not required to use JSONPath Extended in VCF
Operations Orchestrator (VCF Orchestrator) or VMware Aria Automation
Orchestrator 8.x (Aria Orchestrator). Both product generations use the same
Scriptable Action body documented by this repository.

The Action itself has no Node.js dependency. The local runner only uses
Node.js so developers can execute the same JSONPath cases quickly from VS Code
or a terminal.

## Run locally

From the repository root:

```powershell
node tests/run-tests.js
```

The runner loads `jsonPath.js` or `jsonPath`, wraps it like an Orchestrator Action,
and executes every JSON document in `tests/cases`. Historical regression cases
run explicitly in `GOESSNER_EXTENDED` mode; cases with
`"useDefaultMode": true` verify the public `RFC9535` default. Dedicated cases
also cover the `RFC9535_EXTENDED` operators and their rejection in strict mode.

## Run the RFC 9535 compliance suite

Install the pinned upstream suite and run it:

```powershell
node tests/setup-compliance-suite.js
node tests/run-compliance-tests.js
```

The setup script downloads revision
`7be7c1fc28057c91e8eefaf197060fba7ed43acd`, verifies SHA-256 checksums, and
installs both `cts.json` and its BSD-2 license into the ignored
`tests/jsonpath-compliance-test-suite` directory.

The runner checks `VALUE`, normalized `PATH`, every permitted non-deterministic
result order, and all invalid-selector cases. A suite in another location can
be supplied as the first argument or through `JSONPATH_CTS_PATH`:

```powershell
node tests/run-compliance-tests.js C:\path\to\cts.json
```

## Regenerate Unicode category data

The Action embeds delta-encoded Unicode 16.0 general-category ranges so its
RFC 9485 I-Regexp implementation remains ES5-compatible and dependency-free at
runtime. With a Node.js release that uses Unicode 16.0, regenerate the table
entries with:

```powershell
node tests/generate-unicode-category-data.js
```

The script writes the properties for `RFC_UNICODE_CATEGORY_DATA` to standard
output. It fails on a different Unicode version so category updates remain an
explicit change.

## Run from VS Code

Use the included task:

```text
Terminal -> Run Task -> Run JSONPath Tests
```

## Test case format

Each test case is a plain JSON document:

```json
{
  "name": "select all book authors",
  "fixture": "goessner-store-extended.json",
  "expr": "$.store.book[*].author",
  "expected": [
    "Nigel Rees",
    "Evelyn Waugh",
    "Herman Melville",
    "J. R. R. Tolkien"
  ]
}
```

The optional `arg` property configures the Action, for example:

```json
{
  "arg": {
    "resultType": "PATH"
  }
}
```

Historical JavaScript expression evaluation is opt-in:

```json
{
  "arg": {
    "mode": "GOESSNER_EXTENDED",
    "allowUnsafeEval": true
  }
}
```

Only use this compatibility mode with trusted expressions.
It is intended for existing expressions that rely on JavaScript Array methods
such as `.some()`, `.every()`, `.map()`, or `.indexOf()`. Safe regular-expression
filters should use the RFC `match()` and `search()` functions in every mode;
JavaScript regex literals and `.test(...)` require `allowUnsafeEval: true`.
The safe parser supports all five RFC functions (`length`, `count`, `match`,
`search`, and `value`) in every mode.

An expression that must be rejected can assert part of its error message:

```json
{
  "name": "reject an arbitrary function call",
  "obj": {
    "items": []
  },
  "expr": "$.items[?(System.getModule('unsafe'))]",
  "expectedError": "Unsafe or unsupported identifier 'System'"
}
```

A case normally references a document from `tests/fixtures`. It may instead
provide an inline `obj` value when a small, case-specific input is clearer.

## Gössner Extended nested filter cases

Nested filter queries are tested as existence expressions:

```text
$.stores[?(@.book[?(@.price > 10)])]
```

An all-style condition is represented by a non-empty existence check and the
absence of a counterexample:

```text
$.stores[?(
  @.book[?(@)] &&
  !@.book[?(@.price <= 10)]
)]
```

Keep separate cases for the positive existence query, its negation, the
non-empty all-style condition, and empty child collections. Nested `@`
identifiers must also be tested at more than one level because every inner
filter rebinds the current node.

RFC-mode regressions should set `"useDefaultMode": true` and use RFC query
syntax. A valid query without matches must expect `[]`; an invalid selector
must use `expectedError`.

## Adding a regression case

1. Add a numbered JSON file to `tests/cases`.
2. Set `fixture` or `obj`, the JSONPath `expr`, and the exact `expected` value.
3. Run `node tests/run-tests.js`.
4. Confirm that the new case fails before a bug fix and passes afterward.

The numbered file names keep execution deterministic and make failures easy to
locate.

## Orchestrator usage

The fixtures and cases are deliberately plain JSON. VCF Operations
Orchestrator and Aria Automation Orchestrator developers can copy the input
object, expression, options, and expected value into a Scriptable Task or test
workflow and call the `jsonPath` Action directly. VCF Automation consumes the
same Action through its Orchestrator integration; it does not execute this
source as an ABX action.
