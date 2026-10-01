import { OllamaError } from './errors.js';

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    throw new OllamaError('bad_response', 'Malformed stream line from Ollama');
  }
}

export async function* readNdjson(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) yield parseLine(line);
      index = buffer.indexOf('\n');
    }
  }
  buffer += decoder.decode();
  const tail = buffer.trim();
  if (tail) yield parseLine(tail);
}
