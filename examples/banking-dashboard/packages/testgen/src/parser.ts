import fs from 'node:fs';
import path from 'node:path';

import { Project, SourceFile, TypeChecker } from 'ts-morph';
import { ROOT_DIR } from './config';

export interface ParserContext {
  project: Project;
  checker: TypeChecker;
}

export function createParser(rootDir: string = ROOT_DIR): ParserContext {
  const tsconfigPath = path.join(rootDir, 'tsconfig.json');
  const project = fs.existsSync(tsconfigPath)
    ? new Project({ tsConfigFilePath: tsconfigPath })
    : new Project({
        compilerOptions: {
          jsx: 2,
          target: 4,
          module: 1,
        },
      });

  return { project, checker: project.getTypeChecker() };
}

export function getSourceFile(project: Project, filePath: string): SourceFile {
  const existing = project.getSourceFile(filePath);
  if (existing) return existing;
  return project.addSourceFileAtPath(filePath);
}
