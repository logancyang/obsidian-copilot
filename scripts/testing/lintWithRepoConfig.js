const { execFileSync } = require("child_process");

function lintWithRepoConfig(root, probes) {
  const script = `
    const { ESLint } = require("eslint");
    const eslint = new ESLint();
    (async () => {
      const reports = [];
      for (const [filePath, source] of JSON.parse(process.argv[1])) {
        const [result] = await eslint.lintText(source, { filePath });
        reports.push(result.messages.map((message) => message.ruleId + ": " + message.message));
      }
      process.stdout.write(JSON.stringify(reports));
    })();
  `;
  const envThatLintsProbeTextEvenWhenCiIsSet = { ...process.env, TSESTREE_SINGLE_RUN: "false" };
  const output = execFileSync(process.execPath, ["-e", script, JSON.stringify(probes)], {
    cwd: root,
    env: envThatLintsProbeTextEvenWhenCiIsSet,
  });
  return JSON.parse(output.toString());
}

module.exports = { lintWithRepoConfig };
