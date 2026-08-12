var assert = require("assert");
var fs = require("fs");
var path = require("path");

var rootDir = path.resolve(__dirname, "..");
var casesDir = path.join(__dirname, "cases");
var fixturesDir = path.join(__dirname, "fixtures");
var actionPath = resolveActionPath();
var actionSource = fs.readFileSync(actionPath, "utf8");

/**
 * Resolves the Aria Action source file.
 *
 * Supporting the file with and without a `.js` extension keeps the runner
 * independent from the chosen export convention.
 *
 * @returns {string} Absolute path to the Action source.
 * @throws {Error} If no supported source file exists.
 */
function resolveActionPath() {
    var candidates = [
        path.join(rootDir, "jsonPath.js"),
        path.join(rootDir, "jsonPath")
    ];

    for (var i = 0; i < candidates.length; i++) {
        if (fs.existsSync(candidates[i])) {
            return candidates[i];
        }
    }

    throw new Error(
        "Could not find the Action source. Expected jsonPath.js or jsonPath."
    );
}

/**
 * Loads and parses a JSON document.
 *
 * @param {string} filePath Absolute path to a JSON file.
 * @returns {*} Parsed JSON value.
 */
function loadJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/**
 * Creates an isolated JSON-compatible clone.
 *
 * @param {*} value Value to clone.
 * @returns {*} Cloned value.
 */
function cloneJson(value) {
    if (typeof value === "undefined") {
        return undefined;
    }

    return JSON.parse(JSON.stringify(value));
}

/**
 * Wraps the source exactly like an Aria/vRO Action.
 *
 * jsonPath.js is an Action body rather than a CommonJS module. Aria provides
 * `obj`, `expr`, and `arg` as input variables; `new Function` recreates that
 * contract for local regression tests.
 *
 * @returns {Function} Function accepting (obj, expr, arg).
 */
function createAction() {
    return new Function("obj", "expr", "arg", actionSource);
}

/**
 * Resolves the input object of a test case.
 *
 * A case can embed `obj` directly or reference a shared JSON document through
 * `fixture`.
 *
 * @param {Object} testCase Parsed test case.
 * @returns {*} Input object for the Action.
 */
function resolveInput(testCase) {
    if (testCase.fixture) {
        return loadJson(path.join(fixturesDir, testCase.fixture));
    }

    return testCase.obj;
}

/**
 * Executes and verifies one JSON test case.
 *
 * @param {string} fileName File name relative to tests/cases.
 * @returns {{name:string,fileName:string,failures:Array<string>}}
 */
function runCase(fileName) {
    var testCase = loadJson(path.join(casesDir, fileName));
    var action = createAction();
    var actual;
    var actionError = null;
    var failures = [];

    try {
        var actionArg = cloneJson(testCase.arg) || {};

        if (!actionArg.mode && !testCase.useDefaultMode) {
            actionArg.mode = "GOESSNER_EXTENDED";
        }

        actual = action(
            cloneJson(resolveInput(testCase)),
            testCase.expr,
            actionArg
        );
    } catch (error) {
        actionError = error;
    }

    if (testCase.expectedError) {
        if (!actionError) {
            failures.push(
                "expected an error containing " +
                JSON.stringify(testCase.expectedError) +
                " but the expression completed successfully"
            );
        }
        else if (
            String(actionError.message || actionError)
                .indexOf(testCase.expectedError) === -1
        ) {
            failures.push(
                "expected an error containing " +
                JSON.stringify(testCase.expectedError) +
                " but got " +
                JSON.stringify(actionError.message || String(actionError))
            );
        }

        return {
            name: testCase.name || fileName,
            fileName: fileName,
            failures: failures
        };
    }

    if (actionError) {
        throw actionError;
    }

    try {
        assert.deepStrictEqual(actual, testCase.expected);
    } catch (error) {
        failures.push(
            "expected " +
            JSON.stringify(testCase.expected) +
            " but got " +
            JSON.stringify(actual)
        );
    }

    return {
        name: testCase.name || fileName,
        fileName: fileName,
        failures: failures
    };
}

/**
 * Runs all JSON cases and exits non-zero when any case fails.
 *
 * @returns {void}
 */
function main() {
    var files = fs.readdirSync(casesDir).filter(function (fileName) {
        return /\.json$/i.test(fileName);
    }).sort();
    var failed = [];

    for (var i = 0; i < files.length; i++) {
        var outcome;

        try {
            outcome = runCase(files[i]);
        } catch (error) {
            outcome = {
                name: files[i],
                fileName: files[i],
                failures: [error && error.stack ? error.stack : String(error)]
            };
        }

        if (outcome.failures.length > 0) {
            failed.push(outcome);
            console.log("FAIL " + outcome.fileName + " - " + outcome.name);

            for (var f = 0; f < outcome.failures.length; f++) {
                console.log("  - " + outcome.failures[f]);
            }
        } else {
            console.log("PASS " + outcome.fileName + " - " + outcome.name);
        }
    }

    console.log("");
    console.log(
        "Executed " + files.length + " test case(s), " +
        failed.length + " failed."
    );

    if (failed.length > 0) {
        process.exit(1);
    }
}

main();
