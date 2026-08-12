/* JSONPath 0.9.0 - XPath for JSON
 *
 * Copyright (c) 2007 Stefan Goessner (goessner.net)
 * Licensed under the MIT License. See LICENSE.
 *  
 */

/**
 * @fileoverview Self-contained JSONPath Action for VCF Operations Orchestrator
 * (VCF Orchestrator) and VMware Aria Automation Orchestrator 8.x (Aria
 * Orchestrator).
 *
 * Orchestrator supplies `obj`, `expr`, and `arg` as Action inputs. The built-in
 * default is strict RFC 9535. `RFC9535_EXTENDED` adds `??` and `^`, while
 * `GOESSNER_EXTENDED` preserves the historical result contract and computed
 * expressions. JavaScript evaluation is disabled unless a trusted caller
 * explicitly sets `allowUnsafeEval: true` in `GOESSNER_EXTENDED` mode.
 */

/**
 * Virtual function signature of the Orchestrator Action body.
 *
 * @function jsonPath
 * @param {*} obj JSON-compatible root value to query.
 * @param {string} expr JSONPath query.
 * @param {JsonPathOptions=} arg Optional mode, result type, and security
 * settings.
 * @returns {Array<*>|boolean} Nodelist values or paths; the compatibility mode
 * returns `false` when no node matches.
 */

/**
 * @typedef {Object} JsonPathOptions
 * @property {string=} mode `RFC9535`, `RFC9535_EXTENDED`, or
 * `GOESSNER_EXTENDED`; defaults to `RFC9535`.
 * @property {string=} resultType `VALUE` or `PATH`; defaults to `VALUE`.
 * @property {boolean=} allowUnsafeEval Enables trusted historical JavaScript
 * expressions only in `GOESSNER_EXTENDED`; defaults to `false`.
 */

/**
 * Historical extended Goessner evaluator and its safe expression parser.
 *
 * Paths are normalized internally to semicolon-separated segments. This
 * evaluator is selected only for `GOESSNER_EXTENDED`; RFC modes use the
 * dedicated parser below.
 *
 * @namespace
 */
