import { getTS } from '../utils/tsconfig.mjs';

export function markExportKinds(components, checker, sourceFile) {
  const ts = getTS();

  const visit = (node) => {
    if (ts.isExportDeclaration(node)) {
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          const name = element.propertyName?.text || element.name.text;
          const comp = components.find((c) => c.name === name);
          if (comp) comp.isExported = true;
        }
      }
    }

    if (
      ts.isFunctionDeclaration(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      const name = node.name?.text;
      if (name) {
        const comp = components.find((c) => c.name === name);
        if (comp) {
          comp.isExported = true;
          if (node.modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
            comp.isDefault = true;
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

export function getComponentPropsType(checker, sourceFile, exportLookup) {
  const ts = getTS();
  const symbol = checker.getSymbolAtLocation(exportLookup);

  if (!symbol) return null;

  const type = checker.getTypeOfSymbolAtLocation(symbol, sourceFile);
  const callSignatures = type.getCallSignatures();

  if (callSignatures.length === 0) return null;

  const returnType = callSignatures[0].getReturnType();
  const properties = returnType.isUnion() ? null : returnType.getProperties?.() || [];

  return properties;
}

export function extractPropsFromChecker(ts, checker, propsType) {
  if (!propsType) return [];

  const props = [];

  for (const prop of propsType) {
    const name = prop.getName();
    const type = checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration);
    const typeString = checker.typeToString(type);
    const isRequired = !!(type.flags & ts.TypeFlags.Undefined) === false;

    props.push({
      name,
      type: typeString,
      isRequired,
      isCallback: typeString.includes('=>'),
      isBoolean: typeString === 'boolean',
    });
  }

  return props;
}

export function mockValueForType(ts, checker, type) {
  const typeString = checker.typeToString(type);

  if (typeString === 'boolean') return 'true';
  if (typeString === 'number') return '42';
  if (typeString === 'string') return '"test"';
  if (typeString.includes('=>')) return 'jest.fn()';
  if (typeString.includes('[]')) return '[]';
  if (typeString.includes('{}') || typeString === 'object') return '{}';

  return 'undefined';
}

export function getTypeChecker(program) {
  return program.getTypeChecker();
}
