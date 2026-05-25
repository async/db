import path from 'node:path';
import { dbError, listChoices } from '../../errors.js';
import { readText, writeText } from '../../fs-utils.js';
import { resolveResource } from '../../names.js';
import { loadProjectSchema } from '../../schema.js';
import { generateSchemaManifest } from '../../schema-manifest.js';
import { isHelpRequested, valueAfter } from '../args.js';
import { printDiagnostic, printSchemaHelp } from '../output.js';
import { promptForSchemaTarget } from '../schema-prompt.js';

export async function runSchema(config, args) {
  if (isHelpRequested(args)) {
    printSchemaHelp();
    return;
  }

  if (args[0] === 'infer') {
    await runSchemaInfer(config, args);
    return;
  }

  const project = await loadProjectSchema(config);

  if (args[0] === 'manifest') {
    const result = await generateSchemaManifest(config, {
      project,
      outFile: valueAfter(args, '--out'),
    });

    if (result.outFiles.length === 0) {
      console.log(result.content);
      return;
    }

    for (const filePath of result.outFiles) {
      console.log(`Generated ${path.relative(config.cwd, filePath)}`);
    }
    return;
  }

  if (args[0] === 'unbundle') {
    const prompted = await promptedSchemaTarget('unbundle', project, args);
    if (hasFlag(args, '--all') || prompted?.all) {
      await runSchemaUnbundleAll(config, project, args);
      return;
    }
    await runSchemaUnbundle(config, project, args, { resourceName: prompted?.resourceName });
    return;
  }

  if (args[0] === 'bundle') {
    const prompted = await promptedSchemaTarget('bundle', project, args);
    if (hasFlag(args, '--all') || prompted?.all) {
      await runSchemaBundleAll(config, project, args);
      return;
    }
    await runSchemaBundle(config, project, args, { resourceName: prompted?.resourceName });
    return;
  }

  if (args[0] === 'validate') {
    for (const diagnostic of project.diagnostics) {
      printDiagnostic(diagnostic);
    }

    const errorCount = project.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
    if (errorCount > 0) {
      process.exitCode = 1;
      return;
    }

    console.log(project.diagnostics.length === 0 ? 'Schema valid' : 'Schema valid with warnings');
    return;
  }

  if (args[0]) {
    const resourceMap = new Map(project.resources.map((resource) => [resource.name, resource]));
    const { resource, candidates } = resolveResource(resourceMap, args[0]);
    if (!resource) {
      throw dbError(
        'SCHEMA_UNKNOWN_RESOURCE',
        `Unknown schema resource "${args[0]}".`,
        {
          status: 404,
          hint: `Use one of: ${listChoices(project.resources.map((resource) => resource.name))}.`,
          details: {
            resource: args[0],
            requestedResource: args[0],
            normalizedCandidates: candidates,
            availableResources: project.resources.map((resource) => resource.name),
          },
        },
      );
    }

    console.log(JSON.stringify(project.schema.resources[resource.name], null, 2));
    return;
  }

  console.log(JSON.stringify(project.schema, null, 2));
}

async function runSchemaUnbundle(config, project, args, options = {}) {
  const resourceName = options.resourceName ?? positionalArgs(args.slice(1))[0];
  if (!resourceName) {
    const example = schemaTargetExample(project);
    throw dbError(
      'SCHEMA_UNBUNDLE_REQUIRES_RESOURCE',
      `SCHEMA_UNBUNDLE_REQUIRES_RESOURCE: schema unbundle requires a resource name. Use async-db schema unbundle ${example}, or async-db schema unbundle --all.`,
      {
        hint: `Use async-db schema unbundle ${example}, or async-db schema unbundle --all.`,
      },
    );
  }

  const resource = requireSchemaResource(project, resourceName);
  const explicitSchemaOutFile = outputPath(config, valueAfter(args, '--schema-out'));
  if (!explicitSchemaOutFile && resource.schemaPath?.endsWith('.schema.mjs')) {
    throw dbError(
      'SCHEMA_UNBUNDLE_SCHEMA_MJS_REQUIRES_OUT',
      `SCHEMA_UNBUNDLE_SCHEMA_MJS_REQUIRES_OUT: schema unbundle cannot rewrite ${path.relative(config.cwd, resource.schemaPath)} in place.`,
      {
        hint: 'Use --schema-out to write a JSON/JSONC schema source, then replace the .schema.mjs file when you are ready.',
      },
    );
  }

  const schemaOutFile = explicitSchemaOutFile ?? defaultSchemaOutFile(config, resource);
  const explicitSeedOutFile = outputPath(config, valueAfter(args, '--seed-out'));
  const force = hasFlag(args, '--force');
  const includeEmptySeed = hasFlag(args, '--empty-seed');
  const shouldWriteSeed = (explicitSeedOutFile !== undefined || !resource.dataPath)
    && (includeEmptySeed || !isEmptySeed(resource.seed, resource.kind));
  const seedOutFile = explicitSeedOutFile ?? defaultSeedOutFile(config, resource);
  const generated = [];

  if (shouldWriteSeed) {
    await writeOutput(seedOutFile, `${JSON.stringify(resource.seed, null, 2)}\n`, config, { force });
    generated.push(seedOutFile);
  }

  if (!explicitSchemaOutFile && resource.schemaPath?.endsWith('.schema.jsonc')) {
    console.error(`warn: schema unbundle rewrites ${path.relative(config.cwd, schemaOutFile)} without preserving JSONC comments.`);
  }

  await writeText(schemaOutFile, `${JSON.stringify(schemaSourceForResource(resource), null, 2)}\n`);
  generated.push(schemaOutFile);

  for (const filePath of generated) {
    console.log(`Generated ${path.relative(config.cwd, filePath)}`);
  }
}

