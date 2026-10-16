// Status is derived from the checklist, never claimed: https://github.com/Brevilabs/obsidian-copilot-private/issues/614
import fs from "node:fs";

const ATTACHMENT = /^https:\/\/github\.com\/user-attachments\/(assets|files)\/[^\s]+$/;

export function buildGate({
  sha,
  checklist = [],
  naReason = null,
  errorsClean = true,
  video = null,
}) {
  if (!sha) throw new Error("sha is required");
  for (const item of checklist) {
    for (const url of item.evidence ?? []) {
      if (!ATTACHMENT.test(url)) throw new Error(`evidence is not a GitHub attachment URL: ${url}`);
    }
  }
  if (video && !ATTACHMENT.test(video))
    throw new Error(`video is not a GitHub attachment URL: ${video}`);
  let status;
  if (naReason) {
    status = "na";
  } else {
    if (checklist.length === 0) throw new Error("checklist is empty and no na reason was given");
    const passing = checklist.every((c) => c.status === "pass" && (c.evidence ?? []).length > 0);
    status = passing && errorsClean ? "pass" : "fail";
  }
  return {
    status,
    sha,
    na_reason: naReason || null,
    checklist,
    errors_clean: errorsClean,
    video: video || null,
  };
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, "")] = argv[i + 1];
  if (!args.out) throw new Error("--out is required");
  const checklist = args.checklist ? JSON.parse(fs.readFileSync(args.checklist, "utf8")) : [];
  const gate = buildGate({
    sha: args.sha,
    checklist,
    naReason: args["na-reason"],
    errorsClean: args["errors-clean"] !== "false",
    video: args.video,
  });
  fs.writeFileSync(args.out, JSON.stringify(gate, null, 2) + "\n");
  console.log(args.out);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`gate-json: ${e.message}`);
    process.exit(1);
  }
}
