const CONVERSATION_ID_KEY = 'apex_conversation_id';

export const getConversationId = () => {
  if (typeof window === 'undefined') {
    return '';
  }

  const existing = window.localStorage.getItem(CONVERSATION_ID_KEY);
  if (existing) {
    return existing;
  }

  const created = crypto.randomUUID();
  window.localStorage.setItem(CONVERSATION_ID_KEY, created);
  return created;
};

export const resetConversationId = () => {
  if (typeof window === 'undefined') {
    return '';
  }

  const created = crypto.randomUUID();
  window.localStorage.setItem(CONVERSATION_ID_KEY, created);
  return created;
};
