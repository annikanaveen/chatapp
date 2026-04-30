const cache = new Map();

/**
 * @param {string} resolvedHref Absolute or same-origin URL to an HTML fragment
 */
export async function loadTemplate(resolvedHref) {
  if (cache.has(resolvedHref)) {
    return cache.get(resolvedHref);
  }
  const response = await fetch(resolvedHref);
  if (!response.ok) {
    throw new Error(`Failed to load template: ${resolvedHref} (${response.status})`);
  }
  const text = await response.text();
  cache.set(resolvedHref, text);
  return text;
}
