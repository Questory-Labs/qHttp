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
 * Feed chunks with `push`; `end` flushes a trailing event without a blank line.
 */
export function createSseParser(onMessage: (message: SseMessage) => void) {
  let buffer = '';
  let event = '';
  let data: string[] = [];
  let id: string | undefined;
  let retry: number | undefined;

  const dispatch = () => {
    if (data.length > 0) {
      onMessage({ event: event || 'message', data: data.join('\n'), id, retry });
    }
    event = '';
    data = [];
    retry = undefined;
  };

  const handleLine = (line: string) => {
    if (line === '') {
      dispatch();
      return;
    }
    if (line.startsWith(':')) return;

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
      case 'retry': {
        const n = Number(value);
        if (Number.isInteger(n) && n >= 0) retry = n;
        break;
      }
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
      if (buffer) {
        handleLine(buffer);
        buffer = '';
      }
      dispatch();
    },
    get lastEventId() {
      return id;
    },
  };
}
