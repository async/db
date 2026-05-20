import { dbError } from '../errors.js';

export function parseGraphql(source) {
  const parser = new Parser(tokenize(source));
  return parser.parseDocument();
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.index = 0;
  }

  parseDocument() {
    const operations = [];
    const fragments = {};

    while (!this.peekValue('<eof>')) {
      if (this.peekName('fragment')) {
        const fragment = this.parseFragmentDefinition();
        fragments[fragment.name] = fragment;
      } else {
        operations.push(this.parseOperationDefinition());
      }
    }

    const firstOperation = operations[0] ?? {
      operation: 'query',
      name: null,
      selectionSet: [],
    };

    return {
      kind: 'document',
      operation: firstOperation.operation,
      name: firstOperation.name,
      selectionSet: firstOperation.selectionSet,
      operations,
      fragments,
    };
  }

  parseOperationDefinition() {
    let operation = 'query';
    let name = null;

    if (this.peekValue('{')) {
      return {
        kind: 'operation',
        operation,
        name,
        directives: [],
        selectionSet: this.parseSelectionSet(),
      };
    }

    if (this.peekName('query') || this.peekName('mutation')) {
      operation = this.consume().value;
      if (this.peek().type === 'name') {
        name = this.consume().value;
      }

      if (this.peekValue('(')) {
        this.skipBalanced('(', ')');
      }
    } else if (this.peekName('subscription')) {
      throw dbError(
        'GRAPHQL_SUBSCRIPTION_UNSUPPORTED',
        'GraphQL subscriptions are not supported by db.',
        {
          hint: 'Use query or mutation operations. db is a local fixture server and does not keep long-lived subscription streams.',
        },
      );
    } else {
      throw dbError(
        'GRAPHQL_PARSE_EXPECTED_OPERATION',
        `Expected GraphQL operation or fragment but found "${this.peek().value}".`,
        {
          hint: 'Start the document with "{", "query", "mutation", or "fragment".',
          details: { found: this.peek().value },
        },
      );
    }

    const directives = this.parseDirectives();

    return {
      kind: 'operation',
      operation,
      name,
      directives,
      selectionSet: this.parseSelectionSet(),
    };
  }

  parseFragmentDefinition() {
    this.expectNameValue('fragment');
    const name = this.expectName();
    this.expectNameValue('on');
    const typeCondition = this.expectName();
    const directives = this.parseDirectives();

    return {
      kind: 'fragment_definition',
      name,
      typeCondition,
      directives,
      selectionSet: this.parseSelectionSet(),
    };
  }

  parseSelectionSet() {
    this.expect('{');
    const selections = [];

    while (!this.peekValue('}')) {
      selections.push(this.parseSelection());
    }

    this.expect('}');
    return selections;
  }

  parseSelection() {
    if (this.peekValue('...')) {
      return this.parseFragmentSelection();
    }

    return this.parseField();
  }

  parseFragmentSelection() {
    this.expect('...');

    if (this.peekName('on')) {
      this.consume();
      const typeCondition = this.expectName();
      const directives = this.parseDirectives();
      return {
        kind: 'inline_fragment',
        typeCondition,
        directives,
        selectionSet: this.parseSelectionSet(),
      };
    }

    const name = this.expectName();
    const directives = this.parseDirectives();
    return {
      kind: 'fragment_spread',
      name,
      directives,
    };
  }

  parseField() {
    const firstName = this.expectName();
    let alias = null;
    let name = firstName;

    if (this.peekValue(':')) {
      this.consume();
      alias = firstName;
      name = this.expectName();
    }

    const args = this.peekValue('(') ? this.parseArguments() : {};
    const directives = this.parseDirectives();
    const selectionSet = this.peekValue('{') ? this.parseSelectionSet() : null;

    return {
      kind: 'field',
      alias,
      name,
      arguments: args,
      directives,
      selectionSet,
    };
  }

  parseDirectives() {
    const directives = [];

    while (this.peekValue('@')) {
      this.consume();
      const name = this.expectName();
      directives.push({
        kind: 'directive',
        name,
        arguments: this.peekValue('(') ? this.parseArguments() : {},
      });
    }

    return directives;
  }

  parseArguments() {
    this.expect('(');
    const args = {};

    while (!this.peekValue(')')) {
      const name = this.expectName();
      this.expect(':');
      args[name] = this.parseValue();
    }

    this.expect(')');
    return args;
  }

  parseValue() {
    const token = this.peek();

    if (token.value === '$') {
      this.consume();
      return {
        kind: 'variable',
        name: this.expectName(),
      };
    }

    if (token.type === 'string') {
      return {
        kind: 'literal',
        value: this.consume().value,
      };
    }

    if (token.type === 'number') {
      return {
        kind: 'literal',
        value: this.consume().value.includes('.') ? Number.parseFloat(token.value) : Number.parseInt(token.value, 10),
      };
    }

    if (token.type === 'name') {
      const value = this.consume().value;
      if (value === 'true') {
        return { kind: 'literal', value: true };
      }
      if (value === 'false') {
        return { kind: 'literal', value: false };
      }
      if (value === 'null') {
        return { kind: 'literal', value: null };
      }

      return {
        kind: 'literal',
        value,
      };
    }

    if (token.value === '[') {
      return this.parseList();
    }

    if (token.value === '{') {
      return this.parseObject();
    }

    throw dbError(
      'GRAPHQL_PARSE_UNEXPECTED_VALUE',
      `Unexpected GraphQL value token "${token.value}".`,
      {
        hint: 'Use a string, number, boolean, null, variable, list, or object literal for argument values.',
        details: { token: token.value },
      },
    );
  }

  parseList() {
    this.expect('[');
    const values = [];

    while (!this.peekValue(']')) {
      values.push(this.parseValue());
    }

    this.expect(']');
    return {
      kind: 'list',
      values,
    };
  }

  parseObject() {
    this.expect('{');
    const fields = {};

    while (!this.peekValue('}')) {
      const name = this.expectName();
      this.expect(':');
      fields[name] = this.parseValue();
    }

    this.expect('}');
    return {
      kind: 'object',
      fields,
    };
  }

  skipBalanced(open, close) {
    this.expect(open);
    let depth = 1;

    while (depth > 0) {
      const token = this.consume();
      if (token.type === 'eof') {
        throw dbError(
          'GRAPHQL_PARSE_UNTERMINATED_GROUP',
          `Unterminated GraphQL group "${open}".`,
          {
            hint: `Add the matching "${close}" before the end of the query.`,
            details: { open, close },
          },
        );
      }
      if (token.value === open) {
        depth += 1;
      }
      if (token.value === close) {
        depth -= 1;
      }
    }
  }

  expect(value) {
    const token = this.consume();
    if (token.value !== value) {
      throw dbError(
        'GRAPHQL_PARSE_EXPECTED_TOKEN',
        `Expected GraphQL token "${value}" but found "${token.value}".`,
        {
          hint: 'Check the query punctuation near this token. Common causes are missing braces, parentheses, or colons.',
          details: { expected: value, found: token.value },
        },
      );
    }
    return token;
  }

  expectName() {
    const token = this.consume();
    if (token.type !== 'name') {
      throw dbError(
        'GRAPHQL_PARSE_EXPECTED_NAME',
        `Expected a GraphQL name but found "${token.value}".`,
        {
          hint: 'Field names, aliases, arguments, and operation names must use GraphQL identifier syntax.',
          details: { found: token.value },
        },
      );
    }
    return token.value;
  }

  expectNameValue(value) {
    const name = this.expectName();
    if (name !== value) {
      throw dbError(
        'GRAPHQL_PARSE_EXPECTED_NAME_VALUE',
        `Expected GraphQL name "${value}" but found "${name}".`,
        {
          hint: `Use "${value}" in this part of the GraphQL document.`,
          details: { expected: value, found: name },
        },
      );
    }
    return name;
  }

  peekName(name) {
    const token = this.peek();
    return token.type === 'name' && token.value === name;
  }

  peekValue(value) {
    return this.peek().value === value;
  }

  peek() {
    return this.tokens[this.index] ?? { type: 'eof', value: '<eof>' };
  }

  consume() {
    const token = this.peek();
    this.index += 1;
    return token;
  }
}