async function runSchemaBundle(config, project, args, options = {}) {
  const resourceName = options.resourceName ?? positionalArgs(args.slice(1))[0];
  if (!resourceName) {
    const example = schemaTargetExample(project);
    throw dbError(
      'SCHEMA_BUNDLE_REQUIRES_RESOURCE',
      `SCHEMA_BUNDLE_REQUIRES_RESOURCE: schema bundle requires a resource name. Use async-db schema bundle ${example} --out artifacts/${example}.bundle.schema.json, or async-db schema bundle --all.`,
      {
        hint: `Use async-db schema bundle ${example} --out artifacts/${example}.bundle.schema.json, or async-db schema bundle --all.`,
      },
    );
  }

  const resource = requireSchemaResource(project, resourceName);
  const content = `${JSON.stringify(schemaSourceForResource(resource, { includeSeed: true }), null, 2)}\n`;
  const outFile = outputPath(config, valueAfter(args, '--out'));
  if (!outFile) {
    console.log(content.trimEnd());
    return;
  }

  const force = hasFlag(args, '--force');
  if (isInsidePath(config.sourceDir, outFile) && !force) {
    throw dbError(
      'SCHEMA_BUNDLE_LIVE_OUTPUT_REQUIRES_FORCE',
      `SCHEMA_BUNDLE_LIVE_OUTPUT_REQUIRES_FORCE: schema bundle output ${path.relative(config.cwd, outFile)} is inside the active fixture directory.`,
      {
        hint: 'Write bundled schema artifacts outside db/, or pass --force if you intentionally want a live bundled schema source.',
      },
    );
  }

  await writeOutput(outFile, content, config, { force });
  console.log(`Generated ${path.relative(config.cwd, outFile)}`);
}

async function runSchemaBundleAll(config, project, args) {
  const outFile = outputPath(config, valueAfter(args, '--out')) ?? path.join(config.cwd, 'db.schema.mjs');
  const force = hasFlag(args, '--force');
  const duplicate = bundleDuplicateResourceDiagnostic(config, project);
  if (duplicate) {
    throw dbError(duplicate.code, `${duplicate.code}: ${duplicate.message}`, {
      hint: duplicate.hint,
      details: duplicate.details,
    });
  }

  if (isInsidePath(config.sourceDir, outFile) && !force) {
    const relative = path.relative(config.cwd, outFile);
    throw dbError(
      'SCHEMA_BUNDLE_LIVE_OUTPUT_REQUIRES_FORCE',
      `SCHEMA_BUNDLE_LIVE_OUTPUT_REQUIRES_FORCE: schema bundle output ${relative} is inside the active fixture directory.`,
      {
        hint: 'Write the root schema outside db/, or pass --force if you intentionally want a live schema source inside db/.',
        details: {
          command: 'schema bundle --all',
          file: relative,
          sourceDir: path.relative(config.cwd, config.sourceDir),
          severity: 'error',
        },
      },
    );
  }

  const result = renderRootSchemaBundle(config, project, outFile);
  const rootOutFile = path.resolve(config.cwd, 'db.schema.mjs');
  const plannedWrites = [
    ...bundleAllSeedWrites(config, project, { force }),
    {
      filePath: outFile,
      content: result.content,
      options: {
        force,
        existsCode: path.resolve(outFile) === rootOutFile ? 'SCHEMA_BUNDLE_ROOT_EXISTS' : 'SCHEMA_BUNDLE_OUTPUT_EXISTS',
        existsHint: path.resolve(outFile) === rootOutFile
          ? 'Review the existing root schema, choose a different --out path, or pass --force to replace it.'
          : 'Review the existing output, choose a different --out path, or pass --force to overwrite it.',
        command: 'schema bundle --all',
      },
    },
  ];
  const preflight = [];
  for (const write of plannedWrites) {
    preflight.push({
      ...write,
      result: await preflightOutput(write.filePath, write.content, config, write.options),
    });
  }

  for (const diagnostic of result.diagnostics) {
    printDiagnostic(diagnostic);
  }
  for (const write of preflight) {
    if (!write.result.shouldWrite) {
      continue;
    }
    await writeText(write.filePath, write.content);
    if (write.diagnostic) {
      printDiagnostic(write.diagnostic);
    }
    if (write.kind === 'seed') {
      console.log(`Generated ${path.relative(config.cwd, write.filePath)}`);
    }
  }
  console.log(`Generated ${path.relative(config.cwd, outFile)}`);
}

