import { dbError, serializeError } from '../../errors.js';
import { tracePhase, type RequestTrace } from '../../tracing.js';

type JsonRequest = AsyncIterable<unknown>;

type JsonResponse = {
  writeHead(status: number, headers?: Record<string, unknown>): unknown;
  end(chunk?: unknown): unknown;
};

type RawBodyOptions = {
  maxBytes?: number;
};

type SequentialBatchOptions<TItem> = {
  trace?: RequestTrace | null;
  phaseName?: string;
  itemDetails?: (index: number, item: TItem) => Record<string, unknown>;
  errorCode?: string;
};

type BatchItemResult<TResult> = TResult & {
  index: number;
};

type ErrorWithStatus = Error & {
  status?: number;
  code?: string;
};

export async function readRawBody(request: unknown, options: RawBodyOptions = {}): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const maxBytes = Number(options.maxBytes ?? Infinity);
  let byteLength = 0;

  for await (const chunk of request as JsonRequest) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    byteLength += buffer.length;
    if (byteLength > maxBytes) {
      throw dbError(
        'JSON_BODY_TOO_LARGE',
        `Request body is too large. Received more than ${maxBytes} bytes.`,
        {
          status: 413,
          hint: 'Send a smaller JSON payload or increase server.maxBodyBytes in db.config.mjs for local development.',
          details: {
            maxBodyBytes: maxBytes,
          },
        },
      );
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

export async function readJsonBody(request: unknown, options: RawBodyOptions = {}): Promise<unknown> {
  const text = (await readRawBody(request, options)).toString('utf8').trim();
  try {
    return text ? JSON.parse(text) : {};
  } catch (error) {
    throw dbError(
      'REST_INVALID_JSON_BODY',
      'Request body is not valid JSON.',
      {
        status: 400,
        hint: 'Check for trailing commas, unquoted property names, or an incomplete JSON object.',
        details: {
          parserMessage: (error as Error).message,
        },
      },
    );
  }
}

export function sendJson(response: unknown, status: number, body: unknown): void {
  if (status === 204) {
    (response as JsonResponse).writeHead(status);
    (response as JsonResponse).end();
    return;
  }

  sendText(response, status, `${JSON.stringify(body, null, 2)}\n`, 'application/json; charset=utf-8');
}

export function sendText(response: unknown, status: number, body: unknown, contentType: string): void {
  (response as JsonResponse).writeHead(status, {
    'content-type': contentType,
  });
  (response as JsonResponse).end(body);
}

export async function tryJsonEndpoint<TResult>(
  fn: () => TResult | Promise<TResult>,
  errorCode = 'REST_ERROR',
): Promise<{
    status: number;
    headers: Record<string, unknown>;
    body: TResult | ReturnType<typeof serializeError>;
  }> {
  try {
    const body = await fn();
    return {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body,
    };
  } catch (error) {
    return {
      status: (error as ErrorWithStatus).status ?? 500,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: serializeError(error, errorCode),
    };
  }
}

export async function executeSequentialJsonBatch<TItem, TResult>(
  items: TItem[],
  executeItem: (item: TItem, index: number) => TResult | Promise<TResult>,
  options: SequentialBatchOptions<TItem> = {},
): Promise<Array<BatchItemResult<TResult> | {
  index: number;
  status: number;
  headers: Record<string, unknown>;
  body: ReturnType<typeof serializeError>;
}>> {
  const results: Array<BatchItemResult<TResult> | {
    index: number;
    status: number;
    headers: Record<string, unknown>;
    body: ReturnType<typeof serializeError>;
  }> = [];
  const trace = options.trace ?? null;
  const phaseName = options.phaseName ?? 'batch-item';
  const errorCode = options.errorCode ?? 'REST_ERROR';

  for (const [index, item] of items.entries()) {
    const itemDetails = options.itemDetails?.(index, item) ?? { index };
    try {
      const result = await tracePhase(trace, phaseName, () => executeItem(item, index), itemDetails);
      results.push({
        index,
        ...result,
      });
    } catch (error) {
      trace?.setError(error as ErrorWithStatus);
      trace?.addPhase(phaseName, 0, {
        ...itemDetails,
        error: (error as ErrorWithStatus).code ? String((error as ErrorWithStatus).code) : errorCode,
      });
      results.push({
        index,
        status: (error as ErrorWithStatus).status ?? 500,
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        body: serializeError(error, errorCode),
      });
    }
  }

  return results;
}
