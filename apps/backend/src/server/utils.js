import { WebSocket } from 'ws';

export function normaliseAgentText(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (value == null) {
    return '';
  }
  try {
    return String(value);
  } catch (error) {
    console.warn('Failed to normalise agent value', error);
    return '';
  }
}

export function formatAgentEvent(event) {
  if (!event || typeof event !== 'object') {
    return undefined;
  }

  switch (event.type) {
    case 'assistant-message': {
      const text = normaliseAgentText(event.message).trim();
      if (!text) {
        return undefined;
      }
      return JSON.stringify({ type: 'agent_message', text });
    }
    case 'status': {
      const text = normaliseAgentText(event.message);
      if (!text) {
        return undefined;
      }
      const payload = {
        type: 'agent_status',
        text,
        eventType: 'status',
      };
      if (typeof event.level === 'string' && event.level) {
        payload.level = event.level;
      }
      if (typeof event.details === 'string' && event.details) {
        payload.details = event.details;
      }
      if (typeof event.title === 'string' && event.title) {
        payload.title = normaliseAgentText(event.title);
      }
      return JSON.stringify(payload);
    }
    case 'error': {
      const message = normaliseAgentText(event.message) || 'Agent runtime reported an error.';
      const payload = {
        type: 'agent_error',
        message,
      };
      if (event.details) {
        payload.details = normaliseAgentText(event.details);
      }
      return JSON.stringify(payload);
    }
    case 'thinking': {
      if (event.state === 'start' || event.state === 'stop') {
        return JSON.stringify({ type: 'agent_thinking', state: event.state });
      }
      return undefined;
    }
    case 'banner': {
      const title = normaliseAgentText(event.title);
      if (!title) {
        return undefined;
      }
      const payload = {
        type: 'agent_status',
        text: title,
        title,
        level: 'info',
        eventType: 'banner',
      };
      if (typeof event.subtitle === 'string' && event.subtitle) {
        payload.subtitle = normaliseAgentText(event.subtitle);
      }
      if (typeof event.description === 'string' && event.description) {
        payload.description = normaliseAgentText(event.description);
      }
      if (typeof event.details === 'string' && event.details) {
        payload.details = normaliseAgentText(event.details);
      }
      return JSON.stringify(payload);
    }
    case 'plan': {
      if (Array.isArray(event.plan)) {
        return JSON.stringify({ type: 'agent_plan', plan: event.plan });
      }
      return undefined;
    }
    case 'request-input': {
      const payload = {
        type: 'agent_request_input',
        prompt: normaliseAgentText(event.prompt),
      };
      if (typeof event.level === 'string' && event.level) {
        payload.level = event.level;
      }
      if (event.metadata && typeof event.metadata === 'object') {
        try {
          payload.metadata = JSON.parse(JSON.stringify(event.metadata));
        } catch (error) {
          console.warn('Failed to serialise agent metadata', error);
        }
      }
      return JSON.stringify(payload);
    }
    default:
      return undefined;
  }
}

export function describeAgentError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : 'Unknown error';
}

export function isWebSocketOpen(ws) {
  return ws?.readyState === WebSocket.OPEN;
}