async function runSchemaUnbundleAll(config, project, args) {
  const schemaDir = outputPath(config, valueAfter(args, '--schema-dir')) ?? config.sourceDir;
  const force = hasFlag(args, '--force');
  if (!project.rootSchema?.found) {
    throw dbError(
      'SCHEMA_UNBUNDLE_ROOT_REQUIRED',
      'SCHEMA_UNBUNDLE_ROOT_REQUIRED: schema unbundle --all requires db.schema.mjs.',
      {
        hint: 'Create db.schema.mjs first with async-db schema bundle --all, or unbundle a single resource by name.',
        details: {
          command: 'schema unbundle --all',
          file: 'db.schema.mjs',
          severity: 'error',
        },
      },
    );
  }

  printDiagnostic({
    code: 'SCHEMA_UNBUNDLE_SEED_NOT_MOVED',
    severity: 'warn',
    message: 'SCHEMA_UNBUNDLE_SEED_NOT_MOVED: schema unbundle --all writes schema files only; seed/data fixtures are left untouched.',
    hint: 'Use single-resource schema unbundle with --seed-out when you want to move embedded seed data.',
    details: {
      command: 'schema unbundle --all',
    },
  });

  for (const resource of project.resources) {
    const executable = resourceHasExecutableSchema(resource);
    const outFile = resource.source
      ? path.join(schemaDir, resource.name, 'index.schema.mjs')
      : path.join(schemaDir, `${resource.name}.schema.${executable ? 'mjs' : 'jsonc'}`);
    const content = executable
      ? renderUnbundledSchemaModule(config, resource, outFile)
      : `${JSON.stringify(schemaSourceForResource(resource), null, 2)}\n`;

    if (resourceHasExecutableFunctions(resource)) {
      printDiagnostic(executableUnbundleDiagnostic(config, resource, outFile));
    }

    await writeOutput(outFile, content, config, {
      force,
      existsCode: 'SCHEMA_UNBUNDLE_OUTPUT_EXISTS',
      existsHint: 'Review the existing per-resource schema file, choose a different --schema-dir, or pass --force to overwrite it.',
      command: 'schema unbundle --all',
      resource: resource.name,
    });
    console.log(`Generated ${path.relative(config.cwd, outFile)}`);
  }
}

async function runSchemaInfer(config, args) {
  const resourceName = positionalArgs(args.slice(1))[0];
  const outFile = valueAfter(args, '--out');
  const inferredConfig = {
    ...config,
    schema: {
      ...config.schema,
      source: 'data',
    },
  };
  const project = await loadProjectSchema(inferredConfig);

  if (outFile && !resourceName) {
    throw dbError(
      'SCHEMA_INFER_OUT_REQUIRES_RESOURCE',
      'SCHEMA_INFER_OUT_REQUIRES_RESOURCE: schema infer --out requires a resource name.',
      {
        hint: 'Use async-db schema infer users --out db/users.schema.jsonc.',
      },
    );
  }

  if (resourceName) {
    const resource = requireSchemaResource(project, resourceName);
    if (outFile) {
      const outputPath = path.resolve(config.cwd, outFile);
      await writeText(outputPath, `${JSON.stringify(schemaSourceForResource(resource), null, 2)}\n`);
      console.log(`Generated ${path.relative(config.cwd, outputPath)}`);
      return;
    }

    console.log(JSON.stringify(project.schema.resources[resource.name], null, 2));
    return;
  }

  console.log(JSON.stringify(project.schema, null, 2));
}

async function promptedSchemaTarget(command, project, args) {
  if (hasFlag(args, '--all') || positionalArgs(args.slice(1))[0]) {
    return undefined;
  }

  return promptForSchemaTarget({
    command,
    resources: project.resources.map((resource) => resource.name),
  });
}

function schemaTargetExample(project) {
  return project.resources[0]?.name ?? '<resource>';
}

