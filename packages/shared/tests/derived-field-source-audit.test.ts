import { describe, expect, test } from "bun:test";
import * as ts from "typescript";

const productionRoots = [
  "packages/shared/src",
  "packages/daemon/src",
  "packages/cli/src",
  "packages/web/app",
  "packages/web/components",
  "packages/web/lib",
];

const registryFile = "packages/shared/src/derived-axis-registry.ts";
const migrationFile = "packages/daemon/src/services/collection-migration.ts";
const typesFile = "packages/shared/src/types.ts";
const factualVectorFile = "packages/daemon/src/services/feature-vector.ts";
const derivedFieldIds = ["communityRating", "weight", "playerCountFit", "playingTime"] as const;
const derivedFieldIdSet = new Set<string>(derivedFieldIds);
const currentSchemaWriteOwners = new Map<string, ReadonlySet<string>>([
  ["packages/daemon/src/services/bgg-xml-parser.ts", new Set(["playingTime"])],
  ["packages/daemon/src/services/game-service.ts", new Set(["playingTime"])],
  ["packages/daemon/src/services/prediction-service.ts", new Set(["playingTime"])],
  ["packages/web/components/manual-game-values-form.tsx", new Set(["playingTime"])],
]);

function parseSource(filePath: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

type AuditDeclaration = ts.TypeAliasDeclaration | ts.InterfaceDeclaration | ts.VariableDeclaration;

function enclosingDeclaration(node: ts.Node): AuditDeclaration | undefined {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (
      ts.isTypeAliasDeclaration(current) ||
      ts.isInterfaceDeclaration(current) ||
      ts.isVariableDeclaration(current)
    ) {
      return current;
    }
  }
  return undefined;
}

function declarationName(declaration: AuditDeclaration | undefined): string | undefined {
  return declaration !== undefined && ts.isIdentifier(declaration.name)
    ? declaration.name.text
    : undefined;
}

function isApprovedClosedTypeUse(filePath: string, node: ts.Node): boolean {
  if (filePath !== typesFile) return false;
  const name = declarationName(enclosingDeclaration(node));
  return name === "DerivedFieldId" || name === "DerivedAxisConfigurationByField";
}

function isApprovedFactualVectorLiteral(filePath: string, node: ts.Node): boolean {
  return (
    filePath === factualVectorFile &&
    declarationName(enclosingDeclaration(node)) === "FACTUAL_VECTOR_DIMENSIONS"
  );
}

function isApprovedCurrentSchemaWrite(filePath: string, node: ts.Node): boolean {
  const fields = currentSchemaWriteOwners.get(filePath);
  if (
    fields === undefined ||
    (!ts.isIdentifier(node) &&
      !ts.isStringLiteral(node) &&
      !ts.isNoSubstitutionTemplateLiteral(node)) ||
    !fields.has(node.text)
  ) {
    return false;
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return true;
  return (
    ts.isIdentifier(node) &&
    ((ts.isPropertyAssignment(node.parent) && node.parent.name === node) ||
      (ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node))
  );
}

function containsBehavior(initializer: ts.Expression): boolean {
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) return true;
  if (ts.isIdentifier(initializer)) return true;
  if (ts.isCallExpression(initializer)) {
    const callee = initializer.expression;
    const name = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : "";
    return /resolver|handler|dispatch/i.test(name);
  }
  if (ts.isArrayLiteralExpression(initializer)) {
    return initializer.elements.some(
      (element) => ts.isExpression(element) && containsBehavior(element),
    );
  }
  if (ts.isObjectLiteralExpression(initializer)) {
    return initializer.properties.some((property) => {
      if (ts.isShorthandPropertyAssignment(property) || ts.isMethodDeclaration(property)) {
        return true;
      }
      return ts.isPropertyAssignment(property) && containsBehavior(property.initializer);
    });
  }
  return false;
}

function hasDerivedDispatchContext(node: ts.Node): boolean {
  const contextName = /derived|template|registry|resolver|handler|dispatch/i;
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (
      (ts.isVariableDeclaration(current) ||
        ts.isFunctionDeclaration(current) ||
        ts.isMethodDeclaration(current) ||
        ts.isPropertyAssignment(current)) &&
      current.name !== undefined &&
      ts.isIdentifier(current.name) &&
      contextName.test(current.name.text)
    ) {
      return true;
    }
  }
  return false;
}

function isBehaviorDispatchProperty(node: ts.Identifier): boolean {
  if (node.text === "weight" && !hasDerivedDispatchContext(node)) return false;
  const parent = node.parent;
  if (ts.isMethodDeclaration(parent) && parent.name === node) return true;
  if (!ts.isPropertyAssignment(parent) || parent.name !== node) return false;
  return containsBehavior(parent.initializer);
}

