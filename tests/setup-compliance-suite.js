var crypto = require("crypto");
var fs = require("fs");
var https = require("https");
var path = require("path");

var revision = "7be7c1fc28057c91e8eefaf197060fba7ed43acd";
var targetDir = path.join(__dirname, "jsonpath-compliance-test-suite");
var files = [
    {
        name: "cts.json",
        sha256: "a85db53fba1f675be48b534baec5a754dc685ad08c550d8927f609c7708f365a"
    },
    {
        name: "LICENSE",
        sha256: "0a76d5e15eeff92346a8783de64d5164c4d527a163f8599733e4e0ab941b59c0"
    }
];

function download(url, callback) {
    https.get(url, function (response) {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            response.resume();
            download(response.headers.location, callback);
            return;
        }
        if (response.statusCode !== 200) {
            callback(new Error("Download failed with HTTP " + response.statusCode + ": " + url));
            response.resume();
            return;
        }
        var chunks = [];
        response.on("data", function (chunk) { chunks.push(chunk); });
        response.on("end", function () { callback(null, Buffer.concat(chunks)); });
    }).on("error", callback);
}

function install(index) {
    if (index >= files.length) {
        console.log("Installed JSONPath CTS revision " + revision + " in " + targetDir);
        return;
    }

    var file = files[index];
    var url = "https://raw.githubusercontent.com/jsonpath-standard/" +
        "jsonpath-compliance-test-suite/" + revision + "/" + file.name;

    download(url, function (error, content) {
        if (error) throw error;
        var actualHash = crypto.createHash("sha256").update(content).digest("hex");
        if (actualHash !== file.sha256) {
            throw new Error(
                "SHA-256 mismatch for " + file.name + ": expected " +
                file.sha256 + " but got " + actualHash
            );
        }
        fs.writeFileSync(path.join(targetDir, file.name), content);
        console.log("Installed " + file.name + " (SHA-256 verified)");
        install(index + 1);
    });
}

if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
install(0);
