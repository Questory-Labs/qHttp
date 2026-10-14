export interface SseMessage {
  /** Event name; `'message'` when the stream did not set one. */
  event: string;
  data: string;
  id?: string;
  /** Server-suggested reconnect delay in ms, when sent. */
  retry?: number;
}

/**
 * Incremental text/event-stream parser (WHATWG EventSource algorithm).
 * Feed chunks with `push`; `end` discards a trailing event without a blank line.
 */
export interface SseParserHooks {
  /** A valid `retry:` field was parsed, whether or not the frame carries data. */
  onRetry?: (retry: number) => void;
  /** An event frame ended with an `id` set, whether or not it carried data. */
  onId?: (id: string) => void;
}

export function createSseParser(
  onMessage: (message: SseMessage) => void,
  hooks: SseParserHooks = {},
) {
  let buffer = '';
  let event = '';
  let data: string[] = [];
  let id: string | undefined;
  let retry: number | undefined;
  let sawField = false;
  // Id as of the last blank-line dispatch; restored when end() drops a frame.
  let dispatchedId: string | undefined;

  const reset = () => {
    sawField = false;
    event = '';
    data = [];
    retry = undefined;
  };

  const dispatch = () => {
    if (id !== undefined && sawField) hooks.onId?.(id);
    dispatchedId = id;
    if (data.length > 0) {
      onMessage({ event: event || 'message', data: data.join('\n'), id, retry });
    }
    reset();
  };

  const handleLine = (line: string) => {
    if (line === '') {
      dispatch();
      return;
    }
    if (line.startsWith(':')) return;

    sawField = true;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    switch (field) {
      case 'event':
        event = value;
        break;
      case 'data':
        data.push(value);
        break;
      case 'id':
        if (!value.includes('\0')) id = value;
        break;
      case 'retry':
        if (/^[0-9]+$/.test(value)) {
          retry = Number(value);
          hooks.onRetry?.(retry);
        }
        break;
      default:
        break;
    }
  };

  return {
    push(chunk: string) {
      buffer += chunk;
      let index: number;
      while ((index = buffer.search(/\r\n|\r|\n/)) !== -1) {
        const line = buffer.slice(0, index);
        const sepLength = buffer.startsWith('\r\n', index) ? 2 : 1;
        buffer = buffer.slice(index + sepLength);
        handleLine(line);
      }
    },
    end() {
      // A frame not closed by a blank line is incomplete: discard it.
      buffer = '';
      id = dispatchedId;
      reset();
    },
    get lastEventId() {
      return id;
    },
  };
}
