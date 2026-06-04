import { makeGeneratedSchema } from '../schema.js';
import { serializeError } from '../errors.js';
import { readJsonBody, sendJson, sendText } from '../features/http/json-endpoint.js';
import { executeGraphql } from './execute.js';

type GraphqlHttpDb = {
  config: {
    server?: {
      maxBodyBytes?: number;
    };
  };
  resources: Map<string, unknown>;
};

type GraphqlHttpRequest = {
  method?: string;
  [key: string]: unknown;
};

type GraphqlHttpResponse = Record<string, unknown>;

export async function handleGraphqlRequest(
  db: GraphqlHttpDb,
  request: GraphqlHttpRequest,
  response: GraphqlHttpResponse,
): Promise<void> {
  try {
    await handleGraphqlRequestUnsafe(db, request, response);
  } catch (error) {
    sendJson(response, error.status ?? 500, serializeError(error, 'GRAPHQL_HTTP_ERROR'));
  }
}

async function handleGraphqlRequestUnsafe(
  db: GraphqlHttpDb,
  request: GraphqlHttpRequest,
  response: GraphqlHttpResponse,
): Promise<void> {
  if (request.method === 'GET') {
    const schema = makeGeneratedSchema([...db.resources.values()] as Parameters<typeof makeGeneratedSchema>[0]) as { graphql?: string };
    sendText(response, 200, schema.graphql, 'text/plain; charset=utf-8');
    return;
  }

  if (request.method === 'POST') {
    const body = await readJsonBody(request, {
      maxBytes: Number(db.config.server?.maxBodyBytes ?? 1048576),
    });
    sendJson(response, 200, await executeGraphql(db, body));
    return;
  }

  sendJson(response, 405, {
    error: 'Method not allowed',
  });
}
