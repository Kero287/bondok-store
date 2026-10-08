const { mkdir, copyFile, cp } = require("node:fs/promises");
const { join } = require("node:path");
const files = require("../public-files");

(async () => {
    const root = join(__dirname, "..");
    const output = join(root, "public");
    await mkdir(output, { recursive: true });
    for (const file of files) await copyFile(join(root, file), join(output, file));
    await cp(join(root, "images"), join(output, "images"), { recursive: true });
    console.log("Built public website assets.");
})().catch(error => { console.error(error); process.exitCode = 1; });