function tokenize(source) {
  const tokens = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (/\s|,/.test(char)) {
      index += 1;
      continue;
    }

    if (char === '#') {
      while (index < source.length && source[index] !== '\n') {
        index += 1;
      }
      continue;
    }

    if (source.startsWith('...', index)) {
      tokens.push({ type: 'punctuation', value: '...' });
      index += 3;
      continue;
    }

    if ('{}():[]!$=@'.includes(char)) {
      tokens.push({ type: 'punctuation', value: char });
      index += 1;
      continue;
    }

    if (char === '"') {
      const result = readString(source, index);
      tokens.push({ type: 'string', value: result.value });
      index = result.index;
      continue;
    }

    if (char === '-' || /\d/.test(char)) {
      const result = readNumber(source, index);
      tokens.push({ type: 'number', value: result.value });
      index = result.index;
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      const result = readName(source, index);
      tokens.push({ type: 'name', value: result.value });
      index = result.index;
      continue;
    }

    throw dbError(
      'GRAPHQL_PARSE_UNEXPECTED_CHARACTER',
      `Unexpected GraphQL character "${char}".`,
      {
        hint: 'db supports a focused GraphQL subset. Check for unsupported punctuation, fragments, or directives.',
        details: { character: char, index },
      },
    );
  }

  tokens.push({ type: 'eof', value: '<eof>' });
  return tokens;
}

function readString(source, start) {
  let value = '';
  let index = start + 1;
  let escaping = false;

  while (index < source.length) {
    const char = source[index];

    if (escaping) {
      value += decodeEscape(char);
      escaping = false;
      index += 1;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      index += 1;
      continue;
    }

    if (char === '"') {
      return {
        value,
        index: index + 1,
      };
    }

    value += char;
    index += 1;
  }

  throw dbError(
    'GRAPHQL_PARSE_UNTERMINATED_STRING',
    'Unterminated GraphQL string.',
    {
      hint: 'Close the string with a double quote, or escape embedded quotes with \\".',
      details: { start },
    },
  );
}

function readNumber(source, start) {
  let index = start;
  while (index < source.length && /[-0-9.]/.test(source[index])) {
    index += 1;
  }

  return {
    value: source.slice(start, index),
    index,
  };
}

function readName(source, start) {
  let index = start;
  while (index < source.length && /[A-Za-z0-9_]/.test(source[index])) {
    index += 1;
  }

  return {
    value: source.slice(start, index),
    index,
  };
}

function decodeEscape(char) {
  switch (char) {
    case 'n':
      return '\n';
    case 'r':
      return '\r';
    case 't':
      return '\t';
    case '"':
    case '\\':
    case '/':
      return char;
    default:
      return char;
  }
}
