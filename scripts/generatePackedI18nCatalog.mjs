import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import LZString from "lz-string";
import ts from "typescript";

const { compressToBase64 } = LZString;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const sourcePath = path.join(projectRoot, "src/i18n/locales/en.source.ts");
const outputPath = path.join(projectRoot, "src/i18n/locales/en.ts");
const zhSourcePath = path.join(projectRoot, "src/i18n/locales/zh-CN.ts");
const zhOutputPath = path.join(projectRoot, "src/i18n/locales/zh-CN.packed.ts");
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
import { decompressFromBase64 } from "lz-string";
const ENGLISH_DATA = decompressFromBase64(${JSON.stringify(compressToBase64(data.join("~")))}).split("~");
const englishTranslations: Record<string, string> = {};
for (let index = 0; index < ENGLISH_DATA.length; index += 2) {
  const compactKey = ENGLISH_DATA[index];
  const prefix = compactKey[0] === "s" ? "settings." : "agentChat.";
  englishTranslations[prefix + compactKey.slice(1)] = ENGLISH_DATA[index + 1];
}
export const ENGLISH_TRANSLATIONS = englishTranslations as Readonly<Record<string, string>>;
`;
fs.writeFileSync(outputPath, output);

const zhSource = fs.readFileSync(zhSourcePath, "utf8");
const zhSourceFile = ts.createSourceFile(
  zhSourcePath,
  zhSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
);
const zhDeclaration = zhSourceFile.statements
  .filter(ts.isVariableStatement)
  .flatMap((statement) => [...statement.declarationList.declarations])
  .find(
    (declaration) =>
      ts.isIdentifier(declaration.name) && declaration.name.text === "ZH_CN_VALUES"
  );
const concatCall = zhDeclaration?.initializer;
if (
  !concatCall ||
  !ts.isCallExpression(concatCall) ||
  !ts.isPropertyAccessExpression(concatCall.expression) ||
  concatCall.expression.name.text !== "concat"
) {
  throw new Error("ZH_CN_VALUES must append translations with .concat([...])");
}
const splitCall = concatCall.expression.expression;
if (
  !ts.isCallExpression(splitCall) ||
  !ts.isPropertyAccessExpression(splitCall.expression) ||
  splitCall.expression.name.text !== "split" ||
  !ts.isStringLiteral(splitCall.expression.expression) ||
  splitCall.arguments.length !== 1 ||
  !ts.isStringLiteral(splitCall.arguments[0])
) {
  throw new Error("ZH_CN_VALUES must begin with a packed string split by a literal separator");
}
const zhValues = splitCall.expression.expression.text.split(splitCall.arguments[0].text);
for (const argument of concatCall.arguments) {
  if (!ts.isArrayLiteralExpression(argument)) {
    throw new Error("ZH_CN_VALUES .concat() arguments must be string arrays");
  }
  for (const element of argument.elements) {
    if (!ts.isStringLiteral(element) && !ts.isNoSubstitutionTemplateLiteral(element)) {
      throw new Error("ZH_CN_VALUES entries must be string literals");
    }
    zhValues.push(element.text);
  }
}
if (zhValues.some((value) => value.includes("~"))) {
  throw new Error("Simplified Chinese catalog contains the packed-data separator '~'");
}
if (zhValues.length !== data.length / 2) {
  throw new Error(
    `Simplified Chinese catalog has ${zhValues.length} values for ${data.length / 2} English keys`
  );
}

const zhOutput = `/** Generated from zh-CN.ts by scripts/generatePackedI18nCatalog.mjs. */
import { ENGLISH_TRANSLATIONS } from "@/i18n/locales/en";
import { decompressFromBase64 } from "lz-string";
const ZH_CN_VALUES = decompressFromBase64(${JSON.stringify(compressToBase64(zhValues.join("~")))}).split("~");
export const ZH_CN_TRANSLATIONS = Object.fromEntries(
  Object.keys(ENGLISH_TRANSLATIONS).map((key, index) => [key, ZH_CN_VALUES[index]])
) as Readonly<Record<keyof typeof ENGLISH_TRANSLATIONS, string>>;
`;
fs.writeFileSync(zhOutputPath, zhOutput);
