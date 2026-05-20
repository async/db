import { handleGraphqlRequest } from '../../graphql/http.js';
import { sendJson } from '../../rest/handler.js';

export function defaultHttpFeatureRegistry() {
  return createHttpFeatureRegistry([
    runtimeLogHttpFeature(),
    graphqlDisabledHttpFeature(),
    graphqlHttpFeature(),
  ]);
}

export function createHttpFeatureRegistry(features) {
  return {
    matches(context, options = {}) {
      return features.some((feature) => featureInPhase(feature, options.phase) && feature.match(context));
    },
    async handle(context, options = {}) {
      for (const feature of features) {
        if (featureInPhase(feature, options.phase) && feature.match(context)) {
          await feature.handle(context);
          return true;
        }
      }
      return false;
    },
  };
}

function runtimeLogHttpFeature() {
  return {
    name: 'runtime-log',
    phase: 'preMock',
    match({ request, url, routes }) {
      return request.method === 'GET' && url.pathname === routes.logPath;
    },
    async handle({ request, response, db }) {
      subscribeRuntimeLog(request, response, db);
    },
  };
}

function graphqlHttpFeature() {
  return {
    name: 'graphql',
    phase: 'postMock',
    match({ db, url, routes }) {
      return db.config.graphql?.enabled !== false && url.pathname === routes.graphqlPath;
    },
    async handle({ db, request, response }) {
      await handleGraphqlRequest(db, request, response);
    },
  };
}

function graphqlDisabledHttpFeature() {
  return {
    name: 'graphql-disabled',
    phase: 'preMock',
    match({ db, url, routes }) {
      return db.config.graphql?.enabled === false && url.pathname === routes.graphqlPath;
    },
    async handle({ response, routes }) {
      sendJson(response, 404, {
        error: {
          code: 'GRAPHQL_DISABLED',
          message: 'GraphQL endpoint is disabled.',
          hint: 'Set graphql.enabled to true in jsondb.config.mjs to enable the GraphQL endpoint.',
          details: {
            graphqlEnabled: false,
            path: routes.graphqlPath,
          },
        },
      });
    },
  };
}

function featureInPhase(feature, phase) {
  return !phase || (feature.phase ?? 'postMock') === phase;
}

function subscribeRuntimeLog(request, response, db) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });
  response.write(': connected\n\n');
  const unsubscribe = db.events.subscribe((event) => {
    response.write(`event: jsondb-log\ndata: ${JSON.stringify(event)}\n\n`);
  });
  request.on('close', unsubscribe);
}