function renderRootSchemaBundle(config, project, outFile) {
  const imports = new Map();
  const diagnostics = [];
  for (const resource of project.resources) {
    if (!resource.schemaPath?.endsWith('.schema.mjs') || !resourceHasExecutableFunctions(resource)) {
      continue;
    }
    ensureResourceImport(resource, imports);
    if (resourceHasStandardValidator(resource)) {
      diagnostics.push(importedValidatorDiagnostic(config, resource));
    }
    if (!resourceHasResolvers(resource)) {
      continue;
    }
    for (const [fieldName, resolver] of Object.entries(resource.resolvers?.fields ?? {})) {
      for (const resolverKind of ['resolve', 'resolveMany']) {
        if (!resolver[resolverKind]) {
          continue;
        }
        diagnostics.push(importedResolverDiagnostic(config, resource, fieldName, resolverKind));
        if (isArrowLikeFunction(resolver[resolverKind])) {
          diagnostics.push(arrowResolverDiagnostic(config, resource, fieldName, resolverKind));
        }
      }
    }
  }

  const lines = [
    '// Generated by async-db schema bundle --all.',
    '',
    `import { collection, document, field, files } from '@async/db/schema';`,
  ];
  for (const [sourceFile, alias] of imports) {
    lines.push(`import ${alias} from '${moduleSpecifier(outFile, sourceFile)}';`);
  }
  lines.push('', 'export default {');
  for (const resource of project.resources) {
    lines.push(...renderRootSchemaResource(config, resource, imports));
  }
  lines.push('};', '');

  return {
    content: lines.join('\n'),
    diagnostics,
  };
}

function renderRootSchemaResource(config, resource, imports) {
  const helper = resource.kind === 'document' ? 'document' : 'collection';
  const validator = resourceHasStandardValidator(resource)
    ? validatorAccess(resource, imports)
    : undefined;
  const standardSchemaFirst = shouldEmitStandardSchemaFirst(config, resource) && validator;
  const lines = [
    standardSchemaFirst
      ? `  ${propertyName(resource.name)}: ${helper}(${validator}, {`
      : `  ${propertyName(resource.name)}: ${helper}({`,
  ];
  if (resource.description) {
    lines.push(`    description: ${JSON.stringify(resource.description)},`);
  }
  if (resource.kind === 'collection') {
    lines.push(`    idField: ${JSON.stringify(resource.idField)},`);
  }
  if (resource.source) {
    lines.push(`    source: ${renderSourceExpression(rootSchemaSourceGlob(config, resource))},`);
  }
  if (validator && !standardSchemaFirst) {
    lines.push(`    validator: ${validator},`);
  }
  lines.push('    fields: {');
  for (const [fieldName, field] of Object.entries(resource.fields ?? {})) {
    lines.push(`      ${propertyName(fieldName)}: ${renderFieldExpression(field, resource, fieldName, imports)},`);
  }
  lines.push('    },');
  lines.push('  }),', '');
  return lines;
}

function rootSchemaSourceGlob(config, resource) {
  if (!isFolderMarkerResource(config, resource)) {
    return resource.source;
  }

  if (resource.source?.kind === 'files') {
    return {
      ...resource.source,
      patterns: resource.source.patterns.map((source) => rebaseFolderSourceGlob(config, resource, source)),
    };
  }

  if (Array.isArray(resource.source)) {
    return resource.source.map((source) => rebaseFolderSourceGlob(config, resource, source));
  }

  return rebaseFolderSourceGlob(config, resource, resource.source);
}

function isFolderMarkerResource(config, resource) {
  if (!resource.schemaPath) {
    return false;
  }
  const relative = path.relative(config.cwd, resource.schemaPath).split(path.sep).join('/');
  return relative.endsWith('/index.schema.mjs');
}

