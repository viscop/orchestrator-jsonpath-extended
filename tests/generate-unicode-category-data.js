var categories = [
    "Ll", "Lm", "Lo", "Lt", "Lu",
    "Mc", "Me", "Mn",
    "Nd", "Nl", "No",
    "Pc", "Pd", "Pe", "Pf", "Pi", "Po", "Ps",
    "Sc", "Sk", "Sm", "So",
    "Zl", "Zp", "Zs",
    "Cc", "Cf", "Cn", "Co"
];

if (process.versions.unicode !== "16.0") {
    throw new Error(
        "Expected Node.js Unicode 16.0 data but found " +
        process.versions.unicode
    );
}

function encodeCategory(category) {
    var expression = new RegExp("^\\p{" + category + "}$", "u");
    var ranges = [];
    var start = -1;

    for (var codePoint = 0; codePoint <= 0x10FFFF; codePoint++) {
        var scalar = codePoint < 0xD800 || codePoint > 0xDFFF;
        var matches = scalar &&
            expression.test(String.fromCodePoint(codePoint));

        if (matches && start < 0) {
            start = codePoint;
        }
        else if (!matches && start >= 0) {
            ranges[ranges.length] = [start, codePoint - 1];
            start = -1;
        }
    }

    if (start >= 0) {
        ranges[ranges.length] = [start, 0x10FFFF];
    }

    var previousEnd = -1;
    var encoded = [];

    for (var i = 0; i < ranges.length; i++) {
        encoded[encoded.length] =
            (ranges[i][0] - previousEnd - 1).toString(36);
        encoded[encoded.length] =
            (ranges[i][1] - ranges[i][0]).toString(36);
        previousEnd = ranges[i][1];
    }

    return encoded.join(".");
}

for (var i = 0; i < categories.length; i++) {
    var suffix = i + 1 < categories.length ? "," : "";
    console.log(
        "    " + categories[i] + ": " +
        JSON.stringify(encodeCategory(categories[i])) +
        suffix
    );
}
