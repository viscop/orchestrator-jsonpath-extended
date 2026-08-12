var assert = require("assert");
var fs = require("fs");
var path = require("path");

var rootDir = path.resolve(__dirname, "..");
var actionSource = fs.readFileSync(path.join(rootDir, "jsonPath.js"), "utf8");
var action = new Function("obj", "expr", "arg", actionSource);

function resolveSuitePath() {
    var explicitPath = process.env.JSONPATH_CTS_PATH;
    for (var a = 2; a < process.argv.length; a++) {
        if (process.argv[a].indexOf("--") !== 0) {
            explicitPath = process.argv[a];
            break;
        }
    }
    var candidates = [
        explicitPath,
        path.join(__dirname, "jsonpath-compliance-test-suite", "cts.json")
    ];

    for (var i = 0; i < candidates.length; i++) {
        if (candidates[i] && fs.existsSync(candidates[i])) {
            return path.resolve(candidates[i]);
        }
    }

    throw new Error(
        "Could not find cts.json. Initialize tests/jsonpath-compliance-test-suite " +
        "or pass its path as the first argument / JSONPATH_CTS_PATH."
    );
}

function clone(value) {
    if (typeof value === "undefined") return undefined;
    return JSON.parse(JSON.stringify(value));
}

function allowedResults(test, pathResults) {
    if (pathResults) {
        return test.result_paths ? [test.result_paths] : test.results_paths;
    }
    return test.result ? [test.result] : test.results;
}

function matchesAny(actual, expected) {
    for (var i = 0; i < expected.length; i++) {
        try {
            assert.deepStrictEqual(actual, expected[i]);
            return true;
        }
        catch (error) {
            // Try the next result order permitted by the RFC.
        }
    }
    return false;
}

function execute(test, resultType) {
    return action(clone(test.document), test.selector, {
        mode: "RFC9535",
        resultType: resultType
    });
}

function runTest(test) {
    var failures = [];

    if (test.invalid_selector) {
        try {
            execute(test, "VALUE");
            failures.push("invalid selector was accepted");
        }
        catch (error) {
            if (!(error instanceof SyntaxError)) {
                failures.push("invalid selector raised " + error.name + " instead of SyntaxError");
            }
        }
        return failures;
    }

    try {
        var values = execute(test, "VALUE");
        if (!matchesAny(values, allowedResults(test, false))) {
            failures.push("unexpected VALUE result: " + JSON.stringify(values));
        }

        var paths = execute(test, "PATH");
        if (!matchesAny(paths, allowedResults(test, true))) {
            failures.push("unexpected PATH result: " + JSON.stringify(paths));
        }
    }
    catch (error) {
        failures.push(error && error.stack ? error.stack : String(error));
    }

    return failures;
}

function main() {
    var suitePath = resolveSuitePath();
    var suite = JSON.parse(fs.readFileSync(suitePath, "utf8"));
    var failed = [];

    for (var i = 0; i < suite.tests.length; i++) {
        var test = suite.tests[i];
        var failures = runTest(test);
        if (failures.length > 0) {
            failed.push({ test: test, failures: failures });
            if (failed.length <= 20 || process.argv.indexOf("--verbose") !== -1) {
                console.log("FAIL " + test.name + " - " + test.selector);
                for (var f = 0; f < failures.length; f++) {
                    console.log("  - " + failures[f].split("\n")[0]);
                }
            }
        }
    }

    console.log("");
    console.log(
        "RFC 9535 CTS: " + (suite.tests.length - failed.length) + "/" +
        suite.tests.length + " passed, " + failed.length + " failed."
    );
    console.log("Suite: " + suitePath);

    if (failed.length > 20 && process.argv.indexOf("--verbose") === -1) {
        console.log("Only the first 20 failures are shown; use --verbose for all failures.");
    }

    if (failed.length > 0) process.exit(1);
}

main();