function rebaseFolderSourceGlob(config, resource, source) {
  if (typeof source !== 'string' || path.isAbsolute(source)) {
    return source;
  }

  const normalizedSource = source.split('\\').join('/');
  const schemaDir = path.dirname(resource.schemaPath);
  const relativeSchemaDir = path.relative(config.cwd, schemaDir).split(path.sep).join('/');
  const sourcePath = normalizedSource.replace(/^\.\//u, '');
  const rebased = path.posix.normalize(path.posix.join(relativeSchemaDir, sourcePath));
  return rebased.startsWith('.') ? rebased : `./${rebased}`;
}

function renderSourceExpression(source) {
  const normalized = source?.kind === 'files'
    ? source
    : {
      kind: 'files',
      patterns: Array.isArray(source) ? source : [source],
      read: 'frontmatter',
    };
  const patterns = normalized.patterns ?? [];
  const patternExpression = patterns.length === 1 ? JSON.stringify(patterns[0]) : literal(patterns);
  return `files(${patternExpression}, ${objectLiteral({ read: normalized.read ?? 'frontmatter' })})`;
}

function renderFieldExpression(field, resource, fieldName, imports, fieldPath = fieldName, options = {}) {
  const computed = field.computed === true;
  const base = renderBaseFieldExpression(field, resource, fieldPath, imports);
  if (!computed) {
    return base;
  }

  const resolver = resource.resolvers?.fields?.[fieldName];
  if (!resolver) {
    return `field.computed(${base})`;
  }

  const fieldAccess = resolverFieldAccess(resource, fieldName, imports, options);
  if (!fieldAccess) {
    return `field.computed(${base})`;
  }

  if (resolver.resolve && resolver.resolveMany) {
    return [
      `field.computed(${base}, {`,
      `        resolve: function ${resolverFunctionName(resource.name, fieldName, 'resolve')}(context) {`,
      `          return ${fieldAccess}.resolve.call(this, context);`,
      '        },',
      `        resolveMany: function ${resolverFunctionName(resource.name, fieldName, 'resolveMany')}(context) {`,
      `          return ${fieldAccess}.resolveMany.call(this, context);`,
      '        },',
      '      })',
    ].join('\n');
  }

  if (resolver.resolveMany) {
    return [
      `field.computed(${base}, {`,
      `        resolveMany: function ${resolverFunctionName(resource.name, fieldName, 'resolveMany')}(context) {`,
      `          return ${fieldAccess}.resolveMany.call(this, context);`,
      '        },',
      '      })',
    ].join('\n');
  }

  return [
    `field.computed(${base}, function ${resolverFunctionName(resource.name, fieldName, 'resolve')}(context) {`,
    `        return ${fieldAccess}.resolve.call(this, context);`,
    '      })',
  ].join('\n');
}

function renderBaseFieldExpression(field, resource, fieldPath, imports) {
  const options = fieldOptions(field);
  switch (field.type) {
    case 'string':
      return renderFieldCall('field.string', options);
    case 'datetime':
      return renderFieldCall('field.datetime', options);
    case 'number':
      return renderFieldCall('field.number', options);
    case 'boolean':
      return renderFieldCall('field.boolean', options);
    case 'enum':
      return renderFieldCall('field.enum', options, [literal(field.values ?? [])]);
    case 'array':
      return renderFieldCall('field.array', options, [
        renderBaseFieldExpression(field.items ?? { type: 'unknown' }, resource, `${fieldPath}Item`, imports),
      ]);
    case 'object':
      return renderObjectFieldExpression(field, resource, fieldPath, imports, options);
    case 'unknown':
    default:
      return renderFieldCall('field.json', options);
  }
}

function renderObjectFieldExpression(field, resource, fieldPath, imports, options) {
  const fields = field.fields ?? {};
  const fieldEntries = Object.entries(fields);
  if (fieldEntries.length === 0) {
    return renderFieldCall('field.object', options);
  }

  const lines = ['field.object({'];
  for (const [childName, childField] of fieldEntries) {
    lines.push(`        ${propertyName(childName)}: ${renderBaseFieldExpression(childField, resource, `${fieldPath}${childName}`, imports)},`);
  }
  const optionText = renderOptions(options);
  lines.push(`      }${optionText ? `, ${optionText}` : ''})`);
  return lines.join('\n');
}

function fieldOptions(field) {
  const options = {};
  if (field.required === true) {
    options.required = true;
  }
  if (field.nullable === true) {
    options.nullable = true;
  }
  if (field.description !== undefined) {
    options.description = field.description;
  }
  if (field.default !== undefined) {
    options.default = field.default;
  }
  if (field.unique === true) {
    options.unique = true;
  }
  for (const key of ['min', 'max', 'minLength', 'maxLength', 'pattern']) {
    if (field[key] !== undefined) {
      options[key] = field[key];
    }
  }
  if (field.additionalProperties !== undefined) {
    options.additionalProperties = field.additionalProperties;
  }
  if (field.relation !== undefined) {
    options.relation = field.relation;
  }
  return options;
}

function renderFieldCall(callee, options, args = []) {
  const renderedArgs = [...args];
  const optionText = renderOptions(options);
  if (optionText) {
    renderedArgs.push(optionText);
  }
  return `${callee}(${renderedArgs.join(', ')})`;
}

function renderOptions(options) {
  return Object.keys(options).length === 0 ? '' : objectLiteral(options);
}

function renderUnbundledSchemaModule(config, resource, outFile) {
  const imports = new Map();
  const rootSchemaPath = projectRootSchemaPath(config);
  if (resourceHasExecutableFunctions(resource)) {
    imports.set(rootSchemaPath, 'rootSchema');
  }

  return renderSchemaModule(resource, {
    config,
    imports,
    outFile,
    rootSchemaAlias: imports.get(rootSchemaPath),
  });
}

function renderSchemaModule(resource, options = {}) {
  const helper = resource.kind === 'document' ? 'document' : 'collection';
  const lines = [
    `import { collection, document, field, files } from '@async/db/schema';`,
  ];
  for (const [sourceFile, alias] of options.imports ?? []) {
    lines.push(`import ${alias} from '${moduleSpecifier(options.outFile, sourceFile)}';`);
  }
  const validator = resourceHasStandardValidator(resource)
    ? validatorAccess(resource, options.imports ?? new Map(), options)
    : undefined;
  const standardSchemaFirst = shouldEmitStandardSchemaFirst(options.config, resource) && validator;
  lines.push(
    '',
    standardSchemaFirst
      ? `export default ${helper}(${validator}, {`
      : `export default ${helper}({`,
  );
  if (resource.description) {
    lines.push(`  description: ${JSON.stringify(resource.description)},`);
  }
  if (resource.source) {
    lines.push(`  source: ${renderSourceExpression(resource.source)},`);
  }
  if (resource.kind === 'collection') {
    lines.push(`  idField: ${JSON.stringify(resource.idField)},`);
  }
  if (validator && !standardSchemaFirst) {
    lines.push(`  validator: ${validator},`);
  }
  lines.push('  fields: {');
  for (const [fieldName, field] of Object.entries(resource.fields ?? {})) {
    lines.push(`    ${propertyName(fieldName)}: ${renderFieldExpression(field, resource, fieldName, options.imports ?? new Map(), fieldName, {
      rootSchemaAlias: options.rootSchemaAlias,
    })},`);
  }
  lines.push('  },');
  lines.push('});', '');
  return lines.join('\n');
}

function bundleAllSeedWrites(config, project, options = {}) {
  return project.resources
    .filter((resource) => (
      resource.schemaHasSeed
      && !resource.dataPath
      && !isEmptySeed(resource.schemaSeed, resource.kind)
    ))
    .map((resource) => {
      const filePath = defaultSeedOutFile(config, resource);
      return {
        kind: 'seed',
        filePath,
        content: `${JSON.stringify(resource.schemaSeed, null, 2)}\n`,
        diagnostic: bundleSeedUnbundledDiagnostic(config, resource, filePath),
        options: {
          force: options.force,
          existsCode: 'SCHEMA_BUNDLE_SEED_OUTPUT_EXISTS',
          existsHint: 'Review the existing seed fixture, remove embedded schema seed, choose a different fixture source, or pass --force to overwrite it.',
          command: 'schema bundle --all',
          resource: resource.name,
        },
      };
    });
}

function importedResolverDiagnostic(config, resource, fieldName, resolverKind) {
  const relative = path.relative(config.cwd, resource.schemaPath);
  const wrapper = resolverFunctionName(resource.name, fieldName, resolverKind);
  return {
    code: 'SCHEMA_BUNDLE_IMPORTED_RESOLVER',
    severity: 'warn',
    resource: resource.name,
    file: relative,
    message: `SCHEMA_BUNDLE_IMPORTED_RESOLVER: ${resource.name}.${fieldName} uses a ${resolverKind} resolver from ${relative}. The root schema will import the original module and generate an inline named wrapper to preserve behavior.`,
    hint: `This is safe and non-destructive. To make db.schema.mjs fully standalone, move the resolver body into ${wrapper} manually.`,
    details: {
      command: 'schema bundle --all',
      resource: resource.name,
      field: fieldName,
      resolver: resolverKind,
      wrapper,
      strategy: 'inline-wrapper-import-original-module',
    },
  };
}

function importedValidatorDiagnostic(config, resource) {
  const relative = path.relative(config.cwd, resource.schemaPath);
  return {
    code: 'SCHEMA_BUNDLE_IMPORTED_VALIDATOR',
    severity: 'warn',
    resource: resource.name,
    file: relative,
    message: `SCHEMA_BUNDLE_IMPORTED_VALIDATOR: ${resource.name} uses a Standard Schema validator from ${relative}. The root schema will import the original module and reference its validator to preserve behavior.`,
    hint: 'This is safe and non-destructive. Keep the original .schema.mjs module available, or move the validator definition into db.schema.mjs manually.',
    details: {
      command: 'schema bundle --all',
      resource: resource.name,
      strategy: 'import-original-module-validator-reference',
    },
  };
}

function bundleSeedUnbundledDiagnostic(config, resource, outFile) {
  const relative = path.relative(config.cwd, outFile);
  return {
    code: 'SCHEMA_BUNDLE_SEED_UNBUNDLED',
    severity: 'warn',
    resource: resource.name,
    file: relative,
    message: `SCHEMA_BUNDLE_SEED_UNBUNDLED: ${resource.name} has embedded schema seed. schema bundle --all wrote ${relative} so db.schema.mjs can stay schema-only.`,
    hint: `Keep seed data in ${relative}. The generated root schema intentionally omits seed.`,
    details: {
      command: 'schema bundle --all',
      resource: resource.name,
      file: relative,
      strategy: 'split-schema-seed-before-root-bundle',
    },
  };
}

function arrowResolverDiagnostic(config, resource, fieldName, resolverKind) {
  const relative = path.relative(config.cwd, resource.schemaPath);
  const wrapper = resolverFunctionName(resource.name, fieldName, resolverKind);
  return {
    code: 'SCHEMA_BUNDLE_ARROW_RESOLVER_WRAPPED',
    severity: 'warn',
    resource: resource.name,
    file: relative,
    message: `SCHEMA_BUNDLE_ARROW_RESOLVER_WRAPPED: ${resource.name}.${fieldName} ${resolverKind} is an arrow-like resolver. The generated wrapper preserves behavior, but the original resolver still cannot use runtime this.`,
    hint: `To use services through this, move the resolver body into ${wrapper} in db.schema.mjs.`,
    details: {
      command: 'schema bundle --all',
      resource: resource.name,
      field: fieldName,
      resolver: resolverKind,
      wrapper,
    },
  };
}

function executableUnbundleDiagnostic(config, resource, outFile) {
  const relative = path.relative(config.cwd, outFile);
  const reasons = executableSchemaFunctionReasons(resource);
  const label = reasons.includes('computed-resolver') && reasons.includes('standard-validator')
    ? 'computed resolvers and Standard Schema validators'
    : reasons.includes('standard-validator')
      ? 'Standard Schema validators'
      : 'executable resolver functions';
  return {
    code: 'SCHEMA_UNBUNDLE_EXECUTABLE_REQUIRES_MJS',
    severity: 'warn',
    resource: resource.name,
    file: relative,
    message: `SCHEMA_UNBUNDLE_EXECUTABLE_REQUIRES_MJS: ${resource.name} contains ${label}, so schema unbundle --all will write ${relative} instead of JSONC.`,
    hint: 'Keep the .mjs output so executable schema behavior is preserved through imports and inline wrappers.',
    details: {
      command: 'schema unbundle --all',
      resource: resource.name,
      file: relative,
      outputFormat: 'mjs',
      reason: reasons.length === 1 ? reasons[0] : reasons,
    },
  };
}

function bundleDuplicateResourceDiagnostic(config, project) {
  const duplicate = project.diagnostics.find((diagnostic) => diagnostic.code === 'DUPLICATE_RESOURCE_NAME');
  if (!duplicate) {
    return undefined;
  }

  const files = duplicate.details?.files ?? (duplicate.file ? [duplicate.file] : []);
  return {
    code: 'SCHEMA_BUNDLE_DUPLICATE_RESOURCE',
    severity: 'error',
    resource: duplicate.resource,
    files,
    message: `Multiple schema or data sources resolve to resource "${duplicate.resource}".`,
    hint: duplicate.hint ?? 'Rename one source or configure resource naming before bundling all schemas.',
    details: {
      command: 'schema bundle --all',
      resource: duplicate.resource,
      files,
      severity: 'error',
      originalCode: duplicate.code,
      cwd: config.cwd,
    },
  };
}

function resourceHasResolvers(resource) {
  return Object.keys(resource.resolvers?.fields ?? {}).length > 0;
}

function resourceHasStandardValidator(resource) {
  return Boolean(resource.validators?.standard);
}

function shouldEmitStandardSchemaFirst(config, resource) {
  return Boolean(config?.schema?.standardSchema && resourceHasStandardValidator(resource));
}

function resourceHasExecutableFunctions(resource) {
  return resourceHasResolvers(resource) || resourceHasStandardValidator(resource);
}

function resourceHasExecutableSchema(resource) {
  return Boolean(resource.source) || resourceHasExecutableFunctions(resource);
}

function executableSchemaFunctionReasons(resource) {
  const reasons = [];
  if (resourceHasResolvers(resource)) {
    reasons.push('computed-resolver');
  }
  if (resourceHasStandardValidator(resource)) {
    reasons.push('standard-validator');
  }
  return reasons;
}

function ensureResourceImport(resource, imports) {
  const alias = imports.get(resource.schemaPath) ?? importAliasForResource(resource.name, imports);
  imports.set(resource.schemaPath, alias);
  return alias;
}

function resolverFieldAccess(resource, fieldName, imports, options = {}) {
  if (options.rootSchemaAlias) {
    return memberExpression(memberExpression(memberExpression(options.rootSchemaAlias, resource.name), 'fields'), fieldName);
  }

  const alias = imports.get(resource.schemaPath);
  if (!alias) {
    return undefined;
  }
  return memberExpression(memberExpression(alias, 'fields'), fieldName);
}

function validatorAccess(resource, imports, options = {}) {
  const base = options.rootSchemaAlias
    ? memberExpression(options.rootSchemaAlias, resource.name)
    : imports.get(resource.schemaPath);
  if (!base) {
    return undefined;
  }
  return memberExpression(base, resource.validatorSource ?? 'validator');
}

function resolverFunctionName(resourceName, fieldName, resolverKind) {
  const suffix = resolverKind === 'resolveMany' ? 'resolveMany' : 'resolver';
  let name = `${resourceName}_${fieldName}_${suffix}`.replace(/[^A-Za-z0-9_$]/g, '_');
  if (!/^[A-Za-z_$]/.test(name)) {
    name = `resource_${name}`;
  }
  return name;
}

function importAliasForResource(resourceName, imports) {
  let alias = `${resourceName}Source`.replace(/[^A-Za-z0-9_$]/g, '_');
  if (!/^[A-Za-z_$]/.test(alias)) {
    alias = `resource_${alias}`;
  }
  const used = new Set(imports.values());
  let next = alias;
  let suffix = 2;
  while (used.has(next)) {
    next = `${alias}${suffix}`;
    suffix += 1;
  }
  return next;
}

function moduleSpecifier(fromFile, sourceFile) {
  let relative = path.relative(path.dirname(fromFile), sourceFile).split(path.sep).join('/');
  if (!relative.startsWith('.')) {
    relative = `./${relative}`;
  }
  return relative;
}

function projectRootSchemaPath(config) {
  return path.join(config.cwd, 'db.schema.mjs');
}

function propertyName(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function memberExpression(base, key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${base}.${key}`
    : `${base}[${JSON.stringify(key)}]`;
}

function literal(value, indent = '      ') {
  return JSON.stringify(value, null, 2)
    .split('\n')
    .join(`\n${indent}`);
}

function objectLiteral(value) {
  const entries = Object.entries(value);
  const inline = `{ ${entries.map(([key, entry]) => `${propertyName(key)}: ${JSON.stringify(entry)}`).join(', ')} }`;
  if (inline.length <= 100 && !inline.includes('\n')) {
    return inline;
  }

  return `{\n${entries.map(([key, entry]) => `        ${propertyName(key)}: ${literal(entry, '        ')}`).join(',\n')}\n      }`;
}

function isArrowLikeFunction(value) {
  return typeof value === 'function' && value.prototype === undefined;
}

function requireSchemaResource(project, name) {
  const resourceMap = new Map(project.resources.map((resource) => [resource.name, resource]));
  const { resource, candidates } = resolveResource(resourceMap, name);
  if (!resource) {
    throw dbError(
      'SCHEMA_UNKNOWN_RESOURCE',
      `Unknown schema resource "${name}".`,
      {
        status: 404,
        hint: `Use one of: ${listChoices(project.resources.map((resource) => resource.name))}.`,
        details: {
          resource: name,
          requestedResource: name,
          normalizedCandidates: candidates,
          availableResources: project.resources.map((resource) => resource.name),
        },
      },
    );
  }
  return resource;
}

function schemaSourceForResource(resource, options = {}) {
  const source = {
    kind: resource.kind,
    fields: resource.fields,
  };

  if (resource.kind === 'collection') {
    source.idField = resource.idField;
  }

  if (resource.source) {
    source.source = resource.source;
  }

  if (resource.store) {
    source.store = resource.store;
  }

  if (resource.parser) {
    source.parser = resource.parser;
  }

  if (options.includeSeed) {
    source.seed = resource.seed;
  }

  return source;
}

function outputPath(config, maybePath) {
  return maybePath ? path.resolve(config.cwd, maybePath) : undefined;
}

function defaultSchemaOutFile(config, resource) {
  if (resource.schemaPath && !resource.schemaPath.endsWith('.schema.mjs')) {
    return resource.schemaPath;
  }

  return path.join(config.sourceDir, `${resource.name}.schema.jsonc`);
}

function defaultSeedOutFile(config, resource) {
  return resource.dataPath ?? path.join(config.sourceDir, `${resource.name}.json`);
}

async function writeOutput(filePath, content, config, options = {}) {
  const result = await preflightOutput(filePath, content, config, options);
  if (!result.shouldWrite) {
    return false;
  }

  await writeText(filePath, content);
  return true;
}

async function preflightOutput(filePath, content, config, options = {}) {
  if (options.force) {
    return { shouldWrite: true };
  }

  if (!options.force) {
    try {
      const existing = await readText(filePath);
      if (contentMatches(existing, content)) {
        return { shouldWrite: false };
      }

      const relative = path.relative(config.cwd, filePath);
      const code = options.existsCode ?? 'SCHEMA_OUTPUT_EXISTS';
      throw dbError(
        code,
        `${code}: ${relative} already exists with different content.`,
        {
          hint: options.existsHint ?? 'Review the existing file, choose a different output path, or pass --force to overwrite it.',
          details: {
            command: options.command,
            resource: options.resource,
            file: relative,
            severity: 'error',
          },
        },
      );
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return { shouldWrite: true };
}

function contentMatches(existing, next) {
  if (existing === next) {
    return true;
  }

  try {
    return stableJsonStringify(JSON.parse(existing)) === stableJsonStringify(JSON.parse(next));
  } catch {
    return false;
  }
}

function stableJsonStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function isEmptySeed(seed, kind) {
  if (kind === 'collection') {
    return Array.isArray(seed) && seed.length === 0;
  }

  return seed && typeof seed === 'object' && !Array.isArray(seed) && Object.keys(seed).length === 0;
}

function isInsidePath(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function positionalArgs(args) {
  const output = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--out' || arg === '--schema-out' || arg === '--seed-out' || arg === '--schema-dir' || arg === '--cwd' || arg === '--config') {
      index += 1;
      continue;
    }
    if (arg === '--all') {
      continue;
    }
    if (!String(arg).startsWith('-')) {
      output.push(arg);
    }
  }
  return output;
}
