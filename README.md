# JSONPath Extended for Aria and VCF Orchestrator

A dependency-free RFC 9535 JSONPath Action for VMware Aria Automation
Orchestrator 8.x and VCF Operations Orchestrator 9.x, based on Stefan
Goessner's lightweight JSONPath implementation.

> **Compatibility:** VMware Aria Automation Orchestrator 8.x—commonly shortened
> to **Aria Orchestrator**—remains a supported target. The VCF Operations
> Orchestrator name does not imply that an upgrade to VCF 9 is required.

The Action implements RFC 9535 by default and keeps the historical extended
Goessner behavior available as an explicit compatibility mode:

- RFC 9535 selectors, filters, standard functions, and normalized paths
- strict syntax validation and empty nodelists for queries without matches
- an `RFC9535_EXTENDED` mode adding the self-filter and parent operator
- a `GOESSNER_EXTENDED` compatibility mode with the historical project behavior
- value or normalized-path results

The implementation is intentionally delivered as one self-contained Action so
it can be copied, versioned, and reused without additional Action dependencies.

The historical basis is Stefan Goessner's JSONPath 0.9.0 implementation from 2007. The `^` parent operator follows the operator introduced by
[JSONPath Plus](https://github.com/JSONPath-Plus/JSONPath), while the
`??(...)` self-filter is an extension specific to this repository. JSONPath
Plus is not a runtime dependency.

## Why this exists

Orchestrator inventories, configuration data, API responses, and workflow
inputs often contain deeply nested object structures. This Action provides a
declarative way to traverse and select from those structures without writing
one-off chains of loops and property checks in every workflow or Action.

## Platform scope and naming

The direct runtime of this code is **VCF Operations Orchestrator** (often
shortened to **VCF Orchestrator**). Broadcom documentation also identifies it
as the successor to VMware Aria Automation Orchestrator. The source is an
Orchestrator Scriptable Action body; it is not an ABX action or another native
VCF Automation scripting format.

VCF Automation can consume the Action indirectly through an integrated or
embedded Orchestrator—for example from workflows, extensibility subscriptions,
or custom-form external values. Therefore, references to VCF Automation in
this documentation describe an integration context, not a separate execution
target.

| Product name                                                | Relationship to this Action                           |
| ----------------------------------------------------------- | ----------------------------------------------------- |
| VCF Operations Orchestrator 9.x / VCF Orchestrator          | Current primary runtime                               |
| VMware Aria Automation Orchestrator 8.x (Aria Orchestrator) | Previous product name and supported runtime family    |
| vRealize Orchestrator (vRO)                                 | Historical product name                               |
| VCF Automation                                              | Optional consumer through an Orchestrator integration |

See Broadcom's documentation for the current
[VCF Operations Orchestrator 9 naming](https://knowledge.broadcom.com/external/article/407504)
and VMware's example of a
[VCF Orchestrator Action used by VCF Automation](https://blogs.vmware.com/cloud-foundation/2024/10/11/good-practices-for-developing-custom-forms-with-vmware-cloud-foundation-automation/).

## Related articles

### Beyond JSONPath: Declarative Object Graph Queries in VCF/Aria Orchestrator

For the motivation behind this project and a practical introduction to
declarative object graph queries in VCF/Aria Orchestrator, see:

[Beyond JSONPath: Declarative Object Graph Queries in VCF/Aria Orchestrator](https://www.visualdomain.ch/?p=227)

The article compares imperative traversal with standard RFC 9535 queries and
shows how the `^` parent operator and `??(...)` self-filter can be combined for
bottom-up traversal of deeply nested object structures.

## Table of contents

- [Why this exists](#why-this-exists)
- [Platform scope and naming](#platform-scope-and-naming)
- [Related articles](#related-articles)
- [Usage in VCF Operations Orchestrator](#usage-in-vcf-operations-orchestrator)
- [Quick start](#quick-start)
- [Compatibility modes](#compatibility-modes)
- [Supported syntax](#supported-syntax)
- [Standard JSONPath examples](#standard-jsonpath-examples)
- [Nested filters](#nested-filters)
- [Filter level and result identity](#filter-level-and-result-identity)
- [Self-filter](#self-filter)
- [Parent operator](#parent-operator)
- [Result types](#result-types)
- [Complete workflow example](#complete-workflow-example)
- [Developer notes](#developer-notes)
- [Design choice: single Action](#design-choice-single-action)
- [Testing](#testing)
- [Security](#security)
- [License](#license)

## Usage in VCF Operations Orchestrator

Create a Scriptable Action named `jsonPath` and paste the complete contents of
`jsonPath.js` into its scripting area. The same procedure applies to VMware
Aria Automation Orchestrator 8.x.

Configure these inputs:

| Name   | Suggested type        | Description                                |
| ------ | --------------------- | ------------------------------------------ |
| `obj`  | `Any`                 | JSON-compatible object or array to search. |
| `expr` | `string`              | JSONPath expression.                       |
| `arg`  | `Properties` or `Any` | Optional settings object.                  |

Suggested return type: `Any`.

The return value is a nodelist represented as an array. In the default
`RFC9535` and `RFC9535_EXTENDED` modes return `[]` for no match and raise a
`SyntaxError` for invalid syntax. `GOESSNER_EXTENDED` preserves the historical
project behavior, including `false` for no match.

`arg` currently supports:

| Option            | Values                                                   | Default     | Description                                                                                  |
| ----------------- | -------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| `mode`            | `"RFC9535"`, `"RFC9535_EXTENDED"`, `"GOESSNER_EXTENDED"` | `"RFC9535"` | Select the query dialect and compatibility behavior.                                         |
| `resultType`      | `"VALUE"`, `"PATH"`                                      | `"VALUE"`   | Return matched values or normalized paths.                                                   |
| `allowUnsafeEval` | `true`, `false`                                          | `false`     | Enable JavaScript expression evaluation for trusted expressions in `GOESSNER_EXTENDED` mode. |

Option values are case-sensitive.

## Quick start

Given this input:

```javascript
var store = {
  store: {
    book: [
      {
        author: "Nigel Rees",
        title: "Sayings of the Century",
        price: 8.95,
      },
      {
        author: "Herman Melville",
        title: "Moby Dick",
        price: 8.99,
      },
    ],
  },
};
```

Call the Action from a workflow:

```javascript
var titles = System.getModule("com.example.jsonpath").jsonPath(
  store,
  "$.store.book[*].title",
  { resultType: "VALUE" },
);
```

Result:

```json
["Sayings of the Century", "Moby Dick"]
```

## Compatibility modes

`RFC9535` is the public default. It returns an empty nodelist for no match and
raises `SyntaxError` for malformed queries:

```javascript
jsonPath(payload, "$.items[?@.enabled]");
```

Existing installations can opt into the historical contract per call:

```javascript
jsonPath(payload, "$.items[?(@.enabled)]", {
  mode: "GOESSNER_EXTENDED",
});
```

Applications that want RFC semantics together with the extended
self-filter and parent operator can use:

```javascript
jsonPath(payload, "$.items[*][??(@.enabled)]^", {
  mode: "RFC9535_EXTENDED",
});
```

### Mode differences

| Behavior or feature                                         | `RFC9535`     | `RFC9535_EXTENDED` | `GOESSNER_EXTENDED`                            |
| ----------------------------------------------------------- | ------------- | ------------------ | ---------------------------------------------- |
| Parser and comparison semantics                             | RFC 9535      | RFC 9535           | Historical extended Gössner implementation     |
| No match                                                    | `[]`          | `[]`               | `false`                                        |
| Invalid syntax                                              | `SyntaxError` | `SyntaxError`      | Historical permissive behavior or parser error |
| RFC functions `length`, `count`, `match`, `search`, `value` | Yes           | Yes                | Yes                                            |
| Self-filter `??(...)`                                       | No            | Yes                | Yes                                            |
| Parent operator `^`                                         | No            | Yes                | Yes                                            |
| Negative array index `[-1]`                                 | Yes           | Yes                | Yes                                            |
| Computed index `[(@.length-1)]`                             | No            | No                 | Yes                                            |
| JavaScript regex literals and `.test(...)`                  | No            | No                 | Only with `allowUnsafeEval`                    |
| `allowUnsafeEval`                                           | No            | No                 | Optional                                       |

`GOESSNER_EXTENDED` means the project-specific dialect based on Stefan
Goessner's JSONPath 0.9.0; it is not an official Goessner release or dialect.
It accepts all five RFC functions as safe additions,
while its overlapping query semantics and return behavior remain compatible
with the historical project implementation. Existing JavaScript expressions
continue to require the explicit `allowUnsafeEval` escape hatch.

For historical compatibility, `GOESSNER_EXTENDED` expects the query root to be
an object, an array, or another truthy value. A falsy scalar root (`false`, `0`,
`""`, or `null`) is not evaluated and returns `undefined`, matching the legacy
entry-point behavior. Falsy values nested inside an object or array are
supported. Wrap a scalar when this distinction matters, for example
`{ value: false }`, or use an RFC mode to query arbitrary JSON root values.

`RFC9535_EXTENDED` preserves RFC behavior for every valid RFC query but accepts
additional syntax, so it is an RFC-compatible superset rather than the strict
RFC grammar.

For an environment-wide migration default, a wrapper or the deployed Action
can read a Configuration Item only when `arg.mode` is absent. The recommended
precedence is call parameter, Configuration Item, then the built-in `RFC9535`
default. The repository itself deliberately has no dependency on an
environment-specific Configuration Item.

## Supported syntax

| Syntax            | Example                   | Meaning                                               |
| ----------------- | ------------------------- | ----------------------------------------------------- |
| Root              | `$`                       | Start at the input object.                            |
| Child property    | `.store`                  | Read an object property.                              |
| Bracket property  | `['store']`               | Read a quoted property.                               |
| Array index       | `[0]`                     | Read one array element.                               |
| Wildcard          | `[*]`                     | Read all array elements or object values.             |
| Recursive descent | `..author`                | Find a property at any depth.                         |
| Union             | `['title','price']`       | Select several properties.                            |
| Slice             | `[0:2]`                   | Select an array range.                                |
| Filter            | `[?@.price < 10]`         | Filter child values. Parentheses are also valid.      |
| Nested filter     | `@.book[?(@.price > 10)]` | Test whether nested values match.                     |
| Standard function | `[?length(@.title) > 10]` | Use `length`, `count`, `match`, `search`, or `value`. |

RFC filters are parsed and evaluated internally without JavaScript `eval`.
The safe `GOESSNER_EXTENDED` expression parser uses the same approach for the
five standard functions. Malformed RFC queries and ill-typed standard function
calls raise `SyntaxError`.

`RFC9535_EXTENDED` adds self-filters (`[??(...)]`) and the parent operator (`^`)
to the RFC parser. `GOESSNER_EXTENDED` provides these operators through the
historical parser and additionally supports computed indices
(`[(@.length-1)]`). Its safe expression parser also accepts RFC-style
`length()`, `count()`, `match()`, `search()`, and `value()` calls, with or
without parentheses around the filter.

## Standard functions

All five RFC 9535 functions are available in `RFC9535`, `RFC9535_EXTENDED`, and
`GOESSNER_EXTENDED` without enabling `allowUnsafeEval`:

| Function                 | Result                                                          | Example                                                  |
| ------------------------ | --------------------------------------------------------------- | -------------------------------------------------------- |
| `length(value)`          | Number of Unicode characters, array elements, or object members | `$.items[?length(@.name) > 10]`                          |
| `count(nodes)`           | Number of nodes selected by the argument query                  | `$.items[?count(@.values[*]) >= 2]`                      |
| `match(value, pattern)`  | `true` when the complete string matches the I-Regexp             | `$.items[?match(@.code, 'ABC-[0-9]+')]`                  |
| `search(value, pattern)` | `true` when a substring matches the I-Regexp                     | `$.items[?search(@.message, 'error')]`                   |
| `value(nodes)`           | The selected value when the argument selects exactly one node   | `$.items[?value(@.codes[?@ == 'primary']) == 'primary']` |

`length()` returns the RFC `Nothing` result for unsupported value types.
`value()` also returns `Nothing` when its query selects zero or more than one
node. `Nothing` does not become JSON `null`. It therefore does not accidentally
match a missing or ambiguous result against `null`.

In `GOESSNER_EXTENDED`, `count()` and `value()` require a query argument, while
a query passed to `length()` must be singular. The function behavior follows
RFC 9535; surrounding comparisons and the final no-match result continue to
follow the selected mode. For example:

```javascript
jsonPath(payload, "$.items[?count(@.values[?@ > 10]) >= 2]", {
  mode: "GOESSNER_EXTENDED",
});
```

This uses the safe parser. JavaScript Array methods such as `.some()`,
`.every()`, `.map()`, and `.indexOf()` remain separate compatibility features
and still require `allowUnsafeEval: true`.

## Standard JSONPath examples

The examples use
[`tests/fixtures/goessner-store-extended.json`](tests/fixtures/goessner-store-extended.json).

All authors:

```text
$.store.book[*].author
```

All author properties at any depth:

```text
$..author
```

Titles of books below a price of 10:

```text
$.store.book[?(@.price < 10)].title
```

Title and price of the first book:

```text
$.store.book[0]['title','price']
```

The first two book titles:

```text
$.store.book[0:2].title
```

The last book:

```text
$.store.book[-1].title
```

Negative indices are supported in all three modes and should be preferred for
new queries. The historical computed form `[(@.length-1)]` remains available
in `GOESSNER_EXTENDED` for backward compatibility.

## Nested filters

A regular filter can directly inspect the current object:

```text
$.store.book[?(@.price < 10)].title
```

Nested filters make it possible to select a parent by conditions on its
children. A nested query used in a logical context is an existence test: it is
true when the nested query selects at least one node.

Stores containing at least one book priced above 10:

```text
$.stores[?(@.book[?(@.price > 10)])].name
```

The outer `@` represents the store currently being filtered. Inside the nested
book filter, `@` is rebound to the current book. The result contains stores,
because the outer filter is attached to `stores`.

```json
["Mixed Prices", "Premium Only", "Mixed With Ten"]
```

### Multiple nested levels

A filter can contain another nested filter at each array or object level.
Books with stock in a Zurich warehouse:

```text
$.store.book[?(
  @.editions[?(
    @.stock[?(@.warehouse == 'zurich')]
  )]
)].title
```

Each `@` belongs to its directly enclosing filter: book, edition, and stock
entry respectively.

### Any, none, and all

An existence test naturally expresses "any":

```text
@.book[?(@.price > 10)]
```

Negating that existence test expresses "none":

```text
!@.book[?(@.price > 10)]
```

"All non-empty books are priced above 10" is expressed by requiring a book and
excluding every counterexample:

```text
@.book[?(@)] && !@.book[?(@.price <= 10)]
```

Used in a complete query:

```text
$.stores[?(
  @.book[?(@)] &&
  !@.book[?(@.price <= 10)]
)].name
```

Result:

```json
["Premium Only"]
```

The first existence test makes an empty book array evaluate to false. Without
it, "there is no counterexample" would also be true for an empty array.

### Filtering object member values

Filter selectors also iterate over object member values. With:

```json
{
  "availability": {
    "ch": "available",
    "de": "backorder"
  }
}
```

this nested filter checks all country values:

```text
@.availability[?(@ == 'available')]
```

### Compatibility and scope

Nested queries follow the RFC 9535 existence-test model. Parenthesized filter
expressions such as `[?(@.price > 10)]` are valid RFC syntax as well. The
self-filter `??(...)` and parent operator `^` are available in both extended
modes. Computed indices remain specific to `GOESSNER_EXTENDED`.

## Filter level and result identity

A nested filter only supplies a logical condition. It does not
change which nodes the filter selects or project matching nested values into
the result.

| Expression                      | Filter candidates                   | Returned matches    |
| ------------------------------- | ----------------------------------- | ------------------- |
| `$.store.book[?(@.price > 10)]` | Books                               | Books               |
| `$.stores[?(@.book[?(...)])]`   | Store array elements                | Stores              |
| `$.store[?(@.book[?(...)])]`    | Member values of the `store` object | Those member values |

Consequently, these expressions are not equivalent:

```text
$.store[?(@.book[?(@.price > 10)])]
$.store.book[?(@.price > 10)]
```

In the first expression, `?(...)` is attached to `store`. If `store` is an
object, the filter walks its member values such as the `book` array and the
`bicycle` object. If `store` is an array, the filter walks its store elements.
In neither case does the filter return individual books.

To return matching books independently of whether `store` is an object or an
array of store objects, use recursive descent:

```text
$..book[?(@.price > 10)]
```

To return only their titles:

```text
$..book[?(@.price > 10)].title
```

## Self-filter

> Available in `RFC9535_EXTENDED` and `GOESSNER_EXTENDED`.

The standard filter `?(...)` evaluates the elements or member values of the
current container. The extended self-filter `??(...)` evaluates the current
value itself.

Books that contain an ISBN:

```text
$.store.book[*][??(@.isbn)].title
```

Result:

```json
["Moby Dick", "The Lord of the Rings"]
```

## Parent operator

> Available in `RFC9535_EXTENDED` and `GOESSNER_EXTENDED`.

The `^` operator moves one normalized path level toward the root. It is
appended directly to the previous expression, without a dot before `^`.

An array element and its containing array are separate path levels. Starting
at one edition therefore requires two parent steps to reach its book:

```text
$.store.book[0].editions[0]^^.title
```

Result:

```json
["Sayings of the Century"]
```

Writing `.^` is not equivalent. The historical normalizer interprets the
additional separator as recursive descent.

### Bottom-up traversal with self-filtering

Parent traversal and self-filtering can be combined to start at a deeply
nested match, move upward, and test an ancestor in place. This query starts at
positive stock entries, moves up to their edition, keeps hardcover editions,
then moves up to the containing book:

```text
$.store.book[*].editions[*].stock[?(@.quantity > 0)]^^[??(@.format == 'hardcover')]^^.title
```

Result:

```json
["Sayings of the Century", "The Lord of the Rings"]
```

## Result types

The default `VALUE` result returns matched values:

```javascript
jsonPath(store, "$.store.book[*].title", { resultType: "VALUE" });
```

`PATH` returns normalized paths:

```javascript
jsonPath(store, "$.store.book[?(@.price < 10)].title", {
  resultType: "PATH",
});
```

Result:

```json
["$['store']['book'][0]['title']", "$['store']['book'][2]['title']"]
```

## Complete workflow example

This example finds all books that have stock in Zurich. A query without a match
already returns an empty array in the default mode:

```javascript
var expression =
  "$.store.book[?(" +
  "@.editions[?(@.stock[?(@.warehouse == 'zurich')])]" +
  ")].title";

var matches = System.getModule("com.example.jsonpath").jsonPath(
  inputPayload,
  expression,
  { resultType: "VALUE" },
);

System.log("Found " + matches.length + " matching book(s).");

return matches;
```

The same pattern can query infrastructure payloads such as deployments,
resources, networks, tags, and backend inventory results.

## Developer notes

- The Action is written in an ES5-compatible style for portability across VCF
  Operations Orchestrator, VMware Aria Automation Orchestrator, and historical
  vRO environments.
- The source is an Action body, not a CommonJS module.
- Local tests use `new Function("obj", "expr", "arg", source)` to recreate the
  variables supplied by Orchestrator.
- Each call creates isolated internal evaluation state.
- Gössner Extended nested filter brackets are parsed with balanced-bracket handling
  rather than the original non-nested regular expression.
- `RFC9535` is the default mode and uses a dedicated standards parser.
- `RFC9535` returns `[]` for no match and raises `SyntaxError` for invalid
  queries.
- `RFC9535_EXTENDED` uses the RFC parser and adds `??` and `^`.
- `GOESSNER_EXTENDED` preserves the historical project extensions and `false`
  for no match, while safely supporting all five RFC functions.
- `allowUnsafeEval: true` is accepted only in `GOESSNER_EXTENDED` mode and restores the
  historical JavaScript evaluation path for trusted expressions.
- A nested query is true when it selects at least one node.
- `@` is rebound at every nested filter level.
- In `GOESSNER_EXTENDED` mode, missing path branches in nested queries produce no match;
  some direct property chains may still require an existence guard.
- A nested filter affects the predicate only; the outer filter location still
  determines the returned nodes.
- A caller can override the public default with `{ mode: "GOESSNER_EXTENDED" }` during a
  migration or through a wrapper that supplies an environment-specific default.

## Design choice: single Action

JSONPath Extended is intentionally packaged as one self-contained Action.
Splitting parsing, path traversal, nested filter handling, and expression
evaluation into separate Actions would introduce deployment dependencies and
version coordination.

Keeping the implementation in one file makes it easier to copy into an
Orchestrator environment, export with a package, compare revisions, and
regression-test the exact production source. Consumers should use the
documented expression interface rather than calling internal helper functions.

## Testing

The Action itself has no Node.js dependency. The repository includes an
optional dependency-free Node.js runner for local regression testing:

```powershell
node tests/run-tests.js
```

In VS Code:

```text
Terminal -> Run Task -> Run JSONPath Tests
```

The numbered JSON cases in `tests/cases` cover standard JSONPath behavior and
all extensions. They reference the shared, enriched Goessner dataset in
`tests/fixtures`.

The official JSONPath Compliance Test Suite is pinned and installed separately:

```powershell
node tests/setup-compliance-suite.js
node tests/run-compliance-tests.js
```

The compliance runner verifies both values and normalized paths, as well as
the rejection of every invalid selector in the suite. It always executes the
strict `RFC9535` mode; project extensions are covered by the local regression
suite.

See [tests/README.md](tests/README.md) for the case format and instructions for
adding regressions.

## Security

RFC filter expressions are parsed against the RFC grammar and evaluated without
JavaScript `eval`. Expressions cannot invoke `System`, constructors, arbitrary
methods, assignments, or other executable JavaScript. Unsupported syntax raises
a `SyntaxError`.

To bound parser resource usage, an RFC query is limited to 4096 characters and
64 nesting levels. The Gössner Extended expression parser additionally limits
filter expressions to 512 tokens and unsafe JavaScript regular-expression
literals to 1024 characters. An I-Regexp is limited to 4096 UTF-16 code units,
64 group nesting levels, and 16384 compiled NFA states.

Regular expressions are supplied as RFC 9485 I-Regexp strings to the RFC
`match()` and `search()` functions in all three modes. `match()` requires the
complete value to match; `search()` looks for a matching substring. The
self-contained ES5-compatible engine supports Unicode scalar matching and all
RFC 9485 general-category escapes, including aggregate categories such as
`\p{L}` and specific categories such as `\p{Nd}`. Its embedded category data is
generated from Unicode 16.0.

JavaScript regex literals and `.test(...)` are rejected by the safe parser and
are available only through the unsafe compatibility path. Callers that
assemble expressions remain responsible for their intended query semantics.

For compatibility with expressions that use JavaScript Array methods such as
`.some()`, `.every()`, `.map()`, or `.indexOf()`, trusted callers can explicitly
restore the historical behavior:

```javascript
jsonPath(payload, expression, {
  mode: "GOESSNER_EXTENDED",
  resultType: "VALUE",
  allowUnsafeEval: true,
});
```

This option executes the expression with JavaScript `eval` and bypasses the
allowlisted grammar and its resource limits. Never enable it for expressions
or expression fragments influenced by untrusted users or tenants.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for
details.

VMware Cloud Foundation, VMware Aria, VMware Aria Automation, VMware Aria
Orchestrator, and vRealize Orchestrator are trademarks or registered trademarks
of their respective owners. This project is not affiliated with, endorsed by,
or sponsored by VMware or Broadcom.
