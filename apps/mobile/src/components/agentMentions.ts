export function activeMention(text: string, cursor = text.length) {
  const before = text.slice(0, cursor);
  const match = /(?:^|\s)@([^\s]*)$/.exec(before);
  return match ? { query: match[1]!, start: cursor - match[1]!.length - 1, end: cursor } : null;
}
export function attachMention(text: string, path: string, cursor = text.length) {
  const mention = activeMention(text, cursor);
  return mention
    ? text.slice(0, mention.start) + '@' + path + ' ' + text.slice(mention.end)
    : text + (text && !text.endsWith(' ') ? ' ' : '') + '@' + path + ' ';
}
export function removeMention(text: string, path: string) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`@${escaped}(?=\\s|$)`, 'g'), '').trimStart();
}