function isUnquotedClientFieldId(filePath: string, node: ts.Identifier): boolean {
  if (!filePath.startsWith("packages/web/") && !filePath.startsWith("packages/cli/")) return false;
  if (node.text === "playerCountFit") return true;
  const parent = node.parent;
  if (ts.isMethodDeclaration(parent) || ts.isShorthandPropertyAssignment(parent)) {
    return parent.name === node && (node.text !== "weight" || hasDerivedDispatchContext(node));
  }
  if (!ts.isPropertyAssignment(parent) || parent.name !== node) return false;
  if (node.text !== "weight") return true;
  return (
    hasDerivedDispatchContext(node) &&
    (ts.isObjectLiteralExpression(parent.initializer) ||
      ts.isArrayLiteralExpression(parent.initializer))
  );
}

async function productionFiles(): Promise<string[]> {
  const paths: string[] = [];
  for (const root of productionRoots) {
    const files = new Bun.Glob("**/*.{ts,tsx}");
    for await (const relativePath of files.scan(root)) paths.push(`${root}/${relativePath}`);
  }
  return paths.sort();
}

describe("derived-field production ownership", () => {
  test("pins the only closed field declarations and canonical factual vector names", async () => {
    const typesSource = parseSource(typesFile, await Bun.file(typesFile).text());
    const fieldType = typesSource.statements.find(
      (statement): statement is ts.TypeAliasDeclaration =>
        ts.isTypeAliasDeclaration(statement) && statement.name.text === "DerivedFieldId",
    );
    expect(fieldType).toBeDefined();
    expect(
      fieldType !== undefined && ts.isUnionTypeNode(fieldType.type)
        ? fieldType.type.types.map((type) =>
            ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)
              ? type.literal.text
              : null,
          )
        : [],
    ).toEqual([...derivedFieldIds]);

    const configurationType = typesSource.statements.find(
      (statement): statement is ts.InterfaceDeclaration =>
        ts.isInterfaceDeclaration(statement) &&
        statement.name.text === "DerivedAxisConfigurationByField",
    );
    expect(configurationType).toBeDefined();
    expect(
      configurationType?.members.map((member) =>
        member.name !== undefined && ts.isIdentifier(member.name) ? member.name.text : null,
      ),
    ).toEqual([...derivedFieldIds]);

    const vectorSource = parseSource(factualVectorFile, await Bun.file(factualVectorFile).text());
    const vectorDeclaration = vectorSource.statements
      .filter(ts.isVariableStatement)
      .flatMap((statement) => [...statement.declarationList.declarations])
      .find(
        (declaration) =>
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === "FACTUAL_VECTOR_DIMENSIONS",
      );
    const vectorInitializer =
      vectorDeclaration?.initializer !== undefined &&
      ts.isAsExpression(vectorDeclaration.initializer) &&
      ts.isArrayLiteralExpression(vectorDeclaration.initializer.expression)
        ? vectorDeclaration.initializer.expression
        : undefined;
    expect(
      vectorInitializer?.elements.map((element) =>
        ts.isStringLiteral(element) ? element.text : null,
      ),
    ).toEqual([
      "weight",
      "communityRating",
      "minPlayers",
      "maxPlayers",
      "bestPlayers",
      "playingTime",
    ]);
  });

  test("keeps concrete derived IDs and behavioral dispatch at registry or migration boundaries", async () => {
    const violations: string[] = [];

    for (const filePath of await productionFiles()) {
      if (filePath === registryFile || filePath === migrationFile) continue;
      const sourceFile = parseSource(filePath, await Bun.file(filePath).text());

      function inspect(node: ts.Node): void {
        if (
          (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
          derivedFieldIdSet.has(node.text) &&
          !isApprovedClosedTypeUse(filePath, node) &&
          !isApprovedFactualVectorLiteral(filePath, node) &&
          !isApprovedCurrentSchemaWrite(filePath, node)
        ) {
          violations.push(
            `${filePath}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1} concrete derived ID literal`,
          );
        }

        if (
          ts.isIdentifier(node) &&
          derivedFieldIdSet.has(node.text) &&
          !isApprovedClosedTypeUse(filePath, node) &&
          !isApprovedCurrentSchemaWrite(filePath, node) &&
          (isUnquotedClientFieldId(filePath, node) || isBehaviorDispatchProperty(node))
        ) {
          violations.push(
            `${filePath}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1} unquoted derived-field dispatch`,
          );
        }

        ts.forEachChild(node, inspect);
      }

      inspect(sourceFile);
    }

    expect(violations).toEqual([]);
  });
});
