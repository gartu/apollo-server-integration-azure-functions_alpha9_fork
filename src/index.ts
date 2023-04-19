import type {
  HttpHandler,
  HttpRequest,
  InvocationContext,
} from '@azure/functions';
import {
  ApolloServer,
  BaseContext,
  ContextFunction,
  HeaderMap,
  HTTPGraphQLRequest,
} from '@apollo/server';
import type { WithRequired } from '@apollo/utils.withrequired';

export interface AzureFunctionsContextFunctionArgument {
  req: HttpRequest;
  context: InvocationContext;
  body: unknown;
}

export interface AzureFunctionsMiddlewareOptions<TContext extends BaseContext> {
  context?: ContextFunction<[AzureFunctionsContextFunctionArgument], TContext>;
}

const defaultContext: ContextFunction<
  [AzureFunctionsContextFunctionArgument],
  any
> = async () => ({});

export function startServerAndCreateHandler(
  server: ApolloServer<BaseContext>,
  options?: AzureFunctionsMiddlewareOptions<BaseContext>,
): HttpHandler;
export function startServerAndCreateHandler<TContext extends BaseContext>(
  server: ApolloServer<TContext>,
  options: WithRequired<AzureFunctionsMiddlewareOptions<TContext>, 'context'>,
): HttpHandler;
export function startServerAndCreateHandler<TContext extends BaseContext>(
  server: ApolloServer<TContext>,
  options?: AzureFunctionsMiddlewareOptions<TContext>,
): HttpHandler {
  server.startInBackgroundHandlingStartupErrorsByLoggingAndFailingAllRequests();
  return async (req: HttpRequest, context: InvocationContext) => {
    const contextFunction = options?.context ?? defaultContext;
    try {
      const normalizedRequest = await normalizeRequest(req);

      const { body, headers, status } = await server.executeHTTPGraphQLRequest({
        httpGraphQLRequest: normalizedRequest,
        context: () =>
          contextFunction({ req, context, body: normalizedRequest.body }),
      });

      if (body.kind === 'chunked') {
        throw Error('Incremental delivery not implemented');
      }

      return {
        status: status || 200,
        headers: {
          ...Object.fromEntries(headers),
          'content-length': Buffer.byteLength(body.string).toString(),
        },
        body: body.string,
      };
    } catch (e) {
      context.error('Failure processing GraphQL request', e);
      return {
        status: 400,
        body: (e as Error).message,
      };
    }
  };
}

async function normalizeRequest(req: HttpRequest): Promise<HTTPGraphQLRequest> {
  if (!req.method) {
    throw new Error('No method');
  }

  return {
    method: req.method,
    headers: normalizeHeaders(req.headers),
    search: new URL(req.url).search,
    body: await parseBody(req),
  };
}

async function parseBody(req: HttpRequest): Promise<object | string | null> {
  const isValidContentType = req.headers
    .get('content-type')
    ?.startsWith('application/json');
  const isValidPostRequest = req.method === 'POST' && isValidContentType;

  if (isValidPostRequest) {
    return req.json() as Promise<object>;
  } else if (isValidContentType) {
    return req.text() as Promise<string>;
  }

  return Promise.resolve(null);
}

function normalizeHeaders(headers: Headers): HeaderMap {
  const headerMap = new HeaderMap();
  headers.forEach((value, key) => {
    headerMap.set(key, value ?? '');
  });
  return headerMap;
}
