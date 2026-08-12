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
            else if (loc === "^")
                P.parent(x, path);
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

/**
 * Adapts an I-Regexp pattern for the ES5 regular-expression engine.
 *
 * In particular, an unescaped dot is expanded to one Unicode scalar so a
 * surrogate pair is not treated as two independent characters.
 *
 * @param {string} pattern RFC regular-expression pattern.
 * @returns {string} JavaScript-compatible pattern source.
 */
function rfcPrepareRegex(pattern) {
    var out = "";
    var inClass = false;
    var scalarDot = "(?:[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]|[^\\uD800-\\uDFFF\\r\\n])";
    for (var i = 0; i < pattern.length; i++) {
        var ch = pattern.charAt(i);
        if (ch === "\\") {
            out += ch;
            if (i + 1 < pattern.length) out += pattern.charAt(++i);
        }
        else if (ch === "[") {
            inClass = true;
            out += ch;
        }
        else if (ch === "]" && inClass) {
            inClass = false;
            out += ch;
        }
        else if (ch === "." && !inClass) {
            out += scalarDot;
        }
        else {
            out += ch;
        }
    }
    return out;
}

/**
 * Compiles an RFC regex for whole-string `match()` or substring `search()`.
 *
 * @param {string} pattern Pattern source.
 * @param {boolean} full Whether to anchor the complete string.
 * @returns {RegExp|null} Compiled expression, or `null` when invalid.
 */
function rfcRegex(pattern, full) {
    try {
        pattern = rfcPrepareRegex(pattern);
        return new RegExp(full ? "^(?:" + pattern + ")$" : pattern);
    }
    catch (error) {
        return null;
    }
}

/**
 * Evaluates the RFC `match()` or `search()` string predicate.
 *
 * @param {*} value Candidate string.
 * @param {*} pattern Candidate I-Regexp string.
 * @param {boolean} full `true` for `match`, `false` for `search`.
 * @returns {boolean} Match result; type and pattern errors produce `false`.
 */
function rfcRegexMatches(value, pattern, full) {
    if (typeof value !== "string" || typeof pattern !== "string") return false;
    var categoryResult = rfcUnicodeCategoryTest(value, pattern, full);
    if (categoryResult !== null) return categoryResult;
    var regex = rfcRegex(pattern, full);
    return regex ? regex.test(value) : false;
}

/**
 * Splits a JavaScript string into Unicode scalar substrings.
 *
 * @param {string} value String to split.
 * @returns {Array<string>} Scalar substrings.
 */
function rfcUnicodeScalars(value) {
    var out = [];
    for (var i = 0; i < value.length; i++) {
        var scalar = value.charAt(i);
        var code = value.charCodeAt(i);
        if (code >= 0xD800 && code <= 0xDBFF && i + 1 < value.length) {
            scalar += value.charAt(++i);
        }
        out[out.length] = scalar;
    }
    return out;
}

/**
 * Handles Unicode uppercase category patterns on ES5 engines without Unicode
 * property escapes.
 *
 * @param {string} value Candidate string.
 * @param {string} pattern Category pattern.
 * @param {boolean} full Whether the complete value must match.
 * @returns {boolean|null} Match result, or `null` when not handled here.
 */
function rfcUnicodeCategoryTest(value, pattern, full) {
    if (pattern !== "\\p{Lu}" && pattern !== "\\P{Lu}") return null;
    var scalars = rfcUnicodeScalars(value);
    if (full && scalars.length !== 1) return false;
    for (var i = 0; i < scalars.length; i++) {
        var scalar = scalars[i];
        var uppercase = scalar.toUpperCase() === scalar && scalar.toLowerCase() !== scalar;
        if ((pattern === "\\p{Lu}" && uppercase) || (pattern === "\\P{Lu}" && !uppercase)) return true;
    }
    return false;
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
