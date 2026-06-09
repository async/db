import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleFalcorRequest } from '../../falcor/http.js';
import { handleGraphqlRequest } from '../../graphql/http.js';
import { sendJson } from '../../rest/handler.js';

type HttpFeaturePhase = 'preMock' | 'postMock' | string;

type RuntimeEventSource = {
  subscribe: (subscriber: (event: unknown) => void) => () => void;
};

type HttpFeatureDb = {
  config: {
    graphql?: {
      enabled?: boolean;
    };
    falcor?: {
      enabled?: boolean;
    };
    server?: {
      maxBodyBytes?: number;
    };
  };
  resources: Map<string, unknown>;
  events: RuntimeEventSource;
  [key: string]: unknown;
};

type HttpRoutes = {
  logPath: string;
  graphqlPath: string;
  graphqlAliases?: string[];
  falcorPath: string;
  falcorAliases?: string[];
  [key: string]: unknown;
};

type HttpFeatureContext = {
  db: HttpFeatureDb;
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  routes: HttpRoutes;
};

type HttpFeature = {
  name: string;
  phase?: HttpFeaturePhase;
  match: (context: HttpFeatureContext) => boolean;
  handle: (context: HttpFeatureContext) => void | Promise<void>;
};

type HttpFeatureOptions = {
  phase?: HttpFeaturePhase;
};

type HttpFeatureRegistry = {
  matches: (context: HttpFeatureContext, options?: HttpFeatureOptions) => boolean;
  handle: (context: HttpFeatureContext, options?: HttpFeatureOptions) => Promise<boolean>;
};

export function defaultHttpFeatureRegistry(): HttpFeatureRegistry {
  return createHttpFeatureRegistry([
    runtimeLogHttpFeature(),
    graphqlDisabledHttpFeature(),
    graphqlHttpFeature(),
    falcorDisabledHttpFeature(),
    falcorHttpFeature(),
  ]);
}

export function createHttpFeatureRegistry(features: HttpFeature[]): HttpFeatureRegistry {
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

function runtimeLogHttpFeature(): HttpFeature {
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

function graphqlHttpFeature(): HttpFeature {
  return {
    name: 'graphql',
    phase: 'postMock',
    match({ db, url, routes }) {
      return db.config.graphql?.enabled !== false && routeMatches(url.pathname, routes.graphqlPath, routes.graphqlAliases);
    },
    async handle({ db, request, response }) {
      await handleGraphqlRequest(db, request as never, response as never);
    },
  };
}

function graphqlDisabledHttpFeature(): HttpFeature {
  return {
    name: 'graphql-disabled',
    phase: 'preMock',
    match({ db, url, routes }) {
      return db.config.graphql?.enabled === false && routeMatches(url.pathname, routes.graphqlPath, routes.graphqlAliases);
    },
    async handle({ response, routes }) {
      sendJson(response, 404, {
        error: {
          code: 'GRAPHQL_DISABLED',
          message: 'GraphQL endpoint is disabled.',
          hint: 'Set graphql.enabled to true in db.config.js to enable the GraphQL endpoint.',
          details: {
            graphqlEnabled: false,
            path: routes.graphqlPath,
          },
        },
      });
    },
  };
}

function falcorHttpFeature(): HttpFeature {
  return {
    name: 'falcor',
    phase: 'postMock',
    match({ db, url, routes }) {
      return db.config.falcor?.enabled !== false && routeMatches(url.pathname, routes.falcorPath, routes.falcorAliases);
    },
    async handle({ db, request, response }) {
      await handleFalcorRequest(db as never, request as never, response as never);
    },
  };
}

function falcorDisabledHttpFeature(): HttpFeature {
  return {
    name: 'falcor-disabled',
    phase: 'preMock',
    match({ db, url, routes }) {
      return db.config.falcor?.enabled === false && routeMatches(url.pathname, routes.falcorPath, routes.falcorAliases);
    },
    async handle({ response, routes }) {
      sendJson(response, 404, {
        error: {
          code: 'FALCOR_DISABLED',
          message: 'Falcor endpoint is disabled.',
          hint: 'Set falcor.enabled to true in db.config.js to enable the Falcor endpoint.',
          details: {
            falcorEnabled: false,
            path: routes.falcorPath,
          },
        },
      });
    },
  };
}

function featureInPhase(feature: HttpFeature, phase?: HttpFeaturePhase): boolean {
  return !phase || (feature.phase ?? 'postMock') === phase;
}

function routeMatches(pathname: string, primary: string, aliases: string[] = []): boolean {
  return pathname === primary || aliases.includes(pathname);
}

function subscribeRuntimeLog(request: IncomingMessage, response: ServerResponse, db: HttpFeatureDb): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });
  response.write(': connected\n\n');
  const unsubscribe = db.events.subscribe((event) => {
    response.write(`event: db-log\ndata: ${JSON.stringify(event)}\n\n`);
  });
  request.on('close', unsubscribe);
}
