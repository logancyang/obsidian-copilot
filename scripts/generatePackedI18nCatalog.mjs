import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const sourcePath = path.join(projectRoot, "src/i18n/locales/en.source.ts");
const outputPath = path.join(projectRoot, "src/i18n/locales/en.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const sourceFile = ts.createSourceFile(
  sourcePath,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
);
const catalogStatement = sourceFile.statements.find(
  (statement) =>
    ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some(
      (declaration) =>
        ts.isIdentifier(declaration.name) && declaration.name.text === "ENGLISH_TRANSLATIONS"
    )
);
const catalogDeclaration = catalogStatement?.declarationList.declarations.find(
  (declaration) =>
    ts.isIdentifier(declaration.name) && declaration.name.text === "ENGLISH_TRANSLATIONS"
);
let initializer = catalogDeclaration?.initializer;
while (initializer && (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer))) {
  initializer = initializer.expression;
}
if (!initializer || !ts.isObjectLiteralExpression(initializer)) {
  throw new Error("ENGLISH_TRANSLATIONS must be an object literal");
}

const data = [];
for (const property of initializer.properties) {
  if (
    !ts.isPropertyAssignment(property) ||
    !ts.isStringLiteral(property.name) ||
    (!ts.isStringLiteral(property.initializer) &&
      !ts.isNoSubstitutionTemplateLiteral(property.initializer))
  ) {
    throw new Error("English catalog entries must use string-literal keys and values");
  }
  const key = property.name.text;
  const compactKey = key.startsWith("settings.")
    ? `s${key.slice("settings.".length)}`
    : key.startsWith("agentChat.")
      ? `a${key.slice("agentChat.".length)}`
      : null;
  if (compactKey === null) throw new Error(`Unsupported catalog prefix: ${key}`);
  data.push(compactKey, property.initializer.text);
}
if (data.some((value) => value.includes("~"))) {
  throw new Error("Catalog contains the packed-data separator '~'");
}

const output = `/** Generated from en.source.ts by scripts/generatePackedI18nCatalog.mjs. */
const ENGLISH_DATA = ${JSON.stringify(data.join("~"))}.split("~");
const englishTranslations: Record<string, string> = {};
for (let index = 0; index < ENGLISH_DATA.length; index += 2) {
  const compactKey = ENGLISH_DATA[index];
  const prefix = compactKey[0] === "s" ? "settings." : "agentChat.";
  englishTranslations[prefix + compactKey.slice(1)] = ENGLISH_DATA[index + 1];
}
export const ENGLISH_TRANSLATIONS = englishTranslations as Readonly<Record<string, string>>;
`;
fs.writeFileSync(outputPath, output);