var P = {
    resultType: arg && arg.resultType || "VALUE",
    result: [],

    /**
     * Converts a Goessner-style query to the internal trace representation.
     * Filter and computed expressions are replaced by placeholders first so
     * nested brackets and callback semicolons cannot be split as path tokens.
     *
     * @param {string} expr Query to normalize.
     * @returns {string} Semicolon-separated trace expression.
     */
    normalize: function (expr) {
        var subx = [];
        var protectedExpr = P.protectExpressions(expr, subx);

        P.protectedExpressions = subx;

        return protectedExpr
            .replace(/\^\.\[/g, "^[")
            .replace(/'?\.'?|\['?/g, ";")
            .replace(/\^/g, ";^")
            .replace(/;;;|;;/g, ";..;")
            .replace(/;$|'?\]|'$/g, "");
    },
    /**
     * Extracts bracketed filter and computed expressions with balanced-bracket
     * handling.
     *
     * @param {string} expr Query containing bracket expressions.
     * @param {Array<string>} subx Destination for extracted expressions.
     * @returns {string} Query containing numeric expression placeholders.
     */
    protectExpressions: function (expr, subx) {
        var out = "";
        var i = 0;

        while (i < expr.length) {
            if (expr.charAt(i) === "[") {
                var rest = expr.substring(i + 1);
                var isExpression =
                    rest.indexOf("?") === 0 ||
                    rest.indexOf("(") === 0;

                if (isExpression) {
                    var end = P.findClosingBracket(expr, i);

                    if (end !== -1) {
                        var inner = expr.substring(i + 1, end);
                        out += "[#" + (subx.push(inner) - 1) + "]";
                        i = end + 1;
                        continue;
                    }
                }
            }

            out += expr.charAt(i);
            i++;
        }

        return out;
    },
    /**
     * Finds the matching closing bracket while respecting strings and nesting.
     *
     * @param {string} value Text to scan.
     * @param {number} start Index of the opening bracket.
     * @returns {number} Closing-bracket index, or `-1` when unmatched.
     */
    findClosingBracket: function (value, start) {
        var depth = 0;
        var quote = null;

        for (var i = start; i < value.length; i++) {
            var ch = value.charAt(i);

            if (quote) {
                if (ch === "\\") {
                    i++;
                }
                else if (ch === quote) {
                    quote = null;
                }
            }
            else if (ch === "'" || ch === "\"") {
                quote = ch;
            }
            else if (ch === "[") {
                depth++;
            }
            else if (ch === "]") {
                depth--;

                if (depth === 0) {
                    return i;
                }
            }
        }

        return -1;
    },
    /**
     * Converts an internal trace path to normalized JSONPath bracket notation.
     *
     * @param {string} path Semicolon-separated internal path.
     * @returns {string} Normalized path beginning with `$`.
     */
    asPath: function (path) {
        var x = path.split(";"), p = "$";
        for (var i = 1, n = x.length; i < n; i++)
            p += /^[0-9*]+$/.test(x[i]) ? ("[" + x[i] + "]") : ("['" + x[i] + "']");
        return p;
    },
    /**
     * Stores one matched value or normalized path in the current result list.
     *
     * @param {string} p Internal path of the match.
     * @param {*} v Matched value.
     * @returns {boolean} Whether a non-empty path was stored.
     */
    store: function (p, v) {
        if (p) P.result[P.result.length] = P.resultType == "PATH" ? P.asPath(p) : v;
        return !!p;
    },
    /**
     * Recursively evaluates one normalized path segment.
     *
     * This is the main selector dispatcher for `GOESSNER_EXTENDED`, including
     * wildcards, descent, slices, filters, parent navigation, negative indices,
     * and historical computed indices.
     *
     * @param {string} expr Remaining normalized expression.
     * @param {*} val Current JSON value.
     * @param {string} path Internal path of `val`.
     * @returns {void}
     */
    trace: function (expr, val, path) {
        if (expr) {
            var x = expr.split(";"), loc = x.shift();
            x = x.join(";");
            if (/^#[0-9]+$/.test(loc)) {
                loc = P.protectedExpressions[parseInt(loc.substring(1), 10)];
            }
            if (val && val.hasOwnProperty(loc))
                P.trace(x, val[loc], path + ";" + loc);
            else if (val instanceof Array && /^-[1-9][0-9]*$/.test(loc)) {
                var negativeIndex = val.length + parseInt(loc, 10);
                if (negativeIndex >= 0 && val.hasOwnProperty(negativeIndex))
                    P.trace(String(negativeIndex) + ";" + x, val, path);
            }
            else if (loc === "^")
                P.parent(x, path);
            else if (loc === "*")
                P.walk(loc, x, val, path, function (m, l, x, v, p) { P.trace(m + ";" + x, v, p); });
            else if (loc === "..") {
                P.trace(x, val, path);
                P.walk(loc, x, val, path, function (m, l, x, v, p) { typeof v[m] === "object" && P.trace("..;" + x, v[m], p + ";" + m); });
            }
            else if (/,/.test(loc) && loc.charAt(0) !== "?") { // [name1,name2,...]
                for (var s = loc.split(/'?,'?/), i = 0, n = s.length; i < n; i++)
                    P.trace(s[i] + ";" + x, val, path);
            }
            else if (/^\(.*?\)$/.test(loc)) // [(expr)]
                P.trace(P.evaluate(loc, val, path.substr(path.lastIndexOf(";") + 1)) + ";" + x, val, path);
            else if (/^\?\?.+/.test(loc)) // [??expr] self filter
                P.selfFilter(loc, x, val, path);
            else if (/^\?.+/.test(loc)) // [?expr]
                P.walk(loc, x, val, path, function (m, l, x, v, p) {
                    if (P.evaluate(P.unwrapFilterExpression(l, false), v[m], m)) {
                        P.trace(m + ";" + x, v, p);
                    }
                });
            else if (/^(-?[0-9]*):(-?[0-9]*):?([0-9]*)$/.test(loc)) // [start:end:step]  phyton slice syntax
                P.slice(loc, x, val, path);
        }
        else
            P.store(path, val);
    },
    /**
     * Visits each own child of an array or object.
     *
     * @param {string} loc Current selector.
     * @param {string} expr Remaining trace expression.
     * @param {*} val Container to visit.
     * @param {string} path Internal container path.
     * @param {Function} f Visitor callback.
     * @returns {void}
     */
    walk: function (loc, expr, val, path, f) {
        if (val instanceof Array) {
            for (var i = 0, n = val.length; i < n; i++)
                if (i in val)
                    f(i, loc, expr, val, path);
        }
        else if (typeof val === "object") {
            for (var m in val)
                if (val.hasOwnProperty(m))
                    f(m, loc, expr, val, path);
        }
    },
    /**
     * Applies a Goessner-compatible array slice and continues tracing matches.
     *
     * @param {string} loc Slice text without brackets.
     * @param {string} expr Remaining trace expression.
     * @param {*} val Candidate array.
     * @param {string} path Internal array path.
     * @returns {void}
     */
    slice: function (loc, expr, val, path) {
        if (val instanceof Array) {
            var len = val.length, start = 0, end = len, step = 1;
            loc.replace(/^(-?[0-9]*):(-?[0-9]*):?(-?[0-9]*)$/g, function ($0, $1, $2, $3) { start = parseInt($1 || start); end = parseInt($2 || end); step = parseInt($3 || step); });
            start = (start < 0) ? Math.max(0, start + len) : Math.min(len, start);
            end = (end < 0) ? Math.max(0, end + len) : Math.min(len, end);
            for (var i = start; i < end; i += step)
                P.trace(i + ";" + expr, val, path);
        }
    },
    /**
     * Evaluates a `GOESSNER_EXTENDED` filter or computed expression.
     *
     * The safe parser is the default. The JavaScript path is used only when
     * `allowUnsafeEval` is the Boolean value `true`.
     *
     * @param {string} x Expression source.
     * @param {*} _v Current filter value.
     * @param {string|number} _vname Current member name, retained for legacy
     * compatibility.
     * @returns {*} Evaluated expression result.
     * @throws {SyntaxError} When safe parsing or evaluation fails.
     */
    evaluate: function (x, _v, _vname) {
        try {
            if (arg && arg.allowUnsafeEval === true) {
                return P.evaluateUnsafe(x, _v);
            }

            var expression = P.parseExpression(x);
            return $ && P.evaluateExpression(expression, _v);
        }
        catch (e) {
            throw new SyntaxError(
                "jsonPath: " +
                e.message +
                ": " +
                x
            );
        }
    },
    /**
     * Evaluates a trusted historical JavaScript expression.
     *
     * This function executes `eval` and must never receive untrusted or
     * tenant-controlled expression fragments.
     *
     * @param {string} x Expression source.
     * @param {*} _v Current filter value bound to `@` in the source.
     * @returns {*} JavaScript evaluation result.
     */
    evaluateUnsafe: function (x, _v) {
        var code = P.rewriteNestedFilters(x).replace(/@/g, "_v");
        return $ && eval(code);
    },
    /**
     * Parses a safe Goessner Extended expression into an internal AST.
     *
     * @param {string} source Filter or computed expression.
     * @returns {Object} Expression AST.
     * @throws {SyntaxError} For unsupported syntax or resource-limit excess.
     */
    parseExpression: function (source) {
        if (typeof source !== "string" || source.length > 4096) {
            P.expressionError(
                "Expression must be a string of at most 4096 characters"
            );
        }

        var parser = {
            source: source,
            index: 0,
            token: null,
            previous: null,
            tokenCount: 0,
            depth: 0
        };

        P.nextExpressionToken(parser);

        var expression = P.parseLogicalOr(parser);

        if (parser.token.type !== "eof") {
            P.expressionError(
                "Unsafe or unsupported token '" + parser.token.raw + "'"
            );
        }

        return expression;
    },
    /**
     * Reads the next token for the safe expression parser.
     *
     * The lexer recognizes only the allowlisted grammar. JavaScript regex
     * literals are tokenized solely to produce a clear opt-in error.
     *
     * @param {Object} parser Mutable parser state.
     * @returns {void}
     */
    nextExpressionToken: function (parser) {
        var source = parser.source;
        var length = source.length;

        parser.tokenCount++;

        if (parser.tokenCount > 512) {
            P.expressionError("Expression contains too many tokens");
        }

        while (parser.index < length && /\s/.test(source.charAt(parser.index))) {
            parser.index++;
        }

        parser.previous = parser.token;

        if (parser.index >= length) {
            parser.token = {
                type: "eof",
                value: "",
                raw: ""
            };
            return;
        }

        var start = parser.index;
        var ch = source.charAt(parser.index);
        var next = source.charAt(parser.index + 1);
        var three = source.substr(parser.index, 3);
        var two = source.substr(parser.index, 2);

        if (ch === "'" || ch === "\"") {
            parser.token = P.readExpressionString(parser, ch);
            return;
        }

        if (
            ch === "/" &&
            P.expressionValueExpected(parser.previous)
        ) {
            parser.token = P.readExpressionRegex(parser);
            return;
        }

        if (
            (ch >= "0" && ch <= "9") ||
            (ch === "." && next >= "0" && next <= "9")
        ) {
            parser.index++;

            while (
                parser.index < length &&
                /[0-9.eE]/.test(source.charAt(parser.index))
            ) {
                parser.index++;
            }

            if (
                (source.charAt(parser.index) === "+" ||
                    source.charAt(parser.index) === "-") &&
                /[eE]/.test(source.charAt(parser.index - 1))
            ) {
                parser.index++;

                while (
                    parser.index < length &&
                    /[0-9]/.test(source.charAt(parser.index))
                ) {
                    parser.index++;
                }
            }

            var numberRaw = source.substring(start, parser.index);
            var numberValue = Number(numberRaw);

            if (!isFinite(numberValue)) {
                P.expressionError("Invalid number '" + numberRaw + "'");
            }

            parser.token = {
                type: "number",
                value: numberValue,
                raw: numberRaw
            };
            return;
        }

        if (ch === "@" || /[A-Za-z_$]/.test(ch)) {
            parser.index++;

            if (ch !== "@") {
                while (
                    parser.index < length &&
                    /[A-Za-z0-9_$]/.test(source.charAt(parser.index))
                ) {
                    parser.index++;
                }
            }

            var identifier = source.substring(start, parser.index);

            parser.token = {
                type: ch === "@" ? "current" : "identifier",
                value: identifier,
                raw: identifier
            };
            return;
        }

        if (
            three === "===" ||
            three === "!=="
        ) {
            parser.index += 3;
            parser.token = {
                type: "operator",
                value: three,
                raw: three
            };
            return;
        }

        if (
            two === "==" ||
            two === "!=" ||
            two === "<=" ||
            two === ">=" ||
            two === "&&" ||
            two === "||"
        ) {
            parser.index += 2;
            parser.token = {
                type: "operator",
                value: two,
                raw: two
            };
            return;
        }

        if (/[!<>+\-*\/%]/.test(ch)) {
            parser.index++;
            parser.token = {
                type: "operator",
                value: ch,
                raw: ch
            };
            return;
        }

        if (/[\(\)\[\]\.,\?]/.test(ch)) {
            parser.index++;
            parser.token = {
                type: "punctuation",
                value: ch,
                raw: ch
            };
            return;
        }

        P.expressionError("Unsafe or unsupported character '" + ch + "'");
    },
    /**
     * Determines whether `/` begins a regex literal or is a division operator.
     *
     * @param {Object|null} previous Previously emitted token.
     * @returns {boolean} Whether the grammar currently expects a value.
     */
    expressionValueExpected: function (previous) {
        if (!previous) {
            return true;
        }

        if (previous.type === "operator") {
            return true;
        }

        return (
            previous.type === "punctuation" &&
            (
                previous.value === "(" ||
                previous.value === "[" ||
                previous.value === "," ||
                previous.value === "?"
            )
        );
    },
    /**
     * Reads one JavaScript-compatible string literal used by the historical
     * expression grammar.
     *
     * @param {Object} parser Mutable parser state.
     * @param {string} quote Opening quote character.
     * @returns {Object} String token.
     */
    readExpressionString: function (parser, quote) {
        var source = parser.source;
        var start = parser.index;
        var value = "";

        parser.index++;

        while (parser.index < source.length) {
            var ch = source.charAt(parser.index++);

            if (ch === quote) {
                return {
                    type: "string",
                    value: value,
                    raw: source.substring(start, parser.index)
                };
            }

            if (ch === "\r" || ch === "\n") {
                P.expressionError("Unterminated string literal");
            }

            if (ch !== "\\") {
                value += ch;
                continue;
            }

            if (parser.index >= source.length) {
                P.expressionError("Unterminated string escape");
            }

            var escaped = source.charAt(parser.index++);
            var escapes = {
                b: "\b",
                f: "\f",
                n: "\n",
                r: "\r",
                t: "\t",
                v: "\v",
                "0": "\0"
            };

            if (escapes.hasOwnProperty(escaped)) {
                value += escapes[escaped];
            }
            else if (escaped === "x" || escaped === "u") {
                var digits = escaped === "x" ? 2 : 4;
                var hex = source.substr(parser.index, digits);

                if (
                    hex.length !== digits ||
                    !/^[0-9A-Fa-f]+$/.test(hex)
                ) {
                    P.expressionError("Invalid hexadecimal string escape");
                }

                value += String.fromCharCode(parseInt(hex, 16));
                parser.index += digits;
            }
            else {
                value += escaped;
            }
        }

        P.expressionError("Unterminated string literal");
    },
    /**
     * Reads and validates a historical JavaScript regular-expression literal.
     * Safe evaluation rejects the resulting token; trusted callers may use it
     * only through `allowUnsafeEval`.
     *
     * @param {Object} parser Mutable parser state.
     * @returns {Object} Regular-expression token.
     */
    readExpressionRegex: function (parser) {
        var source = parser.source;
        var start = parser.index;
        var pattern = "";
        var inClass = false;
        var closed = false;

        parser.index++;

        while (parser.index < source.length) {
            var ch = source.charAt(parser.index++);

            if (ch === "\r" || ch === "\n") {
                P.expressionError("Unterminated regular expression");
            }

            if (ch === "\\") {
                if (parser.index >= source.length) {
                    P.expressionError("Unterminated regular expression escape");
                }

                pattern += ch + source.charAt(parser.index++);
                continue;
            }

            if (ch === "[") {
                inClass = true;
                pattern += ch;
                continue;
            }

            if (ch === "]" && inClass) {
                inClass = false;
                pattern += ch;
                continue;
            }

            if (ch === "/" && !inClass) {
                closed = true;
                break;
            }

            pattern += ch;
        }

        if (!closed) {
            P.expressionError("Unterminated regular expression");
        }

        var flagsStart = parser.index;

        while (
            parser.index < source.length &&
            /[A-Za-z]/.test(source.charAt(parser.index))
        ) {
            parser.index++;
        }

        var flags = source.substring(flagsStart, parser.index);

        if (pattern.length > 1024) {
            P.expressionError(
                "Regular-expression patterns are limited to 1024 characters"
            );
        }

        if (!/^[gim]*$/.test(flags) || /(.).*\1/.test(flags)) {
            P.expressionError(
                "Unsafe or unsupported regular-expression flags '" +
                flags +
                "'"
            );
        }

        try {
            new RegExp(pattern, flags);
        }
        catch (e) {
            P.expressionError("Invalid regular expression: " + e.message);
        }

        return {
            type: "regex",
            value: {
                pattern: pattern,
                flags: flags
            },
            raw: source.substring(start, parser.index)
        };
    },
    /**
     * Parses left-associative logical OR expressions.
     *
     * @param {Object} parser Mutable parser state.
     * @returns {Object} Expression AST.
     */
    parseLogicalOr: function (parser) {
        var left = P.parseLogicalAnd(parser);

        while (P.expressionTokenIs(parser, "||")) {
            P.nextExpressionToken(parser);
            left = {
                type: "binary",
                operator: "||",
                left: left,
                right: P.parseLogicalAnd(parser)
            };
        }

        return left;
    },
    /**
     * Parses left-associative logical AND expressions.
     *
     * @param {Object} parser Mutable parser state.
     * @returns {Object} Expression AST.
     */
    parseLogicalAnd: function (parser) {
        var left = P.parseEquality(parser);

        while (P.expressionTokenIs(parser, "&&")) {
            P.nextExpressionToken(parser);
            left = {
                type: "binary",
                operator: "&&",
                left: left,
                right: P.parseEquality(parser)
            };
        }

        return left;
    },
    /**
     * Parses loose and strict equality expressions.
     *
     * @param {Object} parser Mutable parser state.
     * @returns {Object} Expression AST.
     */
    parseEquality: function (parser) {
        var left = P.parseRelational(parser);

        while (
            P.expressionTokenIs(parser, "==") ||
            P.expressionTokenIs(parser, "!=") ||
            P.expressionTokenIs(parser, "===") ||
            P.expressionTokenIs(parser, "!==")
        ) {
            var operator = parser.token.value;
            P.nextExpressionToken(parser);
            left = {
                type: "binary",
                operator: operator,
                left: left,
                right: P.parseRelational(parser)
            };
        }

        return left;
    },
    /**
     * Parses relational comparison expressions.
     *
     * @param {Object} parser Mutable parser state.
     * @returns {Object} Expression AST.
     */
    parseRelational: function (parser) {
        var left = P.parseAdditive(parser);

        while (
            P.expressionTokenIs(parser, "<") ||
            P.expressionTokenIs(parser, "<=") ||
            P.expressionTokenIs(parser, ">") ||
            P.expressionTokenIs(parser, ">=")
        ) {
            var operator = parser.token.value;
            P.nextExpressionToken(parser);
            left = {
                type: "binary",
                operator: operator,
                left: left,
                right: P.parseAdditive(parser)
            };
        }

        return left;
    },
    /**
     * Parses addition and subtraction expressions.
     *
     * @param {Object} parser Mutable parser state.
     * @returns {Object} Expression AST.
     */
    parseAdditive: function (parser) {
        var left = P.parseMultiplicative(parser);

        while (
            P.expressionTokenIs(parser, "+") ||
            P.expressionTokenIs(parser, "-")
        ) {
            var operator = parser.token.value;
            P.nextExpressionToken(parser);
            left = {
                type: "binary",
                operator: operator,
                left: left,
                right: P.parseMultiplicative(parser)
            };
        }

        return left;
    },
    /**
     * Parses multiplication, division, and remainder expressions.
     *
     * @param {Object} parser Mutable parser state.
     * @returns {Object} Expression AST.
     */
    parseMultiplicative: function (parser) {
        var left = P.parseUnary(parser);

        while (
            P.expressionTokenIs(parser, "*") ||
            P.expressionTokenIs(parser, "/") ||
            P.expressionTokenIs(parser, "%")
        ) {
            var operator = parser.token.value;
            P.nextExpressionToken(parser);
            left = {
                type: "binary",
                operator: operator,
                left: left,
                right: P.parseUnary(parser)
            };
        }

        return left;
    },
    /**
     * Parses logical-not and numeric unary expressions.
     *
     * @param {Object} parser Mutable parser state.
     * @returns {Object} Expression AST.
     */
    parseUnary: function (parser) {
        if (
            P.expressionTokenIs(parser, "!") ||
            P.expressionTokenIs(parser, "+") ||
            P.expressionTokenIs(parser, "-")
        ) {
            var operator = parser.token.value;
            P.nextExpressionToken(parser);
            P.enterExpressionNesting(parser);
            var unaryValue = P.parseUnary(parser);
            P.leaveExpressionNesting(parser);

            return {
                type: "unary",
                operator: operator,
                value: unaryValue
            };
        }

        return P.parsePrimary(parser);
    },
    /**
     * Parses literals, paths, groups, conversions, and standard functions.
     *
     * `length`, `count`, `match`, `search`, and `value` are allowlisted here;
     * arbitrary identifiers and method calls are rejected.
     *
     * @param {Object} parser Mutable parser state.
     * @returns {Object} Primary-expression AST node.
     */
    parsePrimary: function (parser) {
        var token = parser.token;

        if (token.type === "number" || token.type === "string") {
            P.nextExpressionToken(parser);
            return {
                type: "literal",
                value: token.value
            };
        }

        if (token.type === "current") {
            P.nextExpressionToken(parser);
            return P.parseExpressionPath(parser, "current");
        }

        if (
            token.type === "identifier" &&
            token.value === "$"
        ) {
            P.nextExpressionToken(parser);
            return P.parseExpressionPath(parser, "root");
        }

        if (token.type === "identifier") {
            if (
                token.value === "true" ||
                token.value === "false" ||
                token.value === "null" ||
                token.value === "undefined"
            ) {
                P.nextExpressionToken(parser);
                return {
                    type: "literal",
                    value:
                        token.value === "true" ? true :
                            token.value === "false" ? false :
                                token.value === "null" ? null :
                                    undefined
                };
            }

            if (token.value === "String") {
                P.nextExpressionToken(parser);
                P.expectExpressionToken(parser, "(");
                P.enterExpressionNesting(parser);
                var argument = P.parseLogicalOr(parser);
                P.leaveExpressionNesting(parser);
                P.expectExpressionToken(parser, ")");

                return {
                    type: "stringCall",
                    argument: argument
                };
            }

            if (token.value === "match" || token.value === "search") {
                var regexFunctionName = token.value;
                P.nextExpressionToken(parser);
                P.expectExpressionToken(parser, "(");
                P.enterExpressionNesting(parser);
                var regexValue = P.parseLogicalOr(parser);
                P.expectExpressionToken(parser, ",");
                var regexPattern = P.parseLogicalOr(parser);
                P.leaveExpressionNesting(parser);
                P.expectExpressionToken(parser, ")");

                return {
                    type: "regexFunction",
                    name: regexFunctionName,
                    value: regexValue,
                    pattern: regexPattern
                };
            }

            if (
                token.value === "length" ||
                token.value === "count" ||
                token.value === "value"
            ) {
                var standardFunctionName = token.value;
                P.nextExpressionToken(parser);
                P.expectExpressionToken(parser, "(");
                P.enterExpressionNesting(parser);
                var standardArgument = P.parseLogicalOr(parser);
                P.leaveExpressionNesting(parser);
                P.expectExpressionToken(parser, ")");

                if (
                    (standardFunctionName === "count" || standardFunctionName === "value") &&
                    standardArgument.type !== "path"
                ) {
                    P.expressionError(
                        "Function '" + standardFunctionName +
                        "' requires a query argument"
                    );
                }

                if (
                    standardFunctionName === "length" &&
                    standardArgument.type === "path" &&
                    !P.expressionPathIsSingular(standardArgument)
                ) {
                    P.expressionError(
                        "Function 'length' requires a singular query argument"
                    );
                }

                return {
                    type: "standardFunction",
                    name: standardFunctionName,
                    argument: standardArgument
                };
            }

            P.expressionError(
                "Unsafe or unsupported identifier '" + token.value + "'"
            );
        }

        if (token.type === "regex") {
            P.expressionError(
                "JavaScript regular-expression literals require " +
                "allowUnsafeEval; use match() or search()"
            );
        }

        if (P.expressionTokenIs(parser, "(")) {
            P.nextExpressionToken(parser);
            P.enterExpressionNesting(parser);
            var grouped = P.parseLogicalOr(parser);
            P.leaveExpressionNesting(parser);
            P.expectExpressionToken(parser, ")");
            return grouped;
        }

        P.expressionError(
            "Expected a value but found '" + token.raw + "'"
        );
    },
    /**
     * Parses a root- or current-relative query used inside a safe expression.
     *
     * @param {Object} parser Mutable parser state.
     * @param {string} base Either `root` or `current`.
     * @returns {Object} Path AST containing property, index, wildcard, and
     * nested-filter segments.
     */
    parseExpressionPath: function (parser, base) {
        var path = {
            type: "path",
            base: base,
            segments: [],
            containsFilter: false
        };

        while (true) {
            if (P.expressionTokenIs(parser, ".")) {
                P.nextExpressionToken(parser);

                if (parser.token.type !== "identifier") {
                    P.expressionError("Expected a property name after '.'");
                }

                path.segments[path.segments.length] = {
                    type: "property",
                    key: parser.token.value
                };
                P.nextExpressionToken(parser);
                continue;
            }

            if (!P.expressionTokenIs(parser, "[")) {
                break;
            }

            P.nextExpressionToken(parser);

            if (P.expressionTokenIs(parser, "?")) {
                P.nextExpressionToken(parser);
                var parenthesizedFilter = P.expressionTokenIs(parser, "(");
                if (parenthesizedFilter) {
                    P.nextExpressionToken(parser);
                }
                P.enterExpressionNesting(parser);
                var filter = P.parseLogicalOr(parser);
                P.leaveExpressionNesting(parser);
                if (parenthesizedFilter) {
                    P.expectExpressionToken(parser, ")");
                }
                P.expectExpressionToken(parser, "]");

                path.segments[path.segments.length] = {
                    type: "filter",
                    expression: filter
                };
                path.containsFilter = true;
                continue;
            }

            if (P.expressionTokenIs(parser, "*")) {
                P.nextExpressionToken(parser);
                P.expectExpressionToken(parser, "]");
                path.segments[path.segments.length] = {
                    type: "wildcard"
                };
                continue;
            }

            var negative = false;

            if (P.expressionTokenIs(parser, "-")) {
                negative = true;
                P.nextExpressionToken(parser);
            }

            if (parser.token.type === "number") {
                var index = parser.token.value;

                if (index % 1 !== 0) {
                    P.expressionError("Array indices must be integers");
                }

                P.nextExpressionToken(parser);
                P.expectExpressionToken(parser, "]");
                path.segments[path.segments.length] = {
                    type: "index",
                    key: negative ? -index : index
                };
                continue;
            }

            if (!negative && parser.token.type === "string") {
                var key = parser.token.value;
                P.nextExpressionToken(parser);
                P.expectExpressionToken(parser, "]");
                path.segments[path.segments.length] = {
                    type: "property",
                    key: key
                };
                continue;
            }

            P.expressionError(
                "Only literal properties, indices, wildcards, and filters " +
                "are supported inside brackets"
            );
        }

        return path;
    },
    /**
     * Determines whether a path can select at most one node.
     *
     * @param {Object} path Path AST.
     * @returns {boolean} `true` for paths containing only name/index segments.
     */
    expressionPathIsSingular: function (path) {
        for (var i = 0; i < path.segments.length; i++) {
            if (
                path.segments[i].type !== "property" &&
                path.segments[i].type !== "index"
            ) {
                return false;
            }
        }
        return true;
    },
    /**
     * Consumes one required expression token.
     *
     * @param {Object} parser Mutable parser state.
     * @param {string} value Required token value.
     * @returns {void}
     * @throws {SyntaxError} When the current token differs.
     */
    expectExpressionToken: function (parser, value) {
        if (!P.expressionTokenIs(parser, value)) {
            P.expressionError(
                "Expected '" + value + "' but found '" +
                parser.token.raw +
                "'"
            );
        }

        P.nextExpressionToken(parser);
    },
    /**
     * Tests the current expression token value.
     *
     * @param {Object} parser Mutable parser state.
     * @param {string} value Expected token value.
     * @returns {boolean} Whether the token matches.
     */
    expressionTokenIs: function (parser, value) {
        return parser.token && parser.token.value === value;
    },
    /**
     * Enters one safe-expression nesting level and enforces its limit.
     *
     * @param {Object} parser Mutable parser state.
     * @returns {void}
     */
    enterExpressionNesting: function (parser) {
        parser.depth++;

        if (parser.depth > 64) {
            P.expressionError(
                "Expression nesting is limited to 64 levels"
            );
        }
    },
    /**
     * Leaves one safe-expression nesting level.
     *
     * @param {Object} parser Mutable parser state.
     * @returns {void}
     */
    leaveExpressionNesting: function (parser) {
        parser.depth--;
    },
    /**
     * Throws a syntax error from the safe expression parser.
     *
     * @param {string} message Error description.
     * @throws {SyntaxError} Always.
     */
    expressionError: function (message) {
        throw new SyntaxError(message);
    },
    /**
     * Evaluates a safe expression AST against one filter candidate.
     *
     * Standard functions share their scalar helpers with the RFC evaluator.
     * `count()` and `value()` deliberately retain the argument nodelist rather
     * than collapsing it to the historical existence-test Boolean.
     *
     * @param {Object} expression Expression AST.
     * @param {*} current Current value represented by `@`.
     * @returns {*} Expression result or `RFC_NOTHING`.
     */
    evaluateExpression: function (expression, current) {
        if (expression.type === "literal") {
            return expression.value;
        }

        if (expression.type === "path") {
            return P.evaluateExpressionPath(expression, current);
        }

        if (expression.type === "stringCall") {
            return String(P.evaluateExpression(expression.argument, current));
        }

        if (expression.type === "regexFunction") {
            return rfcRegexMatches(
                P.evaluateExpression(expression.value, current),
                P.evaluateExpression(expression.pattern, current),
                expression.name === "match"
            );
        }

        if (expression.type === "standardFunction") {
            if (
                expression.name === "count" ||
                expression.name === "value"
            ) {
                var functionNodes = P.evaluateExpressionPathNodes(
                    expression.argument,
                    current
                );
                if (expression.name === "count") {
                    return functionNodes.length;
                }
                return functionNodes.length === 1
                    ? functionNodes[0]
                    : RFC_NOTHING;
            }

            return rfcLengthValue(
                P.evaluateExpression(expression.argument, current)
            );
        }

        if (expression.type === "unary") {
            var unaryValue = P.evaluateExpression(expression.value, current);

            if (expression.operator === "!") {
                return !unaryValue;
            }

            if (expression.operator === "+") {
                return +unaryValue;
            }

            return -unaryValue;
        }

        if (expression.type === "binary") {
            var left = P.evaluateExpression(expression.left, current);

            if (expression.operator === "&&") {
                return left && P.evaluateExpression(expression.right, current);
            }

            if (expression.operator === "||") {
                return left || P.evaluateExpression(expression.right, current);
            }

            var right = P.evaluateExpression(expression.right, current);

            if (expression.operator === "===") {
                return left === right;
            }

            if (expression.operator === "!==") {
                return left !== right;
            }

            if (expression.operator === "==") {
                return left == right;
            }

            if (expression.operator === "!=") {
                return left != right;
            }

            if (expression.operator === "<") {
                return left < right;
            }

            if (expression.operator === "<=") {
                return left <= right;
            }

            if (expression.operator === ">") {
                return left > right;
            }

            if (expression.operator === ">=") {
                return left >= right;
            }

            if (expression.operator === "+") {
                return left + right;
            }

            if (expression.operator === "-") {
                return left - right;
            }

            if (expression.operator === "*") {
                return left * right;
            }

            if (expression.operator === "/") {
                return left / right;
            }

            if (expression.operator === "%") {
                return left % right;
            }
        }

        P.expressionError("Unsupported expression");
    },
    /**
     * Evaluates an expression path using historical predicate coercion.
     *
     * Paths containing filters become existence-test Booleans; other paths
     * yield their first value or `undefined`.
     *
     * @param {Object} path Path AST.
     * @param {*} current Current value represented by `@`.
     * @returns {*} Historical scalar or existence-test result.
     */
    evaluateExpressionPath: function (path, current) {
        var values = P.evaluateExpressionPathNodes(path, current);

        if (path.containsFilter) {
            return values.length > 0;
        }

        return values.length > 0 ? values[0] : undefined;
    },
    /**
     * Evaluates an expression path without discarding its nodelist.
     *
     * This representation is required for RFC `count()` and `value()` in
     * `GOESSNER_EXTENDED`.
     *
     * @param {Object} path Path AST.
     * @param {*} current Current value represented by `@`.
     * @returns {Array<*>} Selected values in traversal order.
     */
    evaluateExpressionPathNodes: function (path, current) {
        var values = [
            path.base === "root" ? P.root : current
        ];

        for (var i = 0; i < path.segments.length; i++) {
            var segment = path.segments[i];
            var next = [];

            if (segment.type === "filter") {
                for (var j = 0; j < values.length; j++) {
                    P.collectExpressionFilter(
                        values[j],
                        segment.expression,
                        next
                    );
                }
            }
            else if (segment.type === "wildcard") {
                for (var k = 0; k < values.length; k++) {
                    P.collectExpressionChildren(values[k], next);
                }
            }
            else {
                for (var m = 0; m < values.length; m++) {
                    P.collectExpressionMember(values[m], segment, next);
                }
            }

            values = next;
        }

        return values;
    },
    /**
     * Appends child values satisfying a nested safe filter expression.
     *
     * @param {*} value Container whose children are candidates.
     * @param {Object} expression Filter AST.
     * @param {Array<*>} out Destination nodelist values.
     * @returns {void}
     */
    collectExpressionFilter: function (value, expression, out) {
        var candidates = [];
        P.collectExpressionChildren(value, candidates);

        for (var i = 0; i < candidates.length; i++) {
            if (
                P.expressionIsCurrentNode(expression) ||
                P.evaluateExpression(expression, candidates[i])
            ) {
                out[out.length] = candidates[i];
            }
        }
    },
    /**
     * Recognizes the bare `@` existence expression.
     *
     * @param {Object} expression Expression AST.
     * @returns {boolean} Whether the expression denotes the current node.
     */
    expressionIsCurrentNode: function (expression) {
        return (
            expression.type === "path" &&
            expression.base === "current" &&
            expression.segments.length === 0
        );
    },
    /**
     * Appends all own array elements or object member values.
     *
     * @param {*} value Candidate container.
     * @param {Array<*>} out Destination nodelist values.
     * @returns {void}
     */
    collectExpressionChildren: function (value, out) {
        if (value instanceof Array) {
            for (var i = 0; i < value.length; i++) {
                if (i in value) {
                    out[out.length] = value[i];
                }
            }
        }
        else if (value !== null && typeof value === "object") {
            for (var key in value) {
                if (value.hasOwnProperty(key)) {
                    out[out.length] = value[key];
                }
            }
        }
    },
    /**
     * Appends a selected own member, resolving negative array indices.
     *
     * @param {*} value Candidate container.
     * @param {Object} segment Property or index segment.
     * @param {Array<*>} out Destination nodelist values.
     * @returns {void}
     */
    collectExpressionMember: function (value, segment, out) {
        if (value === null || typeof value === "undefined") {
            return;
        }

        var key = segment.key;

        if (
            segment.type === "index" &&
            value instanceof Array &&
            key < 0
        ) {
            key = value.length + key;
        }

        var boxed = Object(value);

        if (Object.prototype.hasOwnProperty.call(boxed, key)) {
            out[out.length] = boxed[key];
        }
    },
    /**
     * Tests the first character of a historical expression identifier.
     *
     * @param {string} ch Character to test.
     * @returns {boolean} Whether the character may start an identifier.
     */
    isIdentStart: function (ch) {
        return /[A-Za-z_$]/.test(ch);
    },
    /**
     * Tests a subsequent character of a historical expression identifier.
     *
     * @param {string} ch Character to test.
     * @returns {boolean} Whether the character may continue an identifier.
     */
    isIdent: function (ch) {
        return /[A-Za-z0-9_$]/.test(ch);
    },
    /**
     * Escapes text for an internally generated double-quoted JavaScript string.
     *
     * @param {string} s Text to escape.
     * @returns {string} Escaped text without surrounding quotes.
     */
    quote: function (s) {
        return s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
    },
    /**
     * Rewrites nested filter paths for the explicitly unsafe compatibility
     * evaluator without changing the binding of inner `@` identifiers.
     *
     * @param {string} x Historical JavaScript expression.
     * @returns {string} Expression with nested paths replaced by helper calls.
     */
    rewriteNestedFilters: function (x) {
        var out = "";
        var i = 0;

        while (i < x.length) {
            if (x.charAt(i) !== "@") {
                out += x.charAt(i);
                i++;
                continue;
            }

            var start = i;
            var j = i + 1;
            var path = "";
            var hasFilter = false;

            while (j < x.length) {
                var ch = x.charAt(j);

                if (ch === ".") {
                    var k = j + 1;

                    if (!P.isIdentStart(x.charAt(k))) {
                        break;
                    }

                    while (k < x.length && P.isIdent(x.charAt(k))) {
                        k++;
                    }

                    if (x.charAt(k) === "(") {
                        break;
                    }

                    path += x.substring(j, k);
                    j = k;
                }
                else if (ch === "[") {
                    var end = P.findClosingBracket(x, j);

                    if (end === -1) {
                        break;
                    }

                    var part = x.substring(j, end + 1);

                    if (/^\[\?\(/.test(part)) {
                        hasFilter = true;
                    }

                    path += part;
                    j = end + 1;
                }
                else {
                    break;
                }
            }

            if (hasFilter && path) {
                var quotedPath = P.quote(path).replace(/@/g, "\\x40");
                out += 'P.nestedFilterExists(_v,"' + quotedPath + '")';
                i = j;
            }
            else {
                out += "@";
                i = start + 1;
            }
        }

        return out;
    },
    /**
     * Evaluates a rewritten nested path as an existence test.
     *
     * @param {*} base Value on which the nested path starts.
     * @param {string} path Nested path source.
     * @returns {boolean} Whether at least one node is selected.
     */
    nestedFilterExists: function (base, path) {
        var tokens = P.tokenizeNestedPath(path);
        var current = [base];

        for (var i = 0; i < tokens.length; i++) {
            var next = [];

            if (tokens[i].type === "filter") {
                for (var j = 0; j < current.length; j++) {
                    P.collectFiltered(
                        current[j],
                        tokens[i].expression,
                        next
                    );
                }
            }
            else {
                for (var k = 0; k < current.length; k++) {
                    P.collectNested(current[k], tokens[i], next);
                }
            }

            current = next;
        }

        return current.length > 0;
    },
    /**
     * Appends children matching a nested historical filter expression.
     *
     * @param {*} val Container whose children are candidates.
     * @param {string} expression Historical filter expression.
     * @param {Array<*>} out Destination nodelist values.
     * @returns {void}
     */
    collectFiltered: function (val, expression, out) {
        P.walk(
            expression,
            "",
            val,
            "",
            function (m, filterExpression, x, container) {
                if (
                    filterExpression === "@" ||
                    P.evaluate(filterExpression, container[m], m)
                ) {
                    out[out.length] = container[m];
                }
            }
        );
    },
    /**
     * Tokenizes a nested compatibility path for unsafe-expression rewriting.
     *
     * @param {string} path Nested path source.
     * @returns {Array<Object>} Property, index, wildcard, and filter tokens.
     */
    tokenizeNestedPath: function (path) {
        var tokens = [];
        var i = 0;

        while (i < path.length) {
            var ch = path.charAt(i);

            if (ch === ".") {
                var j = i + 1;

                while (j < path.length && P.isIdent(path.charAt(j))) {
                    j++;
                }

                tokens[tokens.length] = {
                    type: "property",
                    key: path.substring(i + 1, j)
                };

                i = j;
            }
            else if (ch === "[") {
                var bracketEnd = P.findClosingBracket(path, i);

                if (bracketEnd === -1) {
                    return tokens;
                }

                var inner = path.substring(i + 1, bracketEnd);

                if (inner === "*") {
                    tokens[tokens.length] = {
                        type: "wildcard"
                    };
                }
                else if (/^-?[0-9]+$/.test(inner)) {
                    tokens[tokens.length] = {
                        type: "index",
                        key: parseInt(inner, 10)
                    };
                }
                else if (
                    (inner.charAt(0) === "'" && inner.charAt(inner.length - 1) === "'") ||
                    (inner.charAt(0) === "\"" && inner.charAt(inner.length - 1) === "\"")
                ) {
                    tokens[tokens.length] = {
                        type: "property",
                        key: inner.substring(1, inner.length - 1)
                    };
                }
                else if (
                    inner.indexOf("?(") === 0 &&
                    inner.charAt(inner.length - 1) === ")"
                ) {
                    tokens[tokens.length] = {
                        type: "filter",
                        expression: inner.substring(2, inner.length - 1)
                    };
                }

                i = bracketEnd + 1;
            }
            else {
                i++;
            }
        }

        return tokens;
    },
    /**
     * Applies one token of a rewritten nested compatibility path.
     *
     * @param {*} val Current candidate value.
     * @param {Object} token Property, index, or wildcard token.
     * @param {Array<*>} out Destination nodelist values.
     * @returns {void}
     */
    collectNested: function (val, token, out) {
        if (val === null || typeof val === "undefined") {
            return;
        }

        if (token.type === "wildcard") {
            if (val instanceof Array) {
                for (var i = 0; i < val.length; i++) {
                    if (i in val) {
                        out[out.length] = val[i];
                    }
                }
            }
            else if (typeof val === "object") {
                for (var m in val) {
                    if (val.hasOwnProperty(m)) {
                        out[out.length] = val[m];
                    }
                }
            }
        }
        else {
            var key = token.key;

            if (token.type === "index" && val instanceof Array && key < 0) {
                key = val.length + key;
            }

            if (val && typeof val === "object" && val.hasOwnProperty(key)) {
                out[out.length] = val[key];
            }
        }
    },

    /**
     * Continues tracing from the parent of an internal result path.
     *
     * @param {string} expr Remaining trace expression.
     * @param {string} path Current internal path.
     * @returns {void}
     */
    parent: function (expr, path) {
        var idx = path.lastIndexOf(";");

        if (idx <= 0) {
            return;
        }

        var parentPath = path.substring(0, idx);
        var parentValue = P.valueFromPath(parentPath);

        if (typeof parentValue !== "undefined") {
            P.trace(expr, parentValue, parentPath);
        }
    },

    /**
     * Resolves an internal path against the current root object.
     *
     * @param {string} path Semicolon-separated internal path.
     * @returns {*} Resolved value, or `undefined` for a missing branch.
     */
    valueFromPath: function (path) {
        var parts = path.split(";");
        var val = P.root;

        for (var i = 1; i < parts.length; i++) {
            if (val === null || typeof val === "undefined") {
                return undefined;
            }

            val = val[parts[i]];
        }

        return val;
    },

    /**
     * Applies the extended `??` selector to the current value itself.
     *
     * @param {string} loc Self-filter selector text.
     * @param {string} expr Remaining trace expression.
     * @param {*} val Current value.
     * @param {string} path Current internal path.
     * @returns {void}
     */
    selfFilter: function (loc, expr, val, path) {
        var filterExpr = P.unwrapFilterExpression(loc, true);

        if (P.evaluate(filterExpr, val, path.substr(path.lastIndexOf(";") + 1))) {
            P.trace(expr, val, path);
        }
    },

    /**
     * Removes the `?` or `??` prefix and optional full-expression parentheses.
     *
     * @param {string} loc Filter selector text.
     * @param {boolean} selfFilter Whether the selector starts with `??`.
     * @returns {string} Bare expression source.
     */
    unwrapFilterExpression: function (loc, selfFilter) {
        var expression = loc.substring(selfFilter ? 2 : 1);
        if (
            expression.charAt(0) === "(" &&
            expression.charAt(expression.length - 1) === ")"
        ) {
            return expression.substring(1, expression.length - 1);
        }
        return expression;
    },
};

/**
 * RFC 9535 evaluator.
 *
 * The historical Goessner evaluator above is intentionally kept intact for
 * GOESSNER_EXTENDED mode. RFC modes use a separate parser so malformed queries
 * cannot silently turn into an empty result and so that the two grammars do
 * not accidentally bleed into each other.
 */

/**
 * Sentinel representing the RFC 9535 `Nothing` result.
 *
 * It is intentionally distinct from JavaScript `undefined` and JSON `null`.
 * The same sentinel is shared with standard functions in the safe
 * `GOESSNER_EXTENDED` expression evaluator.
 *
 * @type {Object}
 */
var RFC_NOTHING = {};

/**
 * Node representation used only by the RFC evaluator.
 *
 * Keeping value, normalized path, and parent together makes `PATH` results and
 * the extended `^` operator deterministic without mutating the input object.
 *
 * @typedef {Object} RfcNode
 * @property {*} value JSON value represented by the node.
 * @property {string} path Normalized absolute JSONPath.
 * @property {RfcNode|null} parent Parent node, or `null` at the root.
 */

/**
 * Recursive-descent parser for strict RFC 9535 JSONPath queries.
 *
 * @constructor
 * @param {string} source Query source.
 * @param {boolean} allowExtensions Enables only the project-specific `??` and
 * `^` grammar used by `RFC9535_EXTENDED`.
 */
function RfcParser(source, allowExtensions) {
    this.source = source;
    this.index = 0;
    this.depth = 0;
    this.allowExtensions = allowExtensions === true;
}

/**
 * Throws a positioned RFC syntax error.
 *
 * @param {string} message Error description.
 * @throws {SyntaxError} Always.
 */
RfcParser.prototype.fail = function (message) {
    throw new SyntaxError(
        "jsonPath RFC9535: " + message + " at position " + this.index
    );
};

/**
 * Reads a source character without advancing the parser.
 *
 * @param {number=} offset Optional lookahead offset.
 * @returns {string} Character at the requested position, or an empty string.
 */
RfcParser.prototype.peek = function (offset) {
    return this.source.charAt(this.index + (offset || 0));
};

/**
 * Tests RFC JSONPath whitespace.
 *
 * @param {string} ch Character to test.
 * @returns {boolean} Whether it is an allowed whitespace character.
 */
RfcParser.prototype.isSpace = function (ch) {
    return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
};

/**
 * Advances past RFC JSONPath whitespace.
 *
 * @returns {void}
 */
RfcParser.prototype.skipSpace = function () {
    while (this.isSpace(this.peek())) {
        this.index++;
    }
};

/**
 * Enters one RFC grammar nesting level and enforces its resource limit.
 *
 * @returns {void}
 */
RfcParser.prototype.enter = function () {
    this.depth++;
    if (this.depth > 64) {
        this.fail("Query nesting exceeds 64 levels");
    }
};

/**
 * Leaves one RFC grammar nesting level.
 *
 * @returns {void}
 */
RfcParser.prototype.leave = function () {
    this.depth--;
};

/**
 * Consumes required source text at the current position.
 *
 * @param {string} value Required source text.
 * @returns {void}
 * @throws {SyntaxError} When the text is absent.
 */
RfcParser.prototype.expect = function (value) {
    if (this.source.substr(this.index, value.length) !== value) {
        this.fail("Expected '" + value + "'");
    }
    this.index += value.length;
};

/**
 * Tests the first character of an RFC member-name shorthand.
 *
 * @param {string} ch Character to test.
 * @returns {boolean} Whether the character may start the name.
 */
RfcParser.prototype.isNameFirst = function (ch) {
    if (!ch) {
        return false;
    }
    var code = ch.charCodeAt(0);
    return (
        (ch >= "A" && ch <= "Z") ||
        (ch >= "a" && ch <= "z") ||
        ch === "_" ||
        (code >= 0x80 && (code < 0xD800 || code > 0xDFFF))
    );
};

/**
 * Tests a subsequent character of an RFC member-name shorthand.
 *
 * @param {string} ch Character to test.
 * @returns {boolean} Whether the character may continue the name.
 */
RfcParser.prototype.isNameChar = function (ch) {
    return this.isNameFirst(ch) || (ch >= "0" && ch <= "9");
};

/**
 * Reads an RFC member-name shorthand.
 *
 * @returns {string} Member name.
 */
RfcParser.prototype.readName = function () {
    if (!this.isNameFirst(this.peek())) {
        this.fail("Expected a member-name shorthand");
    }
    var start = this.index++;
    while (this.isNameChar(this.peek())) {
        this.index++;
    }
    return this.source.substring(start, this.index);
};

/**
 * Reads a lowercase RFC function name.
 *
 * @returns {string} Function name.
 */
RfcParser.prototype.readFunctionName = function () {
    var ch = this.peek();
    if (!(ch >= "a" && ch <= "z")) {
        this.fail("Expected a lowercase function name");
    }
    var start = this.index++;
    while (true) {
        ch = this.peek();
        if ((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9") || ch === "_") {
            this.index++;
        }
        else {
            break;
        }
    }
    return this.source.substring(start, this.index);
};

/**
 * Reads exactly four hexadecimal digits from a Unicode escape.
 *
 * @returns {number} UTF-16 code unit.
 * @throws {SyntaxError} When four hexadecimal digits are not present.
 */
RfcParser.prototype.readHexEscape = function () {
    var raw = this.source.substr(this.index, 4);
    if (!/^[0-9A-Fa-f]{4}$/.test(raw)) {
        this.fail("Invalid Unicode escape");
    }
    this.index += 4;
    return parseInt(raw, 16);
};

/**
 * Reads an RFC string literal and validates Unicode surrogate pairs.
 *
 * @returns {string} Decoded string value.
 * @throws {SyntaxError} For invalid escapes, controls, or Unicode pairs.
 */
RfcParser.prototype.readString = function () {
    var quote = this.peek();
    var out = "";
    this.index++;

    while (this.index < this.source.length) {
        var ch = this.peek();
        var code = ch.charCodeAt(0);

        if (ch === quote) {
            this.index++;
            return out;
        }
        if (code <= 0x1F) {
            this.fail("Unescaped control character in string literal");
        }
        if (ch !== "\\") {
            if (code >= 0xD800 && code <= 0xDBFF) {
                var low = this.peek(1).charCodeAt(0);
                if (!(low >= 0xDC00 && low <= 0xDFFF)) {
                    this.fail("Unpaired high surrogate in string literal");
                }
                out += ch + this.peek(1);
                this.index += 2;
                continue;
            }
            if (code >= 0xDC00 && code <= 0xDFFF) {
                this.fail("Unpaired low surrogate in string literal");
            }
            out += ch;
            this.index++;
            continue;
        }

        this.index++;
        ch = this.peek();
        this.index++;
        if (ch === "b") out += "\b";
        else if (ch === "t") out += "\t";
        else if (ch === "n") out += "\n";
        else if (ch === "f") out += "\f";
        else if (ch === "r") out += "\r";
        else if (ch === "\\" || ch === "/" || ch === quote) out += ch;
        else if (ch === "u") {
            var first = this.readHexEscape();
            if (first >= 0xD800 && first <= 0xDBFF) {
                if (this.source.substr(this.index, 2) !== "\\u") {
                    this.fail("High surrogate must be followed by a low surrogate");
                }
                this.index += 2;
                var second = this.readHexEscape();
                if (!(second >= 0xDC00 && second <= 0xDFFF)) {
                    this.fail("Invalid low surrogate");
                }
                out += String.fromCharCode(first, second);
            }
            else if (first >= 0xDC00 && first <= 0xDFFF) {
                this.fail("Unpaired low surrogate escape");
            }
            else {
                out += String.fromCharCode(first);
            }
        }
        else {
            this.fail("Invalid escape sequence");
        }
    }
    this.fail("Unterminated string literal");
};

/**
 * Reads an integer selector within the I-JSON exact numeric range.
 *
 * @returns {number} Parsed integer.
 * @throws {SyntaxError} For leading zeroes, negative zero, or unsafe integers.
 */
RfcParser.prototype.readInteger = function () {
    var start = this.index;
    if (this.peek() === "-") {
        this.index++;
    }
    if (this.peek() === "0") {
        this.index++;
        if (/[0-9]/.test(this.peek())) {
            this.fail("Leading zero in integer");
        }
    }
    else {
        if (!(this.peek() >= "1" && this.peek() <= "9")) {
            this.fail("Expected an integer");
        }
        while (this.peek() >= "0" && this.peek() <= "9") {
            this.index++;
        }
    }
    var raw = this.source.substring(start, this.index);
    if (raw === "-0") {
        this.fail("Negative zero is not a valid integer selector");
    }
    var value = Number(raw);
    if (Math.abs(value) > 9007199254740991) {
        this.fail("Integer is outside the I-JSON exact range");
    }
    return value;
};

/**
 * Reads a finite JSON number used in a filter expression.
 *
 * @returns {number} Parsed number.
 * @throws {SyntaxError} For invalid JSON-number syntax or overflow.
 */
RfcParser.prototype.readNumber = function () {
    var start = this.index;
    if (this.peek() === "-") this.index++;
    if (this.peek() === "0") {
        this.index++;
        if (/[0-9]/.test(this.peek())) this.fail("Leading zero in number");
    }
    else {
        if (!(this.peek() >= "1" && this.peek() <= "9")) this.fail("Expected a number");
        while (this.peek() >= "0" && this.peek() <= "9") this.index++;
    }
    if (this.peek() === ".") {
        this.index++;
        if (!(this.peek() >= "0" && this.peek() <= "9")) this.fail("Expected fractional digits");
        while (this.peek() >= "0" && this.peek() <= "9") this.index++;
    }
    if (this.peek() === "e" || this.peek() === "E") {
        this.index++;
        if (this.peek() === "+" || this.peek() === "-") this.index++;
        if (!(this.peek() >= "0" && this.peek() <= "9")) this.fail("Expected exponent digits");
        while (this.peek() >= "0" && this.peek() <= "9") this.index++;
    }
    var raw = this.source.substring(start, this.index);
    var value = Number(raw);
    if (!isFinite(value)) this.fail("Number is outside the supported range");
    return value;
};

/**
 * Parses and validates a complete absolute JSONPath query.
 *
 * @returns {Object} Root query AST.
 * @throws {SyntaxError} For malformed or unsupported syntax.
 */
RfcParser.prototype.parse = function () {
    if (typeof this.source !== "string" || this.source.length === 0) {
        this.fail("Query must be a non-empty string");
    }
    if (this.source.length > 4096) {
        this.fail("Query exceeds 4096 characters");
    }
    if (this.peek() !== "$") {
        this.fail("Query must start with '$'");
    }
    var query = this.parseQuery();
    if (this.index !== this.source.length) {
        this.fail("Unexpected token '" + this.peek() + "'");
    }
    return query;
};

/**
 * Parses an absolute (`$`) or filter-relative (`@`) query.
 *
 * The returned `singular` flag records whether RFC implicit NodesType-to-
 * ValueType conversion is permitted in comparisons and function arguments.
 *
 * @returns {Object} Query AST.
 */
RfcParser.prototype.parseQuery = function () {
    var base = this.peek();
    if (base !== "$" && base !== "@") this.fail("Expected '$' or '@'");
    this.index++;
    var query = { type: "query", base: base, segments: [], singular: true };
    while (true) {
        var beforeSpace = this.index;
        this.skipSpace();
        if (
            this.peek() !== "." &&
            this.peek() !== "[" &&
            !(this.allowExtensions && this.peek() === "^")
        ) {
            this.index = beforeSpace;
            break;
        }
        var segment = this.parseSegment();
        query.segments[query.segments.length] = segment;
        if (
            !segment.parent &&
            (
                segment.descendant ||
                segment.selectors.length !== 1 ||
                (segment.selectors[0].type !== "name" && segment.selectors[0].type !== "index")
            )
        ) {
            query.singular = false;
        }
    }
    return query;
};

/**
 * Parses one child, descendant, bracket, or extended parent segment.
 *
 * @returns {Object} Segment AST.
 */
RfcParser.prototype.parseSegment = function () {
    var descendant = false;
    var selectors;
    if (this.peek() === "^") {
        if (!this.allowExtensions) this.fail("Parent operator is not valid RFC 9535 syntax");
        this.index++;
        return { parent: true, descendant: false, selectors: [] };
    }
    if (this.peek() === ".") {
        this.index++;
        if (this.peek() === ".") {
            descendant = true;
            this.index++;
        }
        if (this.peek() === "[") {
            selectors = this.parseBracketSelection();
        }
        else if (this.peek() === "*") {
            this.index++;
            selectors = [{ type: "wildcard" }];
        }
        else {
            selectors = [{ type: "name", key: this.readName() }];
        }
    }
    else {
        selectors = this.parseBracketSelection();
    }
    return { descendant: descendant, selectors: selectors };
};

/**
 * Parses a non-empty comma-separated bracket selection.
 *
 * @returns {Array<Object>} Selector AST nodes.
 */
RfcParser.prototype.parseBracketSelection = function () {
    var selectors = [];
    this.expect("[");
    this.skipSpace();
    if (this.peek() === "]") this.fail("A segment must contain a selector");
    while (true) {
        selectors[selectors.length] = this.parseSelector();
        this.skipSpace();
        if (this.peek() === "]") {
            this.index++;
            return selectors;
        }
        this.expect(",");
        this.skipSpace();
        if (this.peek() === "]") this.fail("Trailing comma in segment");
    }
};

/**
 * Parses one name, wildcard, index, slice, filter, or extended self-filter.
 *
 * @returns {Object} Selector AST.
 */
RfcParser.prototype.parseSelector = function () {
    var ch = this.peek();
    if (ch === "'" || ch === "\"") {
        return { type: "name", key: this.readString() };
    }
    if (ch === "*") {
        this.index++;
        return { type: "wildcard" };
    }
    if (ch === "?") {
        this.index++;
        var selfFilter = false;
        if (this.peek() === "?") {
            if (!this.allowExtensions) this.fail("Self-filter is not valid RFC 9535 syntax");
            selfFilter = true;
            this.index++;
        }
        this.skipSpace();
        this.enter();
        var expression = this.parseLogicalOr();
        this.leave();
        return {
            type: selfFilter ? "selfFilter" : "filter",
            expression: expression
        };
    }

    var start = null;
    if (ch === ":") {
        return this.parseSlice(null);
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
        start = this.readInteger();
        var saved = this.index;
        this.skipSpace();
        if (this.peek() === ":") return this.parseSlice(start);
        this.index = saved;
        return { type: "index", index: start };
    }
    this.fail("Unsupported selector");
};

/**
 * Reads an optional integer bound or step from a slice selector.
 *
 * @returns {number|null} Parsed integer, or `null` when omitted.
 */
RfcParser.prototype.readOptionalSliceInteger = function () {
    this.skipSpace();
    var ch = this.peek();
    if (ch === "-" || (ch >= "0" && ch <= "9")) return this.readInteger();
    return null;
};

/**
 * Parses the remainder of an RFC array slice.
 *
 * @param {number|null} start Previously parsed start bound.
 * @returns {Object} Slice selector AST.
 */
RfcParser.prototype.parseSlice = function (start) {
    this.skipSpace();
    this.expect(":");
    var end = this.readOptionalSliceInteger();
    this.skipSpace();
    var step = null;
    if (this.peek() === ":") {
        this.index++;
        step = this.readOptionalSliceInteger();
        this.skipSpace();
        if (this.peek() === ":") this.fail("Slice contains too many colons");
    }
    return { type: "slice", start: start, end: end, step: step };
};

/**
 * Parses an RFC logical expression, beginning at the lowest-precedence `||`.
 *
 * @returns {Object} Logical-expression AST.
 */
RfcParser.prototype.parseLogicalOr = function () {
    var left = this.parseLogicalAnd();
    this.skipSpace();
    while (this.source.substr(this.index, 2) === "||") {
        this.index += 2;
        this.skipSpace();
        left = { type: "or", left: left, right: this.parseLogicalAnd() };
        this.skipSpace();
    }
    return left;
};

/**
 * Parses left-associative RFC logical AND expressions.
 *
 * @returns {Object} Logical-expression AST.
 */
RfcParser.prototype.parseLogicalAnd = function () {
    var left = this.parseBasicExpression();
    this.skipSpace();
    while (this.source.substr(this.index, 2) === "&&") {
        this.index += 2;
        this.skipSpace();
        left = { type: "and", left: left, right: this.parseBasicExpression() };
        this.skipSpace();
    }
    return left;
};

/**
 * Parses grouping, negation, comparisons, existence tests, and LogicalType
 * function tests.
 *
 * @returns {Object} Basic logical-expression AST.
 */
RfcParser.prototype.parseBasicExpression = function () {
    var negate = false;
    if (this.peek() === "!") {
        negate = true;
        this.index++;
        this.skipSpace();
    }
    var expression;
    if (this.peek() === "(") {
        this.index++;
        this.skipSpace();
        this.enter();
        expression = this.parseLogicalOr();
        this.leave();
        this.skipSpace();
        this.expect(")");
    }
    else {
        var left = this.parseOperand();
        this.skipSpace();
        var operator = this.readComparisonOperator();
        if (operator) {
            if (!this.isComparable(left)) this.fail("Left operand is not comparable");
            this.skipSpace();
            var right = this.parseOperand();
            if (!this.isComparable(right)) this.fail("Right operand is not comparable");
            expression = { type: "compare", operator: operator, left: left, right: right };
        }
        else if (left.type === "query") {
            expression = { type: "exists", query: left };
        }
        else if (left.valueType === "logical" || left.valueType === "nodes") {
            expression = { type: "functionTest", call: left };
        }
        else {
            this.fail("A ValueType expression must be compared");
        }
    }
    return negate ? { type: "not", expression: expression } : expression;
};

/**
 * Reads an optional RFC comparison operator.
 *
 * @returns {string|null} Operator text, or `null` when none is present.
 */
RfcParser.prototype.readComparisonOperator = function () {
    var two = this.source.substr(this.index, 2);
    if (two === "==" || two === "!=" || two === "<=" || two === ">=") {
        this.index += 2;
        return two;
    }
    var one = this.peek();
    if (one === "<" || one === ">") {
        this.index++;
        return one;
    }
    return null;
};

/**
 * Determines whether an operand can participate in an RFC comparison.
 *
 * @param {Object} operand Operand AST.
 * @returns {boolean} Whether it supplies ValueType semantics.
 */
RfcParser.prototype.isComparable = function (operand) {
    return (
        operand.type === "literal" ||
        (operand.type === "query" && operand.singular) ||
        (operand.type === "function" && operand.valueType === "value")
    );
};

/**
 * Parses a query, literal, or standard function operand.
 *
 * @returns {Object} Operand AST carrying its RFC result type where applicable.
 */
RfcParser.prototype.parseOperand = function () {
    var ch = this.peek();
    if (ch === "$" || ch === "@") return this.parseQuery();
    if (ch === "'" || ch === "\"") {
        return { type: "literal", value: this.readString(), valueType: "value" };
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
        return { type: "literal", value: this.readNumber(), valueType: "value" };
    }
    if (this.source.substr(this.index, 4) === "true" && !this.isNameChar(this.peek(4))) {
        this.index += 4;
        return { type: "literal", value: true, valueType: "value" };
    }
    if (this.source.substr(this.index, 5) === "false" && !this.isNameChar(this.peek(5))) {
        this.index += 5;
        return { type: "literal", value: false, valueType: "value" };
    }
    if (this.source.substr(this.index, 4) === "null" && !this.isNameChar(this.peek(4))) {
        this.index += 4;
        return { type: "literal", value: null, valueType: "value" };
    }
    if (ch >= "a" && ch <= "z") return this.parseFunction();
    this.fail("Expected a query, literal, or function expression");
};

/**
 * Parses an RFC 9535 standard function and validates its signature.
 *
 * Supported functions are `length`, `count`, `match`, `search`, and `value`.
 *
 * @returns {Object} Typed function-call AST.
 * @throws {SyntaxError} For unknown functions, arity errors, or type mismatch.
 */
RfcParser.prototype.parseFunction = function () {
    var name = this.readFunctionName();
    if (this.peek() !== "(") this.fail("Function name must be followed by '('");
    this.index++;
    this.skipSpace();
    var args = [];
    if (this.peek() !== ")") {
        while (true) {
            args[args.length] = this.parseFunctionArgument();
            this.skipSpace();
            if (this.peek() === ")") break;
            this.expect(",");
            this.skipSpace();
        }
    }
    this.expect(")");

    var signatures = {
        length: { args: ["value"], result: "value" },
        count: { args: ["nodes"], result: "value" },
        match: { args: ["value", "value"], result: "logical" },
        search: { args: ["value", "value"], result: "logical" },
        value: { args: ["nodes"], result: "value" }
    };
    var signature = signatures[name];
    if (!signature) this.fail("Unknown function '" + name + "'");
    if (args.length !== signature.args.length) this.fail("Function '" + name + "' has the wrong number of arguments");
    for (var i = 0; i < args.length; i++) {
        if (!this.functionArgumentMatches(args[i], signature.args[i])) {
            this.fail("Function '" + name + "' argument " + (i + 1) + " has the wrong type");
        }
    }
    return { type: "function", name: name, args: args, valueType: signature.result };
};

/**
 * Parses one standard-function argument.
 *
 * @returns {Object} Query, literal, or nested function AST.
 */
RfcParser.prototype.parseFunctionArgument = function () {
    return this.parseOperand();
};

/**
 * Checks RFC function-argument typing and singular-query conversion.
 *
 * @param {Object} argument Argument AST.
 * @param {string} expected Expected `nodes` or `value` type.
 * @returns {boolean} Whether the argument can supply the expected type.
 */
RfcParser.prototype.functionArgumentMatches = function (argument, expected) {
    if (expected === "nodes") {
        return argument.type === "query" || (argument.type === "function" && argument.valueType === "nodes");
    }
    if (expected === "value") {
        return (
            argument.type === "literal" ||
            (argument.type === "query" && argument.singular) ||
            (argument.type === "function" && argument.valueType === "value")
        );
    }
    return false;
};

/**
 * Enumerates the immediate children of an RFC node.
 *
 * @param {Object} node Node containing `value`, normalized `path`, and parent.
 * @returns {Array<Object>} Child nodes in array or object iteration order.
 */
function rfcChildren(node) {
    var out = [];
    var value = node.value;
    var i;
    if (value instanceof Array) {
        for (i = 0; i < value.length; i++) {
            if (i in value) out[out.length] = { value: value[i], path: node.path + "[" + i + "]", parent: node };
        }
    }
    else if (value !== null && typeof value === "object") {
        for (var key in value) {
            if (value.hasOwnProperty(key)) {
                out[out.length] = { value: value[key], path: node.path + rfcPathName(key), parent: node };
            }
        }
    }
    return out;
}

/**
 * Encodes an object member name for normalized JSONPath output.
 *
 * @param {string} name Object member name.
 * @returns {string} Single-quoted bracket segment.
 */
function rfcPathName(name) {
    var escaped = "";
    for (var i = 0; i < name.length; i++) {
        var ch = name.charAt(i);
        var code = ch.charCodeAt(0);
        if (ch === "\\") escaped += "\\\\";
        else if (ch === "'") escaped += "\\'";
        else if (ch === "\b") escaped += "\\b";
        else if (ch === "\t") escaped += "\\t";
        else if (ch === "\n") escaped += "\\n";
        else if (ch === "\f") escaped += "\\f";
        else if (ch === "\r") escaped += "\\r";
        else if (code <= 0x1F) escaped += "\\u" + ("0000" + code.toString(16)).slice(-4);
        else escaped += ch;
    }
    return "['" + escaped + "']";
}

/**
 * Applies one RFC selector to one input node.
 *
 * @param {Object} selector Selector AST.
 * @param {Object} node Input node.
 * @param {Object} rootNode Absolute root node used by filter queries.
 * @returns {Array<Object>} Selected nodes.
 */
function rfcApplySelector(selector, node, rootNode) {
    var value = node.value;
    var out = [];
    var i;
    if (selector.type === "name") {
        if (value !== null && typeof value === "object" && !(value instanceof Array) && value.hasOwnProperty(selector.key)) {
            out[0] = { value: value[selector.key], path: node.path + rfcPathName(selector.key), parent: node };
        }
    }
    else if (selector.type === "wildcard") {
        out = rfcChildren(node);
    }
    else if (selector.type === "index") {
        if (value instanceof Array) {
            var index = selector.index < 0 ? value.length + selector.index : selector.index;
            if (index >= 0 && index < value.length && index in value) {
                out[0] = { value: value[index], path: node.path + "[" + index + "]", parent: node };
            }
        }
    }
    else if (selector.type === "slice") {
        if (value instanceof Array) {
            var length = value.length;
            var step = selector.step === null ? 1 : selector.step;
            if (step === 0) return out;
            var normalize = function (bound) {
                return bound >= 0 ? bound : length + bound;
            };
            var rawStart = selector.start === null ? (step > 0 ? 0 : length - 1) : selector.start;
            var rawEnd = selector.end === null ? (step > 0 ? length : -length - 1) : selector.end;
            var normalizedStart = normalize(rawStart);
            var normalizedEnd = normalize(rawEnd);
            var start = step > 0
                ? Math.min(Math.max(normalizedStart, 0), length)
                : Math.min(Math.max(normalizedStart, -1), length - 1);
            var end = step > 0
                ? Math.min(Math.max(normalizedEnd, 0), length)
                : Math.min(Math.max(normalizedEnd, -1), length - 1);
            if (step > 0) {
                for (i = start; i < end; i += step) {
                    if (i in value) out[out.length] = { value: value[i], path: node.path + "[" + i + "]", parent: node };
                }
            }
            else {
                for (i = start; i > end; i += step) {
                    if (i in value) out[out.length] = { value: value[i], path: node.path + "[" + i + "]", parent: node };
                }
            }
        }
    }
    else if (selector.type === "filter") {
        var children = rfcChildren(node);
        for (i = 0; i < children.length; i++) {
            if (rfcEvaluateLogical(selector.expression, rootNode, children[i])) out[out.length] = children[i];
        }
    }
    else if (selector.type === "selfFilter") {
        if (rfcEvaluateLogical(selector.expression, rootNode, node)) out[0] = node;
    }
    return out;
}

/**
 * Applies a child, descendant, or extended parent segment to a nodelist.
 *
 * @param {Object} segment Segment AST.
 * @param {Array<Object>} input Input nodelist.
 * @param {Object} rootNode Absolute root node.
 * @returns {Array<Object>} Resulting nodelist.
 */
function rfcApplySegment(segment, input, rootNode) {
    var out = [];
    if (segment.parent) {
        for (var p = 0; p < input.length; p++) {
            if (input[p].parent) out[out.length] = input[p].parent;
        }
        return out;
    }
    var applyAt = function (node) {
        for (var s = 0; s < segment.selectors.length; s++) {
            var selected = rfcApplySelector(segment.selectors[s], node, rootNode);
            for (var x = 0; x < selected.length; x++) out[out.length] = selected[x];
        }
    };
    var visit = function (node) {
        applyAt(node);
        var children = rfcChildren(node);
        for (var c = 0; c < children.length; c++) visit(children[c]);
    };
    for (var i = 0; i < input.length; i++) {
        if (segment.descendant) visit(input[i]);
        else applyAt(input[i]);
    }
    return out;
}

/**
 * Evaluates a parsed query relative to the root or current filter node.
 *
 * @param {Object} query Query AST.
 * @param {Object} rootNode Absolute root node.
 * @param {Object} currentNode Current filter node.
 * @returns {Array<Object>} Selected RFC nodes.
 */
function rfcEvaluateQuery(query, rootNode, currentNode) {
    var nodes = [query.base === "$" ? rootNode : currentNode];
    for (var i = 0; i < query.segments.length; i++) {
        nodes = rfcApplySegment(query.segments[i], nodes, rootNode);
    }
    return nodes;
}

/**
 * Converts an RFC operand to ValueType semantics.
 *
 * Singular queries yield their only value; zero or multiple nodes yield
 * `RFC_NOTHING`.
 *
 * @param {Object} operand Operand AST.
 * @param {Object} rootNode Absolute root node.
 * @param {Object} currentNode Current filter node.
 * @returns {*} Operand value or `RFC_NOTHING`.
 */
function rfcOperandValue(operand, rootNode, currentNode) {
    if (operand.type === "literal") return operand.value;
    if (operand.type === "query") {
        var nodes = rfcEvaluateQuery(operand, rootNode, currentNode);
        return nodes.length === 1 ? nodes[0].value : RFC_NOTHING;
    }
    return rfcEvaluateFunction(operand, rootNode, currentNode);
}

/**
 * Performs RFC JSON-value equality without JavaScript coercion.
 *
 * @param {*} left Left JSON value.
 * @param {*} right Right JSON value.
 * @returns {boolean} Whether the values are structurally equal.
 */
function rfcDeepEqual(left, right) {
    if (left === right) return true;
    if (left === null || right === null || typeof left !== typeof right) return false;
    if (left instanceof Array || right instanceof Array) {
        if (!(left instanceof Array) || !(right instanceof Array) || left.length !== right.length) return false;
        for (var i = 0; i < left.length; i++) if (!rfcDeepEqual(left[i], right[i])) return false;
        return true;
    }
    if (typeof left === "object") {
        var leftKeys = [];
        var rightKeys = [];
        var key;
        for (key in left) if (left.hasOwnProperty(key)) leftKeys[leftKeys.length] = key;
        for (key in right) if (right.hasOwnProperty(key)) rightKeys[rightKeys.length] = key;
        if (leftKeys.length !== rightKeys.length) return false;
        for (i = 0; i < leftKeys.length; i++) {
            key = leftKeys[i];
            if (!right.hasOwnProperty(key) || !rfcDeepEqual(left[key], right[key])) return false;
        }
        return true;
    }
    return false;
}

/**
 * Applies RFC ordering only to two numbers or two strings.
 *
 * @param {*} left Left operand.
 * @param {*} right Right operand.
 * @returns {boolean} Strict ordering result, or `false` for incomparable types.
 */
function rfcLessThan(left, right) {
    if (left === RFC_NOTHING || right === RFC_NOTHING) return false;
    if (typeof left === "number" && typeof right === "number") return left < right;
    if (typeof left === "string" && typeof right === "string") return left < right;
    return false;
}

/**
 * Evaluates an RFC comparison, including `Nothing` semantics.
 *
 * @param {string} operator Comparison operator.
 * @param {*} left Left operand or `RFC_NOTHING`.
 * @param {*} right Right operand or `RFC_NOTHING`.
 * @returns {boolean} Comparison result.
 */
function rfcCompare(operator, left, right) {
    var equal = left === RFC_NOTHING || right === RFC_NOTHING
        ? left === RFC_NOTHING && right === RFC_NOTHING
        : rfcDeepEqual(left, right);
    if (operator === "==") return equal;
    if (operator === "!=") return !equal;
    if (operator === "<") return rfcLessThan(left, right);
    if (operator === ">") return rfcLessThan(right, left);
    if (operator === "<=") return rfcLessThan(left, right) || equal;
    return rfcLessThan(right, left) || equal;
}

/**
 * Counts Unicode scalar values rather than UTF-16 code units.
 *
 * @param {string} value String to measure.
 * @returns {number} Unicode scalar count.
 */
function rfcUnicodeLength(value) {
    var length = 0;
    for (var i = 0; i < value.length; i++) {
        var code = value.charCodeAt(i);
        if (code >= 0xD800 && code <= 0xDBFF && i + 1 < value.length) i++;
        length++;
    }
    return length;
}

/**
 * Implements the RFC `length()` function for strings, arrays, and objects.
 *
 * Shared by the RFC evaluator and safe `GOESSNER_EXTENDED` expressions.
 *
 * @param {*} value Candidate value.
 * @returns {number|Object} Length or `RFC_NOTHING` for an unsupported type.
 */
function rfcLengthValue(value) {
    if (typeof value === "string") return rfcUnicodeLength(value);
    if (value instanceof Array) return value.length;
    if (value !== null && value !== RFC_NOTHING && typeof value === "object") {
        var count = 0;
        for (var key in value) if (value.hasOwnProperty(key)) count++;
        return count;
    }
    return RFC_NOTHING;
}

/** Maximum UTF-16 source length accepted for one I-Regexp. */
var RFC_IREGEXP_MAX_PATTERN_LENGTH = 4096;

/** Maximum number of NFA states compiled from one I-Regexp. */
var RFC_IREGEXP_MAX_STATES = 16384;

/** Unicode 16.0 category ranges, delta-encoded as base-36 pairs. */
var RFC_UNICODE_CATEGORY_DATA = {
Ll: "2p.p.1m.0.15.n.1.7.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.1.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.1.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.2.0.1.0.1.2.2.0.1.0.2.0.3.1.4.0.2.0.3.2.2.0.2.0.1.0.1.0.2.0.1.1.1.0.2.0.3.0.1.0.2.1.2.2.6.0.2.0.2.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.1.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.1.2.0.1.0.3.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.6.2.0.2.1.1.0.4.0.1.0.1.0.1.0.1.1w.1.q.5d.0.1.0.3.0.3.2.i.0.r.y.1.1.3.2.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.4.1.0.2.0.2.1.1f.1b.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.9.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.2.0.1.0.1.0.1.0.1.0.1.0.1.1.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1c.14.287.16.2.2.l4.5.1oi.8.1.0.39.17.1r.c.1.x.2u.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.8.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.8.8.5.a.7.8.7.8.5.a.7.8.7.8.d.2.7.8.7.8.7.8.4.1.1.6.0.3.2.1.1.8.3.2.1.8.7.a.2.1.1.7m.0.3.1.3.0.r.0.4.0.4.0.2.1.8.3.4.0.1h.0.23v.1b.1.0.3.1.1.0.1.0.1.0.4.0.1.1.1.5.5.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.1.7.0.1.0.4.0.c.11.1.0.5.0.nwz.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.j.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.3r.0.1.0.1.0.1.0.1.0.1.0.1.2.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.7.1.0.1.0.2.0.1.0.1.0.1.0.1.0.4.0.1.0.2.0.1.2.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.5.0.5.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.4.0.1.0.2.0.3.0.1.0.1.0.1.0.1.0.1.0.q.0.3.0.mt.16.5.8.7.27.fnk.6.c.4.tl.p.y5.13.3s.z.4b.a.1.e.1.6.1.1.1dv.1e.3h.l.27u.v.gw0.v.k2i.p.q.6.1.h.q.p.q.3.1.0.1.6.1.a.q.p.q.p.q.p.q.p.q.p.q.p.q.p.q.p.q.r.s.o.1.5.q.o.1.5.q.o.1.5.q.o.1.5.q.o.1.5.1.0.1f8.9.1.j.6.5.1yv.x",
    Lm: "j4.h.4.b.e.4.7.0.1.0.3p.0.5.0.da.0.6e.0.4k.1.7h.1.4.0.v.0.9.0.3.0.4g.0.4n.0.yc.0.3j.0.fp.0.1cq.0.2z.0.gz.0.cw.5.4u.1q.d.0.y.10.j5.0.d.0.g.c.2cf.1.6p.0.5b.0.d1.0.17.4.5.0.2p.1.2l.2.lxy.0.yq.5.7i.0.36.0.s.1.3d.8.28.0.n.0.2x.2.3.1.d1.0.m.0.3t.0.30.0.l.1.2v.3.9.0.gli.0.19.1.1k0.5.1.15.1.8.13n.0.w.0.ij4.3.e4.2.14.1.fa.c.1s.1.1.0.cng.3.1.6.1.1.9ip.1p.5l.6.q5.0.v3.0",
    Lo: "4q.0.f.0.74.0.4.3.5s.0.mz.q.4.3.19.v.1.9.z.1.1.2q.1.0.o.1.a.2.2.0.g.0.1.t.t.2g.b.0.o.w.l.l.16.o.7.a.5.n.1.5.h.14.1n.1h.3.0.i.0.7.9.g.e.4.7.2.1.2.l.1.6.1.0.3.3.3.0.g.0.d.1.1.2.e.1.a.0.8.5.4.1.2.l.1.6.1.1.1.1.1.1.v.3.1.0.j.2.g.8.1.2.1.l.1.6.1.1.1.4.3.0.i.0.f.1.n.0.b.7.2.1.2.l.1.6.1.1.1.4.3.0.u.1.1.2.f.0.h.0.1.5.3.2.1.3.3.1.1.0.1.1.3.1.3.2.3.b.m.0.1g.7.1.2.1.m.1.f.3.0.q.2.2.0.2.1.u.0.4.7.1.2.1.m.1.9.1.4.3.0.v.1.1.1.f.1.h.8.1.2.1.14.2.0.g.0.5.2.8.2.o.5.5.h.3.n.1.8.1.0.2.6.1m.1b.1.1.c.5.1n.1.1.0.1.4.1.n.1.0.1.9.1.1.9.0.2.4.n.3.w.0.1r.7.1.z.r.4.37.16.k.0.g.5.4.3.3.0.3.1.7.2.4.c.c.0.35.94.1.3.2.6.1.0.1.3.2.14.1.3.2.w.1.3.2.6.1.0.1.3.2.e.1.1k.1.3.2.1u.11.f.35.h7.2.g.1.p.5.22.6.7.7.h.d.i.e.h.e.c.1.2.f.1f.14.0.1v.y.1.1g.7.4.2.x.1.0.5.1x.a.u.1d.t.2.4.b.17.4.p.1i.m.9.1g.4w.1a.h.7.1i.t.d.1.a.17.q.z.15.2.a.t.35.3.1.5.1.1.3.0.u2.3.2d3.1j.o.m.9.6.1.6.1.6.1.6.1.6.1.6.1.6.1.6.fb.0.1h.0.4.2d.8.0.1.2h.4.0.5.16.1.2l.h.v.1c.f.e8.533.1s.g7o.1.vq.1v.13.8.7f.4.f.a.1.1u.0.1d.1x.4p.0.2v.0.3.6.1.2.1.3.1.m.t.1f.e.1d.1q.5.3.0.1.1.b.r.a.m.p.s.7.1a.19.4.2.8.a.4.1.14.n.2.1.7.k.f.1.5.3.0.3.1d.1.0.3.1.2.4.2.0.1.0.o.1.3.a.7.0.e.5.2.5.2.5.9.6.1.6.41.y.t.8mb.c.m.4.1c.6is.a5.2.2x.1v.0.1.9.1.c.1.4.1.0.1.1.1.1.1.2z.x.a2.i.1r.2.1h.14.b.38.4.1.3q.2x.9.1.18.2.u.3.5.2.5.2.5.2.2.z.b.1.p.1.i.1.1.1.e.2.d.y.3e.at.s.3.1c.1b.v.d.j.1.7.6.11.a.t.2.z.4.7.3k.25.2q.13.8.1f.2k.1f.c.8m.9.l.a.7.48.5.2.0.1.17.1.1.3.0.2.m.a.m.9.u.1t.i.1.1.a.l.a.p.1y.1j.6.1.1s.0.f.3.1.2.1.s.16.s.3.s.z.7.1.r.r.1h.a.l.a.i.d.h.32.20.53.z.12.3.1.0.8g.15.6.1.g.2.1n.s.a.0.8.l.16.h.1a.k.r.m.c.1g.1l.1.2.0.d.18.w.o.q.z.t.0.2.0.8.y.3.0.c.1b.e.3.l.0.1.0.z.h.1.o.j.1.1r.6.1.0.1.3.1.e.1.9.7.1a.12.7.2.1.2.l.1.6.1.1.1.4.3.0.i.0.c.4.u.9.1.0.2.0.1.11.1.0.p.0.1.0.18.1g.i.3.k.2.u.1b.k.1.1.0.54.1a.15.3.10.1b.k.0.1n.16.d.0.1z.q.11.6.55.17.5v.7.2.0.2.7.1.1.1.n.f.0.1.0.2m.7.2.12.g.0.1.0.s.0.a.13.7.0.l.0.b.19.j.0.i.20.5j.w.v.8.1.10.h.0.1d.t.34.6.1.1.1.11.l.0.p.5.1.1.1.v.e.0.93.i.f.0.1.c.1.x.3g.0.27.pl.6e.5f.218.2o.f.tr.h.5.p.32y.5.g6.5a1.t.1cy.fs.7.u.h.26.h.t.i.1b.1f.k.5.i.c3.13.b9.22.5.0.4v.4qf.8.yd.15.9.6wn.82.f.0.t.2.2.0.e.3.8.az.1s4.2y.5.c.3.8.7.9.6sw.0.dx.18.x.0.8x.t.i.17.dg.q.6d.t.2.0.dr.6.1.3.1.1.1.e.1.5g.117.3.1.q.1.1.1.0.2.0.1.9.1.3.1.0.1.0.6.0.4.0.1.0.1.0.1.2.1.1.1.0.2.0.1.0.1.0.1.0.1.0.1.1.1.0.2.3.1.6.1.3.1.3.1.0.1.9.1.g.5.2.1.4.1.g.3es.wyn.w.37d.6.65.2.4g1.e.5rk.f.h9.1wi.f1.15u.3t6.5.38f",
    Lt: "cl.0.2.0.2.0.12.0.5ud.7.8.7.8.7.c.0.f.0.1b.0",
    Lu: "1t.p.2t.m.1.6.x.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.2.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.2.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.1.1.0.1.0.3.1.1.0.1.1.1.2.2.3.1.1.1.2.3.1.1.1.1.0.1.0.1.1.1.0.2.0.1.1.1.2.1.0.1.1.3.0.7.0.2.0.2.0.2.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.2.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.2.0.2.0.1.2.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.7.1.1.1.2.0.1.3.1.0.1.0.1.0.1.0.81.0.1.0.3.0.8.0.6.0.1.2.1.0.1.1.1.g.1.8.z.0.2.2.3.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.5.0.2.0.1.1.2.1e.1c.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.9.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.1.1.0.1.0.1.0.1.0.1.0.1.0.2.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.2.11.289.11.1.0.5.0.k2.2d.1oz.0.6.16.2.2.8w.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.9.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.9.7.8.5.a.7.8.7.8.5.b.0.1.0.1.0.1.0.8.7.20.3.c.3.c.3.c.4.b.3.7a.0.4.0.3.2.2.2.2.0.3.4.6.0.1.0.1.0.1.3.2.3.a.1.5.0.1p.0.22k.1b.1c.0.1.2.2.0.1.0.1.0.1.3.1.0.2.0.8.2.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.8.0.1.0.4.0.nyl.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.j.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.3r.0.1.0.1.0.1.0.1.0.1.0.1.0.3.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.a.0.1.0.1.1.1.0.1.0.1.0.1.0.4.0.1.0.2.0.1.0.3.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.4.1.4.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.3.1.0.1.1.3.0.5.0.1.0.1.0.1.0.o.0.h7v.p.xx.13.3s.z.4c.a.1.e.1.6.1.1.1d6.1e.4d.l.27u.v.gw0.v.k2o.p.q.p.q.p.q.0.1.1.2.0.2.1.2.3.1.7.q.p.q.1.1.3.2.7.1.6.r.1.1.3.1.4.1.0.3.6.r.p.q.p.q.p.q.p.q.p.q.p.u.o.x.o.x.o.x.o.x.o.x.0.3ed.x",
    Mc: "1s3.0.1j.0.2.2.8.3.1.1.1e.1.1m.2.6.1.2.1.a.0.17.0.1m.2.1u.0.1m.2.8.0.1.1.1h.1.1m.0.1.0.6.1.2.1.a.0.2u.1.1.1.3.2.1.2.a.0.15.2.1p.3.1p.1.1m.0.1.4.2.1.1.1.9.1.s.0.e.1.1m.2.5.2.1.2.a.0.16.1.23.2.6.7.i.1.96.1.1r.0.4r.1.4.0.6.0.2.1.p.1.a.2.2.6.l.1.2.5.2.0.a.2.1a0.0.u.0.3l.0.7.7.1.1.9m.3.2.2.4.1.1.5.68.1.1m.0.1.0.9.0.1.1.8.5.41.0.1c.0.5.0.1.4.1.1.1p.0.u.0.4.1.2.0.1o.0.2.2.1.0.3.1.1c.7.8.1.4r.0.l.0.3sm.1.noz.1.2.0.2g.1.1e.f.3y.1.1b.0.1c.1.4.1.2.2.32.1.2.1.o.0.19.0.1.0.31.0.2.1.5.0.6l.1.1.1.1.1.1.0.jrn.0.1.0.3j.0.19.2.4.1.37.0.o.1.1n.0.1c.2.9.1.d.0.2l.2.3.1.1.0.4q.2.v.1.1m.1.1.3.2.1.2.2.9.0.a.1.2c.2.7.0.2.0.1.3.1.1.1.0.2t.2.8.1.3.0.2y.2.6.0.1.3.2.0.6l.2.6.3.2.0.35.2.8.1.1.0.31.0.1.1.6.0.2v.0.1.1.4.0.79.2.9.0.6v.5.1.1.4.0.2.0.1.0.3y.2.8.3.4.0.2c.0.t.1.1q.0.bb.0.e.0.2y.0.7.0.2.0.5x.4.4.1.1.0.9q.1.c.0.1c.1.8.1.1.0.d0o.2.2sk.1i.2w.1.j8z.1.6.5",
    Me: "w8.1.4dw.0.17i.3.1.2.qdn.2",
    Mn: "lc.33.7n.4.7d.18.1.0.1.1.1.1.1.0.20.a.1c.k.g.0.2t.6.2.5.2.1.1.3.z.0.u.q.2j.a.1m.8.9.0.o.3.1.8.1.2.1.4.17.2.1n.8.16.n.1.v.1j.0.1.0.4.7.4.0.3.6.a.1.t.0.1m.0.4.3.8.0.k.1.q.0.2.1.1l.0.4.1.4.1.2.2.3.0.u.1.3.0.b.1.1l.0.4.4.1.1.4.0.k.1.m.5.1.0.1m.0.2.0.1.3.8.0.7.1.b.1.u.0.1p.0.c.0.1e.0.3.0.1j.0.1.2.5.2.1.3.7.1.b.1.t.0.1m.0.2.0.6.0.5.1.k.1.s.1.1l.1.4.3.8.0.k.1.t.0.20.0.7.2.1.0.2i.0.2.6.c.7.2q.0.2.8.b.6.21.1.r.0.1.0.1.0.1j.d.1.4.1.1.5.a.1.z.9.0.2u.3.1.5.1.1.2.1.p.1.4.2.g.3.d.0.2.1.6.0.f.0.jj.2.qa.2.t.1.u.1.u.1.1s.1.1.6.8.0.2.a.9.0.19.2.1.0.39.1.y.0.3a.2.4.1.9.0.6.2.63.1.2.0.1m.0.1.6.1.0.1.0.2.7.6.9.2.0.1c.d.1.f.1d.3.1c.0.1.4.1.0.5.0.14.8.c.1.w.3.2.1.1.2.1k.0.1.1.3.0.1.2.1m.7.2.1.48.2.1.c.1.6.4.0.6.0.3.1.5i.1r.k0.c.4.0.3.b.2da.2.3x.0.2o.v.fe.3.2z.1.n9w.0.4.9.w.1.28.1.7k.0.3.0.4.0.p.1.5.0.47.1.q.h.d.0.12.7.p.a.1a.2.1c.0.2.3.2.1.13.0.1v.5.2.1.2.1.c.0.8.0.1b.0.1f.0.1.2.2.1.5.1.1.0.16.1.8.0.6m.0.2.0.4.0.fn4.0.kh.f.g.f.r1.0.6a.0.45.4.1ae.2.1.1.5.3.14.2.4.0.4l.1.fx.3.1t.4.8t.1.27.3.1y.a.1d.3.3f.0.1i.e.15.0.2.1.a.2.1d.3.2.1.7.0.1p.2.10.4.1.7.1q.0.c.1.1g.8.a.3.2.0.2n.2.2.0.1.1.6.0.2.0.4d.0.3.7.l.1.1l.1.3.0.11.6.3.4.1y.5.d.0.1.0.1.0.e.1.2d.7.2.2.1.0.n.0.2c.5.1.0.4.1.1.1.6m.3.6.1.1.1.r.1.2d.7.2.0.1.1.2y.0.1.0.2.5.1.0.2t.0.1.0.2.3.1.4.77.8.1.1.74.1.1.0.4.0.40.3.2.1.4.0.w.9.14.5.2.3.8.0.9.5.2.2.1a.c.1.1.ba.6.1.5.1.0.2a.l.2.6.1.1.1.1.3e.5.3.0.1.1.1.6.1.0.20.1.3.0.1.0.9n.1.b.1.1g.4.5.0.1.0.n.0.44l.0.6.e.8ug.b.3.2.1xc.4.1n.6.t4.0.1r.3.29.0.f5k.1.3mp.19.2.m.f4.2.h.7.2.6.u.3.44.2.1iz.1i.4.1d.8.0.e.0.m.4.1.e.11s.6.1.g.2.6.1.1.1.4.2s.0.4g.6.af.0.1p.3.e4.3.72.1.kg.6.31.6.gzhx.6n",
    Nd: "1c.9.17q.9.3q.9.5i.9.bg.9.3a.9.3a.9.3a.9.3a.9.3a.9.3a.9.3a.9.3a.9.3a.9.2o.9.3a.9.1y.9.7q.9.1y.9.1fq.9.12.9.8c.9.3k.9.4m.9.6.9.52.9.2e.9.3q.9.6.9.r7q.9.iu.9.12.9.5i.9.m.9.2e.9.ba.9.geu.9.13a.9.1om.9.6.9.m4.9.3k.9.1o.9.40.9.7q.9.9i.9.3a.9.ae.9.2u.9.6.j.24.9.bq.9.2u.9.ie.9.2e.9.6u.9.1y.9.bq.9.d06.9.1t2.9.2e.9.3q.9.eu.9.iuu.9.250.1d.1ts.9.bq.9.dy.9.6v.9.np.9.3o6.9",
    Nl: "4j2.2.227.y.2.3.2v2.0.p.8.e.2.nfv.9.hu8.1g.cs.0.8.0.3q.4.6cq.32",
    No: "4y.1.5.0.2.2.1th.5.ag.5.3c.2.3p.6.61.6.h.8.c1.9.tx.j.vn.9.dc.0.1at.0.3.5.6.9.5i.f.15.0.k6.1n.26.l.hi.t.12h.0.wk.3.3u.9.u.7.1.e.w.9.13.e.n74.5.hjl.18.1t.3.h.1.9h.q.10.3.110.7.p.6.13.8.23.4.m.5.4g.1.2.f.2.19.1s.8.1g.1.u.2.23.4.2w.7.o.7.15.6.96.5.9s.u.4e.9.16.3.34.6.3q.j.aj.j.11h.1.by.8.o7.i.nn.k.ex2.6.m6.m.js9.j.c.j.30.o.47i.8.pt.1m.1.2.1.3.24.18.1.e.qq.c",
    Pc: "2n.0.6an.1.j.0.17tq.1.o.2.6n.0",
    Pd: "19.0.124.0.1f.0.2td.0.sl.0.1l5.5.2rl.0.2.0.v.1.4.0.s.0.ce.0.j.0.33.0.14ls.1.11.0.a.0.4p.0.2u8.0.8u.0",
    Pe: "15.0.1f.0.v.0.2wt.0.1.0.1ge.0.1wp.0.1j.0.f.0.hm.0.1.0.u.0.u6.0.1.0.1.0.1.0.1.0.1.0.1.0.28.0.w.0.1.0.1.0.1.0.1.0.b8.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1s.0.1.0.x.0.th.0.1.0.1.0.1.0.18.0.1.0.1.0.1.0.bw.0.1.0.1.0.1.0.1.0.3.0.1.0.1.0.1.0.2.1.14im.0.61.0.t.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.3.0.h.0.1.0.1.0.4q.0.1f.0.v.0.2.0.2.0",
    Pf: "57.0.671.0.3.0.s.0.2q0.0.1.0.4.0.2.0.f.0.3.0",
    Pi: "4r.0.67g.0.2.1.2.0.p.0.2q0.0.1.0.4.0.2.0.f.0.3.0",
    Po: "x.2.1.2.2.0.1.0.1.1.a.1.3.1.r.0.1w.0.5.0.e.1.7.0.ji.0.8.0.cy.5.15.0.1i.0.2.0.2.0.18.1.k.1.1.1.d.0.1.2.22.3.2u.0.17.d.6h.2.1i.e.v.0.79.1.a.0.3w.0.3c.0.3d.0.au.0.c.0.a7.0.2i.0.a.1.4o.e.1.0.34.0.22.4.4.1.33.5.4r.0.h0.8.lh.0.3g.2.1z.1.4d.2.1.2.11.5.1.3.8p.1.60.1.3k.6.1.5.4g.1.a.6.s.2.3g.3.1n.4.1q.1.1s.7.b.0.n6.1.8.7.8.8.2.3.2.2.3.a.1.0.1.9.2hm.3.1.1.34.0.3z.1.4.2.2.0.2.8.1.1.1.0.2.1.a.4.1.9.2.3.1.0.1.c.2.2.bw.2.1l.0.59.0.mwy.1.7h.2.2r.0.a.0.37.5.ak.3.2e.1.14.2.1.0.1d.1.1b.0.2p.c.g.1.3g.3.3i.1.g.1.6x.0.g84.6.2.0.m.0.k.1.2.3.3.2.1.3.7.2.6.0.1.1.45.2.1.2.2.0.1.0.1.1.a.1.3.1.r.0.10.0.2.1.be.2.ik.0.1c.0.bi.0.kn.0.5j.0.v.0.7k.8.12.0.34.6.1u.6.2h.3.qg.4.18.3.59.6.31.1.1.3.3i.3.1c.1.27.3.4.0.d.0.1.2.2g.5.2z.0.8a.1.1.1.36.4.a.1.1.0.2w.0.6y.m.2x.2.s.c.24.0.3m.2.70.0.7c.2.4b.0.2k.7.2b.2.1.4.2l.9.5z.0.2n.4.16.1.hx.1.22.c.4v.0.vk.4.29o.1.bjv.1.3p.0.1t.4.8.0.fc.2.87.3.93.0.f5o.0.5wn.4.29f.0.ny.1",
    Ps: "14.0.1e.0.v.0.2wu.0.1.0.1ge.0.1vi.0.3.0.12.0.1j.0.f.0.hm.0.1.0.u.0.u6.0.1.0.1.0.1.0.1.0.1.0.1.0.28.0.w.0.1.0.1.0.1.0.1.0.b8.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.1s.0.1.0.x.0.th.0.1.0.1.0.1.0.p.0.i.0.1.0.1.0.1.0.bw.0.1.0.1.0.1.0.1.0.3.0.1.0.1.0.1.0.2.0.14ip.0.5z.0.t.0.1.0.1.0.1.0.1.0.1.0.1.0.1.0.3.0.h.0.1.0.1.0.4q.0.1e.0.v.0.3.0.2.0",
    Sc: "10.0.3h.3.yx.0.3f.0.du.1.du.1.7.0.6t.0.7b.0.g5.0.1wb.0.1qc.w.qrb.0.gxv.0.30.0.4a.0.63.1.3.1.6ba.3.12ji.0.1ww.0",
    Sk: "2m.0.1.0.1z.0.6.0.4.0.3.0.eh.3.c.d.5.6.1.0.1.g.39.0.e.1.zm.0.4l0.0.1.2.b.2.d.2.d.2.d.1.3a4.1.ndv.m.9.1.2v.1.r4.0.e.1.fuu.g.or.0.1.0.4i.0.1c7r.4",
    Sm: "17.0.g.2.1p.0.1.0.19.0.4.0.11.0.v.0.la.0.en.2.56j.0.d.0.13.2.d.2.3v.0.13.4.6.0.1w.4.5.1.4.0.2.0.2.0.7.0.v.1.2.0.1.0.v.7f.w.1.2i.0.u.o.14.5.d1.0.9.0.1i.7.33.0.9c.4.2.u.a.f.74.3m.m.1q.4.v.2.75.1c.k.2.5.1524.0.mw.0.1.2.4k.0.g.2.1p.0.1.0.3n.0.6.3.2ox.1.13qp.0.p.0.v.0.p.0.v.0.p.0.v.0.p.0.v.0.p.0.4ks.1",
    So: "4m.0.2.0.4.0.1.0.r5.0.7e.1.3j.1.5q.0.a.0.j.1.6v.0.eb.0.ad.0.3m.5.1.0.3o.0.5r.0.15.0.av.2.f.0.1.2.2.5.k.0.1.0.1.0.3p.7.1.5.1.1.5.3.5h.1.kw.9.k3.0.k2.0.4d.x.9t.9.9.8.137.1.1.3.1.1.a.0.1.1.6.5.1.0.1.0.1.0.4.0.b.1.e.0.1.1.1.0.1m.1.9.4.2.3.1.1.1.1.1.6.1.u.2.1.1.0.1.u.7g.7.4.j.2.6.2.28.1.t.p.13.6.1z.m.a.29.25.m.52.1.8.1.1h.8.32.1.6v.18.17.1s.73.e8.1b.l.1.6.12.2.v.1.2w.6d.5.9x.1.1a.p.1.2g.c.5x.q.f.4.0.d.1.c.0.l.1.6.1.9c.1.4.9.w.11.9.0.g.u.b.t.8.0.f.v.a.12.f.8v.534.1r.h3k.1i.o1.3.a.1.1.0.fx.2.gcm.f.3j.0.19.2.dg.0.3.0.4.1.d.1.8p.8.1l.g.2.2.1.c.3.0.1b.18.1a2.1.gf.0.2gm.0.1p1.7.4.g.eve.3.5.0.g2e.0.31f.6n.g.c3.4c.37.1o.6t.a.12.2.1n.5.2.m.1.7.t.4.1o.l.1t.3.0.56.2e.x5.e7.1j.3.1e.7.1.d.1.1.1c8.0.28s.0.3l.0.k1.17.4.2r.c.e.2.e.1.e.1.10.n.4g.1k.s.d.17.4.8.7.1.e.5.4a.6y.5.k7.4.g.3.c.3.3a.4.2m.6.b.4.0.f.b.4.1j.8.9.6.13.8.t.2.b.4.1.1q.9f.c.d.2.c.3.9.5.1j.7.e.2.a.6.8.7.42.1.2j",
    Zl: "6co.0",
    Zp: "6cp.0",
    Zs: "w.0.3j.0.4bj.0.1vj.a.10.0.1b.0.334.0",
    Cc: "0.v.2n.w",
    Cf: "4t.0.11u.5.m.0.5c.0.1d.0.ao.1.28.0.2zv.0.1ks.4.q.4.1d.4.1.9.17yn.0.6x.2.3b5.0.f.0.6zm.f.qxs.3.43z.7.h406.0.u.2n",
    Cn: "oo.1.6.3.7.0.1.0.k.0.b1.0.12.1.1e.1.3.0.1j.7.r.3.6.a.7i.0.1o.1.2t.d.1n.1.1d.1.f.0.s.1.1.0.b.4.v.0.2.4.6l.0.8.1.2.1.m.0.7.0.1.2.4.1.9.1.2.1.4.7.1.3.2.0.5.1.p.1.3.0.6.3.2.1.m.0.7.0.2.0.2.0.2.1.1.0.5.3.2.1.3.2.1.6.4.0.1.6.h.9.3.0.9.0.3.0.m.0.7.0.2.0.5.1.a.0.3.0.3.1.1.e.4.1.c.6.7.0.3.0.8.1.2.1.m.0.7.0.2.0.5.1.9.1.2.1.3.6.3.3.2.0.5.1.i.9.2.0.6.2.3.0.4.2.2.0.1.0.2.2.2.2.3.2.c.3.5.2.3.0.4.1.1.5.1.d.l.4.d.0.3.0.n.0.g.1.9.0.3.0.4.6.2.0.3.1.1.1.4.1.a.6.m.0.3.0.n.0.a.0.5.1.9.0.3.0.4.6.2.5.2.0.4.1.a.0.3.b.d.0.3.0.1f.0.3.0.6.3.g.1.q.0.3.0.i.2.o.0.9.0.1.1.7.2.1.3.6.0.1.0.8.5.a.1.3.b.1m.3.t.10.2.0.1.0.5.0.o.0.1.0.n.1.5.0.1.0.7.0.a.1.4.v.20.0.10.3.13.0.10.0.f.0.d.10.5i.0.1.4.1.1.ah.0.4.1.7.0.1.0.4.1.15.0.4.1.x.0.4.1.7.0.1.0.4.1.f.0.1l.0.4.1.1v.1.w.2.q.5.2e.1.6.1.il.2.2h.6.m.8.o.8.k.b.d.0.3.0.2.b.2m.1.a.5.a.5.q.5.2h.6.17.4.1y.9.v.0.c.3.c.3.1.2.16.1.5.a.18.3.q.5.b.2.1q.1.1t.0.t.1.b.5.a.5.e.1.v.1c.25.0.4m.7.1o.2.f.2.1q.4.17.1.b.7.17.4.eu.1.6.1.12.1.6.1.8.0.1.0.1.0.1.0.v.1.1h.0.f.0.e.1.6.0.j.1.3.0.9.0.2t.0.c.1.r.0.d.2.x.e.x.e.3w.3.ii.l.b.k.1ec.1.w.0.9p.4.19.0.1.4.1.1.1k.6.2.d.o.8.7.0.7.0.7.0.7.0.7.0.7.0.7.0.7.0.3i.x.q.0.2h.b.5y.p.28.0.2e.1.2v.4.17.0.2m.0.2e.8.1c.0.mlp.2.1j.8.9o.j.54.7.5q.1.2.0.1.0.8.k.1n.2.a.5.1k.7.1y.7.c.5.38.a.u.2.26.0.b.3.x.0.1j.8.e.1.a.1.2v.n.s.9.6.1.6.1.6.8.7.0.7.0.1o.3.3i.1.a.5.8mc.b.n.3.1d.3.6su.1.2y.11.7.b.5.4.q.0.5.0.1.0.2.0.2.0.3h.f.cd.1.1i.6.1.v.16.5.1f.0.j.0.4.3.5.0.3r.1.1.0.5a.2.6.1.6.1.6.1.3.2.7.0.7.9.5.1.c.0.q.0.j.0.2.0.f.1.e.x.3f.4.3.3.19.2.2g.0.d.2.1.1a.1a.3l.t.2.1d.e.s.3.10.8.u.4.17.4.u.0.11.3.e.15.4e.1.a.5.10.3.10.3.14.7.1g.a.c.0.f.0.7.0.2.0.b.0.f.0.7.0.2.2.1g.b.8n.8.m.9.8.n.6.0.16.0.9.1w.6.1.1.0.18.0.2.2.1.1.n.0.20.7.9.1b.j.0.2.4.x.2.r.4.1.1r.1k.3.k.1.1e.0.2.4.8.0.3.0.t.1.3.3.a.6.9.6.1s.v.13.3.c.8.1i.2.t.1.r.4.q.6.4.b.7.27.21.1i.1f.c.1f.6.1a.7.a.5.12.2.t.7.2.5r.v.0.16.0.3.1.2.f.3.1i.18.7.16.l.q.11.s.j.n.8.26.3.10.8.1w.9.1.1.p.6.a.5.1h.0.i.7.13.8.2o.0.k.a.i.0.1b.1p.7.0.1.0.4.0.f.0.b.5.1n.4.a.5.4.0.8.1.2.1.m.0.7.0.2.0.5.0.a.1.2.1.3.1.1.5.1.4.7.1.7.2.5.a.a.0.1.1.1.0.12.0.a.0.1.1.1.0.4.0.a.0.2.7.2.s.2k.0.5.t.20.7.a.4l.1i.1.12.x.1x.a.a.5.d.i.1m.5.a.5.k.r.r.1.f.3.n.54.1o.2r.2b.b.8.1.1.1.8.0.2.0.u.0.2.1.c.8.a.1x.8.1.1a.1.b.q.20.7.2b.c.21.6.a.51.y.d.a.5.9.0.19.0.e.9.t.2.w.1.m.0.e.20.7.0.2.0.18.2.1.0.2.0.9.7.a.5.6.0.2.0.11.0.2.0.6.6.a.8l.p.6.h.0.15.2.t.2c.1.e.1e.c.pn.2t.33.0.5.a.5g.217.2r.c.uu.9.32z.4.g7.5a0.1m.1c5.ft.6.v.0.a.3.29.0.a.5.u.1.6.9.1y.9.a.0.7.0.l.4.j.bz.1m.5h.2j.2s.23.3.1l.6.h.1r.5.a.2.d.4qg.7.ye.14.a.6w6.4.0.7.0.2.0.83.e.1.s.3.1.1.d.4.7.b0.1s3.2z.4.d.2.9.6.a.1.8.317.6y.5.c4.23.1a.1.n.8.38.1n.6u.9.13.1.5e.k.1y.3d.k.b.k.b.2f.8.p.3q.2d.0.1z.0.2.1.1.1.2.1.4.0.c.0.1.0.7.0.1t.0.4.1.8.0.7.0.s.0.4.0.5.0.1.2.7.0.9g.1.84.1.ji.e.5.0.f.un.v.5.6.5w.7.0.h.1.7.0.2.0.5.4.1q.w.1.33.19.2.e.1.a.3.2.8v.v.g.1m.4.1.cv.16.5x.17.3.1.db.7.0.4.0.2.0.f.0.5h.1.g.14.24.3.a.3.2.ls.1w.23.1p.5d.4.0.r.0.2.0.1.1.1.0.a.0.4.0.1.0.1.5.1.3.1.0.1.0.1.0.3.0.2.0.1.1.1.0.1.0.1.0.1.0.1.0.2.0.1.1.4.0.7.0.4.0.4.0.1.0.a.0.h.4.3.0.5.0.h.1f.2.7h.18.3.2s.b.f.1.f.0.f.0.11.9.4u.1j.t.c.18.3.9.6.2.d.6.49.rc.3.h.2.d.2.3b.3.2n.5.c.3.1.e.c.3.1k.7.a.5.14.7.u.1.c.3.2.1p.9g.b.e.1.d.2.a.4.1k.6.f.1.b.5.9.6.43.0.2u.sl.wyo.v.37e.5.66.1.4g2.d.5rl.e.ha.1wh.f2.15t.3t7.4.38g.f974.1.t.2o.3j.6o.1e6n.1eke.1.1eke.1",
    Co: "188w.4xr.jpc0.1ekd.2.1ekd"
};

/** Lazily decoded Unicode category ranges. */
var RFC_UNICODE_CATEGORY_RANGES = {};

/** Leaf categories belonging to each RFC 9485 aggregate category. */
var RFC_UNICODE_CATEGORY_GROUPS = {
    L: ["Ll", "Lm", "Lo", "Lt", "Lu"],
    M: ["Mc", "Me", "Mn"],
    N: ["Nd", "Nl", "No"],
    P: ["Pc", "Pd", "Pe", "Pf", "Pi", "Po", "Ps"],
    S: ["Sc", "Sk", "Sm", "So"],
    Z: ["Zl", "Zp", "Zs"],
    C: ["Cc", "Cf", "Cn", "Co"]
};

/**
 * Decodes one category's start/end ranges on first use.
 *
 * Each pair stores the gap after the previous range and the inclusive range
 * length. The compact source representation keeps the Action self-contained.
 *
 * @param {string} category Two-letter Unicode general category.
 * @returns {Array<number>} Alternating inclusive start/end code points.
 */
function rfcUnicodeCategoryRanges(category) {
    if (RFC_UNICODE_CATEGORY_RANGES[category]) {
        return RFC_UNICODE_CATEGORY_RANGES[category];
    }
    var encoded = RFC_UNICODE_CATEGORY_DATA[category];
    if (typeof encoded !== "string") return [];
    var values = encoded ? encoded.split(".") : [];
    var ranges = [];
    var previousEnd = -1;
    for (var i = 0; i < values.length; i += 2) {
        var start = previousEnd + 1 + parseInt(values[i], 36);
        var end = start + parseInt(values[i + 1], 36);
        ranges[ranges.length] = start;
        ranges[ranges.length] = end;
        previousEnd = end;
    }
    RFC_UNICODE_CATEGORY_RANGES[category] = ranges;
    return ranges;
}

/**
 * Tests one scalar against a leaf Unicode category by binary search.
 *
 * @param {number} codePoint Unicode scalar value.
 * @param {string} category Two-letter Unicode general category.
 * @returns {boolean} Whether the scalar belongs to the category.
 */
function rfcUnicodeLeafCategoryContains(codePoint, category) {
    var ranges = rfcUnicodeCategoryRanges(category);
    var low = 0;
    var high = ranges.length / 2 - 1;
    while (low <= high) {
        var middle = Math.floor((low + high) / 2);
        var start = ranges[middle * 2];
        var end = ranges[middle * 2 + 1];
        if (codePoint < start) high = middle - 1;
        else if (codePoint > end) low = middle + 1;
        else return true;
    }
    return false;
}

/**
 * Tests one scalar against an RFC 9485 Unicode category.
 *
 * @param {number} codePoint Unicode scalar value.
 * @param {string} category One- or two-letter general category.
 * @returns {boolean} Whether the scalar belongs to the category.
 */
function rfcUnicodeCategoryContains(codePoint, category) {
    var leaves = RFC_UNICODE_CATEGORY_GROUPS[category];
    if (!leaves) return rfcUnicodeLeafCategoryContains(codePoint, category);
    for (var i = 0; i < leaves.length; i++) {
        if (rfcUnicodeLeafCategoryContains(codePoint, leaves[i])) return true;
    }
    return false;
}

/**
 * Creates a parser for the RFC 9485 I-Regexp subset.
 *
 * `^` and `$` retain the established anchor behavior used by the pinned
 * JSONPath compliance suite. Escaping either character matches it literally.
 *
 * @constructor
 * @param {string} source I-Regexp source.
 */
function IRegexpParser(source) {
    this.source = source;
    this.index = 0;
    this.depth = 0;
}

/** Throws a private parse error caught by the function evaluator. */
IRegexpParser.prototype.fail = function () {
    throw new Error("Invalid I-Regexp");
};

/** Reads one Unicode scalar and rejects isolated surrogate code units. */
IRegexpParser.prototype.readScalar = function () {
    if (this.index >= this.source.length) this.fail();
    var first = this.source.charCodeAt(this.index++);
    if (first >= 0xD800 && first <= 0xDBFF) {
        if (this.index >= this.source.length) this.fail();
        var second = this.source.charCodeAt(this.index++);
        if (second < 0xDC00 || second > 0xDFFF) this.fail();
        return (first - 0xD800) * 0x400 + second - 0xDC00 + 0x10000;
    }
    if (first >= 0xDC00 && first <= 0xDFFF) this.fail();
    return first;
};

/** Parses a complete I-Regexp. */
IRegexpParser.prototype.parse = function () {
    var expression = this.parseAlternation(null);
    if (this.index !== this.source.length) this.fail();
    return expression;
};

/** Parses alternation until the supplied group terminator. */
IRegexpParser.prototype.parseAlternation = function (terminator) {
    var branches = [this.parseBranch(terminator)];
    while (this.source.charAt(this.index) === "|") {
        this.index++;
        branches[branches.length] = this.parseBranch(terminator);
    }
    return { type: "alternation", branches: branches };
};

/** Parses one concatenated branch. */
IRegexpParser.prototype.parseBranch = function (terminator) {
    var pieces = [];
    while (this.index < this.source.length) {
        var ch = this.source.charAt(this.index);
        if (ch === "|" || (terminator && ch === terminator)) break;
        pieces[pieces.length] = this.parsePiece();
    }
    return { type: "sequence", pieces: pieces };
};

/** Parses one atom and its optional quantifier. */
IRegexpParser.prototype.parsePiece = function () {
    var atom = this.parseAtom();
    var min = 1;
    var max = 1;
    var ch = this.source.charAt(this.index);
    if (
        (atom.type === "anchorStart" || atom.type === "anchorEnd") &&
        (ch === "*" || ch === "+" || ch === "?" || ch === "{")
    ) {
        this.fail();
    }
    if (ch === "*" || ch === "+" || ch === "?") {
        this.index++;
        min = ch === "+" ? 1 : 0;
        max = ch === "?" ? 1 : null;
    }
    else if (ch === "{") {
        this.index++;
        min = this.parseQuantifierInteger();
        max = min;
        if (this.source.charAt(this.index) === ",") {
            this.index++;
            max = /[0-9]/.test(this.source.charAt(this.index))
                ? this.parseQuantifierInteger()
                : null;
        }
        if (this.source.charAt(this.index) !== "}") this.fail();
        this.index++;
        if (max !== null && max < min) this.fail();
    }
    return { type: "repeat", atom: atom, min: min, max: max };
};

/** Parses a bounded decimal quantifier without allowing numeric overflow. */
IRegexpParser.prototype.parseQuantifierInteger = function () {
    if (!/[0-9]/.test(this.source.charAt(this.index))) this.fail();
    var value = 0;
    while (/[0-9]/.test(this.source.charAt(this.index))) {
        value = value * 10 + parseInt(this.source.charAt(this.index++), 10);
        if (value > RFC_IREGEXP_MAX_STATES) value = RFC_IREGEXP_MAX_STATES + 1;
    }
    return value;
};

/** Parses a literal, group, character class, category, dot, or anchor. */
IRegexpParser.prototype.parseAtom = function () {
    var ch = this.source.charAt(this.index);
    if (ch === "(") {
        this.index++;
        this.depth++;
        if (this.depth > 64) this.fail();
        var expression = this.parseAlternation(")");
        if (this.source.charAt(this.index) !== ")") this.fail();
        this.index++;
        this.depth--;
        return { type: "group", expression: expression };
    }
    if (ch === ".") {
        this.index++;
        return { type: "dot" };
    }
    if (ch === "[") return this.parseClass();
    if (ch === "\\") {
        var escaped = this.parseEscape();
        return escaped.type === "category"
            ? { type: "class", negated: false, terms: [escaped] }
            : { type: "literal", value: escaped.value };
    }
    if (ch === "^") {
        this.index++;
        return { type: "anchorStart" };
    }
    if (ch === "$") {
        this.index++;
        return { type: "anchorEnd" };
    }
    if (!ch || "()*+?[]{}|".indexOf(ch) !== -1) this.fail();
    return { type: "literal", value: this.readScalar() };
};

/** Parses an RFC 9485 single-character or Unicode-category escape. */
IRegexpParser.prototype.parseEscape = function () {
    this.index++;
    var ch = this.source.charAt(this.index++);
    if (ch === "p" || ch === "P") {
        if (this.source.charAt(this.index++) !== "{") this.fail();
        var start = this.index;
        while (this.index < this.source.length && this.source.charAt(this.index) !== "}") {
            this.index++;
        }
        if (this.source.charAt(this.index) !== "}") this.fail();
        var category = this.source.substring(start, this.index++);
        if (!rfcIRegexpCategoryValid(category)) this.fail();
        return { type: "category", category: category, complement: ch === "P" };
    }
    if (ch === "n") return { type: "literal", value: 10 };
    if (ch === "r") return { type: "literal", value: 13 };
    if (ch === "t") return { type: "literal", value: 9 };
    if ("$()*+-.?\\[]^{|}".indexOf(ch) === -1) this.fail();
    return { type: "literal", value: ch.charCodeAt(0) };
};

/** Validates the exact category names admitted by RFC 9485. */
function rfcIRegexpCategoryValid(category) {
    if (RFC_UNICODE_CATEGORY_GROUPS[category]) return true;
    return typeof RFC_UNICODE_CATEGORY_DATA[category] === "string";
}

/** Parses one character-class expression. */
IRegexpParser.prototype.parseClass = function () {
    this.index++;
    var negated = false;
    if (this.source.charAt(this.index) === "^") {
        negated = true;
        this.index++;
    }
    var terms = [];
    if (this.source.charAt(this.index) === "-") {
        this.index++;
        terms[terms.length] = { type: "range", start: 45, end: 45 };
    }
    while (this.index < this.source.length && this.source.charAt(this.index) !== "]") {
        if (
            this.source.charAt(this.index) === "-" &&
            this.source.charAt(this.index + 1) === "]"
        ) {
            this.index++;
            terms[terms.length] = { type: "range", start: 45, end: 45 };
            break;
        }
        var first = this.parseClassToken();
        if (
            first.type === "literal" &&
            this.source.charAt(this.index) === "-" &&
            this.source.charAt(this.index + 1) !== "]"
        ) {
            this.index++;
            var last = this.parseClassToken();
            if (last.type !== "literal" || last.value < first.value) this.fail();
            terms[terms.length] = {
                type: "range",
                start: first.value,
                end: last.value
            };
        }
        else if (first.type === "literal") {
            terms[terms.length] = {
                type: "range",
                start: first.value,
                end: first.value
            };
        }
        else {
            terms[terms.length] = first;
        }
    }
    if (this.source.charAt(this.index) !== "]" || terms.length === 0) this.fail();
    this.index++;
    return { type: "class", negated: negated, terms: terms };
};

/** Parses one character-class token. */
IRegexpParser.prototype.parseClassToken = function () {
    var ch = this.source.charAt(this.index);
    if (ch === "\\") return this.parseEscape();
    if (!ch || ch === "-" || ch === "[" || ch === "]") this.fail();
    return { type: "literal", value: this.readScalar() };
};

/** Creates one bounded NFA state. */
function rfcIRegexpState(compiler, type, atom) {
    if (compiler.states >= RFC_IREGEXP_MAX_STATES) {
        throw new Error("I-Regexp state limit exceeded");
    }
    return {
        id: compiler.states++,
        type: type,
        atom: atom || null,
        out: null,
        out1: null
    };
}

/** Patches every open fragment edge to the supplied state. */
function rfcIRegexpPatch(edges, state) {
    for (var i = 0; i < edges.length; i++) edges[i].state[edges[i].edge] = state;
}

/** Concatenates two compiled NFA fragments. */
function rfcIRegexpConcat(left, right) {
    if (!left) return right;
    rfcIRegexpPatch(left.outs, right.start);
    return { start: left.start, outs: right.outs };
}

/** Compiles an alternation AST to a Thompson NFA fragment. */
function rfcIRegexpCompileExpression(expression, compiler) {
    var result = rfcIRegexpCompileSequence(expression.branches[0], compiler);
    for (var i = 1; i < expression.branches.length; i++) {
        var branch = rfcIRegexpCompileSequence(expression.branches[i], compiler);
        var split = rfcIRegexpState(compiler, "split");
        split.out = result.start;
        split.out1 = branch.start;
        result = {
            start: split,
            outs: result.outs.concat(branch.outs)
        };
    }
    return result;
}

/** Compiles a concatenated AST branch. */
function rfcIRegexpCompileSequence(sequence, compiler) {
    var result = null;
    for (var i = 0; i < sequence.pieces.length; i++) {
        result = rfcIRegexpConcat(
            result,
            rfcIRegexpCompileRepeat(sequence.pieces[i], compiler)
        );
    }
    if (result) return result;
    var epsilon = rfcIRegexpState(compiler, "epsilon");
    return { start: epsilon, outs: [{ state: epsilon, edge: "out" }] };
}

/** Compiles one atom without a quantifier. */
function rfcIRegexpCompileAtom(atom, compiler) {
    if (atom.type === "group") {
        return rfcIRegexpCompileExpression(atom.expression, compiler);
    }
    var type = atom.type === "anchorStart"
        ? "anchorStart"
        : atom.type === "anchorEnd"
            ? "anchorEnd"
            : "character";
    var state = rfcIRegexpState(compiler, type, atom);
    return { start: state, outs: [{ state: state, edge: "out" }] };
}

/** Compiles one quantified atom, rejecting excessive expansions safely. */
function rfcIRegexpCompileRepeat(repeat, compiler) {
    var result = null;
    var i;
    for (i = 0; i < repeat.min; i++) {
        result = rfcIRegexpConcat(result, rfcIRegexpCompileAtom(repeat.atom, compiler));
    }
    if (repeat.max === null) {
        var repeated = rfcIRegexpCompileAtom(repeat.atom, compiler);
        var loop = rfcIRegexpState(compiler, "split");
        loop.out = repeated.start;
        rfcIRegexpPatch(repeated.outs, loop);
        var star = { start: loop, outs: [{ state: loop, edge: "out1" }] };
        return rfcIRegexpConcat(result, star);
    }
    for (i = repeat.min; i < repeat.max; i++) {
        var optional = rfcIRegexpCompileAtom(repeat.atom, compiler);
        var split = rfcIRegexpState(compiler, "split");
        split.out = optional.start;
        optional = {
            start: split,
            outs: optional.outs.concat([{ state: split, edge: "out1" }])
        };
        result = rfcIRegexpConcat(result, optional);
    }
    if (result) return result;
    var epsilon = rfcIRegexpState(compiler, "epsilon");
    return { start: epsilon, outs: [{ state: epsilon, edge: "out" }] };
}

/** Parses and compiles an I-Regexp, returning `null` when it is invalid. */
function rfcIRegexpCompile(pattern) {
    if (pattern.length > RFC_IREGEXP_MAX_PATTERN_LENGTH) return null;
    try {
        var parser = new IRegexpParser(pattern);
        var compiler = { states: 0 };
        var fragment = rfcIRegexpCompileExpression(parser.parse(), compiler);
        var match = rfcIRegexpState(compiler, "match");
        rfcIRegexpPatch(fragment.outs, match);
        return { start: fragment.start, states: compiler.states };
    }
    catch (error) {
        return null;
    }
}

/** Converts a JavaScript string into Unicode scalar numbers. */
function rfcIRegexpScalars(value) {
    var out = [];
    for (var i = 0; i < value.length; i++) {
        var first = value.charCodeAt(i);
        if (first >= 0xD800 && first <= 0xDBFF) {
            if (i + 1 >= value.length) return null;
            var second = value.charCodeAt(++i);
            if (second < 0xDC00 || second > 0xDFFF) return null;
            out[out.length] = (first - 0xD800) * 0x400 + second - 0xDC00 + 0x10000;
        }
        else {
            if (first >= 0xDC00 && first <= 0xDFFF) return null;
            out[out.length] = first;
        }
    }
    return out;
}

/** Tests one scalar against a compiled character predicate. */
function rfcIRegexpCharacterMatches(atom, codePoint) {
    if (atom.type === "literal") return atom.value === codePoint;
    if (atom.type === "dot") return codePoint !== 10 && codePoint !== 13;
    var matched = false;
    for (var i = 0; i < atom.terms.length && !matched; i++) {
        var term = atom.terms[i];
        if (term.type === "range") {
            matched = codePoint >= term.start && codePoint <= term.end;
        }
        else {
            matched = rfcUnicodeCategoryContains(codePoint, term.category);
            if (term.complement) matched = !matched;
        }
    }
    return atom.negated ? !matched : matched;
}

/** Adds a state and follows all zero-width transitions. */
function rfcIRegexpAddState(list, state, seen, position, length) {
    if (!state || seen[state.id]) return;
    seen[state.id] = true;
    if (state.type === "split") {
        rfcIRegexpAddState(list, state.out, seen, position, length);
        rfcIRegexpAddState(list, state.out1, seen, position, length);
    }
    else if (state.type === "epsilon") {
        rfcIRegexpAddState(list, state.out, seen, position, length);
    }
    else if (state.type === "anchorStart") {
        if (position === 0) rfcIRegexpAddState(list, state.out, seen, position, length);
    }
    else if (state.type === "anchorEnd") {
        if (position === length) rfcIRegexpAddState(list, state.out, seen, position, length);
    }
    else {
        list[list.length] = state;
    }
}

/** Returns whether a state list contains the accepting state. */
function rfcIRegexpAccepts(states) {
    for (var i = 0; i < states.length; i++) {
        if (states[i].type === "match") return true;
    }
    return false;
}

/** Runs a compiled Thompson NFA over Unicode scalar input. */
function rfcIRegexpRun(compiled, scalars, full) {
    var current = [];
    var seen = {};
    if (full) rfcIRegexpAddState(current, compiled.start, seen, 0, scalars.length);
    for (var position = 0; position <= scalars.length; position++) {
        if (!full) {
            seen = {};
            for (var s = 0; s < current.length; s++) seen[current[s].id] = true;
            rfcIRegexpAddState(current, compiled.start, seen, position, scalars.length);
            if (rfcIRegexpAccepts(current)) return true;
        }
        if (position === scalars.length) break;
        var next = [];
        var nextSeen = {};
        for (var i = 0; i < current.length; i++) {
            var state = current[i];
            if (
                state.type === "character" &&
                rfcIRegexpCharacterMatches(state.atom, scalars[position])
            ) {
                rfcIRegexpAddState(
                    next,
                    state.out,
                    nextSeen,
                    position + 1,
                    scalars.length
                );
            }
        }
        current = next;
    }
    return rfcIRegexpAccepts(current);
}

/**
 * Evaluates RFC 9535 `match()` or `search()` with an RFC 9485 parser.
 *
 * Invalid patterns and non-string arguments produce LogicalFalse as required
 * by RFC 9535. The NFA works on Unicode scalars and does not use `eval` or the
 * host regular-expression engine.
 *
 * @param {*} value Candidate string.
 * @param {*} pattern Candidate I-Regexp string.
 * @param {boolean} full `true` for `match`, `false` for `search`.
 * @returns {boolean} Whether the complete value or a substring matches.
 */
function rfcRegexMatches(value, pattern, full) {
    if (typeof value !== "string" || typeof pattern !== "string") return false;
    var scalars = rfcIRegexpScalars(value);
    if (!scalars) return false;
    var compiled = rfcIRegexpCompile(pattern);
    return compiled ? rfcIRegexpRun(compiled, scalars, full) : false;
}

/**
 * Evaluates an RFC 9535 standard function.
 *
 * `count()` retains the complete argument nodelist. `value()` returns
 * `RFC_NOTHING` unless exactly one node was selected.
 *
 * @param {Object} call Typed function-call AST.
 * @param {Object} rootNode Absolute root node.
 * @param {Object} currentNode Current filter node.
 * @returns {*} Function result or `RFC_NOTHING`.
 */
function rfcEvaluateFunction(call, rootNode, currentNode) {
    var name = call.name;
    if (name === "count" || name === "value") {
        var nodes = rfcEvaluateQuery(call.args[0], rootNode, currentNode);
        if (name === "count") return nodes.length;
        return nodes.length === 1 ? nodes[0].value : RFC_NOTHING;
    }
    var first = rfcOperandValue(call.args[0], rootNode, currentNode);
    if (name === "length") return rfcLengthValue(first);
    var second = rfcOperandValue(call.args[1], rootNode, currentNode);
    return rfcRegexMatches(first, second, name === "match");
}

/**
 * Evaluates an RFC LogicalType expression.
 *
 * @param {Object} expression Logical-expression AST.
 * @param {Object} rootNode Absolute root node.
 * @param {Object} currentNode Current filter node.
 * @returns {boolean} Logical result.
 */
function rfcEvaluateLogical(expression, rootNode, currentNode) {
    if (expression.type === "or") {
        return rfcEvaluateLogical(expression.left, rootNode, currentNode) || rfcEvaluateLogical(expression.right, rootNode, currentNode);
    }
    if (expression.type === "and") {
        return rfcEvaluateLogical(expression.left, rootNode, currentNode) && rfcEvaluateLogical(expression.right, rootNode, currentNode);
    }
    if (expression.type === "not") return !rfcEvaluateLogical(expression.expression, rootNode, currentNode);
    if (expression.type === "exists") return rfcEvaluateQuery(expression.query, rootNode, currentNode).length > 0;
    if (expression.type === "functionTest") {
        var result = rfcEvaluateFunction(expression.call, rootNode, currentNode);
        return expression.call.valueType === "nodes" ? result.length > 0 : result === true;
    }
    return rfcCompare(
        expression.operator,
        rfcOperandValue(expression.left, rootNode, currentNode),
        rfcOperandValue(expression.right, rootNode, currentNode)
    );
}

/**
 * Executes one parsed RFC-mode query and materializes the requested result.
 *
 * @param {*} object JSON-compatible root value.
 * @param {string} expression JSONPath query.
 * @param {Object=} options Action options.
 * @param {boolean} allowExtensions Enables `??` and `^` only.
 * @returns {Array<*>} Values or normalized paths; no match is always `[]`.
 * @throws {SyntaxError} For invalid syntax or unsafe-eval use in an RFC mode.
 */
function rfcJsonPath(object, expression, options, allowExtensions) {
    if (options && options.allowUnsafeEval === true) {
        throw new SyntaxError("jsonPath RFC9535: allowUnsafeEval is only available in GOESSNER_EXTENDED mode");
    }
    var parser = new RfcParser(expression, allowExtensions);
    var query = parser.parse();
    var rootNode = { value: object, path: "$", parent: null };
    var result = rfcEvaluateQuery(query, rootNode, rootNode);
    var resultType = options && options.resultType || "VALUE";
    var out = [];
    for (var i = 0; i < result.length; i++) {
        out[out.length] = resultType === "PATH" ? result[i].path : result[i].value;
    }
    return out;
}

/**
 * Root alias retained for compatibility with the original Goessner evaluator.
 *
 * @type {*}
 */
var $ = obj;
P.root = obj;

/**
 * Effective query mode. A caller-supplied mode overrides the public RFC9535
 * default; an environment wrapper may inject its own default before calling
 * this Action.
 *
 * @type {string}
 */
var jsonPathMode = arg && arg.mode || "RFC9535";

if (
    jsonPathMode !== "RFC9535" &&
    jsonPathMode !== "RFC9535_EXTENDED" &&
    jsonPathMode !== "GOESSNER_EXTENDED"
) {
    throw new SyntaxError(
        "jsonPath: mode must be 'RFC9535', 'RFC9535_EXTENDED', or 'GOESSNER_EXTENDED'"
    );
}

if (jsonPathMode === "RFC9535" || jsonPathMode === "RFC9535_EXTENDED") {
    if (P.resultType != "VALUE" && P.resultType != "PATH") {
        throw new SyntaxError(
            "jsonPath: resultType must be 'VALUE' or 'PATH'"
        );
    }
    return rfcJsonPath(
        obj,
        expr,
        arg,
        jsonPathMode === "RFC9535_EXTENDED"
    );
}

if (expr && obj && (P.resultType == "VALUE" || P.resultType == "PATH")) {
    P.trace(P.normalize(expr).replace(/^\$;/, ""), obj, "$");
    return P.result.length ? P.result : false;
}
